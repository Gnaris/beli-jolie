"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { emitProductEvent, type MarketplaceSyncProgress } from "@/lib/product-events";
import { ankorstoreSearchProductsByRef, ankorstoreSearchVariants } from "@/lib/ankorstore-api";
import {
  ankorstorePushProducts,
  type AnkorstorePushProduct,
} from "@/lib/ankorstore-api-write";
import { applyMarketplaceMarkup, loadMarketplaceMarkupConfigs } from "@/lib/marketplace-pricing";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

// ─── Push single product to Ankorstore ──────────────────────────────────────

/**
 * Internal push logic — no auth check.
 * Called directly by triggerAnkorstoreSync (fire-and-forget, no request context)
 * and by the server action wrapper below.
 */
export async function pushProductToAnkorstoreInternal(
  productId: string,
  operationType: "import" | "update" = "update",
  options?: { skipRevalidation?: boolean; forceCreate?: boolean; zeroStock?: boolean }
): Promise<{ success: boolean; error?: string }> {
  function emitAnkors(p: Omit<MarketplaceSyncProgress, "marketplace">) {
    emitProductEvent({ type: "MARKETPLACE_SYNC", productId, marketplaceSync: { marketplace: "ankorstore", ...p } });
  }

  try {
    // Mark as pending
    await prisma.product.update({
      where: { id: productId },
      data: { ankorsSyncStatus: "pending", ankorsSyncError: null },
    });

    emitAnkors({ step: "Chargement du produit...", progress: 40, status: "in_progress" });
    const r2Url = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_URL || "";

    const prod = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true, name: true, reference: true, description: true,
        ankorsProductId: true, ankorsSyncStatus: true,
        dimensionLength: true, dimensionWidth: true, dimensionHeight: true,
        dimensionDiameter: true, dimensionCircumference: true,
        manufacturingCountry: { select: { isoCode: true } },
        compositions: {
          include: { composition: { select: { name: true } } },
          orderBy: { percentage: "desc" },
        },
        colors: {
          orderBy: { isPrimary: "desc" },
          select: {
            id: true, saleType: true, stock: true, unitPrice: true,
            packQuantity: true, weight: true,
            color: { select: { name: true } },
            subColors: {
              select: { color: { select: { name: true } } },
              orderBy: { position: "asc" },
            },
            images: { orderBy: { order: "asc" }, select: { path: true } },
            packColorLines: {
              select: { colors: { select: { color: { select: { name: true } } }, orderBy: { position: "asc" } } },
              orderBy: { position: "asc" },
            },
            variantSizes: {
              select: { size: { select: { name: true } }, quantity: true },
              orderBy: { size: { position: "asc" } },
            },
          },
        },
      },
    });

    if (!prod) return { success: false, error: "Produit introuvable." };

    emitAnkors({ step: "Vérification sur Ankorstore...", progress: 20, status: "in_progress" });

    // ALWAYS verify by reference on Ankorstore — never trust stored ID
    let effectiveOp: "import" | "update" = "import";
    try {
      const foundProducts = await ankorstoreSearchProductsByRef(prod.reference);
      if (foundProducts.length > 0) {
        const found = foundProducts[0];
        if (found.archived) {
          logger.warn("[Ankorstore] Product found but archived", { productId, reference: prod.reference });
        } else {
          effectiveOp = "update";
          logger.info("[Ankorstore] Product found on Ankorstore via reference", {
            productId, ankorsId: found.id, reference: prod.reference,
          });
        }
      }
    } catch (err) {
      logger.warn("[Ankorstore] Reference verification failed", {
        reference: prod.reference, error: err instanceof Error ? err.message : String(err),
      });
    }

    // Reference not found on Ankorstore → never auto-create, always ask user first
    if (effectiveOp === "import") {
      // Clear stale link if any
      if (prod.ankorsProductId) {
        await prisma.product.update({
          where: { id: productId },
          data: { ankorsSyncStatus: null, ankorsProductId: null, ankorsMatchedAt: null },
        });
        logger.warn("[Ankorstore] Reference not found, cleared stale link", {
          productId, reference: prod.reference,
        });
      }

      if (!options?.forceCreate) {
        // Block creation — user must explicitly click "Créer"
        return { success: false, error: "ANKORSTORE_PRODUCT_NOT_FOUND" };
      }
    }

    const markupConfigs = await loadMarketplaceMarkupConfigs();

    // Build variants — handle UNIT and PACK independently.
    // UNIT variants have color via color relation.
    // PACK variants have colorId=null, colors come from packColorLines.
    const variants: AnkorstorePushProduct["variants"] = [];
    let mainImage: string | undefined;

    // Ankorstore SKU limit: 50 characters
    function truncateSku(sku: string): string {
      return sku.length > 50 ? sku.slice(0, 50) : sku;
    }

    // Helper: derive a color label for a variant
    type ProdColor = NonNullable<typeof prod>["colors"][number];
    function variantColorLabel(c: ProdColor): string {
      if (c.saleType === "UNIT") {
        const main = c.color?.name ?? "Default";
        const subs = c.subColors?.map((sc) => sc.color.name) ?? [];
        return subs.length > 0 ? [main, ...subs].join("-") : main;
      }
      // PACK: derive from packColorLines (first line's colors)
      const lineColors = c.packColorLines?.[0]?.colors?.map((pc) => pc.color.name) ?? [];
      return lineColors.length > 0 ? lineColors.join("-") : "Pack";
    }

    // Helper: get size entries for a variant, fallback to [{ name: "TU", qty: 1 }]
    function variantSizeEntries(c: ProdColor): { name: string; quantity: number }[] {
      const entries = c.variantSizes?.map((vs) => ({ name: vs.size.name, quantity: vs.quantity })) ?? [];
      return entries.length > 0 ? entries : [{ name: "TU", quantity: 1 }];
    }

    // Helper: build images array for Ankorstore from a color's images
    function buildVariantImages(images: { path: string }[]): { order: number; url: string }[] {
      if (!r2Url) return [];
      return images
        .filter((img) => img.path)
        .map((img, idx) => ({ order: idx + 1, url: `${r2Url}${img.path}` }));
    }

    // Helper: resolve images for a variant — own images first, then any other variant with images
    function resolveVariantImages(c: ProdColor) {
      const own = buildVariantImages(c.images);
      if (own.length > 0) return own;
      const fallback = prod!.colors.find((other) => other.id !== c.id && other.images.length > 0);
      return fallback ? buildVariantImages(fallback.images) : [];
    }

    for (const c of prod.colors) {
      const colorName = variantColorLabel(c);
      const sizes = variantSizeEntries(c);
      const unitPrice = Number(c.unitPrice ?? 0);
      const images = resolveVariantImages(c);
      if (!mainImage && images[0]?.url) mainImage = images[0].url;

      if (c.saleType === "UNIT" && unitPrice > 0) {
        const unitWholesale = applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreWholesale);
        // Retail markup applies on top of wholesale price
        const unitRetail = applyMarketplaceMarkup(unitWholesale, markupConfigs.ankorstoreRetail);
        // One Ankorstore variant per size
        for (const sz of sizes) {
          variants.push({
            sku: truncateSku(`${prod.reference}_${colorName}_${sz.name}`),
            external_id: c.id,
            stock_quantity: options?.zeroStock ? 0 : c.stock,
            wholesalePrice: unitWholesale,
            retailPrice: unitRetail,
            originalWholesalePrice: unitPrice,
            options: [
              { name: "color", value: colorName },
              { name: "size", value: sz.name },
            ],
            ...(images.length > 0 ? { images } : {}),
          });
        }
      }

      if (c.saleType === "PACK") {
        const packQty = c.packQuantity ?? 12;
        // PACK: unitPrice in DB is the total pack price (perUnit × totalQty)
        // Apply markup on the per-unit price first (with rounding), then multiply by qty
        const totalQty = c.variantSizes?.reduce((sum, vs) => sum + vs.quantity, 0) || packQty;
        const perUnitPrice = Math.round((unitPrice / totalQty) * 100) / 100;
        const markedUpUnit = applyMarketplaceMarkup(perUnitPrice, markupConfigs.ankorstoreWholesale);
        const packWholesale = Math.round(markedUpUnit * totalQty * 100) / 100;
        // Retail markup applies on top of the wholesale price
        const packRetail = applyMarketplaceMarkup(packWholesale, markupConfigs.ankorstoreRetail);
        if (unitPrice > 0) {

          // One Ankorstore variant per size (e.g. Sx6, Mx4, Lx2)
          for (const sz of sizes) {
            variants.push({
              sku: truncateSku(`${prod.reference}_${colorName}_Pack${packQty}_${sz.name}`),
              external_id: c.id,
              stock_quantity: options?.zeroStock ? 0 : c.stock,
              wholesalePrice: packWholesale,
              retailPrice: packRetail,
              originalWholesalePrice: unitPrice,
              unit_multiplier: 1,
              options: [
                { name: "color", value: colorName },
                { name: "size", value: `${sz.name}x${sz.quantity}` },
              ],
              ...(images.length > 0 ? { images } : {}),
            });
          }
        }
      }
    }

    if (variants.length === 0) {
      return { success: false, error: "Aucune variante a pousser." };
    }

    // Base price for the product-level wholesale/retail: use first UNIT price, or first available
    const basePrice = Number(
      prod.colors.find((c) => c.saleType === "UNIT")?.unitPrice
      ?? prod.colors[0]?.unitPrice
      ?? 0
    );

    // Title: {name} - {reference}
    const title = `${prod.name} - ${prod.reference}`;

    // Description: {description}\nComposition: ...\nDimensions: ...\nRéférence: {reference}
    const compositionText = prod.compositions.length > 0
      ? prod.compositions.map((c) => `${c.composition.name} ${c.percentage}%`).join(", ")
      : null;
    const dimParts: string[] = [];
    if (prod.dimensionLength) dimParts.push(`Longueur ${prod.dimensionLength} mm`);
    if (prod.dimensionWidth) dimParts.push(`Largeur ${prod.dimensionWidth} mm`);
    if (prod.dimensionHeight) dimParts.push(`Hauteur ${prod.dimensionHeight} mm`);
    if (prod.dimensionDiameter) dimParts.push(`Diamètre ${prod.dimensionDiameter} mm`);
    if (prod.dimensionCircumference) dimParts.push(`Circonférence ${prod.dimensionCircumference} mm`);
    const dimensionText = dimParts.length > 0 ? dimParts.join(" × ") : null;
    const maxWeightForDesc = Math.max(0, ...prod.colors.map((c) => c.weight ?? 0));

    let desc = prod.description ?? "";
    if (compositionText) desc += `\nComposition : ${compositionText}`;
    if (dimensionText) desc += `\nDimensions : ${dimensionText}`;
    if (maxWeightForDesc > 0) desc += `\nPoids : ${maxWeightForDesc} kg`;
    desc += `\nRéférence : ${prod.reference}`;
    if (desc.length < 30) desc = `${prod.name}. ${desc}`;

    // Optimistic link: mark product as linked before polling
    // (Ankorstore processing can take 10-15 min; we don't want to block)
    if (!prod.ankorsProductId) {
      await prisma.product.update({
        where: { id: productId },
        data: { ankorsProductId: prod.reference, ankorsMatchedAt: new Date() },
      });
      logger.info("[Ankorstore] Product optimistically linked", { productId, ankorsProductId: prod.reference });
    }

    // Product-level unit_multiplier: use the max pack quantity across variants
    // (if there are packs, Ankorstore needs to know the lot size at product level)
    const maxPackQty = Math.max(
      1,
      ...prod.colors
        .filter((c) => c.saleType === "PACK" && c.packQuantity)
        .map((c) => c.packQuantity!)
    );

    // Weight: use max weight across variants (in grams for Ankorstore)
    const maxWeightKg = Math.max(0, ...prod.colors.map((c) => c.weight ?? 0));
    const weightGrams = maxWeightKg > 0 ? Math.round(maxWeightKg * 1000) : undefined;

    const pushPayload: AnkorstorePushProduct = {
      external_id: prod.reference,
      name: title,
      description: desc,
      wholesale_price: applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreWholesale),
      retail_price: applyMarketplaceMarkup(
        applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreWholesale),
        markupConfigs.ankorstoreRetail
      ),
      vat_rate: 20,
      unit_multiplier: maxPackQty,
      main_image: mainImage,
      made_in_country: prod.manufacturingCountry?.isoCode ?? undefined,
      // Dimensions in mm (from DB), weight in grams
      ...(weightGrams ? { weight: weightGrams } : {}),
      ...(prod.dimensionHeight ? { height: prod.dimensionHeight } : {}),
      ...(prod.dimensionWidth ? { width: prod.dimensionWidth } : {}),
      ...(prod.dimensionLength ? { length: prod.dimensionLength } : {}),
      variants,
    };

    emitAnkors({ step: `Envoi de ${variants.length} variante(s)...`, progress: 60, status: "in_progress" });

    logger.info("[Ankorstore] Push payload", {
      productId,
      reference: prod.reference,
      operation: effectiveOp,
      name: title,
      mainImage: mainImage ?? "(none)",
      variantCount: variants.length,
      wholesalePrice: pushPayload.wholesale_price,
      retailPrice: pushPayload.retail_price,
      variants: variants.map((v) => ({
        sku: v.sku,
        stock: v.stock_quantity,
        wholesale: v.wholesalePrice,
        retail: v.retailPrice,
        hasImage: !!v.images?.length,
        options: v.options.map((o) => `${o.name}=${o.value}`).join(", "),
      })),
    });

    const result = await ankorstorePushProducts([pushPayload], effectiveOp);
    emitAnkors({ step: "Vérification du résultat...", progress: 85, status: "in_progress" });

    logger.info("[Ankorstore] Push result", {
      productId,
      success: result.success,
      error: result.error,
      results: result.results.map((r) => ({
        externalId: r.externalProductId,
        status: r.status,
        failureReason: r.failureReason,
        issues: r.issues,
      })),
    });

    if (!result.success) {
      // Rollback optimistic link on failure
      if (!prod.ankorsProductId) {
        await prisma.product.update({
          where: { id: productId },
          data: { ankorsProductId: null, ankorsMatchedAt: null },
        });
        logger.warn("[Ankorstore] Rolled back optimistic link", { productId, error: result.error, results: result.results });
      }
      const detailedError = result.error
        || result.results.map((r) => {
          if (r.status === "failure") {
            const issues = r.issues?.map((i) => `${i.field}: ${i.message}`).join("; ");
            return `${r.externalProductId}: ${issues || r.failureReason || "Unknown"}`;
          }
          return null;
        }).filter(Boolean).join(" | ")
        || "Echec du push.";
      return { success: false, error: detailedError };
    }

    const productResult = result.results[0];
    if (productResult?.status === "failure") {
      // Rollback optimistic link on failure
      if (!prod.ankorsProductId) {
        await prisma.product.update({
          where: { id: productId },
          data: { ankorsProductId: null, ankorsMatchedAt: null },
        });
        logger.warn("[Ankorstore] Rolled back optimistic link (product failure)", {
          productId,
          failureReason: productResult.failureReason,
          issues: productResult.issues,
        });
      }
      const issues = productResult.issues?.map((i) => `${i.field}: ${i.message}`).join("; ");
      return { success: false, error: `Echec: ${issues ?? productResult.failureReason}` };
    }

    // revalidateTag may fail when called from fire-and-forget context
    // (e.g. triggerAnkorstoreSync during page render). That's OK — the
    // caller (createProduct/updateProduct) already revalidates.
    // When skipRevalidation is true (batch operations), the caller handles
    // a single revalidateTag at the end of the batch instead of per-product.
    if (!options?.skipRevalidation) {
      try { revalidateTag("products", "default"); } catch { /* fire-and-forget context */ }
    }

    // Mark as synced
    await prisma.product.update({
      where: { id: productId },
      data: { ankorsSyncStatus: "synced", ankorsSyncError: null, ankorsSyncedAt: new Date() },
    });

    return { success: true };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.error("[Ankorstore] Single push failed", {
      error: errorMsg,
    });

    // Persist error to DB
    await prisma.product.update({
      where: { id: productId },
      data: {
        ankorsSyncStatus: "failed",
        ankorsSyncError: errorMsg.slice(0, 5000),
      },
    }).catch(() => {}); // Don't throw on cleanup failure

    return { success: false, error: errorMsg };
  }
}

/**
 * Server action wrapper — requires admin session.
 * Use this from UI (button clicks). For fire-and-forget, use pushProductToAnkorstoreInternal directly.
 */
export async function pushSingleProductToAnkorstore(
  productId: string,
  { forceCreate = false }: { forceCreate?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  return pushProductToAnkorstoreInternal(productId, "update", { forceCreate });
}

// ─── Check product existence on Ankorstore ──────────────────────────────────

/**
 * Check if a product reference exists on Ankorstore.
 * Tries multiple strategies:
 *   1. Variant search by reference (skuOrName filter)
 *   2. Variant search by first expected SKU ({ref}_{color})
 *   3. Variant search by exact first variant SKU ({ref}_{color}_{size})
 * If not found, clears stale DB state and returns exists=false.
 */
export async function checkAnkorstoreProductExists(
  productId: string,
): Promise<{ exists: boolean; error?: string }> {
  await requireAdmin();

  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        reference: true,
        colors: {
          take: 1,
          orderBy: { isPrimary: "desc" },
          select: {
            saleType: true,
            color: { select: { name: true } },
            subColors: {
              select: { color: { select: { name: true } } },
              orderBy: { position: "asc" },
            },
            variantSizes: {
              take: 1,
              orderBy: { size: { position: "asc" } },
              select: { size: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!product) return { exists: false, error: "Produit introuvable" };

    // Build the expected first SKU to use as search queries
    const firstColor = product.colors[0];
    const colorName = firstColor?.saleType === "UNIT"
      ? (() => {
          const main = firstColor.color?.name ?? "Default";
          const subs = firstColor.subColors?.map((sc) => sc.color.name) ?? [];
          return subs.length > 0 ? [main, ...subs].join("-") : main;
        })()
      : null;
    const firstSize = firstColor?.variantSizes[0]?.size?.name ?? "TU";

    // Strategy 1: search by reference (skuOrName=V396E)
    const foundProducts = await ankorstoreSearchProductsByRef(product.reference);
    let found = foundProducts.find((p) => !p.archived);
    if (found) {
      logger.info(`[Ankorstore] checkExists: found by reference`, { reference: product.reference });
      // Persist the link so we don't re-check next time
      await prisma.product.update({
        where: { id: productId },
        data: { ankorsProductId: product.reference, ankorsMatchedAt: new Date(), ankorsSyncStatus: "synced", ankorsSyncError: null },
      });
      return { exists: true };
    }

    // Strategy 2: search by SKU prefix ({ref}_{color})
    if (colorName) {
      const skuPrefix = `${product.reference}_${colorName}`;
      const variants = await ankorstoreSearchVariants({ skuOrName: skuPrefix });
      if (variants.length > 0) {
        logger.info(`[Ankorstore] checkExists: found by SKU prefix`, { skuPrefix });
        await prisma.product.update({
          where: { id: productId },
          data: { ankorsProductId: product.reference, ankorsMatchedAt: new Date(), ankorsSyncStatus: "synced", ankorsSyncError: null },
        });
        return { exists: true };
      }

      // Strategy 3: exact first SKU ({ref}_{color}_{size})
      const exactSku = `${product.reference}_${colorName}_${firstSize}`;
      const exactVariants = await ankorstoreSearchVariants({ sku: exactSku });
      if (exactVariants.length > 0) {
        logger.info(`[Ankorstore] checkExists: found by exact SKU`, { exactSku });
        await prisma.product.update({
          where: { id: productId },
          data: { ankorsProductId: product.reference, ankorsMatchedAt: new Date(), ankorsSyncStatus: "synced", ankorsSyncError: null },
        });
        return { exists: true };
      }
    }

    logger.info(`[Ankorstore] checkExists: not found`, { reference: product.reference });

    // Not found — persist "not_found" so we don't re-check on every page load
    await prisma.product.update({
      where: { id: productId },
      data: { ankorsSyncStatus: "not_found", ankorsProductId: null, ankorsMatchedAt: null, ankorsSyncError: null },
    });

    return { exists: false };
  } catch (err) {
    logger.error(`[Ankorstore] checkAnkorstoreProductExists failed`, {
      productId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { exists: false, error: err instanceof Error ? err.message : String(err) };
  }
}
