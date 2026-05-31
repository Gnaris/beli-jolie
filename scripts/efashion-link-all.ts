/**
 * Liaison en masse de tous les produits BJ à leurs fiches eFashion existantes.
 *
 * Niveau A : pose UNIQUEMENT les liens en BDD locale (pas d'envoi de stock/prix
 * vers eFashion). Une « Resynchro » manuelle ultérieure pousse les données.
 *
 * Pour chaque produit non encore lié (Product.efashionReferenceBase = NULL) :
 *   1. Demande à eFashion les lignes-couleurs ayant la même reference_base.
 *   2. Délègue la décision (auto-link / skip / ambigu) à `decideEfashionLink`
 *      (lib/efashion-link-match.ts) — logique pure, testée séparément.
 *   3. Si "linked", pose les FK en BDD dans une transaction.
 *
 * Sortie : récap dans le terminal (X liés / Y à revoir / Z impossibles) +
 * détail par produit pour les non-liés. Aucun fichier généré.
 *
 * Usage VPS :
 *   npx tsx scripts/efashion-link-all.ts                # ecriture reelle en BDD
 *   npx tsx scripts/efashion-link-all.ts --simulation   # lecture seule, aucun lien pose
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { efashionGetMe, efashionListProducts } from "@/lib/efashion-api";
import { logger } from "@/lib/logger";
import {
  decideEfashionLink,
  computeEfashionReferenceBase,
  type EfashionMatchCandidate,
  type EfashionMatchDecision,
} from "@/lib/efashion-link-match";

const PAUSE_BETWEEN_PRODUCTS_MS = 250;

const DRY_RUN = process.argv.includes("--simulation") || process.argv.includes("--dry-run");

type LinkOutcome =
  | { status: "linked"; productId: string; reference: string; linkedColors: number }
  | { status: "skipped_no_unit"; productId: string; reference: string }
  | { status: "skipped_missing_attrs"; productId: string; reference: string; reasons: string[] }
  | { status: "skipped_no_match"; productId: string; reference: string; referenceBase: string }
  | { status: "skipped_ambiguous"; productId: string; reference: string; referenceBase: string; reason: string }
  | { status: "error"; productId: string; reference: string; error: string };

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function processProduct(productId: string, vendorId: number): Promise<LinkOutcome> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      category: { select: { name: true, efashionCategorieId: true } },
      manufacturingCountry: { select: { name: true, efashionProvenanceId: true } },
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
  });

  if (!product) {
    return { status: "error", productId, reference: "?", error: "Produit introuvable" };
  }
  const ref = product.reference;

  const referenceBase = computeEfashionReferenceBase(ref);
  if (!referenceBase) {
    return { status: "error", productId, reference: ref, error: "Référence vide" };
  }

  // Récupération des candidats eFashion
  let candidates: EfashionMatchCandidate[];
  try {
    const list = await efashionListProducts({
      idVendeur: vendorId,
      take: 100,
      reference: referenceBase,
      premelFilter: "en_ligne",
    });
    candidates = list.items.map((it) => ({
      id_produit: it.id_produit,
      id_couleur: it.id_couleur,
      couleur: it.couleur,
      reference_base: it.reference_base,
    }));
  } catch (err) {
    return {
      status: "error",
      productId,
      reference: ref,
      error: err instanceof Error ? err.message : "Erreur eFashion",
    };
  }

  // Décision pure
  const decision: EfashionMatchDecision = decideEfashionLink(
    {
      id: product.id,
      reference: ref,
      category: product.category,
      manufacturingCountry: product.manufacturingCountry,
      season: product.season,
      compositions: product.compositions,
      colors: product.colors.map((c) => ({
        saleType: c.saleType as "UNIT" | "PACK",
        color: c.color,
      })),
    },
    candidates,
  );

  switch (decision.status) {
    case "skipped_no_unit":
      return { status: "skipped_no_unit", productId, reference: ref };
    case "skipped_missing_attrs":
      return {
        status: "skipped_missing_attrs",
        productId,
        reference: ref,
        reasons: decision.reasons,
      };
    case "skipped_no_match":
      return {
        status: "skipped_no_match",
        productId,
        reference: ref,
        referenceBase: decision.referenceBase,
      };
    case "skipped_ambiguous":
      return {
        status: "skipped_ambiguous",
        productId,
        reference: ref,
        referenceBase: decision.referenceBase,
        reason: decision.reason,
      };
    case "linked": {
      // Mode simulation : on n'écrit rien, on retourne juste la décision.
      if (DRY_RUN) {
        return {
          status: "linked",
          productId,
          reference: ref,
          linkedColors: decision.links.length,
        };
      }
      // Écriture en BDD (Niveau A — pas d'appel à efashionUpdateProductInPlace)
      try {
        await prisma.$transaction(async (tx) => {
          await tx.product.update({
            where: { id: productId },
            data: {
              efashionReferenceBase: decision.referenceBase,
              efashionLastSyncSnapshot: Prisma.DbNull,
            },
          });

          await tx.productColor.updateMany({
            where: { productId },
            data: { efashionProductId: null },
          });

          for (const l of decision.links) {
            await tx.productColor.updateMany({
              where: { productId, colorId: l.localColorId, saleType: "UNIT" },
              data: { efashionProductId: l.efashionProductId },
            });

            await tx.color.updateMany({
              where: { id: l.localColorId, efashionColorId: null },
              data: { efashionColorId: l.efashionColorId },
            });
          }
        });
        return {
          status: "linked",
          productId,
          reference: ref,
          linkedColors: decision.links.length,
        };
      } catch (err) {
        return {
          status: "error",
          productId,
          reference: ref,
          error: err instanceof Error ? err.message : "Erreur écriture BDD",
        };
      }
    }
  }
}

async function main() {
  if (DRY_RUN) {
    console.log("🧪 MODE SIMULATION — aucune écriture en BDD.\n");
  }
  // 1) Vérifier que eFashion est configuré
  const vendor = await efashionGetMe();
  console.log(
    `🔌 Connecté à eFashion en tant que ${vendor.nomBoutique} (id_vendeur=${vendor.id_vendeur})\n`,
  );

  // 2) Liste des produits non encore liés
  const products = await prisma.product.findMany({
    where: { efashionReferenceBase: null },
    select: { id: true, reference: true },
    orderBy: { reference: "asc" },
  });

  const total = products.length;
  console.log(`📦 ${total} produit(s) à examiner (efashionReferenceBase NULL)\n`);

  if (total === 0) {
    console.log("Rien à faire — tous vos produits sont déjà liés.");
    return;
  }

  const outcomes: LinkOutcome[] = [];
  let i = 0;

  for (const p of products) {
    i += 1;
    process.stdout.write(`[${i}/${total}] ${p.reference} … `);
    try {
      const outcome = await processProduct(p.id, vendor.id_vendeur);
      outcomes.push(outcome);
      switch (outcome.status) {
        case "linked":
          console.log(`✅ lié (${outcome.linkedColors} couleur(s))`);
          break;
        case "skipped_no_unit":
          console.log("⏭️  ignoré (100% paquet)");
          break;
        case "skipped_missing_attrs":
          console.log(`⛔ attributs manquants (${outcome.reasons.length})`);
          break;
        case "skipped_no_match":
          console.log("⛔ introuvable chez eFashion");
          break;
        case "skipped_ambiguous":
          console.log("⚠️  à revoir manuellement");
          break;
        case "error":
          console.log(`❌ erreur : ${outcome.error}`);
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`❌ erreur fatale : ${msg}`);
      outcomes.push({ status: "error", productId: p.id, reference: p.reference, error: msg });
      logger.warn("[eFashion link-all] product failed", { productId: p.id, error: err });
    }

    if (i < total) await sleep(PAUSE_BETWEEN_PRODUCTS_MS);
  }

  // 3) Récap final
  const linked = outcomes.filter((o) => o.status === "linked");
  const skippedNoUnit = outcomes.filter((o) => o.status === "skipped_no_unit");
  const skippedMissing = outcomes.filter((o) => o.status === "skipped_missing_attrs");
  const skippedNoMatch = outcomes.filter((o) => o.status === "skipped_no_match");
  const skippedAmbiguous = outcomes.filter((o) => o.status === "skipped_ambiguous");
  const errors = outcomes.filter((o) => o.status === "error");

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  RÉCAP");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  ✅ Liés automatiquement      : ${linked.length}`);
  console.log(`  ⏭️  Ignorés (100% paquet)     : ${skippedNoUnit.length}`);
  console.log(`  ⛔ Attributs manquants       : ${skippedMissing.length}`);
  console.log(`  ⛔ Introuvables chez eFashion: ${skippedNoMatch.length}`);
  console.log(`  ⚠️  À revoir (ambigus)        : ${skippedAmbiguous.length}`);
  console.log(`  ❌ Erreurs                   : ${errors.length}`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (skippedMissing.length > 0) {
    console.log("⛔ Produits bloqués par des attributs manquants :");
    for (const o of skippedMissing) {
      if (o.status !== "skipped_missing_attrs") continue;
      console.log(
        `  • ${o.reference} — ${o.reasons[0]}${o.reasons.length > 1 ? ` (+${o.reasons.length - 1})` : ""}`,
      );
    }
    console.log("");
  }

  if (skippedNoMatch.length > 0) {
    console.log("⛔ Produits introuvables chez eFashion :");
    for (const o of skippedNoMatch.slice(0, 50)) {
      if (o.status !== "skipped_no_match") continue;
      console.log(`  • ${o.reference} (cherché : ${o.referenceBase})`);
    }
    if (skippedNoMatch.length > 50) {
      console.log(`  … et ${skippedNoMatch.length - 50} de plus`);
    }
    console.log("");
  }

  if (skippedAmbiguous.length > 0) {
    console.log("⚠️  Produits à revoir manuellement (couleurs ambiguës ou orphelines) :");
    for (const o of skippedAmbiguous) {
      if (o.status !== "skipped_ambiguous") continue;
      console.log(`  • ${o.reference} — ${o.reason}`);
    }
    console.log("");
  }

  if (errors.length > 0) {
    console.log("❌ Erreurs :");
    for (const o of errors) {
      if (o.status !== "error") continue;
      console.log(`  • ${o.reference} — ${o.error}`);
    }
    console.log("");
  }

  console.log(
    "👉 Pour visualiser les produits à corriger : sur /admin/produits, " +
      "utilisez le filtre Marketplaces → Lien eFashion Paris → Non lié à eFashion.",
  );
}

main()
  .catch((err) => {
    console.error("\n❌ Erreur fatale :");
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
