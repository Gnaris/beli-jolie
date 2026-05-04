/**
 * Script de migration : déduplique ProductColorImage par (productId, colorId, order).
 *
 * Avant la refonte, on créait une ligne d'image par variante portant la couleur
 * (donc une couleur partagée par 3 variantes générait 3 doublons en base, et
 * 3 uploads sur PFS). Désormais on garde une seule ligne par couleur produit
 * (productColorId = NULL).
 *
 * Idempotent : un 2ᵉ run ne fait rien si tout est déjà dédupliqué.
 *
 * Usage : npx tsx scripts/dedupe-product-color-images.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const startedAt = Date.now();
  console.log("[dedupe-product-color-images] start");

  const allGroups = await prisma.productColorImage.groupBy({
    by: ["productId", "colorId", "order"],
    _count: { _all: true },
  });
  const groups = allGroups.filter((g) => g._count._all > 1);

  let duplicatesDeleted = 0;
  for (const group of groups) {
    const rows = await prisma.productColorImage.findMany({
      where: {
        productId: group.productId,
        colorId: group.colorId,
        order: group.order,
      },
      orderBy: { id: "asc" },
      select: { id: true, path: true },
    });
    const [keep, ...rest] = rows;
    if (!keep || rest.length === 0) continue;
    const distinctPaths = new Set(rows.map((r) => r.path));
    if (distinctPaths.size > 1) {
      console.warn(
        `[dedupe] WARN paths divergents pour (product=${group.productId}, color=${group.colorId}, order=${group.order}) — on garde id=${keep.id} (${keep.path})`,
      );
    }
    const result = await prisma.productColorImage.deleteMany({
      where: { id: { in: rest.map((r) => r.id) } },
    });
    duplicatesDeleted += result.count;
  }

  const nullified = await prisma.productColorImage.updateMany({
    where: { productColorId: { not: null } },
    data: { productColorId: null },
  });

  const duration = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[dedupe-product-color-images] done in ${duration}s`);
  console.log(`  groupes en doublon traités : ${groups.length}`);
  console.log(`  lignes supprimées : ${duplicatesDeleted}`);
  console.log(`  productColorId mis à NULL sur les survivantes : ${nullified.count}`);
}

main()
  .catch((err) => {
    console.error("[dedupe-product-color-images] FAILED", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
