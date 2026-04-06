/**
 * PFS Refresh — Duplicate a product on PFS to make it appear as "new"
 *
 * Flow:
 * 1. Find a free TEMP reference on PFS (TEMP01, TEMP02...)
 * 2. Create new product on PFS with TEMP ref + copy all metadata
 * 3. Create all variants on new product
 * 4. Upload all images from local disk to new product
 * 5. Find a free DELETE reference (DELETE01, DELETE02...)
 * 6. Rename old product ref → DELETEXX + set status DELETED
 * 7. Rename new product ref → real reference
 * 8. Set new product to READY_FOR_SALE
 * 9. Update local DB: pfsProductId → new, createdAt → now
 *
 * On failure after product creation: rename new product to DELETEXX, leave old intact.
 */

import { prisma } from "@/lib/prisma";
import { pfsCheckReference } from "@/lib/pfs-api";
import {
  pfsCreateProduct,
  pfsUpdateProduct,
  pfsCreateVariants,
  pfsPatchVariants,
  pfsUploadImage,
  pfsUpdateStatus,
  pfsTranslate,
  type PfsProductCreateData,
  type PfsVariantCreateData,
  type PfsVariantUpdateData,
} from "@/lib/pfs-api-write";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PfsRefreshProgress {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

type ProgressCallback = (progress: PfsRefreshProgress) => void;

// ─────────────────────────────────────────────
// Unique reference generation
// ─────────────────────────────────────────────

function generateRandomRef(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let ref = "";
  for (let i = 0; i < 10; i++) {
    ref += chars[Math.floor(Math.random() * chars.length)];
  }
  return ref;
}

function generateUniqueRef(_prefix: string): string {
  return generateRandomRef();
}

function generateTempRef(): string {
  return generateUniqueRef("TMP");
}

function generateDeleteRef(): string {
  return generateUniqueRef("DEL");
}

// ─────────────────────────────────────────────
// Image conversion (same as pfs-reverse-sync)
// ─────────────────────────────────────────────

async function convertToJpeg(imagePath: string): Promise<Buffer> {
  // imagePath is like "/uploads/products/abc.webp" — download from R2
  const { downloadFromR2, r2KeyFromDbPath } = await import("@/lib/r2");
  const buffer = await downloadFromR2(r2KeyFromDbPath(imagePath));
  return sharp(buffer).jpeg({ quality: 100, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
}

// ─────────────────────────────────────────────
// Get effective PFS color reference for a variant
// ─────────────────────────────────────────────

function getEffectiveColorRef(variant: FullVariant): string | null {
  return variant.pfsColorRef || variant.color?.pfsColorRef || null;
}

function getPfsUnitPrice(variant: FullVariant): number {
  const price = Number(variant.unitPrice);
  if (variant.saleType !== "PACK") return price;
  const totalQty = variant.variantSizes.reduce((sum, vs) => sum + vs.quantity, 0) || variant.packQuantity || 1;
  return Math.round((price / totalQty) * 100) / 100;
}

const getSizeRef = (vs: { size: { name: string; pfsMappings: { pfsSizeRef: string }[] } }) =>
  vs.size.pfsMappings[0]?.pfsSizeRef || vs.size.name || "TU";

// ─────────────────────────────────────────────
// Full product type (mirrors pfs-reverse-sync)
// ─────────────────────────────────────────────

interface FullVariant {
  id: string;
  colorId: string | null;
  pfsColorRef: string | null;
  pfsVariantId: string | null;
  unitPrice: number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  variantSizes: { size: { name: string; pfsMappings: { pfsSizeRef: string }[] }; quantity: number }[];
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
  color: { id: string; name: string; pfsColorRef: string | null };
  subColors: { color: { id: string; name: string; pfsColorRef: string | null }; position: number }[];
  packColorLines: {
    position: number;
    colors: { color: { id: string; name: string; pfsColorRef: string | null }; position: number }[];
  }[];
  images: { id: string; path: string; order: number }[];
}

interface FullProduct {
  id: string;
  reference: string;
  pfsProductId: string | null;
  name: string;
  description: string;
  status: string;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
  category: { id: string; name: string; pfsCategoryId: string | null; pfsGender: string | null; pfsFamilyId: string | null };
  colors: FullVariant[];
  compositions: {
    compositionId: string;
    percentage: number;
    composition: { id: string; name: string; pfsCompositionRef: string | null };
  }[];
  manufacturingCountry: { id: string; name: string; isoCode: string | null; pfsCountryRef: string | null } | null;
  season: { id: string; name: string; pfsRef: string | null } | null;
}

const PFS_DEFAULTS = {
  gender: "WOMAN",
  gender_label: "Femme",
  brand_name: "Ma Boutique",
  family: "a035J00000185J7QAI",
  season_name: "PE2026",
  country_of_manufacture: "CN",
};

async function loadProductFull(productId: string): Promise<FullProduct | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      pfsProductId: true,
      name: true,
      description: true,
      status: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
      category: { select: { id: true, name: true, pfsCategoryId: true, pfsGender: true, pfsFamilyId: true } },
      colors: {
        select: {
          id: true,
          colorId: true,
          pfsColorRef: true,
          pfsVariantId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          variantSizes: { select: { size: { select: { name: true, pfsMappings: { select: { pfsSizeRef: true } } } }, quantity: true } },
          discountType: true,
          discountValue: true,
          color: { select: { id: true, name: true, pfsColorRef: true } },
          subColors: {
            select: { color: { select: { id: true, name: true, pfsColorRef: true } }, position: true },
            orderBy: { position: "asc" as const },
          },
          packColorLines: {
            select: {
              position: true,
              colors: {
                select: { color: { select: { id: true, name: true, pfsColorRef: true } }, position: true },
                orderBy: { position: "asc" as const },
              },
            },
            orderBy: { position: "asc" as const },
          },
          images: {
            select: { id: true, path: true, order: true },
            orderBy: { order: "asc" as const },
          },
        },
        orderBy: { createdAt: "asc" as const },
      },
      compositions: {
        select: { compositionId: true, percentage: true, composition: { select: { id: true, name: true, pfsCompositionRef: true } } },
      },
      manufacturingCountry: { select: { id: true, name: true, isoCode: true, pfsCountryRef: true } },
      season: { select: { id: true, name: true, pfsRef: true } },
    },
  }) as unknown as FullProduct | null;
}

// ─────────────────────────────────────────────
// Dimension helpers (same as pfs-reverse-sync)
// ─────────────────────────────────────────────

function buildDimensionsSuffix(product: Pick<FullProduct, "dimensionLength" | "dimensionWidth" | "dimensionHeight" | "dimensionDiameter" | "dimensionCircumference">): string {
  const parts: string[] = [];
  if (product.dimensionLength != null) parts.push(`Longueur : ${product.dimensionLength}mm`);
  if (product.dimensionWidth != null) parts.push(`Largeur : ${product.dimensionWidth}mm`);
  if (product.dimensionHeight != null) parts.push(`Hauteur : ${product.dimensionHeight}mm`);
  if (product.dimensionDiameter != null) parts.push(`Diamètre : ${product.dimensionDiameter}mm`);
  if (product.dimensionCircumference != null) parts.push(`Circonférence : ${product.dimensionCircumference}mm`);
  if (parts.length === 0) return "";
  return `\n\nDimensions : ${parts.join(" / ")}`;
}

// ─────────────────────────────────────────────
// Core refresh logic
// ─────────────────────────────────────────────

export async function pfsRefreshProduct(
  productId: string,
  onProgress?: ProgressCallback,
): Promise<{ success: boolean; error?: string; newPfsProductId?: string }> {
  const product = await loadProductFull(productId);
  if (!product) return { success: false, error: "Produit introuvable" };
  if (!product.pfsProductId) return { success: false, error: "Produit non synchronisé avec PFS" };

  const oldPfsProductId = product.pfsProductId;
  let newPfsProductId: string | null = null;
  let oldProductRenamed = false;

  const progress: PfsRefreshProgress = {
    productId,
    productName: product.name,
    reference: product.reference,
    status: "in_progress",
  };

  const report = (step: string) => {
    progress.step = step;
    onProgress?.(progress);
  };

  try {
    // ── Step 0: Fetch existing PFS product data (to copy brand, gender, etc.) ──
    report("Récupération des données PFS existantes...");
    const existingPfsData = await pfsCheckReference(product.reference).catch(() => null);
    const existingBrand = existingPfsData?.product?.brand?.name;
    const existingGender = existingPfsData?.product?.gender?.reference;
    const existingFamily = existingPfsData?.product?.family?.id;

    // ── Step 1: Generate unique TEMP reference ──
    const tempRef = generateTempRef();
    logger.info(`[PFS Refresh] Using temp reference: ${tempRef}`);

    // ── Step 2: Create new product on PFS with TEMP reference ──
    report(`Création produit PFS (${tempRef})...`);
    const descriptionWithDims = product.description + buildDimensionsSuffix(product);
    const translated = await pfsTranslate(product.name, descriptionWithDims);

    const mainComposition = product.compositions[0]?.composition.pfsCompositionRef ?? "ACIERINOXYDABLE";
    // Prefer values from existing PFS product, then local DB, then defaults
    const gender = existingGender || product.category.pfsGender || PFS_DEFAULTS.gender;
    const family = existingFamily || product.category.pfsFamilyId || PFS_DEFAULTS.family;
    const genderLabels: Record<string, string> = { WOMAN: "Femme", MAN: "Homme", KID: "Enfant", SUPPLIES: "Fournitures" };

    // Use the brand from existing PFS product (must match exactly what PFS expects)
    const brandName = existingBrand || PFS_DEFAULTS.brand_name;

    const createData: PfsProductCreateData = {
      reference: tempRef,
      reference_code: tempRef,
      gender,
      gender_label: genderLabels[gender] ?? PFS_DEFAULTS.gender_label,
      brand_name: brandName,
      family,
      category: product.category.pfsCategoryId!,
      season_name: product.season?.pfsRef ?? PFS_DEFAULTS.season_name,
      label: translated.productName,
      description: translated.productDescription,
      material_composition: mainComposition,
      country_of_manufacture: product.manufacturingCountry?.pfsCountryRef ?? product.manufacturingCountry?.isoCode ?? PFS_DEFAULTS.country_of_manufacture,
    };

    const result = await pfsCreateProduct(createData);
    newPfsProductId = result.pfsProductId;
    logger.info(`[PFS Refresh] Created new product: ${newPfsProductId}`);

    // If multiple compositions, update with array format
    if (product.compositions.length > 1) {
      const compositionArray = product.compositions
        .filter((c) => c.composition.pfsCompositionRef)
        .map((c) => ({ id: c.composition.pfsCompositionRef!, value: c.percentage }));
      if (compositionArray.length > 0) {
        await pfsUpdateProduct(newPfsProductId, { material_composition: compositionArray });
      }
    }

    // ── Step 3: Create all variants ──
    report("Création des variantes...");
    const variantCreateData: { bjVariant: FullVariant; pfsData: PfsVariantCreateData }[] = [];

    for (const variant of product.colors) {
      if (variant.saleType === "UNIT") {
        const colorRef = getEffectiveColorRef(variant);
        if (!colorRef) continue;
        const sizeRef = variant.variantSizes[0] ? getSizeRef(variant.variantSizes[0]) : "TU";

        variantCreateData.push({
          bjVariant: variant,
          pfsData: {
            type: "ITEM",
            color: colorRef,
            size: sizeRef,
            price_eur_ex_vat: getPfsUnitPrice(variant),
            weight: variant.weight,
            stock_qty: variant.stock ?? 0,
            is_active: (variant.stock ?? 0) > 0,
          },
        });
      }

      if (variant.saleType === "PACK") {
        const packEntries: { color: string; size: string; qty: number }[] = [];
        const packColors: { ref: string }[] = [];

        const variantOverrideRef = variant.pfsColorRef;
        if (variantOverrideRef) {
          packColors.push({ ref: variantOverrideRef });
        } else {
          for (const line of variant.packColorLines) {
            for (const c of line.colors) {
              if (c.color.pfsColorRef) packColors.push({ ref: c.color.pfsColorRef });
            }
          }
          const fallbackRef = getEffectiveColorRef(variant);
          if (packColors.length === 0 && fallbackRef) packColors.push({ ref: fallbackRef });
        }

        if (packColors.length === 0) continue;

        const variantSizes = variant.variantSizes.length > 0
          ? variant.variantSizes
          : [{ size: { name: "TU", pfsMappings: [{ pfsSizeRef: "TU" }] }, quantity: variant.packQuantity ?? 1 }];

        for (const pc of packColors) {
          for (const vs of variantSizes) {
            packEntries.push({ color: pc.ref, size: getSizeRef(vs), qty: vs.quantity });
          }
        }

        variantCreateData.push({
          bjVariant: variant,
          pfsData: {
            type: "PACK",
            color: packColors[0].ref,
            size: variantSizes[0] ? getSizeRef(variantSizes[0]) : "TU",
            price_eur_ex_vat: getPfsUnitPrice(variant),
            weight: variant.weight,
            stock_qty: variant.stock ?? 0,
            is_active: (variant.stock ?? 0) > 0,
            packs: packEntries,
          },
        });
      }
    }

    let createdVariantIds: string[] = [];
    let allVariantsOutOfStock = false;

    if (variantCreateData.length > 0) {
      try {
        const { variantIds } = await pfsCreateVariants(
          newPfsProductId,
          variantCreateData.map((v) => v.pfsData),
        );
        createdVariantIds = variantIds;
        logger.info(`[PFS Refresh] Created ${variantIds.length} variants`);
      } catch (err) {
        // Fallback: create one by one
        logger.warn("[PFS Refresh] Batch create failed, trying individually", { error: err instanceof Error ? err.message : String(err) });
        for (const item of variantCreateData) {
          try {
            const { variantIds } = await pfsCreateVariants(newPfsProductId, [item.pfsData]);
            createdVariantIds.push(...variantIds);
          } catch (err2) {
            logger.warn("[PFS Refresh] Failed to create variant", { error: err2 instanceof Error ? err2.message : String(err2) });
          }
        }
      }

      // ── Step 3b: Fix stock 0 variants (PFS forces stock 300 on creation) ──
      // PFS automatically sets stock to 300 when creating a variant with stock 0,
      // so we need to patch those variants afterward to set them back to 0 and deactivate them.
      if (createdVariantIds.length === variantCreateData.length) {
        const zeroStockPatches: PfsVariantUpdateData[] = [];
        for (let i = 0; i < variantCreateData.length; i++) {
          if (variantCreateData[i].pfsData.stock_qty === 0) {
            zeroStockPatches.push({
              variant_id: createdVariantIds[i],
              stock_qty: 0,
              is_active: false,
            });
          }
        }

        if (zeroStockPatches.length > 0) {
          try {
            await pfsPatchVariants(zeroStockPatches);
            logger.info(`[PFS Refresh] Patched ${zeroStockPatches.length} variants back to stock 0 (deactivated)`);
          } catch (err) {
            logger.warn("[PFS Refresh] Failed to patch zero-stock variants", { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // If ALL variants are out of stock, archive on PFS and set offline locally
        allVariantsOutOfStock = zeroStockPatches.length === variantCreateData.length;
      }
    }

    // ── Step 4: Upload all images from local disk ──
    report("Upload des images...");
    const imagesByColor = new Map<string, { path: string; order: number }[]>();

    for (const variant of product.colors) {
      let colorRef = getEffectiveColorRef(variant);
      if (!colorRef && variant.saleType === "PACK") {
        for (const line of variant.packColorLines) {
          for (const c of line.colors) {
            if (c.color.pfsColorRef) { colorRef = c.color.pfsColorRef; break; }
          }
          if (colorRef) break;
        }
      }
      if (!colorRef) continue;

      // Skip if this colorRef already has images (avoid duplicates from UNIT+PACK sharing same color)
      if (imagesByColor.has(colorRef) && imagesByColor.get(colorRef)!.length > 0) continue;

      if (variant.images.length > 0) {
        imagesByColor.set(colorRef, variant.images.map((img) => ({ path: img.path, order: img.order })));
      }
    }

    let totalImages = 0;
    let uploadedImages = 0;
    for (const imgs of imagesByColor.values()) totalImages += imgs.length;

    const POOL_SIZE = 3;
    for (const [colorRef, images] of imagesByColor) {
      const sorted = images.sort((a, b) => a.order - b.order);

      for (let i = 0; i < sorted.length; i += POOL_SIZE) {
        const batch = sorted.slice(i, i + POOL_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (img, batchIdx) => {
            const slot = i + batchIdx + 1;
            const jpegBuffer = await convertToJpeg(img.path);
            await pfsUploadImage(newPfsProductId!, jpegBuffer, slot, colorRef, `image_${slot}.jpg`);
            return slot;
          }),
        );
        for (const r of results) {
          uploadedImages++;
          report(`Upload des images... (${uploadedImages}/${totalImages})`);
          if (r.status === "rejected") {
            logger.warn(`[PFS Refresh] Image upload failed`, { error: String(r.reason) });
          }
        }
      }
    }
    logger.info(`[PFS Refresh] Uploaded ${uploadedImages}/${totalImages} images`);

    // Set default_color on new product
    const primaryVariant = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
    const primaryColorRef = primaryVariant ? getEffectiveColorRef(primaryVariant) : null;
    if (primaryColorRef) {
      try {
        await pfsUpdateProduct(newPfsProductId, { default_color: primaryColorRef });
      } catch (err) {
        logger.warn("[PFS Refresh] Failed to set default_color", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── Step 5: Swap references ──
    report("Swap des références...");

    // 5a. Generate unique DELETE reference for old product
    const deleteRef = generateDeleteRef();
    logger.info(`[PFS Refresh] Renaming old product to: ${deleteRef}`);

    // 5b. Rename old product reference → DELETEXX
    await pfsUpdateProduct(oldPfsProductId, { reference_code: deleteRef });
    oldProductRenamed = true;

    // 5c. Delete (soft) old product on PFS
    await pfsUpdateStatus([{ id: oldPfsProductId, status: "DELETED" }]);
    logger.info(`[PFS Refresh] Old product ${oldPfsProductId} renamed to ${deleteRef} and DELETED`);

    // 5d. Rename new product reference → real reference
    await pfsUpdateProduct(newPfsProductId, { reference_code: product.reference });
    logger.info(`[PFS Refresh] New product renamed to: ${product.reference}`);

    // 5e. Set new product status based on stock
    if (allVariantsOutOfStock) {
      report("Archivage (toutes les variantes en rupture)...");
      await pfsUpdateStatus([{ id: newPfsProductId, status: "ARCHIVED" }]);
      logger.info(`[PFS Refresh] All variants out of stock — product archived on PFS`);
    } else {
      report("Mise en ligne...");
      await pfsUpdateStatus([{ id: newPfsProductId, status: "READY_FOR_SALE" }]);
    }

    // ── Step 6: Update local DB ──
    report("Mise à jour base de données...");
    await prisma.product.update({
      where: { id: productId },
      data: {
        pfsProductId: newPfsProductId,
        createdAt: new Date(),
        pfsSyncStatus: "synced",
        pfsSyncError: null,
        pfsSyncedAt: new Date(),
        ...(allVariantsOutOfStock ? { status: "OFFLINE" } : {}),
      },
    });

    if (allVariantsOutOfStock) {
      logger.info(`[PFS Refresh] All variants out of stock — product set OFFLINE locally`);
    }

    // ── Step 7: Invalidate caches & notify clients ──
    revalidateTag("products", "default");
    emitProductEvent({
      type: allVariantsOutOfStock ? "PRODUCT_OFFLINE" : "PRODUCT_UPDATED",
      productId,
    });

    logger.info(`[PFS Refresh] Successfully refreshed product ${product.reference}`);
    progress.status = "success";
    progress.step = "Terminé";
    onProgress?.(progress);

    return { success: true, newPfsProductId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[PFS Refresh] Error refreshing ${product.reference}`, { error: errorMsg });

    // Cleanup: restore old product and discard new one
    // 1. Restore old product's original reference and status
    if (oldProductRenamed) {
      try {
        await pfsUpdateProduct(oldPfsProductId, { reference_code: product.reference });
        await pfsUpdateStatus([{ id: oldPfsProductId, status: "READY_FOR_SALE" }]);
        logger.info(`[PFS Refresh] Cleanup: restored old product ${oldPfsProductId} to reference ${product.reference}`);
      } catch (restoreErr) {
        logger.error("[PFS Refresh] Failed to restore old product", { error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr) });
      }
    }

    // 2. Rename new product to DELETEXX if it was created
    if (newPfsProductId) {
      try {
        const cleanupRef = generateDeleteRef();
        await pfsUpdateProduct(newPfsProductId, { reference_code: cleanupRef });
        await pfsUpdateStatus([{ id: newPfsProductId, status: "DELETED" }]);
        logger.info(`[PFS Refresh] Cleanup: renamed failed new product to ${cleanupRef}`);
      } catch (cleanupErr) {
        logger.error("[PFS Refresh] Cleanup failed", { error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr) });
      }
    }

    progress.status = "error";
    progress.error = errorMsg;
    onProgress?.(progress);

    return { success: false, error: errorMsg };
  }
}
