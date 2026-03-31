/**
 * eFashion Prepare Processor
 *
 * Stages eFashion products for admin review before creating them in DB.
 * Flow: Prepare (fetch data + store image URLs) -> Review (admin edits) -> Approve (download images + create in DB) / Reject (discard)
 *
 * Three main functions:
 *   - runEfashionPrepare(jobId, options?) — background job that paginates eFashion products
 *   - approveEfashionStagedProduct(stagedId) — downloads images and creates Product in DB
 *   - rejectEfashionStagedProduct(stagedId) — marks as REJECTED
 */

import { prisma } from "@/lib/prisma";
import { ensureEfashionAuth } from "@/lib/efashion-auth";
import {
  efashionListProducts,
  efashionGetProductDetails,
  efashionGetPacks,
  efashionGetDeclinaisons,
  efashionImageUrl,
  type EfashionProductListItem,
  type EfashionProductDetails,
  type EfashionCouleurProduit,
  type EfashionStock,
  type EfashionComposition,
  type EfashionPack,
  type EfashionDeclinaison,
} from "@/lib/efashion-api";
import { processProductImage } from "@/lib/image-processor";
import { logger } from "@/lib/logger";
import { revalidatePath, revalidateTag } from "next/cache";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREPARE_CONCURRENCY = 5;
const MAX_LOGS = 500;
const PAGE_SIZE = 100;
const IMAGE_CONCURRENCY = 3;
const BULK_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// Types (staged product JSON fields)
// ---------------------------------------------------------------------------

export interface StagedVariant {
  colorId: number; // eFashion color id
  colorName: string;
  colorNameEN: string;
  saleType: "UNIT" | "PACK";
  price: number;
  weight: number;
  stock: number; // total stock across sizes
  sizes: Array<{ name: string; quantity: number }>;
  discount: number | null;
}

export interface StagedColorData {
  efashionColorId: number;
  colorName: string;
  colorNameEN: string;
}

export interface StagedComposition {
  efashionId: number;
  name: string;
  percentage: number | null;
}

export interface StagedTranslation {
  locale: string;
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract size names from a Pack grid (p1-p12 non-zero slots). */
function extractPackSizes(pack: EfashionPack): string[] {
  const sizes: string[] = [];
  const p = pack as unknown as Record<string, number>;
  for (let i = 1; i <= 12; i++) {
    const val = p[`p${i}`];
    if (val && val > 0) {
      sizes.push(`T${i}`);
    }
  }
  return sizes.length > 0 ? sizes : ["TU"];
}

/** Extract size names from a Declinaison (d1_FR-d12_FR non-null slots). */
function extractDeclinaisonSizes(decl: EfashionDeclinaison): string[] {
  const sizes: string[] = [];
  const d = decl as unknown as Record<string, string | null>;
  for (let i = 1; i <= 12; i++) {
    const val = d[`d${i}_FR`];
    if (val && val.trim()) {
      sizes.push(val.trim());
    }
  }
  return sizes;
}

/** Compute pack quantity from Pack grid (sum of p1-p12). */
function computePackQuantity(pack: EfashionPack): number {
  const p = pack as unknown as Record<string, number>;
  let total = 0;
  for (let i = 1; i <= 12; i++) {
    const val = p[`p${i}`];
    if (val && val > 0) total += val;
  }
  return Math.max(total, 1);
}

/** Build stock map: { colorId -> { sizeName -> quantity } } */
function buildStockMap(
  stocks: EfashionStock[],
): Map<number, Map<string, number>> {
  const map = new Map<number, Map<string, number>>();
  for (const s of stocks) {
    if (!map.has(s.id_couleur)) {
      map.set(s.id_couleur, new Map());
    }
    const sizeMap = map.get(s.id_couleur)!;
    const sizeName = s.taille?.trim() || "TU";
    sizeMap.set(sizeName, (sizeMap.get(sizeName) || 0) + s.value);
  }
  return map;
}

/** Get total stock for a color across all sizes. */
function totalStockForColor(
  stockMap: Map<number, Map<string, number>>,
  colorId: number,
): number {
  const sizeMap = stockMap.get(colorId);
  if (!sizeMap) return 0;
  let total = 0;
  sizeMap.forEach((qty) => { total += qty; });
  return total;
}

/** Download an image from a URL and return a Buffer. */
async function downloadImage(url: string, maxRetries = 3): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; BJSync/1.0)",
          Accept: "image/*,*/*",
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} downloading ${url}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Prepare single product
// ---------------------------------------------------------------------------

interface PrepareSingleResult {
  status: "ready" | "error";
  efashionProductId: number;
  reference: string;
  error?: string;
}

async function prepareSingleProduct(
  item: EfashionProductListItem,
  prepareJobId: string,
  packsMap: Map<number, EfashionPack>,
  declMap: Map<number, EfashionDeclinaison>,
  categoryMappings: Map<number, { bjEntityId: string; bjName: string }>,
  colorMappings: Map<number, { bjEntityId: string; bjName: string }>,
  dbCategoriesByEfId: Map<number, { id: string; name: string }>,
  dbColorsByEfId: Map<number, { id: string; name: string }>,
  addLog: (msg: string) => void,
): Promise<PrepareSingleResult> {
  const efId = item.id_produit;
  const ref = item.reference;

  try {
    addLog(`▶ ${ref} — préparation...`);

    // Fetch full details in parallel
    const details = await efashionGetProductDetails(efId);
    const { product, colors, description, stocks, compositions, photos } = details;

    // ── Resolve category ──
    const efCatId = product.id_categorie;
    let resolvedCategoryName = item.categorie || `Catégorie ${efCatId}`;
    let resolvedCategoryId: number = efCatId;

    // Check direct DB mapping (Category.efashionCategoryId) or EfashionMapping
    const dbCat = dbCategoriesByEfId.get(efCatId);
    const mappingCat = categoryMappings.get(efCatId);

    if (!dbCat && !mappingCat) {
      addLog(`  ⚠️ ${ref} — catégorie non mappée (${resolvedCategoryName}), produit stagé quand même`);
    } else if (dbCat) {
      resolvedCategoryName = dbCat.name;
    } else if (mappingCat) {
      resolvedCategoryName = mappingCat.bjName;
    }

    // ── Determine sale type ──
    const saleType: "UNIT" | "PACK" = product.vendu_par === "assortiment" ? "PACK" : "UNIT";

    // ── Get sizes ──
    let sizeNames: string[] = [];
    let packQuantity: number | null = null;

    if (saleType === "PACK" && product.id_pack) {
      const pack = packsMap.get(product.id_pack);
      if (pack) {
        sizeNames = extractPackSizes(pack);
        packQuantity = computePackQuantity(pack);
      }
    } else if (saleType === "UNIT" && product.id_declinaison) {
      const decl = declMap.get(product.id_declinaison);
      if (decl) {
        sizeNames = extractDeclinaisonSizes(decl);
      }
    }

    if (sizeNames.length === 0) {
      sizeNames = ["TU"];
    }

    // ── Build stock map ──
    const stockMap = buildStockMap(stocks);

    // ── Build variants (one per color) ──
    const variants: StagedVariant[] = [];
    const colorDataList: StagedColorData[] = [];

    for (const cp of colors) {
      const colorId = cp.id_couleur;
      const colorName = cp.couleur.couleur_FR;
      const colorNameEN = cp.couleur.couleur_EN;

      // Stock per size for this color
      const colorStockMap = stockMap.get(colorId);
      const sizes: Array<{ name: string; quantity: number }> = sizeNames.map((name) => ({
        name,
        quantity: colorStockMap?.get(name) || 0,
      }));

      const totalStock = totalStockForColor(stockMap, colorId);

      const price = parseFloat(String(product.prix)) || 0;
      const discount = product.prixReduit != null ? product.prixReduit : null;

      variants.push({
        colorId,
        colorName,
        colorNameEN,
        saleType,
        price,
        weight: product.poids || 0,
        stock: totalStock,
        sizes,
        discount,
      });

      colorDataList.push({
        efashionColorId: colorId,
        colorName,
        colorNameEN,
      });
    }

    if (variants.length === 0) {
      // Product has no colors — create a single default variant
      const totalStock = stocks.reduce((sum, s) => sum + s.value, 0);
      variants.push({
        colorId: 0,
        colorName: "Défaut",
        colorNameEN: "Default",
        saleType,
        price: parseFloat(String(product.prix)) || 0,
        weight: product.poids || 0,
        stock: totalStock,
        sizes: sizeNames.map((name) => ({ name, quantity: 0 })),
        discount: product.prixReduit != null ? product.prixReduit : null,
      });
    }

    // ── Build compositions ──
    const stagedCompositions: StagedComposition[] = compositions.map((c) => ({
      efashionId: c.id_composition,
      name: c.libelle,
      percentage: c.value,
    }));

    // ── Build translations ──
    const translations: StagedTranslation[] = [];
    if (description?.texte_fr) {
      translations.push({
        locale: "fr",
        name: description.texte_fr,
        description: description.texte_fr,
      });
    }
    if (description?.texte_uk) {
      translations.push({
        locale: "en",
        name: description.texte_uk,
        description: description.texte_uk,
      });
    }

    // ── Image URLs ──
    const imageUrls = photos.map((p) => efashionImageUrl(p));

    // ── Create staged product ──
    // Check if already staged (idempotent)
    const existingStaged = await prisma.efashionStagedProduct.findFirst({
      where: { prepareJobId, efashionProductId: efId },
      select: { id: true },
    });

    const stagedData = {
      reference: ref,
      name: item.marque ? `${item.marque} - ${ref}` : ref,
      description: description?.texte_fr || ref,
      categoryId: resolvedCategoryId,
      categoryName: resolvedCategoryName,
      isBestSeller: false,
      variants: variants as unknown as import("@prisma/client").Prisma.InputJsonValue,
      compositions: stagedCompositions as unknown as import("@prisma/client").Prisma.InputJsonValue,
      translations: translations as unknown as import("@prisma/client").Prisma.InputJsonValue,
      imageUrls: imageUrls as unknown as import("@prisma/client").Prisma.InputJsonValue,
      colorData: colorDataList as unknown as import("@prisma/client").Prisma.InputJsonValue,
      status: "READY" as const,
      errorMessage: null,
    };

    if (existingStaged) {
      await prisma.efashionStagedProduct.update({
        where: { id: existingStaged.id },
        data: stagedData,
      });
    } else {
      await prisma.efashionStagedProduct.create({
        data: {
          prepareJobId,
          efashionProductId: efId,
          ...stagedData,
        },
      });
    }

    addLog(`  ✅ ${ref} — stagé (${variants.length} variante(s), ${imageUrls.length} image(s))`);

    return { status: "ready", efashionProductId: efId, reference: ref };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addLog(`  ❌ ${ref} — Erreur: ${message}`);
    return { status: "error", efashionProductId: efId, reference: ref, error: message };
  }
}

// ---------------------------------------------------------------------------
// Main prepare orchestrator
// ---------------------------------------------------------------------------

export interface EfashionPrepareOptions {
  limit?: number;
}

export async function runEfashionPrepare(
  jobId: string,
  options?: EfashionPrepareOptions,
): Promise<void> {
  const maxProducts = options?.limit ?? 0;

  const prepareLogs: string[] = [];

  const ts = () =>
    new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const addLog = (msg: string) => {
    prepareLogs.push(`[${ts()}] ${msg}`);
    if (prepareLogs.length > MAX_LOGS) prepareLogs.shift();
  };

  const updateJob = async (data: Record<string, unknown>) => {
    await prisma.efashionPrepareJob.update({
      where: { id: jobId },
      data: { ...data, logs: { prepareLogs } },
    });
  };

  const checkStopped = async (): Promise<boolean> => {
    const current = await prisma.efashionPrepareJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return current?.status === "STOPPED";
  };

  try {
    await ensureEfashionAuth();
    addLog("Démarrage de la préparation eFashion...");
    await updateJob({ status: "RUNNING" });

    // 1. Load existing data for mapping resolution
    const [
      dbCategories,
      dbColors,
      efashionMappings,
      existingEfashionIds,
      existingStagedIds,
      packs,
      declinaisons,
    ] = await Promise.all([
      prisma.category.findMany({
        where: { efashionCategoryId: { not: null } },
        select: { id: true, name: true, efashionCategoryId: true },
      }),
      prisma.color.findMany({
        where: { efashionColorId: { not: null } },
        select: { id: true, name: true, efashionColorId: true },
      }),
      prisma.efashionMapping.findMany({
        select: { type: true, efashionName: true, efashionId: true, bjEntityId: true, bjName: true },
      }),
      prisma.product.findMany({
        where: { efashionProductId: { not: null } },
        select: { efashionProductId: true },
      }),
      prisma.efashionStagedProduct.findMany({
        where: { prepareJobId: jobId },
        select: { efashionProductId: true },
      }),
      efashionGetPacks(),
      efashionGetDeclinaisons(),
    ]);

    // Build lookup maps
    const dbCategoriesByEfId = new Map(
      dbCategories.map((c) => [c.efashionCategoryId!, { id: c.id, name: c.name }]),
    );
    const dbColorsByEfId = new Map(
      dbColors.map((c) => [c.efashionColorId!, { id: c.id, name: c.name }]),
    );

    const categoryMappings = new Map<number, { bjEntityId: string; bjName: string }>();
    const colorMappings = new Map<number, { bjEntityId: string; bjName: string }>();
    for (const m of efashionMappings) {
      if (m.type === "category" && m.efashionId) {
        categoryMappings.set(m.efashionId, { bjEntityId: m.bjEntityId, bjName: m.bjName });
      } else if (m.type === "color" && m.efashionId) {
        colorMappings.set(m.efashionId, { bjEntityId: m.bjEntityId, bjName: m.bjName });
      }
    }

    const existingProductIds = new Set(
      existingEfashionIds.map((p) => p.efashionProductId!),
    );
    const existingStagedProductIds = new Set(
      existingStagedIds.map((p) => p.efashionProductId),
    );

    const packsMap = new Map<number, EfashionPack>(
      packs.map((p) => [parseInt(p.id_pack), p]),
    );
    const declMap = new Map<number, EfashionDeclinaison>(
      declinaisons.map((d) => [parseInt(d.id_declinaison), d]),
    );

    addLog(
      `${dbCategories.length} catégories, ${dbColors.length} couleurs mappées. ${packs.length} packs, ${declinaisons.length} déclinaisons chargé(e)s.`,
    );
    await updateJob({});

    // 2. Paginate eFashion products (EN_VENTE)
    let skip = 0;
    let hasMore = true;
    let totalScanned = 0;
    let readyCount = 0;
    let errorCount = 0;

    while (hasMore) {
      if (maxProducts > 0 && readyCount >= maxProducts) break;
      if (await checkStopped()) {
        addLog("Arrêt demandé par l'administrateur");
        break;
      }

      try {
        const { items, total } = await efashionListProducts(skip, PAGE_SIZE, "EN_VENTE");

        if (skip === 0) {
          addLog(`${total} produits EN_VENTE sur eFashion`);
          await updateJob({ totalProducts: total });
        }

        if (items.length === 0) {
          hasMore = false;
          break;
        }

        // Filter: skip already existing in DB or already staged
        const newItems = items.filter((item) => {
          if (existingProductIds.has(item.id_produit)) return false;
          if (existingStagedProductIds.has(item.id_produit)) return false;
          return true;
        });

        totalScanned += items.length;

        if (newItems.length === 0) {
          addLog(`Skip ${skip} — ${totalScanned} scannés, aucun nouveau dans ce lot`);
          skip += PAGE_SIZE;
          hasMore = skip < total;
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        // Apply limit
        let toProcess = newItems;
        if (maxProducts > 0) {
          const remaining = maxProducts - readyCount;
          if (remaining <= 0) break;
          toProcess = newItems.slice(0, remaining);
        }

        // Process in batches
        for (let i = 0; i < toProcess.length; i += PREPARE_CONCURRENCY) {
          if (await checkStopped()) break;

          const batch = toProcess.slice(i, i + PREPARE_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map((item) =>
              prepareSingleProduct(
                item,
                jobId,
                packsMap,
                declMap,
                categoryMappings,
                colorMappings,
                dbCategoriesByEfId,
                dbColorsByEfId,
                addLog,
              ),
            ),
          );

          for (const r of results) {
            if (r.status === "rejected") {
              errorCount++;
            } else if (r.value.status === "ready") {
              readyCount++;
              // Track staged so we don't re-stage on next page
              existingStagedProductIds.add(r.value.efashionProductId);
            } else {
              errorCount++;
            }
          }

          await updateJob({
            processedProducts: readyCount + errorCount,
            readyProducts: readyCount,
            errorProducts: errorCount,
            lastSkip: skip,
          });

          // Gentle rate limiting between batches
          if (i + PREPARE_CONCURRENCY < toProcess.length) {
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        addLog(
          `Skip ${skip} — ${totalScanned} scannés, ${readyCount} prêts, ${errorCount} erreurs`,
        );

        skip += PAGE_SIZE;
        hasMore = skip < total;
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        addLog(
          `Erreur à skip=${skip}: ${err instanceof Error ? err.message : "Erreur"}`,
        );
        skip += PAGE_SIZE;
      }
    }

    // 3. Finalize
    const wasStopped = await checkStopped();

    // Count actual ready products from DB
    const finalReady = await prisma.efashionStagedProduct.count({
      where: { prepareJobId: jobId, status: "READY" },
    });

    if (wasStopped) {
      addLog(`Arrêté — ${finalReady} produits prêts pour validation`);
    } else {
      addLog(`Préparation terminée — ${finalReady} produits prêts pour validation`);
    }

    await prisma.efashionPrepareJob.update({
      where: { id: jobId },
      data: {
        status: wasStopped ? "STOPPED" : "COMPLETED",
        processedProducts: readyCount + errorCount,
        readyProducts: finalReady,
        errorProducts: errorCount,
        logs: { prepareLogs },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[eFashion Prepare] Fatal error", {
      error: err instanceof Error ? err.message : String(err),
    });
    addLog(`Erreur fatale: ${message}`);

    await prisma.efashionPrepareJob
      .update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: message,
          logs: { prepareLogs },
        },
      })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Approve a staged product -> create in DB
// ---------------------------------------------------------------------------

export async function approveEfashionStagedProduct(
  stagedId: string,
): Promise<{ productId: string }> {
  const staged = await prisma.efashionStagedProduct.findUnique({
    where: { id: stagedId },
  });
  if (!staged) throw new Error("Produit stagé non trouvé");
  if (staged.status !== "READY") {
    throw new Error(`Statut invalide: ${staged.status}`);
  }

  const variants = staged.variants as unknown as StagedVariant[];
  const compositions = staged.compositions as unknown as StagedComposition[];
  const translations = staged.translations as unknown as StagedTranslation[];
  const imageUrls = staged.imageUrls as unknown as string[];
  const colorDataList = staged.colorData as unknown as StagedColorData[];

  // ── Resolve local category from eFashion category ID ──
  const efCatId = staged.categoryId; // This is eFashion's category ID (Int)

  // Try: Category.efashionCategoryId, then EfashionMapping
  let localCategoryId: string | null = null;

  const dbCat = await prisma.category.findFirst({
    where: { efashionCategoryId: efCatId },
    select: { id: true },
  });
  if (dbCat) {
    localCategoryId = dbCat.id;
  } else {
    const mapping = await prisma.efashionMapping.findFirst({
      where: { type: "category", efashionId: efCatId },
      select: { bjEntityId: true },
    });
    if (mapping) {
      localCategoryId = mapping.bjEntityId;
    }
  }

  if (!localCategoryId) {
    throw new Error(
      `Catégorie eFashion ${efCatId} (${staged.categoryName}) non mappée. Configurez le mapping dans /admin/efashion/mapping.`,
    );
  }

  // ── Resolve local colors from eFashion color IDs ──
  // Build a map: efashionColorId -> local colorId
  const colorIdMap = new Map<number, string>();

  for (const cd of colorDataList) {
    // Try Color.efashionColorId first
    const dbColor = await prisma.color.findFirst({
      where: { efashionColorId: cd.efashionColorId },
      select: { id: true },
    });
    if (dbColor) {
      colorIdMap.set(cd.efashionColorId, dbColor.id);
      continue;
    }

    // Try EfashionMapping
    const mapping = await prisma.efashionMapping.findFirst({
      where: { type: "color", efashionId: cd.efashionColorId },
      select: { bjEntityId: true },
    });
    if (mapping) {
      colorIdMap.set(cd.efashionColorId, mapping.bjEntityId);
      continue;
    }

    // Try matching by name (MySQL is case-insensitive by default with utf8mb4 collation)
    const byName = await prisma.color.findFirst({
      where: { name: cd.colorName },
      select: { id: true },
    });
    if (byName) {
      colorIdMap.set(cd.efashionColorId, byName.id);
      continue;
    }

    // Create color if not found
    const newColor = await prisma.color.create({
      data: {
        name: cd.colorName,
        efashionColorId: cd.efashionColorId,
      },
    });
    colorIdMap.set(cd.efashionColorId, newColor.id);

    logger.info(`[eFashion Approve] Created color "${cd.colorName}" (efashionId=${cd.efashionColorId})`);
  }

  // ── Resolve compositions ──
  const compositionIds: { compositionId: string; percentage: number | null }[] = [];

  for (const comp of compositions) {
    // Try by name match
    // MySQL is case-insensitive by default with utf8mb4 collation
    let dbComp = await prisma.composition.findFirst({
      where: { name: comp.name },
      select: { id: true },
    });

    if (!dbComp) {
      // Try EfashionMapping
      const mapping = await prisma.efashionMapping.findFirst({
        where: { type: "composition", efashionId: comp.efashionId },
        select: { bjEntityId: true },
      });
      if (mapping) {
        dbComp = { id: mapping.bjEntityId };
      }
    }

    if (!dbComp) {
      // Create composition
      dbComp = await prisma.composition.create({
        data: { name: comp.name },
      });
      logger.info(`[eFashion Approve] Created composition "${comp.name}"`);
    }

    compositionIds.push({
      compositionId: dbComp.id,
      percentage: comp.percentage,
    });
  }

  // ── Download & process images ──
  const processedImages: Array<{
    dbPath: string;
    colorIndex: number; // index into colorDataList to match variant
  }> = [];

  let imgExpected = 0;
  let imgDownloaded = 0;

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    if (!url) continue;

    imgExpected++;

    try {
      // SSRF protection: only allow eFashion domain
      const urlObj = new URL(url);
      if (!urlObj.hostname.endsWith("efashion-paris.com")) {
        logger.warn("[eFashion Approve] Blocked download from unauthorized domain", {
          hostname: urlObj.hostname,
        });
        continue;
      }

      const buffer = await downloadImage(url);
      const filename = `ef_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const result = await processProductImage(buffer, "public/uploads/products", filename);

      // Map image to color: eFashion photos API returns images in order,
      // generally one primary image per product. Associate all images with
      // the first color variant (eFashion doesn't provide per-color image mapping).
      processedImages.push({
        dbPath: result.dbPath,
        colorIndex: 0, // Default: assign to first variant
      });

      imgDownloaded++;
    } catch (err) {
      logger.warn(`[eFashion Approve] Failed to download image: ${url}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Create Product in DB ──
  const firstVariant = variants[0];
  const saleType = firstVariant?.saleType || "UNIT";

  const product = await prisma.product.create({
    data: {
      reference: staged.reference,
      efashionProductId: staged.efashionProductId,
      efashionSyncStatus: "synced",
      efashionSyncedAt: new Date(),
      name: staged.name,
      description: staged.description,
      categoryId: localCategoryId,
      isBestSeller: staged.isBestSeller,
      manufacturingCountryId: staged.manufacturingCountryId || null,
      status: "OFFLINE", // Admin publishes manually
    },
  });

  // ── Create ProductColor variants ──
  const createdVariants: Array<{
    id: string;
    colorId: string | null;
    efashionColorId: number;
  }> = [];

  for (let vIdx = 0; vIdx < variants.length; vIdx++) {
    const v = variants[vIdx];
    const localColorId = v.colorId === 0 ? null : (colorIdMap.get(v.colorId) || null);

    const created = await prisma.productColor.create({
      data: {
        productId: product.id,
        colorId: localColorId,
        unitPrice: v.price,
        weight: v.weight,
        stock: v.stock,
        isPrimary: vIdx === 0,
        saleType: v.saleType,
        packQuantity: v.saleType === "PACK" ? (v.sizes.reduce((sum, s) => sum + s.quantity, 0) || 1) : null,
        efashionColorId: v.colorId === 0 ? null : v.colorId,
      },
      select: { id: true, colorId: true },
    });

    createdVariants.push({
      ...created,
      efashionColorId: v.colorId,
    });

    // Create VariantSize records
    for (const size of v.sizes) {
      if (!size.name) continue;

      const sizeRecord = await prisma.size
        .upsert({
          where: { name: size.name },
          create: { name: size.name },
          update: {},
        })
        .catch(() => prisma.size.findFirstOrThrow({ where: { name: size.name } }));

      // Link size to category
      await prisma.sizeCategoryLink.createMany({
        data: [{ sizeId: sizeRecord.id, categoryId: localCategoryId }],
        skipDuplicates: true,
      });

      await prisma.variantSize.create({
        data: {
          productColorId: created.id,
          sizeId: sizeRecord.id,
          quantity: size.quantity,
        },
      });
    }
  }

  // ── Create ProductColorImage records ──
  if (processedImages.length > 0 && createdVariants.length > 0) {
    // Assign all images to the first variant (eFashion doesn't have per-color images)
    const firstCreated = createdVariants[0];

    await prisma.productColorImage.createMany({
      data: processedImages.map((img, idx) => ({
        productId: product.id,
        colorId: firstCreated.colorId ?? "",
        productColorId: firstCreated.id,
        path: img.dbPath,
        order: idx,
      })),
    });
  }

  // Handle partial/no images
  if (imgExpected > 0 && imgDownloaded === 0) {
    // No images at all — delete and error
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.efashionStagedProduct.update({
      where: { id: stagedId },
      data: {
        status: "ERROR",
        errorMessage: `Aucune image téléchargée (0/${imgExpected})`,
      },
    });
    throw new Error(
      `Aucune image téléchargée pour ${staged.reference} (0/${imgExpected}). Réessayez plus tard.`,
    );
  } else if (imgExpected > 0 && imgDownloaded < imgExpected) {
    logger.warn(
      `[eFashion Approve] ${staged.reference} — partial images: ${imgDownloaded}/${imgExpected}`,
    );
  }

  // ── Create compositions ──
  if (compositionIds.length > 0) {
    await prisma.productComposition.createMany({
      data: compositionIds.map((c) => ({
        productId: product.id,
        compositionId: c.compositionId,
        percentage: c.percentage ?? 0,
      })),
      skipDuplicates: true,
    });
  }

  // ── Create translations ──
  if (translations.length > 0) {
    await prisma.productTranslation.createMany({
      data: translations.map((t) => ({
        productId: product.id,
        locale: t.locale,
        name: t.name,
        description: t.description,
      })),
      skipDuplicates: true,
    });
  }

  // ── Update staged product ──
  await prisma.efashionStagedProduct.update({
    where: { id: stagedId },
    data: {
      status: "APPROVED",
      createdProductId: product.id,
      errorMessage: null,
    },
  });

  // ── Update job counter ──
  await prisma.efashionPrepareJob.update({
    where: { id: staged.prepareJobId },
    data: { approvedProducts: { increment: 1 } },
  });

  // ── Invalidate caches ──
  revalidateTag("products", "default");
  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${product.id}/modifier`);
  revalidatePath(`/produits/${product.id}`);

  return { productId: product.id };
}

// ---------------------------------------------------------------------------
// Reject a staged product
// ---------------------------------------------------------------------------

export async function rejectEfashionStagedProduct(
  stagedId: string,
): Promise<void> {
  const staged = await prisma.efashionStagedProduct.findUnique({
    where: { id: stagedId },
  });
  if (!staged) throw new Error("Produit stagé non trouvé");
  if (staged.status !== "READY") {
    throw new Error(`Statut invalide: ${staged.status}`);
  }

  await prisma.efashionStagedProduct.update({
    where: { id: stagedId },
    data: { status: "REJECTED" },
  });

  await prisma.efashionPrepareJob.update({
    where: { id: staged.prepareJobId },
    data: { rejectedProducts: { increment: 1 } },
  });
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

export async function bulkApproveEfashionStagedProducts(
  ids: string[],
): Promise<{ results: { id: string; productId?: string; error?: string }[] }> {
  const results: { id: string; productId?: string; error?: string }[] = [];

  for (let i = 0; i < ids.length; i += BULK_CONCURRENCY) {
    const batch = ids.slice(i, i + BULK_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (id) => {
        const { productId } = await approveEfashionStagedProduct(id);
        return { id, productId };
      }),
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        const failedId = batch[batchResults.indexOf(r)];
        results.push({
          id: failedId,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }

  return { results };
}

export async function bulkRejectEfashionStagedProducts(
  ids: string[],
): Promise<{ results: { id: string; error?: string }[] }> {
  const results: { id: string; error?: string }[] = [];

  for (const id of ids) {
    try {
      await rejectEfashionStagedProduct(id);
      results.push({ id });
    } catch (err) {
      results.push({
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { results };
}
