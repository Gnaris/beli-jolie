"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
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

    logger.info("[Ankorstore] Starting auto-match for %d unmatched BJ products", bjProducts.length);

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
        logger.warn("[Ankorstore] Search failed for ref %s: %s", bj.reference, err);
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
        logger.info("[Ankorstore] Progress: %d/%d processed", i + 1, bjProducts.length);
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
 * Push a single BJ product to Ankorstore with Unit + Pack variants.
 */
export async function pushSingleProductToAnkorstore(
  productId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    const r2Url = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_URL || "";

    const prod = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true, name: true, reference: true, description: true,
        manufacturingCountry: { select: { isoCode: true } },
        compositions: {
          include: { composition: { select: { name: true } } },
          orderBy: { percentage: "desc" },
        },
        colors: {
          select: {
            id: true, saleType: true, stock: true, unitPrice: true,
            packQuantity: true,
            color: { select: { name: true } },
            images: { take: 1, orderBy: { order: "asc" }, select: { path: true } },
          },
        },
      },
    });

    if (!prod) return { success: false, error: "Produit introuvable." };

    const markupConfigs = await loadMarketplaceMarkupConfigs();

    // Group by color
    const colorGroups = new Map<string, typeof prod.colors>();
    for (const c of prod.colors) {
      const name = c.color?.name ?? "Default";
      const group = colorGroups.get(name) ?? [];
      group.push(c);
      colorGroups.set(name, group);
    }

    const variants: AnkorstorePushProduct["variants"] = [];
    let mainImage: string | undefined;

    for (const [colorName, colorVariants] of colorGroups) {
      const unitVar = colorVariants.find((c) => c.saleType === "UNIT");
      const packVar = colorVariants.find((c) => c.saleType === "PACK");
      const unitPrice = Number(unitVar?.unitPrice ?? 0);
      const imagePath = unitVar?.images[0]?.path ?? packVar?.images[0]?.path;
      const imageUrl = imagePath && r2Url ? `${r2Url}${imagePath}` : undefined;
      if (!mainImage && imageUrl) mainImage = imageUrl;

      if (unitVar && unitPrice > 0) {
        variants.push({
          sku: `${prod.reference}_${colorName}`,
          external_id: unitVar.id,
          stock_quantity: unitVar.stock,
          wholesalePrice: applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreWholesale),
          retailPrice: applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreRetail),
          originalWholesalePrice: unitPrice,
          options: [
            { name: "color", value: colorName },
            { name: "size", value: "Unite" },
          ],
          ...(imageUrl ? { images: [{ order: 1, url: imageUrl }] } : {}),
        });
      }

      if (packVar) {
        const packQty = packVar.packQuantity ?? 12;
        const packPrice = unitPrice * packQty;
        if (packPrice > 0) {
          variants.push({
            sku: `${prod.reference}_${colorName}_Pack${packQty}`,
            external_id: packVar.id,
            stock_quantity: packVar.stock,
            wholesalePrice: applyMarketplaceMarkup(packPrice, markupConfigs.ankorstoreWholesale),
            retailPrice: applyMarketplaceMarkup(packPrice, markupConfigs.ankorstoreRetail),
            originalWholesalePrice: packPrice,
            options: [
              { name: "color", value: colorName },
              { name: "size", value: `Pack x${packQty}` },
            ],
            ...(imageUrl ? { images: [{ order: 1, url: imageUrl }] } : {}),
          });
        }
      }
    }

    if (variants.length === 0) {
      return { success: false, error: "Aucune variante a pousser." };
    }

    const basePrice = Number(prod.colors.find((c) => c.saleType === "UNIT")?.unitPrice ?? 0);

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

    const result = await ankorstorePushProducts(
      [{
        external_id: prod.reference,
        name: title,
        description: desc,
        wholesale_price: applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreWholesale),
        retail_price: applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreRetail),
        vat_rate: 20,
        main_image: mainImage,
        made_in_country: prod.manufacturingCountry?.isoCode ?? undefined,
        variants,
      }],
      "update"
    );

    if (!result.success) {
      return { success: false, error: result.error ?? "Echec du push." };
    }

    const productResult = result.results[0];
    if (productResult?.status === "failure") {
      const issues = productResult.issues?.map((i) => `${i.field}: ${i.message}`).join("; ");
      return { success: false, error: `Echec: ${issues ?? productResult.failureReason}` };
    }

    revalidateTag("products", "default");
    return { success: true };
  } catch (e) {
    logger.error("[Ankorstore] Single push failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
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
            color: { select: { name: true } },
            images: { take: 1, orderBy: { order: "asc" }, select: { path: true } },
          },
        },
      },
      orderBy: { reference: "asc" },
    });

    logger.info("[Ankorstore] Preparing push for %d products", { count: bjProducts.length });

    const markupConfigs = await loadMarketplaceMarkupConfigs();

    // Build Ankorstore products
    const pushProducts: AnkorstorePushProduct[] = [];

    for (const prod of bjProducts) {
      // Group colors by name
      const colorGroups = new Map<string, typeof prod.colors>();
      for (const c of prod.colors) {
        const name = c.color?.name ?? "Default";
        const group = colorGroups.get(name) ?? [];
        group.push(c);
        colorGroups.set(name, group);
      }

      const variants: AnkorstorePushProduct["variants"] = [];
      let mainImage: string | undefined;

      for (const [colorName, colorVariants] of colorGroups) {
        const unitVar = colorVariants.find((c) => c.saleType === "UNIT");
        const packVar = colorVariants.find((c) => c.saleType === "PACK");
        const unitPrice = Number(unitVar?.unitPrice ?? 0);
        const imagePath = unitVar?.images[0]?.path ?? packVar?.images[0]?.path;
        const imageUrl = imagePath && r2Url ? `${r2Url}${imagePath}` : undefined;

        if (!mainImage && imageUrl) mainImage = imageUrl;

        // Unit variant
        if (unitVar && unitPrice > 0) {
          variants.push({
            sku: `${prod.reference}_${colorName}`,
            external_id: unitVar.id,
            stock_quantity: unitVar.stock,
            wholesalePrice: applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreWholesale),
            retailPrice: applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreRetail),
            originalWholesalePrice: unitPrice,
            options: [
              { name: "color", value: colorName },
              { name: "size", value: "Unite" },
            ],
            ...(imageUrl ? { images: [{ order: 1, url: imageUrl }] } : {}),
          });
        }

        // Pack variant
        if (packVar) {
          const packQty = packVar.packQuantity ?? 12;
          const packPrice = unitPrice * packQty;
          if (packPrice > 0) {
            variants.push({
              sku: `${prod.reference}_${colorName}_Pack${packQty}`,
              external_id: packVar.id,
              stock_quantity: packVar.stock,
              wholesalePrice: applyMarketplaceMarkup(packPrice, markupConfigs.ankorstoreWholesale),
              retailPrice: applyMarketplaceMarkup(packPrice, markupConfigs.ankorstoreRetail),
              originalWholesalePrice: packPrice,
              options: [
                { name: "color", value: colorName },
                { name: "size", value: `Pack x${packQty}` },
              ],
              ...(imageUrl ? { images: [{ order: 1, url: imageUrl }] } : {}),
            });
          }
        }
      }

      if (variants.length === 0) continue;

      const basePrice = Number(prod.colors.find((c) => c.saleType === "UNIT")?.unitPrice ?? 0);

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

      pushProducts.push({
        external_id: prod.reference,
        name: title,
        description: desc,
        wholesale_price: applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreWholesale),
        retail_price: applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreRetail),
        vat_rate: 20,
        main_image: mainImage,
        made_in_country: prod.manufacturingCountry?.isoCode ?? undefined,
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
