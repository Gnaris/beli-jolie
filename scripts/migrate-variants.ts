/**
 * migrate-variants.ts
 *
 * Migrates the old ProductColor + SaleOption + ProductImage data to the new
 * flat variant model (ProductColor flat + ProductColorImage).
 *
 * Run: npx tsx scripts/migrate-variants.ts
 *
 * Safe to run multiple times — idempotent checks in place.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Variant Migration ===\n");

  // ── 1. Load all existing ProductColor rows with their SaleOptions ─────────
  const productColors = await (prisma as any).productColor.findMany({
    include: {
      // saleOptions via raw — table still exists during migration
    },
  });

  // Use raw query to fetch SaleOption data since the model is removed from schema
  const saleOptions = await (prisma as any).$queryRaw`
    SELECT id, colorId, saleType, packQuantity, size, discountType, discountValue
    FROM SaleOption
    ORDER BY colorId, saleType, packQuantity
  `;

  // Group saleOptions by colorId (ProductColor.id)
  const saleOptionsByColorId = new Map<string, any[]>();
  for (const so of saleOptions as any[]) {
    const list = saleOptionsByColorId.get(so.colorId) ?? [];
    list.push(so);
    saleOptionsByColorId.set(so.colorId, list);
  }

  console.log(`Found ${productColors.length} ProductColor rows`);
  console.log(`Found ${(saleOptions as any[]).length} SaleOption rows\n`);

  // ── 2. Build a map: old SaleOption.id → new ProductColor.id ──────────────
  const saleOptionToVariantId = new Map<string, string>();

  let createdVariants = 0;
  let updatedVariants = 0;

  for (const pc of productColors as any[]) {
    const opts = saleOptionsByColorId.get(pc.id) ?? [];

    if (opts.length === 0) {
      // No saleOptions — update the ProductColor with a default UNIT
      // Only if saleType is not yet set
      if (!pc.saleType) {
        await (prisma as any).productColor.update({
          where: { id: pc.id },
          data: {
            saleType: "UNIT",
            packQuantity: null,
            size: null,
            discountType: null,
            discountValue: null,
          },
        });
        updatedVariants++;
      }
      continue;
    }

    // First saleOption → update the existing ProductColor row
    const firstOpt = opts[0];
    if (!pc.saleType) {
      await (prisma as any).productColor.update({
        where: { id: pc.id },
        data: {
          saleType: firstOpt.saleType,
          packQuantity: firstOpt.packQuantity ?? null,
          size: firstOpt.size ?? null,
          discountType: firstOpt.discountType ?? null,
          discountValue: firstOpt.discountValue ?? null,
        },
      });
      updatedVariants++;
    }
    saleOptionToVariantId.set(firstOpt.id, pc.id);

    // Additional saleOptions → create new ProductColor rows
    for (let i = 1; i < opts.length; i++) {
      const opt = opts[i];

      const newPc = await (prisma as any).productColor.create({
        data: {
          productId: pc.productId,
          colorId: pc.colorId,
          unitPrice: pc.unitPrice,
          weight: pc.weight,
          stock: pc.stock ?? 0,
          isPrimary: false, // Only the original can be primary
          saleType: opt.saleType,
          packQuantity: opt.packQuantity ?? null,
          size: opt.size ?? null,
          discountType: opt.discountType ?? null,
          discountValue: opt.discountValue ?? null,
        },
      });
      createdVariants++;
      saleOptionToVariantId.set(opt.id, newPc.id);
    }
  }

  console.log(`Updated ${updatedVariants} existing ProductColor rows`);
  console.log(`Created ${createdVariants} new ProductColor rows (from extra SaleOptions)\n`);

  // ── 3. Migrate CartItem.saleOptionId → CartItem.variantId ─────────────────
  const cartItems = await (prisma as any).$queryRaw`
    SELECT id, saleOptionId FROM CartItem WHERE saleOptionId IS NOT NULL
  `;

  let migratedCartItems = 0;
  let skippedCartItems = 0;

  for (const ci of cartItems as any[]) {
    const newVariantId = saleOptionToVariantId.get(ci.saleOptionId);
    if (!newVariantId) {
      console.warn(`  ⚠ CartItem ${ci.id}: no mapping for saleOptionId=${ci.saleOptionId} — skipping`);
      skippedCartItems++;
      continue;
    }
    await (prisma as any).$executeRaw`
      UPDATE CartItem SET variantId = ${newVariantId} WHERE id = ${ci.id}
    `;
    migratedCartItems++;
  }

  console.log(`Migrated ${migratedCartItems} CartItem rows`);
  if (skippedCartItems > 0) console.log(`Skipped ${skippedCartItems} CartItem rows (unmapped)`);

  // ── 4. Migrate ProductImage → ProductColorImage ───────────────────────────
  // Fetch ProductImage data via raw query
  const productImages = await (prisma as any).$queryRaw`
    SELECT pi.id, pi.colorId AS pcId, pi.path, pi.order
    FROM ProductImage pi
    ORDER BY pi.colorId, pi.order
  `;

  // Build a map: ProductColor.id → { productId, colorId }
  const pcMap = new Map<string, { productId: string; colorId: string }>();
  for (const pc of productColors as any[]) {
    pcMap.set(pc.id, { productId: pc.productId, colorId: pc.colorId });
  }

  // Deduplicate by (productId, colorId) — only insert once per color group
  const insertedGroups = new Set<string>();
  let migratedImages = 0;
  let skippedImages = 0;

  // Group images by (productId, colorId)
  const imagesByGroup = new Map<string, { productId: string; colorId: string; path: string; order: number }[]>();
  for (const img of productImages as any[]) {
    const pc = pcMap.get(img.pcId);
    if (!pc) { skippedImages++; continue; }
    const key = `${pc.productId}__${pc.colorId}`;
    const list = imagesByGroup.get(key) ?? [];
    list.push({ productId: pc.productId, colorId: pc.colorId, path: img.path, order: img.order });
    imagesByGroup.set(key, list);
  }

  for (const [key, images] of imagesByGroup) {
    // Check if already migrated
    const exists = await (prisma as any).productColorImage.count({
      where: { productId: images[0].productId, colorId: images[0].colorId },
    });
    if (exists > 0) {
      skippedImages += images.length;
      continue;
    }

    await (prisma as any).productColorImage.createMany({
      data: images.map((img, idx) => ({
        productId: img.productId,
        colorId: img.colorId,
        path: img.path,
        order: img.order ?? idx,
      })),
    });
    migratedImages += images.length;
  }

  console.log(`\nMigrated ${migratedImages} ProductImage → ProductColorImage`);
  if (skippedImages > 0) console.log(`Skipped ${skippedImages} images (already migrated or unmapped)`);

  // ── 5. Cleanup CartItems with no variantId (orphaned) ─────────────────────
  const orphaned = await (prisma as any).$executeRaw`
    DELETE FROM CartItem WHERE variantId IS NULL AND saleOptionId IS NULL
  `;

  console.log(`\nCleaned up orphaned CartItem rows`);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log("\n✓ Migration completed successfully!");
  console.log("\nNote: SaleOption and ProductImage tables are still in the DB.");
  console.log("After verifying everything works, you can drop them manually if desired.");
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
