/**
 * PFS Refresh — Duplicate a product on PFS to make it appear as "new"
 *
 * Flow:
 * 1. Look up existing product on PFS via reference
 * 2. If not found → return { exists: false } (caller shows "produit inexistant")
 * 3. Create new product on PFS with TEMP reference
 * 4. Create all variants on new product
 * 5. Upload all images from local storage (WebP → JPEG)
 * 6. Rename OLD product ref → random DEL code + status DELETED (soft delete)
 * 7. Rename NEW product ref → real reference
 * 8. Set new product status based on stock (READY_FOR_SALE or ARCHIVED)
 * 9. Locally set lastRefreshedAt = now() (product reappears as "Nouveauté" sans toucher createdAt)
 *
 * On failure after product creation: rollback — rename new product to DELETEXX
 * and restore old product reference.
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
import { applyMarketplaceMarkup, loadMarketplaceMarkupConfigs, type MarkupConfig } from "@/lib/marketplace-pricing";
import sharp from "sharp";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";

export interface PfsRefreshProgress {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

export type PfsRefreshResult =
  | { success: true; newPfsProductId: string; archived: boolean }
  | { success: false; reason: "not_found"; error: string }
  | { success: false; reason: "error"; error: string };

type ProgressCallback = (progress: PfsRefreshProgress) => void;

function generateRandomRef(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let ref = "";
  for (let i = 0; i < 10; i++) {
    ref += chars[Math.floor(Math.random() * chars.length)];
  }
  return ref;
}

async function convertToJpeg(imagePath: string): Promise<Buffer> {
  const { readFile, keyFromDbPath } = await import("@/lib/storage");
  const buffer = await readFile(keyFromDbPath(imagePath));
  return sharp(buffer).jpeg({ quality: 100, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
}

interface FullVariant {
  id: string;
  pfsColorRef: string | null;
  unitPrice: number | { toString(): string };
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  variantSizes: { size: { name: string; pfsSizeRef: string | null }; quantity: number }[];
  color: { pfsColorRef: string | null } | null;
  subColors: { color: { pfsColorRef: string | null }; position: number }[];
  images: { path: string; order: number }[];
}

interface FullProduct {
  id: string;
  reference: string;
  name: string;
  description: string;
  status: string;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
  category: { pfsCategoryId: string | null; pfsGender: string | null; pfsFamilyId: string | null };
  colors: FullVariant[];
  compositions: {
    percentage: number | { toString(): string };
    composition: { pfsCompositionRef: string | null };
  }[];
  manufacturingCountry: { isoCode: string | null; pfsCountryRef: string | null } | null;
  season: { pfsRef: string | null } | null;
}

const PFS_DEFAULTS = {
  gender: "WOMAN",
  brand_name: "Ma Boutique",
  family: "a035J00000185J7QAI",
  season_name: "PE2026",
  country_of_manufacture: "CN",
};

function getEffectiveColorRef(variant: FullVariant): string | null {
  return variant.pfsColorRef || variant.color?.pfsColorRef || null;
}

function getPfsUnitPrice(variant: FullVariant, markup?: MarkupConfig): number {
  const price = Number(variant.unitPrice);
  let unitPrice: number;
  if (variant.saleType !== "PACK") {
    unitPrice = price;
  } else {
    const totalQty = variant.variantSizes.reduce((sum, vs) => sum + vs.quantity, 0) || variant.packQuantity || 1;
    unitPrice = Math.round((price / totalQty) * 100) / 100;
  }
  return markup ? applyMarketplaceMarkup(unitPrice, markup) : unitPrice;
}

const getSizeRef = (vs: { size: { name: string; pfsSizeRef: string | null } }) =>
  vs.size.pfsSizeRef || vs.size.name || "TU";

async function loadProductFull(productId: string): Promise<FullProduct | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
      category: { select: { pfsCategoryId: true, pfsGender: true, pfsFamilyId: true } },
      colors: {
        select: {
          id: true,
          pfsColorRef: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          variantSizes: {
            select: { size: { select: { name: true, pfsSizeRef: true } }, quantity: true },
          },
          color: { select: { pfsColorRef: true } },
          subColors: {
            select: { color: { select: { pfsColorRef: true } }, position: true },
            orderBy: { position: "asc" as const },
          },
          images: {
            select: { path: true, order: true },
            orderBy: { order: "asc" as const },
          },
        },
        orderBy: { createdAt: "asc" as const },
      },
      compositions: {
        select: { percentage: true, composition: { select: { pfsCompositionRef: true } } },
      },
      manufacturingCountry: { select: { isoCode: true, pfsCountryRef: true } },
      season: { select: { pfsRef: true } },
    },
  }) as unknown as FullProduct | null;
}

function buildDimensionsSuffix(
  product: Pick<
    FullProduct,
    "dimensionLength" | "dimensionWidth" | "dimensionHeight" | "dimensionDiameter" | "dimensionCircumference"
  >,
): string {
  const parts: string[] = [];
  if (product.dimensionLength != null) parts.push(`Longueur : ${product.dimensionLength}mm`);
  if (product.dimensionWidth != null) parts.push(`Largeur : ${product.dimensionWidth}mm`);
  if (product.dimensionHeight != null) parts.push(`Hauteur : ${product.dimensionHeight}mm`);
  if (product.dimensionDiameter != null) parts.push(`Diamètre : ${product.dimensionDiameter}mm`);
  if (product.dimensionCircumference != null) parts.push(`Circonférence : ${product.dimensionCircumference}mm`);
  if (parts.length === 0) return "";
  return `\n\nDimensions : ${parts.join(" / ")}`;
}

export async function pfsRefreshProduct(
  productId: string,
  onProgress?: ProgressCallback,
  options?: { skipRevalidation?: boolean },
): Promise<PfsRefreshResult> {
  const product = await loadProductFull(productId);
  if (!product) {
    return { success: false, reason: "error", error: "Produit introuvable en base" };
  }

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

  // ── Step 1: Check product exists on PFS ──
  report("Vérification de l'existence sur PFS...");
  let existingPfsData: Awaited<ReturnType<typeof pfsCheckReference>> | null = null;
  try {
    existingPfsData = await pfsCheckReference(product.reference);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[PFS Refresh] checkReference failed", { reference: product.reference, error: msg });
    return { success: false, reason: "error", error: `Impossible de contacter PFS : ${msg}` };
  }

  if (!existingPfsData?.exists || !existingPfsData.product?.id) {
    progress.status = "error";
    progress.error = "Produit inexistant sur PFS";
    onProgress?.(progress);
    return { success: false, reason: "not_found", error: "Produit inexistant sur PFS" };
  }

  const oldPfsProductId = existingPfsData.product.id;
  const existingBrand = existingPfsData.product.brand?.name;
  const existingGender = existingPfsData.product.gender?.reference;
  const existingFamily = existingPfsData.product.family?.id;

  let newPfsProductId: string | null = null;
  let oldProductRenamed = false;

  const markupConfigs = await loadMarketplaceMarkupConfigs();
  const pfsMarkup = markupConfigs.pfs;

  try {
    // ── Step 2: Create new product with TEMP reference ──
    const tempRef = generateRandomRef();
    report(`Création du nouveau produit (${tempRef})...`);

    const descriptionWithDims = product.description + buildDimensionsSuffix(product);
    const translated = await pfsTranslate(product.name, descriptionWithDims);

    const compositionArray = product.compositions
      .filter((c) => c.composition.pfsCompositionRef)
      .map((c) => ({ id: c.composition.pfsCompositionRef!, value: String(c.percentage) }));
    if (compositionArray.length === 0) {
      compositionArray.push({ id: "ACIERINOXYDABLE", value: "100" });
    }

    const gender = existingGender || product.category.pfsGender || PFS_DEFAULTS.gender;
    const family = existingFamily || product.category.pfsFamilyId || PFS_DEFAULTS.family;

    const shopNameInfo = await prisma.companyInfo.findFirst({ select: { shopName: true } });
    const brandName = existingBrand || shopNameInfo?.shopName || PFS_DEFAULTS.brand_name;

    if (!product.category.pfsCategoryId) {
      throw new Error(`Catégorie sans pfsCategoryId — impossible de pousser sur PFS`);
    }

    const createData: PfsProductCreateData = {
      reference_code: tempRef,
      gender_label: gender,
      brand_name: brandName,
      family,
      category: product.category.pfsCategoryId,
      season_name: product.season?.pfsRef ?? PFS_DEFAULTS.season_name,
      label: translated.productName,
      description: translated.productDescription,
      material_composition: compositionArray,
      country_of_manufacture:
        product.manufacturingCountry?.pfsCountryRef ??
        product.manufacturingCountry?.isoCode ??
        PFS_DEFAULTS.country_of_manufacture,
      variants: [],
    };

    const result = await pfsCreateProduct(createData);
    newPfsProductId = result.pfsProductId;
    logger.info("[PFS Refresh] Created new product", { newPfsProductId, ref: tempRef });

    // ── Step 3: Create variants ──
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
            price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),
            weight: variant.weight,
            stock_qty: variant.stock ?? 0,
            is_active: (variant.stock ?? 0) > 0,
          },
        });
      }

      if (variant.saleType === "PACK") {
        const packEntries: { color: string; size: string; qty: number }[] = [];
        const packColors: { ref: string }[] = [];

        const overrideRef = variant.pfsColorRef;
        if (overrideRef) {
          packColors.push({ ref: overrideRef });
        } else {
          if (variant.color?.pfsColorRef) packColors.push({ ref: variant.color.pfsColorRef });
          for (const sc of variant.subColors) {
            if (sc.color?.pfsColorRef) packColors.push({ ref: sc.color.pfsColorRef });
          }
        }

        if (packColors.length === 0) continue;

        const variantSizes =
          variant.variantSizes.length > 0
            ? variant.variantSizes
            : [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: variant.packQuantity ?? 1 }];

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
            price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),
            weight: variant.weight,
            stock_qty: variant.stock ?? 0,
            is_active: (variant.stock ?? 0) > 0,
            packs: packEntries,
          },
        });
      }
    }

    let createdVariantIds: (string | null)[] = [];
    let allVariantsOutOfStock = false;

    if (variantCreateData.length > 0) {
      try {
        const { variantIds } = await pfsCreateVariants(
          newPfsProductId,
          variantCreateData.map((v) => v.pfsData),
        );
        createdVariantIds = variantIds;
      } catch (err) {
        logger.warn("[PFS Refresh] Batch variant create failed, falling back to individual", {
          error: err instanceof Error ? err.message : String(err),
        });
        for (const item of variantCreateData) {
          try {
            const { variantIds } = await pfsCreateVariants(newPfsProductId, [item.pfsData]);
            createdVariantIds.push(...variantIds);
          } catch (err2) {
            logger.warn("[PFS Refresh] Failed individual variant create", {
              error: err2 instanceof Error ? err2.message : String(err2),
            });
          }
        }
      }

      // PFS forces stock 300 on creation with stock 0 — patch back afterwards
      if (createdVariantIds.length === variantCreateData.length) {
        const zeroStockPatches: PfsVariantUpdateData[] = [];
        for (let i = 0; i < variantCreateData.length; i++) {
          const vid = createdVariantIds[i];
          if (variantCreateData[i].pfsData.stock_qty === 0 && vid) {
            zeroStockPatches.push({ variant_id: vid, stock_qty: 0, is_active: false });
          }
        }
        if (zeroStockPatches.length > 0) {
          try {
            await pfsPatchVariants(zeroStockPatches);
          } catch (err) {
            logger.warn("[PFS Refresh] Failed to patch zero-stock variants", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        allVariantsOutOfStock = zeroStockPatches.length === variantCreateData.length;
      }
    }

    // ── Step 4: Upload images ──
    report("Upload des images...");
    const imagesByColor = new Map<string, { path: string; order: number }[]>();

    for (const variant of product.colors) {
      let colorRef = getEffectiveColorRef(variant);
      if (!colorRef && variant.saleType === "PACK") {
        for (const sc of variant.subColors) {
          if (sc.color?.pfsColorRef) {
            colorRef = sc.color.pfsColorRef;
            break;
          }
        }
      }
      if (!colorRef) continue;
      if (imagesByColor.has(colorRef) && imagesByColor.get(colorRef)!.length > 0) continue;
      if (variant.images.length > 0) {
        imagesByColor.set(
          colorRef,
          variant.images.map((img) => ({ path: img.path, order: img.order })),
        );
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
            logger.warn("[PFS Refresh] Image upload failed", { error: String(r.reason) });
          }
        }
      }
    }

    // Set default_color on new product
    const primaryVariant = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
    const primaryColorRef = primaryVariant ? getEffectiveColorRef(primaryVariant) : null;
    if (primaryColorRef) {
      try {
        await pfsUpdateProduct(newPfsProductId, { default_color: primaryColorRef });
      } catch (err) {
        logger.warn("[PFS Refresh] Failed to set default_color", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Step 5: Swap references (soft-delete old, promote new) ──
    report("Permutation des références...");
    const deleteRef = generateRandomRef();
    await pfsUpdateProduct(oldPfsProductId, { reference_code: deleteRef });
    oldProductRenamed = true;
    await pfsUpdateStatus([{ id: oldPfsProductId, status: "DELETED" }]);
    logger.info("[PFS Refresh] Old product renamed + DELETED", { oldPfsProductId, deleteRef });

    await pfsUpdateProduct(newPfsProductId, { reference_code: product.reference });
    logger.info("[PFS Refresh] New product renamed to real ref", { newPfsProductId, ref: product.reference });

    if (allVariantsOutOfStock) {
      report("Archivage (toutes les variantes en rupture)...");
      await pfsUpdateStatus([{ id: newPfsProductId, status: "ARCHIVED" }]);
    } else {
      report("Mise en ligne...");
      await pfsUpdateStatus([{ id: newPfsProductId, status: "READY_FOR_SALE" }]);
    }

    // ── Step 6: Local DB — set lastRefreshedAt (ne touche pas createdAt) ──
    report("Mise à jour locale...");
    await prisma.product.update({
      where: { id: productId },
      data: {
        lastRefreshedAt: new Date(),
        ...(allVariantsOutOfStock ? { status: "OFFLINE" } : {}),
      },
    });

    if (!options?.skipRevalidation) {
      revalidateTag("products", "default");
    }
    emitProductEvent({
      type: allVariantsOutOfStock ? "PRODUCT_OFFLINE" : "PRODUCT_UPDATED",
      productId,
    });

    progress.status = "success";
    progress.step = "Terminé";
    onProgress?.(progress);
    logger.info("[PFS Refresh] Success", { reference: product.reference, newPfsProductId });

    return { success: true, newPfsProductId, archived: allVariantsOutOfStock };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Refresh] Error", { reference: product.reference, error: errorMsg });

    // Rollback
    if (oldProductRenamed) {
      try {
        await pfsUpdateProduct(oldPfsProductId, { reference_code: product.reference });
        await pfsUpdateStatus([{ id: oldPfsProductId, status: "READY_FOR_SALE" }]);
      } catch (restoreErr) {
        logger.error("[PFS Refresh] Failed to restore old product", {
          error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
        });
      }
    }

    if (newPfsProductId) {
      try {
        const cleanupRef = generateRandomRef();
        await pfsUpdateProduct(newPfsProductId, { reference_code: cleanupRef });
        await pfsUpdateStatus([{ id: newPfsProductId, status: "DELETED" }]);
      } catch (cleanupErr) {
        logger.error("[PFS Refresh] Cleanup failed", {
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        });
      }
    }

    progress.status = "error";
    progress.error = errorMsg;
    onProgress?.(progress);

    return { success: false, reason: "error", error: errorMsg };
  }
}
