import { prisma } from "@/lib/prisma";
import { getCachedSiteConfig } from "@/lib/cached-data";

// ─── Types ──────────────────────────────────────────────────────────────────────

export type DisplaySectionType = "new" | "bestseller" | "category" | "collection" | "tag" | "random";

export type DisplaySection = {
  id: string;
  type: DisplaySectionType;
  quantity: number;
  categoryId?: string;
  categoryName?: string;
  sortBy?: "new" | "bestseller" | "random";
  collectionIds?: string[];
  collectionNames?: string[];
  tagId?: string;
  tagName?: string;
};

export type HomepageCarousel = {
  id: string;
  type: Exclude<DisplaySectionType, "random">;
  title: string;
  quantity: number;
  categoryId?: string;
  categoryName?: string;
  collectionIds?: string[];
  collectionNames?: string[];
  tagId?: string;
  tagName?: string;
};

export type ProductDisplayConfig = {
  catalogMode: "date" | "custom";
  sections: DisplaySection[];
  homepageCarousels: HomepageCarousel[];
};

export const DEFAULT_CONFIG: ProductDisplayConfig = {
  catalogMode: "date",
  sections: [],
  homepageCarousels: [],
};

// ─── Config parsing ─────────────────────────────────────────────────────────────

export function parseDisplayConfig(value: string | null | undefined): ProductDisplayConfig {
  if (!value) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(value);
    return {
      catalogMode: parsed.catalogMode === "custom" ? "custom" : "date",
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      homepageCarousels: Array.isArray(parsed.homepageCarousels) ? parsed.homepageCarousels : [],
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

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
 */
export async function getOrderedProductIds(config: ProductDisplayConfig): Promise<string[]> {
  const stockProductsConfig = await getCachedSiteConfig("show_out_of_stock_products");
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
      color: { select: { name: true, hex: true } },
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
    colorId: string;
    unitPrice: number;
    isPrimary: boolean;
    discountType: "PERCENT" | "AMOUNT" | null;
    discountValue: number | null;
    color: { name: string; hex: string | null };
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

    case "category":
      return prisma.product.findMany({
        where: { status: "ONLINE", categoryId: carousel.categoryId },
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

    default:
      return [];
  }
}
