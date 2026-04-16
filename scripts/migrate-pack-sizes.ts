/**
 * Migration script: copy shared VariantSize records to per-line PackColorLineSize
 * for existing PACK variants.
 *
 * Usage: npx tsx scripts/migrate-pack-sizes.ts
 *
 * Safe to re-run: skips variants that already have PackColorLineSize records.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find all PACK variants that have VariantSize but no PackColorLineSize
  const packVariants = await prisma.productColor.findMany({
    where: { saleType: "PACK" },
    include: {
      variantSizes: { include: { size: true } },
      packColorLines: {
        orderBy: { position: "asc" },
        include: {
          sizes: true,
          colors: { include: { color: true } },
        },
      },
    },
  });

  let migrated = 0;
  let skipped = 0;

  for (const variant of packVariants) {
    // Skip if already has per-line sizes
    const hasPerLineSizes = variant.packColorLines.some((pcl) => pcl.sizes.length > 0);
    if (hasPerLineSizes) {
      skipped++;
      continue;
    }

    // Skip if no shared VariantSize to migrate
    if (variant.variantSizes.length === 0) {
      skipped++;
      continue;
    }

    // Skip if no PackColorLines exist
    if (variant.packColorLines.length === 0) {
      skipped++;
      continue;
    }

    // Copy shared VariantSize to each PackColorLine as PackColorLineSize
    for (const pcl of variant.packColorLines) {
      await prisma.packColorLineSize.createMany({
        data: variant.variantSizes.map((vs) => ({
          packColorLineId: pcl.id,
          sizeId: vs.sizeId,
          quantity: vs.quantity,
        })),
        skipDuplicates: true,
      });
    }

    const colorNames = variant.packColorLines
      .map((pcl) => pcl.colors[0]?.color.name || "?")
      .join(", ");
    const sizeNames = variant.variantSizes
      .map((vs) => `${vs.size.name} x${vs.quantity}`)
      .join(", ");

    console.log(
      `Migrated variant ${variant.id} (${colorNames}): ${sizeNames} -> ${variant.packColorLines.length} line(s)`
    );
    migrated++;
  }

  console.log(`\nDone: ${migrated} migrated, ${skipped} skipped (already migrated or no data).`);
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
