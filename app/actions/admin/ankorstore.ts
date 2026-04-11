"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { emitProductEvent, type MarketplaceSyncProgress } from "@/lib/product-events";
import { ankorstoreSearchVariants } from "@/lib/ankorstore-api";
import {
  ankorstoreUpdateVariantStock,
  ankorstorePushProducts,
  type AnkorstorePushProduct,
  type AnkorstorePushResult,
} from "@/lib/ankorstore-api-write";
import { applyMarketplaceMarkup, loadMarketplaceMarkupConfigs } from "@/lib/marketplace-pricing";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AnkorstoreMatchResultSerialized {
  bjProductId: string;
  bjProductName: string;
  bjReference: string;
  status: "matched" | "ambiguous" | "unmatched";
  /** Ankorstore variants found for this reference */
  ankorstoreVariants: { id: string; sku: string | null; name: string }[];
  /** How many BJ color variants were matched */
  variantMatchCount: number;
}

export interface AnkorstoreMatchReportSerialized {
  matched: number;
  ambiguous: number;
  unmatched: number;
  total: number;
  reviewItems: AnkorstoreMatchResultSerialized[];
}

// ─── Auto-matching (BJ → Ankorstore search) ────────────────────────────────

/**
 * For each BJ product, search Ankorstore by reference (via variant SKU filter).
 * Much faster than fetching all 9000 Ankorstore products.
 *
 * Strategy:
 * 1. Load all non-archived BJ products (that don't already have an Ankorstore match)
 * 2. For each BJ reference, search Ankorstore variants by skuOrName
 * 3. If variants found → match; if multiple products → ambiguous; if none → unmatched
 * 4. Persist matches to DB
 */
export async function runAnkorstoreAutoMatch(): Promise<{
  success: boolean;
  error?: string;
  report?: AnkorstoreMatchReportSerialized;
}> {
  try {
    await requireAdmin();

    // Load BJ products that are not yet matched
    const bjProducts = await prisma.product.findMany({
      where: {
        status: { not: "ARCHIVED" },
        ankorsProductId: null, // Only unmatched products
      },
      select: {
        id: true,
        name: true,
        reference: true,
        colors: {
          select: {
            id: true,
            saleType: true,
            packQuantity: true,
            color: { select: { name: true } },
          },
        },
      },
      orderBy: { reference: "asc" },
    });

    logger.info("[Ankorstore] Starting auto-match for unmatched BJ products", { count: bjProducts.length });

    let matched = 0;
    let ambiguous = 0;
    let unmatched = 0;
    const reviewItems: AnkorstoreMatchResultSerialized[] = [];

    // Process in batches to respect rate limits (600 req/min)
    for (let i = 0; i < bjProducts.length; i++) {
      const bj = bjProducts[i];

      // Search Ankorstore variants by BJ reference
      let variants: { id: string; sku: string | null; name: string }[];
      try {
        const found = await ankorstoreSearchVariants({ skuOrName: bj.reference.trim() });
        variants = found.map((v) => ({ id: v.id, sku: v.sku, name: v.name }));
      } catch (err) {
        logger.warn("[Ankorstore] Search failed", { reference: bj.reference, error: err instanceof Error ? err.message : String(err) });
        variants = [];
      }

      if (variants.length === 0) {
        // No match found
        unmatched++;
        reviewItems.push({
          bjProductId: bj.id,
          bjProductName: bj.name,
          bjReference: bj.reference,
          status: "unmatched",
          ankorstoreVariants: [],
          variantMatchCount: 0,
        });
        continue;
      }

      // Deduce the Ankorstore product ID from variant relationships
      // All variants from the same product should share a common SKU prefix
      // For now, we take the first variant's product relationship
      // We'll get the productId by fetching the variant with include
      // Actually, the variant search doesn't return product IDs directly.
      // We match by SKU prefix: variants with SKU starting with BJ reference are ours.
      const relevantVariants = variants.filter((v) => {
        if (!v.sku) return true; // Include variants without SKU (matched by name)
        const skuPrefix = v.sku.split("_")[0]?.toUpperCase();
        return skuPrefix === bj.reference.trim().toUpperCase();
      });

      if (relevantVariants.length === 0) {
        unmatched++;
        reviewItems.push({
          bjProductId: bj.id,
          bjProductName: bj.name,
          bjReference: bj.reference,
          status: "unmatched",
          ankorstoreVariants: variants,
          variantMatchCount: 0,
        });
        continue;
      }

      // Match Ankorstore variants to BJ colors (Unit + Pack)
      // SKU format: {ref}_{color} = Unit, {ref}_{color}_Pack{qty} = Pack
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      const bjColors = bj.colors
        .filter((c) => c.color != null)
        .map((c) => ({
          id: c.id,
          name: norm(c.color!.name),
          saleType: c.saleType,
          packQuantity: c.packQuantity,
        }));

      let variantMatchCount = 0;
      for (const av of relevantVariants) {
        if (!av.sku) continue;
        const parts = av.sku.split("_");
        if (parts.length < 2) continue;

        const colorPart = norm(parts[1]);
        const isPack = parts.length >= 3 && parts[2].toLowerCase().startsWith("pack");

        // Find BJ color matching this Ankorstore variant
        const bjColor = bjColors.find((c) => {
          const colorMatch = c.name === colorPart || c.name.includes(colorPart) || colorPart.includes(c.name);
          if (!colorMatch) return false;
          // Match sale type: pack variant → PACK color, otherwise → UNIT
          if (isPack) return c.saleType === "PACK";
          return c.saleType === "UNIT";
        });

        if (bjColor) {
          await prisma.productColor.update({
            where: { id: bjColor.id },
            data: { ankorsVariantId: av.id },
          });
          variantMatchCount++;
        }
      }

      // Use first variant's ID as a proxy for product-level ID
      // (Ankorstore variant IDs are UUIDs, the product ID will come from the relationship)
      matched++;
      await prisma.product.update({
        where: { id: bj.id },
        data: {
          ankorsProductId: relevantVariants[0].id, // Store first variant ID as reference
          ankorsMatchedAt: new Date(),
        },
      });

      // Log progress every 50 products
      if ((i + 1) % 50 === 0) {
        logger.info("[Ankorstore] Progress", { processed: i + 1, total: bjProducts.length });
      }

      // Small delay every 10 requests to stay well under rate limits
      if ((i + 1) % 10 === 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    logger.info("[Ankorstore] Auto-match complete", { matched, ambiguous, unmatched, total: bjProducts.length });

    revalidateTag("products", "default");

    return {
      success: true,
      report: {
        matched,
        ambiguous,
        unmatched,
        total: bjProducts.length,
        reviewItems,
      },
    };
  } catch (e) {
    logger.error("[Ankorstore] Auto-match failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─── Manual matching ────────────────────────────────────────────────────────

/**
 * Manually associate an Ankorstore product with a BJ product.
 */
export async function confirmAnkorstoreMatch(
  ankorstoreProductId: string,
  bjProductId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    if (!ankorstoreProductId || !bjProductId) {
      return { success: false, error: "IDs manquants." };
    }

    // Clear any existing match for this Ankorstore product
    await prisma.product.updateMany({
      where: { ankorsProductId: ankorstoreProductId },
      data: { ankorsProductId: null, ankorsMatchedAt: null },
    });

    // Set new match
    await prisma.product.update({
      where: { id: bjProductId },
      data: {
        ankorsProductId: ankorstoreProductId,
        ankorsMatchedAt: new Date(),
      },
    });

    revalidateTag("products", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Remove Ankorstore match from a BJ product and its colors.
 */
export async function removeAnkorstoreMatch(
  bjProductId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    if (!bjProductId) {
      return { success: false, error: "ID produit manquant." };
    }

    // Clear product match
    await prisma.product.update({
      where: { id: bjProductId },
      data: {
        ankorsProductId: null,
        ankorsMatchedAt: null,
      },
    });

    // Clear variant matches on this product's colors
    await prisma.productColor.updateMany({
      where: { productId: bjProductId, ankorsVariantId: { not: null } },
      data: { ankorsVariantId: null },
    });

    revalidateTag("products", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Manually associate an Ankorstore variant with a BJ ProductColor.
 */
export async function confirmAnkorstoreVariantMatch(
  ankorstoreVariantId: string,
  productColorId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    if (!ankorstoreVariantId || !productColorId) {
      return { success: false, error: "IDs manquants." };
    }

    // Clear any existing match for this Ankorstore variant
    await prisma.productColor.updateMany({
      where: { ankorsVariantId: ankorstoreVariantId },
      data: { ankorsVariantId: null },
    });

    // Set new match
    await prisma.productColor.update({
      where: { id: productColorId },
      data: { ankorsVariantId: ankorstoreVariantId },
    });

    revalidateTag("products", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─── Stock update ─────────────────────────────────────────────────────────

/**
 * Update stock quantity for an Ankorstore variant linked to a BJ ProductColor.
 * Looks up the ankorsVariantId from the ProductColor, then PATCHes Ankorstore.
 */
export async function updateAnkorstoreVariantStock(
  productColorId: string,
  quantity: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    if (!productColorId) {
      return { success: false, error: "ID variante manquant." };
    }
    if (quantity < 0 || !Number.isInteger(quantity)) {
      return { success: false, error: "La quantite doit etre un entier positif." };
    }

    const productColor = await prisma.productColor.findUnique({
      where: { id: productColorId },
      select: { ankorsVariantId: true, color: { select: { name: true } } },
    });

    if (!productColor?.ankorsVariantId) {
      return { success: false, error: "Cette variante n'est pas liee a Ankorstore." };
    }

    const result = await ankorstoreUpdateVariantStock(
      productColor.ankorsVariantId,
      quantity
    );

    if (result.success) {
      logger.info("[Ankorstore] Stock updated via action", {
        productColorId,
        ankorsVariantId: productColor.ankorsVariantId,
        colorName: productColor.color?.name,
        quantity,
      });
    }

    return result;
  } catch (e) {
    logger.error("[Ankorstore] Stock update action failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─── Push single product to Ankorstore ──────────────────────────────────────

/**
 * Internal push logic — no auth check.
 * Called directly by triggerAnkorstoreSync (fire-and-forget, no request context)
 * and by the server action wrapper below.
 */
export async function pushProductToAnkorstoreInternal(
  productId: string,
  operationType: "import" | "update" = "update"
): Promise<{ success: boolean; error?: string }> {
  function emitAnkors(p: Omit<MarketplaceSyncProgress, "marketplace">) {
    emitProductEvent({ type: "MARKETPLACE_SYNC", productId, marketplaceSync: { marketplace: "ankorstore", ...p } });
  }

  try {
    emitAnkors({ step: "Chargement du produit...", progress: 40, status: "in_progress" });
    const r2Url = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_URL || "";

    const prod = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true, name: true, reference: true, description: true,
        ankorsProductId: true,
        dimensionLength: true, dimensionWidth: true, dimensionHeight: true,
        manufacturingCountry: { select: { isoCode: true } },
        compositions: {
          include: { composition: { select: { name: true } } },
          orderBy: { percentage: "desc" },
        },
        colors: {
          select: {
            id: true, saleType: true, stock: true, unitPrice: true,
            packQuantity: true, weight: true,
            color: { select: { name: true } },
            images: { take: 1, orderBy: { order: "asc" }, select: { path: true } },
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

    // Auto-detect operation type: import if not yet linked, update if linked
    const effectiveOp = prod.ankorsProductId ? "update" : "import";

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
      if (c.saleType === "UNIT") return c.color?.name ?? "Default";
      // PACK: derive from packColorLines (first line's colors)
      const lineColors = c.packColorLines?.[0]?.colors?.map((pc) => pc.color.name) ?? [];
      return lineColors.length > 0 ? lineColors.join("-") : "Pack";
    }

    // Helper: get size entries for a variant, fallback to [{ name: "TU", qty: 1 }]
    function variantSizeEntries(c: ProdColor): { name: string; quantity: number }[] {
      const entries = c.variantSizes?.map((vs) => ({ name: vs.size.name, quantity: vs.quantity })) ?? [];
      return entries.length > 0 ? entries : [{ name: "TU", quantity: 1 }];
    }

    for (const c of prod.colors) {
      const colorName = variantColorLabel(c);
      const sizes = variantSizeEntries(c);
      const unitPrice = Number(c.unitPrice ?? 0);
      const imagePath = c.images[0]?.path;
      const imageUrl = imagePath && r2Url ? `${r2Url}${imagePath}` : undefined;
      if (!mainImage && imageUrl) mainImage = imageUrl;

      if (c.saleType === "UNIT" && unitPrice > 0) {
        // One Ankorstore variant per size
        for (const sz of sizes) {
          variants.push({
            sku: truncateSku(`${prod.reference}_${colorName}_${sz.name}`),
            external_id: c.id,
            stock_quantity: c.stock,
            wholesalePrice: applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreWholesale),
            retailPrice: applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreRetail),
            originalWholesalePrice: unitPrice,
            options: [
              { name: "color", value: colorName },
              { name: "size", value: sz.name },
            ],
            ...(imageUrl ? { images: [{ order: 1, url: imageUrl }] } : {}),
          });
        }
      }

      if (c.saleType === "PACK") {
        const packQty = c.packQuantity ?? 12;
        // PACK: apply markup on unit price first, then multiply by pack quantity
        const markedUpUnitPrice = applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreWholesale);
        const markedUpRetailUnit = applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreRetail);
        const packWholesale = Math.round(markedUpUnitPrice * packQty * 100) / 100;
        const packRetail = Math.round(markedUpRetailUnit * packQty * 100) / 100;
        if (unitPrice > 0) {
          // For PACK image: use own images, or fall back to a UNIT variant of same product
          const packImageUrl = imageUrl
            ?? (() => {
              const unitFallback = prod.colors.find((u) => u.saleType === "UNIT" && u.images[0]?.path);
              return unitFallback?.images[0]?.path && r2Url ? `${r2Url}${unitFallback.images[0].path}` : undefined;
            })();
          if (!mainImage && packImageUrl) mainImage = packImageUrl;

          // One Ankorstore variant per size (e.g. Sx6, Mx4, Lx2)
          for (const sz of sizes) {
            variants.push({
              sku: truncateSku(`${prod.reference}_${colorName}_Pack${packQty}_${sz.name}`),
              external_id: c.id,
              stock_quantity: c.stock,
              wholesalePrice: packWholesale,
              retailPrice: packRetail,
              originalWholesalePrice: Math.round(unitPrice * packQty * 100) / 100,
              unit_multiplier: 1,
              options: [
                { name: "color", value: colorName },
                { name: "size", value: `${sz.name}x${sz.quantity}` },
              ],
              ...(packImageUrl ? { images: [{ order: 1, url: packImageUrl }] } : {}),
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

    // Description: {description}\nComposition: ...\nRéférence: {reference}
    const compositionText = prod.compositions.length > 0
      ? prod.compositions.map((c) => `${c.composition.name} ${c.percentage}%`).join(", ")
      : null;
    let desc = prod.description ?? "";
    if (compositionText) desc += `\nComposition : ${compositionText}`;
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
      retail_price: applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreRetail),
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
    try { revalidateTag("products", "default"); } catch { /* fire-and-forget context */ }
    return { success: true };
  } catch (e) {
    logger.error("[Ankorstore] Single push failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Server action wrapper — requires admin session.
 * Use this from UI (button clicks). For fire-and-forget, use pushProductToAnkorstoreInternal directly.
 */
export async function pushSingleProductToAnkorstore(
  productId: string
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  return pushProductToAnkorstoreInternal(productId);
}

/**
 * Check if a product exists on Ankorstore by searching for its reference.
 * Returns the sync status and any found variants.
 */
export async function checkAnkorstoreProduct(
  productId: string
): Promise<{
  status: "linked" | "found_not_linked" | "not_found" | "error";
  ankorsProductId: string | null;
  variantCount: number;
  error?: string;
}> {
  await requireAdmin();

  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { reference: true, ankorsProductId: true },
    });

    if (!product) return { status: "error", ankorsProductId: null, variantCount: 0, error: "Produit introuvable" };

    // Already linked in DB
    if (product.ankorsProductId) {
      // Verify it still exists on Ankorstore
      const variants = await ankorstoreSearchVariants({ skuOrName: product.reference });
      return {
        status: "linked",
        ankorsProductId: product.ankorsProductId,
        variantCount: variants.length,
      };
    }

    // Not linked — search on Ankorstore
    const variants = await ankorstoreSearchVariants({ skuOrName: product.reference });
    if (variants.length > 0) {
      return { status: "found_not_linked", ankorsProductId: null, variantCount: variants.length };
    }

    return { status: "not_found", ankorsProductId: null, variantCount: 0 };
  } catch (e) {
    return {
      status: "error",
      ankorsProductId: null,
      variantCount: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Push products to Ankorstore (bulk) ─────────────────────────────────────

export interface AnkorstorePushReport {
  total: number;
  succeeded: number;
  failed: number;
  results: AnkorstorePushResult[];
}

/**
 * Push all non-archived BJ products to Ankorstore.
 * Creates Unit + Pack variants for each color.
 * Then re-runs matching to link the new variants.
 */
export async function pushProductsToAnkorstore(): Promise<{
  success: boolean;
  error?: string;
  report?: AnkorstorePushReport;
}> {
  try {
    await requireAdmin();

    const r2Url = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_URL || "";

    // Load all non-archived products with colors, compositions, country
    const bjProducts = await prisma.product.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: {
        id: true,
        name: true,
        reference: true,
        description: true,
        dimensionLength: true, dimensionWidth: true, dimensionHeight: true,
        manufacturingCountry: { select: { isoCode: true } },
        compositions: {
          include: { composition: { select: { name: true } } },
          orderBy: { percentage: "desc" },
        },
        colors: {
          select: {
            id: true,
            saleType: true,
            stock: true,
            unitPrice: true,
            packQuantity: true,
            weight: true,
            color: { select: { name: true } },
            images: { take: 1, orderBy: { order: "asc" }, select: { path: true } },
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
      orderBy: { reference: "asc" },
    });

    logger.info("[Ankorstore] Preparing push", { count: bjProducts.length });

    const markupConfigs = await loadMarketplaceMarkupConfigs();

    // Build Ankorstore products
    const pushProducts: AnkorstorePushProduct[] = [];

    for (const prod of bjProducts) {
      const variants: AnkorstorePushProduct["variants"] = [];
      let mainImage: string | undefined;

      // Helper: derive a color label for a variant
      function bulkColorLabel(c: typeof prod.colors[number]): string {
        if (c.saleType === "UNIT") return c.color?.name ?? "Default";
        const lineColors = c.packColorLines?.[0]?.colors?.map((pc) => pc.color.name) ?? [];
        return lineColors.length > 0 ? lineColors.join("-") : "Pack";
      }

      // Helper: get size entries for a variant, fallback to [{ name: "TU", qty: 1 }]
      function bulkSizeEntries(c: typeof prod.colors[number]): { name: string; quantity: number }[] {
        const entries = c.variantSizes?.map((vs) => ({ name: vs.size.name, quantity: vs.quantity })) ?? [];
        return entries.length > 0 ? entries : [{ name: "TU", quantity: 1 }];
      }

      // Ankorstore SKU limit: 50 characters
      function bulkTruncateSku(sku: string): string {
        return sku.length > 50 ? sku.slice(0, 50) : sku;
      }

      for (const c of prod.colors) {
        const colorName = bulkColorLabel(c);
        const sizes = bulkSizeEntries(c);
        const unitPrice = Number(c.unitPrice ?? 0);
        const imagePath = c.images[0]?.path;
        const imageUrl = imagePath && r2Url ? `${r2Url}${imagePath}` : undefined;
        if (!mainImage && imageUrl) mainImage = imageUrl;

        if (c.saleType === "UNIT" && unitPrice > 0) {
          for (const sz of sizes) {
            variants.push({
              sku: bulkTruncateSku(`${prod.reference}_${colorName}_${sz.name}`),
              external_id: c.id,
              stock_quantity: c.stock,
              wholesalePrice: applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreWholesale),
              retailPrice: applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreRetail),
              originalWholesalePrice: unitPrice,
              options: [
                { name: "color", value: colorName },
                { name: "size", value: sz.name },
              ],
              ...(imageUrl ? { images: [{ order: 1, url: imageUrl }] } : {}),
            });
          }
        }

        if (c.saleType === "PACK") {
          const packQty = c.packQuantity ?? 12;
          // PACK: apply markup on unit price first, then multiply by pack quantity
          const bulkMarkedUpUnit = applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreWholesale);
          const bulkMarkedUpRetail = applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreRetail);
          const bulkPackWholesale = Math.round(bulkMarkedUpUnit * packQty * 100) / 100;
          const bulkPackRetail = Math.round(bulkMarkedUpRetail * packQty * 100) / 100;
          if (unitPrice > 0) {
            const packImageUrl = imageUrl
              ?? (() => {
                const unitFallback = prod.colors.find((u) => u.saleType === "UNIT" && u.images[0]?.path);
                return unitFallback?.images[0]?.path && r2Url ? `${r2Url}${unitFallback.images[0].path}` : undefined;
              })();
            if (!mainImage && packImageUrl) mainImage = packImageUrl;

            for (const sz of sizes) {
              variants.push({
                sku: bulkTruncateSku(`${prod.reference}_${colorName}_Pack${packQty}_${sz.name}`),
                external_id: c.id,
                stock_quantity: c.stock,
                wholesalePrice: bulkPackWholesale,
                retailPrice: bulkPackRetail,
                originalWholesalePrice: Math.round(unitPrice * packQty * 100) / 100,
                unit_multiplier: 1,
                options: [
                  { name: "color", value: colorName },
                  { name: "size", value: `${sz.name}x${sz.quantity}` },
                ],
                ...(packImageUrl ? { images: [{ order: 1, url: packImageUrl }] } : {}),
              });
            }
          }
        }
      }

      if (variants.length === 0) continue;

      const basePrice = Number(
        prod.colors.find((c) => c.saleType === "UNIT")?.unitPrice
        ?? prod.colors[0]?.unitPrice
        ?? 0
      );

      // Title: {name} - {reference}
      const title = `${prod.name} - ${prod.reference}`;

      // Description with composition + reference
      const compositionText = prod.compositions.length > 0
        ? prod.compositions.map((c) => `${c.composition.name} ${c.percentage}%`).join(", ")
        : null;
      let desc = prod.description ?? "";
      if (compositionText) desc += `\nComposition : ${compositionText}`;
      desc += `\nRéférence : ${prod.reference}`;
      if (desc.length < 30) desc = `${prod.name}. ${desc}`;

      const bulkMaxPackQty = Math.max(
        1,
        ...prod.colors
          .filter((c) => c.saleType === "PACK" && c.packQuantity)
          .map((c) => c.packQuantity!)
      );

      // Weight: use max weight across variants (in grams for Ankorstore)
      const bulkMaxWeightKg = Math.max(0, ...prod.colors.map((c) => c.weight ?? 0));
      const bulkWeightGrams = bulkMaxWeightKg > 0 ? Math.round(bulkMaxWeightKg * 1000) : undefined;

      pushProducts.push({
        external_id: prod.reference,
        name: title,
        description: desc,
        wholesale_price: applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreWholesale),
        retail_price: applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreRetail),
        vat_rate: 20,
        unit_multiplier: bulkMaxPackQty,
        main_image: mainImage,
        made_in_country: prod.manufacturingCountry?.isoCode ?? undefined,
        ...(bulkWeightGrams ? { weight: bulkWeightGrams } : {}),
        ...(prod.dimensionHeight ? { height: prod.dimensionHeight } : {}),
        ...(prod.dimensionWidth ? { width: prod.dimensionWidth } : {}),
        ...(prod.dimensionLength ? { length: prod.dimensionLength } : {}),
        variants,
      });
    }

    logger.info("[Ankorstore] Pushing products", {
      products: pushProducts.length,
      variants: pushProducts.reduce((acc, p) => acc + p.variants.length, 0),
    });

    // Push to Ankorstore
    const result = await ankorstorePushProducts(pushProducts, "update");

    const succeeded = result.results.filter((r) => r.status === "success").length;
    const failed = result.results.filter((r) => r.status === "failure").length;

    // Log failures
    for (const r of result.results) {
      if (r.status === "failure") {
        logger.warn("[Ankorstore] Push failed for product", {
          externalId: r.externalProductId,
          reason: r.failureReason,
          issues: r.issues?.map((i) => `${i.field}: ${i.message}`),
        });
      }
    }

    revalidateTag("products", "default");

    return {
      success: result.success,
      error: result.error,
      report: {
        total: pushProducts.length,
        succeeded,
        failed,
        results: result.results,
      },
    };
  } catch (e) {
    logger.error("[Ankorstore] Push action failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─── Search ─────────────────────────────────────────────────────────────────

/**
 * Search BJ products by reference or name.
 * Returns top 20 results for manual matching UI.
 */
export async function searchBjProducts(
  query: string
): Promise<
  { id: string; name: string; reference: string; image: string | null }[]
> {
  await requireAdmin();

  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  const products = await prisma.product.findMany({
    where: {
      status: { not: "ARCHIVED" },
      OR: [
        { reference: { contains: trimmed } },
        { name: { contains: trimmed } },
      ],
    },
    select: {
      id: true,
      name: true,
      reference: true,
      colors: {
        where: { isPrimary: true },
        take: 1,
        select: {
          images: {
            take: 1,
            orderBy: { order: "asc" },
            select: { path: true },
          },
        },
      },
    },
    take: 20,
    orderBy: { name: "asc" },
  });

  return products.map((p) => ({
    id: p.id,
    name: p.name,
    reference: p.reference,
    image: p.colors[0]?.images[0]?.path ?? null,
  }));
}
