import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";
import { pfsGetColors } from "@/lib/pfs-api-write";
import { PFS_COLORS } from "@/lib/marketplace-excel/pfs-taxonomy";
import { hexForPfsColor } from "@/lib/marketplace-excel/pfs-color-hex";
import { logger } from "@/lib/logger";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";
import { getCurrentTenantIdSync, tenantALS } from "@/lib/tenant-als";

/**
 * Résout le tenant courant sans dépendre du cache :
 * ALS d'abord, puis headers(). Utilisé par les fallbacks quand
 * `unstable_cache` throw (contexte hors Next.js — script CLI).
 * Ne jamais retourner "global" pour laisser la lecture Prisma décider
 * (les callers ont un `where` explicite qui accepte tid undefined).
 */
async function resolveTidForFallback(): Promise<string | undefined> {
  const fromALS = getCurrentTenantIdSync();
  if (fromALS) return fromALS;
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return h.get("x-tenant-id") ?? undefined;
  } catch {
    return undefined;
  }
}

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
 * Cache multi-tenant : passe le tid capturé en 1ᵉʳ argument du callback pour
 * qu'il puisse scoper EXPLICITEMENT ses queries Prisma. Nécessaire pour
 * les lectures tenant-scopées : à l'intérieur de unstable_cache, l'ALS
 * peut être vide et l'extension retombe alors en passthrough (fuite).
 *
 * Le callback reçoit `(tid, ...args)`. Si `tid === "global"`, l'appel est
 * hors contexte tenant (script CLI) — la query peut lire globalement.
 */
export function tenantScopedCacheWithTid<Args extends unknown[], T>(
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
        // CRITIQUE : rebinde l'ALS avec finalTid dans le callback.
        // `unstable_cache` exécute le callback dans un scope où l'ALS
        // parente est perdue → sans ce rebind, tout appel interne qui lit
        // le tenant via `getCurrentTenantIdSync()` retombe à "global" et
        // fuit d'un tenant à l'autre (incident BJ 15/07/2026 : cache
        // efashion-annexes de BJ rempli avec les packs d'Issyma parce que
        // `ensureEfashionSession` lisait `global` credentials).
        (...a: Args) => tenantALS.run(finalTid, () => fn(finalTid, ...a)),
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
// Multi-tenant : Category est une lib partagée mais on filtre les chips de filtres
// aux catégories effectivement utilisées par un produit du tenant courant
// (sinon la boutique A voit les catégories de la boutique B qui a des catégories
// propres — ex. FORCYMA affichait "Blouse/Jupes/Robes longues" sur BJ).
export const getCachedCategories = tenantScopedCacheWithTid(
  "filter-categories",
  async (tid) =>
    prisma.category.findMany({
      where: tid === "global" ? undefined : { products: { some: { tenantId: tid } } },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: {
        subCategories: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, slug: true },
        },
      },
    }),
  ["filter-categories"],
  { revalidate: 60, tags: ["categories"] }
);

// ─── Collections (id + name only, for filters) ────────────────────────────────
export const getCachedCollections = tenantScopedCacheWithTid(
  "filter-collections",
  async (tid) =>
    prisma.collection.findMany({
      where: tid === "global" ? undefined : { tenantId: tid },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ["filter-collections"],
  { revalidate: 60, tags: ["collections"] }
);

// ─── Couleurs ──────────────────────────────────────────────────────────────────
export const getCachedColors = tenantScopedCacheWithTid(
  "filter-colors",
  async (tid) =>
    prisma.color.findMany({
      where: tid === "global" ? undefined : { productColors: { some: { tenantId: tid } } },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, hex: true, patternImage: true },
    }),
  ["filter-colors"],
  { revalidate: 60, tags: ["colors"] }
);

// ─── Tags ──────────────────────────────────────────────────────────────────────
export const getCachedTags = tenantScopedCacheWithTid(
  "filter-tags",
  async (tid) =>
    prisma.tag.findMany({
      where: tid === "global" ? undefined : { products: { some: { product: { tenantId: tid } } } },
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
// La liste des pays est figée dans `lib/countries.ts` — plus de table BDD, plus
// de cache. Les appels historiques passent directement par `listCountries()` ou
// `listManufacturingCountries()`.

// ─── Tailles ────────────────────────────────────────────────────────────────
// Multi-tenant : Size porte un tenantId depuis 2026-07-12. Le cache doit donc
// être scopé pour éviter que la boutique A voie les tailles de la boutique B.
export const getCachedSizes = tenantScopedCacheWithTid(
  "filter-sizes",
  async (tid) =>
    prisma.size.findMany({
      where: tid === "global" ? undefined : { tenantId: tid },
      orderBy: { position: "asc" },
      select: { id: true, name: true },
    }),
  ["filter-sizes"],
  { revalidate: 60, tags: ["sizes"] }
);

// ─── Saisons ────────────────────────────────────────────────────────────────
// Multi-tenant : Season porte un tenantId depuis 2026-07-12.
export const getCachedSeasons = tenantScopedCacheWithTid(
  "filter-seasons",
  async (tid) =>
    prisma.season.findMany({
      where: tid === "global" ? undefined : { tenantId: tid },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ["filter-seasons"],
  { revalidate: 60, tags: ["seasons"] }
);

// ─── Compositions ───────────────────────────────────────────────────────────
// Multi-tenant : Composition porte un tenantId depuis 2026-07-12. Sans ce
// scope, la modale « Modifier attribut » (bulk edit) affichait toutes les
// compositions de tous les tenants (ex. Issyma voyait celles de Beli & Jolie).
export const getCachedCompositions = tenantScopedCacheWithTid(
  "filter-compositions",
  async (tid) =>
    prisma.composition.findMany({
      where: tid === "global" ? undefined : { tenantId: tid },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ["filter-compositions"],
  { revalidate: 60 * 60, tags: ["compositions"] }
);

// ─── SiteConfig (clé unique — used heavily, short TTL) ─────────────────────────
// Each key gets its own cache entry, scoped par tenant courant.
const _siteConfigCache = tenantScopedCacheWithTid(
  "site-config",
  async (tid, key: string) => {
    return tid === "global"
      ? prisma.siteConfig.findFirst({ where: { key } })
      : prisma.siteConfig.findFirst({ where: { key, tenantId: tid } });
  },
  ["site-config"],
  { revalidate: 300, tags: ["site-config"] }
);
export function getCachedSiteConfig(key: string) {
  return _siteConfigCache(key);
}

// ─── Business hours (cached 5min) ─────────────────────────────────────────────
const _businessHoursCache = tenantScopedCacheWithTid(
  "business-hours",
  async (tid) => {
    const row = tid === "global"
      ? await prisma.siteConfig.findFirst({ where: { key: "business_hours" } })
      : await prisma.siteConfig.findFirst({ where: { key: "business_hours", tenantId: tid } });
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

export const getCachedFavicon = tenantScopedCacheWithTid<[], CustomFavicon | null>(
  "site-favicon",
  async (tid) => {
    const row = tid === "global"
      ? await prisma.siteConfig.findFirst({ where: { key: "site_favicon" }, select: { value: true } })
      : await prisma.siteConfig.findFirst({ where: { key: "site_favicon", tenantId: tid }, select: { value: true } });
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
export const getCachedEasyExpressApiKey = tenantScopedCacheWithTid(
  "easy-express-api-key",
  async (tid) => {
    const row = tid === "global"
      ? await prisma.siteConfig.findFirst({ where: { key: "easy_express_api_key" } })
      : await prisma.siteConfig.findFirst({ where: { key: "easy_express_api_key", tenantId: tid } });
    return row?.value ? decryptIfSensitive("easy_express_api_key", row.value) : null;
  },
  ["easy-express-api-key"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── Shipping margin (from SiteConfig) ───────────────────────────────────────

export const getCachedShippingMargin = tenantScopedCacheWithTid(
  "shipping-margin",
  async (tid) => {
    const [typeRow, valueRow] = tid === "global"
      ? await Promise.all([
          prisma.siteConfig.findFirst({ where: { key: "shipping_margin_type" } }),
          prisma.siteConfig.findFirst({ where: { key: "shipping_margin_value" } }),
        ])
      : await Promise.all([
          prisma.siteConfig.findFirst({ where: { key: "shipping_margin_type", tenantId: tid } }),
          prisma.siteConfig.findFirst({ where: { key: "shipping_margin_value", tenantId: tid } }),
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
export const getCachedHasPfsConfig = tenantScopedCacheWithTid(
  "has-pfs-config",
  async (tid) => {
    const row = await prisma.siteConfig.findFirst({
      where: tid === "global" ? { key: "pfs_email" } : { tenantId: tid, key: "pfs_email" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-pfs-config"],
  { revalidate: 300, tags: ["site-config"] }
);

// ─── PFS enabled? ─────────────────────────────────────────────────────────
export const getCachedPfsEnabled = tenantScopedCacheWithTid(
  "pfs-enabled",
  async (tid) => {
    const rows = await prisma.siteConfig.findMany({
      where: tid === "global"
        ? { key: { in: ["pfs_email", "pfs_enabled", "pfs_brand_id", "pfs_brand_name"] } }
        : { tenantId: tid, key: { in: ["pfs_email", "pfs_enabled", "pfs_brand_id", "pfs_brand_name"] } },
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
// tenantALS.run(tid, …) : rebinder l'ALS dans le callback unstable_cache pour
// que pfs-auth (Map<tid, TokenCache>) trouve le bon compte PFS.
export const getCachedPfsColors = tenantScopedCacheWithTid<[], PfsLiveColor[]>(
  "pfs-live-colors",
  async (tid) => {
    const run = async () => {
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
    };
    return tid === "global" ? run() : tenantALS.run(tid, run);
  },
  ["pfs-live-colors"],
  { revalidate: 3600, tags: ["pfs-colors"] }
);

// ─── PFS brand (marque sélectionnée pour toutes les opérations PFS) ────────
// id = identifiant Salesforce PFS (utilisé pour filtrer la liste produits)
// name = libellé exact (utilisé comme brand_name à la création POST)
export const getCachedPfsBrand = tenantScopedCacheWithTid<[], { id: string; name: string } | null>(
  "pfs-brand",
  async (tid) => {
    const rows = await prisma.siteConfig.findMany({
      where: tid === "global"
        ? { key: { in: ["pfs_brand_id", "pfs_brand_name"] } }
        : { tenantId: tid, key: { in: ["pfs_brand_id", "pfs_brand_name"] } },
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
export const getCachedPfsBrands = tenantScopedCacheWithTid(
  "pfs-live-brands",
  async (tid) => {
    const { pfsListBrands } = await import("@/lib/pfs-api");
    const run = async () => {
      try {
        return await pfsListBrands();
      } catch (err) {
        logger.warn("[PFS brands] live fetch failed", { error: err });
        return [];
      }
    };
    return tid === "global" ? run() : tenantALS.run(tid, run);
  },
  ["pfs-live-brands"],
  { revalidate: 600, tags: ["pfs-brands"] }
);

// ─── PFS credentials (from SiteConfig) ──────────────────────────────────────
async function readPfsCredentialsDirect(tid?: string) {
  const rows = await prisma.siteConfig.findMany({
    where: !tid || tid === "global"
      ? { key: { in: ["pfs_email", "pfs_password"] } }
      : { tenantId: tid, key: { in: ["pfs_email", "pfs_password"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  return {
    email: map.get("pfs_email") ?? null,
    password: map.get("pfs_password") ?? null,
  };
}

const _cachedPfsCredentials = tenantScopedCacheWithTid(
  "pfs-credentials",
  async (tid) => readPfsCredentialsDirect(tid),
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
      // Fallback hors Next.js runtime : réutilise le tid courant sinon
      // la lecture retombe unscopée et renvoie les creds d'un autre tenant.
      return await readPfsCredentialsDirect(await resolveTidForFallback());
    }
    throw err;
  }
}

// ─── Ankorstore — credentials, enabled, has-config (mêmes patterns que PFS) ──
async function readAnkorstoreCredentialsDirect(tid?: string) {
  const rows = await prisma.siteConfig.findMany({
    where: !tid || tid === "global"
      ? { key: { in: ["ankors_client_id", "ankors_client_secret"] } }
      : { tenantId: tid, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(
    rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]),
  );
  return {
    clientId: map.get("ankors_client_id") ?? null,
    clientSecret: map.get("ankors_client_secret") ?? null,
  };
}

const _cachedAnkorstoreCredentials = tenantScopedCacheWithTid(
  "ankorstore-credentials",
  async (tid) => readAnkorstoreCredentialsDirect(tid),
  ["ankorstore-credentials"],
  { revalidate: 300, tags: ["site-config"] }
);

/**
 * Lit les identifiants Ankorstore. Cache via unstable_cache (5 min) quand on
 * est dans un contexte Next.js (route, server action). Hors contexte (scripts
 * tsx standalone, background fire-and-forget hors request scope), unstable_cache
 * lève "incrementalCache missing" — on retombe sur la lecture directe Prisma.
 */
export async function getCachedAnkorstoreCredentials() {
  try {
    return await _cachedAnkorstoreCredentials();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("incrementalCache") || msg.includes("unstable_cache")) {
      return await readAnkorstoreCredentialsDirect(await resolveTidForFallback());
    }
    throw err;
  }
}

export const getCachedHasAnkorstoreConfig = tenantScopedCacheWithTid(
  "has-ankorstore-config",
  async (tid) => {
    const row = await prisma.siteConfig.findFirst({
      where: tid === "global" ? { key: "ankors_client_id" } : { tenantId: tid, key: "ankors_client_id" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-ankorstore-config"],
  { revalidate: 300, tags: ["site-config"] }
);

export const getCachedAnkorstoreEnabled = tenantScopedCacheWithTid(
  "ankorstore-enabled",
  async (tid) => {
    const rows = await prisma.siteConfig.findMany({
      where: tid === "global"
        ? { key: { in: ["ankors_client_id", "ankors_enabled"] } }
        : { tenantId: tid, key: { in: ["ankors_client_id", "ankors_enabled"] } },
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
async function readEfashionCredentialsDirect(tid?: string) {
  const rows = await prisma.siteConfig.findMany({
    where: !tid || tid === "global"
      ? { key: { in: ["efashion_email", "efashion_password"] } }
      : { tenantId: tid, key: { in: ["efashion_email", "efashion_password"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  return {
    email: map.get("efashion_email") ?? null,
    password: map.get("efashion_password") ?? null,
  };
}

const _cachedEfashionCredentials = tenantScopedCacheWithTid(
  "efashion-credentials",
  async (tid) => readEfashionCredentialsDirect(tid),
  ["efashion-credentials"],
  { revalidate: 300, tags: ["site-config"] },
);

export async function getCachedEfashionCredentials() {
  try {
    return await _cachedEfashionCredentials();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("incrementalCache") || msg.includes("unstable_cache")) {
      // Fallback hors Next.js runtime : réutilise le tid courant sinon
      // la lecture retombe unscopée et renvoie les creds d'un autre tenant.
      return await readEfashionCredentialsDirect(await resolveTidForFallback());
    }
    throw err;
  }
}

export const getCachedHasEfashionConfig = tenantScopedCacheWithTid(
  "has-efashion-config",
  async (tid) => {
    const row = await prisma.siteConfig.findFirst({
      where: tid === "global" ? { key: "efashion_email" } : { tenantId: tid, key: "efashion_email" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-efashion-config"],
  { revalidate: 300, tags: ["site-config"] }
);

export const getCachedEfashionEnabled = tenantScopedCacheWithTid(
  "efashion-enabled",
  async (tid) => {
    const rows = await prisma.siteConfig.findMany({
      where: tid === "global"
        ? { key: { in: ["efashion_email", "efashion_enabled"] } }
        : { tenantId: tid, key: { in: ["efashion_email", "efashion_enabled"] } },
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
async function readFaireApiKeyDirect(tid?: string) {
  const row = await prisma.siteConfig.findFirst({
    where: !tid || tid === "global" ? { key: "faire_api_key" } : { tenantId: tid, key: "faire_api_key" },
  });
  if (!row?.value) return null;
  return decryptIfSensitive("faire_api_key", row.value)?.trim() || null;
}

const _cachedFaireApiKey = tenantScopedCacheWithTid(
  "faire-api-key",
  async (tid) => readFaireApiKeyDirect(tid),
  ["faire-api-key"],
  { revalidate: 300, tags: ["site-config"] },
);

export async function getCachedFaireApiKey() {
  try {
    return await _cachedFaireApiKey();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("incrementalCache") || msg.includes("unstable_cache")) {
      // Fallback hors Next.js runtime : réutilise le tid courant sinon
      // la lecture retombe unscopée et renvoie la clé d'un autre tenant.
      return await readFaireApiKeyDirect(await resolveTidForFallback());
    }
    throw err;
  }
}

export const getCachedHasFaireConfig = tenantScopedCacheWithTid(
  "has-faire-config",
  async (tid) => {
    const row = await prisma.siteConfig.findFirst({
      where: tid === "global" ? { key: "faire_api_key" } : { tenantId: tid, key: "faire_api_key" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-faire-config"],
  { revalidate: 300, tags: ["site-config"] }
);

export const getCachedFaireEnabled = tenantScopedCacheWithTid(
  "faire-enabled",
  async (tid) => {
    const rows = await prisma.siteConfig.findMany({
      where: tid === "global"
        ? { key: { in: ["faire_api_key", "faire_enabled"] } }
        : { tenantId: tid, key: { in: ["faire_api_key", "faire_enabled"] } },
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

// ─── Microstore — session key, has-config (auth QR-code, expire ~1 an) ────────
async function readMicrostoreSessionKeyDirect(tid?: string) {
  const row = await prisma.siteConfig.findFirst({
    where:
      !tid || tid === "global"
        ? { key: "microstore_session_key" }
        : { tenantId: tid, key: "microstore_session_key" },
  });
  if (!row?.value) return null;
  return decryptIfSensitive("microstore_session_key", row.value)?.trim() || null;
}

const _cachedMicrostoreSessionKey = tenantScopedCacheWithTid(
  "microstore-session-key",
  async (tid) => readMicrostoreSessionKeyDirect(tid),
  ["microstore-session-key"],
  { revalidate: 300, tags: ["site-config"] },
);

export async function getCachedMicrostoreSessionKey() {
  try {
    return await _cachedMicrostoreSessionKey();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("incrementalCache") || msg.includes("unstable_cache")) {
      return await readMicrostoreSessionKeyDirect(await resolveTidForFallback());
    }
    throw err;
  }
}

export const getCachedHasMicrostoreConfig = tenantScopedCacheWithTid(
  "has-microstore-config",
  async (tid) => {
    const row = await prisma.siteConfig.findFirst({
      where:
        tid === "global"
          ? { key: "microstore_session_key" }
          : { tenantId: tid, key: "microstore_session_key" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-microstore-config"],
  { revalidate: 300, tags: ["site-config"] },
);

// ─── Product count (expensive count on 78k rows, cache 5min) ───────────────────
// Scope explicite : dans unstable_cache l'ALS est vide, l'extension Prisma
// retombe en passthrough (fuite cross-tenant).
export const getCachedProductCount = tenantScopedCacheWithTid(
  "product-count",
  async (tid) => prisma.product.count({
    where: tid === "global" ? { status: "ONLINE" } : { status: "ONLINE", tenantId: tid },
  }),
  ["product-count"],
  { revalidate: 300, tags: ["products"] }
);

// ─── Bestseller refs (groupBy on orderItems, cache 10min) ──────────────────────
export const getCachedBestsellerRefs = tenantScopedCacheWithTid<[number?], string[]>(
  "bestseller-refs",
  async (tid, limit = 30) => {
    const stats = await prisma.orderItem.groupBy({
      by: ["productRef"],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
      where: tid === "global" ? undefined : { tenantId: tid },
    });
    return stats.map((s) => s.productRef);
  },
  ["bestseller-refs"],
  { revalidate: 600, tags: ["orders"] }
);

// ─── Admin layout warning counts (7 queries, cache 5min) ────────────────────
const NON_FR_LOCALES = NON_DEFAULT_LOCALES;

export const getCachedAdminWarnings = tenantScopedCacheWithTid(
  "admin-warnings",
  async (tid) => {
    const scoped = tid === "global" ? {} : { tenantId: tid };
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
      prisma.product.count({ where: scoped }),
      prisma.product.count({
        where: {
          ...scoped,
          AND: NON_FR_LOCALES.map((locale) => ({ translations: { some: { locale } } })),
        },
      }),
      prisma.color.count({ where: { ...scoped, translations: { none: {} } } }),
      prisma.composition.count({ where: { ...scoped, translations: { none: {} } } }),
      prisma.tag.count({ where: { ...scoped, translations: { none: {} } } }),
      prisma.category.count({ where: { ...scoped, translations: { none: {} } } }),
      prisma.subCategory.count({ where: { ...scoped, translations: { none: {} } } }),
      prisma.order.count({ where: { ...scoped, status: "PENDING" } }),
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

// ─── Attributs sans mapping marketplace (cache 5min, invalidé sur mut. mappings) ──
export const getCachedUnmappedAttributes = tenantScopedCacheWithTid(
  "unmapped-attributes",
  async (tid) => {
    const { computeUnmappedAttributes, loadMarketplaceFlags } = await import("@/lib/unmapped-attributes");
    const flags = await loadMarketplaceFlags();
    return computeUnmappedAttributes(tid, flags);
  },
  ["unmapped-attributes"],
  { revalidate: 300, tags: ["categories", "colors", "compositions", "seasons", "sizes", "hs-codes", "site-config"] }
);

// ─── Dashboard aggregate stats (expensive, cache 5min) ──────────────────────
export const getCachedDashboardStats = tenantScopedCacheWithTid(
  "dashboard-stats",
  async (tid) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOf6MonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const scoped = tid === "global" ? {} : { tenantId: tid };

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
      prisma.user.count({ where: { ...scoped, role: "CLIENT" } }),
      prisma.user.count({ where: { ...scoped, status: "APPROVED", role: "CLIENT" } }),
      prisma.order.count({ where: scoped }),
      prisma.order.aggregate({
        _sum: { totalTTC: true },
        where: { ...scoped, status: { not: "CANCELLED" } },
      }),
      prisma.product.count({ where: scoped }),
      prisma.collection.count({ where: scoped }),
      prisma.order.count({ where: { ...scoped, status: "PENDING" } }),
      prisma.order.aggregate({
        _sum: { totalTTC: true },
        where: { ...scoped, createdAt: { gte: startOfDay }, status: { not: "CANCELLED" } },
      }),
      prisma.order.findMany({
        where: { ...scoped, createdAt: { gte: startOf6MonthsAgo }, status: { not: "CANCELLED" } },
        select: { createdAt: true, totalTTC: true },
        take: 1000,
      }),
      prisma.order.groupBy({ by: ["status"], _count: true, where: scoped }),
      prisma.orderItem.groupBy({
        by: ["productName"],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
        where: scoped,
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


export const getCachedLowStockCount = tenantScopedCacheWithTid(
  "low-stock-count",
  async (tid) => {
    const globalThreshold = tid === "global"
      ? await prisma.siteConfig.findFirst({ where: { key: "default_low_stock_threshold" } })
      : await prisma.siteConfig.findFirst({ where: { key: "default_low_stock_threshold", tenantId: tid } });
    const threshold = globalThreshold ? parseInt(globalThreshold.value, 10) || 5 : 5;

    const count = await prisma.product.count({
      where: {
        ...(tid === "global" ? {} : { tenantId: tid }),
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

export const getCachedActiveClaimsCount = tenantScopedCacheWithTid(
  "active-claims-count",
  async (tid) => prisma.claim.count({
    where: {
      ...(tid === "global" ? {} : { tenantId: tid }),
      status: { in: ["OPEN", "IN_REVIEW", "ACCEPTED", "RETURN_PENDING", "RETURN_SHIPPED", "RETURN_RECEIVED", "RESOLUTION_PENDING"] },
    },
  }),
  ["active-claims-count"],
  { revalidate: 300, tags: ["claims"] }
);

export const getCachedActivePromotions = tenantScopedCacheWithTid(
  "active-promotions",
  async (tid) => {
    const now = new Date();
    return prisma.promotion.findMany({
      where: {
        ...(tid === "global" ? {} : { tenantId: tid }),
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
export const getCachedAdminUnreadCount = tenantScopedCacheWithTid(
  "admin-unread-count",
  async (tid) => {
    return prisma.message.count({
      where: {
        ...(tid === "global" ? {} : { tenantId: tid }),
        senderRole: "CLIENT",
        readAt: null,
        conversation: { type: "SUPPORT" },
      },
    });
  },
  ["admin-unread-count"],
  { revalidate: 60, tags: ["messages"] }
);
