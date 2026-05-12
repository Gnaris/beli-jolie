/**
 * Ankorstore Update — Mode callback-only (kickoff + finalize).
 *
 * Met à jour un produit déjà publié sur Ankorstore (ankorsProductId connu).
 *
 *   1. Patches directs (`/product-variants/{id}/stock` + `/prices`) sont
 *      synchrones : leur HTTP response EST le résultat. On les exécute
 *      immédiatement dans kickoff.
 *   2. Mise à jour des champs produit / images via catalog-integration
 *      operation : async, le résultat arrive par webhook
 *      → {@link ankorstoreFinalizeUpdate} sauvegarde le snapshot.
 *
 * Si le diff ne comporte que des patches synchrones, kickoff retourne
 * `{ success: true, operationId: null }` (= rien à attendre).
 */

import { prisma } from "@/lib/prisma";
import { Prisma, type AnkorstoreOperation } from "@prisma/client";
import { formatAnkorstoreDescription } from "@/lib/ankorstore-description";
import {
  ankorstoreCreateCatalogOperation,
  ankorstoreAddProductsToOperation,
  ankorstoreStartOperation,
  ankorstorePatchVariantStock,
  ankorstorePatchVariantPrices,
  type AnkorstoreCatalogProductInput,
} from "@/lib/ankorstore-api-write";
import { autoLinkAnkorstoreVariants } from "@/lib/ankorstore-variant-link";
import {
  loadAnkorstorePricingConfig,
  getAnkorstorePackedPrice,
  toCents,
  type AnkorstorePricingConfig,
} from "@/lib/ankorstore-pricing";
import {
  diffAnkorstoreSnapshots,
  diffIsEmpty,
  ANKORSTORE_SNAPSHOT_VERSION,
  type AnkorstoreSyncSnapshot,
  type AnkorstoreProductFieldsSnapshot,
  type AnkorstoreVariantSnapshot,
  type AnkorstoreImagesSnapshot,
  type AnkorstoreStatus,
} from "@/lib/ankorstore-sync-diff";
import {
  readCallbackStatus,
  extractFailureReason,
  fetchDetailedFailureMessage,
} from "@/lib/ankorstore-publish";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

export type AnkorstoreUpdateKickoffResult =
  | { success: true; operationId: string | null; archived: boolean }
  | { success: false; error: string };

/** Payload sauvegardé pour UPDATE — utilisé par finalize pour committer le snapshot. */
export interface AnkorstoreUpdatePayload {
  committedSnapshot: AnkorstoreSyncSnapshot;
  allVariantsOutOfStock: boolean;
  reference: string;
}

// ─────────────────────────────────────────────
// Internal types (identiques à ankorstore-publish)
// ─────────────────────────────────────────────

interface FullVariant {
  id: string;
  ankorsVariantId: string | null;
  unitPrice: number | { toString(): string };
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sku: string | null;
  variantSizes: { size: { name: string }; quantity: number }[];
  colorId: string | null;
  color: { id: string; name: string } | null;
  packLines: {
    colorId: string;
    color: { id: string; name: string };
    position: number;
    sizes: { size: { name: string }; quantity: number }[];
  }[];
  images: { path: string; order: number; colorId: string }[];
}

interface FullProduct {
  id: string;
  reference: string;
  name: string;
  description: string;
  status: string;
  isBestSeller: boolean;
  primaryColorId: string | null;
  ankorsProductId: string | null;
  ankorsLastSyncSnapshot: unknown;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
  sizeDetailsTu: string | null;
  category: {
    id: string;
    pfsCategoryId: string | null;
    pfsGender: string | null;
    pfsFamilyId: string | null;
    pfsFamilyName: string | null;
    pfsCategoryName: string | null;
  };
  colors: FullVariant[];
  colorImages: { path: string; order: number; colorId: string }[];
  compositions: {
    percentage: number | { toString(): string };
    composition: { name: string; pfsCompositionRef: string | null };
  }[];
  manufacturingCountry: { isoCode: string | null; pfsCountryRef: string | null } | null;
  season: { pfsRef: string | null } | null;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function loadProductFull(productId: string): Promise<FullProduct | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      isBestSeller: true,
      primaryColorId: true,
      ankorsProductId: true,
      ankorsLastSyncSnapshot: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
      sizeDetailsTu: true,
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
          ankorsVariantId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          sku: true,
          variantSizes: { select: { size: { select: { name: true } }, quantity: true } },
          colorId: true,
          color: { select: { id: true, name: true } },
          packLines: {
            select: {
              colorId: true,
              color: { select: { id: true, name: true } },
              position: true,
              sizes: {
                select: { size: { select: { name: true } }, quantity: true },
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
      colorImages: {
        select: { path: true, order: true, colorId: true },
        orderBy: { order: "asc" as const },
      },
      compositions: {
        select: {
          percentage: true,
          composition: { select: { name: true, pfsCompositionRef: true } },
        },
      },
      manufacturingCountry: { select: { isoCode: true, pfsCountryRef: true } },
      season: { select: { pfsRef: true } },
    },
  }) as unknown as FullProduct | null;
}

function buildVariantSku(
  product: Pick<FullProduct, "reference">,
  variant: FullVariant,
  index: number,
): string {
  if (variant.sku) return variant.sku;
  const colorSlug = variant.color?.name?.replace(/\s+/g, "-").toLowerCase() ?? `v${index}`;
  return `${product.reference}_${colorSlug}_${variant.saleType}_${index + 1}`;
}

function buildPublicImageUrl(dbPath: string): string {
  const base = (process.env.NEXTAUTH_URL ?? "https://beliandjolie.com").replace(/\/$/, "");
  return `${base}${dbPath.startsWith("/") ? "" : "/"}${dbPath}`;
}

function getPackColorLabel(variant: FullVariant): string {
  if (variant.packLines.length > 0) {
    return variant.packLines.map((pl) => pl.color?.name ?? "?").join("/");
  }
  return variant.color?.name ?? "?";
}

function getWholesalePrice(variant: FullVariant, config: AnkorstorePricingConfig): number {
  return getAnkorstorePackedPrice(
    Number(variant.unitPrice),
    variant.packQuantity,
    variant.saleType,
    config.wholesale,
  );
}

function getRetailPrice(variant: FullVariant, config: AnkorstorePricingConfig): number {
  return getAnkorstorePackedPrice(
    Number(variant.unitPrice),
    variant.packQuantity,
    variant.saleType,
    config.retail,
  );
}

function buildProductFieldsSnapshot(
  product: FullProduct,
  brandName: string,
  config: AnkorstorePricingConfig,
): AnkorstoreProductFieldsSnapshot {
  const safeDescription = formatAnkorstoreDescription({
    description: product.description || product.name,
    reference: product.reference,
    compositions: product.compositions.map((c) => ({
      percentage: Number(c.percentage),
      composition: {
        nameFR: c.composition.name ?? c.composition.pfsCompositionRef ?? "",
      },
    })),
  });
  return {
    externalId: product.reference,
    name: product.name,
    description: safeDescription,
    vatRate: config.vatRate,
    countryCode:
      product.manufacturingCountry?.isoCode ??
      product.manufacturingCountry?.pfsCountryRef ??
      "FR",
    unitMultiplier: 1,
    brandName,
  };
}

function buildVariantSnapshot(
  product: FullProduct,
  variant: FullVariant,
  index: number,
  config: AnkorstorePricingConfig,
): AnkorstoreVariantSnapshot {
  const sku = buildVariantSku(product, variant, index);
  const stock = variant.stock ?? 0;
  const colorLabel =
    variant.saleType === "PACK"
      ? getPackColorLabel(variant)
      : (variant.color?.name ?? "Couleur");
  let sizeLabel = "TU";
  if (variant.saleType === "PACK") {
    if (variant.packLines.length > 0 && variant.packLines[0].sizes.length > 0) {
      sizeLabel = variant.packLines[0].sizes[0].size.name;
    } else if (variant.variantSizes.length > 0) {
      sizeLabel = variant.variantSizes[0].size.name;
    }
  } else if (variant.variantSizes.length > 0) {
    sizeLabel = variant.variantSizes[0].size.name;
  }
  return {
    sku,
    wholesalePriceCents: toCents(getWholesalePrice(variant, config)),
    retailPriceCents: toCents(getRetailPrice(variant, config)),
    stockQty: stock,
    isAlwaysInStock: false,
    optionColor: colorLabel,
    optionSize: sizeLabel,
  };
}

function buildImagesSnapshot(product: FullProduct): AnkorstoreImagesSnapshot {
  const firstColorId = product.colors[0]?.colorId ?? null;
  const out: AnkorstoreImagesSnapshot = {};
  const filtered = product.colorImages
    .filter((img) => !firstColorId || img.colorId === firstColorId)
    .sort((a, b) => a.order - b.order);
  if (filtered.length > 0) {
    out["main"] = {};
    filtered.forEach((img, i) => {
      out["main"][String(i + 1)] = img.path;
    });
  }
  return out;
}

function readPreviousSnapshot(raw: unknown): AnkorstoreSyncSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<AnkorstoreSyncSnapshot>;
  if (obj.schemaVersion !== ANKORSTORE_SNAPSHOT_VERSION) return null;
  if (!obj.product || !obj.variants || !obj.images) return null;
  return obj as AnkorstoreSyncSnapshot;
}

function scaffoldEmpty(
  nextProduct: AnkorstoreProductFieldsSnapshot,
  targetStatus: AnkorstoreStatus,
): AnkorstoreSyncSnapshot {
  return {
    schemaVersion: ANKORSTORE_SNAPSHOT_VERSION,
    product: nextProduct,
    variants: {},
    images: {},
    status: targetStatus,
  };
}

// ─────────────────────────────────────────────
// Kickoff
// ─────────────────────────────────────────────

/**
 * Kick off an update. Applies direct PATCH stock/prices synchronously and,
 * if product fields/images changed, kicks off an async update operation.
 *
 * Returns:
 *   - `{ success: true, operationId: <uuid>, archived }` — webhook will finalize
 *   - `{ success: true, operationId: null, archived }`  — only sync patches were
 *     needed; snapshot already saved
 *   - `{ success: false, error }`                       — kickoff failed
 */
export async function ankorstoreKickoffUpdate(
  productId: string,
  options?: { forceFullSync?: boolean },
): Promise<AnkorstoreUpdateKickoffResult> {
  const product = await loadProductFull(productId);
  if (!product) return { success: false, error: "Produit introuvable en base" };
  if (!product.ankorsProductId) {
    return {
      success: false,
      error: "Produit non publié sur Ankorstore (pas de ankorsProductId)",
    };
  }

  product.colors = product.colors.filter((v) => v.saleType === "UNIT");
  if (product.colors.length === 0) {
    return {
      success: false,
      error:
        "Aucune variante à l'unité — Ankorstore n'accepte pas les packs. Ajoutez au moins une variante de type Unité pour synchroniser avec Ankorstore.",
    };
  }

  const ankorsProductId = product.ankorsProductId;

  try {
    const config = await loadAnkorstorePricingConfig();
    const shopNameInfo = await prisma.companyInfo.findFirst({ select: { shopName: true } });
    const brandName = shopNameInfo?.shopName ?? "Ma Boutique";

    // Auto-link variants by SKU if any local variant lacks ankorsVariantId
    if (product.colors.some((v) => !v.ankorsVariantId)) {
      try {
        const result = await autoLinkAnkorstoreVariants(productId);
        if (result.matchedExact + result.matchedColor > 0) {
          const reloaded = await loadProductFull(productId);
          if (reloaded) product.colors = reloaded.colors;
        }
      } catch (err) {
        logger.error("[Ankorstore Update] Auto-link variants failed", {
          ankorsProductId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Récupère les SKU RÉELS d'Ankorstore pour chaque ankorsVariantId lié.
    // Sans ça, on enverrait notre SKU local (ex. A485_BLANC_UNIT_2) dans
    // l'update payload — Ankorstore ne le reconnaîtrait pas et CRÉERAIT une
    // nouvelle variante au lieu de modifier celle qui existe (qui a un SKU
    // différent côté Ankorstore, ex. "A485_ Blanc"). Bug constaté 2026-05-12.
    const ankorsRealSkuById = new Map<string, string>();
    try {
      const { ankorstoreGetVariants } = await import("@/lib/ankorstore-api");
      const ankorsVariants = await ankorstoreGetVariants(ankorsProductId);
      for (const v of ankorsVariants) {
        if (v.sku) ankorsRealSkuById.set(v.id, v.sku);
      }
    } catch (err) {
      logger.warn("[Ankorstore Update] Fetch real variant SKUs failed", {
        ankorsProductId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Build next snapshot
    const nextProductSnap = buildProductFieldsSnapshot(product, brandName, config);

    const nextVariantsSnap: AnkorstoreSyncSnapshot["variants"] = {};
    for (let i = 0; i < product.colors.length; i++) {
      const variant = product.colors[i];
      if (variant.ankorsVariantId) {
        nextVariantsSnap[variant.ankorsVariantId] = buildVariantSnapshot(
          product,
          variant,
          i,
          config,
        );
      }
    }
    const nextImagesSnap = buildImagesSnapshot(product);

    const allVariantsOutOfStock = product.colors.every((v) => (v.stock ?? 0) === 0);
    const targetStatus: AnkorstoreStatus =
      product.status === "ARCHIVED"
        ? "archived"
        : product.status === "ONLINE" && !allVariantsOutOfStock
          ? "active"
          : "inactive";

    const nextSnapshot: AnkorstoreSyncSnapshot = {
      schemaVersion: ANKORSTORE_SNAPSHOT_VERSION,
      product: nextProductSnap,
      variants: nextVariantsSnap,
      images: nextImagesSnap,
      status: targetStatus,
    };

    const realPrevSnapshot = readPreviousSnapshot(product.ankorsLastSyncSnapshot);
    const prevSnapshot = options?.forceFullSync ? null : realPrevSnapshot;
    const committedSnapshot: AnkorstoreSyncSnapshot = realPrevSnapshot
      ? { ...realPrevSnapshot }
      : scaffoldEmpty(nextProductSnap, targetStatus);

    const diff = diffAnkorstoreSnapshots(prevSnapshot, nextSnapshot);

    const hasVariantsToCreate = product.colors.some((v) => !v.ankorsVariantId);
    if (diffIsEmpty(diff) && !hasVariantsToCreate) {
      logger.info("[Ankorstore Update] Aucun changement détecté", {
        ankorsProductId,
        reference: product.reference,
      });
      return { success: true, operationId: null, archived: allVariantsOutOfStock };
    }

    // Step A: Apply direct PATCHes for variant stock/prices.
    // Parallèle pour minimiser la latence (avant : séquentiel, ~4-8s pour 4 variantes).
    if (diff.variantsChanged.length > 0) {
      const patchPromises: Promise<void>[] = [];
      for (const ankorsVariantId of diff.variantsChanged) {
        const snap = nextSnapshot.variants[ankorsVariantId];
        if (!snap) continue;
        patchPromises.push(
          ankorstorePatchVariantStock(ankorsVariantId, {
            stockQuantity: snap.stockQty,
            isAlwaysInStock: snap.isAlwaysInStock,
          }).catch((err) => {
            logger.error("[Ankorstore Update] PATCH variant stock failed", {
              ankorsVariantId,
              error: err,
            });
          }),
          ankorstorePatchVariantPrices(ankorsVariantId, {
            wholesalePriceCents: snap.wholesalePriceCents,
            retailPriceCents: snap.retailPriceCents,
          }).catch((err) => {
            logger.error("[Ankorstore Update] PATCH variant prices failed", {
              ankorsVariantId,
              error: err,
            });
          }),
        );
        committedSnapshot.variants[ankorsVariantId] = snap;
      }
      await Promise.all(patchPromises);
      logger.info("[Ankorstore Update] Variant patches applied (parallel)", {
        count: diff.variantsChanged.length,
        calls: patchPromises.length,
      });
    }

    // Step B: Async catalog update operation for product fields / images
    const needsAsyncOp =
      diff.productChanged ||
      diff.imagesToUpload.length > 0 ||
      diff.imagesToDelete.length > 0 ||
      diff.statusChanged;

    if (!needsAsyncOp) {
      // Only PATCHes happened — save snapshot now and return.
      await prisma.product.update({
        where: { id: productId },
        data: {
          ankorsLastSyncSnapshot: committedSnapshot as unknown as Prisma.InputJsonValue,
          ...(allVariantsOutOfStock && product.status === "ONLINE" ? { status: "OFFLINE" } : {}),
        },
      });
      revalidateTag("products", "default");
      emitProductEvent({
        type: allVariantsOutOfStock ? "PRODUCT_OFFLINE" : "PRODUCT_UPDATED",
        productId,
      });
      return { success: true, operationId: null, archived: allVariantsOutOfStock };
    }

    // Cancel any earlier pending update op for this product
    await prisma.ankorstoreOperation.updateMany({
      where: { productId, status: "PENDING", type: "UPDATE" },
      data: { status: "CANCELLED", completedAt: new Date() },
    });

    // Build the product input for the async update operation
    const firstVariant = product.colors[0];
    const wholesalePrice = firstVariant ? getWholesalePrice(firstVariant, config) : 0;
    const retailPrice = firstVariant ? getRetailPrice(firstVariant, config) : 0;

    // Images : on les indexe par colorId pour qu'à chaque variante on associe
    // ses propres photos. Au niveau produit, on prend toutes les couleurs
    // dans l'ordre (couleur primaire d'abord).
    const imagesByColorId = new Map<string, string[]>();
    for (const img of [...product.colorImages].sort((a, b) => a.order - b.order)) {
      if (!imagesByColorId.has(img.colorId)) imagesByColorId.set(img.colorId, []);
      imagesByColorId.get(img.colorId)!.push(img.path);
    }
    const primaryColorId = product.primaryColorId ?? product.colors[0]?.colorId ?? null;
    const sortedColorIds = product.colors
      .map((c) => c.colorId)
      .filter((id): id is string => !!id);
    if (primaryColorId) {
      const idx = sortedColorIds.indexOf(primaryColorId);
      if (idx > 0) {
        sortedColorIds.splice(idx, 1);
        sortedColorIds.unshift(primaryColorId);
      }
    }
    const orderedPaths: string[] = [];
    for (const cid of sortedColorIds) {
      const paths = imagesByColorId.get(cid) ?? [];
      orderedPaths.push(...paths);
    }
    const productImages = orderedPaths.map((path, idx) => ({
      order: idx + 1,
      url: buildPublicImageUrl(path),
    }));
    const mainImage = productImages[0]?.url;
    // Poids en kg directement (cf. spec Ankorstore : unit_code "kg")
    const weightKg = firstVariant?.weight && firstVariant.weight > 0
      ? Math.round(firstVariant.weight * 1000) / 1000
      : undefined;

    const productInput: AnkorstoreCatalogProductInput = {
      externalId: product.reference,
      name: nextProductSnap.name,
      description: nextProductSnap.description,
      ...(mainImage ? { mainImage } : {}),
      ...(productImages.length > 0 ? { images: productImages } : {}),
      currency: "EUR",
      vatRate: config.vatRate,
      unitMultiplier: 1,
      wholesalePrice,
      retailPrice,
      countryCode: nextProductSnap.countryCode,
      ...(product.isBestSeller ? { tags: ["tags_bestseller"] } : {}),
      ...(weightKg
        ? { shapeProperties: { weight: { unitCode: "kg" as const, amount: weightKg } } }
        : {}),
      variants: product.colors.map((variant, i) => {
        // Utilise le SKU réel d'Ankorstore pour les variantes déjà liées
        // (sinon Ankorstore créerait une nouvelle variante au lieu de modifier
        // l'existante). Fallback sur le SKU local pour les variantes nouvelles.
        const realSku = variant.ankorsVariantId
          ? ankorsRealSkuById.get(variant.ankorsVariantId)
          : null;
        const sku = realSku ?? buildVariantSku(product, variant, i);
        const variantWholesale = getWholesalePrice(variant, config);
        const variantRetail = getRetailPrice(variant, config);
        const colorLabel =
          variant.saleType === "PACK"
            ? getPackColorLabel(variant)
            : (variant.color?.name ?? "Couleur");
        let sizeLabel = "TU";
        if (variant.saleType === "PACK") {
          if (variant.packLines.length > 0 && variant.packLines[0].sizes.length > 0) {
            sizeLabel = variant.packLines[0].sizes[0].size.name;
          } else if (variant.variantSizes.length > 0) {
            sizeLabel = variant.variantSizes[0].size.name;
          }
        } else if (variant.variantSizes.length > 0) {
          sizeLabel = variant.variantSizes[0].size.name;
        }
        const variantColorId = variant.colorId ?? "";
        const paths = imagesByColorId.get(variantColorId) ?? [];
        const variantImages = paths.map((p, idx) => ({
          order: idx + 1,
          url: buildPublicImageUrl(p),
        }));
        return {
          sku,
          ian: null,
          stockQuantity: variant.stock ?? 0,
          isAlwaysInStock: false,
          wholesalePrice: variantWholesale,
          retailPrice: variantRetail,
          originalWholesalePrice: variantWholesale,
          options: [
            { name: "color" as const, value: colorLabel },
            { name: "size" as const, value: sizeLabel },
          ],
          ...(variantImages.length > 0 ? { images: variantImages } : {}),
        };
      }),
    };

    // Reflect the async pieces (images, product fields, status) into the
    // committed snapshot — finalize will commit on success.
    const committedAfterAsync: AnkorstoreSyncSnapshot = {
      ...committedSnapshot,
      product: nextProductSnap,
      images: nextImagesSnap,
      status: targetStatus,
    };

    const { operationId } = await ankorstoreCreateCatalogOperation("update");
    const addResp = await ankorstoreAddProductsToOperation(operationId, [productInput]);
    if (addResp.totalProductsCount === 0) {
      throw new Error("Ankorstore n'a accepté aucun produit (payload silencieusement rejeté).");
    }
    await ankorstoreStartOperation(operationId);

    const payload: AnkorstoreUpdatePayload = {
      committedSnapshot: committedAfterAsync,
      allVariantsOutOfStock,
      reference: product.reference,
    };

    await prisma.ankorstoreOperation.create({
      data: {
        id: operationId,
        productId,
        type: "UPDATE",
        status: "PENDING",
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info("[Ankorstore Update] Kicked off", {
      operationId,
      productId,
      reference: product.reference,
    });

    return { success: true, operationId, archived: allVariantsOutOfStock };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Update] Kickoff failed", { productId, error: err });
    return { success: false, error: errorMsg };
  }
}

// ─────────────────────────────────────────────
// Finalize (called by webhook)
// ─────────────────────────────────────────────

/**
 * Finalize an update operation after Ankorstore's callback. Saves the
 * snapshot to product.ankorsLastSyncSnapshot on success.
 */
export async function ankorstoreFinalizeUpdate(
  op: AnkorstoreOperation,
  callbackPayload: unknown,
): Promise<void> {
  if (op.status !== "PENDING") {
    logger.info("[Ankorstore Update] Finalize skipped — already terminal", {
      operationId: op.id,
      status: op.status,
    });
    return;
  }

  const callbackStatus = readCallbackStatus(callbackPayload);
  const payload = op.payload as unknown as AnkorstoreUpdatePayload;

  if (callbackStatus === "failed" || callbackStatus === "skipped") {
    const detailed = await fetchDetailedFailureMessage(op.id);
    const errorMessage = detailed ?? extractFailureReason(callbackPayload);
    await prisma.ankorstoreOperation.update({
      where: { id: op.id },
      data: {
        status: "FAILED",
        callbackPayload: callbackPayload as Prisma.InputJsonValue,
        errorMessage,
        completedAt: new Date(),
      },
    });
    logger.warn("[Ankorstore Update] Operation failed", {
      operationId: op.id,
      productId: op.productId,
      status: callbackStatus,
      errorMessage,
    });
    return;
  }

  // succeeded or partially_failed — commit the snapshot
  try {
    const dbUpdate: Record<string, unknown> = {
      ankorsLastSyncSnapshot: payload.committedSnapshot as unknown as Prisma.InputJsonValue,
    };
    // Set OFFLINE if all variants out of stock and currently ONLINE
    const localProduct = await prisma.product.findUnique({
      where: { id: op.productId },
      select: { status: true },
    });
    if (payload.allVariantsOutOfStock && localProduct?.status === "ONLINE") {
      dbUpdate.status = "OFFLINE";
    }

    await prisma.$transaction([
      prisma.product.update({
        where: { id: op.productId },
        data: dbUpdate,
      }),
      prisma.ankorstoreOperation.update({
        where: { id: op.id },
        data: {
          status: callbackStatus === "succeeded" ? "SUCCEEDED" : "PARTIALLY_FAILED",
          callbackPayload: callbackPayload as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      }),
    ]);

    revalidateTag("products", "default");
    emitProductEvent({
      type: payload.allVariantsOutOfStock ? "PRODUCT_OFFLINE" : "PRODUCT_UPDATED",
      productId: op.productId,
    });

    logger.info("[Ankorstore Update] Finalized", {
      operationId: op.id,
      productId: op.productId,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.ankorstoreOperation.update({
      where: { id: op.id },
      data: {
        status: "FAILED",
        callbackPayload: callbackPayload as Prisma.InputJsonValue,
        errorMessage: errorMsg,
        completedAt: new Date(),
      },
    });
    logger.error("[Ankorstore Update] Finalize error", {
      operationId: op.id,
      productId: op.productId,
      error: err,
    });
  }
}
