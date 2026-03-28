// ─── Shared types & constants for product display ────────────────────────────
// Safe to import from client components (no Prisma / server-only deps).
// Server-side logic stays in lib/product-display.ts.

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

export type CarouselType = "reassort" | "new" | "bestseller" | "promo" | "category" | "subcategory" | "collection" | "tag" | "custom";

export type HomepageCarousel = {
  id: string;
  type: CarouselType;
  title: string;
  quantity: number;
  visible: boolean;
  isDefault?: boolean;
  categoryId?: string;
  categoryName?: string;
  subCategoryId?: string;
  subCategoryName?: string;
  collectionIds?: string[];
  collectionNames?: string[];
  tagId?: string;
  tagName?: string;
  productIds?: string[];
};

export type ProductDisplayConfig = {
  catalogMode: "date" | "custom";
  sections: DisplaySection[];
  homepageCarousels: HomepageCarousel[];
};

export const DEFAULT_CAROUSEL_IDS = ["default-reassort", "default-new", "default-bestseller"];

export const DEFAULT_CAROUSELS: HomepageCarousel[] = [
  { id: "default-reassort",   type: "reassort",   title: "Besoin de réassort ?", quantity: 20, visible: true, isDefault: true },
  { id: "default-new",        type: "new",        title: "Nouveautés",           quantity: 20, visible: true, isDefault: true },
  { id: "default-bestseller", type: "bestseller",  title: "Best sellers",         quantity: 20, visible: true, isDefault: true },
];

export const DEFAULT_CONFIG: ProductDisplayConfig = {
  catalogMode: "date",
  sections: [],
  homepageCarousels: [...DEFAULT_CAROUSELS],
};

export function ensureDefaultCarousels(carousels: HomepageCarousel[]): HomepageCarousel[] {
  const result = [...carousels];
  for (const def of DEFAULT_CAROUSELS) {
    if (!result.some(c => c.id === def.id)) {
      result.push({ ...def });
    }
  }
  return result.map(c => {
    const def = DEFAULT_CAROUSELS.find(d => d.id === c.id);
    if (def) return { ...c, isDefault: true, type: def.type };
    return c;
  });
}

export function parseDisplayConfig(value: string | null | undefined): ProductDisplayConfig {
  if (!value) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(value);
    const rawCarousels: HomepageCarousel[] = Array.isArray(parsed.homepageCarousels)
      ? parsed.homepageCarousels.map((c: HomepageCarousel) => ({
          ...c,
          visible: c.visible !== false,
        }))
      : [];
    return {
      catalogMode: parsed.catalogMode === "custom" ? "custom" : "date",
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      homepageCarousels: ensureDefaultCarousels(rawCarousels),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
