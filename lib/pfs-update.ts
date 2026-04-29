/**
 * PFS Update — Mise à jour en place d'un produit existant sur PFS.
 *
 * Au lieu de supprimer et recréer le produit (comme le fait pfsRefreshProduct),
 * cette fonction modifie directement le produit existant :
 *   - PATCH des champs produit (nom, description, composition, catégorie…)
 *   - PATCH des variantes existantes (prix, stock, poids)
 *   - Création des nouvelles variantes
 *   - Suppression des variantes retirées
 *   - Synchronisation des images (ajout/suppression)
 */

import { prisma } from "@/lib/prisma";
import {
  pfsUpdateProduct,
  pfsCreateVariants,
  pfsPatchVariants,
  pfsDeleteVariant,
  pfsUploadImage,
  pfsDeleteImage,
  pfsUpdateStatus,
  pfsTranslate,
  pfsGetCategories,
  pfsGetFamilies,
  pfsGetColors,
  type PfsProductUpdateData,
  type PfsVariantCreateData,
  type PfsVariantUpdateData,
} from "@/lib/pfs-api-write";
import { pfsGetVariants } from "@/lib/pfs-api";
import {
  applyMarketplaceMarkup,
  loadMarketplaceMarkupConfigs,
  type MarkupConfig,
} from "@/lib/marketplace-pricing";
import sharp from "sharp";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";

export type PfsUpdateResult =
  | { success: true; archived: boolean }
  | { success: false; error: string };

type ProgressCallback = (progress: PfsUpdateProgress) => void;

export interface PfsUpdateProgress {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

interface FullVariant {
  id: string;
  pfsVariantId: string | null;
  unitPrice: number | { toString(): string };
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  variantSizes: { size: { name: string; pfsSizeRef: string | null }; quantity: number }[];
  color: { name: string; pfsColorRef: string | null } | null;
  packLines: {
    color: { name: string; pfsColorRef: string | null };
    position: number;
    sizes: { size: { name: string; pfsSizeRef: string | null }; quantity: number }[];
  }[];
  images: { path: string; order: number }[];
}

interface FullProduct {
  id: string;
  reference: string;
  name: string;
  description: string;
  status: string;
  pfsProductId: string | null;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
  category: {
    id: string;
    pfsCategoryId: string | null;
    pfsGender: string | null;
    pfsFamilyId: string | null;
    pfsFamilyName: string | null;
    pfsCategoryName: string | null;
  };
  colors: FullVariant[];
  compositions: {
    percentage: number | { toString(): string };
    composition: { pfsCompositionRef: string | null };
  }[];
  manufacturingCountry: { isoCode: string | null; pfsCountryRef: string | null } | null;
  season: { pfsRef: string | null } | null;
}

async function loadProductFull(productId: string): Promise<FullProduct | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      pfsProductId: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
      category: {
        select: {
          id: true,
          pfsCategoryId: true,
          pfsGender: true,
          pfsFamilyId: true,
          pfsFamilyName: true,
          pfsCategoryName: true,
        },
      },
      colors: {
        select: {
          id: true,
          pfsVariantId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          variantSizes: {
            select: { size: { select: { name: true, pfsSizeRef: true } }, quantity: true },
          },
          color: { select: { name: true, pfsColorRef: true } },
          packLines: {
            select: {
              color: { select: { name: true, pfsColorRef: true } },
              position: true,
              sizes: {
                select: { size: { select: { name: true, pfsSizeRef: true } }, quantity: true },
                orderBy: { size: { position: "asc" as const } },
              },
            },
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

// ── Helpers (same as pfs-publish.ts) ──

async function buildColorLabelToRefMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const pfsColors = await pfsGetColors();
    for (const c of pfsColors) {
      const frLabel = c.labels?.fr?.trim();
      if (frLabel) map.set(frLabel, c.reference);
      map.set(c.reference, c.reference);
    }
  } catch (err) {
    logger.warn("[PFS Update] Failed to load PFS color references", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return map;
}

function resolvePfsColorRef(
  color: { name: string; pfsColorRef: string | null },
  colorRefMap?: Map<string, string>,
): string {
  if (color.pfsColorRef) return color.pfsColorRef;
  return colorRefMap?.get(color.name) ?? color.name;
}

function getEffectiveColorRef(variant: FullVariant, colorRefMap?: Map<string, string>): string | null {
  if (!variant.color) return null;
  if (variant.color.pfsColorRef) return variant.color.pfsColorRef;
  return colorRefMap?.get(variant.color.name) ?? variant.color.name;
}

function getPfsUnitPrice(variant: FullVariant, markup?: MarkupConfig): number {
  const price = Number(variant.unitPrice);
  let unitPrice: number;
  if (variant.saleType !== "PACK") {
    unitPrice = price;
  } else {
    const qty = variant.packQuantity && variant.packQuantity > 0 ? variant.packQuantity : 1;
    unitPrice = Math.round((price / qty) * 100) / 100;
  }
  return markup ? applyMarketplaceMarkup(unitPrice, markup) : unitPrice;
}

const getSizeRef = (vs: { size: { name: string; pfsSizeRef: string | null } }) =>
  vs.size.pfsSizeRef || vs.size.name || "TU";

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

async function convertToJpeg(imagePath: string): Promise<Buffer> {
  const { readFile, keyFromDbPath } = await import("@/lib/storage");
  const buffer = await readFile(keyFromDbPath(imagePath));
  return sharp(buffer).jpeg({ quality: 100, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
}

async function resolvePfsCategoryIds(category: {
  id: string;
  pfsCategoryId: string | null;
  pfsFamilyId: string | null;
  pfsFamilyName: string | null;
  pfsCategoryName: string | null;
  pfsGender: string | null;
}): Promise<{ pfsCategoryId: string | null; pfsFamilyId: string | null }> {
  const result = { pfsCategoryId: category.pfsCategoryId, pfsFamilyId: category.pfsFamilyId };
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
    }
  } catch (err) {
    logger.warn("[PFS Update] Failed to auto-resolve PFS category IDs", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}

// ── Build variant create data (same logic as pfs-publish.ts) ──

function buildVariantCreateData(
  variant: FullVariant,
  colorRefMap: Map<string, string>,
  pfsMarkup?: MarkupConfig,
): PfsVariantCreateData | null {
  if (variant.saleType === "UNIT") {
    const colorRef = getEffectiveColorRef(variant, colorRefMap);
    if (!colorRef) return null;
    const sizeRef = variant.variantSizes[0] ? getSizeRef(variant.variantSizes[0]) : "TU";
    return {
      type: "ITEM",
      color: colorRef,
      size: sizeRef,
      price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),
      weight: variant.weight,
      stock_qty: variant.stock ?? 0,
      is_active: (variant.stock ?? 0) > 0,
    };
  }

  if (variant.saleType === "PACK") {
    const packEntries: { color: string; size: string; qty: number }[] = [];
    let firstColorRef: string | null = null;
    let firstSizeRef = "TU";

    if (variant.packLines.length > 0) {
      for (const pl of variant.packLines) {
        if (!pl.color?.name) continue;
        const plColorRef = resolvePfsColorRef(pl.color, colorRefMap);
        if (!firstColorRef) firstColorRef = plColorRef;
        if (pl.sizes && pl.sizes.length > 0) {
          for (const ps of pl.sizes) {
            const sizeRef = ps.size.pfsSizeRef || ps.size.name || "TU";
            if (firstSizeRef === "TU") firstSizeRef = sizeRef;
            packEntries.push({ color: plColorRef, size: sizeRef, qty: ps.quantity });
          }
        } else {
          packEntries.push({ color: plColorRef, size: "TU", qty: variant.packQuantity ?? 1 });
        }
      }
    } else if (variant.color?.name) {
      firstColorRef = resolvePfsColorRef(variant.color, colorRefMap);
      const variantSizes =
        variant.variantSizes.length > 0
          ? variant.variantSizes
          : [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: variant.packQuantity ?? 1 }];
      for (const vs of variantSizes) {
        const sizeRef = getSizeRef(vs);
        if (firstSizeRef === "TU") firstSizeRef = sizeRef;
        packEntries.push({ color: firstColorRef, size: sizeRef, qty: vs.quantity });
      }
    }

    if (!firstColorRef || packEntries.length === 0) return null;

    return {
      type: "PACK",
      color: firstColorRef,
      size: firstSizeRef,
      price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),
      weight: variant.weight,
      stock_qty: variant.stock ?? 0,
      is_active: (variant.stock ?? 0) > 0,
      packs: packEntries,
    };
  }

  return null;
}

// ── Main update function ──

export async function pfsUpdateProductInPlace(
  productId: string,
  onProgress?: ProgressCallback,
  options?: { skipRevalidation?: boolean },
): Promise<PfsUpdateResult> {
  const product = await loadProductFull(productId);
  if (!product) return { success: false, error: "Produit introuvable en base" };
  if (!product.pfsProductId) return { success: false, error: "Produit non publié sur PFS (pas de pfsProductId)" };

  const pfsProductId = product.pfsProductId;

  const progress: PfsUpdateProgress = {
    productId,
    productName: product.name,
    reference: product.reference,
    status: "in_progress",
  };
  const report = (step: string) => {
    progress.step = step;
    onProgress?.(progress);
  };

  const markupConfigs = await loadMarketplaceMarkupConfigs();
  const pfsMarkup = markupConfigs.pfs;
  const colorRefMap = await buildColorLabelToRefMap();

  try {
    // ── Step 1 : Update product fields ──
    report("Mise à jour des informations produit...");

    const descriptionWithDims = product.description + buildDimensionsSuffix(product);
    const translated = await pfsTranslate(product.name, descriptionWithDims);

    const compositionArray = product.compositions
      .filter((c) => c.composition.pfsCompositionRef)
      .map((c) => ({ id: c.composition.pfsCompositionRef!, value: Number(c.percentage) }));
    if (compositionArray.length === 0) {
      compositionArray.push({ id: "ACIERINOXYDABLE", value: 100 });
    }

    // Auto-resolve missing PFS IDs
    if (!product.category.pfsCategoryId || !product.category.pfsFamilyId) {
      const resolved = await resolvePfsCategoryIds(product.category);
      if (resolved.pfsCategoryId) product.category.pfsCategoryId = resolved.pfsCategoryId;
      if (resolved.pfsFamilyId) product.category.pfsFamilyId = resolved.pfsFamilyId;
    }

    const shopNameInfo = await prisma.companyInfo.findFirst({ select: { shopName: true } });
    const brandName = shopNameInfo?.shopName || "Ma Boutique";

    const updateData: PfsProductUpdateData = {
      label: translated.productName,
      description: translated.productDescription,
      material_composition: compositionArray,
      country_of_manufacture:
        product.manufacturingCountry?.pfsCountryRef ??
        product.manufacturingCountry?.isoCode ??
        "CN",
      season_name: product.season?.pfsRef ?? "PE2026",
      brand_name: brandName,
      gender_label: product.category.pfsGender || "WOMAN",
    };
    if (product.category.pfsCategoryId) updateData.category = product.category.pfsCategoryId;
    if (product.category.pfsFamilyId) updateData.family = product.category.pfsFamilyId;

    await pfsUpdateProduct(pfsProductId, updateData);
    logger.info("[PFS Update] Product fields updated", { pfsProductId, reference: product.reference });

    // ── Step 2 : Sync variants ──
    report("Synchronisation des variantes...");

    // Get existing PFS variants
    let existingPfsVariants: { id: string; type: string; item?: { color: { reference: string }; size: string }; stock_qty: number }[] = [];
    try {
      const pfsVariantsResp = await pfsGetVariants(pfsProductId);
      existingPfsVariants = pfsVariantsResp.data ?? [];
    } catch (err) {
      logger.warn("[PFS Update] Could not fetch existing PFS variants", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const existingPfsVariantIds = new Set(existingPfsVariants.map((v) => v.id));

    // Separate local variants into: has pfsVariantId (update) vs no pfsVariantId (create)
    const variantsToUpdate: { bjVariant: FullVariant; pfsVariantId: string }[] = [];
    const variantsToCreate: { bjVariant: FullVariant; pfsData: PfsVariantCreateData }[] = [];
    const localPfsVariantIds = new Set<string>();

    for (const variant of product.colors) {
      if (variant.pfsVariantId && existingPfsVariantIds.has(variant.pfsVariantId)) {
        // Existing variant on PFS → update
        variantsToUpdate.push({ bjVariant: variant, pfsVariantId: variant.pfsVariantId });
        localPfsVariantIds.add(variant.pfsVariantId);
      } else {
        // New variant → create
        const pfsData = buildVariantCreateData(variant, colorRefMap, pfsMarkup);
        if (pfsData) {
          variantsToCreate.push({ bjVariant: variant, pfsData });
        }
      }
    }

    // Find PFS variants that no longer exist locally → delete
    const variantsToDelete = existingPfsVariants.filter((v) => !localPfsVariantIds.has(v.id));

    // 2a. Patch existing variants
    if (variantsToUpdate.length > 0) {
      const patches: PfsVariantUpdateData[] = variantsToUpdate.map(({ bjVariant, pfsVariantId }) => ({
        variant_id: pfsVariantId,
        price_eur_ex_vat: getPfsUnitPrice(bjVariant, pfsMarkup),
        stock_qty: bjVariant.stock ?? 0,
        weight: bjVariant.weight,
        is_active: (bjVariant.stock ?? 0) > 0,
      }));

      try {
        await pfsPatchVariants(patches);
        logger.info("[PFS Update] Patched variants", { count: patches.length });
      } catch (err) {
        logger.error("[PFS Update] Failed to patch variants", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2b. Create new variants
    let allVariantsOutOfStock = product.colors.every((v) => (v.stock ?? 0) === 0);

    if (variantsToCreate.length > 0) {
      report(`Création de ${variantsToCreate.length} nouvelle(s) variante(s)...`);
      try {
        const { variantIds } = await pfsCreateVariants(
          pfsProductId,
          variantsToCreate.map((v) => v.pfsData),
        );

        // Store new pfsVariantId in DB
        const newIdUpdates: { bjVariantId: string; pfsVariantId: string }[] = [];
        for (let i = 0; i < variantsToCreate.length; i++) {
          const newPfsVariantId = variantIds[i];
          if (newPfsVariantId) {
            newIdUpdates.push({
              bjVariantId: variantsToCreate[i].bjVariant.id,
              pfsVariantId: newPfsVariantId,
            });
          }
        }

        if (newIdUpdates.length > 0) {
          await prisma.$transaction(
            newIdUpdates.map((u) =>
              prisma.productColor.update({
                where: { id: u.bjVariantId },
                data: { pfsVariantId: u.pfsVariantId },
              }),
            ),
          );
        }

        // Patch zero-stock new variants to set is_active=false
        const zeroStockPatches: PfsVariantUpdateData[] = [];
        for (let i = 0; i < variantsToCreate.length; i++) {
          const vid = variantIds[i];
          if (variantsToCreate[i].pfsData.stock_qty === 0 && vid) {
            zeroStockPatches.push({ variant_id: vid, stock_qty: 0, is_active: false });
          }
        }
        if (zeroStockPatches.length > 0) {
          try { await pfsPatchVariants(zeroStockPatches); } catch { /* ignore */ }
        }

        logger.info("[PFS Update] Created new variants", { count: newIdUpdates.length });
      } catch (err) {
        logger.error("[PFS Update] Failed to create new variants", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2c. Delete removed variants
    if (variantsToDelete.length > 0) {
      report(`Suppression de ${variantsToDelete.length} variante(s) retirée(s)...`);
      for (const v of variantsToDelete) {
        try {
          await pfsDeleteVariant(v.id);
          logger.info("[PFS Update] Deleted variant from PFS", { pfsVariantId: v.id });
        } catch (err) {
          logger.warn("[PFS Update] Failed to delete variant", {
            pfsVariantId: v.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // ── Step 3 : Sync images ──
    report("Synchronisation des images...");

    // Build map of local images per color ref
    const localImagesByColor = new Map<string, { path: string; order: number }[]>();
    for (const variant of product.colors) {
      let colorRef = getEffectiveColorRef(variant, colorRefMap);
      if (!colorRef && variant.saleType === "PACK" && variant.packLines.length > 0) {
        const plColor = variant.packLines[0]?.color;
        colorRef = plColor ? resolvePfsColorRef(plColor, colorRefMap) : null;
      }
      if (!colorRef) continue;
      if (localImagesByColor.has(colorRef) && localImagesByColor.get(colorRef)!.length > 0) continue;
      if (variant.images.length > 0) {
        localImagesByColor.set(
          colorRef,
          variant.images.map((img) => ({ path: img.path, order: img.order })),
        );
      }
    }

    // Get existing images from PFS (from checkReference response)
    let existingImages: Record<string, string | string[]> = {};
    try {
      const { pfsCheckReference } = await import("@/lib/pfs-api");
      const checkResp = await pfsCheckReference(product.reference);
      if (checkResp.exists && checkResp.product?.images) {
        existingImages = checkResp.product.images;
      }
    } catch {
      // If we can't get existing images, we'll just re-upload everything
    }

    // For each color, compare and sync
    let totalUploaded = 0;
    let totalDeleted = 0;

    for (const [colorRef, localImages] of localImagesByColor) {
      const sorted = localImages.sort((a, b) => a.order - b.order);
      const existingForColor = existingImages[colorRef];
      const existingSlotCount = Array.isArray(existingForColor) ? existingForColor.length : existingForColor ? 1 : 0;

      // Delete extra slots that no longer exist locally
      for (let slot = sorted.length + 1; slot <= existingSlotCount; slot++) {
        try {
          await pfsDeleteImage(pfsProductId, slot, colorRef);
          totalDeleted++;
        } catch (err) {
          logger.warn("[PFS Update] Failed to delete image", {
            colorRef, slot,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Upload all local images (re-upload to ensure they're current)
      for (let i = 0; i < sorted.length; i++) {
        const slot = i + 1;
        try {
          const jpegBuffer = await convertToJpeg(sorted[i].path);
          await pfsUploadImage(pfsProductId, jpegBuffer, slot, colorRef, `image_${slot}.jpg`);
          totalUploaded++;
        } catch (err) {
          logger.warn("[PFS Update] Image upload failed", {
            colorRef, slot,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Delete images for colors that no longer exist locally
    for (const pfsColorRef of Object.keys(existingImages)) {
      if (!localImagesByColor.has(pfsColorRef)) {
        const existing = existingImages[pfsColorRef];
        const count = Array.isArray(existing) ? existing.length : existing ? 1 : 0;
        for (let slot = 1; slot <= count; slot++) {
          try {
            await pfsDeleteImage(pfsProductId, slot, pfsColorRef);
            totalDeleted++;
          } catch { /* ignore */ }
        }
      }
    }

    logger.info("[PFS Update] Images synced", { uploaded: totalUploaded, deleted: totalDeleted });

    // ── Step 4 : Set default color ──
    const primaryVariant = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
    const primaryColorRef = primaryVariant ? getEffectiveColorRef(primaryVariant, colorRefMap) : null;
    if (primaryColorRef) {
      try {
        await pfsUpdateProduct(pfsProductId, { default_color: primaryColorRef });
      } catch (err) {
        logger.warn("[PFS Update] Failed to set default_color", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Step 5 : Update status ──
    if (allVariantsOutOfStock) {
      report("Archivage (toutes les variantes en rupture)...");
      await pfsUpdateStatus([{ id: pfsProductId, status: "ARCHIVED" }]);
    } else {
      report("Mise en ligne...");
      await pfsUpdateStatus([{ id: pfsProductId, status: "READY_FOR_SALE" }]);
    }

    // ── Step 6 : Local DB update ──
    report("Mise à jour locale...");
    if (allVariantsOutOfStock && product.status === "ONLINE") {
      await prisma.product.update({
        where: { id: productId },
        data: { status: "OFFLINE" },
      });
    }

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
    logger.info("[PFS Update] Success", { reference: product.reference, pfsProductId });

    return { success: true, archived: allVariantsOutOfStock };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Update] Error", { reference: product.reference, error: errorMsg });

    progress.status = "error";
    progress.error = errorMsg;
    onProgress?.(progress);

    return { success: false, error: errorMsg };
  }
}
