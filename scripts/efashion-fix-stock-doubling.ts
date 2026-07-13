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
 *      d. Remet à 0 le stock sur l'ancien id_couleur BJ (nettoyage entrée orpheline).
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
  type EfashionProductListItem,
} from "@/lib/efashion-api";
import { efashionUpsertProduitStock } from "@/lib/efashion-api-write";
import { getEfashionAnnexes } from "@/lib/efashion-annexes";
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

  // 3) Prépare le mapping tailles pour chaque déclinaison rencontrée — sert au
  // nettoyage des stocks orphelins (une entrée par taille).
  const annexes = await getEfashionAnnexes();
  const sizesByDeclinaison = new Map<number, string[]>();
  for (const it of efItems) {
    if (it.id_declinaison && !sizesByDeclinaison.has(it.id_declinaison)) {
      const decl = annexes.declinaisons.find((d) => d.id === it.id_declinaison);
      sizesByDeclinaison.set(it.id_declinaison, decl?.sizes.map((s) => s.value) ?? []);
    }
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
    orphanIdCouleur: number | null;
    orphanSizes: string[];
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
    const orphanIdCouleur =
      needsOverride && currentEffective !== null && currentEffective !== efActualId
        ? currentEffective
        : null;
    const orphanSizes = efLine.id_declinaison
      ? sizesByDeclinaison.get(efLine.id_declinaison) ?? []
      : [];

    plans.push({
      productColorId: pc.id,
      colorName: pc.color.name,
      efProductId: pc.efashionProductId,
      globalBjId,
      efActualId,
      currentOverride: pc.efashionColorIdOverride,
      needsOverride,
      orphanIdCouleur,
      orphanSizes,
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
    if (!p.needsOverride) {
      console.log("    ✅ RAS — id_couleur cohérent.");
      continue;
    }
    anyChange = true;
    console.log(`    ⚠️  MISMATCH → poser override = ${p.efActualId}`);
    if (p.orphanIdCouleur !== null) {
      console.log(
        `    ↳ nettoyer stock orphelin sur id_couleur=${p.orphanIdCouleur}` +
          ` (${p.orphanSizes.length} taille(s) : ${p.orphanSizes.join(", ") || "aucune"})`,
      );
    }
  }

  if (!anyChange) {
    console.log("\n✅ Aucun mismatch détecté. Rien à faire.");
    return;
  }

  if (!apply) {
    console.log("\n💡 Dry-run terminé. Ajoutez `--apply` pour exécuter le rattrapage.");
    return;
  }

  // 6) Applique.
  console.log("\n🚀 Application du rattrapage…\n");
  for (const p of plans) {
    if (!p.needsOverride) continue;

    // 6a) Pose l'override sur la ProductColor.
    await prisma.productColor.update({
      where: { id: p.productColorId },
      data: { efashionColorIdOverride: p.efActualId },
    });
    console.log(
      `   ✏️  ProductColor ${p.productColorId} → override=${p.efActualId}`,
    );

    // 6b) Nettoie le stock orphelin (une entrée par taille de la déclinaison).
    if (p.orphanIdCouleur !== null && p.orphanSizes.length > 0) {
      for (const taille of p.orphanSizes) {
        try {
          await efashionUpsertProduitStock({
            id_produit: p.efProductId,
            id_couleur: p.orphanIdCouleur,
            value: 0,
            taille,
          });
          console.log(
            `      ↳ orphelin nettoyé : (${p.efProductId}, id_couleur=${p.orphanIdCouleur}, ${taille}) = 0`,
          );
        } catch (err) {
          console.log(
            `      ⚠️  upsertProduitStock(orphelin) KO sur ${taille} : ${err instanceof Error ? err.message : err}`,
          );
        }
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
