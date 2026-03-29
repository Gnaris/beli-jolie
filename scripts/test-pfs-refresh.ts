/**
 * Test script for PFS Refresh feature
 * Usage: npx tsx scripts/test-pfs-refresh.ts
 *
 * Tests with reference TESTAPI01
 */

import { prisma } from "@/lib/prisma";
import { pfsRefreshProduct } from "@/lib/pfs-refresh";

async function main() {
  console.log("=== PFS Refresh Test ===\n");

  // Find product with reference TESTAPI01
  const product = await prisma.product.findFirst({
    where: { reference: "TESTAPI01" },
    select: {
      id: true,
      reference: true,
      name: true,
      pfsProductId: true,
      pfsSyncStatus: true,
      status: true,
      createdAt: true,
      colors: {
        select: {
          id: true,
          saleType: true,
          color: { select: { name: true, pfsColorRef: true } },
          images: { select: { path: true, order: true } },
        },
      },
    },
  });

  if (!product) {
    console.error("Product with reference TESTAPI01 not found in database.");
    console.log("\nListing available products with PFS sync:");
    const products = await prisma.product.findMany({
      where: { pfsProductId: { not: null } },
      select: { reference: true, name: true, pfsProductId: true },
      take: 10,
    });
    for (const p of products) {
      console.log(`  - ${p.reference}: ${p.name} (PFS: ${p.pfsProductId})`);
    }
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`Product found:`);
  console.log(`  Reference: ${product.reference}`);
  console.log(`  Name: ${product.name}`);
  console.log(`  PFS ID: ${product.pfsProductId}`);
  console.log(`  Status: ${product.status}`);
  console.log(`  Sync Status: ${product.pfsSyncStatus}`);
  console.log(`  Created At: ${product.createdAt}`);
  console.log(`  Variants: ${product.colors.length}`);
  for (const v of product.colors) {
    console.log(`    - ${v.saleType} | ${v.color?.name ?? "PACK"} (pfsRef: ${v.color?.pfsColorRef ?? "N/A"}) | ${v.images.length} images`);
  }

  console.log("\n--- Starting PFS Refresh ---\n");

  const result = await pfsRefreshProduct(product.id, (progress) => {
    const statusIcon = progress.status === "success" ? "OK" : progress.status === "error" ? "ERR" : "...";
    console.log(`[${statusIcon}] ${progress.step}${progress.error ? ` — ${progress.error}` : ""}`);
  });

  console.log("\n--- Result ---");
  console.log(JSON.stringify(result, null, 2));

  // Verify DB update
  if (result.success) {
    const updated = await prisma.product.findUnique({
      where: { id: product.id },
      select: { pfsProductId: true, createdAt: true, pfsSyncStatus: true },
    });
    console.log("\nDB after refresh:");
    console.log(`  New PFS ID: ${updated?.pfsProductId}`);
    console.log(`  New createdAt: ${updated?.createdAt}`);
    console.log(`  Sync Status: ${updated?.pfsSyncStatus}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  prisma.$disconnect();
  process.exit(1);
});
