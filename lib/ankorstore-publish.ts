/**
 * Ankorstore Publish — Mode callback-only (kickoff + finalize).
 *
 * Le bouton « Publier sur Ankorstore » appelle {@link ankorstoreKickoffPublish}
 * qui envoie le produit à Ankorstore, sauve une row `AnkorstoreOperation` en
 * status PENDING, et retourne immédiatement l'operationId. Le résultat arrive
 * plus tard par webhook → {@link ankorstoreFinalizePublish} fait le post-
 * processing (lookup ankorsProductId via SKU, sauvegarde en BDD).
 */

import { prisma } from "@/lib/prisma";
import { Prisma, type AnkorstoreOperation } from "@prisma/client";
import { formatAnkorstoreDescription } from "@/lib/ankorstore-description";
import {
  ankorstoreCreateCatalogOperation,
  ankorstoreAddProductsToOperation,
  ankorstoreStartOperation,
  ankorstoreLookupProductIdBySku,
  type AnkorstoreCatalogProductInput,
} from "@/lib/ankorstore-api-write";
import { ankorstoreGetVariants } from "@/lib/ankorstore-api";
import {
  loadAnkorstorePricingConfig,
  getAnkorstorePackedPrice,
} from "@/lib/ankorstore-pricing";
import { buildAnkorstoreShapeProperties } from "@/lib/ankorstore-shape";
import type { MarkupConfig } from "@/lib/marketplace-pricing";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

export type AnkorstoreKickoffResult =
  | { success: true; operationId: string }
  | { success: false; error: string };

/** Payload sauvegardé dans `AnkorstoreOperation.payload` pour qu'un PUBLISH puisse être finalisé depuis le webhook. */
export interface AnkorstorePublishPayload {
  firstSku: string;
  skuToBjVariantId: Record<string, string>;
  allVariantsOutOfStock: boolean;
  reference: string;
}

// ─────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────

interface FullVariant {
  id: string;
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
// Helpers (shared between publish/refresh)
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

function getVariantStock(variant: FullVariant): number {
  return variant.stock ?? 0;
}

function getAnkorstoreWholesalePrice(variant: FullVariant, markup: MarkupConfig): number {
  return getAnkorstorePackedPrice(Number(variant.unitPrice), variant.packQuantity, variant.saleType, markup);
}

function getAnkorstoreRetailPrice(variant: FullVariant, markup: MarkupConfig): number {
  return getAnkorstorePackedPrice(Number(variant.unitPrice), variant.packQuantity, variant.saleType, markup);
}

function getPackColorLabel(variant: FullVariant): string {
  if (variant.packLines.length > 0) {
    return variant.packLines.map((pl) => pl.color?.name ?? "?").join("/");
  }
  return variant.color?.name ?? "?";
}

/**
 * Index les images par colorId. Les images d'une couleur Ankorstore = toutes les
 * `colorImages` dont `colorId === variant.colorId`, triées par `order` croissant.
 */
function buildImagesByColorId(
  colorImages: { path: string; order: number; colorId: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const sorted = [...colorImages].sort((a, b) => a.order - b.order);
  for (const img of sorted) {
    if (!map.has(img.colorId)) map.set(img.colorId, []);
    map.get(img.colorId)!.push(img.path);
  }
  return map;
}

function buildAnkorstoreVariants(
  product: Pick<FullProduct, "reference">,
  colors: FullVariant[],
  wholesaleMarkup: MarkupConfig,
  retailMarkup: MarkupConfig,
  imagesByColorId: Map<string, string[]>,
): {
  bjVariantId: string;
  sku: string;
  entry: AnkorstoreCatalogProductInput["variants"][number];
}[] {
  const result: {
    bjVariantId: string;
    sku: string;
    entry: AnkorstoreCatalogProductInput["variants"][number];
  }[] = [];

  for (let i = 0; i < colors.length; i++) {
    const variant = colors[i];
    const sku = buildVariantSku(product, variant, i);
    const stock = getVariantStock(variant);
    const wholesalePrice = getAnkorstoreWholesalePrice(variant, wholesaleMarkup);
    const retailPrice = getAnkorstoreRetailPrice(variant, retailMarkup);

    // Images de la variante : prises depuis colorImages filtrées par colorId.
    const variantColorId = variant.colorId ?? "";
    const paths = imagesByColorId.get(variantColorId) ?? [];
    const variantImages = paths.map((p, idx) => ({
      order: idx + 1,
      url: buildPublicImageUrl(p),
    }));

    if (variant.saleType === "UNIT") {
      const colorLabel = variant.color?.name ?? "Couleur";
      const sizeLabel =
        variant.variantSizes.length > 0 ? variant.variantSizes[0].size.name : "TU";
      result.push({
        bjVariantId: variant.id,
        sku,
        entry: {
          sku,
          ian: null,
          stockQuantity: stock,
          isAlwaysInStock: false,
          wholesalePrice,
          retailPrice,
          originalWholesalePrice: wholesalePrice,
          options: [
            { name: "color", value: colorLabel },
            { name: "size", value: sizeLabel },
          ],
          ...(variantImages.length > 0 ? { images: variantImages } : {}),
        },
      });
    }

    if (variant.saleType === "PACK") {
      const colorLabel = getPackColorLabel(variant);
      let sizeLabel = "TU";
      if (variant.packLines.length > 0 && variant.packLines[0].sizes.length > 0) {
        sizeLabel = variant.packLines[0].sizes[0].size.name;
      } else if (variant.variantSizes.length > 0) {
        sizeLabel = variant.variantSizes[0].size.name;
      }
      result.push({
        bjVariantId: variant.id,
        sku,
        entry: {
          sku,
          ian: null,
          stockQuantity: stock,
          isAlwaysInStock: false,
          wholesalePrice,
          retailPrice,
          originalWholesalePrice: wholesalePrice,
          options: [
            { name: "color", value: colorLabel },
            { name: "size", value: sizeLabel },
          ],
          ...(variantImages.length > 0 ? { images: variantImages } : {}),
        },
      });
    }
  }
  return result;
}

/** Build the FULL catalog product input from a loaded product. Pricing is loaded by the caller. */
export async function buildPublishProductInput(productId: string): Promise<
  | { ok: true; input: AnkorstoreCatalogProductInput; payload: AnkorstorePublishPayload }
  | { ok: false; error: string }
> {
  const product = await loadProductFull(productId);
  if (!product) return { ok: false, error: "Produit introuvable en base" };

  product.colors = product.colors.filter((v) => v.saleType === "UNIT");
  if (product.colors.length === 0) {
    return {
      ok: false,
      error:
        "Aucune variante à l'unité — Ankorstore n'accepte pas les packs. Ajoutez au moins une variante de type Unité pour publier sur Ankorstore.",
    };
  }

  const pricing = await loadAnkorstorePricingConfig();
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

  const imagesByColorId = buildImagesByColorId(product.colorImages);

  const variantEntries = buildAnkorstoreVariants(
    product,
    product.colors,
    pricing.wholesale,
    pricing.retail,
    imagesByColorId,
  );

  const allVariantsOutOfStock =
    variantEntries.length === 0 ||
    variantEntries.every((v) => v.entry.stockQuantity === 0);

  const firstVariant = product.colors[0];
  const wholesalePrice = firstVariant ? getAnkorstoreWholesalePrice(firstVariant, pricing.wholesale) : 0;
  const retailPrice = firstVariant ? getAnkorstoreRetailPrice(firstVariant, pricing.retail) : 0;

  // Images niveau produit : UNIQUEMENT celles de la couleur principale
  // (primaryColorId côté local). Les autres couleurs ont leurs propres
  // images attachées à leur variante respective.
  // Spec Ankorstore : `main_image` porte l'order 1 implicite, donc `images`
  // ne doit lister que les photos additionnelles (order >= 2). Sinon la 1re
  // photo est dupliquée dans la galerie produit.
  const primaryColorId = product.primaryColorId ?? product.colors[0]?.colorId ?? null;
  const primaryColorPaths = primaryColorId
    ? (imagesByColorId.get(primaryColorId) ?? [])
    : [];
  const mainImage = primaryColorPaths[0]
    ? buildPublicImageUrl(primaryColorPaths[0])
    : undefined;
  const productImages = primaryColorPaths.slice(1).map((path, idx) => ({
    order: idx + 2,
    url: buildPublicImageUrl(path),
  }));

  // Poids envoyé en kg sans préciser l'unité : Ankorstore applique "kg"
  // par défaut côté plateforme, et envoyer unit_code provoque l'affichage
  // dupliqué de l'unité dans leur backoffice. Le champ local `weight` est
  // déjà en kg.
  const weightKg = firstVariant?.weight && firstVariant.weight > 0
    ? Math.round(firstVariant.weight * 1000) / 1000
    : undefined;

  const shapeProperties = buildAnkorstoreShapeProperties(weightKg, {
    length: product.dimensionLength,
    width: product.dimensionWidth,
    height: product.dimensionHeight,
  });

  const input: AnkorstoreCatalogProductInput = {
    externalId: product.reference,
    name: product.name,
    description: safeDescription,
    ...(mainImage ? { mainImage } : {}),
    ...(productImages.length > 0 ? { images: productImages } : {}),
    currency: "EUR",
    vatRate: pricing.vatRate,
    unitMultiplier: 1,
    wholesalePrice,
    retailPrice,
    countryCode:
      product.manufacturingCountry?.isoCode ??
      product.manufacturingCountry?.pfsCountryRef ??
      "FR",
    ...(product.isBestSeller ? { tags: ["tags_bestseller"] } : {}),
    ...(shapeProperties ? { shapeProperties } : {}),
    variants: variantEntries.map((v) => v.entry),
  };

  const skuToBjVariantId: Record<string, string> = {};
  for (const v of variantEntries) {
    skuToBjVariantId[v.sku] = v.bjVariantId;
  }
  const firstSku = variantEntries[0]?.sku ?? "";

  return {
    ok: true,
    input,
    payload: {
      firstSku,
      skuToBjVariantId,
      allVariantsOutOfStock,
      reference: product.reference,
    },
  };
}

// ─────────────────────────────────────────────
// Kickoff
// ─────────────────────────────────────────────

/**
 * Kick off a publish operation on Ankorstore. Returns the operationId
 * immediately — the result will arrive via webhook.
 *
 * Side effects:
 *   - Creates an Ankorstore import operation with the product payload
 *   - Saves an `AnkorstoreOperation` row in PENDING state
 */
export async function ankorstoreKickoffPublish(
  productId: string,
): Promise<AnkorstoreKickoffResult> {
  // Cancel any earlier pending publish/refresh ops for this product
  // (the new one supersedes them).
  await prisma.ankorstoreOperation.updateMany({
    where: {
      productId,
      status: "PENDING",
      type: { in: ["PUBLISH", "REFRESH_DELETE_OLD", "REFRESH_CREATE_NEW"] },
    },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  const built = await buildPublishProductInput(productId);
  if (!built.ok) return { success: false, error: built.error };

  try {
    const { operationId } = await ankorstoreCreateCatalogOperation("import");
    const addResp = await ankorstoreAddProductsToOperation(operationId, [built.input]);
    if (addResp.totalProductsCount === 0) {
      throw new Error("Ankorstore n'a accepté aucun produit (payload silencieusement rejeté).");
    }
    await ankorstoreStartOperation(operationId);

    await prisma.ankorstoreOperation.create({
      data: {
        id: operationId,
        productId,
        type: "PUBLISH",
        status: "PENDING",
        payload: built.payload as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info("[Ankorstore Publish] Kicked off", {
      operationId,
      productId,
      reference: built.payload.reference,
    });

    return { success: true, operationId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Publish] Kickoff failed", { productId, error: err });
    return { success: false, error: errorMsg };
  }
}

// ─────────────────────────────────────────────
// Finalize (called by webhook)
// ─────────────────────────────────────────────

/**
 * Finalize a publish operation after Ankorstore's callback confirms success.
 *
 * Looks up the new `ankorstoreProductId` via the first SKU (with indexing
 * retry), fetches variant IDs, and saves to local DB.
 *
 * Idempotent: if the operation is already in a terminal state, returns early.
 */
export async function ankorstoreFinalizePublish(
  op: AnkorstoreOperation,
  callbackPayload: unknown,
): Promise<void> {
  if (op.status !== "PENDING") {
    logger.info("[Ankorstore Publish] Finalize skipped — already terminal", {
      operationId: op.id,
      status: op.status,
    });
    return;
  }

  const callbackStatus = readCallbackStatus(callbackPayload);
  const payload = op.payload as unknown as AnkorstorePublishPayload;

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
    logger.warn("[Ankorstore Publish] Operation failed", {
      operationId: op.id,
      productId: op.productId,
      status: callbackStatus,
      errorMessage,
    });
    return;
  }

  // succeeded or partially_failed — try to resolve the product
  try {
    const ankorsProductId = await ankorstoreLookupProductIdBySku(payload.firstSku);
    if (!ankorsProductId) {
      throw new Error(
        `Produit créé sur Ankorstore mais introuvable via le SKU "${payload.firstSku}".`,
      );
    }

    const variants = await ankorstoreGetVariants(ankorsProductId);
    const ankorsVariantBySku = new Map(
      variants.filter((v) => v.sku != null).map((v) => [v.sku as string, v.id]),
    );

    const variantIdUpdates: { localVariantId: string; ankorsVariantId: string }[] = [];
    for (const [sku, bjVariantId] of Object.entries(payload.skuToBjVariantId)) {
      const ankorsVariantId = ankorsVariantBySku.get(sku);
      if (ankorsVariantId) {
        variantIdUpdates.push({ localVariantId: bjVariantId, ankorsVariantId });
      } else {
        logger.warn("[Ankorstore Publish] Variant ID not found", {
          sku,
          ankorsProductId,
        });
      }
    }

    await prisma.$transaction([
      prisma.product.update({
        where: { id: op.productId },
        data: {
          ankorsProductId,
          ankorsLastSyncSnapshot: Prisma.DbNull,
          ...(payload.allVariantsOutOfStock ? { status: "OFFLINE" } : {}),
        },
      }),
      ...variantIdUpdates.map((u) =>
        prisma.productColor.update({
          where: { id: u.localVariantId },
          data: { ankorsVariantId: u.ankorsVariantId },
        }),
      ),
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

    logger.info("[Ankorstore Publish] Finalized", {
      operationId: op.id,
      ankorsProductId,
      variantsMapped: variantIdUpdates.length,
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
    logger.error("[Ankorstore Publish] Finalize error", {
      operationId: op.id,
      productId: op.productId,
      error: err,
    });
  }
}

// ─────────────────────────────────────────────
// Callback payload helpers (shared with other finalize modules)
// ─────────────────────────────────────────────

export function readCallbackStatus(
  callbackPayload: unknown,
): "succeeded" | "partially_failed" | "failed" | "skipped" | "unknown" {
  if (!callbackPayload || typeof callbackPayload !== "object") return "unknown";
  const obj = callbackPayload as { data?: { attributes?: { status?: string } } };
  const status = obj.data?.attributes?.status;
  if (
    status === "succeeded" ||
    status === "partially_failed" ||
    status === "failed" ||
    status === "skipped"
  ) {
    return status;
  }
  return "unknown";
}

export function extractFailureReason(callbackPayload: unknown): string {
  if (!callbackPayload || typeof callbackPayload !== "object") return "Erreur inconnue";
  const obj = callbackPayload as {
    data?: { attributes?: { status?: string; failureReason?: string } };
  };
  const reason = obj.data?.attributes?.failureReason;
  return reason ?? `Statut: ${obj.data?.attributes?.status ?? "inconnu"}`;
}

/**
 * Récupère le détail des erreurs auprès d'Ankorstore (/operations/{id}/results)
 * pour construire un message lisible. Le callback ne contient pas les `issues[]`
 * détaillées — on doit aller les chercher séparément.
 *
 * Retourne une string compacte type :
 *   "validation_error: Retail price (3,50 €) must be greater than Wholesale… ; …"
 */
export async function fetchDetailedFailureMessage(operationId: string): Promise<string | null> {
  try {
    const { ankorstoreFetchOperationResults } = await import("@/lib/ankorstore-api-write");
    const results = await ankorstoreFetchOperationResults(operationId);
    const failed = results.filter((r) => r.status === "failure");
    if (failed.length === 0) return null;

    const parts: string[] = [];
    for (const r of failed) {
      const msgs: string[] = [];
      for (const iss of r.issues ?? []) {
        if (iss && typeof iss === "object") {
          const obj = iss as { field?: string; message?: string };
          if (obj.message) msgs.push(obj.message);
        }
      }
      const unique = Array.from(new Set(msgs)); // dedupe identical messages across variants
      const head = r.failureReason ?? "failure";
      if (unique.length > 0) {
        parts.push(`${head}: ${unique.join(" ; ")}`);
      } else if (r.failureReason) {
        parts.push(r.failureReason);
      }
    }
    return parts.length > 0 ? parts.join(" — ") : null;
  } catch (err) {
    logger.warn("[Ankorstore] fetchDetailedFailureMessage failed", {
      operationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
