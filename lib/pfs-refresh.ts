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
import { pfsCheckReference, pfsGetVariants } from "@/lib/pfs-api";
import {
  pfsCreateProduct,
  pfsUpdateProduct,
  pfsCreateVariants,
  pfsPatchVariants,
  pfsUploadImage,
  pfsDeleteImage,
  pfsDeleteVariant,
  pfsUpdateStatus,
  pfsTranslate,
  type PfsProductCreateData,
  type PfsVariantCreateData,
  type PfsVariantUpdateData,
  type PfsStatus,
  pfsGetCategories,
  pfsGetFamilies,
  pfsGetColors,
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
  unitPrice: number | { toString(): string };
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  variantSizes: { size: { name: string; pfsSizeRef: string | null }; quantity: number }[];
  colorId: string | null;
  color: { id: string; name: string; pfsColorRef: string | null } | null;
  packLines: {
    colorId: string;
    color: { id: string; name: string; pfsColorRef: string | null };
    position: number;
    sizes: { size: { name: string; pfsSizeRef: string | null }; quantity: number }[];
  }[];
  images: { path: string; order: number; colorId: string }[];
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
  category: { id: string; pfsCategoryId: string | null; pfsGender: string | null; pfsFamilyId: string | null; pfsFamilyName: string | null; pfsCategoryName: string | null };
  colors: FullVariant[];
  compositions: {
    percentage: number | { toString(): string };
    composition: { pfsCompositionRef: string | null };
  }[];
  manufacturingCountry: { isoCode: string | null; pfsCountryRef: string | null } | null;
  season: { pfsRef: string | null } | null;
  sizeDetailsTu: string | null;
}

const PFS_DEFAULTS = {
  gender: "WOMAN",
  brand_name: "Ma Boutique",
  family: "a035J00000185J7QAI",
  season_name: "PE2026",
  country_of_manufacture: "CN",
};

/**
 * Build a map from French color labels → PFS references.
 * e.g. "Doré" → "DORE", "Argenté" → "ARGENTE"
 */
async function buildColorLabelToRefMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const pfsColors = await pfsGetColors();
    for (const c of pfsColors) {
      const frLabel = c.labels?.fr?.trim();
      if (frLabel) {
        map.set(frLabel, c.reference);
      }
      map.set(c.reference, c.reference);
    }
  } catch (err) {
    logger.warn("[PFS Refresh] Failed to load PFS color references", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return map;
}

function getEffectiveColorRef(variant: FullVariant, colorRefMap?: Map<string, string>): string | null {
  if (!variant.color) return null;
  if (variant.color.pfsColorRef) return variant.color.pfsColorRef;
  return colorRefMap?.get(variant.color.name) ?? variant.color.name;
}

function resolvePfsColorRef(
  color: { name: string; pfsColorRef: string | null },
  colorRefMap?: Map<string, string>,
): string {
  if (color.pfsColorRef) return color.pfsColorRef;
  return colorRefMap?.get(color.name) ?? color.name;
}

function getPfsUnitPrice(variant: FullVariant, markup?: MarkupConfig): number {
  const price = Number(variant.unitPrice);
  let unitPrice: number;
  if (variant.saleType !== "PACK") {
    unitPrice = price;
  } else {
    // packQuantity est la source de vérité (alignement avec
    // lib/marketplace-excel/pfs-export.ts → pas de divergence entre
    // le refresh live et l'export Excel).
    const qty = variant.packQuantity && variant.packQuantity > 0 ? variant.packQuantity : 1;
    unitPrice = Math.round((price / qty) * 100) / 100;
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
      sizeDetailsTu: true,
      category: { select: { id: true, pfsCategoryId: true, pfsGender: true, pfsFamilyId: true, pfsFamilyName: true, pfsCategoryName: true } },
      colors: {
        select: {
          id: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          variantSizes: {
            select: { size: { select: { name: true, pfsSizeRef: true } }, quantity: true },
          },
          colorId: true,
          color: { select: { id: true, name: true, pfsColorRef: true } },
          packLines: {
            select: {
              colorId: true,
              color: { select: { id: true, name: true, pfsColorRef: true } },
              position: true,
              sizes: {
                select: { size: { select: { name: true, pfsSizeRef: true } }, quantity: true },
                orderBy: { size: { position: "asc" as const } },
              },
            },
            orderBy: { position: "asc" as const },
          },
          images: {
            select: { path: true, order: true, colorId: true },
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

/**
 * Résout les IDs Salesforce PFS (pfsCategoryId, pfsFamilyId) à partir des noms
 * lisibles (pfsFamilyName, pfsCategoryName) en interrogeant l'API PFS.
 * Met à jour la catégorie en BDD pour éviter de refaire l'appel la prochaine fois.
 */
async function resolvePfsCategoryIds(category: {
  id: string;
  pfsCategoryId: string | null;
  pfsFamilyId: string | null;
  pfsFamilyName: string | null;
  pfsCategoryName: string | null;
  pfsGender: string | null;
}): Promise<{ pfsCategoryId: string | null; pfsFamilyId: string | null }> {
  const result: { pfsCategoryId: string | null; pfsFamilyId: string | null } = {
    pfsCategoryId: category.pfsCategoryId,
    pfsFamilyId: category.pfsFamilyId,
  };

  if (result.pfsCategoryId && result.pfsFamilyId) return result;

  try {
    const pickFr = (labels: Record<string, string> | undefined | null, fallback = ""): string => {
      if (!labels) return fallback;
      return labels.fr ?? labels.en ?? Object.values(labels)[0] ?? fallback;
    };

    const normalize = (s: string) => s.replace(/_/g, " ").trim().toLowerCase();

    if (!result.pfsFamilyId && category.pfsFamilyName) {
      const families = await pfsGetFamilies();
      const target = normalize(category.pfsFamilyName);
      const match = families.find((f) => normalize(pickFr(f.labels, f.id)) === target);
      if (match) result.pfsFamilyId = match.id;
    }

    if (!result.pfsCategoryId && category.pfsCategoryName) {
      const categories = await pfsGetCategories();
      const target = normalize(category.pfsCategoryName);
      const match = categories.find((c) => {
        const label = normalize(pickFr(c.labels));
        if (label !== target) return false;
        if (result.pfsFamilyId && c.family) {
          const catFamilyId = typeof c.family === "string" ? c.family : c.family.id;
          return catFamilyId === result.pfsFamilyId;
        }
        return true;
      });
      if (match) result.pfsCategoryId = match.id;
    }

    const updates: Record<string, string> = {};
    if (result.pfsFamilyId && !category.pfsFamilyId) updates.pfsFamilyId = result.pfsFamilyId;
    if (result.pfsCategoryId && !category.pfsCategoryId) updates.pfsCategoryId = result.pfsCategoryId;
    if (Object.keys(updates).length > 0) {
      await prisma.category.update({ where: { id: category.id }, data: updates });
      logger.info("[PFS Refresh] Auto-resolved PFS IDs for category", {
        categoryId: category.id,
        ...updates,
      });
    }
  } catch (err) {
    logger.warn("[PFS Refresh] Failed to auto-resolve PFS category IDs", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
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
  // P2-11 : capturer le statut original pour pouvoir le restaurer en cas
  // de rollback. Sans ça, un produit ARCHIVED retombait en READY_FOR_SALE.
  const originalPfsStatus = existingPfsData.product.status || "READY_FOR_SALE";

  let newPfsProductId: string | null = null;
  let oldProductRenamed = false;

  const markupConfigs = await loadMarketplaceMarkupConfigs();
  const pfsMarkup = markupConfigs.pfs;

  // Load PFS color label → reference mapping (e.g. "Doré" → "DORE")
  const colorRefMap = await buildColorLabelToRefMap();

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

    // ── Auto-resolve missing PFS IDs from names ──
    if (!product.category.pfsCategoryId || !product.category.pfsFamilyId) {
      const resolved = await resolvePfsCategoryIds(product.category);
      if (resolved.pfsCategoryId) product.category.pfsCategoryId = resolved.pfsCategoryId;
      if (resolved.pfsFamilyId) product.category.pfsFamilyId = resolved.pfsFamilyId;
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
      ...(product.sizeDetailsTu ? { size_details_tu: product.sizeDetailsTu } : {}),
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
        const colorRef = getEffectiveColorRef(variant, colorRefMap);
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
        let firstColorRef: string | null = null;
        let firstSizeRef = "TU";

        if (variant.packLines.length > 0) {
          // Multi-color pack: read sizes from each packLine
          for (const pl of variant.packLines) {
            if (!pl.color?.name) continue;
            const plColorRef = resolvePfsColorRef(pl.color, colorRefMap);
            if (!firstColorRef) firstColorRef = plColorRef;
            if (pl.sizes && pl.sizes.length > 0) {
              for (const ps of pl.sizes) {
                const sizeRef = ps.size.pfsSizeRef || ps.size.name || "TU";
                if (!firstSizeRef || firstSizeRef === "TU") firstSizeRef = sizeRef;
                packEntries.push({ color: plColorRef, size: sizeRef, qty: ps.quantity });
              }
            } else {
              // packLine without sizes — fallback to TU
              packEntries.push({ color: plColorRef, size: "TU", qty: variant.packQuantity ?? 1 });
            }
          }
        } else if (variant.color?.name) {
          // Mono-color pack: use variantSizes
          firstColorRef = resolvePfsColorRef(variant.color, colorRefMap);
          const variantSizes =
            variant.variantSizes.length > 0
              ? variant.variantSizes
              : [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: variant.packQuantity ?? 1 }];
          for (const vs of variantSizes) {
            const sizeRef = getSizeRef(vs);
            if (!firstSizeRef || firstSizeRef === "TU") firstSizeRef = sizeRef;
            packEntries.push({ color: firstColorRef, size: sizeRef, qty: vs.quantity });
          }
        }

        if (!firstColorRef || packEntries.length === 0) continue;

        variantCreateData.push({
          bjVariant: variant,
          pfsData: {
            type: "PACK",
            color: firstColorRef,
            size: firstSizeRef,
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

    if (variantCreateData.length === 0) {
      logger.warn("[PFS Refresh] No variant data to send — product.colors may be empty or all skipped", {
        reference: product.reference,
        colorsCount: product.colors.length,
        colorDetails: product.colors.map((c) => ({
          id: c.id,
          saleType: c.saleType,
          colorName: c.color?.name ?? null,
          sizesCount: c.variantSizes.length,
          packLinesCount: c.packLines.length,
        })),
      });
    }

    if (variantCreateData.length > 0) {
      logger.info("[PFS Refresh] Sending variant data to PFS", {
        pfsProductId: newPfsProductId,
        variantCount: variantCreateData.length,
        variants: variantCreateData.map((v) => v.pfsData),
      });

      try {
        const { variantIds } = await pfsCreateVariants(
          newPfsProductId,
          variantCreateData.map((v) => v.pfsData),
        );
        createdVariantIds = variantIds;
        logger.info("[PFS Refresh] Batch variant create result", {
          variantIds: createdVariantIds,
          successCount: createdVariantIds.filter(Boolean).length,
          failCount: createdVariantIds.filter((id) => !id).length,
        });
      } catch (err) {
        logger.warn("[PFS Refresh] Batch variant create failed, falling back to individual", {
          error: err instanceof Error ? err.message : String(err),
        });
        for (const item of variantCreateData) {
          try {
            const { variantIds } = await pfsCreateVariants(newPfsProductId, [item.pfsData]);
            createdVariantIds.push(...variantIds);
          } catch (err2) {
            logger.error("[PFS Refresh] Failed individual variant create", {
              variantData: item.pfsData,
              error: err2 instanceof Error ? err2.message : String(err2),
            });
          }
        }
      }

      // Check if ALL variant creations failed
      const successfulIds = createdVariantIds.filter(Boolean);
      if (successfulIds.length === 0) {
        logger.error("[PFS Refresh] ALL variant creations failed — product has no variants on PFS", {
          reference: product.reference,
          pfsProductId: newPfsProductId,
          attemptedCount: variantCreateData.length,
        });
        throw new Error(
          `Aucune variante n'a pu être créée sur PFS (${variantCreateData.length} tentée(s)). ` +
          `Vérifiez que les couleurs et tailles existent dans le référentiel PFS.`,
        );
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

    // Build a map from Color.id → PFS color ref (covers both variant colors and pack line colors)
    const colorIdToPfsRef = new Map<string, string>();
    for (const variant of product.colors) {
      if (variant.color) {
        const ref = getEffectiveColorRef(variant, colorRefMap);
        if (ref) colorIdToPfsRef.set(variant.color.id, ref);
      }
      for (const pl of variant.packLines) {
        if (pl.color) {
          const ref = resolvePfsColorRef(pl.color, colorRefMap);
          colorIdToPfsRef.set(pl.color.id, ref);
        }
      }
    }

    // Group images by their actual colorId (not the variant's main color)
    for (const variant of product.colors) {
      for (const img of variant.images) {
        const colorRef = colorIdToPfsRef.get(img.colorId);
        if (!colorRef) continue;
        if (!imagesByColor.has(colorRef)) {
          imagesByColor.set(colorRef, []);
        }
        imagesByColor.get(colorRef)!.push({ path: img.path, order: img.order });
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
    const primaryColorRef = primaryVariant ? getEffectiveColorRef(primaryVariant, colorRefMap) : null;
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

    // ── Step 5b: Clean up old product (name, description, images, variants) ──
    report("Nettoyage de l'ancien produit...");

    // Rename label + description — professional end-of-line message per language
    try {
      const unavailableLabel: Record<string, string> = {
        fr: "Fin de série — Produit retiré de la vente",
        en: "Discontinued — Product withdrawn from sale",
        de: "Auslaufmodell — Produkt aus dem Verkauf genommen",
        es: "Fin de serie — Producto retirado de la venta",
        it: "Fine serie — Prodotto ritirato dalla vendita",
      };
      const unavailableDesc: Record<string, string> = {
        fr: "Ce produit est en fin de série et n'est plus commercialisé. Il a été remplacé par une nouvelle référence. Merci de votre compréhension.",
        en: "This product has been discontinued and is no longer available for sale. It has been replaced by a new reference. Thank you for your understanding.",
        de: "Dieses Produkt ist ein Auslaufmodell und wird nicht mehr verkauft. Es wurde durch eine neue Referenz ersetzt. Vielen Dank für Ihr Verständnis.",
        es: "Este producto es de fin de serie y ya no está a la venta. Ha sido reemplazado por una nueva referencia. Gracias por su comprensión.",
        it: "Questo prodotto è a fine serie e non è più in vendita. È stato sostituito da un nuovo riferimento. Grazie per la comprensione.",
      };
      await pfsUpdateProduct(oldPfsProductId, {
        label: unavailableLabel,
        description: unavailableDesc,
      });
      logger.info("[PFS Refresh] Old product label/description cleared", { oldPfsProductId });
    } catch (err) {
      logger.warn("[PFS Refresh] Failed to clear old product label/description", {
        oldPfsProductId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Delete all images
    if (existingPfsData.product?.images) {
      const oldImages = existingPfsData.product.images as Record<string, string | string[]>;
      for (const [colorRef, imageData] of Object.entries(oldImages)) {
        if (colorRef === "DEFAULT") continue;
        const urls = Array.isArray(imageData) ? imageData : [imageData];
        for (let slot = 1; slot <= urls.length; slot++) {
          try {
            await pfsDeleteImage(oldPfsProductId, slot, colorRef);
          } catch (err) {
            logger.warn("[PFS Refresh] Failed to delete old image", {
              oldPfsProductId, colorRef, slot,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      logger.info("[PFS Refresh] Old product images cleanup done", { oldPfsProductId });
    }

    // Delete all variants
    try {
      const oldVariants = await pfsGetVariants(oldPfsProductId);
      if (oldVariants.data?.length > 0) {
        for (const v of oldVariants.data) {
          try {
            await pfsDeleteVariant(v.id);
          } catch (err) {
            logger.warn("[PFS Refresh] Failed to delete old variant", {
              oldPfsProductId, variantId: v.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        logger.info("[PFS Refresh] Old product variants cleanup done", {
          oldPfsProductId,
          deletedCount: oldVariants.data.length,
        });
      }
    } catch (err) {
      logger.warn("[PFS Refresh] Failed to fetch/delete old variants", {
        oldPfsProductId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await pfsUpdateProduct(newPfsProductId, { reference_code: product.reference });
    logger.info("[PFS Refresh] New product renamed to real ref", { newPfsProductId, ref: product.reference });

    // Respect local product status: if product is OFFLINE or ARCHIVED locally,
    // keep it ARCHIVED on PFS instead of forcing READY_FOR_SALE
    const shouldBeOffline =
      product.status === "OFFLINE" || product.status === "ARCHIVED" || allVariantsOutOfStock;

    if (shouldBeOffline) {
      report("Archivage sur PFS (produit hors ligne ou en rupture)...");
      await pfsUpdateStatus([{ id: newPfsProductId, status: "ARCHIVED" }]);
    } else {
      report("Mise en ligne...");
      await pfsUpdateStatus([{ id: newPfsProductId, status: "READY_FOR_SALE" }]);
    }

    // ── Step 6: Local DB — set lastRefreshedAt + nouveaux IDs marketplaces ──
    report("Mise à jour locale...");
    const variantIdUpdates: { bjVariantId: string; pfsVariantId: string }[] = [];
    for (let i = 0; i < variantCreateData.length; i++) {
      const newPfsVariantId = createdVariantIds[i];
      if (newPfsVariantId) {
        variantIdUpdates.push({
          bjVariantId: variantCreateData[i].bjVariant.id,
          pfsVariantId: newPfsVariantId,
        });
      }
    }
    await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: {
          lastRefreshedAt: new Date(),
          pfsProductId: newPfsProductId,
          ...(allVariantsOutOfStock ? { status: "OFFLINE" } : {}),
        },
      }),
      ...variantIdUpdates.map((u) =>
        prisma.productColor.update({
          where: { id: u.bjVariantId },
          data: { pfsVariantId: u.pfsVariantId },
        }),
      ),
    ]);

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

    // Rollback — restaurer la référence ET le statut d'origine du produit
    if (oldProductRenamed) {
      try {
        await pfsUpdateProduct(oldPfsProductId, { reference_code: product.reference });
        await pfsUpdateStatus([{ id: oldPfsProductId, status: originalPfsStatus as PfsStatus }]);
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
