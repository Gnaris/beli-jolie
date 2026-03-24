/**
 * PFS Sync Processor
 *
 * Synchronizes products from Paris Fashion Shop → Beli Jolie.
 * Strategy:
 *   1. Paginate listProducts (100/page)
 *   2. For each product, call /variants for correct weight/packQuantity
 *   3. Call checkReference for composition/description
 *   4. Download images → WebP conversion via processProductImage()
 *   5. Create or update product in BJ database
 *
 * Reference versioning:
 *   PFS references end with "VS1", "VS2", etc. (e.g. "A200VS3").
 *   The real BJ reference is the base without the VS suffix (e.g. "A200").
 *   For images: try to fetch from the base reference first (original quality),
 *   then fall back to the versioned reference.
 *
 * Supports resume via lastPage in PfsSyncJob.
 * Supports limit for test mode (e.g. 10 products).
 */

import { prisma } from "@/lib/prisma";
import {
  pfsListProducts,
  pfsCheckReference,
  pfsGetVariants,
  type PfsProduct,
  type PfsVariantDetail,
  type PfsCheckReferenceResponse,
} from "@/lib/pfs-api";
import { processProductImage } from "@/lib/image-processor";
import { normalizeColorName } from "@/lib/import-processor";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Reference passthrough — no version stripping.
 * Kept as a function for backward compatibility with all call sites.
 */
export function stripVersionSuffix(ref: string): string {
  return ref;
}

/**
 * Always returns null — version suffixes are no longer used.
 */
function getVersionSuffix(_ref: string): string | null {
  return null;
}


/** Remove ?image_process=... from PFS CDN URLs to get full-size image. */
export function fullSizeImageUrl(url: string): string {
  return url.replace(/\?image_process=.*$/, "");
}

/** Extract color images from PFS images object (skip DEFAULT key). */
export function extractColorImages(
  images: Record<string, string | string[]>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [colorRef, urls] of Object.entries(images)) {
    if (colorRef === "DEFAULT") continue;
    const arr = Array.isArray(urls) ? urls : [urls];
    map.set(colorRef, arr.map(fullSizeImageUrl));
  }
  return map;
}

/**
 * Detect the primary/default color reference from the images object.
 * Strategy:
 *   1. Use `default_color` from checkReference if available
 *   2. Compare DEFAULT image URLs with color-specific image URLs to find the match
 *   3. Fall back to null (first variant becomes primary)
 */
export function detectDefaultColorRef(
  images: Record<string, string | string[]>,
  defaultColorFromApi?: string | null,
): string | null {
  // 1. Direct API field
  if (defaultColorFromApi) return defaultColorFromApi;

  // 2. Match DEFAULT images to a color key
  const defaultUrls = images["DEFAULT"];
  if (!defaultUrls) return null;

  const defaultArr = Array.isArray(defaultUrls) ? defaultUrls : [defaultUrls];
  if (defaultArr.length === 0) return null;

  // Normalize first DEFAULT URL for comparison
  const defaultFirst = fullSizeImageUrl(defaultArr[0]);

  for (const [colorRef, urls] of Object.entries(images)) {
    if (colorRef === "DEFAULT") continue;
    const colorArr = Array.isArray(urls) ? urls : [urls];
    if (colorArr.length > 0 && fullSizeImageUrl(colorArr[0]) === defaultFirst) {
      return colorRef;
    }
  }

  return null;
}

// ─────────────────────────────────────────────
// Playwright pool (up to MAX_PW_CONTEXTS, lazy, diverse fingerprints)
// ─────────────────────────────────────────────

const MAX_PW_CONTEXTS = 5;

// Diverse browser fingerprints to avoid detection
const PW_FINGERPRINTS = [
  { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", viewport: { width: 1920, height: 1080 }, locale: "fr-FR" },
  { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", viewport: { width: 1440, height: 900 }, locale: "en-US" },
  { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", viewport: { width: 1366, height: 768 }, locale: "de-DE" },
  { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0", viewport: { width: 1680, height: 1050 }, locale: "es-ES" },
  { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", viewport: { width: 2560, height: 1440 }, locale: "it-IT" },
];

let pwBrowser: import("playwright").Browser | null = null;
const pwContexts: import("playwright").BrowserContext[] = [];
let pwContextIdx = 0; // round-robin

async function ensurePwBrowser(): Promise<import("playwright").Browser> {
  if (!pwBrowser) {
    const { chromium } = await import("playwright");
    pwBrowser = await chromium.launch({ headless: true });
  }
  return pwBrowser;
}

/** Get a Playwright page from the pool, creating a new context if under limit. Round-robin. */
async function getPlaywrightPage(): Promise<{ page: import("playwright").Page; ctxIdx: number }> {
  const browser = await ensurePwBrowser();

  // Create a new context if pool not full
  if (pwContexts.length < MAX_PW_CONTEXTS) {
    const fp = PW_FINGERPRINTS[pwContexts.length % PW_FINGERPRINTS.length];
    const ctx = await browser.newContext({
      userAgent: fp.userAgent,
      viewport: fp.viewport,
      locale: fp.locale,
      timezoneId: ["Europe/Paris", "America/New_York", "Europe/Berlin", "Europe/Madrid", "Europe/Rome"][pwContexts.length % 5],
    });
    pwContexts.push(ctx);
  }

  // Round-robin across contexts
  const idx = pwContextIdx % pwContexts.length;
  pwContextIdx++;
  const page = await pwContexts[idx].newPage();
  return { page, ctxIdx: idx };
}

export async function closePlaywright(): Promise<void> {
  for (const ctx of pwContexts) {
    await ctx.close().catch(() => {});
  }
  pwContexts.length = 0;
  pwContextIdx = 0;
  if (pwBrowser) {
    await pwBrowser.close().catch(() => {});
    pwBrowser = null;
  }
}

/** Download image via Playwright (fallback for stubborn CDNs). */
async function downloadImagePlaywright(url: string): Promise<Buffer> {
  const { page } = await getPlaywrightPage();
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 20000 });
    if (!response || !response.ok()) {
      throw new Error(`Playwright HTTP ${response?.status()}`);
    }
    const buffer = await response.body();
    if (buffer.length < 1024) {
      throw new Error(`Playwright image too small (${buffer.length} bytes)`);
    }
    return buffer;
  } finally {
    await page.close();
  }
}

// Rotating User-Agents for fetch-based downloads
const FETCH_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
];
let fetchUaIdx = 0;

/** Download an image from URL with fetch, fallback to Playwright. */
export async function downloadImage(url: string, maxRetries = 3): Promise<Buffer> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const ua = FETCH_USER_AGENTS[fetchUaIdx++ % FETCH_USER_AGENTS.length];

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": ua,
          Accept: "image/*,*/*;q=0.8",
          Referer: "https://www.parisfashionshops.com/",
        },
      });

      clearTimeout(timeout);

      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (buffer.length < 1024) {
          throw new Error(`Image too small (${buffer.length} bytes): ${url}`);
        }
        return buffer;
      }

      if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const delay = Math.min(3000 * Math.pow(2, attempt), 30000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = Math.min(3000 * Math.pow(2, attempt), 30000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }

  // All fetch attempts failed — try Playwright as last resort
  try {
    return await downloadImagePlaywright(url);
  } catch {
    // Playwright also failed
  }

  throw lastError || new Error(`Failed after ${maxRetries} retries + Playwright`);
}

/** Map PFS category reference to BJ category name. */
export function parsePfsCategoryRef(ref: string): string {
  const parts = ref.split("/");
  const last = parts[parts.length - 1];

  const categoryMap: Record<string, string> = {
    // Bijoux
    EARRINGS: "Boucles d'oreilles",
    RINGS: "Bagues",
    NECKLACES: "Colliers",
    BRACELETS: "Bracelets",
    PENDANTS: "Pendentifs",
    PIERCINGS: "Piercings",
    SETS: "Parures de bijoux",
    KEYRINGS: "Porte-clés",
    DISPLAYSETS: "Lots avec présentoir",
    ANKLETS: "Bracelets de cheville",
    BROOCHES: "Broches",
    HAIRACCESSORIES: "Accessoires cheveux",
    // Vêtements & Accessoires
    CLOTHING: "Vêtements",
    TSHIRTS: "T-shirts",
    SHIRTS: "Chemises",
    DRESSES: "Robes",
    SKIRTS: "Jupes",
    PANTS: "Pantalons",
    JACKETS: "Vestes",
    COATS: "Manteaux",
    SWEATERS: "Pulls",
    TOPS: "Tops",
    SHORTS: "Shorts",
    JEANS: "Jeans",
    SUITS: "Costumes",
    BLAZERS: "Blazers",
    GLOVES: "Gants",
    SCARVES: "Écharpes",
    HATS: "Chapeaux",
    BAGS: "Sacs",
    WALLETS: "Portefeuilles",
    BELTS: "Ceintures",
    SUNGLASSES: "Lunettes de soleil",
    WATCHES: "Montres",
    ACCESSORIES: "Accessoires",
    SHOES: "Chaussures",
    BOOTS: "Bottes",
    SANDALS: "Sandales",
    SNEAKERS: "Baskets",
    LINGERIE: "Lingerie",
    SWIMWEAR: "Maillots de bain",
  };

  return categoryMap[last] ?? last;
}

// ─────────────────────────────────────────────
// Color resolution — find or create Color in BJ
// ─────────────────────────────────────────────

export const colorCache = new Map<string, string>(); // normalized name → Color.id

export async function findOrCreateColor(
  reference: string,
  hex: string,
  labels: Record<string, string>,
): Promise<string | null> {
  const frLabel = labels.fr || reference;
  const normalized = normalizeColorName(frLabel);

  if (colorCache.has(normalized)) return colorCache.get(normalized)!;

  // Check PfsMapping first (admin-validated mappings)
  const mapping = await prisma.pfsMapping.findUnique({
    where: { type_pfsName: { type: "color", pfsName: frLabel.toLowerCase() } },
  });
  if (mapping) {
    // Verify the mapped entity still exists
    const mapped = await prisma.color.findUnique({ where: { id: mapping.bjEntityId }, select: { id: true } });
    if (mapped) {
      colorCache.set(normalized, mapping.bjEntityId);
      return mapping.bjEntityId;
    }
    // Mapping is orphaned — delete it and continue
    await prisma.pfsMapping.delete({ where: { id: mapping.id } }).catch(() => {});
  }

  // MySQL is case-insensitive by default
  const existing = await prisma.color.findFirst({
    where: { name: frLabel },
    select: { id: true, pfsColorRef: true },
  });

  if (existing) {
    // Set pfsColorRef if missing
    if (!existing.pfsColorRef && reference) {
      await prisma.color.update({ where: { id: existing.id }, data: { pfsColorRef: reference } }).catch(() => {});
    }
    // Ensure PfsMapping exists
    await prisma.pfsMapping.upsert({
      where: { type_pfsName: { type: "color", pfsName: frLabel.toLowerCase() } },
      create: { type: "color", pfsName: frLabel.toLowerCase(), bjEntityId: existing.id, bjName: frLabel },
      update: { bjEntityId: existing.id, bjName: frLabel },
    }).catch(() => {});
    colorCache.set(normalized, existing.id);
    await upsertColorTranslations(existing.id, labels);
    return existing.id;
  }

  return null; // Couleur non liée — l'admin doit la lier via l'interface PFS
}

async function upsertColorTranslations(
  colorId: string,
  labels: Record<string, string>,
): Promise<void> {
  for (const [locale, name] of Object.entries(labels)) {
    if (locale === "fr" || !name) continue;
    try {
      await prisma.colorTranslation.upsert({
        where: { colorId_locale: { colorId, locale } },
        update: { name },
        create: { colorId, locale, name },
      });
    } catch {
      // Race condition: concurrent sync already created this — safe to ignore
    }
  }
}

// ─────────────────────────────────────────────
// Category resolution
// ─────────────────────────────────────────────

export const categoryCache = new Map<string, string>(); // name → Category.id

export async function findOrCreateCategory(
  name: string,
  labels?: Record<string, string>,
  pfsOriginalName?: string,
  pfsCatId?: string,
): Promise<string | null> {
  if (categoryCache.has(name)) return categoryCache.get(name)!;

  // Check PfsMapping first (admin-validated mappings) — try both parsed name and original PFS name
  const namesToTry = [name.toLowerCase()];
  if (pfsOriginalName && pfsOriginalName.toLowerCase() !== name.toLowerCase()) {
    namesToTry.push(pfsOriginalName.toLowerCase());
  }
  for (const pfsKey of namesToTry) {
    const mapping = await prisma.pfsMapping.findUnique({
      where: { type_pfsName: { type: "category", pfsName: pfsKey } },
    });
    if (mapping) {
      const mapped = await prisma.category.findUnique({ where: { id: mapping.bjEntityId }, select: { id: true } });
      if (mapped) {
        categoryCache.set(name, mapping.bjEntityId);
        return mapping.bjEntityId;
      }
      await prisma.pfsMapping.delete({ where: { id: mapping.id } }).catch(() => {});
    }
  }

  const slug = slugify(name);
  // Use the pfsOriginalName (FR label) as the PfsMapping key
  const pfsKey = (pfsOriginalName || name).toLowerCase();

  // Use findFirst by name or slug to avoid duplicates
  const existing = await prisma.category.findFirst({
    where: { OR: [{ name }, { slug }] },
    select: { id: true, pfsCategoryId: true },
  });

  if (existing) {
    // Set pfsCategoryId if missing
    if (!existing.pfsCategoryId && pfsCatId) {
      await prisma.category.update({ where: { id: existing.id }, data: { pfsCategoryId: pfsCatId } }).catch(() => {});
    }
    // Ensure PfsMapping exists
    await prisma.pfsMapping.upsert({
      where: { type_pfsName: { type: "category", pfsName: pfsKey } },
      create: { type: "category", pfsName: pfsKey, bjEntityId: existing.id, bjName: name },
      update: { bjEntityId: existing.id, bjName: name },
    }).catch(() => {});
    categoryCache.set(name, existing.id);
    if (labels) await upsertCategoryTranslations(existing.id, labels);
    return existing.id;
  }

  return null; // Catégorie non liée — l'admin doit la lier via l'interface PFS
}

async function upsertCategoryTranslations(
  categoryId: string,
  labels: Record<string, string>,
): Promise<void> {
  for (const [locale, name] of Object.entries(labels)) {
    if (locale === "fr" || !name) continue;
    try {
      await prisma.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId, locale } },
        update: { name },
        create: { categoryId, locale, name },
      });
    } catch {
      // Race condition: concurrent sync already created this — safe to ignore
    }
  }
}

// ─────────────────────────────────────────────
// Composition resolution
// ─────────────────────────────────────────────

export const compositionCache = new Map<string, string>(); // normalized name → Composition.id

export async function findOrCreateComposition(
  frName: string,
  labels: Record<string, string>,
  pfsReference?: string,
): Promise<string | null> {
  const normalized = normalizeColorName(frName);
  if (compositionCache.has(normalized)) return compositionCache.get(normalized)!;

  // Check PfsMapping first (admin-validated mappings)
  const mapping = await prisma.pfsMapping.findUnique({
    where: { type_pfsName: { type: "composition", pfsName: frName.toLowerCase() } },
  });
  if (mapping) {
    const mapped = await prisma.composition.findUnique({ where: { id: mapping.bjEntityId }, select: { id: true } });
    if (mapped) {
      compositionCache.set(normalized, mapping.bjEntityId);
      return mapping.bjEntityId;
    }
    await prisma.pfsMapping.delete({ where: { id: mapping.id } }).catch(() => {});
  }

  const existing = await prisma.composition.findFirst({
    where: { name: frName },
    select: { id: true, pfsCompositionRef: true },
  });

  if (existing) {
    // Set pfsCompositionRef if missing
    if (!existing.pfsCompositionRef && pfsReference) {
      await prisma.composition.update({ where: { id: existing.id }, data: { pfsCompositionRef: pfsReference } }).catch(() => {});
    }
    // Ensure PfsMapping exists
    await prisma.pfsMapping.upsert({
      where: { type_pfsName: { type: "composition", pfsName: frName.toLowerCase() } },
      create: { type: "composition", pfsName: frName.toLowerCase(), bjEntityId: existing.id, bjName: frName },
      update: { bjEntityId: existing.id, bjName: frName },
    }).catch(() => {});
    compositionCache.set(normalized, existing.id);
    for (const [locale, name] of Object.entries(labels)) {
      if (locale === "fr" || !name) continue;
      try {
        await prisma.compositionTranslation.upsert({
          where: { compositionId_locale: { compositionId: existing.id, locale } },
          update: { name },
          create: { compositionId: existing.id, locale, name },
        });
      } catch {
        // Race condition: concurrent sync already created this — safe to ignore
      }
    }
    return existing.id;
  }

  return null; // Composition non liée — l'admin doit la lier via /admin/pfs/mapping
}

// ─────────────────────────────────────────────
// Country resolution — find or create ManufacturingCountry in BJ
// ─────────────────────────────────────────────

export const countryCache = new Map<string, string>(); // ISO code → ManufacturingCountry.id

export async function findOrCreateCountry(
  isoCode: string,
): Promise<string | null> {
  const normalized = isoCode.trim().toUpperCase();
  if (!normalized) return "";
  if (countryCache.has(normalized)) return countryCache.get(normalized)!;

  // Check PfsMapping first
  const mapping = await prisma.pfsMapping.findUnique({
    where: { type_pfsName: { type: "country", pfsName: normalized.toLowerCase() } },
  });
  if (mapping) {
    const mapped = await prisma.manufacturingCountry.findUnique({ where: { id: mapping.bjEntityId }, select: { id: true } });
    if (mapped) {
      countryCache.set(normalized, mapping.bjEntityId);
      return mapping.bjEntityId;
    }
    await prisma.pfsMapping.delete({ where: { id: mapping.id } }).catch(() => {});
  }

  // Check by ISO code OR by name (ISO code used as name when manually created)
  const existingByIso = await prisma.manufacturingCountry.findFirst({
    where: { OR: [{ isoCode: normalized }, { name: normalized }] },
    select: { id: true },
  });
  if (existingByIso) {
    // Ensure PfsMapping exists
    await prisma.pfsMapping.upsert({
      where: { type_pfsName: { type: "country", pfsName: normalized.toLowerCase() } },
      create: { type: "country", pfsName: normalized.toLowerCase(), bjEntityId: existingByIso.id, bjName: normalized },
      update: { bjEntityId: existingByIso.id, bjName: normalized },
    }).catch(() => {});
    countryCache.set(normalized, existingByIso.id);
    return existingByIso.id;
  }

  return null; // Pays non lié — l'admin doit le lier via l'interface PFS
}

// ─────────────────────────────────────────────
// Season resolution — find or create Season in BJ
// ─────────────────────────────────────────────

export const seasonCache = new Map<string, string>(); // PFS reference → Season.id

export async function findOrCreateSeason(
  reference: string,
  labels: Record<string, string>,
): Promise<string | null> {
  const normalized = reference.trim().toUpperCase();
  if (!normalized) return "";
  if (seasonCache.has(normalized)) return seasonCache.get(normalized)!;

  // Check PfsMapping first
  const mapping = await prisma.pfsMapping.findUnique({
    where: { type_pfsName: { type: "season", pfsName: reference.toLowerCase() } },
  });
  if (mapping) {
    const mapped = await prisma.season.findUnique({ where: { id: mapping.bjEntityId }, select: { id: true } });
    if (mapped) {
      seasonCache.set(normalized, mapping.bjEntityId);
      return mapping.bjEntityId;
    }
    await prisma.pfsMapping.delete({ where: { id: mapping.id } }).catch(() => {});
  }

  // Check by PFS ref
  const existingByRef = await prisma.season.findFirst({
    where: { pfsSeasonRef: normalized },
    select: { id: true },
  });
  if (existingByRef) {
    // Ensure PfsMapping exists
    await prisma.pfsMapping.upsert({
      where: { type_pfsName: { type: "season", pfsName: reference.toLowerCase() } },
      create: { type: "season", pfsName: reference.toLowerCase(), bjEntityId: existingByRef.id, bjName: labels?.fr || normalized },
      update: { bjEntityId: existingByRef.id, bjName: labels?.fr || normalized },
    }).catch(() => {});
    seasonCache.set(normalized, existingByRef.id);
    return existingByRef.id;
  }

  // Check by name (FR label)
  const frName = labels?.fr || normalized;
  const existingByName = await prisma.season.findFirst({
    where: { name: frName },
    select: { id: true, pfsSeasonRef: true },
  });
  if (existingByName) {
    // Set pfsSeasonRef if missing
    if (!existingByName.pfsSeasonRef) {
      await prisma.season.update({ where: { id: existingByName.id }, data: { pfsSeasonRef: normalized } }).catch(() => {});
    }
    // Ensure PfsMapping exists
    await prisma.pfsMapping.upsert({
      where: { type_pfsName: { type: "season", pfsName: reference.toLowerCase() } },
      create: { type: "season", pfsName: reference.toLowerCase(), bjEntityId: existingByName.id, bjName: frName },
      update: { bjEntityId: existingByName.id, bjName: frName },
    }).catch(() => {});
    seasonCache.set(normalized, existingByName.id);
    return existingByName.id;
  }

  return null; // Saison non liée — l'admin doit la lier via l'interface PFS
}

// ─────────────────────────────────────────────
// Image processing
// ─────────────────────────────────────────────

export async function downloadAndProcessImages(
  imageUrls: string[],
  reference: string,
  colorRef: string,
  fallbackUrls?: string[] | null,
): Promise<string[]> {
  // Download ALL images in parallel (no delay between them)
  const results = await Promise.allSettled(
    imageUrls.map(async (url, idx) => {
      let buffer: Buffer | null = null;

      try {
        buffer = await downloadImage(url);
      } catch {
        // Try fallback
        if (fallbackUrls && fallbackUrls[idx]) {
          try {
            buffer = await downloadImage(fallbackUrls[idx]);
          } catch {
            // Both failed
          }
        }
      }

      if (!buffer) return null;

      try {
        const filename = `pfs_${reference}_${colorRef}_${idx}_${Date.now()}`;
        const result = await processProductImage(buffer, "public/uploads/products", filename);
        return { path: result.dbPath, order: idx };
      } catch {
        return null;
      }
    }),
  );

  // Collect successful results, sorted by original order
  return results
    .map((r) => (r.status === "fulfilled" && r.value ? r.value : null))
    .filter((r): r is { path: string; order: number } => r !== null)
    .sort((a, b) => a.order - b.order)
    .map((r) => r.path);
}

// ─────────────────────────────────────────────
// Image source resolution (original ref first)
// ─────────────────────────────────────────────

/**
 * Get the best image source for a product.
 * Strategy:
 *   1. If the ref has a VS suffix (e.g. "A200VS3"), try checkReference("A200") first
 *      to get the original high-quality images.
 *   2. If the base ref doesn't exist on PFS or has no images, fall back to the
 *      versioned ref's images (from the product data we already have).
 */
async function _getBestImageSource(
  pfsProduct: PfsProduct,
): Promise<{ primary: Record<string, string | string[]>; fallback: Record<string, string | string[]> | null }> {
  const pfsRef = pfsProduct.reference.trim().toUpperCase();
  const vsSuffix = getVersionSuffix(pfsRef);

  if (vsSuffix) {
    const baseRef = stripVersionSuffix(pfsRef);
    try {
      const baseCheck = await pfsCheckReference(baseRef);
      if (baseCheck.exists && baseCheck.product?.images) {
        const colorImages = extractColorImages(baseCheck.product.images);
        if (colorImages.size > 0) {
          // Return base ref images as primary, versioned as fallback
          return { primary: baseCheck.product.images, fallback: pfsProduct.images };
        }
      }
    } catch {
      // Base ref not found or API error — use versioned images
    }
  }

  return { primary: pfsProduct.images, fallback: null };
}

// ─────────────────────────────────────────────
// Single product sync
// ─────────────────────────────────────────────

export interface SyncResult {
  action: "created" | "updated" | "skipped" | "error";
  reference: string;
  error?: string;
  /** Product DB id (for status update after images) */
  productId?: string;
  /** Image task to run in background after product is created/updated */
  imageTask?: () => Promise<void>;
}

async function syncSingleProduct(
  pfsProduct: PfsProduct,
  variantDetails: PfsVariantDetail[],
  refDetails: PfsCheckReferenceResponse | null,
  addLog: (msg: string) => void,
): Promise<SyncResult> {
  const pfsRef = pfsProduct.reference.trim().toUpperCase();
  // Strip VS suffix for the real BJ reference
  const bjRef = stripVersionSuffix(pfsRef);

  try {
    addLog(`▶ ${bjRef} — "${pfsProduct.labels?.fr || "?"}" (${variantDetails.length} variantes)`);

    // ── Resolve category ──
    const categoryFr = pfsProduct.category?.labels?.fr;
    if (!categoryFr) {
      addLog(`  ✗ ${bjRef} — Catégorie FR manquante`);
      return { action: "error", reference: bjRef, error: "Catégorie FR manquante" };
    }

    let categoryName = categoryFr;
    if (refDetails?.product?.category?.reference) {
      categoryName = parsePfsCategoryRef(refDetails.product.category.reference);
    }

    const pfsCatId = refDetails?.product?.category?.id || pfsProduct.category?.id || undefined;
    const categoryId = await findOrCreateCategory(categoryName, pfsProduct.category.labels, categoryFr, pfsCatId);
    if (!categoryId) {
      addLog(`  ❌ ${bjRef} — Catégorie non liée: "${categoryName}". Liez-la dans l'interface PFS avant de synchroniser.`);
      return { action: "error", reference: bjRef, error: `Catégorie non liée: ${categoryName}` };
    }
    addLog(`  📂 Catégorie: ${categoryName}`);

    // ── Resolve compositions ──
    const compositions: { compositionId: string; percentage: number }[] = [];
    if (refDetails?.product?.material_composition) {
      for (const mat of refDetails.product.material_composition) {
        const frName = mat.labels?.fr || mat.reference;
        const compositionId = await findOrCreateComposition(frName, mat.labels, mat.reference);
        if (!compositionId) {
          addLog(`  ⚠️ Composition non liée: "${frName}" — ignorée`);
          continue;
        }
        compositions.push({ compositionId, percentage: mat.percentage });
      }
      addLog(`  🧪 Compositions: ${refDetails.product.material_composition.map((m) => `${m.labels?.fr || m.reference} ${m.percentage}%`).join(", ")}`);
    }

    // ── Resolve country of manufacture ──
    let manufacturingCountryId: string | null = null;
    if (refDetails?.product?.country_of_manufacture) {
      const isoCode = refDetails.product.country_of_manufacture;
      manufacturingCountryId = await findOrCreateCountry(isoCode) || null;
      if (manufacturingCountryId) addLog(`  🌍 Pays: ${isoCode}`);
    }

    // ── Resolve season / collection ──
    let seasonId: string | null = null;
    if (refDetails?.product?.collection?.reference) {
      const col = refDetails.product.collection;
      seasonId = await findOrCreateSeason(col.reference, col.labels || {}) || null;
      if (seasonId) addLog(`  📅 Saison: ${col.reference} (${col.labels?.fr || ""})`);
    }

    // ── Build variant data ──
    const variantMap = new Map<string, PfsVariantDetail>();
    for (const v of variantDetails) {
      variantMap.set(v.id, v);
    }

    const activeVariants = (variantDetails.length > 0 ? variantDetails : pfsProduct.variants)
      .filter((v) => v.is_active);

    if (activeVariants.length === 0) {
      addLog(`  ⏭ ${bjRef} — Aucune variante active, skip`);
      return { action: "skipped", reference: bjRef, error: "Aucune variante active" };
    }

    interface VariantData {
      colorId: string;
      colorRef: string;
      unitPrice: number;
      weight: number;
      stock: number;
      saleType: "UNIT" | "PACK";
      packQuantity: number | null;
      sizeName: string | null;
      isPrimary: boolean;
      discountType: "PERCENT" | "AMOUNT" | null;
      discountValue: number | null;
    }

    // ── Detect default/primary color from images DEFAULT key ──
    const allImages = pfsProduct.images;
    const defaultColorRef = detectDefaultColorRef(
      allImages,
      refDetails?.product?.default_color,
    );

    const variants: VariantData[] = [];

    for (const v of activeVariants) {
      const detail = variantMap.get(v.id);
      const weight = detail?.weight ?? v.weight ?? 0;

      if (v.type === "ITEM" && v.item) {
        const colorId = await findOrCreateColor(
          v.item.color.reference,
          v.item.color.value,
          v.item.color.labels,
        );
        if (!colorId) {
          addLog(`  ⚠️ Couleur non liée: "${v.item.color.labels?.fr || v.item.color.reference}" — variante ignorée`);
          continue;
        }

        const pfsPrice = v.price_sale.unit.value;
        const bjPrice = pfsPrice;

        let discountType: "PERCENT" | "AMOUNT" | null = null;
        let discountValue: number | null = null;
        if (v.discount) {
          discountType = v.discount.type === "PERCENT" ? "PERCENT" : "AMOUNT";
          discountValue = v.discount.value;
        }

        addLog(`  🎨 UNIT ${v.item.color.labels?.fr || v.item.color.reference} — PFS: ${pfsPrice}€ → BJ: ${bjPrice}€ | stock: ${v.stock_qty} | poids: ${weight}kg`);

        variants.push({
          colorId,
          colorRef: v.item.color.reference,
          unitPrice: bjPrice,
          weight,
          stock: v.stock_qty,
          saleType: "UNIT",
          packQuantity: null,
          sizeName: v.item.size || null,
          isPrimary: false, // resolved below
          discountType,
          discountValue,
        });
      } else if (v.type === "PACK" && v.packs && v.packs.length > 0) {
        const pack = v.packs[0];
        const colorId = await findOrCreateColor(
          pack.color.reference,
          pack.color.value,
          pack.color.labels,
        );
        if (!colorId) {
          addLog(`  ⚠️ Couleur non liée: "${pack.color.labels?.fr || pack.color.reference}" — variante PACK ignorée`);
          continue;
        }

        const packQty = detail?.pieces ?? pack.sizes?.[0]?.qty ?? v.pieces ?? 1;
        const pfsPrice = v.price_sale.unit.value;
        const bjPrice = pfsPrice;

        let discountType: "PERCENT" | "AMOUNT" | null = null;
        let discountValue: number | null = null;
        if (v.discount) {
          discountType = v.discount.type === "PERCENT" ? "PERCENT" : "AMOUNT";
          discountValue = v.discount.value;
        }

        addLog(`  📦 PACK ×${packQty} ${pack.color.labels?.fr || pack.color.reference} — PFS: ${pfsPrice}€ → BJ: ${bjPrice}€ | stock: ${v.stock_qty} | poids: ${weight}kg`);

        variants.push({
          colorId,
          colorRef: pack.color.reference,
          unitPrice: bjPrice,
          weight,
          stock: v.stock_qty,
          saleType: "PACK",
          packQuantity: packQty,
          sizeName: pack.sizes?.[0]?.size || null,
          isPrimary: false, // resolved below
          discountType,
          discountValue,
        });
      }
    }

    // ── Set isPrimary based on DEFAULT color ──
    if (defaultColorRef && variants.length > 0) {
      const primaryIdx = variants.findIndex((v) => v.colorRef === defaultColorRef);
      if (primaryIdx >= 0) {
        variants[primaryIdx].isPrimary = true;
        addLog(`  ⭐ Couleur principale: ${defaultColorRef} (via DEFAULT)`);
      } else {
        variants[0].isPrimary = true;
        addLog(`  ⭐ Couleur principale: ${variants[0].colorRef} (fallback, DEFAULT "${defaultColorRef}" non trouvé)`);
      }
    } else if (variants.length > 0) {
      variants[0].isPrimary = true;
      addLog(`  ⭐ Couleur principale: ${variants[0].colorRef} (fallback, pas de DEFAULT)`);
    }

    if (variants.length === 0) {
      addLog(`  ⏭ ${bjRef} — Aucune variante valide, skip`);
      return { action: "skipped", reference: bjRef, error: "Aucune variante valide" };
    }

    // ── Product name/description ──
    const nameFr = pfsProduct.labels?.fr || bjRef;
    const descriptionFr = refDetails?.product?.description?.fr || nameFr;

    // ── Translations (no tags) ──
    const translations: { locale: string; name: string; description: string }[] = [];
    const locales = ["en", "de", "es", "it"];
    for (const locale of locales) {
      const name = pfsProduct.labels?.[locale];
      const desc = refDetails?.product?.description?.[locale] || name;
      if (name) {
        translations.push({ locale, name, description: desc || name });
      }
    }

    // ── Check if product already exists (by base ref or pfsProductId) ──
    const existing = await prisma.product.findFirst({
      where: {
        OR: [
          { reference: bjRef },
          { pfsProductId: pfsProduct.id },
        ],
      },
      select: { id: true, reference: true },
    });

    const isUpdate = !!existing;
    addLog(`  ${isUpdate ? "🔄 Mise à jour" : "✨ Création"} "${nameFr}"`);

    // Use product images directly (no extra API call)
    const imageSource = { primary: pfsProduct.images, fallback: null as Record<string, string | string[]> | null };
    const imgColorCount = extractColorImages(imageSource.primary).size;

    if (isUpdate) {
      // ── UPDATE existing product ──
      const productId = existing!.id;

      // Run independent DB operations in parallel
      await Promise.all([
        prisma.product.update({
          where: { id: productId },
          data: { name: nameFr, description: descriptionFr, pfsProductId: pfsProduct.id, categoryId, manufacturingCountryId, seasonId, status: "SYNCING" },
        }),
        prisma.productComposition.deleteMany({ where: { productId } }),
        prisma.productColorImage.deleteMany({ where: { productId } }),
        prisma.productColor.deleteMany({ where: { productId } }),
        prisma.productTranslation.deleteMany({ where: { productId } }),
      ]);

      // Compositions + translations in parallel
      const dbOps: Promise<unknown>[] = [];
      if (compositions.length > 0) {
        dbOps.push(prisma.productComposition.createMany({
          data: compositions.map((c) => ({ productId, ...c })),
          skipDuplicates: true,
        }));
      }
      if (translations.length > 0) {
        dbOps.push(prisma.productTranslation.createMany({
          data: translations.map((t) => ({ productId, ...t })),
          skipDuplicates: true,
        }));
      }

      // Create variants (sequential for IDs)
      const createdVariants: { id: string; colorId: string | null; colorRef: string }[] = [];
      for (const v of variants) {
        const created = await prisma.productColor.create({
          data: {
            productId,
            colorId: v.colorId,
            unitPrice: v.unitPrice,
            weight: v.weight,
            stock: v.stock,
            isPrimary: v.isPrimary,
            saleType: v.saleType,
            packQuantity: v.packQuantity,
            discountType: v.discountType,
            discountValue: v.discountValue,
          },
          select: { id: true, colorId: true },
        });
        createdVariants.push({ ...created, colorRef: v.colorRef });

        // Create VariantSize record if PFS provided a size
        if (v.sizeName) {
          // First try to find by SizePfsMapping, then by name, then create with mapping
          const mapping = await prisma.sizePfsMapping.findFirst({
            where: { pfsSizeRef: v.sizeName },
            select: { size: true },
          });
          let sizeRecord = mapping?.size ?? null;
          if (!sizeRecord) {
            sizeRecord = await prisma.size.findUnique({
              where: { name: v.sizeName },
            });
          }
          if (!sizeRecord) {
            sizeRecord = await prisma.size.create({
              data: { name: v.sizeName },
            });
            // Auto-create M2M mapping for the new size
            await prisma.sizePfsMapping.create({
              data: { sizeId: sizeRecord.id, pfsSizeRef: v.sizeName },
            });
          }
          await prisma.variantSize.create({
            data: { productColorId: created.id, sizeId: sizeRecord.id, quantity: 1 },
          });
        }
      }
      await Promise.all(dbOps);

      addLog(`  ✅ ${bjRef} mis à jour (${variants.length} var) — images en arrière-plan`);

      // Return image task to be run in background
      const imgTask = () => syncProductImages(productId, bjRef, imageSource, createdVariants, addLog);
      return { action: "updated", reference: bjRef, productId, imageTask: imgTask };
    } else {
      // ── CREATE new product ──
      const product = await prisma.product.create({
        data: {
          reference: bjRef,
          pfsProductId: pfsProduct.id,
          name: nameFr,
          description: descriptionFr,
          categoryId,
          manufacturingCountryId,
          seasonId,
          status: "SYNCING",
          isBestSeller: pfsProduct.is_star === 1,
          compositions: {
            create: compositions.map((c) => ({
              compositionId: c.compositionId,
              percentage: c.percentage,
            })),
          },
        },
      });

      // Create variants (sequential — need IDs for images)
      const createdVariants: { id: string; colorId: string | null; colorRef: string }[] = [];
      for (const v of variants) {
        const created = await prisma.productColor.create({
          data: {
            productId: product.id,
            colorId: v.colorId,
            unitPrice: v.unitPrice,
            weight: v.weight,
            stock: v.stock,
            isPrimary: v.isPrimary,
            saleType: v.saleType,
            packQuantity: v.packQuantity,
            discountType: v.discountType,
            discountValue: v.discountValue,
          },
          select: { id: true, colorId: true },
        });
        createdVariants.push({ ...created, colorRef: v.colorRef });

        // Create VariantSize record if PFS provided a size
        if (v.sizeName) {
          // First try to find by SizePfsMapping, then by name, then create with mapping
          const mapping = await prisma.sizePfsMapping.findFirst({
            where: { pfsSizeRef: v.sizeName },
            select: { size: true },
          });
          let sizeRecord = mapping?.size ?? null;
          if (!sizeRecord) {
            sizeRecord = await prisma.size.findUnique({
              where: { name: v.sizeName },
            });
          }
          if (!sizeRecord) {
            sizeRecord = await prisma.size.create({
              data: { name: v.sizeName },
            });
            // Auto-create M2M mapping for the new size
            await prisma.sizePfsMapping.create({
              data: { sizeId: sizeRecord.id, pfsSizeRef: v.sizeName },
            });
          }
          await prisma.variantSize.create({
            data: { productColorId: created.id, sizeId: sizeRecord.id, quantity: 1 },
          });
        }
      }

      // Translations + pendingSimilar in parallel (fast DB ops)
      const dbOps: Promise<unknown>[] = [];

      if (translations.length > 0) {
        dbOps.push(prisma.productTranslation.createMany({
          data: translations.map((t) => ({ productId: product.id, ...t })),
          skipDuplicates: true,
        }));
      }

      dbOps.push(
        prisma.pendingSimilar.findMany({ where: { similarRef: bjRef } }).then(async (pending) => {
          if (pending.length === 0) return;
          for (const p of pending) {
            const sourceProduct = await prisma.product.findUnique({
              where: { reference: p.productRef },
              select: { id: true },
            });
            if (sourceProduct) {
              await prisma.productSimilar.createMany({
                data: [
                  { productId: sourceProduct.id, similarId: product.id },
                  { productId: product.id, similarId: sourceProduct.id },
                ],
                skipDuplicates: true,
              });
            }
          }
          await prisma.pendingSimilar.deleteMany({ where: { similarRef: bjRef } });
        }),
      );

      await Promise.all(dbOps);

      addLog(`  ✅ ${bjRef} créé (${variants.length} var) — images en arrière-plan`);

      // Return image task to be run in background
      const imgTask = () => syncProductImages(product.id, bjRef, imageSource, createdVariants, addLog);
      return { action: "created", reference: bjRef, productId: product.id, imageTask: imgTask };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addLog(`  ❌ ${bjRef} — Erreur: ${message}`);
    return { action: "error", reference: bjRef, error: message };
  }
}

// ─────────────────────────────────────────────
// Image sync for a product
// ─────────────────────────────────────────────

async function syncProductImages(
  productId: string,
  bjRef: string,
  imageSource: { primary: Record<string, string | string[]>; fallback: Record<string, string | string[]> | null },
  createdVariants: { id: string; colorId: string | null; colorRef: string }[],
  addLog: (msg: string) => void,
): Promise<void> {
  const primaryImages = extractColorImages(imageSource.primary);
  const fallbackImages = imageSource.fallback ? extractColorImages(imageSource.fallback) : null;

  for (const [colorRef, urls] of primaryImages) {
    const matchingVariants = createdVariants.filter((v) => v.colorRef === colorRef);
    if (matchingVariants.length === 0) continue;

    // Download and process images (max 5 per color)
    const limitedUrls = urls.slice(0, 5);

    // Also prepare fallback URLs for this color (if available)
    const fallbackUrls = fallbackImages?.get(colorRef)?.slice(0, 5) || null;

    addLog(`  🖼️ Téléchargement ${limitedUrls.length} image(s) pour ${colorRef}...`);
    const paths = await downloadAndProcessImages(limitedUrls, bjRef, colorRef, fallbackUrls);

    if (paths.length === 0) {
      addLog(`  ⚠️ Aucune image récupérée pour ${colorRef}`);
      continue;
    }

    // Link images to the first matching variant (UNIT preferred)
    const primaryVariant = matchingVariants[0];
    const imageData = paths.map((p, idx) => ({
      productId,
      colorId: primaryVariant.colorId ?? "",
      productColorId: primaryVariant.id,
      path: p,
      order: idx,
    }));

    await prisma.productColorImage.createMany({ data: imageData });
    addLog(`  ✓ ${paths.length}/${limitedUrls.length} image(s) sauvegardées pour ${colorRef}`);
  }
}

// ─────────────────────────────────────────────
// Main sync orchestrator
// ─────────────────────────────────────────────

/**
 * Retry sync for specific product references.
 * Searches PFS for each reference, then runs syncSingleProduct.
 */
export async function retryPfsProducts(
  references: string[],
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const noop = () => {}; // no-op logger

  for (const ref of references) {
    try {
      // Search PFS for this reference — paginate until found
      let found: import("@/lib/pfs-api").PfsProduct | null = null;
      let page = 1;
      let lastPage = Infinity;

      while (page <= lastPage && !found) {
        const response = await pfsListProducts(page, 100);
        if (response.meta?.last_page) lastPage = response.meta.last_page;
        if (!response.data || response.data.length === 0) break;

        found = response.data.find((p) => {
          const pfsRef = p.reference.trim().toUpperCase();
          return stripVersionSuffix(pfsRef) === ref.toUpperCase();
        }) ?? null;

        page++;
      }

      if (!found) {
        results.push({ action: "error", reference: ref, error: "Produit non trouvé dans PFS" });
        continue;
      }

      const { variantDetails, refDetails } = await fetchProductDetails(found);
      const result = await syncSingleProduct(found, variantDetails, refDetails, noop);

      // Run image task immediately
      if (result.imageTask) {
        try { await result.imageTask(); } catch { /* ignore image errors */ }
      }

      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ action: "error", reference: ref, error: msg });
    }
  }

  await closePlaywright();
  return results;
}

export interface PfsSyncOptions {
  /** Max number of products to sync (0 = unlimited). For testing. */
  limit?: number;
}

/** Number of products to process in parallel per batch (data creation). */
export const PARALLEL_CONCURRENCY = 10;

/** Number of PFS pages fetched in parallel (10 pages × 100 = 1000 products). */
export const PAGE_CONCURRENCY = 10;

/** Number of image tasks running in parallel in the background pool. */
export const IMAGE_CONCURRENCY = 15;

/**
 * Fetch variant details + reference details for a single product.
 * Returns the data needed by syncSingleProduct.
 */
export async function fetchProductDetails(
  pfsProduct: PfsProduct,
): Promise<{ variantDetails: PfsVariantDetail[]; refDetails: PfsCheckReferenceResponse | null }> {
  // Fetch variants and reference details in parallel
  const [variantsResult, refResult] = await Promise.allSettled([
    pfsGetVariants(pfsProduct.id),
    pfsCheckReference(pfsProduct.reference),
  ]);

  const variantDetails = variantsResult.status === "fulfilled"
    ? (variantsResult.value.data ?? [])
    : [];

  const refDetails = refResult.status === "fulfilled"
    ? refResult.value
    : null;

  return { variantDetails, refDetails };
}

/**
 * Process a batch of products in parallel (fetch details + sync).
 */
async function processBatch(
  products: PfsProduct[],
  addLog: (msg: string) => void,
): Promise<SyncResult[]> {
  const results = await Promise.allSettled(
    products.map(async (pfsProduct) => {
      const { variantDetails, refDetails } = await fetchProductDetails(pfsProduct);
      return syncSingleProduct(pfsProduct, variantDetails, refDetails, addLog);
    }),
  );

  return results.map((r, idx) => {
    if (r.status === "fulfilled") return r.value;
    const ref = products[idx].reference.trim().toUpperCase();
    const errorMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
    addLog(`  ❌ ${stripVersionSuffix(ref)} — Erreur fatale: ${errorMsg}`);
    return {
      action: "error" as const,
      reference: stripVersionSuffix(ref),
      error: errorMsg,
    };
  });
}

/**
 * Max logs kept in memory/DB to avoid unbounded growth.
 * Only the last N entries are persisted — older ones are trimmed.
 */
export const MAX_LOGS = 500;

export async function runPfsSync(jobId: string, options?: PfsSyncOptions): Promise<void> {
  const maxProducts = options?.limit ?? 0;

  // ── Dual log buffers (products + images) ──
  const productLogs: string[] = [];
  const imageLogs: string[] = [];
  let totalImageTasks = 0;

  const ts = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const addProductLog = (msg: string) => {
    productLogs.push(`[${ts()}] ${msg}`);
    if (productLogs.length > MAX_LOGS) productLogs.splice(0, productLogs.length - MAX_LOGS);
  };
  const addImageLog = (msg: string) => {
    imageLogs.push(`[${ts()}] ${msg}`);
    if (imageLogs.length > MAX_LOGS) imageLogs.splice(0, imageLogs.length - MAX_LOGS);
  };
  // addLog used by syncSingleProduct — goes to product logs
  const addLog = addProductLog;

  const buildLogsPayload = () => ({
    productLogs,
    imageLogs,
    imageStats: {
      total: totalImageTasks,
      completed: completedImageTasks,
      failed: failedImageTasks,
      active: activeImageTasks,
      pending: pendingImageTasks.length,
    },
  });

  // ── Background image pool ──
  const pendingImageTasks: (() => Promise<void>)[] = [];
  let activeImageTasks = 0;
  let completedImageTasks = 0;
  let failedImageTasks = 0;
  let imagePoolDrained = false;

  let resolveImagePool: () => void;
  const imagePoolDone = new Promise<void>((resolve) => {
    resolveImagePool = resolve;
  });

  function tryDrainImagePool() {
    while (activeImageTasks < IMAGE_CONCURRENCY && pendingImageTasks.length > 0) {
      const task = pendingImageTasks.shift()!;
      activeImageTasks++;
      task()
        .then(() => { completedImageTasks++; })
        .catch(() => { failedImageTasks++; })
        .finally(() => {
          activeImageTasks--;
          tryDrainImagePool();
          if (imagePoolDrained && activeImageTasks === 0 && pendingImageTasks.length === 0) {
            resolveImagePool();
          }
        });
    }
    if (imagePoolDrained && activeImageTasks === 0 && pendingImageTasks.length === 0) {
      resolveImagePool();
    }
  }

  function enqueueImageTask(task: () => Promise<void>) {
    pendingImageTasks.push(task);
    totalImageTasks++;
    tryDrainImagePool();
  }

  try {
    addProductLog("🚀 Démarrage de la synchronisation PFS...");
    addImageLog("🖼 File d'attente images prête (max " + IMAGE_CONCURRENCY + " en parallèle)");
    await prisma.pfsSyncJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", logs: buildLogsPayload() },
    });

    const job = await prisma.pfsSyncJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("PFS sync job not found");

    const startPage = job.lastPage + 1;
    let page = startPage;
    let lastPage = Infinity;

    const errors: { reference: string; error: string }[] = [];
    let created = job.createdProducts;
    let updated = job.updatedProducts;
    let skipped = job.skippedProducts;
    let errored = job.errorProducts;
    let processed = job.processedProducts;

    while (page <= lastPage) {
      if (maxProducts > 0 && processed >= maxProducts) break;

      // ── Fetch PAGE_CONCURRENCY pages in parallel ──
      const batchEndPage = Math.min(page + PAGE_CONCURRENCY - 1, lastPage);
      const pageNumbers: number[] = [];
      for (let p = page; p <= batchEndPage; p++) pageNumbers.push(p);

      addProductLog(`📄 Chargement pages ${page}-${batchEndPage}${lastPage < Infinity ? `/${lastPage}` : ""} en parallèle...`);

      const pageResults = await Promise.allSettled(
        pageNumbers.map((p) => pfsListProducts(p, 100)),
      );

      // Collect all products from successful pages
      let allPageProducts: PfsProduct[] = [];
      let highestSuccessPage = page - 1;

      for (let i = 0; i < pageResults.length; i++) {
        const result = pageResults[i];
        if (result.status === "rejected") {
          addProductLog(`  ⚠️ Page ${pageNumbers[i]} échouée — ${result.reason instanceof Error ? result.reason.message : "erreur"}`);
          continue;
        }

        const response = result.value;
        if (response.meta?.last_page) {
          lastPage = response.meta.last_page;
        }

        // Update total on first batch
        if (page === startPage && i === 0 && response.state?.active) {
          const total = maxProducts > 0
            ? Math.min(response.state.active, maxProducts)
            : response.state.active;
          addProductLog(`📊 Total produits actifs PFS: ${response.state.active}${maxProducts > 0 ? ` (limité à ${maxProducts})` : ""}`);
          await prisma.pfsSyncJob.update({
            where: { id: jobId },
            data: { totalProducts: total, logs: buildLogsPayload() },
          });
        }

        if (response.data && response.data.length > 0) {
          allPageProducts = allPageProducts.concat(response.data);
          highestSuccessPage = pageNumbers[i];
        }
      }

      if (allPageProducts.length === 0) {
        addProductLog(`📄 Pages ${page}-${batchEndPage} vides — fin de la liste`);
        break;
      }

      addProductLog(`📄 ${allPageProducts.length} produits récupérés depuis ${pageNumbers.length} pages`);

      // ── Deduplicate by base reference (VS1/VS2/VS3 → same product) ──
      {
        const seenRefs = new Set<string>();
        const before = allPageProducts.length;
        allPageProducts = allPageProducts.filter((p) => {
          const bjRef = stripVersionSuffix(p.reference.trim().toUpperCase());
          if (seenRefs.has(bjRef)) return false;
          seenRefs.add(bjRef);
          return true;
        });
        if (allPageProducts.length < before) {
          addProductLog(`🔀 ${before - allPageProducts.length} doublons de ref versionnée retirés → ${allPageProducts.length} produits uniques`);
        }
      }

      // Apply limit
      if (maxProducts > 0) {
        const remaining = maxProducts - processed;
        allPageProducts = allPageProducts.slice(0, remaining);
      }

      // ── Pipeline 1: Create/update product data in batches of PARALLEL_CONCURRENCY ──
      for (let i = 0; i < allPageProducts.length; i += PARALLEL_CONCURRENCY) {
        const batch = allPageProducts.slice(i, i + PARALLEL_CONCURRENCY);
        const batchNum = Math.floor(i / PARALLEL_CONCURRENCY) + 1;
        const totalBatches = Math.ceil(allPageProducts.length / PARALLEL_CONCURRENCY);
        addProductLog(`── Batch ${batchNum}/${totalBatches} (${batch.length} produits en parallèle) ──`);

        const results = await processBatch(batch, addLog);

        for (const result of results) {
          processed++;
          switch (result.action) {
            case "created": created++; break;
            case "updated": updated++; break;
            case "skipped": skipped++; break;
            case "error":
              errored++;
              errors.push({ reference: result.reference, error: result.error || "Unknown" });
              break;
          }

          // ── Pipeline 2: Enqueue image task ──
          if (result.imageTask) {
            const ref = result.reference;
            const pid = result.productId;
            addImageLog(`📥 ${ref} — ajouté à la file d'attente`);
            enqueueImageTask(async () => {
              addImageLog(`⬇️ ${ref} — téléchargement en cours...`);
              try {
                await result.imageTask!();
                // Images done → set product ONLINE
                if (pid) {
                  await prisma.product.update({
                    where: { id: pid },
                    data: { status: "ONLINE" },
                  });
                }
                addImageLog(`✅ ${ref} — images OK, produit en ligne`);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                addImageLog(`❌ ${ref} — erreur: ${msg}`);
                // Still set ONLINE even if images fail (product data is valid)
                if (pid) {
                  await prisma.product.update({
                    where: { id: pid },
                    data: { status: "ONLINE" },
                  }).catch(() => {});
                }
              }
            });
          }
        }

        // Update progress after each batch
        await prisma.pfsSyncJob.update({
          where: { id: jobId },
          data: {
            processedProducts: processed,
            createdProducts: created,
            updatedProducts: updated,
            skippedProducts: skipped,
            errorProducts: errored,
            lastPage: highestSuccessPage,
            logs: buildLogsPayload(),
          },
        });

        if (i + PARALLEL_CONCURRENCY < allPageProducts.length) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      addProductLog(`📄 Pages ${page}-${batchEndPage} terminées — ${processed} produits traités au total`);

      await prisma.pfsSyncJob.update({
        where: { id: jobId },
        data: {
          processedProducts: processed,
          createdProducts: created,
          updatedProducts: updated,
          skippedProducts: skipped,
          errorProducts: errored,
          lastPage: highestSuccessPage,
          logs: buildLogsPayload(),
        },
      });

      page = batchEndPage + 1;
      await new Promise((r) => setTimeout(r, 200));
    }

    // ── Wait for remaining image tasks ──
    addProductLog(`🏁 Produits terminés — ${processed} traités (✨${created} 🔄${updated} ⏭${skipped} ❌${errored})`);
    const remainingImages = activeImageTasks + pendingImageTasks.length;
    if (remainingImages > 0) {
      addImageLog(`⏳ Produits terminés — ${remainingImages} image(s) restante(s) en cours de traitement...`);
    }

    imagePoolDrained = true;
    tryDrainImagePool();
    await imagePoolDone;

    addImageLog(`🏁 Images terminées — ${completedImageTasks} OK${failedImageTasks > 0 ? `, ${failedImageTasks} échouées` : ""}`);

    await closePlaywright();
    addProductLog(`🏁 Synchronisation complète — ${processed} produits, ${completedImageTasks} images`);

    await prisma.pfsSyncJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        processedProducts: processed,
        createdProducts: created,
        updatedProducts: updated,
        skippedProducts: skipped,
        errorProducts: errored,
        errorDetails: errors.length > 0 ? errors : undefined,
        logs: buildLogsPayload(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addProductLog(`💥 Erreur fatale: ${message}`);

    imagePoolDrained = true;
    tryDrainImagePool();
    await imagePoolDone.catch(() => {});
    await closePlaywright();

    await prisma.pfsSyncJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: message,
        logs: buildLogsPayload(),
      },
    }).catch(() => {});
  }
}
