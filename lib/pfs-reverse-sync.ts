/**
 * PFS Reverse Sync — Push Beli Jolie products → Paris Fashion Shop
 *
 * Non-blocking: called after DB save, runs in background.
 * Updates Product.pfsSyncStatus to track progress.
 *
 * Flow:
 *  1. Load product with all relations (colors, compositions, images)
 *  2. If no pfsProductId → create product on PFS
 *  3. Sync product data (label, description, category, compositions)
 *  4. Sync variants (create new, update existing, delete removed)
 *  5. Sync images (WebP → JPEG conversion, upload to PFS)
 *  6. Sync status (ONLINE→READY_FOR_SALE, OFFLINE→DRAFT, ARCHIVED→ARCHIVED)
 *  7. Update pfsSyncStatus = "synced" on success, "failed" on error
 */

import { prisma } from "@/lib/prisma";
import {
  pfsCreateProduct,
  pfsUpdateProduct,
  pfsCreateVariants,
  pfsPatchVariants,
  pfsDeleteVariant,
  pfsUploadImage,
  pfsDeleteImage,
  pfsUpdateStatus,
  pfsTranslate,
  type PfsProductCreateData,
  type PfsProductUpdateData,
  type PfsVariantCreateData,
  type PfsVariantUpdateData,
  type PfsStatus,
} from "@/lib/pfs-api-write";
import { pfsGetVariants, pfsCheckReference } from "@/lib/pfs-api";
import sharp from "sharp";
import { readFile } from "fs/promises";
import path from "path";

// Prices are sent as-is to PFS (no markup)

// Default values for PFS product creation
const PFS_DEFAULTS = {
  gender: "WOMAN",
  gender_label: "Femme",
  brand_name: "Beli & Jolie",
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
    console.error(`[PFS Reverse Sync] Fatal error for ${productId}:`, err);
  });
}

/**
 * Core sync logic. Call via triggerPfsSync() for non-blocking behavior.
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

    // Vérification des mappings PFS (bloque la sync si une entité n'est pas mappée)
    validatePfsMappings(product);

    // 2. Create or update product on PFS
    let pfsProductId = product.pfsProductId;
    if (!pfsProductId) {
      pfsProductId = await createProductOnPfs(product);
    } else {
      await updateProductOnPfs(pfsProductId, product);
    }

    // 3. Sync variants
    await syncVariants(pfsProductId, product);

    // 3b. Set default_color AFTER variants exist on PFS
    // (PFS validates that default_color matches an existing variant's color)
    const primaryVariant = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
    const primaryColorRef = primaryVariant ? getEffectiveColorRef(primaryVariant) : null;
    if (primaryColorRef) {
      try {
        await pfsUpdateProduct(pfsProductId, { default_color: primaryColorRef });
      } catch (err) {
        console.warn(`[PFS Reverse Sync] Failed to set default_color:`, err);
      }
    }

    // 4. Sync images
    await syncImages(pfsProductId, product);

    // 5. Sync status
    await syncStatus(pfsProductId, product.status);

    // 6. Mark as synced
    await prisma.product.update({
      where: { id: productId },
      data: {
        pfsProductId,
        pfsSyncStatus: "synced",
        pfsSyncError: null,
        pfsSyncedAt: new Date(),
      },
    });

    console.log(`[PFS Reverse Sync] ✅ Product ${product.reference} synced to PFS (${pfsProductId})`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[PFS Reverse Sync] ❌ Product ${productId} failed:`, errorMsg);

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
// Load product with all needed relations
// ─────────────────────────────────────────────

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
  colors: {
    id: string;
    colorId: string;
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
  season: { id: string; name: string; pfsSeasonRef: string | null } | null;
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
          images: { select: { id: true, path: true, order: true }, orderBy: { order: "asc" as const } },
        },
        orderBy: { createdAt: "asc" as const },
      },
      compositions: {
        select: {
          compositionId: true,
          percentage: true,
          composition: { select: { id: true, name: true, pfsCompositionRef: true } },
        },
      },
      manufacturingCountry: { select: { id: true, name: true, isoCode: true, pfsCountryRef: true } },
      season: { select: { id: true, name: true, pfsSeasonRef: true } },
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
// Create product on PFS
// ─────────────────────────────────────────────

async function createProductOnPfs(product: FullProduct): Promise<string> {
  // Append dimensions to description if product has any
  const descriptionWithDims = product.description + buildDimensionsSuffix(product);

  // Use PFS AI translation API for labels
  const translated = await pfsTranslate(product.name, descriptionWithDims);
  const label = translated.productName;
  const description = translated.productDescription;

  // Get first composition reference for POST (string format required)
  const mainComposition = product.compositions[0]?.composition.pfsCompositionRef ?? "ACIERINOXYDABLE";

  // Use category's PFS gender/family if available, otherwise fallback to defaults
  const gender = product.category.pfsGender || PFS_DEFAULTS.gender;
  const family = product.category.pfsFamilyId || PFS_DEFAULTS.family;

  // Map gender code to label
  const genderLabels: Record<string, string> = { WOMAN: "Femme", MAN: "Homme", KID: "Enfant", SUPPLIES: "Fournitures" };
  const genderLabel = genderLabels[gender] ?? PFS_DEFAULTS.gender_label;

  const data: PfsProductCreateData = {
    reference: product.reference,
    reference_code: product.reference,
    gender,
    gender_label: genderLabel,
    brand_name: PFS_DEFAULTS.brand_name,
    family,
    category: product.category.pfsCategoryId!,
    season_name: product.season?.pfsSeasonRef ?? PFS_DEFAULTS.season_name,
    label,
    description,
    material_composition: mainComposition,
    country_of_manufacture: product.manufacturingCountry?.pfsCountryRef ?? product.manufacturingCountry?.isoCode ?? PFS_DEFAULTS.country_of_manufacture,
  };

  const { pfsProductId } = await pfsCreateProduct(data);

  // If multiple compositions, update with array format (works on PATCH, not POST)
  if (product.compositions.length > 1) {
    const compositionArray = product.compositions
      .filter((c) => c.composition.pfsCompositionRef)
      .map((c) => ({ id: c.composition.pfsCompositionRef!, value: c.percentage }));
    if (compositionArray.length > 0) {
      await pfsUpdateProduct(pfsProductId, { material_composition: compositionArray });
    }
  }

  // Store pfsProductId
  await prisma.product.update({
    where: { id: product.id },
    data: { pfsProductId },
  });

  return pfsProductId;
}

// ─────────────────────────────────────────────
// Update product data on PFS
// ─────────────────────────────────────────────

async function updateProductOnPfs(pfsProductId: string, product: FullProduct): Promise<void> {
  // Append dimensions to description if product has any
  const descriptionWithDims = product.description + buildDimensionsSuffix(product);

  // Use PFS AI translation API for labels
  const translated = await pfsTranslate(product.name, descriptionWithDims);
  const label = translated.productName;
  const description = translated.productDescription;

  // Use category's PFS gender/family if available, otherwise fallback to defaults
  const gender = product.category.pfsGender || PFS_DEFAULTS.gender;
  const family = product.category.pfsFamilyId || PFS_DEFAULTS.family;
  const genderLabels: Record<string, string> = { WOMAN: "Femme", MAN: "Homme", KID: "Enfant", SUPPLIES: "Fournitures" };
  const genderLabel = genderLabels[gender] ?? PFS_DEFAULTS.gender_label;

  const updates: PfsProductUpdateData = {
    label,
    description,
    category: product.category.pfsCategoryId!,
    family,
    gender_label: genderLabel,
  };

  // Country of manufacture
  const countryRef = product.manufacturingCountry?.pfsCountryRef ?? product.manufacturingCountry?.isoCode;
  if (countryRef) {
    updates.country_of_manufacture = countryRef;
  }

  // Season
  if (product.season?.pfsSeasonRef) {
    updates.season_name = product.season.pfsSeasonRef;
  }

  // Compositions as array (works on PATCH)
  const compositionArray = product.compositions
    .filter((c) => c.composition.pfsCompositionRef)
    .map((c) => ({ id: c.composition.pfsCompositionRef!, value: c.percentage }));
  if (compositionArray.length > 0) {
    updates.material_composition = compositionArray;
  }

  // NOTE: default_color is NOT sent here — it's set after syncVariants()
  // because PFS validates that default_color matches an existing variant's color,
  // and variants may not exist yet at this point.

  await pfsUpdateProduct(pfsProductId, updates);
}

// ─────────────────────────────────────────────
// Sync variants
// ─────────────────────────────────────────────

async function syncVariants(pfsProductId: string, product: FullProduct): Promise<void> {
  // Get existing PFS variants
  let existingPfsVariants: { id: string; type: string; item?: { color: { reference: string }; size: string }; packs?: { color: { reference: string }; sizes: { size: string }[] }[] }[] = [];
  try {
    const resp = await pfsGetVariants(pfsProductId);
    existingPfsVariants = resp.data ?? [];
  } catch {
    // Product may be new with no variants yet
  }

  // Build a lookup of existing PFS variants by SKU key (color+size) for duplicate detection
  // This handles the case where a previous sync created the variant on PFS but failed
  // to save pfsVariantId back to BJ (crash, timeout, etc.)
  const pfsVariantBySkuKey = new Map<string, string>(); // "COLOR_SIZE" → pfsVariantId
  for (const v of existingPfsVariants) {
    if (v.type === "ITEM" && v.item?.color?.reference && v.item.size) {
      pfsVariantBySkuKey.set(`${v.item.color.reference}_${v.item.size}`, v.id);
    } else if (v.type === "PACK" && v.packs?.[0]) {
      // For PACK, use the first pack entry's color + size as the SKU key
      const firstPack = v.packs[0];
      if (firstPack.color?.reference && firstPack.sizes?.[0]?.size) {
        pfsVariantBySkuKey.set(`${firstPack.color.reference}_${firstPack.sizes[0].size}`, v.id);
      }
    }
  }

  const existingPfsIds = new Set(existingPfsVariants.map((v) => v.id));

  // Build a map of PFS variant ID → color reference for change detection
  const pfsVariantColorMap = new Map<string, string>();
  for (const v of existingPfsVariants) {
    if (v.item?.color?.reference) {
      pfsVariantColorMap.set(v.id, v.item.color.reference);
    }
  }

  // Detect color changes: if a BJ variant has a pfsVariantId but the color ref
  // on PFS doesn't match the current BJ color ref, we need to delete + recreate
  // (PFS PATCH does not support changing a variant's color)
  const colorChangedVariants = new Set<string>();
  for (const c of product.colors) {
    if (c.pfsVariantId && existingPfsIds.has(c.pfsVariantId)) {
      const pfsColorRef = pfsVariantColorMap.get(c.pfsVariantId);
      const bjColorRef = getEffectiveColorRef(c);
      if (pfsColorRef && bjColorRef && pfsColorRef !== bjColorRef) {
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
  const pfsVariantsToDelete = existingPfsVariants.filter((v) => !pfsIdsInBj.has(v.id));

  // Log color-changed variants for debugging
  if (colorChangedVariants.size > 0) {
    console.log(`[PFS Reverse Sync] ${colorChangedVariants.size} variant(s) with color change detected — will delete + recreate on PFS`);
  }

  // Delete removed variants from PFS
  for (const v of pfsVariantsToDelete) {
    try {
      await pfsDeleteVariant(v.id);
      // Remove from SKU lookup so we don't accidentally re-link a deleted variant
      for (const [key, id] of pfsVariantBySkuKey) {
        if (id === v.id) pfsVariantBySkuKey.delete(key);
      }
    } catch (err) {
      console.warn(`[PFS Reverse Sync] Failed to delete variant ${v.id}:`, err);
    }
  }

  // Helper: resolve BJ size → PFS size reference (use first M2M mapping, fallback to name)
  const getSizeRef = (vs: { size: { name: string; pfsMappings: { pfsSizeRef: string }[] } }) =>
    vs.size.pfsMappings[0]?.pfsSizeRef || vs.size.name || "TU";

  // Create new variants
  if (bjVariantsToCreate.length > 0) {
    for (const variant of bjVariantsToCreate) {
      // ── UNIT variant ──
      if (variant.saleType === "UNIT") {
        const colorRef = getEffectiveColorRef(variant);
        if (!colorRef) {
          console.warn(`[PFS Reverse Sync] Skipping UNIT variant ${variant.id}: color "${variant.color?.name}" has no pfsColorRef`);
          continue;
        }

        const sizeRef = variant.variantSizes[0] ? getSizeRef(variant.variantSizes[0]) : "TU";

        // Check if this color+size already exists on PFS (orphaned from a previous failed sync)
        const skuKey = `${colorRef}_${sizeRef}`;
        const existingPfsId = pfsVariantBySkuKey.get(skuKey);
        if (existingPfsId) {
          console.log(`[PFS Reverse Sync] Found existing PFS variant ${existingPfsId} for ${skuKey} — linking instead of creating`);
          await prisma.productColor.update({
            where: { id: variant.id },
            data: { pfsVariantId: existingPfsId },
          });
          // Also patch it with current BJ values
          try {
            await pfsPatchVariants([{
              variant_id: existingPfsId,
              price_eur_ex_vat: variant.unitPrice,
              stock_qty: variant.stock ?? 0,
              weight: variant.weight,
              is_active: (variant.stock ?? 0) > 0,
            }]);
          } catch (err) {
            console.warn(`[PFS Reverse Sync] Failed to patch re-linked variant ${existingPfsId}:`, err);
          }
          continue;
        }

        const pfsVariant: PfsVariantCreateData = {
          type: "ITEM",
          color: colorRef,
          size: sizeRef,
          price_eur_ex_vat: variant.unitPrice,
          weight: variant.weight,
          stock_qty: variant.stock ?? 0,
          is_active: (variant.stock ?? 0) > 0,
        };

        try {
          const { variantIds } = await pfsCreateVariants(pfsProductId, [pfsVariant]);
          if (variantIds[0]) {
            await prisma.productColor.update({
              where: { id: variant.id },
              data: { pfsVariantId: variantIds[0] },
            });
          } else {
            console.warn(`[PFS Reverse Sync] PFS returned no ID for UNIT variant ${variant.color?.name} (${skuKey}) — may be a duplicate SKU`);
          }
        } catch (err) {
          console.warn(`[PFS Reverse Sync] Failed to create UNIT variant for ${variant.color?.name}:`, err);
        }
      }

      // ── PACK variant ──
      if (variant.saleType === "PACK") {
        // Build packs[] by crossing PackColorLine colors × VariantSizes
        const packEntries: { color: string; size: string; qty: number }[] = [];

        // Collect all colors from the single PackColorLine composition
        const packColors: { ref: string; name: string }[] = [];
        for (const line of variant.packColorLines) {
          for (const c of line.colors) {
            if (c.color.pfsColorRef) {
              packColors.push({ ref: c.color.pfsColorRef, name: c.color.name });
            }
          }
        }

        // Fallback: if no PackColorLines, use effective color ref
        const fallbackRef = getEffectiveColorRef(variant);
        if (packColors.length === 0 && fallbackRef) {
          packColors.push({ ref: fallbackRef, name: variant.color.name });
        }

        if (packColors.length === 0) {
          console.warn(`[PFS Reverse Sync] Skipping PACK variant ${variant.id}: no colors with pfsColorRef`);
          continue;
        }

        // Cross-product: each color × each size
        const variantSizes = variant.variantSizes.length > 0
          ? variant.variantSizes
          : [{ size: { name: "TU", pfsMappings: [{ pfsSizeRef: "TU" }] }, quantity: variant.packQuantity ?? 1 }];

        for (const pc of packColors) {
          for (const vs of variantSizes) {
            packEntries.push({
              color: pc.ref,
              size: getSizeRef(vs),
              qty: vs.quantity,
            });
          }
        }

        // Main color/size for the variant header
        const mainColorRef = packColors[0].ref;
        const mainSizeRef = variantSizes[0] ? getSizeRef(variantSizes[0]) : "TU";

        // Check if this PACK already exists on PFS (orphaned from a previous failed sync)
        const packSkuKey = `${mainColorRef}_${mainSizeRef}`;
        const existingPackPfsId = pfsVariantBySkuKey.get(packSkuKey);
        if (existingPackPfsId) {
          console.log(`[PFS Reverse Sync] Found existing PFS PACK variant ${existingPackPfsId} for ${packSkuKey} — linking instead of creating`);
          await prisma.productColor.update({
            where: { id: variant.id },
            data: { pfsVariantId: existingPackPfsId },
          });
          try {
            await pfsPatchVariants([{
              variant_id: existingPackPfsId,
              price_eur_ex_vat: variant.unitPrice,
              stock_qty: variant.stock ?? 0,
              weight: variant.weight,
              is_active: (variant.stock ?? 0) > 0,
            }]);
          } catch (err) {
            console.warn(`[PFS Reverse Sync] Failed to patch re-linked PACK variant ${existingPackPfsId}:`, err);
          }
          continue;
        }

        const pfsVariant: PfsVariantCreateData = {
          type: "PACK",
          color: mainColorRef,
          size: mainSizeRef,
          price_eur_ex_vat: variant.unitPrice,
          weight: variant.weight,
          stock_qty: variant.stock ?? 0,
          is_active: (variant.stock ?? 0) > 0,
          packs: packEntries,
        };

        try {
          const { variantIds } = await pfsCreateVariants(pfsProductId, [pfsVariant]);
          if (variantIds[0]) {
            await prisma.productColor.update({
              where: { id: variant.id },
              data: { pfsVariantId: variantIds[0] },
            });
          } else {
            console.warn(`[PFS Reverse Sync] PFS returned no ID for PACK variant ${variant.id} (${packSkuKey}) — may be a duplicate SKU`);
          }
        } catch (err) {
          console.warn(`[PFS Reverse Sync] Failed to create PACK variant ${variant.id}:`, err);
        }
      }
    }
  }

  // Update existing variants
  if (bjVariantsWithPfsId.length > 0) {
    const updates: PfsVariantUpdateData[] = bjVariantsWithPfsId
      .filter((v) => v.pfsVariantId)
      .map((v) => {
        const update: PfsVariantUpdateData = {
          variant_id: v.pfsVariantId!,
          price_eur_ex_vat: v.unitPrice,
          stock_qty: v.stock ?? 0,
          weight: v.weight,
          is_active: (v.stock ?? 0) > 0,
        };

        // Discount
        if (v.discountType && v.discountValue) {
          update.discount_type = v.discountType;
          update.discount_value = v.discountValue;
        } else {
          update.discount_type = null;
          update.discount_value = null;
        }

        return update;
      });

    if (updates.length > 0) {
      try {
        await pfsPatchVariants(updates);
      } catch (err) {
        console.warn("[PFS Reverse Sync] Failed to patch variants:", err);
      }
    }
  }
}

// ─────────────────────────────────────────────
// Sync images (WebP → JPEG)
// ─────────────────────────────────────────────

async function syncImages(pfsProductId: string, product: FullProduct): Promise<void> {
  const log = (msg: string) => console.log(`[PFS Images] ${msg}`);

  // Get existing PFS images to know which slots to delete
  const pfsImagesByColor = new Map<string, number>(); // colorRef → number of images on PFS
  try {
    const pfsData = await pfsCheckReference(product.reference);
    if (pfsData.product?.images) {
      for (const [colorRef, imgs] of Object.entries(pfsData.product.images)) {
        const count = Array.isArray(imgs) ? imgs.length : (imgs ? 1 : 0);
        pfsImagesByColor.set(colorRef, count);
      }
    }
    log(`PFS état actuel: ${pfsImagesByColor.size} couleur(s) — ${[...pfsImagesByColor.entries()].map(([c, n]) => `${c}:${n} img`).join(", ") || "aucune"}`);
  } catch (err) {
    log(`⚠ Impossible de récupérer les images PFS existantes: ${err instanceof Error ? err.message : err}`);
  }

  // Group BJ images by color reference
  const imagesByColor = new Map<string, { path: string; order: number }[]>();

  for (const variant of product.colors) {
    const colorRef = getEffectiveColorRef(variant);
    if (!colorRef) {
      log(`⚠ Variante ${variant.id} (${variant.color?.name}) sans pfsColorRef — images ignorées`);
      continue;
    }

    for (const img of variant.images) {
      if (!imagesByColor.has(colorRef)) {
        imagesByColor.set(colorRef, []);
      }
      imagesByColor.get(colorRef)!.push({ path: img.path, order: img.order });
    }
  }

  log(`BJ état actuel: ${imagesByColor.size} couleur(s) — ${[...imagesByColor.entries()].map(([c, imgs]) => `${c}:${imgs.length} img`).join(", ") || "aucune"}`);

  // Upload BJ images + delete removed slots
  for (const [colorRef, images] of imagesByColor) {
    const sorted = images.sort((a, b) => a.order - b.order);

    for (let i = 0; i < sorted.length; i++) {
      const img = sorted[i];
      try {
        log(`📤 Upload ${colorRef} slot ${i + 1} ← ${img.path}`);
        const jpegBuffer = await convertToJpeg(img.path);
        log(`   Converti en JPEG: ${(jpegBuffer.length / 1024).toFixed(0)} Ko`);
        await pfsUploadImage(pfsProductId, jpegBuffer, i + 1, colorRef, `image_${i + 1}.jpg`);
        log(`   ✅ Upload OK`);
      } catch (err) {
        log(`   ❌ Upload ÉCHOUÉ: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Delete slots that existed on PFS but no longer exist in BJ
    const pfsCount = pfsImagesByColor.get(colorRef) ?? 0;
    if (pfsCount > sorted.length) {
      log(`🗑 ${colorRef}: PFS a ${pfsCount} images, BJ en a ${sorted.length} → suppression slots ${sorted.length + 1} à ${pfsCount}`);
    }
    for (let slot = sorted.length + 1; slot <= pfsCount; slot++) {
      try {
        log(`   🗑 DELETE ${colorRef} slot ${slot}`);
        await pfsDeleteImage(pfsProductId, slot, colorRef);
        log(`   ✅ Suppression OK`);
      } catch (err) {
        log(`   ❌ Suppression ÉCHOUÉE: ${err instanceof Error ? err.message : err}`);
      }
    }
    // Mark this color as handled
    pfsImagesByColor.delete(colorRef);
  }

  // Delete all images for colors that no longer exist in BJ
  if (pfsImagesByColor.size > 0) {
    log(`🗑 Couleurs orphelines sur PFS (supprimées côté BJ): ${[...pfsImagesByColor.keys()].join(", ")}`);
  }
  for (const [colorRef, count] of pfsImagesByColor) {
    for (let slot = 1; slot <= count; slot++) {
      try {
        log(`   🗑 DELETE orphan ${colorRef} slot ${slot}`);
        await pfsDeleteImage(pfsProductId, slot, colorRef);
        log(`   ✅ Suppression OK`);
      } catch (err) {
        log(`   ❌ Suppression ÉCHOUÉE: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  log(`Sync images terminée pour ${pfsProductId}`);
}

/**
 * Convert a WebP/PNG image from public/uploads to JPEG buffer.
 */
async function convertToJpeg(imagePath: string): Promise<Buffer> {
  // imagePath is like "/uploads/products/abc.webp" — resolve to filesystem
  const fsPath = path.join(process.cwd(), "public", imagePath);
  const buffer = await readFile(fsPath);
  return sharp(buffer).jpeg({ quality: 90 }).toBuffer();
}

// ─────────────────────────────────────────────
// Sync status
// ─────────────────────────────────────────────

async function syncStatus(pfsProductId: string, bjStatus: string): Promise<void> {
  const statusMap: Record<string, PfsStatus> = {
    ONLINE: "READY_FOR_SALE",
    OFFLINE: "DRAFT",
    ARCHIVED: "ARCHIVED",
  };

  const pfsStatus = statusMap[bjStatus];
  if (!pfsStatus) return; // SYNCING — don't push

  await pfsUpdateStatus([{ id: pfsProductId, status: pfsStatus }]);
}

// ─────────────────────────────────────────────
// Validation des mappings PFS
// ─────────────────────────────────────────────

function validatePfsMappings(product: FullProduct): void {
  const issues: string[] = [];

  // Catégorie
  if (!product.category.pfsCategoryId) {
    issues.push(`Catégorie "${product.category.name}" non mappée (pfsCategoryId manquant)`);
  }

  // Compositions
  for (const c of product.compositions) {
    if (!c.composition.pfsCompositionRef) {
      issues.push(`Composition "${c.composition.name}" non mappée (pfsCompositionRef manquant)`);
    }
  }

  // Couleurs + sous-couleurs + couleurs PACK + tailles
  const seenColorIds = new Set<string>();
  const seenSizeIds = new Set<string>();
  for (const variant of product.colors) {
    // Si la variante a un override pfsColorRef (combinaison multi-couleur), pas besoin
    // de vérifier le mapping de chaque couleur individuelle
    const hasOverride = !!variant.pfsColorRef;

    if (!hasOverride && variant.color?.id && !seenColorIds.has(variant.color.id)) {
      seenColorIds.add(variant.color.id);
      if (!variant.color.pfsColorRef) {
        issues.push(`Couleur "${variant.color.name}" non mappée (pfsColorRef manquant)`);
      }
    }
    if (!hasOverride) {
      for (const sc of variant.subColors) {
        if (!seenColorIds.has(sc.color.id)) {
          seenColorIds.add(sc.color.id);
          if (!sc.color.pfsColorRef) {
            issues.push(`Couleur "${sc.color.name}" non mappée (pfsColorRef manquant)`);
          }
        }
      }
    }
    for (const pcl of variant.packColorLines) {
      for (const c of pcl.colors) {
        if (!seenColorIds.has(c.color.id)) {
          seenColorIds.add(c.color.id);
          if (!c.color.pfsColorRef) {
            issues.push(`Couleur "${c.color.name}" non mappée (pfsColorRef manquant)`);
          }
        }
      }
    }
    for (const vs of variant.variantSizes) {
      if (!seenSizeIds.has(vs.size.name)) {
        seenSizeIds.add(vs.size.name);
        if (vs.size.pfsMappings.length === 0) {
          issues.push(`Taille "${vs.size.name}" non mappée (SizePfsMapping manquant)`);
        }
      }
    }
  }

  // Pays de fabrication
  if (product.manufacturingCountry && !product.manufacturingCountry.pfsCountryRef) {
    issues.push(`Pays "${product.manufacturingCountry.name}" non mappé (pfsCountryRef manquant)`);
  }

  // Saison
  if (product.season && !product.season.pfsSeasonRef) {
    issues.push(`Saison "${product.season.name}" non mappée (pfsSeasonRef manquant)`);
  }

  if (issues.length > 0) {
    throw new Error(
      `Synchronisation impossible — mapping(s) PFS absent(s) :\n• ${issues.join("\n• ")}`
    );
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

