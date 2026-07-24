/**
 * Rattrapage : re-enrichit les produits déjà importés depuis Paris Fashion Shop
 * qui n'ont pas leur composition/pays/saison/catégorie (parce qu'à l'époque, la
 * phase de scan/correspondances ne couvrait que 50 produits et l'import
 * ignorait silencieusement les attributs non mappés).
 *
 * Avec le nouveau flow d'auto-création, on ré-applique la même logique en mode
 * "reprise" : pour chaque produit incomplet, on appelle Paris Fashion Shop pour
 * récupérer les détails (composition, pays, saison, catégorie), on crée les
 * entités manquantes en local au passage, et on met à jour le produit.
 *
 * Usage : NODE_ENV=production npx tsx scripts/enrich-pfs-products.ts
 */

import { prisma } from "@/lib/prisma";
import { pfsCheckReference } from "@/lib/pfs-api";
import {
  createOrLinkMapping,
  countryLabel,
} from "@/lib/pfs-import";
import { getCountryByIso, getCountryByPfsRef } from "@/lib/countries";
import { logger } from "@/lib/logger";

interface Target {
  id: string;
  reference: string;
  needCompositions: boolean;
  needCountry: boolean;
  needSeason: boolean;
}

function pickEnLabel(labels: Record<string, string> | null | undefined): string | null {
  if (!labels) return null;
  const en = labels.en?.trim();
  return en && en.length > 0 ? en : null;
}

async function enrichOne(t: Target): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const check = await pfsCheckReference(t.reference);
    if (!check.exists || !check.product) {
      return { ok: false, error: "Produit introuvable sur PFS" };
    }
    const detail = check.product;

    // ── Composition
    if (t.needCompositions && (detail.material_composition?.length ?? 0) > 0) {
      const materialEntries = detail.material_composition.map((mat) => ({
        pfsRef: mat.reference,
        label: mat.labels?.fr ?? mat.labels?.en ?? mat.reference,
        percentage: mat.percentage,
        enLabel: pickEnLabel(mat.labels),
      }));
      const compositionsInput: { compositionId: string; percentage: number }[] = [];
      for (const mat of materialEntries) {
        const existing = await prisma.composition.findFirst({
          where: { pfsCompositionRef: mat.pfsRef },
          select: { id: true },
        });
        let compositionId: string;
        if (existing) {
          compositionId = existing.id;
        } else {
          const created = await createOrLinkMapping({
            type: "composition",
            pfsRef: mat.pfsRef,
            label: mat.label,
            enLabel: mat.enLabel,
          });
          compositionId = created.id;
        }
        compositionsInput.push({ compositionId, percentage: mat.percentage });
      }
      if (compositionsInput.length > 0) {
        await prisma.productComposition.deleteMany({ where: { productId: t.id } });
        await prisma.productComposition.createMany({
          data: compositionsInput.map((c) => ({
            productId: t.id,
            compositionId: c.compositionId,
            percentage: c.percentage,
          })),
        });
      }
    }

    // ── Pays : résolu via lib/countries.ts (statique)
    if (t.needCountry && detail.country_of_manufacture) {
      const ctryCode = detail.country_of_manufacture;
      const ctryLabelFr = countryLabel(ctryCode);
      const resolved =
        getCountryByPfsRef(ctryLabelFr) ?? getCountryByIso(ctryCode);
      if (resolved) {
        await prisma.product.update({
          where: { id: t.id },
          data: { countryIsoCode: resolved.code },
        });
      } else {
        logger.warn("[Enrich PFS] Pays inconnu dans lib/countries.ts", {
          productReference: t.reference,
          pfsCountryLabel: ctryLabelFr,
          pfsIsoCode: ctryCode,
        });
      }
    }

    // ── Saison
    if (t.needSeason && detail.collection?.reference) {
      const seasonRef = detail.collection.reference;
      let seasonRow = await prisma.season.findFirst({
        where: { pfsRef: seasonRef },
        select: { id: true },
      });
      if (!seasonRow) {
        const seasonLabel =
          detail.collection.labels?.fr ??
          detail.collection.labels?.en ??
          seasonRef;
        const seasonEnLabel = pickEnLabel(detail.collection.labels);
        const created = await createOrLinkMapping({
          type: "season",
          pfsRef: seasonRef,
          label: seasonLabel,
          enLabel: seasonEnLabel,
        });
        seasonRow = { id: created.id };
      }
      await prisma.product.update({
        where: { id: t.id },
        data: { seasonId: seasonRow.id },
      });
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function main() {
  const all = await prisma.product.findMany({
    where: { pfsProductId: { not: null } },
    select: {
      id: true,
      reference: true,
      countryIsoCode: true,
      seasonId: true,
      compositions: { select: { id: true } },
    },
  });

  const targets: Target[] = [];
  for (const p of all) {
    const needCompositions = p.compositions.length === 0;
    const needCountry = !p.countryIsoCode;
    const needSeason = !p.seasonId;
    if (needCompositions || needCountry || needSeason) {
      targets.push({
        id: p.id,
        reference: p.reference,
        needCompositions,
        needCountry,
        needSeason,
      });
    }
  }

  console.log(`Produits à enrichir : ${targets.length}/${all.length}`);
  let ok = 0;
  let errors = 0;
  let i = 0;
  for (const t of targets) {
    i++;
    const result = await enrichOne(t);
    if (result.ok) {
      ok++;
      if (i % 10 === 0 || i === targets.length) {
        console.log(`[${i}/${targets.length}] ${t.reference} → ok (${ok} succès, ${errors} erreurs)`);
      }
    } else {
      errors++;
      console.warn(`[${i}/${targets.length}] ${t.reference} → ERREUR : ${result.error}`);
    }
  }
  console.log(`\nTerminé : ${ok} produit(s) enrichi(s), ${errors} en erreur.`);
  logger.info("[Enrich PFS] Done", { ok, errors, total: targets.length });
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
