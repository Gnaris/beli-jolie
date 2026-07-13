/**
 * Rattrapage « double stock côté eFashion » sur les produits déjà liés à
 * eFashion avant le fix du 2026-07-13.
 *
 * Cause : quand la couleur BJ était déjà mappée à un id_couleur eFashion
 * différent de celui du produit eFashion existant, la sync post-liaison
 * poussait le stock sur le MAUVAIS id_couleur → 2ᵉ entrée créée côté eFashion
 * → total affiché = ancien + nouveau (double).
 *
 * Ce que fait le script :
 *   1. Pour chaque ProductColor UNIT du produit qui est liée à eFashion :
 *      a. Va lire côté eFashion l'`id_couleur` réel de son `id_produit`.
 *      b. Compare avec `Color.efashionColorId` global BJ.
 *      c. Si diff → pose `ProductColor.efashionColorIdOverride` = id_couleur eF réel.
 *      d. Supprime **définitivement** (removeProduitStock) toutes les lignes
 *         stock côté eFashion qui pointent sur l'ancien id_couleur — pas juste
 *         mises à 0, sinon la ligne reste visible dans l'UI eFashion avec un 0.
 *   2. Relance `efashionUpdateProductInPlace(productId, { forceFullSync: true })`
 *      pour re-pousser le stock sur le bon id_couleur.
 *
 * Usage (multi-tenant obligatoire — la BDD contient plusieurs boutiques) :
 *   npx tsx scripts/efashion-fix-stock-doubling.ts --tenant <slug> <productIdOrRef>            # dry-run
 *   npx tsx scripts/efashion-fix-stock-doubling.ts --tenant <slug> <productIdOrRef> --apply    # applique
 *
 * Ex : npx tsx scripts/efashion-fix-stock-doubling.ts --tenant issyma 93365IMP-ISSY
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  efashionGetMe,
  efashionListByReferenceBaseExact,
  efashionListProduitStocks,
  type EfashionProductListItem,
  type EfashionProduitStock,
} from "@/lib/efashion-api";
import { efashionRemoveProduitStock } from "@/lib/efashion-api-write";
import { efashionUpdateProductInPlace } from "@/lib/efashion-update";
import { bindTenantId } from "@/lib/tenant-als";

interface CliArgs {
  identifier: string;
  tenantSlug: string;
  apply: boolean;
}

function parseArgs(): CliArgs {
  const raw = process.argv.slice(2);
  const apply = raw.includes("--apply");
  const tenantIdx = raw.indexOf("--tenant");
  const tenantSlug = tenantIdx >= 0 ? raw[tenantIdx + 1] : undefined;
  const positional = raw.filter(
    (a, i) => !a.startsWith("--") && !(tenantIdx >= 0 && i === tenantIdx + 1),
  );
  const identifier = positional[0];
  if (!identifier || !tenantSlug) {
    console.error(
      "Usage: npx tsx scripts/efashion-fix-stock-doubling.ts --tenant <slug> <productIdOrReference> [--apply]",
    );
    process.exit(1);
  }
  return { identifier, tenantSlug, apply };
}

async function findProduct(identifier: string, tenantId: string) {
  // Accepte soit un id (cuid), soit une référence — scopé au tenant.
  const byId = await prisma.product.findFirst({
    where: { id: identifier, tenantId },
    select: {
      id: true,
      reference: true,
      name: true,
      efashionReferenceBase: true,
    },
  });
  if (byId) return byId;

  return prisma.product.findFirst({
    where: { reference: identifier, tenantId },
    select: {
      id: true,
      reference: true,
      name: true,
      efashionReferenceBase: true,
    },
  });
}

async function main() {
  const { identifier, tenantSlug, apply } = parseArgs();

  // Résout le tenant + bind l'ALS pour que toutes les queries Prisma et les
  // appels eFashion (credentials + cookies) soient scopés au bon vendeur.
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    console.error(`❌ Tenant « ${tenantSlug} » introuvable.`);
    process.exit(1);
  }
  bindTenantId(tenant.id);
  console.log(`🏬 Boutique : ${tenant.name} (${tenant.slug})`);

  console.log(`🔎 Recherche du produit « ${identifier} »…`);
  const product = await findProduct(identifier, tenant.id);
  if (!product) {
    console.error(`❌ Aucun produit trouvé pour « ${identifier} » dans « ${tenantSlug} ».`);
    process.exit(1);
  }
  if (!product.efashionReferenceBase) {
    console.error(
      `❌ Le produit « ${product.reference} » n'est pas lié à eFashion (efashionReferenceBase vide).`,
    );
    process.exit(1);
  }

  console.log(`📦 ${product.reference} — ${product.name}`);
  console.log(`   efashionReferenceBase = ${product.efashionReferenceBase}\n`);

  // 1) Lit les ProductColor UNIT liées à eFashion + Color.efashionColorId global.
  const productColors = await prisma.productColor.findMany({
    where: {
      productId: product.id,
      tenantId: tenant.id,
      saleType: "UNIT",
      efashionProductId: { not: null },
    },
    select: {
      id: true,
      efashionProductId: true,
      efashionColorIdOverride: true,
      color: { select: { id: true, name: true, efashionColorId: true } },
      variantSizes: { select: { size: { select: { name: true } } } },
    },
  });

  if (productColors.length === 0) {
    console.log("✅ Aucune variante UNIT liée à eFashion. Rien à corriger.");
    return;
  }

  // 2) Lit l'état live côté eFashion pour cette reference_base.
  const vendor = await efashionGetMe();
  console.log(`🔌 eFashion vendeur : ${vendor.id_vendeur}`);
  const efItems = await efashionListByReferenceBaseExact({
    idVendeur: vendor.id_vendeur,
    referenceBase: product.efashionReferenceBase,
    premelFilter: "tous",
  });
  const efById = new Map<number, EfashionProductListItem>(
    efItems.map((it) => [it.id_produit, it]),
  );
  console.log(`   ${efItems.length} ligne(s) eFashion trouvée(s) pour cette référence.\n`);

  // 3) Lit les lignes stock détaillées de chaque id_produit eFashion — c'est
  // la vraie source pour identifier les lignes orphelines à supprimer (chaque
  // ligne a un `id_produit_stock` unique qu'on peut cibler avec removeProduitStock).
  const stocksByProductId = new Map<number, EfashionProduitStock[]>();
  for (const efProductId of new Set(efItems.map((it) => it.id_produit))) {
    stocksByProductId.set(efProductId, await efashionListProduitStocks(efProductId));
  }

  // 4) Pour chaque ProductColor, détecte le mismatch et planifie l'action.
  interface Plan {
    productColorId: string;
    colorName: string;
    efProductId: number;
    globalBjId: number | null;
    efActualId: number;
    currentOverride: number | null;
    needsOverride: boolean;
    /** Lignes stock côté eFashion qui pointent sur un mauvais id_couleur
     * (à supprimer via removeProduitStock). */
    orphanStockLines: EfashionProduitStock[];
  }
  const plans: Plan[] = [];

  for (const pc of productColors) {
    if (!pc.efashionProductId || !pc.color) continue;
    const efLine = efById.get(pc.efashionProductId);
    if (!efLine) {
      console.log(
        `⚠️  ${pc.color.name} (efProductId=${pc.efashionProductId}) → ligne eFashion introuvable, ignoré.`,
      );
      continue;
    }
    const globalBjId = pc.color.efashionColorId;
    const efActualId = efLine.id_couleur;
    const currentEffective = pc.efashionColorIdOverride ?? globalBjId ?? null;
    const needsOverride = currentEffective !== efActualId;
    // Toutes les lignes stock qui n'ont pas le bon id_couleur = orphelines,
    // quel que soit leur libellé de taille (null, "TU", "Taille unique"…).
    const allStocks = stocksByProductId.get(pc.efashionProductId) ?? [];
    const orphanStockLines = allStocks.filter((s) => s.id_couleur !== efActualId);

    plans.push({
      productColorId: pc.id,
      colorName: pc.color.name,
      efProductId: pc.efashionProductId,
      globalBjId,
      efActualId,
      currentOverride: pc.efashionColorIdOverride,
      needsOverride,
      orphanStockLines,
    });
  }

  // 5) Affiche le plan.
  console.log("─── Plan de rattrapage ───");
  let anyChange = false;
  for (const p of plans) {
    console.log(
      `\n• « ${p.colorName} » (efProductId=${p.efProductId})` +
        `\n    Color.efashionColorId global BJ = ${p.globalBjId}` +
        `\n    id_couleur réel côté eFashion    = ${p.efActualId}` +
        `\n    override actuel sur ProductColor = ${p.currentOverride ?? "—"}`,
    );
    if (p.needsOverride) {
      anyChange = true;
      console.log(`    ⚠️  MISMATCH → poser override = ${p.efActualId}`);
    } else {
      console.log("    ✅ id_couleur cohérent (pas de mismatch).");
    }
    if (p.orphanStockLines.length > 0) {
      anyChange = true;
      console.log(
        `    ↳ ${p.orphanStockLines.length} ligne(s) stock orpheline(s) à SUPPRIMER :`,
      );
      for (const s of p.orphanStockLines) {
        console.log(
          `        - id_produit_stock=${s.id_produit_stock} (id_couleur=${s.id_couleur}, taille=${s.taille ?? "null"}, value=${s.value})`,
        );
      }
    }
  }

  if (!anyChange) {
    console.log("\n✅ Aucun mismatch ni orphelin détecté. Rien à faire.");
    return;
  }

  if (!apply) {
    console.log("\n💡 Dry-run terminé. Ajoutez `--apply` pour exécuter le rattrapage.");
    return;
  }

  // 6) Applique.
  console.log("\n🚀 Application du rattrapage…\n");
  for (const p of plans) {
    // 6a) Pose l'override sur la ProductColor si nécessaire.
    if (p.needsOverride) {
      await prisma.productColor.update({
        where: { id: p.productColorId },
        data: { efashionColorIdOverride: p.efActualId },
      });
      console.log(
        `   ✏️  ProductColor ${p.productColorId} → override=${p.efActualId}`,
      );
    }

    // 6b) Supprime définitivement chaque ligne stock orpheline (removeProduitStock).
    // Contrairement à upsertProduitStock(value=0), ça retire la ligne pour
    // qu'elle ne s'affiche plus dans l'UI eFashion avec un stock=0 fantôme.
    for (const s of p.orphanStockLines) {
      try {
        await efashionRemoveProduitStock(s.id_produit_stock);
        console.log(
          `      🗑️  ligne stock supprimée : id_produit_stock=${s.id_produit_stock} (id_couleur=${s.id_couleur}, taille=${s.taille ?? "null"})`,
        );
      } catch (err) {
        console.log(
          `      ⚠️  removeProduitStock(${s.id_produit_stock}) KO : ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  // 7) Reset snapshot + relance la sync eFashion pour re-pousser le stock sur
  // le bon id_couleur. Prisma.DbNull car le champ est Json?.
  await prisma.product.update({
    where: { id: product.id },
    data: { efashionLastSyncSnapshot: Prisma.DbNull },
  });

  console.log("\n🔁 Relance sync eFashion (forceFullSync)…");
  const res = await efashionUpdateProductInPlace(product.id, { forceFullSync: true });
  if (res.success) {
    console.log(`   ✅ Sync OK (colorsCreatedCount=${res.colorsCreatedCount ?? 0}).`);
  } else {
    console.log(`   ⚠️  Sync KO : ${res.error}`);
  }

  console.log("\n🎉 Terminé. Vérifiez le stock côté eFashion sur ce produit.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
