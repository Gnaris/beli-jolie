/**
 * Backfill SKUs for all existing ProductColor variants.
 * Usage: npx tsx scripts/generate-skus.ts
 *
 * Safe to run multiple times — only updates variants with missing or changed SKUs.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { generateSku } from "../lib/sku";

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      reference: true,
      colors: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sku: true,
          saleType: true,
          color: { select: { name: true } },
          subColors: {
            orderBy: { position: "asc" },
            select: { color: { select: { name: true } } },
          },
          packColorLines: {
            orderBy: { position: "asc" },
            take: 1,
            select: {
              colors: {
                orderBy: { position: "asc" },
                select: { color: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const product of products) {
    for (let i = 0; i < product.colors.length; i++) {
      const v = product.colors[i];

      let colorNames: string[];
      if (v.saleType === "UNIT") {
        colorNames = [
          v.color?.name,
          ...v.subColors.map((sc) => sc.color.name),
        ].filter(Boolean) as string[];
      } else {
        const line = v.packColorLines[0];
        colorNames = line ? line.colors.map((c) => c.color.name) : [];
      }

      const sku = generateSku(
        product.reference.trim().toUpperCase(),
        colorNames,
        v.saleType as "UNIT" | "PACK",
        i + 1
      );

      if (v.sku === sku) {
        skipped++;
        continue;
      }

      try {
        await prisma.productColor.update({
          where: { id: v.id },
          data: { sku },
        });
        updated++;
        if (updated <= 10) {
          console.log(`  ${sku}`);
        }
      } catch (err) {
        errors++;
        console.error(`  Error on variant ${v.id}: ${err}`);
      }
    }
  }

  console.log(
    `\nDone. ${updated} updated, ${skipped} already up-to-date, ${errors} errors.`
  );
  console.log(`Total products: ${products.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
