/**
 * Script de migration : copie ProductColor.isPrimary → Product.primaryColorId.
 *
 * À exécuter une seule fois après l'ajout du champ Product.primaryColorId
 * (Phase A de la refonte couleurs au niveau produit).
 *
 * Idempotent : un 2ᵉ run ne fait rien sur les produits déjà migrés.
 *
 * Usage : npx tsx scripts/migrate-product-primary-color.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const startedAt = Date.now();
  console.log("[migrate-product-primary-color] start");

  const products = await prisma.product.findMany({
    where: { primaryColorId: null },
    select: {
      id: true,
      reference: true,
      colors: {
        select: { colorId: true, isPrimary: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  let updated = 0;
  let leftNull = 0;

  for (const product of products) {
    const primaryVariant = product.colors.find((c) => c.isPrimary && c.colorId);
    const fallbackColorId = primaryVariant?.colorId
      ?? product.colors.find((c) => c.colorId)?.colorId
      ?? null;

    if (!fallbackColorId) {
      leftNull++;
      continue;
    }

    await prisma.product.update({
      where: { id: product.id },
      data: { primaryColorId: fallbackColorId },
    });
    updated++;
  }

  const duration = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[migrate-product-primary-color] done in ${duration}s`);
  console.log(`  produits scannés : ${products.length}`);
  console.log(`  primaryColorId écrit : ${updated}`);
  console.log(`  laissés à null (aucune couleur disponible) : ${leftNull}`);
}

main()
  .catch((err) => {
    console.error("[migrate-product-primary-color] FAILED", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
