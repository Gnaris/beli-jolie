"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidateTag } from "next/cache";
import { emitProductEvent } from "@/lib/product-events";
import { syncProductToPfs, stripDimensionsSuffix } from "@/lib/pfs-reverse-sync";
import { processProductImage, getImagePaths } from "@/lib/image-processor";
import { downloadImage } from "@/lib/pfs-sync";
import { unlink, readFile } from "fs/promises";
import path from "path";

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

      // Find matching PFS variant — prefer exact match by colorId + saleType + sizeName
      const pfsVariant = pfsData.variants.find(
        (v) => v.colorId === colorId && v.saleType === saleType
      );
      if (!pfsVariant || !pfsVariant.colorId) continue;

      if (action === "pfs") {
        // For PACK variants, colorId is null in DB — match by packColorLine colors + size
        let existingVariant;
        if (saleType === "PACK") {
          const candidates = await prisma.productColor.findMany({
            where: {
              productId,
              saleType: "PACK",
              ...(colorId ? { packColorLines: { some: { colors: { some: { colorId } } } } } : {}),
            },
            include: { variantSizes: { select: { size: { select: { name: true } } } } },
          });
          // Disambiguate by matching size name if available
          existingVariant = pfsVariant.sizeName
            ? candidates.find(c => c.variantSizes.some(vs => vs.size.name === pfsVariant.sizeName)) ?? candidates[0]
            : candidates[0];
        } else {
          existingVariant = await prisma.productColor.findFirst({
            where: { productId, colorId, saleType },
          });
        }

        if (existingVariant) {
          // For PACK variants, BJ stores total pack price (unitPrice × totalQty),
          // but PFS sends per-unit price. Convert accordingly.
          let priceForDb = pfsVariant.unitPrice;
          if (saleType === "PACK") {
            const existingWithSizes = await prisma.productColor.findUnique({
              where: { id: existingVariant.id },
              select: { variantSizes: { select: { quantity: true } }, packQuantity: true },
            });
            const totalQty = existingWithSizes?.variantSizes.reduce((sum, vs) => sum + vs.quantity, 0)
              || existingWithSizes?.packQuantity || pfsVariant.packQuantity || 1;
            priceForDb = Math.round(pfsVariant.unitPrice * totalQty * 100) / 100;
          }

          await prisma.productColor.update({
            where: { id: existingVariant.id },
            data: {
              unitPrice: priceForDb,
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
        // Block import if color is not mapped to a BJ color
        if (!pfsVariant.colorId) {
          console.warn(`[PFS_LIVE_SYNC] Skipping add for unmapped color "${pfsVariant.colorName}"`);
          continue;
        }

        // For new PACK variants, BJ stores total pack price (unitPrice × packQty)
        const addPrice = saleType === "PACK"
          ? Math.round(pfsVariant.unitPrice * (pfsVariant.packQuantity || 1) * 100) / 100
          : pfsVariant.unitPrice;

        const createdVariant = await prisma.productColor.create({
          data: {
            productId,
            // PACK variants store colorId as null; colors are in packColorLines
            colorId: saleType === "PACK" ? null : pfsVariant.colorId,
            unitPrice: addPrice,
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
            data: { productColorId: createdVariant.id, sizeId: sizeRecord.id, quantity: pfsVariant.packQuantity ?? 1 },
          });
        }

        // PACK: create PackColorLine with the resolved BJ color
        if (saleType === "PACK" && pfsVariant.colorId) {
          const line = await prisma.packColorLine.create({
            data: { productColorId: createdVariant.id, position: 0 },
          });
          await prisma.packColorLineColor.create({
            data: { packColorLineId: line.id, colorId: pfsVariant.colorId, position: 0 },
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

// ─────────────────────────────────────────────
// Apply image changes from live compare drag-and-drop
// Receives the final desired state of BJ image slots
// and reconciles with current DB state.
// ─────────────────────────────────────────────

interface BjColorImageState {
  colorId: string;
  slots: Array<string | null>; // path (local) or PFS URL, null = empty
}

/** Delete the 3 WebP files (large, medium, thumb) from disk. */
async function deleteImageFiles(dbPath: string) {
  if (!dbPath || !dbPath.endsWith(".webp")) return;
  const paths = getImagePaths(dbPath);
  const root = process.cwd();
  for (const p of [paths.large, paths.medium, paths.thumb]) {
    try {
      await unlink(path.join(root, "public", p));
    } catch {
      // File may not exist — ignore
    }
  }
}

export async function applyLiveImageChanges(
  productId: string,
  bjFinalState: BjColorImageState[],
): Promise<{ success: boolean; applied: number; error?: string }> {
  await requireAdmin();

  const ALLOWED_DOMAINS = ["static.parisfashionshops.com"];
  let applied = 0;

  console.log(`[IMG_SYNC] Start for product ${productId}, ${bjFinalState.length} color groups`);
  for (const g of bjFinalState) {
    console.log(`[IMG_SYNC]   colorId=${g.colorId} slots=[${g.slots.map(s => s ? (s.startsWith("http") ? "PFS_URL" : s.split("/").pop()) : "null").join(", ")}]`);
  }

  try {
    // 1. Load all current images for this product
    const currentImages = await prisma.productColorImage.findMany({
      where: { productId },
      orderBy: { order: "asc" },
    });

    console.log(`[IMG_SYNC] Current DB images: ${currentImages.length}`);
    for (const img of currentImages) {
      console.log(`[IMG_SYNC]   id=${img.id} colorId=${img.colorId} order=${img.order} path=${img.path.split("/").pop()}`);
    }

    // Build lookup: path → image record
    const pathToImage = new Map<string, typeof currentImages[0]>();
    for (const img of currentImages) {
      pathToImage.set(img.path, img);
    }

    // Track which existing image IDs are still used in the final state
    const usedImageIds = new Set<string>();

    // 2. Process each BJ color group's final state
    for (const group of bjFinalState) {
      const { colorId, slots } = group;
      if (!colorId) continue;

      // Find a ProductColor for this colorId — check direct colorId first, then packColorLines
      let variant = await prisma.productColor.findFirst({
        where: { productId, colorId },
      });
      // PACK variants have colorId=null, colors are in packColorLines
      if (!variant) {
        variant = await prisma.productColor.findFirst({
          where: {
            productId,
            saleType: "PACK",
            packColorLines: { some: { colors: { some: { colorId } } } },
          },
        });
      }
      console.log(`[IMG_SYNC] Processing colorId=${colorId} variant=${variant?.id ?? "NONE"}`);

      for (let position = 0; position < slots.length; position++) {
        const slotPath = slots[position];
        if (!slotPath) continue;

        const isExternal = slotPath.startsWith("http");

        if (!isExternal) {
          // Local BJ image — find existing record by path
          const existingImg = pathToImage.get(slotPath);
          if (existingImg && !usedImageIds.has(existingImg.id)) {
            // First occurrence — update existing record
            usedImageIds.add(existingImg.id);
            const needsUpdate =
              existingImg.colorId !== colorId ||
              existingImg.order !== position ||
              (variant && existingImg.productColorId !== variant.id);
            if (needsUpdate) {
              console.log(`[IMG_SYNC]   UPDATE slot ${position}: ${existingImg.id} colorId ${existingImg.colorId}->${colorId} order ${existingImg.order}->${position}`);
              await prisma.productColorImage.update({
                where: { id: existingImg.id },
                data: {
                  colorId,
                  productColorId: variant?.id ?? existingImg.productColorId,
                  order: position,
                },
              });
              applied++;
            } else {
              console.log(`[IMG_SYNC]   OK slot ${position}: ${existingImg.id} (no change)`);
            }
          } else if (existingImg) {
            // Duplicate reference — image was copied to another color group
            // Read the original large file and create a new copy
            console.log(`[IMG_SYNC]   COPY slot ${position}: duplicating ${slotPath.split("/").pop()} for colorId=${colorId}`);
            try {
              const largePath = path.join(process.cwd(), "public", slotPath);
              const buffer = await readFile(largePath);
              const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              const result = await processProductImage(buffer, "public/uploads/products", filename);
              await prisma.productColorImage.create({
                data: {
                  productId,
                  colorId,
                  productColorId: variant?.id ?? null,
                  path: result.dbPath,
                  order: position,
                },
              });
              console.log(`[IMG_SYNC]   COPIED slot ${position}: ${result.dbPath.split("/").pop()}`);
              applied++;
            } catch (copyErr) {
              console.error(`[IMG_SYNC]   COPY FAILED slot ${position}:`, copyErr);
            }
          } else {
            console.warn(`[IMG_SYNC]   SKIP slot ${position}: local path not found in DB: ${slotPath.split("/").pop()}`);
          }
        } else {
          // PFS URL — download and create new image
          try {
            const url = new URL(slotPath);
            if (!ALLOWED_DOMAINS.includes(url.hostname)) {
              console.warn(`[IMG_SYNC]   BLOCKED slot ${position}: domain ${url.hostname} not allowed`);
              continue;
            }
          } catch {
            console.warn(`[IMG_SYNC]   INVALID slot ${position}: bad URL ${slotPath.substring(0, 60)}`);
            continue;
          }

          console.log(`[IMG_SYNC]   DOWNLOAD slot ${position}: PFS URL ${slotPath.substring(0, 80)}`);
          const buffer = await downloadImage(slotPath, 2);
          const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const result = await processProductImage(
            buffer,
            "public/uploads/products",
            filename,
          );

          await prisma.productColorImage.create({
            data: {
              productId,
              colorId,
              productColorId: variant?.id ?? null,
              path: result.dbPath,
              order: position,
            },
          });
          console.log(`[IMG_SYNC]   CREATED slot ${position}: ${result.dbPath.split("/").pop()}`);
          applied++;
        }
      }
    }

    // 3. Delete images no longer present in any BJ slot
    for (const img of currentImages) {
      if (!usedImageIds.has(img.id)) {
        console.log(`[IMG_SYNC]   DELETE: ${img.id} path=${img.path.split("/").pop()} (not in any BJ slot)`);
        await deleteImageFiles(img.path);
        await prisma.productColorImage.delete({ where: { id: img.id } });
        applied++;
      }
    }

    if (applied > 0) {
      revalidateTag("products", "default");
    }

    console.log(`[IMG_SYNC] Done. ${applied} changes applied.`);
    return { success: true, applied };
  } catch (err) {
    console.error("[IMG_SYNC] ERROR:", err);
    return {
      success: false,
      applied,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
