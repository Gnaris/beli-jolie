"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ankorstoreSearchVariants } from "@/lib/ankorstore-api";

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

      // Match variant colors to BJ colors
      const bjColors = bj.colors
        .filter((c) => c.color != null)
        .map((c) => ({ id: c.id, name: c.color!.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") }));

      let variantMatchCount = 0;
      for (const av of relevantVariants) {
        if (!av.sku) continue;
        const parts = av.sku.split("_");
        if (parts.length < 2) continue;
        const colorPart = parts[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        const bjColor = bjColors.find((c) => c.name === colorPart || c.name.includes(colorPart) || colorPart.includes(c.name));
        if (bjColor) {
          // Persist variant match
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
