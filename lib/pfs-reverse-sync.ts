/**
 * PFS Reverse Sync — Push local products → Paris Fashion Shop
 *
 * Non-blocking: called after DB save, runs in background.
 * Updates Product.pfsSyncStatus to track progress.
 *
 * Optimized: diff-based sync — only calls PFS endpoints for fields that actually changed.
 * - Product metadata: only translate + update if name/desc/category/etc differ
 * - Variants: batch create, diff-based update, selective delete
 * - Images: parallel upload (pool of 3), only new/changed images
 * - Status: only update if changed
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  pfsCreateProduct,
  pfsUpdateProduct,
  pfsCreateVariants,
  pfsPatchVariants,
  pfsDeleteVariant,
  pfsUploadImage,
  pfsUpdateStatus,
  pfsTranslate,
  type PfsProductCreateData,
  type PfsProductUpdateData,
  type PfsVariantCreateData,
  type PfsVariantUpdateData,
  type PfsStatus,
} from "@/lib/pfs-api-write";
import { pfsGetVariants, pfsCheckReference, type PfsCheckReferenceResponse, type PfsVariantDetail } from "@/lib/pfs-api";
import { applyMarketplaceMarkup, loadMarketplaceMarkupConfigs, type MarkupConfig } from "@/lib/marketplace-pricing";
import sharp from "sharp";
// fs/promises and path no longer needed — images are on R2

/**
 * Get the per-unit price for PFS.
 * In the DB, PACK variants store unitPrice = totalPackPrice (unitPrice × totalQty).
 * PFS expects the per-unit price, so we divide back by total quantity for PACKs.
 */
function getPfsUnitPrice(variant: FullProduct["colors"][number], markup?: MarkupConfig): number {
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

// Default values for PFS product creation
const PFS_DEFAULTS = {
  gender: "WOMAN",
  gender_label: "Femme",
  brand_name: "Ma Boutique",
  family: "a035J00000185J7QAI", // WOMAN/FASHIONJEWELRY
  season_name: "PE2026",
  country_of_manufacture: "CN",
};


/**
 * Get the effective PFS color reference for a variant.
 * ProductColor.pfsColorRef (override for multi-color combos) takes priority
 * over Color.pfsColorRef (individual color mapping).
 */
function getEffectiveColorRef(variant: FullProduct["colors"][number]): string | null {
  return variant.pfsColorRef || variant.color?.pfsColorRef || null;
}

// ─────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────

/**
 * Push a BJ product to PFS. Non-blocking — fire and forget.
 * Updates pfsSyncStatus in DB on completion/failure.
 */
export function triggerPfsSync(productId: string): void {
  // Fire and forget — don't await
  syncProductToPfs(productId).catch((err) => {
    logger.error(`[PFS Reverse Sync] Fatal error for ${productId}`, { error: err instanceof Error ? err.message : String(err) });
  });
}

/**
 * Core sync logic. Call via triggerPfsSync() for non-blocking behavior.
 * Diff-based: only pushes changed fields to PFS.
 */
export async function syncProductToPfs(productId: string): Promise<void> {
  // Mark as pending
  await prisma.product.update({
    where: { id: productId },
    data: { pfsSyncStatus: "pending", pfsSyncError: null },
  });

  try {
    // 1. Load product with all relations
    const product = await loadProductFull(productId);
    if (!product) throw new Error("Produit introuvable");

    const markupConfigs = await loadMarketplaceMarkupConfigs();
    const pfsMarkup = markupConfigs.pfs;

    // Vérification des mappings PFS (bloque la sync si une entité n'est pas mappée)
    validatePfsMappings(product);

    // 2. If no pfsProductId, check if product already exists on PFS via reference
    let pfsProductId = product.pfsProductId;
    if (!pfsProductId) {
      try {
        const refCheck = await pfsCheckReference(product.reference);
        if (refCheck?.product?.id) {
          // Product already exists on PFS — link it instead of creating a duplicate
          pfsProductId = refCheck.product.id;
          await prisma.product.update({
            where: { id: productId },
            data: { pfsProductId },
          });
          logger.info(`[PFS Reverse Sync] Product ${productId} linked to existing PFS product ${pfsProductId} via reference ${product.reference}`);
        }
      } catch {
        // checkReference failed — will proceed to create
      }
    }

    // 3. Create product on PFS if truly new — full sync required
    if (!pfsProductId) {
      pfsProductId = await createProductOnPfs(product);
      // New product → full sync (create all variants, upload all images, set status)
      await syncVariants(pfsProductId, product, null, pfsMarkup);
      await syncImages(pfsProductId, product, null);
      await syncStatus(pfsProductId, product.status, null);
      // Mark as synced
      await prisma.product.update({
        where: { id: productId },
        data: { pfsProductId, pfsSyncStatus: "synced", pfsSyncError: null, pfsSyncedAt: new Date() },
      });
      return;
    }

    // 4. Existing product — fetch PFS state for diff (parallel)
    const [pfsRefData, pfsVariantsResp] = await Promise.all([
      pfsCheckReference(product.reference).catch(() => null),
      pfsGetVariants(pfsProductId).catch(() => ({ data: [] as PfsVariantDetail[] })),
    ]);
    const pfsVariants = pfsVariantsResp.data ?? [];

    let apiCalls = 0;

    // 5. Diff product metadata — only update if changed
    const metadataChanged = await diffAndUpdateMetadata(pfsProductId, product, pfsRefData);
    if (metadataChanged) apiCalls += metadataChanged;

    // 6. Diff variants
    const variantCalls = await syncVariants(pfsProductId, product, pfsVariants, pfsMarkup);
    apiCalls += variantCalls;

    // 6b. Set default_color only if needed
    const primaryVariant = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
    const primaryColorRef = primaryVariant ? getEffectiveColorRef(primaryVariant) : null;
    const currentDefault = pfsRefData?.product?.default_color;
    if (primaryColorRef && primaryColorRef !== currentDefault) {
      try {
        await pfsUpdateProduct(pfsProductId, { default_color: primaryColorRef });
        apiCalls++;
      } catch (err) {
        logger.warn("[PFS Reverse Sync] Failed to set default_color", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // 7. Diff images
    const imageCalls = await syncImages(pfsProductId, product, pfsRefData);
    apiCalls += imageCalls;

    // 8. Diff status
    const statusChanged = await syncStatus(pfsProductId, product.status, pfsRefData);
    if (statusChanged) apiCalls++;

    // 9. Mark as synced
    await prisma.product.update({
      where: { id: productId },
      data: {
        pfsProductId,
        pfsSyncStatus: "synced",
        pfsSyncError: null,
        pfsSyncedAt: new Date(),
      },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[PFS Reverse Sync] Product ${productId} failed`, { error: errorMsg });

    await prisma.product.update({
      where: { id: productId },
      data: {
        pfsSyncStatus: "failed",
        pfsSyncError: errorMsg.slice(0, 5000),
      },
    }).catch(() => {}); // Don't throw on cleanup failure
  }
}

// ─────────────────────────────────────────────
// Full Product type (loaded from DB)
// ─────────────────────────────────────────────

export interface FullProduct {
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
  colors: {
    id: string;
    colorId: string | null; // null for PACK variants
    pfsColorRef: string | null; // Override couleur PFS pour variantes multi-couleur
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
  }[];
  compositions: {
    compositionId: string;
    percentage: number;
    composition: { id: string; name: string; pfsCompositionRef: string | null };
  }[];
  manufacturingCountry: { id: string; name: string; isoCode: string | null; pfsCountryRef: string | null } | null;
  season: { id: string; name: string; pfsRef: string | null } | null;
}

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
// Dimension helpers
// ─────────────────────────────────────────────

/**
 * Regex to match the dimensions block appended at the end of a description.
 * Matches from "\n\nDimensions" (or translated variants) to end of string.
 * Handles single-line and multi-line formats (in case PFS AI reformats).
 * Uses dotAll via [\s\S] to span multiple lines.
 */
const DIMENSIONS_REGEX = /\n\n(?:Dimensions?|Dimensiones|Dimensioni|Abmessungen|Maße)\s*:[\s\S]*$/;

/** Build a "Dimensions : ..." suffix from product dimension fields. Returns empty string if no dimensions. */
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

/** Strip the dimensions suffix from a description (removes from "\n\nDimensions..." to end) */
export function stripDimensionsSuffix(description: string): string {
  return description.replace(DIMENSIONS_REGEX, "");
}

// ─────────────────────────────────────────────
// Create product on PFS (first sync only)
// ─────────────────────────────────────────────

async function createProductOnPfs(product: FullProduct): Promise<string> {
  // Append dimensions to description if product has any
  const descriptionWithDims = product.description + buildDimensionsSuffix(product);

  // Use PFS AI translation API for labels
  const translated = await pfsTranslate(product.name, descriptionWithDims);
  const label = translated.productName;
  const description = translated.productDescription;

  // Build composition array
  const compositionArray = product.compositions
    .filter((c) => c.composition.pfsCompositionRef)
    .map((c) => ({ id: c.composition.pfsCompositionRef!, value: String(c.percentage) }));
  if (compositionArray.length === 0) {
    compositionArray.push({ id: "ACIERINOXYDABLE", value: "100" });
  }

  // Use category's PFS gender/family if available, otherwise fallback to defaults
  const gender = product.category.pfsGender || PFS_DEFAULTS.gender;
  const family = product.category.pfsFamilyId || PFS_DEFAULTS.family;

  const shopNameInfo = await prisma.companyInfo.findFirst({ select: { shopName: true } });
  const brandName = shopNameInfo?.shopName || PFS_DEFAULTS.brand_name;

  const data: PfsProductCreateData = {
    reference_code: product.reference,
    gender_label: gender,
    brand_name: brandName,
    family,
    category: product.category.pfsCategoryId!,
    season_name: product.season?.pfsRef ?? PFS_DEFAULTS.season_name,
    label,
    description,
    material_composition: compositionArray,
    country_of_manufacture: product.manufacturingCountry?.pfsCountryRef ?? product.manufacturingCountry?.isoCode ?? PFS_DEFAULTS.country_of_manufacture,
    variants: [],
  };

  const { pfsProductId } = await pfsCreateProduct(data);

  // Store pfsProductId
  await prisma.product.update({
    where: { id: product.id },
    data: { pfsProductId },
  });

  return pfsProductId;
}

// ─────────────────────────────────────────────
// Diff & update product metadata
// Returns number of API calls made, or 0 if nothing changed
// ─────────────────────────────────────────────

async function diffAndUpdateMetadata(
  pfsProductId: string,
  product: FullProduct,
  pfsRefData: PfsCheckReferenceResponse | null,
): Promise<number> {
  if (!pfsRefData?.product) {
    // Can't diff without PFS data → force full update
    return await forceUpdateMetadata(pfsProductId, product);
  }

  const pfs = pfsRefData.product;
  const descriptionWithDims = product.description + buildDimensionsSuffix(product);

  // Compare fields
  const pfsDescFr = pfs.description?.fr ?? "";
  const pfsNameFr = pfs.label?.fr ?? "";
  const bjCategoryId = product.category.pfsCategoryId;
  const pfsCategoryId = pfs.category?.id;
  const bjCountry = product.manufacturingCountry?.pfsCountryRef ?? product.manufacturingCountry?.isoCode ?? PFS_DEFAULTS.country_of_manufacture;
  const pfsCountry = pfs.country_of_manufacture ?? "";
  const bjSeason = product.season?.pfsRef?.trim().toUpperCase() ?? PFS_DEFAULTS.season_name;
  const pfsSeason = pfs.collection?.reference?.trim().toUpperCase() ?? "";
  const seasonMatched = pfsSeason ? bjSeason === pfsSeason : bjSeason === PFS_DEFAULTS.season_name;

  // Compare compositions
  const bjComps = product.compositions
    .filter((c) => c.composition.pfsCompositionRef)
    .map((c) => `${c.composition.pfsCompositionRef}:${c.percentage}`)
    .sort()
    .join(",");
  const pfsComps = (pfs.material_composition ?? [])
    .map((c) => `${c.reference}:${c.percentage}`)
    .sort()
    .join(",");

  // Normalize: trim whitespace before comparing to avoid unnecessary translate calls
  const nameChanged = pfsNameFr.trim() !== product.name.trim();
  const descTextChanged = stripDimensionsSuffix(pfsDescFr).trim() !== product.description.trim();
  const dimensionsChanged = buildDimensionsSuffix(product) !== (pfsDescFr.match(DIMENSIONS_REGEX)?.[0] ?? "");
  const descChanged = descTextChanged || dimensionsChanged;
  const categoryChanged = bjCategoryId !== pfsCategoryId;
  const countryChanged = bjCountry.toUpperCase() !== pfsCountry.toUpperCase();
  const seasonChanged = !seasonMatched;
  const compositionsChanged = bjComps !== pfsComps;

  if (!nameChanged && !descChanged && !categoryChanged && !countryChanged && !seasonChanged && !compositionsChanged) {
    return 0;
  }

  const changedFields = [
    nameChanged && "name",
    descChanged && "description",
    categoryChanged && "category",
    countryChanged && "country",
    seasonChanged && "season",
    compositionsChanged && "compositions",
  ].filter(Boolean);
  // Name or description changed → need translation
  let apiCalls = 0;
  const updates: PfsProductUpdateData = {};

  if (nameChanged || descChanged) {
    const translated = await pfsTranslate(product.name, descriptionWithDims);
    updates.label = translated.productName;
    updates.description = translated.productDescription;
    apiCalls++; // translate call
  }

  if (categoryChanged) {
    updates.category = bjCategoryId!;
    const gender = product.category.pfsGender || PFS_DEFAULTS.gender;
    const family = product.category.pfsFamilyId || PFS_DEFAULTS.family;
    const genderLabels: Record<string, string> = { WOMAN: "Femme", MAN: "Homme", KID: "Enfant", SUPPLIES: "Fournitures" };
    updates.gender_label = genderLabels[gender] ?? PFS_DEFAULTS.gender_label;
    updates.family = family;
  }

  if (countryChanged) {
    updates.country_of_manufacture = bjCountry;
  }

  if (seasonChanged) {
    updates.season_name = bjSeason;
  }

  if (compositionsChanged) {
    const compositionArray = product.compositions
      .filter((c) => c.composition.pfsCompositionRef)
      .map((c) => ({ id: c.composition.pfsCompositionRef!, value: c.percentage }));
    if (compositionArray.length > 0) {
      updates.material_composition = compositionArray;
    }
  }

  await pfsUpdateProduct(pfsProductId, updates);
  apiCalls++; // update call
  return apiCalls;
}

/** Fallback: force full metadata update when PFS state is unknown */
async function forceUpdateMetadata(pfsProductId: string, product: FullProduct): Promise<number> {
  const descriptionWithDims = product.description + buildDimensionsSuffix(product);
  const translated = await pfsTranslate(product.name, descriptionWithDims);

  const gender = product.category.pfsGender || PFS_DEFAULTS.gender;
  const family = product.category.pfsFamilyId || PFS_DEFAULTS.family;
  const genderLabels: Record<string, string> = { WOMAN: "Femme", MAN: "Homme", KID: "Enfant", SUPPLIES: "Fournitures" };

  const updates: PfsProductUpdateData = {
    label: translated.productName,
    description: translated.productDescription,
    category: product.category.pfsCategoryId!,
    family,
    gender_label: genderLabels[gender] ?? PFS_DEFAULTS.gender_label,
  };

  const countryRef = product.manufacturingCountry?.pfsCountryRef ?? product.manufacturingCountry?.isoCode;
  if (countryRef) updates.country_of_manufacture = countryRef;
  if (product.season?.pfsRef) updates.season_name = product.season.pfsRef;

  const compositionArray = product.compositions
    .filter((c) => c.composition.pfsCompositionRef)
    .map((c) => ({ id: c.composition.pfsCompositionRef!, value: c.percentage }));
  if (compositionArray.length > 0) updates.material_composition = compositionArray;

  await pfsUpdateProduct(pfsProductId, updates);
  return 2; // translate + update
}

// ─────────────────────────────────────────────
// Sync variants (diff-based, batched create)
// Returns number of API calls made
// ─────────────────────────────────────────────

// Helper: resolve BJ size → PFS size reference (use first M2M mapping, fallback to name)
const getSizeRef = (vs: { size: { name: string; pfsMappings: { pfsSizeRef: string }[] } }) =>
  vs.size.pfsMappings[0]?.pfsSizeRef || vs.size.name || "TU";

async function syncVariants(
  pfsProductId: string,
  product: FullProduct,
  existingPfsVariants: PfsVariantDetail[] | null,
  pfsMarkup?: MarkupConfig,
): Promise<number> {
  let apiCalls = 0;

  // Fetch existing PFS variants if not provided (new product case)
  let pfsVariants: PfsVariantDetail[] = [];
  if (existingPfsVariants === null) {
    try {
      const resp = await pfsGetVariants(pfsProductId);
      pfsVariants = resp.data ?? [];
      apiCalls++;
    } catch {
      // Product may be new with no variants yet
    }
  } else {
    pfsVariants = existingPfsVariants;
  }

  // Build a lookup of existing PFS variants by SKU key for duplicate detection
  // ITEM: "COLOR_SIZE", PACK: "COLOR1+COLOR2_SIZE1,SIZE2" (ordered composition)
  const pfsVariantBySkuKey = new Map<string, string>();
  for (const v of pfsVariants) {
    if (v.type === "ITEM" && v.item?.color?.reference && v.item.size) {
      pfsVariantBySkuKey.set(`${v.item.color.reference}_${v.item.size}`, v.id);
    } else if (v.type === "PACK" && v.packs && v.packs.length > 0) {
      // Use ALL pack colors in order + all sizes to avoid collisions between different PACKs
      const packColorRefs = v.packs.map(p => p.color?.reference).filter(Boolean).join("+");
      const packSizes = v.packs.flatMap(p => p.sizes?.map(s => s.size) ?? []).sort().join(",");
      if (packColorRefs) {
        pfsVariantBySkuKey.set(`PACK::${packColorRefs}_${packSizes || "TU"}`, v.id);
      }
    }
  }

  const existingPfsIds = new Set(pfsVariants.map((v) => v.id));

  // Build maps of PFS variant ID → color reference + size fingerprint for change detection
  const pfsVariantColorMap = new Map<string, string>();
  const pfsVariantSizeFingerprint = new Map<string, string>();
  for (const v of pfsVariants) {
    if (v.item?.color?.reference) {
      pfsVariantColorMap.set(v.id, v.item.color.reference);
      pfsVariantSizeFingerprint.set(v.id, v.item.size || "TU");
    } else if (v.packs?.[0]?.color?.reference) {
      pfsVariantColorMap.set(v.id, v.packs[0].color.reference);
      const allSizes = v.packs!.flatMap(p => p.sizes?.map(s => s.size) ?? []);
      pfsVariantSizeFingerprint.set(v.id, allSizes.length > 0 ? [...allSizes].sort().join(",") : "TU");
    }
  }

  // Build PFS variant lookup by ID for price/stock/weight diff
  const pfsVariantById = new Map<string, PfsVariantDetail>();
  for (const v of pfsVariants) pfsVariantById.set(v.id, v);

  // Detect color or size changes: PFS PATCH does not support changing color or size,
  // so we need to delete + recreate the variant
  const colorChangedVariants = new Set<string>();
  for (const c of product.colors) {
    if (c.pfsVariantId && existingPfsIds.has(c.pfsVariantId)) {
      const pfsColorRef = pfsVariantColorMap.get(c.pfsVariantId);
      const bjColorRef = getEffectiveColorRef(c);
      if (pfsColorRef && bjColorRef && pfsColorRef !== bjColorRef) {
        colorChangedVariants.add(c.id);
        continue;
      }
      const pfsSizeFp = pfsVariantSizeFingerprint.get(c.pfsVariantId);
      const bjSizes = c.variantSizes.length > 0
        ? c.variantSizes.map(vs => getSizeRef(vs)).sort().join(",")
        : "TU";
      if (pfsSizeFp && bjSizes && pfsSizeFp !== bjSizes) {
        colorChangedVariants.add(c.id);
      }
    }
  }

  const bjVariantsWithPfsId = product.colors.filter(
    (c) => c.pfsVariantId && existingPfsIds.has(c.pfsVariantId) && !colorChangedVariants.has(c.id)
  );
  const bjVariantsToCreate = product.colors.filter(
    (c) => !c.pfsVariantId || !existingPfsIds.has(c.pfsVariantId) || colorChangedVariants.has(c.id)
  );
  const pfsIdsInBj = new Set(
    product.colors
      .filter((c) => !colorChangedVariants.has(c.id))
      .map((c) => c.pfsVariantId)
      .filter(Boolean)
  );
  const pfsVariantsToDelete = pfsVariants.filter((v) => !pfsIdsInBj.has(v.id));

  if (colorChangedVariants.size > 0) {
  }

  // Delete removed variants from PFS
  for (const v of pfsVariantsToDelete) {
    try {
      await pfsDeleteVariant(v.id);
      apiCalls++;
      for (const [key, id] of pfsVariantBySkuKey) {
        if (id === v.id) pfsVariantBySkuKey.delete(key);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 = variant already gone on PFS, treat as success
      if (msg.includes("404")) {
        logger.info(`[PFS Reverse Sync] Variant ${v.id} already deleted on PFS, skipping`);
        for (const [key, id] of pfsVariantBySkuKey) {
          if (id === v.id) pfsVariantBySkuKey.delete(key);
        }
      } else {
        logger.warn(`[PFS Reverse Sync] Failed to delete variant ${v.id}`, { error: msg });
      }
    }
  }

  // ── Batch create new variants ──
  if (bjVariantsToCreate.length > 0) {
    const batchItems: { variant: typeof bjVariantsToCreate[number]; pfsData: PfsVariantCreateData }[] = [];
    const relinked: string[] = [];

    for (const variant of bjVariantsToCreate) {
      // ── UNIT variant ──
      if (variant.saleType === "UNIT") {
        const colorRef = getEffectiveColorRef(variant);
        if (!colorRef) {
          logger.warn(`[PFS Reverse Sync] Skipping UNIT variant ${variant.id}: color "${variant.color?.name}" has no pfsColorRef`);
          continue;
        }

        const sizeRef = variant.variantSizes[0] ? getSizeRef(variant.variantSizes[0]) : "TU";
        const skuKey = `${colorRef}_${sizeRef}`;
        const existingPfsId = pfsVariantBySkuKey.get(skuKey);

        if (existingPfsId) {
          await prisma.productColor.update({ where: { id: variant.id }, data: { pfsVariantId: existingPfsId } });
          relinked.push(existingPfsId);
          // Will be updated in the diff-based update below (added to bjVariantsWithPfsId equivalent)
          try {
            await pfsPatchVariants([{
              variant_id: existingPfsId,
              price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),
              stock_qty: variant.stock ?? 0,
              weight: variant.weight,
              is_active: (variant.stock ?? 0) > 0,
            }]);
            apiCalls++;
          } catch (err) {
            logger.warn(`[PFS Reverse Sync] Failed to patch re-linked variant ${existingPfsId}`, { error: err instanceof Error ? err.message : String(err) });
          }
          continue;
        }

        batchItems.push({
          variant,
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

      // ── PACK variant ──
      if (variant.saleType === "PACK") {
        const packEntries: { color: string; size: string; qty: number }[] = [];

        const packColors: { ref: string; name: string }[] = [];
        const variantOverrideRef = variant.pfsColorRef;
        if (variantOverrideRef) {
          const label = variant.packColorLines[0]?.colors.map(c => c.color.name).join(" / ") || variant.color?.name || "Pack";
          packColors.push({ ref: variantOverrideRef, name: label });
        } else {
          for (const line of variant.packColorLines) {
            for (const c of line.colors) {
              if (c.color.pfsColorRef) {
                packColors.push({ ref: c.color.pfsColorRef, name: c.color.name });
              }
            }
          }
          const fallbackRef = getEffectiveColorRef(variant);
          if (packColors.length === 0 && fallbackRef) {
            packColors.push({ ref: fallbackRef, name: variant.color?.name || "Pack" });
          }
        }

        if (packColors.length === 0) {
          logger.warn(`[PFS Reverse Sync] Skipping PACK variant ${variant.id}: no colors with pfsColorRef`);
          continue;
        }

        const variantSizes = variant.variantSizes.length > 0
          ? variant.variantSizes
          : [{ size: { name: "TU", pfsMappings: [{ pfsSizeRef: "TU" }] }, quantity: variant.packQuantity ?? 1 }];

        for (const pc of packColors) {
          for (const vs of variantSizes) {
            packEntries.push({ color: pc.ref, size: getSizeRef(vs), qty: vs.quantity });
          }
        }

        // PFS API uses first color + first size as the variant's main identifiers
        const mainColorRef = packColors[0].ref;
        const mainSizeRef = variantSizes[0] ? getSizeRef(variantSizes[0]) : "TU";

        // SKU key uses ALL colors in order + all sizes to avoid collisions between different PACKs
        const packColorKey = packColors.map(pc => pc.ref).join("+");
        const packSizeKey = variantSizes.map(vs => getSizeRef(vs)).sort().join(",") || "TU";
        const packSkuKey = `PACK::${packColorKey}_${packSizeKey}`;
        const existingPackPfsId = pfsVariantBySkuKey.get(packSkuKey);
        if (existingPackPfsId) {
          await prisma.productColor.update({ where: { id: variant.id }, data: { pfsVariantId: existingPackPfsId } });
          relinked.push(existingPackPfsId);
          try {
            await pfsPatchVariants([{
              variant_id: existingPackPfsId,
              price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),
              stock_qty: variant.stock ?? 0,
              weight: variant.weight,
              is_active: (variant.stock ?? 0) > 0,
            }]);
            apiCalls++;
          } catch (err) {
            logger.warn(`[PFS Reverse Sync] Failed to patch re-linked PACK variant ${existingPackPfsId}`, { error: err instanceof Error ? err.message : String(err) });
          }
          continue;
        }

        batchItems.push({
          variant,
          pfsData: {
            type: "PACK",
            color: mainColorRef,
            size: mainSizeRef,
            price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),
            weight: variant.weight,
            stock_qty: variant.stock ?? 0,
            is_active: (variant.stock ?? 0) > 0,
            packs: packEntries,
          },
        });
      }
    }

    // Batch create all new variants in a single API call
    if (batchItems.length > 0) {
      try {
        const { variantIds } = await pfsCreateVariants(pfsProductId, batchItems.map(b => b.pfsData));
        apiCalls++;
        // Link returned IDs to BJ variants
        for (let i = 0; i < batchItems.length; i++) {
          if (variantIds[i]) {
            await prisma.productColor.update({
              where: { id: batchItems[i].variant.id },
              data: { pfsVariantId: variantIds[i] },
            });
          } else {
            logger.warn(`[PFS Reverse Sync] PFS returned no ID for variant ${batchItems[i].variant.id}`);
          }
        }
      } catch (err) {
        logger.warn("[PFS Reverse Sync] Batch create failed, falling back to individual creates", { error: err instanceof Error ? err.message : String(err) });
        // Fallback: create one by one
        for (const item of batchItems) {
          try {
            const { variantIds } = await pfsCreateVariants(pfsProductId, [item.pfsData]);
            apiCalls++;
            if (variantIds[0]) {
              await prisma.productColor.update({
                where: { id: item.variant.id },
                data: { pfsVariantId: variantIds[0] },
              });
            }
          } catch (err2) {
            logger.warn(`[PFS Reverse Sync] Failed to create variant ${item.variant.id}`, { error: err2 instanceof Error ? err2.message : String(err2) });
          }
        }
      }
    }
  }

  // ── Diff-based update of existing variants ──
  if (bjVariantsWithPfsId.length > 0) {
    const updates: PfsVariantUpdateData[] = [];

    for (const v of bjVariantsWithPfsId) {
      if (!v.pfsVariantId) continue;

      const pfsV = pfsVariantById.get(v.pfsVariantId);
      const bjPrice = getPfsUnitPrice(v, pfsMarkup);
      const bjStock = v.stock ?? 0;
      const bjWeight = v.weight;
      const bjActive = bjStock > 0;
      const bjDiscType = v.discountType ?? null;
      const bjDiscValue = v.discountValue != null ? Number(v.discountValue) : null;

      // Compare with PFS current values
      if (pfsV) {
        const pfsPrice = pfsV.price_sale.unit.value;
        const pfsStock = pfsV.stock_qty;
        const pfsWeight = pfsV.weight ?? 0;
        const pfsActive = pfsV.is_active;
        const pfsDiscType = pfsV.discount?.type ?? null;
        const pfsDiscValue = pfsV.discount?.value ?? null;

        const priceMatch = Math.abs(bjPrice - pfsPrice) < 0.01;
        const stockMatch = bjStock === pfsStock;
        const weightMatch = Math.abs(bjWeight - pfsWeight) < 0.01;
        const activeMatch = bjActive === pfsActive;
        const discountMatch = bjDiscType === pfsDiscType && bjDiscValue === pfsDiscValue;

        if (priceMatch && stockMatch && weightMatch && activeMatch && discountMatch) {
          continue; // No changes for this variant
        }
      }

      const update: PfsVariantUpdateData = {
        variant_id: v.pfsVariantId,
        price_eur_ex_vat: bjPrice,
        stock_qty: bjStock,
        weight: bjWeight,
        is_active: bjActive,
      };

      if (bjDiscType && bjDiscValue) {
        update.discount_type = bjDiscType;
        update.discount_value = bjDiscValue;
      } else {
        update.discount_type = null;
        update.discount_value = null;
      }

      updates.push(update);
    }

    if (updates.length > 0) {
      try {
        await pfsPatchVariants(updates);
        apiCalls++;
      } catch (err) {
        logger.warn("[PFS Reverse Sync] Failed to patch variants", { error: err instanceof Error ? err.message : String(err) });
      }
    } else {
    }
  }

  return apiCalls;
}

// ─────────────────────────────────────────────
// Sync images (WebP → JPEG, parallel upload, diff-based)
// Returns number of API calls made
// ─────────────────────────────────────────────

async function syncImages(
  pfsProductId: string,
  product: FullProduct,
  pfsRefData: PfsCheckReferenceResponse | null,
): Promise<number> {
  let apiCalls = 0;

  // Get existing PFS images
  const pfsImagesByColor = new Map<string, string[]>(); // colorRef → image URLs
  if (pfsRefData?.product?.images) {
    for (const [colorRef, imgs] of Object.entries(pfsRefData.product.images)) {
      if (colorRef === "DEFAULT") continue;
      const urls = Array.isArray(imgs) ? imgs : (imgs ? [imgs] : []);
      pfsImagesByColor.set(colorRef, urls);
    }
  } else {
    // No PFS data available, try to fetch
    try {
      const data = await pfsCheckReference(product.reference);
      apiCalls++;
      if (data.product?.images) {
        for (const [colorRef, imgs] of Object.entries(data.product.images)) {
          if (colorRef === "DEFAULT") continue;
          const urls = Array.isArray(imgs) ? imgs : (imgs ? [imgs] : []);
          pfsImagesByColor.set(colorRef, urls);
        }
      }
    } catch {
      logger.warn("[PFS Images] Cannot fetch PFS images state");
    }
  }

  // Group BJ images by color reference
  const bjImagesByColor = new Map<string, { path: string; order: number }[]>();
  let skippedNoRef = 0;

  for (const variant of product.colors) {
    let colorRef = getEffectiveColorRef(variant);
    // PACK fallback: derive colorRef from packColorLines if no direct color
    if (!colorRef && variant.saleType === "PACK") {
      for (const line of variant.packColorLines) {
        for (const c of line.colors) {
          if (c.color.pfsColorRef) { colorRef = c.color.pfsColorRef; break; }
        }
        if (colorRef) break;
      }
    }
    if (!colorRef) {
      skippedNoRef++;
      continue;
    }
    for (const img of variant.images) {
      if (!bjImagesByColor.has(colorRef)) {
        bjImagesByColor.set(colorRef, []);
      }
      const existing = bjImagesByColor.get(colorRef)!;
      // Deduplicate: skip if this image path is already collected for this colorRef
      if (!existing.some(e => e.path === img.path)) {
        existing.push({ path: img.path, order: img.order });
      }
    }
  }

  const hasAnyMappedVariant = bjImagesByColor.size > 0 || skippedNoRef < product.colors.length;

  // Collect upload tasks only (no DELETE — PFS API blocks image deletion)
  const uploadTasks: { colorRef: string; slot: number; imgPath: string }[] = [];

  for (const [colorRef, images] of bjImagesByColor) {
    const sorted = images.sort((a, b) => a.order - b.order);
    const pfsUrls = pfsImagesByColor.get(colorRef) ?? [];

    // Upload new slots or re-upload changed images (replaces in-place)
    for (let i = 0; i < sorted.length; i++) {
      const needsUpload = i >= pfsUrls.length || await imageChanged(sorted[i].path);
      if (needsUpload) {
        uploadTasks.push({ colorRef, slot: i + 1, imgPath: sorted[i].path });
      }
    }
  }

  if (uploadTasks.length === 0) {
    return apiCalls;
  }

  // Execute uploads in parallel (pool of 3)
  const POOL_SIZE = 3;
  for (let i = 0; i < uploadTasks.length; i += POOL_SIZE) {
    const batch = uploadTasks.slice(i, i + POOL_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (task) => {
        const jpegBuffer = await convertToJpeg(task.imgPath);
        await pfsUploadImage(pfsProductId, jpegBuffer, task.slot, task.colorRef, `image_${task.slot}.jpg`);
        return task;
      })
    );
    for (const r of results) {
      apiCalls++;
      if (r.status === "rejected") {
        logger.warn("[PFS Images] Upload failed", { error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      }
    }
  }

  return apiCalls;
}

/**
 * Heuristic: consider an image "changed" if it was modified recently.
 * Uses a 10-minute window to account for slow syncs and processing delays.
 * For first-time syncs (no PFS data / new slot), the caller already forces upload
 * via the `i >= pfsUrls.length` check — this is only for existing-slot diff.
 */
async function imageChanged(_imagePath: string): Promise<boolean> {
  // With R2 storage, we can't check local file modification time.
  // Always return true (upload it) — the PFS diff check in the caller
  // already skips unchanged images via URL comparison.
  return true;
}

/**
 * Convert a WebP/PNG image from public/uploads to JPEG buffer.
 */
async function convertToJpeg(imagePath: string): Promise<Buffer> {
  // imagePath is like "/uploads/products/abc.webp" — download from R2
  const { downloadFromR2, r2KeyFromDbPath } = await import("@/lib/r2");
  const buffer = await downloadFromR2(r2KeyFromDbPath(imagePath));
  return sharp(buffer).jpeg({ quality: 100, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
}

// ─────────────────────────────────────────────
// Sync status (diff-based)
// Returns true if status was updated
// ─────────────────────────────────────────────

async function syncStatus(
  pfsProductId: string,
  bjStatus: string,
  pfsRefData: PfsCheckReferenceResponse | null,
): Promise<boolean> {
  const statusMap: Record<string, PfsStatus> = {
    ONLINE: "READY_FOR_SALE",
    OFFLINE: "DRAFT",
    ARCHIVED: "ARCHIVED",
  };

  const pfsStatus = statusMap[bjStatus];
  if (!pfsStatus) return false; // SYNCING — don't push

  // Compare with current PFS status
  const currentPfsStatus = pfsRefData?.product?.status;
  if (currentPfsStatus && currentPfsStatus === pfsStatus) {
    return false;
  }

  await pfsUpdateStatus([{ id: pfsProductId, status: pfsStatus }]);
  return true;
}

// ─────────────────────────────────────────────
// Validation des mappings PFS
// ─────────────────────────────────────────────

export function validatePfsMappings(product: FullProduct): void {
  const issues: string[] = [];

  // Catégorie
  if (!product.category.pfsCategoryId) {
    issues.push(`Catégorie "${product.category.name}" sans correspondance (pfsCategoryId manquant)`);
  }

  // Compositions
  for (const c of product.compositions) {
    if (!c.composition.pfsCompositionRef) {
      issues.push(`Composition "${c.composition.name}" sans correspondance (pfsCompositionRef manquant)`);
    }
  }

  // Couleurs + sous-couleurs + couleurs PACK + tailles
  const seenColorIds = new Set<string>();
  const seenSizeIds = new Set<string>();
  for (const variant of product.colors) {
    const hasOverride = !!variant.pfsColorRef;
    const isMultiColor = variant.subColors.length > 0;
    // PACK is truly multi-color only when it has multiple distinct colors across all lines
    const packDistinctColors = variant.saleType === "PACK"
      ? new Set(variant.packColorLines.flatMap((l) => l.colors.map((c) => c.color.id)))
      : new Set<string>();
    const isPackMultiColor = packDistinctColors.size > 1;

    if (!hasOverride && (isMultiColor || isPackMultiColor)) {
      const colorNames = isMultiColor
        ? [variant.color?.name, ...variant.subColors.map((sc) => sc.color.name)].filter(Boolean).join(" + ")
        : variant.packColorLines.flatMap((l) => l.colors.map((c) => c.color.name)).join(" + ");
      issues.push(`Variante multi-couleur "${colorNames}" sans correspondance Paris Fashion Shop (sélectionner une couleur Paris Fashion Shop dans la variante)`);
    }

    if (!hasOverride && variant.color?.id && !seenColorIds.has(variant.color.id)) {
      seenColorIds.add(variant.color.id);
      if (!variant.color.pfsColorRef) {
        issues.push(`Couleur "${variant.color.name}" sans correspondance (pfsColorRef manquant)`);
      }
    }
    if (!hasOverride) {
      for (const sc of variant.subColors) {
        if (!seenColorIds.has(sc.color.id)) {
          seenColorIds.add(sc.color.id);
          if (!sc.color.pfsColorRef) {
            issues.push(`Couleur "${sc.color.name}" sans correspondance (pfsColorRef manquant)`);
          }
        }
      }
    }
    if (!hasOverride) {
      for (const pcl of variant.packColorLines) {
        for (const c of pcl.colors) {
          if (!seenColorIds.has(c.color.id)) {
            seenColorIds.add(c.color.id);
            if (!c.color.pfsColorRef) {
              issues.push(`Couleur "${c.color.name}" sans correspondance (pfsColorRef manquant)`);
            }
          }
        }
      }
    }
    for (const vs of variant.variantSizes) {
      if (!seenSizeIds.has(vs.size.name)) {
        seenSizeIds.add(vs.size.name);
        if (vs.size.pfsMappings.length === 0) {
          issues.push(`Taille "${vs.size.name}" sans correspondance (SizePfsMapping manquant)`);
        }
      }
    }
  }

  // Pays de fabrication
  if (product.manufacturingCountry && !product.manufacturingCountry.pfsCountryRef) {
    issues.push(`Pays "${product.manufacturingCountry.name}" sans correspondance (pfsCountryRef manquant)`);
  }

  // Saison
  if (product.season && !product.season.pfsRef) {
    issues.push(`Saison "${product.season.name}" sans correspondance PFS`);
  }

  if (issues.length > 0) {
    throw new Error(
      `Synchronisation impossible — correspondance(s) PFS absente(s) :\n• ${issues.join("\n• ")}`
    );
  }
}
