import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

// ─── Catégories (avec sous-catégories) ─────────────────────────────────────────
export const getCachedCategories = unstable_cache(
  async () =>
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        subCategories: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, slug: true },
        },
      },
      // Lean select — only what filters need
    }),
  ["filter-categories"],
  { revalidate: 60, tags: ["categories"] }
);

// ─── Collections (id + name only, for filters) ────────────────────────────────
export const getCachedCollections = unstable_cache(
  async () =>
    prisma.collection.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ["filter-collections"],
  { revalidate: 60, tags: ["collections"] }
);

// ─── Couleurs ──────────────────────────────────────────────────────────────────
export const getCachedColors = unstable_cache(
  async () =>
    prisma.color.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, hex: true, patternImage: true, pfsColorRef: true },
    }),
  ["filter-colors"],
  { revalidate: 60, tags: ["colors"] }
);

// ─── Tags ──────────────────────────────────────────────────────────────────────
export const getCachedTags = unstable_cache(
  async () =>
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ["filter-tags"],
  { revalidate: 60, tags: ["tags"] }
);

// ─── Pays de fabrication ─────────────────────────────────────────────────────
export const getCachedManufacturingCountries = unstable_cache(
  async () =>
    prisma.manufacturingCountry.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, isoCode: true },
    }),
  ["filter-manufacturing-countries"],
  { revalidate: 60, tags: ["manufacturing-countries"] }
);

// ─── Tailles (par catégorie) ──────────────────────────────────────────────────
export const getCachedSizes = unstable_cache(
  async () =>
    prisma.size.findMany({
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        categories: {
          select: { categoryId: true },
        },
      },
    }),
  ["filter-sizes"],
  { revalidate: 60, tags: ["sizes"] }
);

/** Get sizes for a specific category */
export async function getCachedSizesByCategory(categoryId: string) {
  const allSizes = await getCachedSizes();
  return allSizes.filter((s) =>
    s.categories.some((c) => c.categoryId === categoryId)
  );
}

// ─── Saisons ────────────────────────────────────────────────────────────────
export const getCachedSeasons = unstable_cache(
  async () =>
    prisma.season.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ["filter-seasons"],
  { revalidate: 60, tags: ["seasons"] }
);

// ─── SiteConfig (clé unique — used heavily, short TTL) ─────────────────────────
// Each key gets its own cache entry to avoid collisions
export function getCachedSiteConfig(key: string) {
  return unstable_cache(
    async () => prisma.siteConfig.findUnique({ where: { key } }),
    [`site-config-${key}`],
    { revalidate: 300, tags: ["site-config"] }
  )();
}

// ─── Company info (from CompanyInfo, used for shipping, legal, etc.) ─────────
const DEFAULT_SHOP_NAME = "Ma Boutique";

export const getCachedCompanyInfo = unstable_cache(
  async () => {
    const info = await prisma.companyInfo.findFirst();
    return info;
  },
  ["company-info"],
  { revalidate: 300, tags: ["company-info"] }
);

export const getCachedShopName = unstable_cache(
  async () => {
    const info = await prisma.companyInfo.findFirst({ select: { shopName: true } });
    return info?.shopName || DEFAULT_SHOP_NAME;
  },
  ["shop-name"],
  { revalidate: 300, tags: ["company-info"] }
);

// ─── Easy Express API key (from SiteConfig) ─────────────────────────────────
export const getCachedEasyExpressApiKey = unstable_cache(
  async () => {
    const row = await prisma.siteConfig.findUnique({ where: { key: "easy_express_api_key" } });
    return row?.value ? decryptIfSensitive("easy_express_api_key", row.value) : null;
  },
  ["easy-express-api-key"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── Gmail config (from SiteConfig) ──────────────────────────────────────────
export const getCachedGmailConfig = unstable_cache(
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["gmail_user", "gmail_app_password", "gmail_notify_email"] } },
    });
    const map = new Map(rows.map(r => [r.key, decryptIfSensitive(r.key, r.value)]));
    return {
      gmailUser: map.get("gmail_user") ?? null,
      gmailPassword: map.get("gmail_app_password") ?? null,
      notifyEmail: map.get("gmail_notify_email") ?? null,
    };
  },
  ["gmail-config"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── PFS configured? (quick check, no decrypt) ─────────────────────────────
export const getCachedHasPfsConfig = unstable_cache(
  async () => {
    const row = await prisma.siteConfig.findUnique({
      where: { key: "pfs_email" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-pfs-config"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── PFS credentials (from SiteConfig) ──────────────────────────────────────
export const getCachedPfsCredentials = unstable_cache(
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["pfs_email", "pfs_password"] } },
    });
    const map = new Map(rows.map(r => [r.key, decryptIfSensitive(r.key, r.value)]));
    return {
      email: map.get("pfs_email") ?? null,
      password: map.get("pfs_password") ?? null,
    };
  },
  ["pfs-credentials"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── Product count (expensive count on 78k rows, cache 5min) ───────────────────
export const getCachedProductCount = unstable_cache(
  async () => prisma.product.count({ where: { status: "ONLINE" } }),
  ["product-count"],
  { revalidate: 300, tags: ["products"] }
);

// ─── Bestseller refs (groupBy on orderItems, cache 10min) ──────────────────────
export const getCachedBestsellerRefs = unstable_cache(
  async (limit = 30) => {
    const stats = await prisma.orderItem.groupBy({
      by: ["productRef"],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
    });
    return stats.map((s) => s.productRef);
  },
  ["bestseller-refs"],
  { revalidate: 600, tags: ["orders"] }
);

// ─── Admin layout warning counts (7 queries, cache 5min) ────────────────────
const NON_FR_LOCALES = ["en", "ar", "zh", "de", "es", "it"];

export const getCachedAdminWarnings = unstable_cache(
  async () => {
    const [
      totalProducts,
      fullyTranslatedProducts,
      unusedColorsCount,
      unusedCompositionsCount,
      unusedTagsCount,
      untranslatedCategoriesCount,
      untranslatedSubCategoriesCount,
      pendingOrdersCount,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({
        where: { AND: NON_FR_LOCALES.map((locale) => ({ translations: { some: { locale } } })) },
      }),
      prisma.color.count({ where: { translations: { none: {} } } }),
      prisma.composition.count({ where: { translations: { none: {} } } }),
      prisma.tag.count({ where: { translations: { none: {} } } }),
      prisma.category.count({ where: { translations: { none: {} } } }),
      prisma.subCategory.count({ where: { translations: { none: {} } } }),
      prisma.order.count({ where: { status: "PENDING" } }),
    ]);

    const untranslatedCount = totalProducts - fullyTranslatedProducts;

    return {
      untranslatedCount,
      unusedColorsCount,
      unusedCompositionsCount,
      unusedTagsCount,
      untranslatedCategoriesCount,
      untranslatedSubCategoriesCount,
      pendingOrdersCount,
    };
  },
  ["admin-warnings"],
  { revalidate: 300, tags: ["products", "categories", "colors", "tags", "compositions", "orders"] }
);

// ─── Dashboard aggregate stats (expensive, cache 5min) ──────────────────────
export const getCachedDashboardStats = unstable_cache(
  async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOf6MonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      totalClients,
      approvedCount,
      totalOrders,
      totalRevenueAgg,
      totalProducts,
      totalCollections,
      ordersThisMonth,
      revenueThisMonthAgg,
      recentOrders,
      orderStatusRaw,
      topProductsRaw,
    ] = await Promise.all([
      prisma.user.count({ where: { role: "CLIENT" } }),
      prisma.user.count({ where: { status: "APPROVED", role: "CLIENT" } }),
      prisma.order.count(),
      prisma.order.aggregate({
        _sum: { totalTTC: true },
        where: { status: { not: "CANCELLED" } },
      }),
      prisma.product.count(),
      prisma.collection.count(),
      prisma.order.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.order.aggregate({
        _sum: { totalTTC: true },
        where: { createdAt: { gte: startOfMonth }, status: { not: "CANCELLED" } },
      }),
      prisma.order.findMany({
        where: { createdAt: { gte: startOf6MonthsAgo }, status: { not: "CANCELLED" } },
        select: { createdAt: true, totalTTC: true },
        take: 1000,
      }),
      prisma.order.groupBy({ by: ["status"], _count: true }),
      prisma.orderItem.groupBy({
        by: ["productName"],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
      }),
    ]);

    return {
      totalClients,
      approvedCount,
      totalOrders,
      totalRevenue: Number(totalRevenueAgg._sum.totalTTC ?? 0),
      totalProducts,
      totalCollections,
      ordersThisMonth,
      revenueThisMonth: Number(revenueThisMonthAgg._sum.totalTTC ?? 0),
      recentOrders: recentOrders.map((o) => ({
        createdAt: o.createdAt.toISOString(),
        totalTTC: Number(o.totalTTC ?? 0),
      })),
      orderStatusRaw: orderStatusRaw.map((s) => ({ status: s.status, count: s._count })),
      topProductsRaw: topProductsRaw.map((p) => ({
        name: p.productName,
        qty: Number(p._sum.quantity ?? 0),
      })),
    };
  },
  ["dashboard-stats"],
  { revalidate: 300, tags: ["orders", "products", "users"] }
);
