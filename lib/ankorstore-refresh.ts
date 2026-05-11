/**
 * Ankorstore Refresh — Duplicate a product on Ankorstore to make it appear as "new".
 *
 * Flow:
 * 1. Load product. If no ankorsProductId → not_found.
 * 2. Verify product exists on Ankorstore via ankorstoreGetProduct().
 * 3. Rename OLD product external_id to a temp value and archive it via an "update" operation.
 * 4. Create NEW product with the real external_id via an "import" operation.
 * 5. Fetch variant IDs from Ankorstore, save to local DB.
 * 6. Reset ankorsLastSyncSnapshot to Prisma.DbNull.
 * 7. Set lastRefreshedAt = now() (product reappears as "Nouveauté" on storefront).
 *
 * Rollback on failure:
 * - If step 3 (rename old) succeeded but step 4 (create new) failed:
 *   restore the old product's external_id via another "update" operation.
 * - If step 4 partially succeeded (product created on Ankorstore) but step 5+ failed:
 *   delete the newly created product and restore the old one.
 *
 * NOTE: Ankorstore requires unique external_id per product. We cannot create a new
 * product with the same external_id while the old one is still active.
 *
 * TODO Task 4.5: extract shared helpers (buildVariantSku, buildAnkorstoreVariants,
 * loadProductFull, getAnkorstoreWholesalePrice, getAnkorstoreRetailPrice, etc.)
 * into lib/ankorstore-shared.ts to avoid duplication across publish/update/refresh.
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
import {
  ankorstoreGetProduct,
  ankorstoreGetVariants,
} from "@/lib/ankorstore-api";
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

export interface AnkorstoreRefreshProgress {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

export type AnkorstoreRefreshResult =
  | { success: true; newAnkorsProductId: string; archived: boolean }
  | { success: false; reason: "not_found"; error: string }
  | { success: false; reason: "error"; error: string };

type ProgressCallback = (progress: AnkorstoreRefreshProgress) => void;

// ─────────────────────────────────────────────
// Internal types (duplicated from ankorstore-publish.ts)
// TODO Task 4.5: extract to lib/ankorstore-shared.ts
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
  ankorsProductId: string | null;
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
// TODO Task 4.5: extract to lib/ankorstore-shared.ts
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
 * TODO Task 4.5: extract to lib/ankorstore-shared.ts
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
 * TODO Task 4.5: extract to lib/ankorstore-shared.ts
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
 * Compute the wholesale price (EUR) for a variant.
 * TODO Task 4.5: extract to lib/ankorstore-shared.ts
 */
function getAnkorstoreWholesalePrice(
  variant: FullVariant,
  wholesaleMarkup: import("@/lib/marketplace-pricing").MarkupConfig,
): number {
  const unitPriceTotal = Number(variant.unitPrice);
  return getAnkorstorePackedPrice(unitPriceTotal, variant.packQuantity, variant.saleType, wholesaleMarkup);
}

/**
 * Compute the retail price (EUR) for a variant.
 * TODO Task 4.5: extract to lib/ankorstore-shared.ts
 */
function getAnkorstoreRetailPrice(
  variant: FullVariant,
  retailMarkup: import("@/lib/marketplace-pricing").MarkupConfig,
): number {
  const unitPriceTotal = Number(variant.unitPrice);
  return getAnkorstorePackedPrice(unitPriceTotal, variant.packQuantity, variant.saleType, retailMarkup);
}

/**
 * Color label for multi-color packs.
 * TODO Task 4.5: extract to lib/ankorstore-shared.ts
 */
function getPackColorLabel(variant: FullVariant): string {
  if (variant.packLines.length > 0) {
    return variant.packLines.map((pl) => pl.color?.name ?? "?").join("/");
  }
  return variant.color?.name ?? "?";
}

/**
 * Flatten a FullVariant list into Ankorstore catalog-integration variant entries.
 * TODO Task 4.5: extract to lib/ankorstore-shared.ts
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
      const colorLabel = getPackColorLabel(variant);
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

export async function ankorstoreRefreshProduct(
  productId: string,
  onProgress?: ProgressCallback,
  options?: { skipRevalidation?: boolean },
): Promise<AnkorstoreRefreshResult> {
  // ── Load product ──
  const product = await loadProductFull(productId);
  if (!product) {
    return { success: false, reason: "error", error: "Produit introuvable en base" };
  }

  // Ankorstore ne supporte pas les packs : on ne pousse que les variantes UNIT.
  product.colors = product.colors.filter((v) => v.saleType === "UNIT");
  if (product.colors.length === 0) {
    return {
      success: false,
      reason: "error",
      error:
        "Aucune variante à l'unité — Ankorstore n'accepte pas les packs. Ajoutez au moins une variante de type Unité pour rafraîchir sur Ankorstore.",
    };
  }

  const progress: AnkorstoreRefreshProgress = {
    productId,
    productName: product.name,
    reference: product.reference,
    status: "in_progress",
  };

  const report = (step: string) => {
    progress.step = step;
    onProgress?.(progress);
  };

  // ── Step 1: Check local ankorsProductId ──
  if (!product.ankorsProductId) {
    progress.status = "error";
    progress.error = "Produit non publié sur Ankorstore";
    onProgress?.(progress);
    return { success: false, reason: "not_found", error: "Produit non publié sur Ankorstore" };
  }

  const oldAnkorsProductId = product.ankorsProductId;

  // ── Step 2: Verify product exists on Ankorstore ──
  report("Vérification de l'existence sur Ankorstore...");
  let existingAnkorsProduct: Awaited<ReturnType<typeof ankorstoreGetProduct>>;
  try {
    existingAnkorsProduct = await ankorstoreGetProduct(oldAnkorsProductId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[Ankorstore Refresh] getProduct failed", {
      ankorsProductId: oldAnkorsProductId,
      error: msg,
    });
    return { success: false, reason: "error", error: `Impossible de contacter Ankorstore : ${msg}` };
  }

  if (!existingAnkorsProduct) {
    progress.status = "error";
    progress.error = "Produit Ankorstore introuvable";
    onProgress?.(progress);
    return { success: false, reason: "not_found", error: "Produit Ankorstore introuvable" };
  }

  // ── Track rollback state ──
  let oldProductArchived = false; // Step 3 completed (old product renamed+archived)
  let newAnkorsProductId: string | null = null; // Set after Step 4 succeeds

  try {
    // ── Step 3: Archive old product with temp external_id ──
    // Ankorstore requires unique external_id. We must rename the old product before
    // creating a new one with the real external_id.
    const tempExternalId = `${product.reference}-archived-${Date.now()}`;
    report("Archivage de l'ancien produit sur Ankorstore...");

    const { operationId: archiveOpId } = await ankorstoreCreateCatalogOperation("update");
    await ankorstoreAddProductsToOperation(archiveOpId, [
      {
        externalId: tempExternalId,
        name: existingAnkorsProduct.name || product.name,
        description:
          existingAnkorsProduct.description ||
          `Fin de série — ${product.reference}`,
        currency: "EUR",
        vatRate: existingAnkorsProduct.vatRate ?? 20,
        unitMultiplier: 1,
        wholesalePrice: existingAnkorsProduct.wholesalePrice ?? 0,
        retailPrice: existingAnkorsProduct.retailPrice ?? 0,
        countryCode:
          product.manufacturingCountry?.isoCode ??
          product.manufacturingCountry?.pfsCountryRef ??
          "FR",
        variants: [],
      } as AnkorstoreCatalogProductInput,
    ]);
    await ankorstoreStartOperation(archiveOpId);
    const archiveResult = await ankorstorePollOperation(archiveOpId);

    if (archiveResult.status === "failed") {
      const firstFailure = archiveResult.results[0];
      throw new Error(
        firstFailure?.failureReason ?? "Archivage de l'ancien produit échoué sur Ankorstore",
      );
    }

    oldProductArchived = true;
    logger.info("[Ankorstore Refresh] Old product archived with temp external_id", {
      ankorsProductId: oldAnkorsProductId,
      tempExternalId,
    });

    // ── Step 4: Create new product with the real external_id ──
    report("Chargement de la configuration tarifaire...");
    const pricing = await loadAnkorstorePricingConfig();

    report("Préparation du nouveau produit pour Ankorstore...");
    const shopNameInfo = await prisma.companyInfo.findFirst({ select: { shopName: true } });
    const brandName = shopNameInfo?.shopName ?? "Ma Boutique";

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

    const variantEntries = buildAnkorstoreVariants(product, product.colors);

    if (variantEntries.length === 0) {
      logger.warn("[Ankorstore Refresh] No variants to send", {
        reference: product.reference,
        colorsCount: product.colors.length,
      });
    }

    const allVariantsOutOfStock =
      variantEntries.length === 0 ||
      variantEntries.every((v) => v.entry.stockQuantity === 0);

    const firstVariant = product.colors[0];
    let wholesalePrice = 0;
    let retailPrice = 0;
    if (firstVariant) {
      wholesalePrice = getAnkorstoreWholesalePrice(firstVariant, pricing.wholesale);
      retailPrice = getAnkorstoreRetailPrice(firstVariant, pricing.retail);
    }

    const firstColorId = product.colors[0]?.colorId ?? null;
    const productImages = product.colorImages
      .filter((img) => !firstColorId || img.colorId === firstColorId)
      .sort((a, b) => a.order - b.order)
      .map((img, idx) => ({
        order: idx + 1,
        url: buildPublicImageUrl(img.path),
      }));

    const mainImage = productImages[0]?.url;

    const weightGrams = firstVariant?.weight
      ? Math.max(1, Math.round(firstVariant.weight * 1000))
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

    report("Création de l'opération d'import sur Ankorstore...");
    const { operationId: importOpId } = await ankorstoreCreateCatalogOperation("import");
    logger.info("[Ankorstore Refresh] Created import operation", {
      operationId: importOpId,
      reference: product.reference,
      brandName,
    });

    report("Ajout du nouveau produit à l'opération...");
    await ankorstoreAddProductsToOperation(importOpId, [productInput]);

    report("Lancement de l'opération...");
    await ankorstoreStartOperation(importOpId);

    report("Traitement en cours sur Ankorstore...");
    const importResult = await ankorstorePollOperation(importOpId);

    if (importResult.status === "failed") {
      const firstFailure = importResult.results[0];
      throw new Error(firstFailure?.failureReason ?? "Publication du nouveau produit échouée sur Ankorstore");
    }

    const productResult = importResult.results.find(
      (r) => r.externalProductId === product.reference,
    );

    if (!productResult || productResult.status === "failure") {
      throw new Error(
        productResult?.failureReason ??
          "Nouveau produit non créé sur Ankorstore (résultat introuvable dans la réponse)",
      );
    }

    const ankorsProductId = productResult.ankorstoreProductId;
    if (!ankorsProductId) {
      throw new Error("ankorstoreProductId manquant dans la réponse de l'opération");
    }

    newAnkorsProductId = ankorsProductId;
    logger.info("[Ankorstore Refresh] Created new product", {
      ankorsProductId,
      reference: product.reference,
    });

    // ── Step 5: Fetch variant IDs from Ankorstore ──
    report("Récupération des identifiants des variantes...");
    const ankorsVariants = await ankorstoreGetVariants(ankorsProductId);

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
        logger.warn("[Ankorstore Refresh] Could not find Ankorstore variant ID for SKU", {
          sku: entry.sku,
          reference: product.reference,
        });
      }
    }

    // ── Step 6: Save to local DB ──
    report("Mise à jour locale...");
    await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: {
          ankorsProductId,
          ankorsLastSyncSnapshot: Prisma.DbNull,
          lastRefreshedAt: new Date(),
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

    // ── Step 7: Revalidate + emit ──
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

    logger.info("[Ankorstore Refresh] Success", {
      reference: product.reference,
      newAnkorsProductId,
      archived: allVariantsOutOfStock,
      variantsMapped: variantIdUpdates.length,
    });

    return { success: true, newAnkorsProductId, archived: allVariantsOutOfStock };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Refresh] Error", {
      reference: product.reference,
      error: err,
    });

    // ── Rollback ──
    // Critical: old ankorsProductId must not be permanently lost on partial failure.
    // New ankorsProductId is only saved to DB if fully completed (Step 6).

    // If new product was created on Ankorstore, delete it (prevents orphan)
    if (newAnkorsProductId) {
      try {
        await ankorstoreDeleteProduct(newAnkorsProductId);
        logger.info("[Ankorstore Refresh] Rollback: deleted new product", {
          newAnkorsProductId,
        });
      } catch (cleanupErr) {
        logger.error("[Ankorstore Refresh] Rollback: failed to delete new product", {
          newAnkorsProductId,
          error: cleanupErr,
        });
      }
    }

    // If old product was archived/renamed, restore its external_id via another update operation
    if (oldProductArchived) {
      try {
        report("Restauration de l'ancien produit...");
        const { operationId: restoreOpId } = await ankorstoreCreateCatalogOperation("update");
        await ankorstoreAddProductsToOperation(restoreOpId, [
          {
            externalId: product.reference,
            name: existingAnkorsProduct.name || product.name,
            description: existingAnkorsProduct.description || product.name,
            currency: "EUR",
            vatRate: existingAnkorsProduct.vatRate ?? 20,
            unitMultiplier: 1,
            wholesalePrice: existingAnkorsProduct.wholesalePrice ?? 0,
            retailPrice: existingAnkorsProduct.retailPrice ?? 0,
            countryCode:
              product.manufacturingCountry?.isoCode ??
              product.manufacturingCountry?.pfsCountryRef ??
              "FR",
            variants: [],
          } as AnkorstoreCatalogProductInput,
        ]);
        await ankorstoreStartOperation(restoreOpId);
        await ankorstorePollOperation(restoreOpId);
        logger.info("[Ankorstore Refresh] Rollback: restored old product external_id", {
          ankorsProductId: oldAnkorsProductId,
          reference: product.reference,
        });
      } catch (restoreErr) {
        logger.error("[Ankorstore Refresh] Rollback: failed to restore old product", {
          ankorsProductId: oldAnkorsProductId,
          error: restoreErr,
        });
      }
    }

    progress.status = "error";
    progress.error = errorMsg;
    onProgress?.(progress);

    return { success: false, reason: "error", error: errorMsg };
  }
}
