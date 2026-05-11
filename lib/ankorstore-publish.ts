/**
 * Ankorstore Publish — Première mise en ligne d'un produit sur Ankorstore.
 *
 * Crée le produit via l'API Catalog Integration (operation "import"), récupère
 * les IDs de variantes retournées, construit des URLs publiques pour les images,
 * puis stocke ankorsProductId + ankorsVariantId dans la base locale.
 *
 * Pour un produit déjà publié sur Ankorstore (ankorsProductId connu), utiliser
 * ankorstoreRefreshProduct() à la place (Task 2.12).
 *
 * TODO multi-color images: Ankorstore product-level images only;
 * per-variant image upload not yet implemented (images sont passées comme URLs publiques).
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { formatAnkorstoreDescription } from "@/lib/ankorstore-description";
import {
  ankorstoreCreateCatalogOperation,
  ankorstoreAddProductsToOperation,
  ankorstoreStartOperation,
  ankorstorePollOperation,
  ankorstoreDeleteProduct,
  type AnkorstoreCatalogProductInput,
} from "@/lib/ankorstore-api-write";
import { ankorstoreGetVariants } from "@/lib/ankorstore-api";
import {
  loadAnkorstorePricingConfig,
  getAnkorstorePackedPrice,
} from "@/lib/ankorstore-pricing";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

export interface AnkorstorePublishProgress {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

export type AnkorstorePublishResult =
  | { success: true; ankorsProductId: string; archived: boolean }
  | { success: false; error: string };

type ProgressCallback = (progress: AnkorstorePublishProgress) => void;

// ─────────────────────────────────────────────
// Internal types (mirrored from pfs-publish.ts)
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

/**
 * Build a SKU for a variant that may not have one yet.
 * Format: {reference}_{colorName}_{UNIT|PACK}_{index}
 */
function buildVariantSku(
  product: Pick<FullProduct, "reference">,
  variant: FullVariant,
  index: number,
): string {
  if (variant.sku) return variant.sku;
  const colorSlug = variant.color?.name?.replace(/\s+/g, "-").toLowerCase() ?? `v${index}`;
  return `${product.reference}_${colorSlug}_${variant.saleType}_${index + 1}`;
}

/**
 * Derive the public image URL from a DB path.
 * DB paths are already public-relative: /uploads/produits/...
 */
function buildPublicImageUrl(dbPath: string): string {
  const base = (process.env.NEXTAUTH_URL ?? "https://beliandjolie.com").replace(/\/$/, "");
  return `${base}${dbPath.startsWith("/") ? "" : "/"}${dbPath}`;
}

/**
 * Get the total stock quantity for a variant.
 */
function getVariantStock(variant: FullVariant): number {
  return variant.stock ?? 0;
}

/**
 * Compute the wholesale price (EUR, not cents) for a variant.
 * For PACK: markup is applied to the per-unit price, then × qty.
 */
function getAnkorstoreWholesalePrice(
  variant: FullVariant,
  wholesaleMarkup: import("@/lib/marketplace-pricing").MarkupConfig,
): number {
  const unitPriceTotal = Number(variant.unitPrice);
  return getAnkorstorePackedPrice(unitPriceTotal, variant.packQuantity, variant.saleType, wholesaleMarkup);
}

/**
 * Compute the retail price (EUR, not cents) for a variant.
 */
function getAnkorstoreRetailPrice(
  variant: FullVariant,
  retailMarkup: import("@/lib/marketplace-pricing").MarkupConfig,
): number {
  const unitPriceTotal = Number(variant.unitPrice);
  return getAnkorstorePackedPrice(unitPriceTotal, variant.packQuantity, variant.saleType, retailMarkup);
}

/**
 * Compute the color label for multi-color packs.
 * Returns "Rouge/Bleu" for a pack with 2 colors.
 */
function getPackColorLabel(variant: FullVariant): string {
  if (variant.packLines.length > 0) {
    return variant.packLines.map((pl) => pl.color?.name ?? "?").join("/");
  }
  return variant.color?.name ?? "?";
}

/**
 * Flatten a FullVariant into Ankorstore catalog-integration variant entries.
 * Returns an array of entries (usually 1 per UNIT, or 1 per PACK).
 */
function buildAnkorstoreVariants(
  product: Pick<FullProduct, "reference">,
  colors: FullVariant[],
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
          options: [
            { name: "color", value: colorLabel },
            { name: "size", value: sizeLabel },
          ],
        },
      });
    }

    if (variant.saleType === "PACK") {
      // Multi-color pack: join all color names with "/"
      const colorLabel = getPackColorLabel(variant);
      // Use first size across pack lines, or fallback to TU
      let sizeLabel = "TU";
      if (variant.packLines.length > 0) {
        const firstLine = variant.packLines[0];
        if (firstLine.sizes.length > 0) {
          sizeLabel = firstLine.sizes[0].size.name;
        }
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
          options: [
            { name: "color", value: colorLabel },
            { name: "size", value: sizeLabel },
          ],
        },
      });
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────

export async function ankorstorePublishProduct(
  productId: string,
  onProgress?: ProgressCallback,
  options?: { skipRevalidation?: boolean },
): Promise<AnkorstorePublishResult> {
  // ── Load product ──
  const product = await loadProductFull(productId);
  if (!product) {
    return { success: false, error: "Produit introuvable en base" };
  }

  // Ankorstore ne supporte pas les packs : on ne publie que les variantes UNIT.
  product.colors = product.colors.filter((v) => v.saleType === "UNIT");
  if (product.colors.length === 0) {
    return {
      success: false,
      error:
        "Aucune variante à l'unité — Ankorstore n'accepte pas les packs. Ajoutez au moins une variante de type Unité pour publier sur Ankorstore.",
    };
  }

  const progress: AnkorstorePublishProgress = {
    productId,
    productName: product.name,
    reference: product.reference,
    status: "in_progress",
  };

  const report = (step: string) => {
    progress.step = step;
    onProgress?.(progress);
  };

  let createdAnkorsProductId: string | null = null;

  try {
    // ── Step 1 : Load pricing config ──
    report("Chargement de la configuration tarifaire...");
    const pricing = await loadAnkorstorePricingConfig();

    // ── Step 2 : Load brand name ──
    const shopNameInfo = await prisma.companyInfo.findFirst({ select: { shopName: true } });
    const brandName = shopNameInfo?.shopName ?? "Ma Boutique";

    // ── Step 3 : Build product payload ──
    report("Préparation du produit pour Ankorstore...");

    // Format description using the dedicated module (Task 2.11)
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

    // ── Step 4 : Build variant entries ──
    const variantEntries = buildAnkorstoreVariants(product, product.colors);

    if (variantEntries.length === 0) {
      logger.warn("[Ankorstore Publish] No variants to send — product.colors may be empty or all skipped", {
        reference: product.reference,
        colorsCount: product.colors.length,
      });
    }

    // All variants out of stock?
    const allVariantsOutOfStock =
      variantEntries.length === 0 ||
      variantEntries.every((v) => v.entry.stockQuantity === 0);

    // ── Step 5 : Compute product-level prices from first variant (or average) ──
    // Ankorstore expects product-level wholesale/retail prices (EUR, not cents).
    // We use the first variant's price; per-variant prices are set at variant level.
    const firstVariant = product.colors[0];
    let wholesalePrice = 0;
    let retailPrice = 0;
    if (firstVariant) {
      wholesalePrice = getAnkorstoreWholesalePrice(firstVariant, pricing.wholesale);
      retailPrice = getAnkorstoreRetailPrice(firstVariant, pricing.retail);
    } else {
      // No variants at all — default prices of 0 will likely cause an API validation error
      // TODO Ankorstore API ambiguity: what happens when wholesalePrice=0? May need to block publication
      logger.warn("[Ankorstore Publish] No variant found — product-level prices will be 0", {
        reference: product.reference,
      });
    }

    // ── Step 6 : Build images array from first color (product-level images) ──
    // TODO multi-color images: Ankorstore product-level images only;
    // per-variant image upload not yet implemented.
    const firstColorId = product.colors[0]?.colorId ?? null;
    const productImages = product.colorImages
      .filter((img) => !firstColorId || img.colorId === firstColorId)
      .sort((a, b) => a.order - b.order)
      .map((img, idx) => ({
        order: idx + 1,
        url: buildPublicImageUrl(img.path),
      }));

    const mainImage = productImages[0]?.url;

    // ── Step 7 : Build weight from primary variant ──
    // Shape properties (weight in grams)
    const weightGrams = firstVariant?.weight
      ? Math.max(1, Math.round(firstVariant.weight * 1000)) // weight stored in kg → grams
      : undefined;

    const productInput: AnkorstoreCatalogProductInput = {
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
      ...(weightGrams
        ? { shapeProperties: { weight: { unitCode: "GRM", amount: weightGrams } } }
        : {}),
      variants: variantEntries.map((v) => v.entry),
    };

    // ── Step 8 : Create catalog integration operation ──
    report("Création de l'opération d'import sur Ankorstore...");
    const { operationId } = await ankorstoreCreateCatalogOperation("import");
    logger.info("[Ankorstore Publish] Created import operation", {
      operationId,
      reference: product.reference,
    });

    // ── Step 9 : Add product to operation ──
    report("Ajout du produit à l'opération...");
    await ankorstoreAddProductsToOperation(operationId, [productInput]);

    // ── Step 10 : Start operation ──
    report("Lancement de l'opération...");
    await ankorstoreStartOperation(operationId);

    // ── Step 11 : Poll until complete ──
    report("Traitement en cours sur Ankorstore...");
    const opResult = await ankorstorePollOperation(operationId);

    if (opResult.status === "failed") {
      const firstFailure = opResult.results[0];
      throw new Error(firstFailure?.failureReason ?? "Publication échouée sur Ankorstore");
    }

    const productResult = opResult.results.find(
      (r) => r.externalProductId === product.reference,
    );

    if (!productResult || productResult.status === "failure") {
      throw new Error(
        productResult?.failureReason ??
          "Produit non créé sur Ankorstore (résultat introuvable dans la réponse)",
      );
    }

    const ankorsProductId = productResult.ankorstoreProductId;
    if (!ankorsProductId) {
      throw new Error("ankorstoreProductId manquant dans la réponse de l'opération");
    }

    createdAnkorsProductId = ankorsProductId;
    logger.info("[Ankorstore Publish] Created product", {
      ankorsProductId,
      reference: product.reference,
      operationStatus: opResult.status,
    });

    // ── Step 12 : Fetch variant IDs back from Ankorstore ──
    report("Récupération des identifiants des variantes...");
    const ankorsVariants = await ankorstoreGetVariants(ankorsProductId);

    // Map SKU → Ankorstore variant ID
    const ankorsVariantBySku = new Map(
      ankorsVariants
        .filter((v) => v.sku != null)
        .map((v) => [v.sku as string, v.id]),
    );

    const variantIdUpdates: { localVariantId: string; ankorsVariantId: string }[] = [];
    for (const entry of variantEntries) {
      const ankorsVariantId = ankorsVariantBySku.get(entry.sku);
      if (ankorsVariantId) {
        variantIdUpdates.push({ localVariantId: entry.bjVariantId, ankorsVariantId });
      } else {
        logger.warn("[Ankorstore Publish] Could not find Ankorstore variant ID for SKU", {
          sku: entry.sku,
          reference: product.reference,
        });
      }
    }

    logger.info("[Ankorstore Publish] Stored variant IDs", {
      ankorsProductId,
      mapped: variantIdUpdates.length,
      total: variantEntries.length,
    });

    // ── Step 13 : Save to local DB ──
    report("Mise à jour locale...");
    await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: {
          ankorsProductId,
          ankorsLastSyncSnapshot: Prisma.DbNull,
          ...(allVariantsOutOfStock ? { status: "OFFLINE" } : {}),
        },
      }),
      ...variantIdUpdates.map((u) =>
        prisma.productColor.update({
          where: { id: u.localVariantId },
          data: { ankorsVariantId: u.ankorsVariantId },
        }),
      ),
    ]);

    // ── Step 14 : Revalidate + emit ──
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

    logger.info("[Ankorstore Publish] Success", {
      reference: product.reference,
      ankorsProductId,
      archived: allVariantsOutOfStock,
      variantsMapped: variantIdUpdates.length,
      brandName,
    });

    return { success: true, ankorsProductId, archived: allVariantsOutOfStock };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Publish] Error", {
      reference: product.reference,
      error: err,
    });

    // Cleanup: if a product was created on Ankorstore but a later step failed, delete it
    if (createdAnkorsProductId) {
      try {
        await ankorstoreDeleteProduct(createdAnkorsProductId);
        logger.info("[Ankorstore Publish] Cleanup: deleted remote product after failure", {
          ankorsProductId: createdAnkorsProductId,
        });
      } catch (cleanupErr) {
        logger.error("[Ankorstore Publish] Cleanup failed — product may remain on Ankorstore", {
          ankorsProductId: createdAnkorsProductId,
          error: cleanupErr,
        });
      }
    }

    progress.status = "error";
    progress.error = errorMsg;
    onProgress?.(progress);

    return { success: false, error: errorMsg };
  }
}
