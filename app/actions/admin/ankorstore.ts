"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ankorstoreFetchAllProducts } from "@/lib/ankorstore-api";
import { runAutoMatch, type BjProductForMatch } from "@/lib/ankorstore-match";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

// ─── Auto-matching ──────────────────────────────────────────────────────────

/**
 * Fetch all Ankorstore products, match against BJ products by reference,
 * and persist associations to the database.
 */
export async function runAnkorstoreAutoMatch(): Promise<{
  success: boolean;
  error?: string;
  report?: { matched: number; ambiguous: number; unmatched: number; total: number };
}> {
  try {
    await requireAdmin();

    // Fetch Ankorstore products
    logger.info("[Ankorstore] Starting auto-match — fetching catalog");
    const ankorstoreProducts = await ankorstoreFetchAllProducts();

    // Fetch all BJ products with colors for matching
    const bjProducts = await prisma.product.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: {
        id: true,
        name: true,
        reference: true,
        colors: {
          select: { id: true, color: { select: { name: true } } },
        },
      },
    });

    const bjForMatch: BjProductForMatch[] = bjProducts.map((p) => ({
      id: p.id,
      name: p.name,
      reference: p.reference,
      colors: p.colors.map((c) => ({ id: c.id, name: c.color.name })),
    }));

    // Run matching algorithm
    const report = runAutoMatch(ankorstoreProducts, bjForMatch);

    // Persist matched results to DB
    let persistCount = 0;
    for (const result of report.results) {
      if (result.status !== "matched" || result.bjProductIds.length !== 1) continue;

      const bjProductId = result.bjProductIds[0];
      const ankorsProductId = result.ankorstoreProduct.id;

      // Update product-level match
      await prisma.product.update({
        where: { id: bjProductId },
        data: {
          ankorsProductId,
          ankorsMatchedAt: new Date(),
        },
      });

      // Update variant-level matches
      for (const vm of result.variantMatches) {
        if (vm.bjColorId && vm.confidence !== "none") {
          await prisma.productColor.update({
            where: { id: vm.bjColorId },
            data: { ankorsVariantId: vm.ankorstoreVariant.id },
          });
        }
      }

      persistCount++;
    }

    logger.info("[Ankorstore] Auto-match persisted", { persistCount });

    revalidateTag("products", "default");

    return {
      success: true,
      report: {
        matched: report.matched,
        ambiguous: report.ambiguous,
        unmatched: report.unmatched,
        total: report.total,
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
