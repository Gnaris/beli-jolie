import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";
import { pfsGetColors } from "@/lib/pfs-api-write";
import { PFS_COLORS } from "@/lib/marketplace-excel/pfs-taxonomy";
import { hexForPfsColor } from "@/lib/marketplace-excel/pfs-color-hex";
import { logger } from "@/lib/logger";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";

/**
 * Helper multi-tenant : construit une fonction cachée avec des clés et tags
 * préfixés par le tenant courant, pour éviter le cross-tenant cache leak.
 *
 * Bug initial : `unstable_cache(fn, ["favicon"], {tags:["site-config"]})`
 * partageait la même entrée de cache entre TOUS les tenants, donc le favicon
 * de Beli & Jolie était servi à toutes les boutiques après le premier hit.
 *
 * Cette version rejoue une nouvelle instance de cache par tenant (une Map
 * mémoïse pour ne pas re-construire à chaque hit).
 */
type CachedFn<Args extends unknown[], T> = (...a: Args) => Promise<T>;
type CacheOpts = { revalidate?: number; tags?: string[] };

/**
 * Version SANS tenant : la fonction ne prend pas tid en param (usage direct).
 * Note : la fonction interne ne voit PAS le tenant courant — l'extension
 * Prisma peut échouer à scoper si l'ALS/headers sont perdus dans le
 * callback unstable_cache. Préférer `tenantScopedCacheWithTid` pour toute
 * lecture Prisma tenant-scopée.
 */
function tenantScopedCache<Args extends unknown[], T>(
  keyBase: string,
  fn: CachedFn<Args, T>,
  baseKeyParts: string[],
  opts: CacheOpts
): CachedFn<Args, T> {
  const memo = new Map<string, CachedFn<Args, T>>();
  return (async (...args: Args): Promise<T> => {
    const tid = getCurrentTenantIdSync() ?? "global";
    let cached = memo.get(tid);
    if (!cached) {
      const tags = (opts.tags ?? []).map((t) => `${t}:${tid}`);
      cached = unstable_cache(fn, [...baseKeyParts, tid, ...args.map(String)], {
        revalidate: opts.revalidate,
        tags,
      });
      memo.set(tid, cached);
    }
    return cached(...args);
  }) as CachedFn<Args, T>;
}

/**
 * Version qui passe le tid capturé en 1ᵉʳ argument du callback pour
 * qu'il puisse scoper EXPLICITEMENT ses queries Prisma. Nécessaire pour
 * les lectures tenant-scopées : à l'intérieur de unstable_cache, l'ALS
 * peut être vide et l'extension retombe alors en passthrough (fuite).
 *
 * Le callback reçoit `(tid, ...args)`. Si `tid === "global"`, l'appel est
 * hors contexte tenant (script CLI) — la query peut lire globalement.
 */
function tenantScopedCacheWithTid<Args extends unknown[], T>(
  keyBase: string,
  fn: (tid: string, ...a: Args) => Promise<T>,
  baseKeyParts: string[],
  opts: CacheOpts,
): CachedFn<Args, T> {
  const memo = new Map<string, (...a: Args) => Promise<T>>();
  return (async (...args: Args): Promise<T> => {
    // Résolution robuste du tenant :
    // 1) ALS (rapide, sync) — peuplé si un caller amont a fait bindTenantId
    // 2) headers() — fallback fiable dans un server component, quel que soit
    //    l'ordre d'exécution parallèle des composants.
    // Sans ce fallback headers, les caches se collent en "global" quand ils
    // sont appelés depuis un composant scheduled avant le bind du parent
    // (cas Next 16 : generateMetadata parallèle avec RootLayout).
    let tid = getCurrentTenantIdSync();
    if (!tid) {
      try {
        const { headers } = await import("next/headers");
        const h = await headers();
        tid = h.get("x-tenant-id");
      } catch {
        // hors contexte requête (script CLI) : accepte "global".
      }
    }
    const finalTid = tid ?? "global";
    let cached = memo.get(finalTid);
    if (!cached) {
      const tags = (opts.tags ?? []).map((t) => `${t}:${finalTid}`);
      cached = unstable_cache(
        (...a: Args) => fn(finalTid, ...a),
        [...baseKeyParts, finalTid, ...args.map(String)],
        { revalidate: opts.revalidate, tags },
      );
      memo.set(finalTid, cached);
    }
    return cached(...args);
  }) as CachedFn<Args, T>;
}

export interface PfsLiveColor {
  reference: string;   // PFS API reference (e.g. "GOLDEN", "SILVER")
  value: string;       // hex color
  image: string | null;
  label: string;       // French display label (e.g. "Doré", "Argent")
}

// ─── Catégories (avec sous-catégories) ─────────────────────────────────────────
export const getCachedCategories = unstable_cache(
  async () =>
    prisma.category.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
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
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, hex: true, patternImage: true },
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

// ─── Codes SH (bibliothèque douanière) ──────────────────────────────────────
export const getCachedHsCodes = unstable_cache(
  async () =>
    prisma.hsCode.findMany({
      orderBy: [{ position: "asc" }, { code: "asc" }],
      select: { id: true, code: true, label: true },
    }),
  ["filter-hs-codes"],
  { revalidate: 3600, tags: ["hs-codes"] }
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

// ─── Tailles (bibliothèque globale) ───────────────────────────────────────────
export const getCachedSizes = unstable_cache(
  async () =>
    prisma.size.findMany({
      orderBy: { position: "asc" },
      select: { id: true, name: true },
    }),
  ["filter-sizes"],
  { revalidate: 60, tags: ["sizes"] }
);

// ─── Saisons ────────────────────────────────────────────────────────────────
export const getCachedSeasons = unstable_cache(
  async () =>
    prisma.season.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ["filter-seasons"],
  { revalidate: 60, tags: ["seasons"] }
);

// ─── Compositions (id + name only, for public product filters) ──────────────
export const getCachedCompositions = unstable_cache(
  async () =>
    prisma.composition.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ["filter-compositions"],
  { revalidate: 60 * 60, tags: ["compositions"] }
);

// ─── SiteConfig (clé unique — used heavily, short TTL) ─────────────────────────
// Each key gets its own cache entry, scoped par tenant courant.
const _siteConfigCache = tenantScopedCache(
  "site-config",
  async (key: string) => {
    const tid = getCurrentTenantIdSync();
    // findFirst (au lieu de findUnique) car la PK est encore `key` seul :
    // avec extension multi-tenant on filtre par tenantId auto ; sans
    // extension (scripts) on retombe sur la row globale.
    return tid
      ? prisma.siteConfig.findFirst({ where: { key, tenantId: tid } })
      : prisma.siteConfig.findFirst({ where: { key } });
  },
  ["site-config"],
  { revalidate: 300, tags: ["site-config"] }
);
export function getCachedSiteConfig(key: string) {
  return _siteConfigCache(key);
}

// ─── Business hours (cached 5min) ─────────────────────────────────────────────
const _businessHoursCache = tenantScopedCache(
  "business-hours",
  async () => {
    const tid = getCurrentTenantIdSync();
    const row = tid
      ? await prisma.siteConfig.findFirst({ where: { key: "business_hours", tenantId: tid } })
      : await prisma.siteConfig.findFirst({ where: { key: "business_hours" } });
    if (!row?.value) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  },
  ["business-hours"],
  { revalidate: 300, tags: ["site-config"] }
);
export function getCachedBusinessHours() {
  return _businessHoursCache();
}

// ─── Company info (from CompanyInfo, used for shipping, legal, etc.) ─────────
const DEFAULT_SHOP_NAME = "Ma Boutique";

export const getCachedCompanyInfo = tenantScopedCacheWithTid(
  "company-info",
  async (tid) => {
    // Scope explicite : dans un callback unstable_cache l'ALS est vide et
    // l'extension retombe en passthrough (fuite cross-tenant si pas de where).
    return prisma.companyInfo.findFirst({
      where: tid === "global" ? undefined : { tenantId: tid },
    });
  },
  ["company-info"],
  { revalidate: 300, tags: ["company-info"] }
);

export const getCachedShopName = tenantScopedCacheWithTid(
  "shop-name",
  async (tid) => {
    const info = await prisma.companyInfo.findFirst({
      where: tid === "global" ? undefined : { tenantId: tid },
      select: { shopName: true },
    });
    return info?.shopName || DEFAULT_SHOP_NAME;
  },
  ["shop-name"],
  { revalidate: 300, tags: ["company-info"] }
);

// ─── Favicon (custom uploaded icons, fallback = generated initial) ──────────
export interface CustomFavicon {
  /** Public path of the 32×32 PNG served by /icon. */
  icon: string;
  /** Public path of the 180×180 PNG served by /apple-icon. */
  appleIcon: string;
}

export const getCachedFavicon = tenantScopedCache<[], CustomFavicon | null>(
  "site-favicon",
  async () => {
    const tid = getCurrentTenantIdSync();
    const row = tid
      ? await prisma.siteConfig.findFirst({ where: { key: "site_favicon", tenantId: tid }, select: { value: true } })
      : await prisma.siteConfig.findFirst({ where: { key: "site_favicon" }, select: { value: true } });
    if (!row?.value) return null;
    try {
      const parsed = JSON.parse(row.value) as Partial<CustomFavicon>;
      if (parsed && typeof parsed.icon === "string" && typeof parsed.appleIcon === "string") {
        return { icon: parsed.icon, appleIcon: parsed.appleIcon };
      }
      return null;
    } catch {
      return null;
    }
  },
  ["site-favicon"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── Easy Express API key (from SiteConfig) ─────────────────────────────────
export const getCachedEasyExpressApiKey = tenantScopedCache(
  "easy-express-api-key",
  async () => {
    const tid = getCurrentTenantIdSync();
    const row = tid
      ? await prisma.siteConfig.findFirst({ where: { key: "easy_express_api_key", tenantId: tid } })
      : await prisma.siteConfig.findFirst({ where: { key: "easy_express_api_key" } });
    return row?.value ? decryptIfSensitive("easy_express_api_key", row.value) : null;
  },
  ["easy-express-api-key"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── Shipping margin (from SiteConfig) ───────────────────────────────────────

export const getCachedShippingMargin = tenantScopedCache(
  "shipping-margin",
  async () => {
    const tid = getCurrentTenantIdSync();
    const [typeRow, valueRow] = tid
      ? await Promise.all([
          prisma.siteConfig.findFirst({ where: { key: "shipping_margin_type", tenantId: tid } }),
          prisma.siteConfig.findFirst({ where: { key: "shipping_margin_value", tenantId: tid } }),
        ])
      : await Promise.all([
          prisma.siteConfig.findFirst({ where: { key: "shipping_margin_type" } }),
          prisma.siteConfig.findFirst({ where: { key: "shipping_margin_value" } }),
        ]);
    return {
      type: (typeRow?.value as "fixed" | "percent") || "fixed",
      value: Number(valueRow?.value) || 0,
    };
  },
  ["shipping-margin"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── PFS configured? (quick check, no decrypt) ─────────────────────────────
export const getCachedHasPfsConfig = tenantScopedCache(
  "has-pfs-config",
  async () => {
    // Extension scope auto par tenantId : findFirst renvoie null pour un autre
    // tenant même si la row existe globalement.
    const row = await prisma.siteConfig.findFirst({
      where: { key: "pfs_email" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-pfs-config"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── PFS enabled? ─────────────────────────────────────────────────────────
export const getCachedPfsEnabled = tenantScopedCache(
  "pfs-enabled",
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["pfs_email", "pfs_enabled", "pfs_brand_id", "pfs_brand_name"] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map(r => [r.key, r.value]));
    const hasEmail = map.has("pfs_email");
    const hasBrand = !!map.get("pfs_brand_id") && !!map.get("pfs_brand_name");
    const enabled = map.get("pfs_enabled");
    return hasEmail && hasBrand && enabled !== "false";
  },
  ["pfs-enabled"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── PFS live colors (référentiel officiel, 142 couleurs, cache 1h) ───────
function staticPfsColorFallback(): PfsLiveColor[] {
  return PFS_COLORS.map((name) => ({
    reference: name,
    value: hexForPfsColor(name) ?? "",
    image: null,
    label: name,
  }));
}

// Chaque tenant a son propre compte PFS → couleurs live différentes possibles.
export const getCachedPfsColors = tenantScopedCache<[], PfsLiveColor[]>(
  "pfs-live-colors",
  async () => {
    try {
      const colors = await pfsGetColors();
      if (!Array.isArray(colors) || colors.length === 0) {
        logger.warn("[PFS colors] empty response, using static fallback");
        return staticPfsColorFallback();
      }
      return colors.map((c) => {
        const frLabel = c.labels?.fr?.trim() || c.reference;
        return {
          reference: c.reference,
          value: c.value || "",
          image: c.image ?? null,
          label: frLabel,
        };
      });
    } catch (err) {
      logger.warn("[PFS colors] live fetch failed, using static fallback", {
        error: err,
      });
      return staticPfsColorFallback();
    }
  },
  ["pfs-live-colors"],
  { revalidate: 3600, tags: ["pfs-colors"] }
);

// ─── PFS brand (marque sélectionnée pour toutes les opérations PFS) ────────
// id = identifiant Salesforce PFS (utilisé pour filtrer la liste produits)
// name = libellé exact (utilisé comme brand_name à la création POST)
export const getCachedPfsBrand = tenantScopedCache<[], { id: string; name: string } | null>(
  "pfs-brand",
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["pfs_brand_id", "pfs_brand_name"] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const id = map.get("pfs_brand_id");
    const name = map.get("pfs_brand_name");
    if (!id || !name) return null;
    return { id, name };
  },
  ["pfs-brand"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── PFS live brands (liste des marques du compte, cache 10min) ────────────
// Utilisé pour alimenter le sélecteur de marque dans Paramètres > Marketplaces.
export const getCachedPfsBrands = tenantScopedCache(
  "pfs-live-brands",
  async () => {
    const { pfsListBrands } = await import("@/lib/pfs-api");
    try {
      return await pfsListBrands();
    } catch (err) {
      logger.warn("[PFS brands] live fetch failed", { error: err });
      return [];
    }
  },
  ["pfs-live-brands"],
  { revalidate: 600, tags: ["pfs-brands"] }
);

// ─── PFS credentials (from SiteConfig) ──────────────────────────────────────
async function readPfsCredentialsDirect() {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["pfs_email", "pfs_password"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  return {
    email: map.get("pfs_email") ?? null,
    password: map.get("pfs_password") ?? null,
  };
}

const _cachedPfsCredentials = tenantScopedCache(
  "pfs-credentials",
  readPfsCredentialsDirect,
  ["pfs-credentials"],
  { revalidate: 300, tags: ["site-config"] },
);

/**
 * Lit les identifiants PFS. Cache via unstable_cache (5 min) quand on est
 * dans un contexte Next.js (route, server action). Hors contexte (scripts
 * tsx standalone), unstable_cache lève "incrementalCache missing" — on
 * retombe sur la lecture directe Prisma sans cacher.
 */
export async function getCachedPfsCredentials() {
  try {
    return await _cachedPfsCredentials();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("incrementalCache") || msg.includes("unstable_cache")) {
      return await readPfsCredentialsDirect();
    }
    throw err;
  }
}

// ─── Ankorstore — credentials, enabled, has-config (mêmes patterns que PFS) ──
export const getCachedAnkorstoreCredentials = tenantScopedCache(
  "ankorstore-credentials",
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
    });
    const map = new Map(
      rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]),
    );
    return {
      clientId: map.get("ankors_client_id") ?? null,
      clientSecret: map.get("ankors_client_secret") ?? null,
    };
  },
  ["ankorstore-credentials"],
  { revalidate: 300, tags: ["site-config"] }
);

export const getCachedHasAnkorstoreConfig = tenantScopedCache(
  "has-ankorstore-config",
  async () => {
    const row = await prisma.siteConfig.findFirst({
      where: { key: "ankors_client_id" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-ankorstore-config"],
  { revalidate: 300, tags: ["site-config"] }
);

export const getCachedAnkorstoreEnabled = tenantScopedCache(
  "ankorstore-enabled",
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["ankors_client_id", "ankors_enabled"] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const hasId = map.has("ankors_client_id");
    const enabled = map.get("ankors_enabled");
    return hasId && enabled !== "false";
  },
  ["ankorstore-enabled"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── eFashion — credentials, enabled, has-config (même pattern que PFS/Ankorstore) ──
async function readEfashionCredentialsDirect() {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["efashion_email", "efashion_password"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  return {
    email: map.get("efashion_email") ?? null,
    password: map.get("efashion_password") ?? null,
  };
}

const _cachedEfashionCredentials = tenantScopedCache(
  "efashion-credentials",
  readEfashionCredentialsDirect,
  ["efashion-credentials"],
  { revalidate: 300, tags: ["site-config"] },
);

export async function getCachedEfashionCredentials() {
  try {
    return await _cachedEfashionCredentials();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("incrementalCache") || msg.includes("unstable_cache")) {
      return await readEfashionCredentialsDirect();
    }
    throw err;
  }
}

export const getCachedHasEfashionConfig = tenantScopedCache(
  "has-efashion-config",
  async () => {
    const row = await prisma.siteConfig.findFirst({
      where: { key: "efashion_email" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-efashion-config"],
  { revalidate: 300, tags: ["site-config"] }
);

export const getCachedEfashionEnabled = tenantScopedCache(
  "efashion-enabled",
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["efashion_email", "efashion_enabled"] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const hasConfig = map.has("efashion_email");
    const enabled = map.get("efashion_enabled");
    return hasConfig && enabled !== "false";
  },
  ["efashion-enabled"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── Faire — api key, enabled, has-config (même pattern que PFS/Ankorstore) ──
async function readFaireApiKeyDirect() {
  const row = await prisma.siteConfig.findFirst({
    where: { key: "faire_api_key" },
  });
  if (!row?.value) return null;
  return decryptIfSensitive("faire_api_key", row.value)?.trim() || null;
}

const _cachedFaireApiKey = tenantScopedCache(
  "faire-api-key",
  readFaireApiKeyDirect,
  ["faire-api-key"],
  { revalidate: 300, tags: ["site-config"] },
);

export async function getCachedFaireApiKey() {
  try {
    return await _cachedFaireApiKey();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("incrementalCache") || msg.includes("unstable_cache")) {
      return await readFaireApiKeyDirect();
    }
    throw err;
  }
}

export const getCachedHasFaireConfig = tenantScopedCache(
  "has-faire-config",
  async () => {
    const row = await prisma.siteConfig.findFirst({
      where: { key: "faire_api_key" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-faire-config"],
  { revalidate: 300, tags: ["site-config"] }
);

export const getCachedFaireEnabled = tenantScopedCache(
  "faire-enabled",
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["faire_api_key", "faire_enabled"] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const hasConfig = map.has("faire_api_key");
    const enabled = map.get("faire_enabled");
    return hasConfig && enabled !== "false";
  },
  ["faire-enabled"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── Product count (expensive count on 78k rows, cache 5min) ───────────────────
// Extension Prisma scope auto par tenantId, tenantScopedCache par tenant.
export const getCachedProductCount = tenantScopedCache(
  "product-count",
  async () => prisma.product.count({ where: { status: "ONLINE" } }),
  ["product-count"],
  { revalidate: 300, tags: ["products"] }
);

// ─── Bestseller refs (groupBy on orderItems, cache 10min) ──────────────────────
export const getCachedBestsellerRefs = tenantScopedCache<[number?], string[]>(
  "bestseller-refs",
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
const NON_FR_LOCALES = NON_DEFAULT_LOCALES;

export const getCachedAdminWarnings = tenantScopedCache(
  "admin-warnings",
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
export const getCachedDashboardStats = tenantScopedCache(
  "dashboard-stats",
  async () => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOf6MonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      totalClients,
      approvedCount,
      totalOrders,
      totalRevenueAgg,
      totalProducts,
      totalCollections,
      pendingOrders,
      revenueTodayAgg,
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
      prisma.order.count({ where: { status: "PENDING" } }),
      prisma.order.aggregate({
        _sum: { totalTTC: true },
        where: { createdAt: { gte: startOfDay }, status: { not: "CANCELLED" } },
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
      pendingOrders,
      revenueToday: Number(revenueTodayAgg._sum.totalTTC ?? 0),
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


export const getCachedLowStockCount = tenantScopedCache(
  "low-stock-count",
  async () => {
    const globalThreshold = await prisma.siteConfig.findFirst({
      where: { key: "default_low_stock_threshold" },
    });
    const threshold = globalThreshold ? parseInt(globalThreshold.value, 10) || 5 : 5;

    const count = await prisma.product.count({
      where: {
        status: { in: ["ONLINE", "OFFLINE"] },
        colors: {
          some: {
            stock: { lte: threshold },
          },
        },
      },
    });
    return count;
  },
  ["low-stock-count"],
  { revalidate: 300, tags: ["products"] }
);

export const getCachedActiveClaimsCount = tenantScopedCache(
  "active-claims-count",
  async () => prisma.claim.count({
    where: { status: { in: ["OPEN", "IN_REVIEW", "ACCEPTED", "RETURN_PENDING", "RETURN_SHIPPED", "RETURN_RECEIVED", "RESOLUTION_PENDING"] } },
  }),
  ["active-claims-count"],
  { revalidate: 300, tags: ["claims"] }
);

export const getCachedActivePromotions = tenantScopedCache(
  "active-promotions",
  async () => {
    const now = new Date();
    return prisma.promotion.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      select: { id: true, name: true, type: true, code: true, discountKind: true, discountValue: true, currentUses: true, maxUses: true },
    });
  },
  ["active-promotions"],
  { revalidate: 300, tags: ["promotions"] }
);

// ─── Admin unread message count (cached 60s — was uncached, hitting DB every navigation) ─
export const getCachedAdminUnreadCount = tenantScopedCache(
  "admin-unread-count",
  async () => {
    return prisma.message.count({
      where: {
        senderRole: "CLIENT",
        readAt: null,
        conversation: { type: "SUPPORT" },
      },
    });
  },
  ["admin-unread-count"],
  { revalidate: 60, tags: ["messages"] }
);
