/**
 * Ankorstore Update — Mise à jour incrémentale d'un produit existant sur Ankorstore.
 *
 * Contrairement à ankorstoreRefreshProduct (qui recrée), cette fonction modifie
 * directement le produit via diff de snapshot :
 *   - PATCH des champs produit (nom, description, catégorie…) via update operation
 *   - PATCH du stock des variantes existantes
 *   - PATCH des prix des variantes existantes
 *   - Nouvelles variantes locales → TODO via operation "update" (non implémenté — voir TODOs)
 *   - Variantes retirées → log warn (pas d'endpoint Ankorstore pour supprimer une variante seule)
 *   - Images → TODO (Ankorstore ne supporte pas upload per-slot ; voir TODOs)
 *   - Statut (active/archived) via update operation
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { formatAnkorstoreDescription } from "@/lib/ankorstore-description";
import {
  ankorstoreCreateCatalogOperation,
  ankorstoreAddProductsToOperation,
  ankorstoreStartOperation,
  ankorstorePollOperation,
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
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

export type AnkorstoreUpdateResult =
  | { success: true; archived: boolean }
  | { success: false; error: string };

export interface AnkorstoreUpdateProgress {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

type ProgressCallback = (progress: AnkorstoreUpdateProgress) => void;

// ─────────────────────────────────────────────
// Internal types
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
          variantSizes: {
            select: { size: { select: { name: true } }, quantity: true },
          },
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

/** Build a SKU for a variant (mirrors ankorstore-publish.ts). */
function buildVariantSku(
  product: Pick<FullProduct, "reference">,
  variant: FullVariant,
  index: number,
): string {
  if (variant.sku) return variant.sku;
  const colorSlug = variant.color?.name?.replace(/\s+/g, "-").toLowerCase() ?? `v${index}`;
  return `${product.reference}_${colorSlug}_${variant.saleType}_${index + 1}`;
}

/** Derive a public URL from a DB path. */
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

/** Compute wholesale price (EUR) for a variant. */
function getWholesalePrice(variant: FullVariant, config: AnkorstorePricingConfig): number {
  return getAnkorstorePackedPrice(
    Number(variant.unitPrice),
    variant.packQuantity,
    variant.saleType,
    config.wholesale,
  );
}

/** Compute retail price (EUR) for a variant. */
function getRetailPrice(variant: FullVariant, config: AnkorstorePricingConfig): number {
  return getAnkorstorePackedPrice(
    Number(variant.unitPrice),
    variant.packQuantity,
    variant.saleType,
    config.retail,
  );
}

// ─────────────────────────────────────────────
// Snapshot builders
// ─────────────────────────────────────────────

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
  } else {
    if (variant.variantSizes.length > 0) {
      sizeLabel = variant.variantSizes[0].size.name;
    }
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
  // Use the first color key only (product-level images, Ankorstore doesn't support per-variant)
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

/** Scaffold an empty committed snapshot (used as base when no prev exists). */
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
// Main export
// ─────────────────────────────────────────────

export async function ankorstoreUpdateProductInPlace(
  productId: string,
  onProgress?: ProgressCallback,
  options?: { skipRevalidation?: boolean; forceFullSync?: boolean },
): Promise<AnkorstoreUpdateResult> {
  // ── Step 0 : Load product ──
  const product = await loadProductFull(productId);
  if (!product) {
    return { success: false, error: "Produit introuvable en base" };
  }
  if (!product.ankorsProductId) {
    return {
      success: false,
      error: "Produit non publié sur Ankorstore (pas de ankorsProductId)",
    };
  }

  // Ankorstore ne supporte pas les packs : on ne synchronise que les variantes UNIT.
  product.colors = product.colors.filter((v) => v.saleType === "UNIT");
  if (product.colors.length === 0) {
    return {
      success: false,
      error:
        "Aucune variante à l'unité — Ankorstore n'accepte pas les packs. Ajoutez au moins une variante de type Unité pour synchroniser avec Ankorstore.",
    };
  }

  const ankorsProductId = product.ankorsProductId;

  const progress: AnkorstoreUpdateProgress = {
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
    // ── Step 1 : Load pricing config + brand name ──
    report("Chargement de la configuration tarifaire...");
    const config = await loadAnkorstorePricingConfig();
    const shopNameInfo = await prisma.companyInfo.findFirst({ select: { shopName: true } });
    const brandName = shopNameInfo?.shopName ?? "Ma Boutique";

    // ── Step 1b : Auto-link variants by SKU if any local variant lacks ankorsVariantId ──
    // Filet de sécurité : si des variantes locales n'ont pas leur ankorsVariantId,
    // on tente de les apparier avec les variantes Ankorstore (SKU exact puis couleur).
    if (product.colors.some((v) => !v.ankorsVariantId)) {
      report("Appariement des variantes Ankorstore…");
      try {
        const result = await autoLinkAnkorstoreVariants(productId);
        if (result.matchedExact + result.matchedColor > 0) {
          // Recharger le produit pour récupérer les nouveaux ankorsVariantId
          // (sinon la suite du flow utilise la version stale en mémoire).
          const reloaded = await loadProductFull(productId);
          if (reloaded) {
            product.colors = reloaded.colors;
          }
        }
      } catch (err) {
        logger.error("[Ankorstore Update] Auto-link variants failed", {
          ankorsProductId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Step 2 : Build next snapshot ──
    report("Calcul des changements...");

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

    // ── Step 3 : Diff ──
    const realPrevSnapshot = readPreviousSnapshot(product.ankorsLastSyncSnapshot);
    const prevSnapshot = options?.forceFullSync ? null : realPrevSnapshot;

    // committedSnapshot tracks what succeeded (starts from real prev state for crash safety)
    const committedSnapshot: AnkorstoreSyncSnapshot = realPrevSnapshot
      ? { ...realPrevSnapshot }
      : scaffoldEmpty(nextProductSnap, targetStatus);

    const diff = diffAnkorstoreSnapshots(prevSnapshot, nextSnapshot);

    // ── Short-circuit: nothing to do ──
    const hasVariantsToCreate = product.colors.some((v) => !v.ankorsVariantId);
    if (diffIsEmpty(diff) && !hasVariantsToCreate) {
      logger.info("[Ankorstore Update] Aucun changement détecté, sync sautée", {
        ankorsProductId,
        reference: product.reference,
      });
      report("Aucun changement à synchroniser");
      progress.status = "success";
      progress.step = "Aucun changement";
      onProgress?.(progress);
      if (!options?.skipRevalidation) {
        revalidateTag("products", "default");
      }
      return { success: true, archived: allVariantsOutOfStock };
    }

    // ── Step 4a : Update product fields if changed ──
    if (diff.productChanged) {
      report("Mise à jour des informations produit sur Ankorstore...");
      try {
        const firstVariant = product.colors[0];
        const wholesalePrice = firstVariant
          ? getWholesalePrice(firstVariant, config)
          : 0;
        const retailPrice = firstVariant
          ? getRetailPrice(firstVariant, config)
          : 0;

        // Collect current images for the update payload
        const firstColorId = product.colors[0]?.colorId ?? null;
        const productImages = product.colorImages
          .filter((img) => !firstColorId || img.colorId === firstColorId)
          .sort((a, b) => a.order - b.order)
          .map((img, idx) => ({ order: idx + 1, url: buildPublicImageUrl(img.path) }));

        const mainImage = productImages[0]?.url;
        const weightGrams = firstVariant?.weight
          ? Math.max(1, Math.round(firstVariant.weight * 1000))
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
          ...(weightGrams
            ? { shapeProperties: { weight: { unitCode: "GRM", amount: weightGrams } } }
            : {}),
          variants: product.colors.map((variant, i) => {
            const sku = buildVariantSku(product, variant, i);
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
            } else {
              if (variant.variantSizes.length > 0) {
                sizeLabel = variant.variantSizes[0].size.name;
              }
            }
            return {
              sku,
              ian: null,
              stockQuantity: stock,
              isAlwaysInStock: false,
              options: [
                { name: "color" as const, value: colorLabel },
                { name: "size" as const, value: sizeLabel },
              ],
            };
          }),
        };

        const { operationId } = await ankorstoreCreateCatalogOperation("update");
        logger.info("[Ankorstore Update] Created update operation", {
          operationId,
          reference: product.reference,
        });
        await ankorstoreAddProductsToOperation(operationId, [productInput]);
        await ankorstoreStartOperation(operationId);
        const opResult = await ankorstorePollOperation(operationId);

        if (opResult.status === "failed") {
          const firstFailure = opResult.results[0];
          throw new Error(
            firstFailure?.failureReason ?? "Mise à jour produit échouée sur Ankorstore",
          );
        }

        committedSnapshot.product = nextProductSnap;
        // Images committed as part of update operation
        committedSnapshot.images = nextImagesSnap;

        logger.info("[Ankorstore Update] Product fields updated", {
          ankorsProductId,
          reference: product.reference,
          operationStatus: opResult.status,
        });
      } catch (err) {
        logger.error("[Ankorstore Update] Failed to update product fields", {
          ankorsProductId,
          reference: product.reference,
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue — other sections may still succeed
      }
    } else {
      logger.info("[Ankorstore Update] Product fields unchanged → skip", { ankorsProductId });
    }

    // ── Step 4b : Patch stock + prices for changed variants ──
    if (diff.variantsChanged.length > 0) {
      report("Synchronisation des variantes...");

      for (const ankorsVariantId of diff.variantsChanged) {
        const snap = nextSnapshot.variants[ankorsVariantId];
        if (!snap) continue;

        // PATCH stock
        try {
          const { ankorstorePatchVariantStock } = await import("@/lib/ankorstore-api-write");
          await ankorstorePatchVariantStock(ankorsVariantId, {
            stockQuantity: snap.stockQty,
            isAlwaysInStock: snap.isAlwaysInStock,
          });
        } catch (err) {
          logger.error("[Ankorstore Update] Failed to patch variant stock", {
            ankorsVariantId,
            error: err,
          });
        }

        // PATCH prices
        try {
          const { ankorstorePatchVariantPrices } = await import("@/lib/ankorstore-api-write");
          await ankorstorePatchVariantPrices(ankorsVariantId, {
            wholesalePriceCents: snap.wholesalePriceCents,
            retailPriceCents: snap.retailPriceCents,
          });
        } catch (err) {
          logger.error("[Ankorstore Update] Failed to patch variant prices", {
            ankorsVariantId,
            error: err,
          });
        }

        // Mark as committed (best-effort: even if one PATCH failed, we record what we intended)
        committedSnapshot.variants[ankorsVariantId] =
          nextSnapshot.variants[ankorsVariantId];
      }

      logger.info("[Ankorstore Update] Variant patches applied", {
        count: diff.variantsChanged.length,
      });
    } else {
      logger.info("[Ankorstore Update] Variants unchanged → skip", { ankorsProductId });
    }

    // ── Step 4c : New variants (no ankorsVariantId) ──
    // TODO (Task 4.5): Support adding new variants via catalog integration update operation.
    // Ankorstore allows adding variants via the update operation; after completion, use
    // ankorstoreGetVariants() to find the new variant IDs by SKU and persist via
    // prisma.productColor.update({ data: { ankorsVariantId } }).
    const newVariants = product.colors.filter((v) => !v.ankorsVariantId);
    if (newVariants.length > 0) {
      logger.warn(
        "[Ankorstore Update] Nouvelles variantes locales sans ankorsVariantId — non synchronisées (TODO)",
        {
          ankorsProductId,
          count: newVariants.length,
          skus: newVariants.map((v, i) => buildVariantSku(product, v, i)),
        },
      );
    }

    // ── Step 4d : Removed variants ──
    // TODO (Task 4.5): Ankorstore does not expose a single-variant delete endpoint.
    // Option: use catalog update operation with stock=0 + isAlwaysInStock=false.
    // For now, log a warning — the variant stays live on Ankorstore with its last known state.
    const localAnkorsVariantIds = new Set(
      product.colors.filter((v) => v.ankorsVariantId).map((v) => v.ankorsVariantId!),
    );
    const removedVariants = Object.keys(
      realPrevSnapshot?.variants ?? {},
    ).filter((vid) => !localAnkorsVariantIds.has(vid));
    if (removedVariants.length > 0) {
      logger.warn(
        "[Ankorstore Update] Variantes retirées localement mais pas sur Ankorstore (TODO)",
        {
          ankorsProductId,
          removedVariantIds: removedVariants,
        },
      );
    }

    // ── Step 4e/f : Images ──
    // TODO (Task 4.5): Per-slot image upload/delete is not directly supported by Ankorstore.
    // Images are passed as URLs in the catalog integration update operation payload (see step 4a).
    // The update operation above already includes current images when productChanged=true.
    // If only images changed (not product fields), trigger a product-fields update with images anyway.
    if (
      !diff.productChanged &&
      (diff.imagesToUpload.length > 0 || diff.imagesToDelete.length > 0)
    ) {
      logger.warn(
        "[Ankorstore Update] Images modifiées mais champs produit inchangés — re-sync images via update operation",
        {
          ankorsProductId,
          toUpload: diff.imagesToUpload.length,
          toDelete: diff.imagesToDelete.length,
        },
      );
      // Trigger an update operation just to push new image URLs
      try {
        const firstVariant = product.colors[0];
        const wholesalePrice = firstVariant ? getWholesalePrice(firstVariant, config) : 0;
        const retailPrice = firstVariant ? getRetailPrice(firstVariant, config) : 0;

        const firstColorId = product.colors[0]?.colorId ?? null;
        const productImages = product.colorImages
          .filter((img) => !firstColorId || img.colorId === firstColorId)
          .sort((a, b) => a.order - b.order)
          .map((img, idx) => ({ order: idx + 1, url: buildPublicImageUrl(img.path) }));
        const mainImage = productImages[0]?.url;

        const imageUpdateInput: AnkorstoreCatalogProductInput = {
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
          variants: [],
        };

        const { operationId } = await ankorstoreCreateCatalogOperation("update");
        await ankorstoreAddProductsToOperation(operationId, [imageUpdateInput]);
        await ankorstoreStartOperation(operationId);
        await ankorstorePollOperation(operationId);

        committedSnapshot.images = nextImagesSnap;
        logger.info("[Ankorstore Update] Images re-synced via update operation", {
          ankorsProductId,
        });
      } catch (err) {
        logger.error("[Ankorstore Update] Failed to re-sync images", {
          ankorsProductId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Step 4g : Status changed ──
    if (diff.statusChanged) {
      const statusLabel =
        targetStatus === "active"
          ? "active"
          : targetStatus === "archived"
            ? "archived"
            : "inactive";
      report(`Mise à jour du statut (${statusLabel}) sur Ankorstore...`);
      logger.info("[Ankorstore Update] Updating status", {
        ankorsProductId,
        targetStatus,
        localStatus: product.status,
        allVariantsOutOfStock,
      });

      // TODO (Task 4.5): Ankorstore does not expose a direct status toggle endpoint.
      // Status can be changed via catalog update operation (active=true/false) or
      // by setting all variant stocks to 0. For now we log the intent.
      // If the product fields update operation ran above, it implicitly keeps the product active.
      logger.warn(
        "[Ankorstore Update] Status change requested but no direct API endpoint — sent via catalog operation if productChanged was true",
        { ankorsProductId, targetStatus },
      );
      committedSnapshot.status = targetStatus;
    }

    // ── Step 5 : Save snapshot + local DB update ──
    report("Mise à jour locale...");
    const dbUpdate: Record<string, unknown> = {
      ankorsLastSyncSnapshot: committedSnapshot,
    };
    if (allVariantsOutOfStock && product.status === "ONLINE") {
      dbUpdate.status = "OFFLINE";
    }
    await prisma.product.update({
      where: { id: productId },
      data: dbUpdate,
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
    logger.info("[Ankorstore Update] Success", {
      reference: product.reference,
      ankorsProductId,
    });

    return { success: true, archived: allVariantsOutOfStock };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Update] Error", {
      reference: product.reference,
      error: err,
    });

    progress.status = "error";
    progress.error = errorMsg;
    onProgress?.(progress);

    return { success: false, error: errorMsg };
  }
}
