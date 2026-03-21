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

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Strip version suffix from PFS reference.
 * "A200VS3" → "A200", "T198VS1" → "T198", "B100" → "B100"
 */
function stripVersionSuffix(ref: string): string {
  return ref.replace(/VS\d+$/i, "");
}

/**
 * Get the version suffix if present.
 * "A200VS3" → "VS3", "B100" → null
 */
function getVersionSuffix(ref: string): string | null {
  const match = ref.match(/(VS\d+)$/i);
  return match ? match[1] : null;
}

/** Remove ?image_process=... from PFS CDN URLs to get full-size image. */
function fullSizeImageUrl(url: string): string {
  return url.replace(/\?image_process=.*$/, "");
}

/** Extract color images from PFS images object (skip DEFAULT key). */
function extractColorImages(
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

/** Download an image from URL and return buffer. */
async function downloadImage(url: string, maxRetries = 3): Promise<Buffer> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Use AbortController for timeout (15 seconds)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "image/*,*/*;q=0.8",
          Referer: "https://www.parisfashionshops.com/",
        },
      });

      clearTimeout(timeout);

      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // Sanity check: image should be at least 1KB
        if (buffer.length < 1024) {
          throw new Error(`Image too small (${buffer.length} bytes): ${url}`);
        }
        return buffer;
      }

      // Retry on 403/429/5xx
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

  throw lastError || new Error(`Failed after ${maxRetries} retries`);
}

/** Map PFS category reference to BJ category name. */
function parsePfsCategoryRef(ref: string): string {
  const parts = ref.split("/");
  const last = parts[parts.length - 1];

  const categoryMap: Record<string, string> = {
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
  };

  return categoryMap[last] ?? last;
}

// ─────────────────────────────────────────────
// Color resolution — find or create Color in BJ
// ─────────────────────────────────────────────

const colorCache = new Map<string, string>(); // normalized name → Color.id

async function findOrCreateColor(
  reference: string,
  hex: string,
  labels: Record<string, string>,
): Promise<string> {
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
    select: { id: true },
  });

  if (existing) {
    colorCache.set(normalized, existing.id);
    await upsertColorTranslations(existing.id, labels);
    return existing.id;
  }

  const color = await prisma.color.create({
    data: { name: frLabel, hex: hex || null },
  });

  await upsertColorTranslations(color.id, labels);
  colorCache.set(normalized, color.id);
  return color.id;
}

async function upsertColorTranslations(
  colorId: string,
  labels: Record<string, string>,
): Promise<void> {
  for (const [locale, name] of Object.entries(labels)) {
    if (locale === "fr" || !name) continue;
    await prisma.colorTranslation.upsert({
      where: { colorId_locale: { colorId, locale } },
      update: { name },
      create: { colorId, locale, name },
    });
  }
}

// ─────────────────────────────────────────────
// Category resolution
// ─────────────────────────────────────────────

const categoryCache = new Map<string, string>(); // name → Category.id

async function findOrCreateCategory(
  name: string,
  labels?: Record<string, string>,
  pfsOriginalName?: string,
): Promise<string> {
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

  // Use findFirst by name or slug to avoid duplicates
  const existing = await prisma.category.findFirst({
    where: { OR: [{ name }, { slug }] },
    select: { id: true },
  });

  if (existing) {
    categoryCache.set(name, existing.id);
    if (labels) await upsertCategoryTranslations(existing.id, labels);
    return existing.id;
  }

  // Create with try-catch for race conditions (unique constraint on name/slug)
  try {
    const category = await prisma.category.create({
      data: { name, slug },
    });

    if (labels) await upsertCategoryTranslations(category.id, labels);
    categoryCache.set(name, category.id);
    return category.id;
  } catch {
    // Race condition: another call created it between findFirst and create
    const retry = await prisma.category.findFirst({
      where: { OR: [{ name }, { slug }] },
      select: { id: true },
    });
    if (retry) {
      categoryCache.set(name, retry.id);
      return retry.id;
    }
    throw new Error(`Impossible de créer la catégorie: ${name}`);
  }
}

async function upsertCategoryTranslations(
  categoryId: string,
  labels: Record<string, string>,
): Promise<void> {
  for (const [locale, name] of Object.entries(labels)) {
    if (locale === "fr" || !name) continue;
    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId, locale } },
      update: { name },
      create: { categoryId, locale, name },
    });
  }
}

// ─────────────────────────────────────────────
// Composition resolution
// ─────────────────────────────────────────────

const compositionCache = new Map<string, string>(); // normalized name → Composition.id

async function findOrCreateComposition(
  frName: string,
  labels: Record<string, string>,
): Promise<string> {
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
    select: { id: true },
  });

  if (existing) {
    compositionCache.set(normalized, existing.id);
    for (const [locale, name] of Object.entries(labels)) {
      if (locale === "fr" || !name) continue;
      await prisma.compositionTranslation.upsert({
        where: { compositionId_locale: { compositionId: existing.id, locale } },
        update: { name },
        create: { compositionId: existing.id, locale, name },
      });
    }
    return existing.id;
  }

  const composition = await prisma.composition.create({
    data: { name: frName },
  });

  for (const [locale, name] of Object.entries(labels)) {
    if (locale === "fr" || !name) continue;
    await prisma.compositionTranslation.upsert({
      where: { compositionId_locale: { compositionId: composition.id, locale } },
      update: { name },
      create: { compositionId: composition.id, locale, name },
    });
  }

  compositionCache.set(normalized, composition.id);
  return composition.id;
}

// ─────────────────────────────────────────────
// Image processing
// ─────────────────────────────────────────────

async function downloadAndProcessImages(
  imageUrls: string[],
  reference: string,
  colorRef: string,
  fallbackUrls?: string[] | null,
): Promise<string[]> {
  const paths: string[] = [];

  for (let idx = 0; idx < imageUrls.length; idx++) {
    // Small delay between downloads to avoid rate limiting
    if (idx > 0) await new Promise((r) => setTimeout(r, 500));

    let buffer: Buffer | null = null;

    // Try primary URL
    try {
      buffer = await downloadImage(imageUrls[idx]);
    } catch {
      console.warn(`[PFS] Primary image failed for ${reference}/${colorRef}/${idx}, trying fallback...`);

      // Try fallback URL if available
      if (fallbackUrls && fallbackUrls[idx]) {
        try {
          await new Promise((r) => setTimeout(r, 1000));
          buffer = await downloadImage(fallbackUrls[idx]);
          console.log(`[PFS] Fallback image OK for ${reference}/${colorRef}/${idx}`);
        } catch {
          console.warn(`[PFS] Fallback image also failed for ${reference}/${colorRef}/${idx}`);
        }
      }
    }

    if (!buffer) continue;

    try {
      const filename = `pfs_${reference}_${colorRef}_${idx}_${Date.now()}`;
      const result = await processProductImage(buffer, "public/uploads/products", filename);
      paths.push(result.dbPath);
    } catch {
      console.warn(`[PFS] Image processing failed for ${reference}/${colorRef}/${idx}`);
    }
  }

  return paths;
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
async function getBestImageSource(
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

interface SyncResult {
  action: "created" | "updated" | "skipped" | "error";
  reference: string;
  error?: string;
}

async function syncSingleProduct(
  pfsProduct: PfsProduct,
  variantDetails: PfsVariantDetail[],
  refDetails: PfsCheckReferenceResponse | null,
): Promise<SyncResult> {
  const pfsRef = pfsProduct.reference.trim().toUpperCase();
  // Strip VS suffix for the real BJ reference
  const bjRef = stripVersionSuffix(pfsRef);

  try {
    // ── Resolve category ──
    const categoryFr = pfsProduct.category?.labels?.fr;
    if (!categoryFr) {
      return { action: "error", reference: bjRef, error: "Catégorie FR manquante" };
    }

    let categoryName = categoryFr;
    if (refDetails?.product?.category?.reference) {
      categoryName = parsePfsCategoryRef(refDetails.product.category.reference);
    }

    const categoryId = await findOrCreateCategory(categoryName, pfsProduct.category.labels, categoryFr);

    // ── Resolve compositions ──
    const compositions: { compositionId: string; percentage: number }[] = [];
    if (refDetails?.product?.material_composition) {
      for (const mat of refDetails.product.material_composition) {
        const frName = mat.labels?.fr || mat.reference;
        const compositionId = await findOrCreateComposition(frName, mat.labels);
        compositions.push({ compositionId, percentage: mat.percentage });
      }
    }

    // ── Build variant data ──
    const variantMap = new Map<string, PfsVariantDetail>();
    for (const v of variantDetails) {
      variantMap.set(v.id, v);
    }

    const activeVariants = (variantDetails.length > 0 ? variantDetails : pfsProduct.variants)
      .filter((v) => v.is_active);

    if (activeVariants.length === 0) {
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
      size: string | null;
      isPrimary: boolean;
      discountType: "PERCENT" | "AMOUNT" | null;
      discountValue: number | null;
    }

    const variants: VariantData[] = [];
    let firstVariant = true;

    for (const v of activeVariants) {
      const detail = variantMap.get(v.id);
      const weight = detail?.weight ?? v.weight ?? 0;

      if (v.type === "ITEM" && v.item) {
        const colorId = await findOrCreateColor(
          v.item.color.reference,
          v.item.color.value,
          v.item.color.labels,
        );

        let discountType: "PERCENT" | "AMOUNT" | null = null;
        let discountValue: number | null = null;
        if (v.discount) {
          discountType = v.discount.type === "PERCENT" ? "PERCENT" : "AMOUNT";
          discountValue = v.discount.value;
        }

        variants.push({
          colorId,
          colorRef: v.item.color.reference,
          unitPrice: v.price_sale.unit.value,
          weight,
          stock: v.stock_qty,
          saleType: "UNIT",
          packQuantity: null,
          size: v.item.size || null,
          isPrimary: firstVariant,
          discountType,
          discountValue,
        });
        firstVariant = false;
      } else if (v.type === "PACK" && v.packs && v.packs.length > 0) {
        const pack = v.packs[0];
        const colorId = await findOrCreateColor(
          pack.color.reference,
          pack.color.value,
          pack.color.labels,
        );

        const packQty = detail?.pieces ?? pack.sizes?.[0]?.qty ?? v.pieces ?? 1;

        let discountType: "PERCENT" | "AMOUNT" | null = null;
        let discountValue: number | null = null;
        if (v.discount) {
          discountType = v.discount.type === "PERCENT" ? "PERCENT" : "AMOUNT";
          discountValue = v.discount.value;
        }

        variants.push({
          colorId,
          colorRef: pack.color.reference,
          unitPrice: v.price_sale.unit.value,
          weight,
          stock: v.stock_qty,
          saleType: "PACK",
          packQuantity: packQty,
          size: pack.sizes?.[0]?.size || null,
          isPrimary: firstVariant,
          discountType,
          discountValue,
        });
        firstVariant = false;
      }
    }

    if (variants.length === 0) {
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

    // ── Get best image source (original ref first) ──
    const bestImages = await getBestImageSource(pfsProduct);

    if (isUpdate) {
      // ── UPDATE existing product ──
      const productId = existing!.id;

      await prisma.product.update({
        where: { id: productId },
        data: {
          name: nameFr,
          description: descriptionFr,
          pfsProductId: pfsProduct.id,
          categoryId,
          status: "ONLINE",
        },
      });

      // Compositions — rebuild
      await prisma.productComposition.deleteMany({ where: { productId } });
      if (compositions.length > 0) {
        await prisma.productComposition.createMany({
          data: compositions.map((c) => ({ productId, ...c })),
          skipDuplicates: true,
        });
      }

      // Variants — delete existing, recreate
      await prisma.productColorImage.deleteMany({ where: { productId } });
      await prisma.productColor.deleteMany({ where: { productId } });

      const createdVariants: { id: string; colorId: string; colorRef: string }[] = [];
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
            size: v.size,
            discountType: v.discountType,
            discountValue: v.discountValue,
          },
          select: { id: true, colorId: true },
        });
        createdVariants.push({ ...created, colorRef: v.colorRef });
      }

      // Images — from best source (original ref first)
      await syncProductImages(productId, bjRef, bestImages, createdVariants);

      // Translations
      await prisma.productTranslation.deleteMany({ where: { productId } });
      if (translations.length > 0) {
        await prisma.productTranslation.createMany({
          data: translations.map((t) => ({ productId, ...t })),
          skipDuplicates: true,
        });
      }

      return { action: "updated", reference: bjRef };
    } else {
      // ── CREATE new product ──
      const product = await prisma.product.create({
        data: {
          reference: bjRef,
          pfsProductId: pfsProduct.id,
          name: nameFr,
          description: descriptionFr,
          categoryId,
          status: "ONLINE",
          isBestSeller: pfsProduct.is_star === 1,
          compositions: {
            create: compositions.map((c) => ({
              compositionId: c.compositionId,
              percentage: c.percentage,
            })),
          },
        },
      });

      // Create variants
      const createdVariants: { id: string; colorId: string; colorRef: string }[] = [];
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
            size: v.size,
            discountType: v.discountType,
            discountValue: v.discountValue,
          },
          select: { id: true, colorId: true },
        });
        createdVariants.push({ ...created, colorRef: v.colorRef });
      }

      // Images — from best source (original ref first)
      await syncProductImages(product.id, bjRef, bestImages, createdVariants);

      // Translations
      if (translations.length > 0) {
        await prisma.productTranslation.createMany({
          data: translations.map((t) => ({ productId: product.id, ...t })),
          skipDuplicates: true,
        });
      }

      // PendingSimilar resolution
      const pending = await prisma.pendingSimilar.findMany({
        where: { similarRef: bjRef },
      });
      if (pending.length > 0) {
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
      }

      return { action: "created", reference: bjRef };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
  createdVariants: { id: string; colorId: string; colorRef: string }[],
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

    const paths = await downloadAndProcessImages(limitedUrls, bjRef, colorRef, fallbackUrls);

    if (paths.length === 0) continue;

    // Link images to the first matching variant (UNIT preferred)
    const primaryVariant = matchingVariants[0];
    const imageData = paths.map((p, idx) => ({
      productId,
      colorId: primaryVariant.colorId,
      productColorId: primaryVariant.id,
      path: p,
      order: idx,
    }));

    await prisma.productColorImage.createMany({ data: imageData });
  }
}

// ─────────────────────────────────────────────
// Main sync orchestrator
// ─────────────────────────────────────────────

export interface PfsSyncOptions {
  /** Max number of products to sync (0 = unlimited). For testing. */
  limit?: number;
}

export async function runPfsSync(jobId: string, options?: PfsSyncOptions): Promise<void> {
  const maxProducts = options?.limit ?? 0;

  try {
    await prisma.pfsSyncJob.update({
      where: { id: jobId },
      data: { status: "RUNNING" },
    });

    const job = await prisma.pfsSyncJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("PFS sync job not found");

    const startPage = job.lastPage + 1;
    let page = startPage;
    let hasMore = true;

    const errors: { reference: string; error: string }[] = [];
    let created = job.createdProducts;
    let updated = job.updatedProducts;
    let skipped = job.skippedProducts;
    let errored = job.errorProducts;
    let processed = job.processedProducts;

    while (hasMore) {
      // Check limit
      if (maxProducts > 0 && processed >= maxProducts) {
        break;
      }

      const response = await pfsListProducts(page, 100);

      if (!response.data || response.data.length === 0) {
        hasMore = false;
        break;
      }

      // Update total on first page
      if (page === startPage && response.state?.active) {
        const total = maxProducts > 0
          ? Math.min(response.state.active, maxProducts)
          : response.state.active;
        await prisma.pfsSyncJob.update({
          where: { id: jobId },
          data: { totalProducts: total },
        });
      }

      for (const pfsProduct of response.data) {
        // Check limit
        if (maxProducts > 0 && processed >= maxProducts) {
          hasMore = false;
          break;
        }

        // Fetch correct variant data
        let variantDetails: PfsVariantDetail[] = [];
        try {
          const variantsRes = await pfsGetVariants(pfsProduct.id);
          variantDetails = variantsRes.data ?? [];
        } catch {
          // Fall back to inline variants
        }

        // Fetch composition/description
        let refDetails: PfsCheckReferenceResponse | null = null;
        try {
          refDetails = await pfsCheckReference(pfsProduct.reference);
        } catch {
          // Non-critical
        }

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 200));

        const result = await syncSingleProduct(pfsProduct, variantDetails, refDetails);
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

        // Update progress every product in test mode, every 5 in full mode
        const updateInterval = maxProducts > 0 ? 1 : 5;
        if (processed % updateInterval === 0) {
          await prisma.pfsSyncJob.update({
            where: { id: jobId },
            data: {
              processedProducts: processed,
              createdProducts: created,
              updatedProducts: updated,
              skippedProducts: skipped,
              errorProducts: errored,
              lastPage: page,
            },
          });
        }
      }

      // Save progress after each page
      await prisma.pfsSyncJob.update({
        where: { id: jobId },
        data: {
          processedProducts: processed,
          createdProducts: created,
          updatedProducts: updated,
          skippedProducts: skipped,
          errorProducts: errored,
          lastPage: page,
        },
      });

      page++;
      await new Promise((r) => setTimeout(r, 500));
    }

    // Complete
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
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.pfsSyncJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: message,
      },
    }).catch(() => {});
  }
}
