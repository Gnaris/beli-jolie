import type { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { getCachedSiteConfig } from "@/lib/cached-data";
import { unstable_cache } from "next/cache";

// Re-export shared types & constants (safe for client imports via product-display-shared.ts)
export type { DisplaySectionType, DisplaySection, CarouselType, HomepageCarousel, ProductDisplayConfig } from "@/lib/product-display-shared";
export { DEFAULT_CAROUSEL_IDS, DEFAULT_CAROUSELS, DEFAULT_CONFIG, ensureDefaultCarousels, parseDisplayConfig } from "@/lib/product-display-shared";

import type { ProductDisplayConfig, HomepageCarousel } from "@/lib/product-display-shared";
import { parseDisplayConfig } from "@/lib/product-display-shared";

// ─── Seeded random (deterministic daily shuffle) ────────────────────────────────

function dailySeed(): number {
  const today = new Date().toISOString().slice(0, 10);
  let hash = 0;
  for (let i = 0; i < today.length; i++) {
    hash = ((hash << 5) - hash) + today.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function seededShuffle<T>(array: T[], seed: number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom(seed + i) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─── Core ordering logic ────────────────────────────────────────────────────────

type ProductMinimal = {
  id: string;
  reference: string;
  createdAt: Date;
  categoryId: string | null;
  tags: { tagId: string }[];
  collections: { collectionId: string }[];
};

/**
 * Returns all online product IDs in the order defined by the display config.
 * Each section pulls products in order; products already placed in earlier
 * sections are skipped. Remaining products are shuffled with a daily seed.
 *
 * Cached for 10 minutes to avoid loading 78k products on every request.
 */
export async function getOrderedProductIds(config: ProductDisplayConfig): Promise<string[]> {
  // Cache key includes config hash so changes invalidate
  const configHash = JSON.stringify(config.sections.map(s => `${s.type}-${s.quantity}-${s.categoryId ?? ""}-${s.tagId ?? ""}`));
  return getCachedOrderedIds(configHash);
}

const getCachedOrderedIds = unstable_cache(
  async (_configHash: string) => computeOrderedProductIds(),
  ["ordered-product-ids"],
  { revalidate: 600, tags: ["products", "orders"] }
);

async function computeOrderedProductIds(): Promise<string[]> {
  // Re-parse config from DB inside cache function
  const [configRow, stockProductsConfig] = await Promise.all([
    getCachedSiteConfig("product_display_config"),
    getCachedSiteConfig("show_out_of_stock_products"),
  ]);
  const config = parseDisplayConfig(configRow?.value);
  const showOosProducts = stockProductsConfig?.value !== "false";

  const allProducts: ProductMinimal[] = await prisma.product.findMany({
    where: {
      status: "ONLINE",
      ...(!showOosProducts && { NOT: { colors: { every: { stock: { equals: 0 } } } } }),
    },
    select: {
      id: true,
      reference: true,
      createdAt: true,
      categoryId: true,
      tags: { select: { tagId: true } },
      collections: { select: { collectionId: true } },
    },
  });

  // Bestseller ranking by actual sales
  const bestsellerStats = await prisma.orderItem.groupBy({
    by: ["productRef"],
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
  });
  const bestsellerRank = new Map(bestsellerStats.map((s, i) => [s.productRef, i]));

  const seenIds = new Set<string>();
  const orderedIds: string[] = [];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const seed = dailySeed();

  for (const section of config.sections) {
    if (section.type === "random") continue;

    let candidates: ProductMinimal[] = [];

    switch (section.type) {
      case "new":
        candidates = allProducts
          .filter(p => !seenIds.has(p.id) && p.createdAt >= thirtyDaysAgo)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        break;

      case "bestseller":
        candidates = allProducts
          .filter(p => !seenIds.has(p.id) && bestsellerRank.has(p.reference))
          .sort((a, b) => (bestsellerRank.get(a.reference) ?? 999) - (bestsellerRank.get(b.reference) ?? 999));
        break;

      case "category":
        candidates = allProducts.filter(p => !seenIds.has(p.id) && p.categoryId === section.categoryId);
        if (section.sortBy === "new") {
          candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        } else if (section.sortBy === "bestseller") {
          candidates.sort((a, b) => (bestsellerRank.get(a.reference) ?? 999) - (bestsellerRank.get(b.reference) ?? 999));
        } else {
          candidates = seededShuffle(candidates, seed);
        }
        break;

      case "collection": {
        const collIds = new Set(section.collectionIds ?? []);
        candidates = allProducts.filter(p => !seenIds.has(p.id) && p.collections.some(c => collIds.has(c.collectionId)));
        candidates = seededShuffle(candidates, seed);
        break;
      }

      case "tag":
        candidates = allProducts.filter(p => !seenIds.has(p.id) && p.tags.some(t => t.tagId === section.tagId));
        break;
    }

    for (const p of candidates.slice(0, section.quantity)) {
      seenIds.add(p.id);
      orderedIds.push(p.id);
    }
  }

  // Remaining products — shuffled with daily seed
  const remaining = allProducts.filter(p => !seenIds.has(p.id));
  const shuffled = seededShuffle(remaining, seed);
  orderedIds.push(...shuffled.map(p => p.id));

  return orderedIds;
}

// ─── Homepage carousel data fetching ────────────────────────────────────────────

const CAROUSEL_SELECT = {
  id: true,
  name: true,
  reference: true,
  category: { select: { name: true } },
  colors: {
    select: {
      id: true,
      colorId: true,
      unitPrice: true,
      isPrimary: true,
      discountType: true,
      discountValue: true,
      color: { select: { name: true, hex: true, patternImage: true } },
    },
  },
} as const;

type CarouselPrismaProduct = {
  id: string;
  name: string;
  reference: string;
  category: { name: string };
  colors: {
    id: string;
    colorId: string | null;
    unitPrice: number | Decimal;
    isPrimary: boolean;
    discountType: "PERCENT" | "AMOUNT" | null;
    discountValue: number | Decimal | null;
    color: { name: string; hex: string | null; patternImage?: string | null } | null;
  }[];
};

export async function fetchCarouselProducts(
  carousel: HomepageCarousel,
  bestsellerRefs?: string[],
): Promise<CarouselPrismaProduct[]> {
  switch (carousel.type) {
    case "new":
      return prisma.product.findMany({
        where: { status: "ONLINE" },
        orderBy: { createdAt: "desc" },
        take: carousel.quantity,
        select: CAROUSEL_SELECT,
      });

    case "bestseller": {
      const refs = bestsellerRefs ?? (await prisma.orderItem.groupBy({
        by: ["productRef"],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: carousel.quantity * 2,
      })).map(s => s.productRef);

      if (refs.length === 0) return [];
      const products = await prisma.product.findMany({
        where: { reference: { in: refs }, status: "ONLINE" },
        select: CAROUSEL_SELECT,
      });
      const refOrder = new Map(refs.map((r, i) => [r, i]));
      products.sort((a, b) => (refOrder.get(a.reference) ?? 999) - (refOrder.get(b.reference) ?? 999));
      return products.slice(0, carousel.quantity);
    }

    case "promo":
      return prisma.product.findMany({
        where: {
          status: "ONLINE",
          colors: { some: { discountType: { not: null }, discountValue: { gt: 0 } } },
        },
        orderBy: { updatedAt: "desc" },
        take: carousel.quantity,
        select: CAROUSEL_SELECT,
      });

    case "category":
      return prisma.product.findMany({
        where: { status: "ONLINE", categoryId: carousel.categoryId },
        orderBy: { createdAt: "desc" },
        take: carousel.quantity,
        select: CAROUSEL_SELECT,
      });

    case "subcategory":
      return prisma.product.findMany({
        where: {
          status: "ONLINE",
          subCategories: { some: { id: carousel.subCategoryId } },
        },
        orderBy: { createdAt: "desc" },
        take: carousel.quantity,
        select: CAROUSEL_SELECT,
      });

    case "collection":
      return prisma.product.findMany({
        where: {
          status: "ONLINE",
          collections: { some: { collectionId: { in: carousel.collectionIds ?? [] } } },
        },
        take: carousel.quantity,
        select: CAROUSEL_SELECT,
      });

    case "tag":
      return prisma.product.findMany({
        where: {
          status: "ONLINE",
          tags: { some: { tagId: carousel.tagId } },
        },
        take: carousel.quantity,
        select: CAROUSEL_SELECT,
      });

    case "custom": {
      if (!carousel.productIds?.length) return [];
      const products = await prisma.product.findMany({
        where: { id: { in: carousel.productIds }, status: "ONLINE" },
        select: CAROUSEL_SELECT,
      });
      // Preserve manual order
      const orderMap = new Map(carousel.productIds.map((id, i) => [id, i]));
      products.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
      return products;
    }

    // "reassort" is handled separately in homepage (needs userId)
    default:
      return [];
  }
}
