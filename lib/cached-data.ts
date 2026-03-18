import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

// ─── Catégories (avec sous-catégories) ─────────────────────────────────────────
export const getCachedCategories = unstable_cache(
  async () =>
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { subCategories: { orderBy: { name: "asc" } } },
    }),
  ["filter-categories"],
  { revalidate: 3600, tags: ["categories"] }
);

// ─── Collections (id + name only, for filters) ────────────────────────────────
export const getCachedCollections = unstable_cache(
  async () =>
    prisma.collection.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ["filter-collections"],
  { revalidate: 3600, tags: ["collections"] }
);

// ─── Couleurs ──────────────────────────────────────────────────────────────────
export const getCachedColors = unstable_cache(
  async () =>
    prisma.color.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, hex: true },
    }),
  ["filter-colors"],
  { revalidate: 3600, tags: ["colors"] }
);

// ─── Tags ──────────────────────────────────────────────────────────────────────
export const getCachedTags = unstable_cache(
  async () =>
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ["filter-tags"],
  { revalidate: 3600, tags: ["tags"] }
);

// ─── SiteConfig (clé unique) ───────────────────────────────────────────────────
export const getCachedSiteConfig = unstable_cache(
  async (key: string) =>
    prisma.siteConfig.findUnique({ where: { key } }),
  ["site-config"],
  { revalidate: 300, tags: ["site-config"] }
);
