/**
 * PFS Sync Processor
 *
 * Synchronizes products from Paris Fashion Shop → local catalog.
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
import { logger } from "@/lib/logger";
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
import { stripDimensionsSuffix } from "@/lib/pfs-reverse-sync";
import {
  autoTranslateProduct,
  autoTranslateColor,
  autoTranslateCategory,
  autoTranslateComposition,
  autoTranslateManufacturingCountry,
  autoTranslateSeason,
} from "@/lib/auto-translate";
import { deleteMultipleFromR2, r2KeyFromDbPath } from "@/lib/r2";

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


/**
 * Race-safe PfsMapping ensure via raw SQL.
 * Prisma logs prisma:error to stderr from the Rust engine BEFORE rejecting
 * the JS promise, so neither upsert nor try/catch can suppress the log.
 * MySQL's INSERT ... ON DUPLICATE KEY UPDATE is truly atomic and silent.
 */
export async function ensurePfsMapping(
  type: string,
  pfsName: string,
  bjEntityId: string,
  bjName: string,
): Promise<void> {
  const id = `${type}_${pfsName}_${Date.now()}`;
  await prisma.$executeRaw`
    INSERT INTO PfsMapping (id, type, pfsName, bjEntityId, bjName, createdAt, updatedAt)
    VALUES (${id}, ${type}, ${pfsName}, ${bjEntityId}, ${bjName}, NOW(), NOW())
    ON DUPLICATE KEY UPDATE bjEntityId = VALUES(bjEntityId), bjName = VALUES(bjName), updatedAt = NOW()
  `;
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
    // Deduplicate URLs after stripping query params (PFS can return same image with different processing params)
    const unique = [...new Set(arr.map(fullSizeImageUrl))];
    map.set(colorRef, unique);
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

const MAX_PW_CONTEXTS = 3;

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

/** Download image via Playwright (primary method — 3 concurrent browsers). */
async function downloadImagePlaywright(url: string): Promise<Buffer> {
  const { page } = await getPlaywrightPage();
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 30000 });
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

/** Download an image from URL via Playwright with retries. */
export async function downloadImage(url: string, maxRetries = 5): Promise<Buffer> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await downloadImagePlaywright(url);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 15000);
        logger.warn(`[PFS Images] Playwright attempt ${attempt + 1} failed for ${url}: ${lastError.message} — retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  logger.error(`[PFS Images] All ${maxRetries + 1} Playwright attempts failed for ${url}`);
  throw lastError || new Error(`Failed after ${maxRetries + 1} Playwright attempts`);
}

/** Map PFS category reference to BJ category name. */
export function parsePfsCategoryRef(ref: string): string {
  const parts = ref.split("/");
  const last = parts[parts.length - 1];

  const categoryMap: Record<string, string> = {
    // Produits
    EARRINGS: "Boucles d'oreilles",
    RINGS: "Bagues",
    NECKLACES: "Colliers",
    BRACELETS: "Bracelets",
    PENDANTS: "Pendentifs",
    PIERCINGS: "Piercings",
    SETS: "Parures / Ensembles",
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
    await prisma.pfsMapping.deleteMany({ where: { id: mapping.id } });
  }

  // MySQL is case-insensitive by default — also try by pfsColorRef
  const orConditions: { name?: string; pfsColorRef?: string }[] = [{ name: frLabel }];
  if (reference) orConditions.push({ pfsColorRef: reference });

  const existing = await prisma.color.findFirst({
    where: { OR: orConditions },
    select: { id: true, pfsColorRef: true },
  });

  if (existing) {
    // Set pfsColorRef if missing
    if (!existing.pfsColorRef && reference) {
      await prisma.color.update({ where: { id: existing.id }, data: { pfsColorRef: reference } }).catch(() => {});
    }
    // Ensure PfsMapping exists
    await ensurePfsMapping("color", frLabel.toLowerCase(), existing.id, frLabel);
    colorCache.set(normalized, existing.id);
    await upsertColorTranslations(existing.id, labels);
    // Auto-translate missing locales (ar, zh) if enabled
    const existingLocales = Object.keys(labels).filter((l) => l !== "fr" && labels[l]);
    autoTranslateColor(existing.id, frLabel, existingLocales);
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
      await prisma.pfsMapping.deleteMany({ where: { id: mapping.id } });
    }
  }

  const slug = slugify(name);
  // Use the pfsOriginalName (FR label) as the PfsMapping key
  const pfsKey = (pfsOriginalName || name).toLowerCase();

  // Use findFirst by name, slug, OR pfsCategoryId to avoid duplicates
  const orConditions: { name?: string; slug?: string; pfsCategoryId?: string }[] = [{ name }, { slug }];
  if (pfsCatId) orConditions.push({ pfsCategoryId: pfsCatId });

  const existing = await prisma.category.findFirst({
    where: { OR: orConditions },
    select: { id: true, pfsCategoryId: true },
  });

  if (existing) {
    // Set pfsCategoryId if missing
    if (!existing.pfsCategoryId && pfsCatId) {
      await prisma.category.update({ where: { id: existing.id }, data: { pfsCategoryId: pfsCatId } }).catch(() => {});
    }
    // Ensure PfsMapping exists
    await ensurePfsMapping("category", pfsKey, existing.id, name);
    categoryCache.set(name, existing.id);
    if (labels) {
      await upsertCategoryTranslations(existing.id, labels);
      // Auto-translate missing locales (ar, zh) if enabled
      const existingLocales = Object.keys(labels).filter((l) => l !== "fr" && labels[l]);
      autoTranslateCategory(existing.id, name, existingLocales);
    }
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
    await prisma.pfsMapping.deleteMany({ where: { id: mapping.id } });
  }

  // Also try by pfsCompositionRef
  const orConditions: { name?: string; pfsCompositionRef?: string }[] = [{ name: frName }];
  if (pfsReference) orConditions.push({ pfsCompositionRef: pfsReference });

  const existing = await prisma.composition.findFirst({
    where: { OR: orConditions },
    select: { id: true, pfsCompositionRef: true },
  });

  if (existing) {
    // Set pfsCompositionRef if missing
    if (!existing.pfsCompositionRef && pfsReference) {
      await prisma.composition.update({ where: { id: existing.id }, data: { pfsCompositionRef: pfsReference } }).catch(() => {});
    }
    // Ensure PfsMapping exists
    await ensurePfsMapping("composition", frName.toLowerCase(), existing.id, frName);
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
    // Auto-translate missing locales (ar, zh) if enabled
    const existingLocales = Object.keys(labels).filter((l) => l !== "fr" && labels[l]);
    autoTranslateComposition(existing.id, frName, existingLocales);
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
    await prisma.pfsMapping.deleteMany({ where: { id: mapping.id } });
  }

  // Check by ISO code, pfsCountryRef, OR name
  const existing = await prisma.manufacturingCountry.findFirst({
    where: { OR: [{ isoCode: normalized }, { pfsCountryRef: normalized }, { name: normalized }] },
    select: { id: true, isoCode: true, pfsCountryRef: true },
  });
  if (existing) {
    // Fill missing fields if needed
    const updates: Record<string, string> = {};
    if (!existing.isoCode) updates.isoCode = normalized;
    if (!existing.pfsCountryRef) updates.pfsCountryRef = normalized;
    if (Object.keys(updates).length > 0) {
      await prisma.manufacturingCountry.update({ where: { id: existing.id }, data: updates }).catch(() => {});
    }
    // Ensure PfsMapping exists
    await ensurePfsMapping("country", normalized.toLowerCase(), existing.id, normalized);
    countryCache.set(normalized, existing.id);
    return existing.id;
  }

  // Auto-create country from ISO code
  const created = await prisma.manufacturingCountry.create({
    data: { name: normalized, isoCode: normalized, pfsCountryRef: normalized },
    select: { id: true },
  });
  await ensurePfsMapping("country", normalized.toLowerCase(), created.id, normalized);
  countryCache.set(normalized, created.id);
  // Auto-translate country name to all locales if enabled
  autoTranslateManufacturingCountry(created.id, normalized);
  return created.id;
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
    await prisma.pfsMapping.deleteMany({ where: { id: mapping.id } });
  }

  // Check by pfsRef on Season
  const existingByRef = await prisma.season.findUnique({
    where: { pfsRef: normalized },
    select: { id: true },
  });
  if (existingByRef) {
    // Ensure PfsMapping exists
    await ensurePfsMapping("season", reference.toLowerCase(), existingByRef.id, labels?.fr || normalized);
    seasonCache.set(normalized, existingByRef.id);
    // Auto-translate missing locales if enabled
    const seasonFrName = labels?.fr || normalized;
    const seasonExistingLocales = Object.keys(labels).filter((l) => l !== "fr" && labels[l]);
    autoTranslateSeason(existingByRef.id, seasonFrName, seasonExistingLocales);
    return existingByRef.id;
  }

  // Check by name (FR label or normalized reference)
  const frName = labels?.fr || normalized;
  const existingByName = await prisma.season.findFirst({
    where: { OR: [{ name: frName }, { name: normalized }] },
    select: { id: true, pfsRef: true },
  });
  if (existingByName) {
    // Set pfsRef if not already set
    if (!existingByName.pfsRef) {
      await prisma.season.update({ where: { id: existingByName.id }, data: { pfsRef: normalized } }).catch(() => {});
    }
    // Ensure PfsMapping exists
    await ensurePfsMapping("season", reference.toLowerCase(), existingByName.id, frName);
    seasonCache.set(normalized, existingByName.id);
    // Auto-translate missing locales if enabled
    const existingLocales = Object.keys(labels).filter((l) => l !== "fr" && labels[l]);
    autoTranslateSeason(existingByName.id, frName, existingLocales);
    return existingByName.id;
  }

  return null; // Saison non liée — l'admin doit la lier via l'interface PFS
}

// ─────────────────────────────────────────────
// Size resolution helper
// ─────────────────────────────────────────────

async function resolveSizeRecord(sizeName: string, categoryId?: string) {
  // First try to find by SizePfsMapping, then by name, then create with mapping
  let sizeRecord: { id: string; name: string } | null = null;

  const mapping = await prisma.sizePfsMapping.findFirst({
    where: { pfsSizeRef: sizeName },
    select: { size: true },
  });
  if (mapping?.size) {
    sizeRecord = mapping.size;
  } else {
    const existing = await prisma.size.findUnique({ where: { name: sizeName } });
    if (existing) {
      sizeRecord = existing;
    } else {
      sizeRecord = await prisma.size.create({ data: { name: sizeName } });
      await prisma.sizePfsMapping.create({
        data: { sizeId: sizeRecord.id, pfsSizeRef: sizeName },
      });
    }
  }

  // Ensure the size is linked to the product's category
  if (categoryId) {
    await prisma.sizeCategoryLink.createMany({
      data: [{ sizeId: sizeRecord.id, categoryId }],
      skipDuplicates: true,
    });
  }

  return sizeRecord;
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[PFS Images] ${reference}/${colorRef} img${idx} — primary download failed: ${msg} (url: ${url})`);
        // Try fallback
        if (fallbackUrls && fallbackUrls[idx]) {
          try {
            buffer = await downloadImage(fallbackUrls[idx]);
            logger.info(`[PFS Images] ${reference}/${colorRef} img${idx} — fallback succeeded`);
          } catch (fbErr) {
            const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
            logger.warn(`[PFS Images] ${reference}/${colorRef} img${idx} — fallback also failed: ${fbMsg}`);
          }
        }
      }

      if (!buffer) {
        logger.warn(`[PFS Images] ${reference}/${colorRef} img${idx} — no image data, skipping`);
        return null;
      }

      try {
        const filename = `pfs_${reference}_${colorRef}_${idx}_${Date.now()}`;
        const result = await processProductImage(buffer, "public/uploads/products", filename);
        return { path: result.dbPath, order: idx };
      } catch (procErr) {
        const procMsg = procErr instanceof Error ? procErr.message : String(procErr);
        logger.error(`[PFS Images] ${reference}/${colorRef} img${idx} — processing failed: ${procMsg}`);
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
  imageTask?: () => Promise<{ expected: number; downloaded: number }>;
  /** BJ status derived from PFS status (ONLINE if READY_FOR_SALE, OFFLINE otherwise) */
  bjStatus?: "ONLINE" | "OFFLINE";
}

async function syncSingleProduct(
  pfsProduct: PfsProduct,
  variantDetails: PfsVariantDetail[],
  refDetails: PfsCheckReferenceResponse | null,
  addLog: (msg: string) => void,
  addImageLog?: (msg: string) => void,
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

    // Import ALL variants (including disabled ones — they get stock=0)
    const allVariants = variantDetails.length > 0 ? variantDetails : pfsProduct.variants;

    if (allVariants.length === 0) {
      addLog(`  ⏭ ${bjRef} — Aucune variante, skip`);
      return { action: "skipped", reference: bjRef, error: "Aucune variante" };
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
      sizeNames?: string[];
      sizeEntries?: { name: string; qty: number; pricePerUnit: number }[];
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

    for (const v of allVariants) {
      const detail = variantMap.get(v.id);
      const weight = detail?.weight ?? v.weight ?? 0;
      // /variants endpoint returns colors[] instead of item for ITEM variants
      const detailColors = (v as PfsVariantDetail).colors;

      if (v.type === "ITEM") {
        // Resolve color: prefer v.item (inline), fallback to colors[] (detailed endpoint)
        const itemColor = v.item?.color ?? detailColors?.[0];
        if (!itemColor) {
          addLog(`  ⚠️ Variante UNIT ${v.id} — pas de couleur (ni item ni colors[]), ignorée`);
          continue;
        }

        const colorId = await findOrCreateColor(
          itemColor.reference,
          itemColor.value,
          itemColor.labels,
        );
        if (!colorId) {
          addLog(`  ⚠️ Couleur non liée: "${itemColor.labels?.fr || itemColor.reference}" — variante ignorée`);
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

        // Size: prefer v.item.size, fallback to size_details_tu from detailed endpoint
        const sizeName = v.item?.size || (v as PfsVariantDetail).size_details_tu || null;

        addLog(`  🎨 UNIT ${itemColor.labels?.fr || itemColor.reference} — PFS: ${pfsPrice}€ → BJ: ${bjPrice}€ | stock: ${v.stock_qty} | poids: ${weight}kg`);

        variants.push({
          colorId,
          colorRef: itemColor.reference,
          unitPrice: bjPrice,
          weight,
          stock: v.is_active ? v.stock_qty : 0,
          saleType: "UNIT",
          packQuantity: null,
          sizeName,
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

        // Collect ALL sizes with quantities from ALL packs
        const sizeQtyMap = new Map<string, number>();
        for (const p of v.packs!) {
          if (p.sizes) {
            for (const s of p.sizes) {
              if (s.size) {
                sizeQtyMap.set(s.size, (sizeQtyMap.get(s.size) || 0) + (s.qty || 1));
              }
            }
          }
        }
        const sizeNames = [...sizeQtyMap.keys()];
        // price_sale.unit.value is per-piece price; DB stores total pack price
        const totalItems = [...sizeQtyMap.values()].reduce((a, b) => a + b, 0);
        const sizeEntries = sizeNames.map((name) => ({
          name,
          qty: sizeQtyMap.get(name) || 1,
          pricePerUnit: Math.round(bjPrice * 100) / 100,
        }));

        variants.push({
          colorId,
          colorRef: pack.color.reference,
          unitPrice: totalItems > 0 ? bjPrice * totalItems : bjPrice,
          weight,
          stock: v.is_active ? v.stock_qty : 0,
          saleType: "PACK",
          packQuantity: packQty,
          sizeName: sizeNames[0] || null,
          sizeNames,
          sizeEntries,
          isPrimary: false, // resolved below
          discountType,
          discountValue,
        });
      } else {
        addLog(`  ⚠️ Variante ${v.id} type="${v.type}" ignorée (données manquantes: item=${!!v.item}, packs=${!!v.packs})`);
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

    // ── Product name/description (strip dimensions suffix added by reverse sync) ──
    const nameFr = pfsProduct.labels?.fr || bjRef;
    const rawDescFr = refDetails?.product?.description?.fr || nameFr;
    const descriptionFr = stripDimensionsSuffix(rawDescFr);

    // ── Translations (no tags, strip dimensions) ──
    const translations: { locale: string; name: string; description: string }[] = [];
    const locales = ["en", "de", "es", "it"];
    for (const locale of locales) {
      const name = pfsProduct.labels?.[locale];
      const rawDesc = refDetails?.product?.description?.[locale] || name;
      const desc = rawDesc ? stripDimensionsSuffix(rawDesc) : name;
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
    const bjStatus = pfsProduct.status === "READY_FOR_SALE" ? "ONLINE" as const : "OFFLINE" as const;
    addLog(`  ${isUpdate ? "🔄 Mise à jour" : "✨ Création"} "${nameFr}" (PFS: ${pfsProduct.status} → ${bjStatus})`);

    // Use product images directly (no extra API call)
    const imageSource = { primary: pfsProduct.images, fallback: null as Record<string, string | string[]> | null };
    const imgColorCount = extractColorImages(imageSource.primary).size;

    if (isUpdate) {
      // ── UPDATE existing product ──
      const productId = existing!.id;

      // Delete old image files from R2 before removing DB records
      const oldImages = await prisma.productColorImage.findMany({
        where: { productId },
        select: { path: true },
      });
      if (oldImages.length > 0) {
        const r2Keys = oldImages.flatMap(({ path }) => {
          const base = r2KeyFromDbPath(path);
          const ext = ".webp";
          if (!base.endsWith(ext)) return [base];
          const stem = base.slice(0, -ext.length);
          return [`${stem}${ext}`, `${stem}_md${ext}`, `${stem}_thumb${ext}`];
        });
        await deleteMultipleFromR2(r2Keys).catch((err) =>
          logger.warn(`[PFS_SYNC] Failed to delete old R2 images for ${bjRef}`, { error: err }),
        );
      }

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

        // Create VariantSize records — support multiple sizes with qty + price (PACK variants)
        if (v.sizeEntries?.length) {
          for (const entry of v.sizeEntries) {
            const sizeRecord = await resolveSizeRecord(entry.name, categoryId);
            await prisma.variantSize.create({
              data: {
                productColorId: created.id,
                sizeId: sizeRecord.id,
                quantity: entry.qty,
                pricePerUnit: entry.pricePerUnit,
              },
            });
          }
        } else {
          const sizes = v.sizeNames?.length ? v.sizeNames : (v.sizeName ? [v.sizeName] : []);
          for (const sizeName of sizes) {
            const sizeRecord = await resolveSizeRecord(sizeName, categoryId);
            await prisma.variantSize.create({
              data: { productColorId: created.id, sizeId: sizeRecord.id, quantity: 1 },
            });
          }
        }
      }
      await Promise.all(dbOps);

      // Auto-translate product name/description for missing locales
      const pfsLocalesUpdate = translations.map((t) => t.locale);
      autoTranslateProduct(productId, nameFr, descriptionFr, pfsLocalesUpdate);

      addLog(`  ✅ ${bjRef} mis à jour (${variants.length} var) — images en arrière-plan`);

      // Return image task to be run in background
      const imgTask = () => syncProductImages(productId, bjRef, imageSource, createdVariants, addLog, addImageLog);
      return { action: "updated", reference: bjRef, productId, imageTask: imgTask, bjStatus };
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

        // Create VariantSize records — support multiple sizes with qty + price (PACK variants)
        if (v.sizeEntries?.length) {
          for (const entry of v.sizeEntries) {
            const sizeRecord = await resolveSizeRecord(entry.name, categoryId);
            await prisma.variantSize.create({
              data: {
                productColorId: created.id,
                sizeId: sizeRecord.id,
                quantity: entry.qty,
                pricePerUnit: entry.pricePerUnit,
              },
            });
          }
        } else {
          const sizes = v.sizeNames?.length ? v.sizeNames : (v.sizeName ? [v.sizeName] : []);
          for (const sizeName of sizes) {
            const sizeRecord = await resolveSizeRecord(sizeName, categoryId);
            await prisma.variantSize.create({
              data: { productColorId: created.id, sizeId: sizeRecord.id, quantity: 1 },
            });
          }
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

      // Auto-translate product name/description for missing locales
      const pfsLocales = translations.map((t) => t.locale);
      autoTranslateProduct(product.id, nameFr, descriptionFr, pfsLocales);

      addLog(`  ✅ ${bjRef} créé (${variants.length} var) — images en arrière-plan`);

      // Return image task to be run in background
      const imgTask = () => syncProductImages(product.id, bjRef, imageSource, createdVariants, addLog, addImageLog);
      return { action: "created", reference: bjRef, productId: product.id, imageTask: imgTask, bjStatus };
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
  addImageLog?: (msg: string) => void,
): Promise<{ expected: number; downloaded: number }> {
  const imgLog = addImageLog || addLog;
  const primaryImages = extractColorImages(imageSource.primary);
  const fallbackImages = imageSource.fallback ? extractColorImages(imageSource.fallback) : null;

  let totalExpected = 0;
  let totalDownloaded = 0;

  for (const [colorRef, urls] of primaryImages) {
    const matchingVariants = createdVariants.filter((v) => v.colorRef === colorRef);
    if (matchingVariants.length === 0) continue;

    // Download and process images (max 5 per color)
    const limitedUrls = urls.slice(0, 5);
    totalExpected += limitedUrls.length;

    // Also prepare fallback URLs for this color (if available)
    const fallbackUrls = fallbackImages?.get(colorRef)?.slice(0, 5) || null;

    imgLog(`  🖼️ ${bjRef} — téléchargement ${limitedUrls.length} image(s), couleur : ${colorRef}`);
    const paths = await downloadAndProcessImages(limitedUrls, bjRef, colorRef, fallbackUrls);
    totalDownloaded += paths.length;

    if (paths.length === 0) {
      imgLog(`  ⚠️ ${bjRef} — aucune image récupérée pour couleur : ${colorRef}`);
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
    imgLog(`  ✅ ${bjRef} — ${paths.length}/${limitedUrls.length} image(s) sauvegardées, couleur : ${colorRef}`);
  }

  return { expected: totalExpected, downloaded: totalDownloaded };
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
      if (result.imageTask && result.productId) {
        try {
          const imgStats = await result.imageTask();
          const finalStatus = result.bjStatus || "ONLINE";
          if (imgStats.downloaded > 0 && imgStats.downloaded >= imgStats.expected) {
            await prisma.product.update({
              where: { id: result.productId },
              data: { status: finalStatus },
            });
          } else if (imgStats.downloaded === 0) {
            // No images — delete product
            await prisma.product.delete({ where: { id: result.productId } }).catch(() => {});
            result.action = "error";
            result.error = `Aucune image téléchargée (0/${imgStats.expected})`;
            logger.warn(`[PFS Images] retry ${ref} — product DELETED: 0/${imgStats.expected} images`);
          } else {
            // Partial — keep OFFLINE
            await prisma.product.update({
              where: { id: result.productId },
              data: { status: "OFFLINE" },
            });
            result.action = "error";
            result.error = `Images incomplètes (${imgStats.downloaded}/${imgStats.expected})`;
            logger.warn(`[PFS Images] retry ${ref} — set OFFLINE: ${imgStats.downloaded}/${imgStats.expected} images`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[PFS Images] retry ${ref} — image task failed: ${msg}`);
          await prisma.product.delete({ where: { id: result.productId } }).catch(() => {});
          result.action = "error";
          result.error = `Erreur images: ${msg}`;
        }
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
  addImageLog?: (msg: string) => void,
): Promise<SyncResult[]> {
  const results = await Promise.allSettled(
    products.map(async (pfsProduct) => {
      const { variantDetails, refDetails } = await fetchProductDetails(pfsProduct);
      return syncSingleProduct(pfsProduct, variantDetails, refDetails, addLog, addImageLog);
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
        .catch((err) => { failedImageTasks++; logger.error(`[PFS Images] Image task failed in pool: ${err instanceof Error ? err.message : String(err)}`); })
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
    const imageFailures: { reference: string; reason: string; downloaded: number; expected: number }[] = [];
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

        const results = await processBatch(batch, addLog, addImageLog);

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
            const finalStatus = result.bjStatus || "ONLINE";
            addImageLog(`📥 ${ref} — ajouté à la file d'attente`);
            enqueueImageTask(async () => {
              addImageLog(`⬇️ ${ref} — téléchargement en cours...`);
              try {
                const imgStats = await result.imageTask!();
                if (!pid) return;

                if (imgStats.downloaded < imgStats.expected) {
                  // Any missing images — delete the product entirely (never create with incomplete images)
                  await prisma.product.delete({ where: { id: pid } }).catch(() => {});
                  created = Math.max(0, created - 1);
                  errored++;
                  imageFailures.push({ reference: ref, reason: `Images incomplètes (${imgStats.downloaded}/${imgStats.expected})`, downloaded: imgStats.downloaded, expected: imgStats.expected });
                  addImageLog(`🗑️ ${ref} — ${imgStats.downloaded}/${imgStats.expected} images, produit supprimé`);
                  logger.warn(`[PFS Images] ${ref} — product ${pid} DELETED: ${imgStats.downloaded}/${imgStats.expected} images`);
                } else {
                  // All images downloaded — set final status
                  await prisma.product.update({
                    where: { id: pid },
                    data: { status: finalStatus },
                  });
                  addImageLog(`✅ ${ref} — ${imgStats.downloaded}/${imgStats.expected} image(s) OK, produit ${finalStatus === "ONLINE" ? "en ligne" : "hors ligne"}`);
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                addImageLog(`❌ ${ref} — erreur images: ${msg}, produit supprimé`);
                logger.error(`[PFS Images] ${ref} — image task failed: ${msg}`);
                // Image task crashed — delete the product
                if (pid) {
                  await prisma.product.delete({ where: { id: pid } }).catch(() => {});
                  created = Math.max(0, created - 1);
                  errored++;
                  imageFailures.push({ reference: ref, reason: msg, downloaded: 0, expected: 0 });
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

    // ── Image failure summary ──
    if (imageFailures.length > 0) {
      addImageLog(`\n📋 Résumé des échecs images (${imageFailures.length} produit(s)) :`);
      for (const f of imageFailures) {
        addImageLog(`  • ${f.reference} — ${f.reason} (${f.downloaded}/${f.expected})`);
      }
      addImageLog(`\n💡 Vous pouvez réimporter ces produits via "Réimporter les échoués" ci-dessous.`);
    }

    await closePlaywright();
    addProductLog(`🏁 Synchronisation complète — ${processed} produits, ${completedImageTasks} images${imageFailures.length > 0 ? `, ${imageFailures.length} échoué(s)` : ""}`);

    // Merge product errors + image failures for errorDetails
    const allErrors = [
      ...errors,
      ...imageFailures.map((f) => ({ reference: f.reference, error: `${f.reason} (${f.downloaded}/${f.expected} images)` })),
    ];

    await prisma.pfsSyncJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        processedProducts: processed,
        createdProducts: created,
        updatedProducts: updated,
        skippedProducts: skipped,
        errorProducts: errored,
        errorDetails: allErrors.length > 0 ? allErrors : undefined,
        failedReferences: imageFailures.length > 0 ? imageFailures.map((f) => f.reference) : undefined,
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
