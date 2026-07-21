/**
 * Liaison stricte des produits BJ non encore liés à eFashion.
 *
 * Différence avec `efashion-link-all.ts` : ce script teste la référence
 * COMPLÈTE en premier, puis tombe sur la partie avant le premier tiret
 * UNIQUEMENT si la full ref ne ramène rien. Les anciennes fiches eFashion
 * utilisent la base sans suffixe (« A1250 » pour BJ A1250-DO), les
 * nouvelles fiches utilisent la full ref (« PR-BAGUE92 », « A1244-DO »).
 *
 * Règles de sécurité (skip au moindre doute) :
 *  1. Référence vide / 0 couleur UNIT → skip.
 *  2. Attribut sans mapping eFashion (catégorie, pays, saison, composition,
 *     couleur) → skip avec liste des manques.
 *  3. Aucun candidat trouvé ni en stratégie 1 ni en stratégie 2 → skip.
 *  4. Match à la fois en stratégie 1 ET 2 → ambigu, skip (la cliente
 *     décidera à la main quel groupe est le bon).
 *  5. Couleur BJ sans équivalent eFashion exact (normalisé sans accents) →
 *     skip.
 *  6. Couleur BJ qui matche 2+ lignes eFashion → ambigu, skip.
 *  7. Ligne eFashion (id_produit unique) référencée par 2 couleurs BJ →
 *     skip.
 *  8. Ligne eFashion non utilisée (orpheline) → skip — on refuse de lier
 *     partiellement.
 *
 * Usage VPS :
 *   npx tsx scripts/efashion-link-strict.ts             # SIMULATION par défaut
 *   npx tsx scripts/efashion-link-strict.ts --apply     # écriture BDD
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { efashionGetMe, efashionListByReferenceBaseExact } from "@/lib/efashion-api";
import { normalizeEfashionColorName } from "@/lib/efashion-link-match";
import { getCountryByIso } from "@/lib/countries";
import { logger } from "@/lib/logger";

const PAUSE_MS = 200;
const APPLY = process.argv.includes("--apply");

/**
 * Synonymes couleurs validés par la cliente le 2026-06-08.
 * Clé = forme normalisée (sans accents, lowercase) → forme canonique
 * partagée entre BJ et eFashion. La normalisation se fait avant lookup.
 */
const COLOR_SYNONYMS: Record<string, string> = {
  brun: "marron",
  "brun fonce": "marron",
  "marron clair": "marron",
  "marron fonce": "marron",
  fuchsia: "fushia",
  marine: "bleu marine",
};

function canonicalizeColor(name: string): string {
  const norm = normalizeEfashionColorName(name);
  return COLOR_SYNONYMS[norm] ?? norm;
}

type Outcome =
  | { kind: "linked"; ref: string; base: string; colors: number; strategy: "full" | "partial" }
  | { kind: "skipped_no_unit"; ref: string }
  | { kind: "skipped_missing_attrs"; ref: string; reasons: string[] }
  | { kind: "skipped_no_match"; ref: string }
  | { kind: "skipped_ambiguous_both"; ref: string; fullCount: number; partialCount: number }
  | { kind: "skipped_color_mismatch"; ref: string; base: string; reason: string }
  | { kind: "error"; ref: string; error: string };

interface BjProduct {
  id: string;
  reference: string;
  category: { name: string; efashionCategorieId: number | null } | null;
  countryIsoCode: string | null;
  season: { name: string; efashionCollectionId: number | null } | null;
  compositions: Array<{ composition: { name: string; efashionId: number | null } }>;
  colors: Array<{
    saleType: "UNIT" | "PACK";
    color: { id: string; name: string; efashionColorId: number | null } | null;
  }>;
}

interface Candidate {
  id_produit: number;
  id_couleur: number;
  couleur: string;
  reference_base: string;
}

function partialBase(reference: string): string {
  return (reference.split(/[-_]/)[0] ?? reference).trim();
}

async function findCandidatesStrict(
  vendorId: number,
  referenceBase: string,
): Promise<Candidate[]> {
  const items = await efashionListByReferenceBaseExact({
    idVendeur: vendorId,
    referenceBase,
    premelFilter: "tous",
  });
  return items.map((it) => ({
    id_produit: it.id_produit,
    id_couleur: it.id_couleur,
    couleur: it.couleur,
    reference_base: it.reference_base,
  }));
}

function checkMissingAttrs(p: BjProduct): string[] {
  const reasons: string[] = [];
  if (!p.category?.efashionCategorieId)
    reasons.push(`Catégorie « ${p.category?.name ?? "(vide)"} » sans mapping`);
  const country = getCountryByIso(p.countryIsoCode);
  if (!country?.efashionProvenanceId)
    reasons.push(
      `Pays « ${country?.name ?? p.countryIsoCode ?? "(vide)"} » sans mapping`,
    );
  if (!p.season?.efashionCollectionId)
    reasons.push(`Saison « ${p.season?.name ?? "(vide)"} » sans mapping`);
  if (p.compositions.length === 0) reasons.push("Aucune matière");
  for (const pc of p.compositions) {
    if (!pc.composition.efashionId)
      reasons.push(`Matière « ${pc.composition.name} » sans mapping`);
  }
  return reasons;
}

function matchColors(
  p: BjProduct,
  candidates: Candidate[],
): { ok: true; links: { localColorId: string; efId: number; efColorId: number }[] }
  | { ok: false; reason: string } {
  const unit = new Map<
    string,
    { id: string; name: string; norm: string; efColorId: number | null }
  >();
  for (const pc of p.colors) {
    if (pc.saleType !== "UNIT" || !pc.color) continue;
    if (unit.has(pc.color.id)) continue;
    unit.set(pc.color.id, {
      id: pc.color.id,
      name: pc.color.name,
      norm: canonicalizeColor(pc.color.name),
      efColorId: pc.color.efashionColorId,
    });
  }
  for (const uc of unit.values()) {
    if (!uc.efColorId) return { ok: false, reason: `Couleur « ${uc.name} » sans mapping eFashion` };
  }
  // Garde-fou : si deux couleurs BJ différentes canonisent vers le même nom
  // (ex. produit avec à la fois « Marron » et « Brun »), on ne peut pas
  // décider laquelle lier à la ligne eFashion « Marron » → skip.
  const canonCounts = new Map<string, number>();
  for (const uc of unit.values()) {
    canonCounts.set(uc.norm, (canonCounts.get(uc.norm) ?? 0) + 1);
  }
  for (const [canon, count] of canonCounts) {
    if (count > 1) {
      return {
        ok: false,
        reason: `2 couleurs BJ pointent vers « ${canon} » après synonymes — ambigu`,
      };
    }
  }
  const used = new Set<number>();
  const links: { localColorId: string; efId: number; efColorId: number }[] = [];
  for (const uc of unit.values()) {
    const matches = candidates.filter((c) => canonicalizeColor(c.couleur) === uc.norm);
    if (matches.length === 0)
      return { ok: false, reason: `Couleur BJ « ${uc.name} » sans équivalent eFashion` };
    if (matches.length > 1)
      return {
        ok: false,
        reason: `Couleur « ${uc.name} » correspond à ${matches.length} lignes eFashion`,
      };
    if (used.has(matches[0].id_produit))
      return {
        ok: false,
        reason: `Ligne eFashion ${matches[0].id_produit} référencée par 2 couleurs BJ`,
      };
    used.add(matches[0].id_produit);
    links.push({
      localColorId: uc.id,
      efId: matches[0].id_produit,
      efColorId: matches[0].id_couleur,
    });
  }
  const orphans = candidates.filter((c) => !used.has(c.id_produit));
  if (orphans.length > 0) {
    return {
      ok: false,
      reason: `${orphans.length} ligne(s) eFashion sans équivalent BJ : ${orphans
        .map((o) => o.couleur)
        .join(", ")}`,
    };
  }
  return { ok: true, links };
}

async function processOne(p: BjProduct, vendorId: number): Promise<Outcome> {
  const ref = p.reference;
  if (!ref.trim()) return { kind: "error", ref, error: "Référence vide" };

  const unitColors = p.colors.filter((c) => c.saleType === "UNIT" && c.color);
  if (unitColors.length === 0) return { kind: "skipped_no_unit", ref };

  const reasons = checkMissingAttrs(p);
  if (reasons.length > 0) return { kind: "skipped_missing_attrs", ref, reasons };

  for (const pc of unitColors) {
    if (!pc.color?.efashionColorId) {
      return {
        kind: "skipped_missing_attrs",
        ref,
        reasons: [`Couleur « ${pc.color?.name ?? "(vide)"} » sans mapping eFashion`],
      };
    }
  }

  // Stratégie 1 : full ref
  const fullCandidates = await findCandidatesStrict(vendorId, ref);
  // Stratégie 2 : partial (avant premier tiret), uniquement si pas identique à full
  const partial = partialBase(ref);
  const partialCandidates =
    partial === ref ? [] : await findCandidatesStrict(vendorId, partial);

  let chosen: { base: string; cands: Candidate[]; strategy: "full" | "partial" } | null = null;
  if (fullCandidates.length > 0 && partialCandidates.length > 0) {
    return {
      kind: "skipped_ambiguous_both",
      ref,
      fullCount: fullCandidates.length,
      partialCount: partialCandidates.length,
    };
  }
  if (fullCandidates.length > 0) chosen = { base: ref, cands: fullCandidates, strategy: "full" };
  else if (partialCandidates.length > 0)
    chosen = { base: partial, cands: partialCandidates, strategy: "partial" };

  if (!chosen) return { kind: "skipped_no_match", ref };

  const m = matchColors(p, chosen.cands);
  if (!m.ok) return { kind: "skipped_color_mismatch", ref, base: chosen.base, reason: m.reason };

  if (APPLY) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: p.id },
          data: {
            efashionReferenceBase: chosen!.base,
            efashionLastSyncSnapshot: Prisma.DbNull,
          },
        });
        await tx.productColor.updateMany({
          where: { productId: p.id },
          data: { efashionProductId: null },
        });
        for (const l of m.links) {
          await tx.productColor.updateMany({
            where: { productId: p.id, colorId: l.localColorId, saleType: "UNIT" },
            data: { efashionProductId: l.efId },
          });
          await tx.color.updateMany({
            where: { id: l.localColorId, efashionColorId: null },
            data: { efashionColorId: l.efColorId },
          });
        }
      });
    } catch (err) {
      return {
        kind: "error",
        ref,
        error: err instanceof Error ? err.message : "Erreur BDD",
      };
    }
  }

  return {
    kind: "linked",
    ref,
    base: chosen.base,
    colors: m.links.length,
    strategy: chosen.strategy,
  };
}

async function main() {
  console.log(APPLY ? "🛠️  MODE APPLY — écriture en BDD." : "🧪 MODE SIMULATION.\n");

  const vendor = await efashionGetMe();
  console.log(`🔌 ${vendor.nomBoutique} (id_vendeur=${vendor.id_vendeur})\n`);

  const products = await prisma.product.findMany({
    where: { efashionReferenceBase: null, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      reference: true,
      category: { select: { name: true, efashionCategorieId: true } },
      countryIsoCode: true,
      season: { select: { name: true, efashionCollectionId: true } },
      compositions: {
        select: { composition: { select: { name: true, efashionId: true } } },
      },
      colors: {
        select: {
          saleType: true,
          color: { select: { id: true, name: true, efashionColorId: true } },
        },
      },
    },
    orderBy: { reference: "asc" },
  });

  const total = products.length;
  console.log(`📦 ${total} produit(s) à examiner.\n`);

  const out: Outcome[] = [];
  for (let i = 0; i < total; i++) {
    const p = products[i] as BjProduct;
    process.stdout.write(`[${i + 1}/${total}] ${p.reference} … `);
    try {
      const o = await processOne(p, vendor.id_vendeur);
      out.push(o);
      switch (o.kind) {
        case "linked":
          console.log(`✅ ${o.colors} couleur(s) [${o.strategy}] base="${o.base}"`);
          break;
        case "skipped_no_unit":
          console.log("⏭️  100% paquet");
          break;
        case "skipped_missing_attrs":
          console.log(`⛔ attributs (${o.reasons[0]})`);
          break;
        case "skipped_no_match":
          console.log("⛔ introuvable");
          break;
        case "skipped_ambiguous_both":
          console.log(
            `⚠️  ambigu (full=${o.fullCount}, partial=${o.partialCount}) — à revoir`,
          );
          break;
        case "skipped_color_mismatch":
          console.log(`⚠️  couleurs : ${o.reason}`);
          break;
        case "error":
          console.log(`❌ ${o.error}`);
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`❌ fatal : ${msg}`);
      out.push({ kind: "error", ref: p.reference, error: msg });
      logger.warn("[link-strict] failed", { ref: p.reference, error: err });
    }
    if (i < total - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  const grouped = {
    linked: out.filter((o) => o.kind === "linked"),
    noUnit: out.filter((o) => o.kind === "skipped_no_unit"),
    missing: out.filter((o) => o.kind === "skipped_missing_attrs"),
    noMatch: out.filter((o) => o.kind === "skipped_no_match"),
    bothAmbig: out.filter((o) => o.kind === "skipped_ambiguous_both"),
    colorMismatch: out.filter((o) => o.kind === "skipped_color_mismatch"),
    errors: out.filter((o) => o.kind === "error"),
  };

  console.log("\n═════════════════════════════════════");
  console.log("  RÉCAP");
  console.log("═════════════════════════════════════");
  console.log(`  ✅ Liés                      : ${grouped.linked.length}`);
  console.log(`     ├─ via référence complète : ${grouped.linked.filter((o) => o.kind === "linked" && o.strategy === "full").length}`);
  console.log(`     └─ via base partielle     : ${grouped.linked.filter((o) => o.kind === "linked" && o.strategy === "partial").length}`);
  console.log(`  ⏭️  100% paquet               : ${grouped.noUnit.length}`);
  console.log(`  ⛔ Attributs manquants       : ${grouped.missing.length}`);
  console.log(`  ⛔ Introuvables chez eFashion: ${grouped.noMatch.length}`);
  console.log(`  ⚠️  Ambigus (full ET partial) : ${grouped.bothAmbig.length}`);
  console.log(`  ⚠️  Couleurs ne matchent pas  : ${grouped.colorMismatch.length}`);
  console.log(`  ❌ Erreurs                   : ${grouped.errors.length}`);
  console.log("═════════════════════════════════════\n");

  if (grouped.bothAmbig.length > 0) {
    console.log("⚠️  Ambigus (présents en full ET partial — à revoir à la main) :");
    for (const o of grouped.bothAmbig) {
      if (o.kind !== "skipped_ambiguous_both") continue;
      console.log(`  • ${o.ref} (full=${o.fullCount}, partial=${o.partialCount})`);
    }
    console.log("");
  }

  if (grouped.colorMismatch.length > 0) {
    console.log("⚠️  Couleurs ne matchent pas :");
    for (const o of grouped.colorMismatch.slice(0, 40)) {
      if (o.kind !== "skipped_color_mismatch") continue;
      console.log(`  • ${o.ref} (base eFashion "${o.base}") — ${o.reason}`);
    }
    if (grouped.colorMismatch.length > 40)
      console.log(`  … et ${grouped.colorMismatch.length - 40} de plus`);
    console.log("");
  }

  if (grouped.missing.length > 0) {
    console.log("⛔ Attributs manquants (échantillon) :");
    const sample = grouped.missing.slice(0, 20);
    for (const o of sample) {
      if (o.kind !== "skipped_missing_attrs") continue;
      console.log(`  • ${o.ref} — ${o.reasons[0]}`);
    }
    if (grouped.missing.length > 20)
      console.log(`  … et ${grouped.missing.length - 20} de plus`);
    console.log("");
  }

  if (!APPLY) {
    console.log("👉 Pour appliquer : npx tsx scripts/efashion-link-strict.ts --apply");
  }
}

main()
  .catch((err) => {
    console.error("\n❌ Erreur fatale :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
