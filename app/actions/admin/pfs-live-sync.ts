"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidateTag } from "next/cache";
import { emitProductEvent } from "@/lib/product-events";
import { syncProductToPfs, stripDimensionsSuffix } from "@/lib/pfs-reverse-sync";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface LiveSyncSelections {
  name: "bj" | "pfs";
  description: "bj" | "pfs";
  category: "bj" | "pfs";
  compositions: "bj" | "pfs";
  season?: "bj" | "pfs";
  manufacturingCountry?: "bj" | "pfs";
  variants: Record<string, "bj" | "pfs" | "add">;
}

interface PfsVariantData {
  colorId: string;
  colorName: string;
  unitPrice: number;
  weight: number;
  stock: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizeName: string | null;
  isPrimary: boolean;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}

interface PfsCompositionData {
  compositionId: string;
  name: string;
  percentage: number;
}

interface PfsData {
  name: string;
  description: string;
  categoryId: string;
  categoryName?: string;
  variants: PfsVariantData[];
  compositions: PfsCompositionData[];
  seasonId?: string | null;
  seasonName?: string | null;
  manufacturingCountryId?: string | null;
  manufacturingCountryName?: string | null;
}

interface BjData {
  name: string;
  description: string;
  categoryId: string;
  variants: PfsVariantData[];
  compositions: PfsCompositionData[];
  seasonId?: string | null;
  manufacturingCountryId?: string | null;
}

// ─────────────────────────────────────────────
// Apply bidirectional PFS sync selections
// "pfs" selections → update BJ product with PFS values
// "bj" selections → push BJ values to PFS (reverse sync)
// ─────────────────────────────────────────────

export async function applyPfsLiveSync(
  productId: string,
  selections: LiveSyncSelections,
  pfsData: PfsData,
  bjData: BjData,
): Promise<{ success: boolean; error?: string; changesApplied: number }> {
  await requireAdmin();

  let changesApplied = 0;
  let needsReverseSyncToPfs = false;

  try {
    // ── Step 1: Apply PFS → BJ changes (fields where user chose "pfs") ──

    const updateData: Record<string, unknown> = {};

    if (selections.name === "pfs" && pfsData.name) {
      updateData.name = pfsData.name;
      changesApplied++;
    }
    if (selections.description === "pfs" && pfsData.description) {
      updateData.description = stripDimensionsSuffix(pfsData.description);
      changesApplied++;
    }
    if (selections.category === "pfs") {
      let catId = pfsData.categoryId;
      // If categoryId is empty but we have a name, create the category
      if (!catId && pfsData.categoryName) {
        const { findOrCreateCategory } = await import("@/lib/pfs-sync");
        catId = await findOrCreateCategory(pfsData.categoryName) ?? "";
      }
      if (catId) {
        updateData.categoryId = catId;
        changesApplied++;
      }
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.product.update({
        where: { id: productId },
        data: updateData,
      });
    }

    // Update compositions if PFS selected
    if (selections.compositions === "pfs" && pfsData.compositions.length > 0) {
      await prisma.productComposition.deleteMany({
        where: { productId },
      });
      await prisma.productComposition.createMany({
        data: pfsData.compositions.map((c) => ({
          productId,
          compositionId: c.compositionId,
          percentage: c.percentage,
        })),
      });
      changesApplied++;
    }

    // Update season if PFS selected
    if (selections.season === "pfs" && pfsData.seasonId) {
      await prisma.product.update({
        where: { id: productId },
        data: { seasonId: pfsData.seasonId },
      });
      changesApplied++;
    } else if (selections.season === "bj") {
      needsReverseSyncToPfs = true;
    }

    // Update manufacturing country if PFS selected
    if (selections.manufacturingCountry === "pfs" && pfsData.manufacturingCountryId) {
      await prisma.product.update({
        where: { id: productId },
        data: { manufacturingCountryId: pfsData.manufacturingCountryId },
      });
      changesApplied++;
    } else if (selections.manufacturingCountry === "bj") {
      needsReverseSyncToPfs = true;
    }

    // Update variants based on selections
    for (const [key, action] of Object.entries(selections.variants)) {
      if (action === "bj") {
        // User chose BJ version → need to push to PFS
        needsReverseSyncToPfs = true;
        changesApplied++;
        continue;
      }

      // Parse the variant key: colorId::subNames::saleType
      const parts = key.split("::");
      const colorId = parts[0];
      const saleType = parts[parts.length - 1] as "UNIT" | "PACK";

      // Find matching PFS variant
      const pfsVariant = pfsData.variants.find(
        (v) => v.colorId === colorId && v.saleType === saleType
      );
      if (!pfsVariant) continue;

      if (action === "pfs") {
        const existingVariant = await prisma.productColor.findFirst({
          where: { productId, colorId, saleType },
        });

        if (existingVariant) {
          await prisma.productColor.update({
            where: { id: existingVariant.id },
            data: {
              unitPrice: pfsVariant.unitPrice,
              weight: pfsVariant.weight,
              stock: pfsVariant.stock,
              packQuantity: pfsVariant.packQuantity,
              discountType: pfsVariant.discountType,
              discountValue: pfsVariant.discountValue,
            },
          });
          changesApplied++;
        }
      } else if (action === "add") {
        const createdVariant = await prisma.productColor.create({
          data: {
            productId,
            colorId: pfsVariant.colorId,
            unitPrice: pfsVariant.unitPrice,
            weight: pfsVariant.weight,
            stock: pfsVariant.stock,
            saleType: pfsVariant.saleType,
            packQuantity: pfsVariant.packQuantity,
            isPrimary: false,
            discountType: pfsVariant.discountType,
            discountValue: pfsVariant.discountValue,
          },
        });

        // Create VariantSize record if PFS provided a size
        if (pfsVariant.sizeName) {
          const sizeRecord = await prisma.size.upsert({
            where: { name: pfsVariant.sizeName },
            create: { name: pfsVariant.sizeName },
            update: {},
          });
          await prisma.variantSize.create({
            data: { productColorId: createdVariant.id, sizeId: sizeRecord.id, quantity: 1 },
          });
        }

        changesApplied++;
      }
    }

    // ── Step 2: Check if any "bj" selection on different fields requires reverse sync ──

    // Check basic fields: if user chose "bj" and the values differ, we need reverse sync
    if (selections.name === "bj" && bjData.name !== pfsData.name) {
      needsReverseSyncToPfs = true;
    }
    if (selections.description === "bj" && bjData.description !== pfsData.description) {
      needsReverseSyncToPfs = true;
    }
    if (selections.category === "bj" && bjData.categoryId !== pfsData.categoryId) {
      needsReverseSyncToPfs = true;
    }
    if (selections.compositions === "bj" && JSON.stringify(bjData.compositions) !== JSON.stringify(pfsData.compositions)) {
      needsReverseSyncToPfs = true;
    }

    // Count BJ-selected fields that differ as changes too
    if (needsReverseSyncToPfs && changesApplied === 0) {
      changesApplied = 1; // At least 1 change (pushing to PFS)
    }

    // ── Step 3: Revalidate caches ──
    revalidateTag("products", "default");

    // ── Step 4: Emit product update event ──
    emitProductEvent({
      type: "PRODUCT_UPDATED",
      productId,
    });

    // ── Step 5: If any BJ selections on differing fields, push to PFS ──
    // After applying PFS→BJ changes, the product now has:
    // - PFS values for "pfs" selections (just updated above)
    // - BJ values for "bj" selections (unchanged)
    // syncProductToPfs will push the CURRENT state → PFS gets BJ values for "bj" fields
    if (needsReverseSyncToPfs) {
      try {
        await syncProductToPfs(productId);
      } catch (err) {
        console.error("[PFS_LIVE_SYNC] Reverse sync error (non-blocking):", err);
        // Non-blocking: BJ changes are already applied, PFS push failed
        // pfsSyncStatus will be set to "failed" by syncProductToPfs
      }
    }

    return { success: true, changesApplied };
  } catch (err) {
    console.error("[PFS_LIVE_SYNC] Error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      changesApplied,
    };
  }
}
