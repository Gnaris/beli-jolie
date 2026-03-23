"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidateTag } from "next/cache";
import { emitProductEvent } from "@/lib/product-events";

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
  size: string | null;
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
  variants: PfsVariantData[];
  compositions: PfsCompositionData[];
}

// ─────────────────────────────────────────────
// Apply live PFS sync selections to a product
// ─────────────────────────────────────────────

export async function applyPfsLiveSync(
  productId: string,
  selections: LiveSyncSelections,
  pfsData: PfsData,
): Promise<{ success: boolean; error?: string; changesApplied: number }> {
  await requireAdmin();

  let changesApplied = 0;

  try {
    // 1. Update basic fields (name, description, category)
    const updateData: Record<string, unknown> = {};

    if (selections.name === "pfs" && pfsData.name) {
      updateData.name = pfsData.name;
      changesApplied++;
    }
    if (selections.description === "pfs" && pfsData.description) {
      updateData.description = pfsData.description;
      changesApplied++;
    }
    if (selections.category === "pfs" && pfsData.categoryId) {
      updateData.categoryId = pfsData.categoryId;
      changesApplied++;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.product.update({
        where: { id: productId },
        data: updateData,
      });
    }

    // 2. Update compositions if PFS selected
    if (selections.compositions === "pfs" && pfsData.compositions.length > 0) {
      // Delete existing compositions
      await prisma.productComposition.deleteMany({
        where: { productId },
      });
      // Create new compositions
      await prisma.productComposition.createMany({
        data: pfsData.compositions.map((c) => ({
          productId,
          compositionId: c.compositionId,
          percentage: c.percentage,
        })),
      });
      changesApplied++;
    }

    // 3. Update variants based on selections
    for (const [key, action] of Object.entries(selections.variants)) {
      if (action === "bj") continue; // Keep BJ variant, no changes

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
        // Update existing BJ variant with PFS values
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
        // Add new variant from PFS
        await prisma.productColor.create({
          data: {
            productId,
            colorId: pfsVariant.colorId,
            unitPrice: pfsVariant.unitPrice,
            weight: pfsVariant.weight,
            stock: pfsVariant.stock,
            saleType: pfsVariant.saleType,
            packQuantity: pfsVariant.packQuantity,
            size: pfsVariant.size,
            isPrimary: false,
            discountType: pfsVariant.discountType,
            discountValue: pfsVariant.discountValue,
          },
        });
        changesApplied++;
      }
    }

    // 4. Revalidate caches
    revalidateTag("products", "default");

    // 5. Emit product update event for live updates
    emitProductEvent({
      type: "PRODUCT_UPDATED",
      productId,
    });

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
