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
  pfsUpdateStatus,
  pfsTranslate,
  type PfsProductCreateData,
  type PfsProductUpdateData,
  type PfsVariantCreateData,
  type PfsVariantUpdateData,
  type PfsStatus,
} from "@/lib/pfs-api-write";
import { pfsGetVariants } from "@/lib/pfs-api";
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

    // Skip if no PFS-compatible data
    if (!product.category.pfsCategoryId) {
      throw new Error(`Catégorie "${product.category.name}" non liée à PFS (pfsCategoryId manquant)`);
    }

    // 2. Create or update product on PFS
    let pfsProductId = product.pfsProductId;
    if (!pfsProductId) {
      pfsProductId = await createProductOnPfs(product);
    } else {
      await updateProductOnPfs(pfsProductId, product);
    }

    // 3. Sync variants
    await syncVariants(pfsProductId, product);

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
  category: { id: string; name: string; pfsCategoryId: string | null };
  colors: {
    id: string;
    colorId: string;
    pfsVariantId: string | null;
    unitPrice: number;
    weight: number;
    stock: number;
    isPrimary: boolean;
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    size: string | null;
    discountType: "PERCENT" | "AMOUNT" | null;
    discountValue: number | null;
    color: { id: string; name: string; pfsColorRef: string | null };
    subColors: { color: { id: string; name: string; pfsColorRef: string | null }; position: number }[];
    images: { id: string; path: string; order: number }[];
  }[];
  compositions: {
    compositionId: string;
    percentage: number;
    composition: { id: string; name: string; pfsCompositionRef: string | null };
  }[];
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
      category: { select: { id: true, name: true, pfsCategoryId: true } },
      colors: {
        select: {
          id: true,
          colorId: true,
          pfsVariantId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          size: true,
          discountType: true,
          discountValue: true,
          color: { select: { id: true, name: true, pfsColorRef: true } },
          subColors: {
            select: { color: { select: { id: true, name: true, pfsColorRef: true } }, position: true },
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
    },
  }) as unknown as FullProduct | null;
}

// ─────────────────────────────────────────────
// Create product on PFS
// ─────────────────────────────────────────────

async function createProductOnPfs(product: FullProduct): Promise<string> {
  // Use PFS AI translation API for labels
  const translated = await pfsTranslate(product.name, product.description);
  const label = translated.productName;
  const description = translated.productDescription;

  // Get first composition reference for POST (string format required)
  const mainComposition = product.compositions[0]?.composition.pfsCompositionRef ?? "ACIERINOXYDABLE";

  const data: PfsProductCreateData = {
    reference: product.reference,
    reference_code: product.reference,
    gender: PFS_DEFAULTS.gender,
    gender_label: PFS_DEFAULTS.gender_label,
    brand_name: PFS_DEFAULTS.brand_name,
    family: PFS_DEFAULTS.family,
    category: product.category.pfsCategoryId!,
    season_name: PFS_DEFAULTS.season_name,
    label,
    description,
    material_composition: mainComposition,
    country_of_manufacture: PFS_DEFAULTS.country_of_manufacture,
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
  // Use PFS AI translation API for labels
  const translated = await pfsTranslate(product.name, product.description);
  const label = translated.productName;
  const description = translated.productDescription;

  const updates: PfsProductUpdateData = {
    label,
    description,
    category: product.category.pfsCategoryId!,
  };

  // Compositions as array (works on PATCH)
  const compositionArray = product.compositions
    .filter((c) => c.composition.pfsCompositionRef)
    .map((c) => ({ id: c.composition.pfsCompositionRef!, value: c.percentage }));
  if (compositionArray.length > 0) {
    updates.material_composition = compositionArray;
  }

  // Set default_color from primary variant
  const primaryVariant = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  if (primaryVariant?.color.pfsColorRef) {
    updates.default_color = primaryVariant.color.pfsColorRef;
  }

  await pfsUpdateProduct(pfsProductId, updates);
}

// ─────────────────────────────────────────────
// Sync variants
// ─────────────────────────────────────────────

async function syncVariants(pfsProductId: string, product: FullProduct): Promise<void> {
  // Get existing PFS variants
  let existingPfsVariants: { id: string; type: string; item?: { color: { reference: string }; size: string } }[] = [];
  try {
    const resp = await pfsGetVariants(pfsProductId);
    existingPfsVariants = resp.data ?? [];
  } catch {
    // Product may be new with no variants yet
  }

  const existingPfsIds = new Set(existingPfsVariants.map((v) => v.id));
  const bjVariantsWithPfsId = product.colors.filter((c) => c.pfsVariantId && existingPfsIds.has(c.pfsVariantId));
  const bjVariantsToCreate = product.colors.filter((c) => !c.pfsVariantId || !existingPfsIds.has(c.pfsVariantId));
  const pfsIdsInBj = new Set(product.colors.map((c) => c.pfsVariantId).filter(Boolean));
  const pfsVariantsToDelete = existingPfsVariants.filter((v) => !pfsIdsInBj.has(v.id));

  // Delete removed variants from PFS
  for (const v of pfsVariantsToDelete) {
    try {
      await pfsDeleteVariant(v.id);
    } catch (err) {
      console.warn(`[PFS Reverse Sync] Failed to delete variant ${v.id}:`, err);
    }
  }

  // Create new variants
  if (bjVariantsToCreate.length > 0) {
    for (const variant of bjVariantsToCreate) {
      const colorRef = variant.color.pfsColorRef;
      if (!colorRef) {
        console.warn(`[PFS Reverse Sync] Skipping variant ${variant.id}: color "${variant.color.name}" has no pfsColorRef`);
        continue;
      }

      const pfsVariant: PfsVariantCreateData = {
        type: variant.saleType === "PACK" ? "PACK" : "ITEM",
        color: colorRef,
        size: variant.size || "TU",
        price_eur_ex_vat: variant.unitPrice,
        weight: variant.weight,
        stock_qty: variant.stock ?? 0,
        is_active: (variant.stock ?? 0) > 0,
      };

      // PACK format
      if (variant.saleType === "PACK" && variant.packQuantity) {
        pfsVariant.packs = [{ color: colorRef, size: variant.size || "TU", qty: variant.packQuantity }];
      }

      try {
        const { variantIds } = await pfsCreateVariants(pfsProductId, [pfsVariant]);
        if (variantIds[0]) {
          await prisma.productColor.update({
            where: { id: variant.id },
            data: { pfsVariantId: variantIds[0] },
          });
        }
      } catch (err) {
        console.warn(`[PFS Reverse Sync] Failed to create variant for ${variant.color.name}:`, err);
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
  // Group images by color reference
  const imagesByColor = new Map<string, { path: string; order: number }[]>();

  for (const variant of product.colors) {
    const colorRef = variant.color.pfsColorRef;
    if (!colorRef) continue;

    for (const img of variant.images) {
      if (!imagesByColor.has(colorRef)) {
        imagesByColor.set(colorRef, []);
      }
      imagesByColor.get(colorRef)!.push({ path: img.path, order: img.order });
    }
  }

  for (const [colorRef, images] of imagesByColor) {
    // Sort by order and upload each
    const sorted = images.sort((a, b) => a.order - b.order);

    for (let i = 0; i < sorted.length; i++) {
      const img = sorted[i];
      try {
        const jpegBuffer = await convertToJpeg(img.path);
        await pfsUploadImage(pfsProductId, jpegBuffer, i + 1, colorRef, `image_${i + 1}.jpg`);
      } catch (err) {
        console.warn(`[PFS Reverse Sync] Failed to upload image ${img.path} for ${colorRef}:`, err);
      }
    }
  }
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

  try {
    await pfsUpdateStatus([{ id: pfsProductId, status: pfsStatus }]);
  } catch (err) {
    // READY_FOR_SALE may fail if no images — log but don't fail the whole sync
    console.warn(`[PFS Reverse Sync] Status update to ${pfsStatus} failed:`, err);
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

