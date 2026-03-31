/**
 * eFashion Paris Reverse Sync — Push local products → eFashion Paris
 *
 * Non-blocking: called after DB save, runs in background.
 * Updates Product.efashionSyncStatus to track progress.
 *
 * Diff-based sync — only calls eFashion endpoints for fields that actually changed.
 * - Product metadata: only update if name/desc/category/price differ
 * - Colors: sync product color associations
 * - Stocks: diff-based update per color/size
 * - Images: parallel upload (pool of 3), only new/changed images
 * - Status: ONLINE → visible, OFFLINE → hidden, ARCHIVED → soft-delete
 */

import { prisma } from "@/lib/prisma";
import { ensureEfashionAuth, getEfashionVendorId } from "@/lib/efashion-auth";
import {
  efashionGetProduct,
  efashionGetProductColors,
  efashionGetProductStocks,
  efashionGetProductDescription,
  efashionGetProductPhotos,
  type EfashionProduct,
  type EfashionCouleurProduit,
  type EfashionStock,
  type EfashionDescription,
} from "@/lib/efashion-api";
import {
  createEfashionProduct,
  updateEfashionProduct,
  saveEfashionDescription,
  saveEfashionStocks,
  updateEfashionProductColors,
  setEfashionProductsVisible,
  softDeleteEfashionProducts,
  uploadEfashionImage,
} from "@/lib/efashion-api-write";
import { downloadFromR2, r2KeyFromDbPath } from "@/lib/r2";
import { logger } from "@/lib/logger";
import sharp from "sharp";

const LOG_PREFIX = "[eFashion Reverse Sync]";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface FullProduct {
  id: string;
  reference: string;
  efashionProductId: number | null;
  name: string;
  description: string;
  status: string;
  category: {
    id: string;
    name: string;
    efashionCategoryId: number | null;
  };
  colors: {
    id: string;
    colorId: string | null;
    efashionColorId: number | null;
    unitPrice: number;
    weight: number;
    stock: number;
    isPrimary: boolean;
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    sizes: { size: { name: string }; quantity: number }[];
    color: { id: string; name: string; efashionColorId: number | null } | null;
    images: { id: string; path: string; order: number }[];
  }[];
  compositions: {
    compositionId: string;
    percentage: number;
    composition: { id: string; name: string };
  }[];
  translations: {
    locale: string;
    name: string | null;
    description: string | null;
  }[];
}

// ─────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────

/**
 * Push a BJ product to eFashion. Non-blocking — fire and forget.
 * Updates efashionSyncStatus in DB on completion/failure.
 */
export function triggerEfashionSync(productId: string): void {
  syncProductToEfashion(productId).catch((err) => {
    logger.error(`${LOG_PREFIX} Background sync failed`, {
      productId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Core sync logic. Call via triggerEfashionSync() for non-blocking behavior.
 * Diff-based: only pushes changed fields to eFashion.
 */
export async function syncProductToEfashion(productId: string): Promise<void> {
  // Mark as pending
  await prisma.product.update({
    where: { id: productId },
    data: { efashionSyncStatus: "pending", efashionSyncError: null },
  });

  try {
    // 1. Authenticate
    await ensureEfashionAuth();

    // 2. Load product with all relations
    const product = await loadProductFull(productId);
    if (!product) throw new Error("Produit introuvable");

    // 3. Validate eFashion mappings
    validateEfashionMappings(product);

    const vendorId = getEfashionVendorId();
    if (!vendorId) throw new Error("eFashion vendorId non disponible — vérifier l'authentification");

    // 4. Create or update product on eFashion
    let efashionProductId = product.efashionProductId;

    if (!efashionProductId) {
      // ── New product: create + full sync ──
      efashionProductId = await createProductOnEfashion(product, vendorId);

      // Full sync: description, colors, stocks, images
      await syncDescription(efashionProductId, product, null);
      await syncColors(efashionProductId, product, null);
      await syncStocks(efashionProductId, product, null);
      await syncImages(efashionProductId, product, []);
      await syncStatus(efashionProductId, product.status, null);

      // Mark as synced
      await prisma.product.update({
        where: { id: productId },
        data: {
          efashionProductId,
          efashionSyncStatus: "synced",
          efashionSyncError: null,
          efashionSyncedAt: new Date(),
        },
      });

      logger.info(`${LOG_PREFIX} Product ${productId} created on eFashion (id=${efashionProductId})`);
      return;
    }

    // ── Existing product: fetch eFashion state for diff ──
    const [efProduct, efColors, efStocks, efDescription, efPhotos] = await Promise.all([
      efashionGetProduct(efashionProductId).catch(() => null),
      efashionGetProductColors(efashionProductId).catch(() => [] as EfashionCouleurProduit[]),
      efashionGetProductStocks(efashionProductId).catch(() => [] as EfashionStock[]),
      efashionGetProductDescription(efashionProductId).catch(() => null as EfashionDescription | null),
      efashionGetProductPhotos(efashionProductId).catch(() => [] as string[]),
    ]);

    let apiCalls = 0;

    // 5. Diff & update product metadata
    const metaCalls = await diffAndUpdateMetadata(efashionProductId, product, efProduct, vendorId);
    apiCalls += metaCalls;

    // 6. Sync description
    const descCalls = await syncDescription(efashionProductId, product, efDescription);
    apiCalls += descCalls;

    // 7. Sync colors
    const colorCalls = await syncColors(efashionProductId, product, efColors);
    apiCalls += colorCalls;

    // 8. Sync stocks
    const stockCalls = await syncStocks(efashionProductId, product, efStocks);
    apiCalls += stockCalls;

    // 9. Sync images
    const imageCalls = await syncImages(efashionProductId, product, efPhotos);
    apiCalls += imageCalls;

    // 10. Sync status
    const statusChanged = await syncStatus(efashionProductId, product.status, efProduct);
    if (statusChanged) apiCalls++;

    // 11. Mark as synced
    await prisma.product.update({
      where: { id: productId },
      data: {
        efashionProductId,
        efashionSyncStatus: "synced",
        efashionSyncError: null,
        efashionSyncedAt: new Date(),
      },
    });

    logger.info(`${LOG_PREFIX} Product ${productId} synced (${apiCalls} API calls)`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`${LOG_PREFIX} Product ${productId} failed`, { error: errorMsg });

    await prisma.product
      .update({
        where: { id: productId },
        data: {
          efashionSyncStatus: "failed",
          efashionSyncError: errorMsg.slice(0, 5000),
        },
      })
      .catch(() => {}); // Don't throw on cleanup failure
  }
}

// ─────────────────────────────────────────────
// Load product from DB
// ─────────────────────────────────────────────

async function loadProductFull(productId: string): Promise<FullProduct | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      efashionProductId: true,
      name: true,
      description: true,
      status: true,
      category: {
        select: {
          id: true,
          name: true,
          efashionCategoryId: true,
        },
      },
      colors: {
        select: {
          id: true,
          colorId: true,
          efashionColorId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          sizes: {
            select: {
              size: { select: { name: true } },
              quantity: true,
            },
          },
          color: {
            select: {
              id: true,
              name: true,
              efashionColorId: true,
            },
          },
          images: {
            select: { id: true, path: true, order: true },
            orderBy: { order: "asc" as const },
          },
        },
        orderBy: { createdAt: "asc" as const },
      },
      compositions: {
        select: {
          compositionId: true,
          percentage: true,
          composition: { select: { id: true, name: true } },
        },
      },
      translations: {
        select: { locale: true, name: true, description: true },
      },
    },
  }) as unknown as FullProduct | null;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Get the effective eFashion color ID for a variant.
 * ProductColor.efashionColorId (override) takes priority over Color.efashionColorId.
 */
function getEffectiveColorId(variant: FullProduct["colors"][number]): number | null {
  return variant.efashionColorId || variant.color?.efashionColorId || null;
}

/**
 * Get the per-unit price for eFashion.
 * PACK variants store unitPrice = totalPackPrice, so we divide by total qty.
 */
function getUnitPrice(variant: FullProduct["colors"][number]): number {
  const price = Number(variant.unitPrice);
  if (variant.saleType !== "PACK") return price;
  const totalQty =
    variant.sizes.reduce((sum, vs) => sum + vs.quantity, 0) ||
    variant.packQuantity ||
    1;
  return Math.round((price / totalQty) * 100) / 100;
}

/**
 * Map BJ sale type to eFashion "vendu_par" field.
 */
function getVenduPar(product: FullProduct): string {
  const hasPackVariant = product.colors.some((c) => c.saleType === "PACK");
  return hasPackVariant ? "assortiment" : "couleurs";
}

// ─────────────────────────────────────────────
// Create product on eFashion (first sync only)
// ─────────────────────────────────────────────

async function createProductOnEfashion(
  product: FullProduct,
  vendorId: number
): Promise<number> {
  // Primary variant for price
  const primaryVariant = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  const price = primaryVariant ? getUnitPrice(primaryVariant) : 0;
  const weight = primaryVariant?.weight ?? 0;

  const efashionProductId = await createEfashionProduct({
    id_vendeur: vendorId,
    reference: product.reference,
    id_categorie: product.category.efashionCategoryId!,
    vendu_par: getVenduPar(product),
    prix: price,
    poids: weight,
  });

  // Store efashionProductId
  await prisma.product.update({
    where: { id: product.id },
    data: { efashionProductId },
  });

  logger.info(`${LOG_PREFIX} Created eFashion product ${efashionProductId} for ${product.reference}`);
  return efashionProductId;
}

// ─────────────────────────────────────────────
// Diff & update product metadata
// ─────────────────────────────────────────────

async function diffAndUpdateMetadata(
  efashionProductId: number,
  product: FullProduct,
  efProduct: EfashionProduct | null,
  vendorId: number
): Promise<number> {
  if (!efProduct) {
    // Can't diff without eFashion data — force full update
    return forceUpdateMetadata(efashionProductId, product, vendorId);
  }

  const primaryVariant = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  const bjPrice = primaryVariant ? getUnitPrice(primaryVariant) : 0;
  const bjWeight = primaryVariant?.weight ?? 0;
  const bjCategoryId = product.category.efashionCategoryId;
  const bjVenduPar = getVenduPar(product);

  // Compare fields
  const priceChanged = Math.abs(bjPrice - Number(efProduct.prix)) >= 0.01;
  const weightChanged = Math.abs(bjWeight - efProduct.poids) >= 0.01;
  const categoryChanged = bjCategoryId !== efProduct.id_categorie;
  const venduParChanged = bjVenduPar !== efProduct.vendu_par;
  const referenceChanged = product.reference !== efProduct.reference;

  if (!priceChanged && !weightChanged && !categoryChanged && !venduParChanged && !referenceChanged) {
    return 0;
  }

  const updates: Record<string, unknown> = {};
  if (priceChanged) updates.prix = bjPrice;
  if (weightChanged) updates.poids = bjWeight;
  if (categoryChanged && bjCategoryId) updates.id_categorie = bjCategoryId;
  if (venduParChanged) updates.vendu_par = bjVenduPar;
  if (referenceChanged) updates.reference = product.reference;

  await updateEfashionProduct(efashionProductId, updates);
  return 1;
}

async function forceUpdateMetadata(
  efashionProductId: number,
  product: FullProduct,
  vendorId: number
): Promise<number> {
  const primaryVariant = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  const price = primaryVariant ? getUnitPrice(primaryVariant) : 0;
  const weight = primaryVariant?.weight ?? 0;

  await updateEfashionProduct(efashionProductId, {
    reference: product.reference,
    id_categorie: product.category.efashionCategoryId!,
    vendu_par: getVenduPar(product),
    prix: price,
    poids: weight,
  });

  return 1;
}

// ─────────────────────────────────────────────
// Sync description
// ─────────────────────────────────────────────

async function syncDescription(
  efashionProductId: number,
  product: FullProduct,
  efDescription: EfashionDescription | null
): Promise<number> {
  // Get English translation if available
  const enTranslation = product.translations.find((t) => t.locale === "en");
  const texteFr = product.description || "";
  const texteUk = enTranslation?.description || "";

  // Compare
  if (efDescription) {
    const frMatch = (efDescription.texte_fr || "") === texteFr;
    const enMatch = (efDescription.texte_uk || "") === texteUk;
    if (frMatch && enMatch) return 0;
  }

  await saveEfashionDescription(efashionProductId, {
    texte_fr: texteFr,
    texte_uk: texteUk,
  });

  return 1;
}

// ─────────────────────────────────────────────
// Sync colors
// ─────────────────────────────────────────────

async function syncColors(
  efashionProductId: number,
  product: FullProduct,
  efColors: EfashionCouleurProduit[] | null
): Promise<number> {
  // Build the set of eFashion color IDs that should be associated with this product
  const bjColorIds = new Set<number>();
  for (const variant of product.colors) {
    const colorId = getEffectiveColorId(variant);
    if (colorId) bjColorIds.add(colorId);
  }

  if (bjColorIds.size === 0) return 0;

  // Compare with existing eFashion colors
  if (efColors && efColors.length > 0) {
    const efColorIdSet = new Set(efColors.map((c) => c.id_couleur));
    const toAdd = [...bjColorIds].filter((id) => !efColorIdSet.has(id));
    const toRemove = [...efColorIdSet].filter((id) => !bjColorIds.has(id));

    if (toAdd.length === 0 && toRemove.length === 0) return 0;
  }

  // Full replace: send all BJ color IDs
  await updateEfashionProductColors(efashionProductId, [...bjColorIds]);
  return 1;
}

// ─────────────────────────────────────────────
// Sync stocks
// ─────────────────────────────────────────────

async function syncStocks(
  efashionProductId: number,
  product: FullProduct,
  efStocks: EfashionStock[] | null
): Promise<number> {
  // Build BJ stock entries by color + size
  const bjStockEntries: { id_couleur: number; taille: string | null; value: number }[] = [];

  for (const variant of product.colors) {
    const colorId = getEffectiveColorId(variant);
    if (!colorId) continue;

    if (variant.sizes.length > 0) {
      for (const vs of variant.sizes) {
        bjStockEntries.push({
          id_couleur: colorId,
          taille: vs.size.name || null,
          value: vs.quantity,
        });
      }
    } else {
      // No sizes — single stock entry per color
      bjStockEntries.push({
        id_couleur: colorId,
        taille: null,
        value: variant.stock ?? 0,
      });
    }
  }

  // Compare with existing eFashion stocks
  if (efStocks && efStocks.length > 0) {
    const efStockMap = new Map<string, number>();
    for (const s of efStocks) {
      const key = `${s.id_couleur}_${s.taille || ""}`;
      efStockMap.set(key, s.value);
    }

    const bjStockMap = new Map<string, number>();
    for (const s of bjStockEntries) {
      const key = `${s.id_couleur}_${s.taille || ""}`;
      bjStockMap.set(key, s.value);
    }

    // Check if any difference exists
    let hasDiff = bjStockMap.size !== efStockMap.size;
    if (!hasDiff) {
      for (const [key, value] of bjStockMap) {
        if (efStockMap.get(key) !== value) {
          hasDiff = true;
          break;
        }
      }
    }

    if (!hasDiff) return 0;
  }

  await saveEfashionStocks(efashionProductId, bjStockEntries);
  return 1;
}

// ─────────────────────────────────────────────
// Sync images (WebP → JPEG, parallel upload)
// ─────────────────────────────────────────────

async function syncImages(
  efashionProductId: number,
  product: FullProduct,
  existingPhotos: string[]
): Promise<number> {
  let apiCalls = 0;

  // Collect all images to upload, grouped by color
  const imagesByColor = new Map<number, { path: string; order: number }[]>();

  for (const variant of product.colors) {
    const colorId = getEffectiveColorId(variant);
    if (!colorId) continue;

    for (const img of variant.images) {
      if (!imagesByColor.has(colorId)) {
        imagesByColor.set(colorId, []);
      }
      const existing = imagesByColor.get(colorId)!;
      // Deduplicate: skip if this image path is already collected
      if (!existing.some((e) => e.path === img.path)) {
        existing.push({ path: img.path, order: img.order });
      }
    }
  }

  // Determine which images need uploading
  // For existing products: compare photo count to detect changes
  // Since eFashion photo API returns paths, we check if counts differ
  const totalBjImages = [...imagesByColor.values()].reduce(
    (sum, imgs) => sum + imgs.length,
    0
  );

  // If same number of photos exist, assume no changes needed
  // (conservative — full diff would require comparing image hashes)
  if (existingPhotos.length === totalBjImages && existingPhotos.length > 0) {
    return 0;
  }

  // Upload all images in parallel (pool of 3)
  const uploadTasks: { colorId: number; imgPath: string; order: number }[] = [];
  for (const [colorId, images] of imagesByColor) {
    const sorted = images.sort((a, b) => a.order - b.order);
    for (const img of sorted) {
      uploadTasks.push({ colorId, imgPath: img.path, order: img.order });
    }
  }

  const POOL_SIZE = 3;
  for (let i = 0; i < uploadTasks.length; i += POOL_SIZE) {
    const batch = uploadTasks.slice(i, i + POOL_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (task) => {
        const jpegBuffer = await convertToJpeg(task.imgPath);
        const filename = `${product.reference}_c${task.colorId}_${task.order}.jpg`;
        await uploadEfashionImage(jpegBuffer, filename, efashionProductId);
        return task;
      })
    );

    for (const r of results) {
      apiCalls++;
      if (r.status === "rejected") {
        logger.warn(`${LOG_PREFIX} Image upload failed`, {
          error:
            r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }

  return apiCalls;
}

/**
 * Convert a WebP/PNG image from R2 to JPEG buffer.
 */
async function convertToJpeg(imagePath: string): Promise<Buffer> {
  const buffer = await downloadFromR2(r2KeyFromDbPath(imagePath));
  return sharp(buffer)
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

// ─────────────────────────────────────────────
// Sync status (diff-based)
// ─────────────────────────────────────────────

async function syncStatus(
  efashionProductId: number,
  bjStatus: string,
  efProduct: EfashionProduct | null
): Promise<boolean> {
  switch (bjStatus) {
    case "ONLINE": {
      // Already visible? Skip
      if (efProduct?.visible === true && efProduct?.supprimer === false) return false;
      await setEfashionProductsVisible([efashionProductId], true);
      return true;
    }
    case "OFFLINE": {
      // Already hidden? Skip
      if (efProduct?.visible === false && efProduct?.supprimer === false) return false;
      await setEfashionProductsVisible([efashionProductId], false);
      return true;
    }
    case "ARCHIVED": {
      // Already soft-deleted? Skip
      if (efProduct?.supprimer === true) return false;
      await softDeleteEfashionProducts([efashionProductId]);
      return true;
    }
    default:
      // SYNCING or unknown — don't push status
      return false;
  }
}

// ─────────────────────────────────────────────
// Validation des mappings eFashion
// ─────────────────────────────────────────────

function validateEfashionMappings(product: FullProduct): void {
  const issues: string[] = [];

  // Category
  if (!product.category.efashionCategoryId) {
    issues.push(
      `Catégorie "${product.category.name}" non mappée (efashionCategoryId manquant)`
    );
  }

  // Colors
  const seenColorIds = new Set<string>();
  for (const variant of product.colors) {
    // Check override first
    if (variant.efashionColorId) continue;

    if (variant.color?.id && !seenColorIds.has(variant.color.id)) {
      seenColorIds.add(variant.color.id);
      if (!variant.color.efashionColorId) {
        issues.push(
          `Couleur "${variant.color.name}" non mappée (efashionColorId manquant)`
        );
      }
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `Synchronisation eFashion impossible — correspondance(s) absente(s) :\n• ${issues.join("\n• ")}`
    );
  }
}
