/**
 * PFS Prepare Processor
 *
 * Prepares PFS products for review before creating them in the BJ database.
 * Stores PFS image URLs for preview, downloads images only on approval.
 *
 * Flow: Prepare (URLs) → Review (edit) → Approve (download + create in DB) / Reject (discard)
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { revalidatePath, revalidateTag } from "next/cache";
import {
  pfsListProducts,
  type PfsProduct,
  type PfsVariantDetail,
} from "@/lib/pfs-api";
import { processProductImage } from "@/lib/image-processor";
import { stripDimensionsSuffix } from "@/lib/pfs-reverse-sync";
import {
  stripVersionSuffix,
  fullSizeImageUrl,
  extractColorImages,
  detectDefaultColorRef,
  parsePfsCategoryRef,
  findOrCreateColor,
  findOrCreateCategory,
  findOrCreateComposition,
  findOrCreateCountry,
  findOrCreateSeason,
  fetchProductDetails,
  downloadImage,
  closePlaywright,
  PAGE_CONCURRENCY,
  IMAGE_CONCURRENCY,
  MAX_LOGS,
} from "@/lib/pfs-sync";
import { autoTranslateProduct } from "@/lib/auto-translate";

// Lower concurrency for prepare to avoid PFS API rate-limiting
// Each product makes 2 API calls (getVariants + checkReference) so 5 products = 10 concurrent API calls
const PREPARE_CONCURRENCY = 5;

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface StagedSubColor {
  colorId: string;
  colorName: string;
  hex: string | null;
  patternImage: string | null;
}

export interface StagedPackColorLine {
  colors: { colorId: string; colorRef: string; colorName: string }[];
}

export interface StagedVariantData {
  colorId: string;
  colorRef: string;
  colorName: string;
  subColors?: StagedSubColor[];
  packColorLines?: StagedPackColorLine[];
  unitPrice: number;
  weight: number;
  stock: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizeName: string | null;
  sizeNames?: string[]; // All sizes for PACK variants (multiple sizes)
  sizeEntries?: { name: string; qty: number; pricePerUnit: number }[]; // Sizes with qty + price
  isPrimary: boolean;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}

export interface StagedComposition {
  compositionId: string;
  name: string;
  percentage: number;
}

export interface StagedTranslation {
  locale: string;
  name: string;
  description: string;
}

export interface StagedImageGroup {
  colorRef: string;
  colorName: string;
  colorId: string;
  colorHex?: string | null;
  paths: string[]; // PFS CDN URLs (downloaded only on approval)
  orders?: number[]; // optional: explicit order for each path (same length as paths)
}

// ─────────────────────────────────────────────
// Prepare single product (no DB product creation)
// ─────────────────────────────────────────────

interface PrepareResult {
  status: "ready" | "error";
  reference: string;
  stagedId?: string;
  error?: string;
  /** Image task to run in background after data is staged */
  imageTask?: () => Promise<void>;
}

async function prepareSingleProduct(
  pfsProduct: PfsProduct,
  prepareJobId: string,
  addLog: (msg: string) => void,
): Promise<PrepareResult> {
  const pfsRef = pfsProduct.reference.trim().toUpperCase();
  const bjRef = stripVersionSuffix(pfsRef);

  try {
    addLog(`▶ ${bjRef} — "${pfsProduct.labels?.fr || "?"}" — préparation...`);

    // Skip products that already exist in DB by reference
    const existingProduct = await prisma.product.findFirst({
      where: { reference: bjRef },
      select: { id: true },
    });
    if (existingProduct) {
      addLog(`  ⏭ ${bjRef} — existe déjà en BDD, ignoré`);
      return { status: "error" as const, reference: bjRef, error: "Produit déjà existant" };
    }

    // Fetch details
    const { variantDetails, refDetails } = await fetchProductDetails(pfsProduct);

    // ── Resolve category ──
    const categoryFr = pfsProduct.category?.labels?.fr;
    if (!categoryFr) {
      addLog(`  ✗ ${bjRef} — Catégorie FR manquante`);
      return { status: "error", reference: bjRef, error: "Catégorie FR manquante" };
    }

    let categoryName = categoryFr;
    if (refDetails?.product?.category?.reference) {
      categoryName = parsePfsCategoryRef(refDetails.product.category.reference);
    }

    const pfsCatId = refDetails?.product?.category?.id || pfsProduct.category?.id || undefined;
    const categoryId = await findOrCreateCategory(categoryName, pfsProduct.category.labels, categoryFr, pfsCatId);
    if (!categoryId) {
      addLog(`  ❌ ${bjRef} — Catégorie non liée: "${categoryName}". Liez-la dans /admin/pfs/mapping avant de synchroniser.`);
      return { status: "error", reference: bjRef, error: `Catégorie non liée: ${categoryName}` };
    }
    addLog(`  📂 Catégorie: ${categoryName}`);

    // ── Resolve compositions ──
    const compositions: StagedComposition[] = [];
    if (refDetails?.product?.material_composition) {
      for (const mat of refDetails.product.material_composition) {
        const frName = mat.labels?.fr || mat.reference;
        const compositionId = await findOrCreateComposition(frName, mat.labels, mat.reference);
        if (!compositionId) {
          addLog(`  ⚠️ Composition non liée: "${frName}" — ignorée`);
          continue;
        }
        compositions.push({ compositionId, name: frName, percentage: mat.percentage });
      }
    }

    // ── Resolve country ──
    let manufacturingCountryId: string | null = null;
    let manufacturingCountryName: string | null = null;
    if (refDetails?.product?.country_of_manufacture) {
      const isoCode = refDetails.product.country_of_manufacture;
      manufacturingCountryId = await findOrCreateCountry(isoCode) || null;
      manufacturingCountryName = isoCode;
      addLog(`  🌍 Pays: ${isoCode}`);
    }

    // ── Resolve season ──
    let seasonId: string | null = null;
    let seasonName: string | null = null;
    if (refDetails?.product?.collection) {
      const col = refDetails.product.collection;
      seasonId = await findOrCreateSeason(col.reference, col.labels || {}) || null;
      seasonName = col.labels?.fr || col.reference;
      addLog(`  📅 Saison: ${seasonName}`);
    }

    // ── Build variant data ──
    const variantMap = new Map<string, (typeof variantDetails)[0]>();
    for (const v of variantDetails) {
      variantMap.set(v.id, v);
    }

    // Import ALL variants (including disabled ones — they get stock=0)
    const allVariants = variantDetails.length > 0 ? variantDetails : pfsProduct.variants;

    if (allVariants.length === 0) {
      addLog(`  ⏭ ${bjRef} — Aucune variante, skip`);
      return { status: "error", reference: bjRef, error: "Aucune variante" };
    }

    // Detect default color
    const allImages = pfsProduct.images;
    const defaultColorRef = detectDefaultColorRef(
      allImages,
      refDetails?.product?.default_color,
    );

    const variants: StagedVariantData[] = [];

    let inactiveCount = 0;
    for (const v of allVariants) {
      if (!v.is_active) inactiveCount++;
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

        const sizeName = v.item?.size || (v as PfsVariantDetail).size_details_tu || null;

        variants.push({
          colorId,
          colorRef: itemColor.reference,
          colorName: itemColor.labels?.fr || itemColor.reference,
          unitPrice: bjPrice,
          weight,
          stock: v.is_active ? v.stock_qty : 0,
          saleType: "UNIT",
          packQuantity: null,
          sizeName,
          isPrimary: false,
          discountType,
          discountValue,
        });
      } else if (v.type === "PACK" && v.packs && v.packs.length > 0) {
        // Use first pack for main color (required for ProductColor.colorId)
        const firstPack = v.packs[0];
        const mainColorId = await findOrCreateColor(
          firstPack.color.reference,
          firstPack.color.value,
          firstPack.color.labels,
        );
        if (!mainColorId) {
          addLog(`  ⚠️ Couleur non liée: "${firstPack.color.labels?.fr || firstPack.color.reference}" — variante PACK ignorée`);
          continue;
        }

        // Collect ALL pack colors into a single PackColorLine composition
        const lineColors: StagedPackColorLine["colors"] = [];
        for (const pack of v.packs) {
          const packColorId = await findOrCreateColor(
            pack.color.reference,
            pack.color.value,
            pack.color.labels,
          );
          if (packColorId && !lineColors.some((c) => c.colorId === packColorId)) {
            lineColors.push({
              colorId: packColorId,
              colorRef: pack.color.reference,
              colorName: pack.color.labels?.fr || pack.color.reference,
            });
          }
        }
        const packColorLines: StagedPackColorLine[] = lineColors.length > 0
          ? [{ colors: lineColors }]
          : [];

        const packQty = detail?.pieces ?? firstPack.sizes?.[0]?.qty ?? v.pieces ?? 1;
        const pfsPrice = v.price_sale.unit.value;
        const bjPrice = pfsPrice;

        let discountType: "PERCENT" | "AMOUNT" | null = null;
        let discountValue: number | null = null;
        if (v.discount) {
          discountType = v.discount.type === "PERCENT" ? "PERCENT" : "AMOUNT";
          discountValue = v.discount.value;
        }

        // Collect ALL sizes with quantities from ALL packs
        const sizeQtyMap = new Map<string, number>();
        for (const pack of v.packs) {
          if (pack.sizes) {
            for (const s of pack.sizes) {
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
          colorId: mainColorId,
          colorRef: firstPack.color.reference,
          colorName: firstPack.color.labels?.fr || firstPack.color.reference,
          packColorLines,
          unitPrice: totalItems > 0 ? bjPrice * totalItems : bjPrice,
          weight,
          stock: v.is_active ? v.stock_qty : 0,
          saleType: "PACK",
          packQuantity: packQty,
          sizeName: sizeNames[0] || null,
          sizeNames,
          sizeEntries,
          isPrimary: false,
          discountType,
          discountValue,
        });
      }
    }

    if (inactiveCount > 0) {
      addLog(`  ⚠️ ${inactiveCount} variante(s) désactivée(s) importée(s) avec stock=0`);
    }

    // ── Deduplicate variants by colorId + saleType ──
    // PFS can return multiple variants for the same color+type (e.g. same UNIT color twice).
    // Keep all distinct saleTypes per color (both UNIT and PACK are valid).
    const seenKeys = new Set<string>();
    const deduplicatedVariants: StagedVariantData[] = [];
    for (const v of variants) {
      const key = `${v.colorId}:${v.saleType}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deduplicatedVariants.push(v);
      }
    }
    if (deduplicatedVariants.length < variants.length) {
      addLog(`  🔄 ${variants.length - deduplicatedVariants.length} variante(s) en double ignorée(s)`);
    }
    variants.length = 0;
    variants.push(...deduplicatedVariants);

    // Set isPrimary
    if (defaultColorRef && variants.length > 0) {
      const primaryIdx = variants.findIndex((v) => v.colorRef === defaultColorRef);
      if (primaryIdx >= 0) variants[primaryIdx].isPrimary = true;
      else variants[0].isPrimary = true;
    } else if (variants.length > 0) {
      variants[0].isPrimary = true;
    }

    if (variants.length === 0) {
      return { status: "error", reference: bjRef, error: "Aucune variante valide" };
    }

    // ── Product name/description (strip dimensions suffix added by reverse sync) ──
    const nameFr = pfsProduct.labels?.fr || bjRef;
    const rawDescFr = refDetails?.product?.description?.fr || nameFr;
    const descriptionFr = stripDimensionsSuffix(rawDescFr);

    // ── Translations (strip dimensions) ──
    const translations: StagedTranslation[] = [];
    for (const locale of ["en", "de", "es", "it"]) {
      const name = pfsProduct.labels?.[locale];
      const rawDesc = refDetails?.product?.description?.[locale] || name;
      const desc = rawDesc ? stripDimensionsSuffix(rawDesc) : name;
      if (name) {
        translations.push({ locale, name, description: desc || name });
      }
    }

    // ── Create PfsStagedProduct (status: PREPARING) ──
    const staged = await prisma.pfsStagedProduct.upsert({
      where: {
        pfsProductId_prepareJobId: {
          pfsProductId: pfsProduct.id,
          prepareJobId,
        },
      },
      update: {
        reference: bjRef,
        pfsReference: pfsRef,
        name: nameFr,
        description: descriptionFr,
        categoryId,
        categoryName,
        manufacturingCountryId,
        manufacturingCountryName,
        seasonId,
        seasonName,
        isBestSeller: pfsProduct.is_star === 1,
        variants: variants as unknown as import("@prisma/client").Prisma.InputJsonValue,
        compositions: compositions as unknown as import("@prisma/client").Prisma.InputJsonValue,
        translations: translations as unknown as import("@prisma/client").Prisma.InputJsonValue,
        imagesByColor: [] as unknown as import("@prisma/client").Prisma.InputJsonValue,
        pfsProductStatus: pfsProduct.status || null,
        status: "PREPARING",
        errorMessage: null,
      },
      create: {
        prepareJobId,
        pfsProductId: pfsProduct.id,
        reference: bjRef,
        pfsReference: pfsRef,
        name: nameFr,
        description: descriptionFr,
        categoryId,
        categoryName,
        manufacturingCountryId,
        manufacturingCountryName,
        seasonId,
        seasonName,
        isBestSeller: pfsProduct.is_star === 1,
        variants: variants as unknown as import("@prisma/client").Prisma.InputJsonValue,
        compositions: compositions as unknown as import("@prisma/client").Prisma.InputJsonValue,
        translations: translations as unknown as import("@prisma/client").Prisma.InputJsonValue,
        imagesByColor: [] as unknown as import("@prisma/client").Prisma.InputJsonValue,
        pfsProductStatus: pfsProduct.status || null,
        status: "PREPARING",
      },
    });

    addLog(`  ✅ ${bjRef} données préparées — résolution des URLs images`);

    // ── Build image task (stores PFS URLs only, no download) ──
    const imageTask = async () => {
      try {
        const colorImages = extractColorImages(pfsProduct.images);
        const imageGroups: StagedImageGroup[] = [];

        for (const [colorRef, urls] of colorImages) {
          // Store raw PFS CDN URLs (max 5 per color) — no download at this stage
          const pfsUrls = urls.slice(0, 5).map(fullSizeImageUrl);

          // Find color name from variants (case-insensitive — PFS API may use
          // different casing for image keys vs variant color references)
          const matchingVariant = variants.find((v) => v.colorRef === colorRef)
            ?? variants.find((v) => v.colorRef.toLowerCase() === colorRef.toLowerCase());
          const colorName = matchingVariant?.colorName || colorRef;
          // Use colorRef as fallback (not "") so orphan groups remain uniquely identifiable
          const colorId = matchingVariant?.colorId || colorRef;

          if (pfsUrls.length > 0) {
            imageGroups.push({ colorRef, colorName, colorId, paths: pfsUrls });
          }
        }

        // Update staged product with PFS URLs + set READY
        await prisma.pfsStagedProduct.update({
          where: { id: staged.id },
          data: {
            imagesByColor: imageGroups as unknown as import("@prisma/client").Prisma.InputJsonValue,
            status: "READY",
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.pfsStagedProduct.update({
          where: { id: staged.id },
          data: { status: "ERROR", errorMessage: `Images: ${msg}` },
        }).catch(() => {});
      }
    };

    return { status: "ready", reference: bjRef, stagedId: staged.id, imageTask };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addLog(`  ❌ ${bjRef} — Erreur: ${message}`);
    return { status: "error", reference: bjRef, error: message };
  }
}

// ─────────────────────────────────────────────
// Main prepare orchestrator
// ─────────────────────────────────────────────

export interface PfsPrepareOptions {
  limit?: number;
}

export async function runPfsPrepare(
  jobId: string,
  options?: PfsPrepareOptions,
): Promise<void> {
  const maxProducts = options?.limit ?? 0;

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

  // Background image pool
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

  // Check if job was stopped by admin
  const checkStopped = async (): Promise<boolean> => {
    const current = await prisma.pfsPrepareJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return current?.status === "STOPPED";
  };

  try {
    addProductLog("🚀 Démarrage de la préparation PFS...");
    addImageLog("🖼 File d'attente images prête (max " + IMAGE_CONCURRENCY + " en parallèle)");

    await prisma.pfsPrepareJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", logs: buildLogsPayload() },
    });

    const job = await prisma.pfsPrepareJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error("Prepare job not found");

    const startPage = job.lastPage + 1;
    let page = startPage;
    let lastPage = Infinity;

    let ready = job.readyProducts;
    let errored = job.errorProducts;
    let processed = job.processedProducts;

    while (page <= lastPage) {
      if (maxProducts > 0 && ready >= maxProducts) break;

      // Check if admin stopped the job
      if (await checkStopped()) {
        addProductLog("⏹ Arrêt demandé par l'administrateur");
        break;
      }

      // Fetch pages in parallel
      const batchEndPage = Math.min(page + PAGE_CONCURRENCY - 1, lastPage);
      const pageNumbers: number[] = [];
      for (let p = page; p <= batchEndPage; p++) pageNumbers.push(p);

      addProductLog(`📄 Chargement pages ${page}-${batchEndPage}${lastPage < Infinity ? `/${lastPage}` : ""} en parallèle...`);

      const pageResults = await Promise.allSettled(
        pageNumbers.map((p) => pfsListProducts(p, 100)),
      );

      let allPageProducts: PfsProduct[] = [];
      let highestSuccessPage = page - 1;

      for (let i = 0; i < pageResults.length; i++) {
        const result = pageResults[i];
        if (result.status === "rejected") {
          addProductLog(`  ⚠️ Page ${pageNumbers[i]} échouée`);
          continue;
        }

        const response = result.value;
        if (response.meta?.last_page) lastPage = response.meta.last_page;

        if (page === startPage && i === 0 && response.state?.active) {
          // Use totalNewProducts from analyze phase if available, otherwise fall back to PFS count
          const analyzeResult = (job as Record<string, unknown>).analyzeResult as { totalNewProducts?: number } | null;
          const newFromAnalyze = analyzeResult?.totalNewProducts;
          const total = newFromAnalyze != null
            ? (maxProducts > 0 ? Math.min(newFromAnalyze, maxProducts) : newFromAnalyze)
            : (maxProducts > 0 ? Math.min(response.state.active, maxProducts) : response.state.active);
          addProductLog(`📊 Total produits actifs PFS: ${response.state.active}, nouveaux à importer: ~${newFromAnalyze ?? "?"}${maxProducts > 0 ? ` (limité à ${maxProducts})` : ""}`);
          await prisma.pfsPrepareJob.update({
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
        addProductLog(`📄 Pages ${page}-${batchEndPage} vides — fin`);
        break;
      }

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

      // ── Filter out products that already exist in DB or are already staged ──
      {
        const refs = allPageProducts.map((p) => stripVersionSuffix(p.reference.trim().toUpperCase()));
        const [existingProducts, existingStaged] = await Promise.all([
          prisma.product.findMany({
            where: { reference: { in: refs } },
            select: { reference: true },
          }),
          prisma.pfsStagedProduct.findMany({
            where: { prepareJobId: jobId, reference: { in: refs } },
            select: { reference: true },
          }),
        ]);
        const existingRefSet = new Set([
          ...existingProducts.map((p) => p.reference),
          ...existingStaged.map((p) => p.reference),
        ]);
        const beforeFilter = allPageProducts.length;
        allPageProducts = allPageProducts.filter((p) => {
          const bjRef = stripVersionSuffix(p.reference.trim().toUpperCase());
          return !existingRefSet.has(bjRef);
        });
        const skipped = beforeFilter - allPageProducts.length;
        if (skipped > 0) {
          addProductLog(`⏭ ${skipped} produit(s) déjà existant(s) ou stagé(s) ignoré(s)`);
        }
      }

      // Apply limit (based on actual new products processed, not total scanned)
      if (maxProducts > 0) {
        const remaining = maxProducts - ready;
        if (remaining <= 0) break;
        allPageProducts = allPageProducts.slice(0, remaining);
      }

      // Process in batches (lower concurrency to avoid PFS rate-limiting)
      for (let i = 0; i < allPageProducts.length; i += PREPARE_CONCURRENCY) {
        const batch = allPageProducts.slice(i, i + PREPARE_CONCURRENCY);

        const results = await Promise.allSettled(
          batch.map((p) => prepareSingleProduct(p, jobId, addProductLog)),
        );

        for (let j = 0; j < results.length; j++) {
          processed++;
          const r = results[j];
          if (r.status === "rejected") {
            errored++;
            addProductLog(`  ❌ ${batch[j].reference} — Erreur fatale`);
            continue;
          }
          const result = r.value;
          if (result.status === "ready") {
            ready++;
            // Enqueue image task
            if (result.imageTask) {
              const ref = result.reference;
              addImageLog(`📥 ${ref} — ajouté à la file d'attente`);
              enqueueImageTask(async () => {
                addImageLog(`⬇️ ${ref} — résolution URLs en cours...`);
                try {
                  await result.imageTask!();
                  addImageLog(`✅ ${ref} — URLs images prêtes (téléchargement à l'approbation)`);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  addImageLog(`❌ ${ref} — erreur: ${msg}`);
                }
              });
            }
          } else {
            errored++;
          }
        }

        // Update progress
        await prisma.pfsPrepareJob.update({
          where: { id: jobId },
          data: {
            processedProducts: processed,
            readyProducts: ready,
            errorProducts: errored,
            lastPage: highestSuccessPage,
            logs: buildLogsPayload(),
          },
        });

        if (i + PREPARE_CONCURRENCY < allPageProducts.length) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }

      page = batchEndPage + 1;
      await new Promise((r) => setTimeout(r, 200));
    }

    // Check if stopped
    const wasStopped = await checkStopped();

    // Wait for remaining image tasks (or drain them if stopped)
    if (wasStopped) {
      addProductLog(`⏹ Arrêt — ${processed} traités (✅${ready} ❌${errored})`);
      // Clear pending image tasks
      pendingImageTasks.length = 0;
      addImageLog(`⏹ File d'attente images vidée (arrêt demandé)`);
    } else {
      addProductLog(`🏁 Produits terminés — ${processed} traités (✅${ready} ❌${errored})`);
      const remaining = activeImageTasks + pendingImageTasks.length;
      if (remaining > 0) {
        addImageLog(`⏳ ${remaining} image(s) restante(s)...`);
      }
    }

    imagePoolDrained = true;
    tryDrainImagePool();
    await imagePoolDone;

    if (!wasStopped) {
      addImageLog(`🏁 Images terminées — ${completedImageTasks} OK${failedImageTasks > 0 ? `, ${failedImageTasks} échouées` : ""}`);
    }
    await closePlaywright();

    // Count actual ready products from DB
    const finalReady = await prisma.pfsStagedProduct.count({
      where: { prepareJobId: jobId, status: "READY" },
    });

    if (wasStopped) {
      addProductLog(`⏹ Importation arrêtée — ${finalReady} produits prêts pour validation`);
    } else {
      addProductLog(`🏁 Préparation terminée — ${finalReady} produits prêts pour validation`);
    }

    await prisma.pfsPrepareJob.update({
      where: { id: jobId },
      data: {
        status: wasStopped ? "STOPPED" : "COMPLETED",
        processedProducts: processed,
        readyProducts: finalReady,
        errorProducts: errored,
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

    await prisma.pfsPrepareJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: message,
        logs: buildLogsPayload(),
      },
    }).catch(() => {});
  }
}

// ─────────────────────────────────────────────
// Approve a staged product → create in DB
// ─────────────────────────────────────────────

export async function approveStagedProduct(stagedId: string): Promise<{ productId: string }> {
  const stagedRaw = await prisma.pfsStagedProduct.findUnique({ where: { id: stagedId } });
  if (!stagedRaw) throw new Error("Produit staged non trouvé");
  if (stagedRaw.status !== "READY") throw new Error(`Statut invalide: ${stagedRaw.status}`);
  // Mutable copy — categoryId may be re-resolved if deleted between prepare and approve
  const staged = { ...stagedRaw };

  const variants = staged.variants as unknown as StagedVariantData[];
  const compositions = staged.compositions as unknown as StagedComposition[];
  const translations = staged.translations as unknown as StagedTranslation[];
  const imageGroups = staged.imagesByColor as unknown as StagedImageGroup[];
  const tagNames = (staged.tags as unknown as string[]) ?? [];

  // Determine BJ status based on PFS product status
  const bjStatus = staged.pfsProductStatus === "READY_FOR_SALE" ? "ONLINE" : "OFFLINE";

  // Verify category still exists (it may have been deleted between prepare and approve)
  const categoryExists = await prisma.category.findUnique({
    where: { id: staged.categoryId },
    select: { id: true },
  });
  if (!categoryExists) {
    // Re-resolve from the stored category name
    const resolvedCategoryId = await findOrCreateCategory(staged.categoryName);
    if (!resolvedCategoryId) {
      throw new Error(`Catégorie non liée: ${staged.categoryName}`);
    }
    await prisma.pfsStagedProduct.update({
      where: { id: stagedId },
      data: { categoryId: resolvedCategoryId },
    });
    staged.categoryId = resolvedCategoryId;
  }

  // Verify all variant colors still exist (may have been deleted/recreated between prepare and approve)
  const variantColorIds = [...new Set(variants.map((v) => v.colorId))];
  const existingColorRows = await prisma.color.findMany({
    where: { id: { in: variantColorIds } },
    select: { id: true },
  });
  const existingColorIdSet = new Set(existingColorRows.map((c) => c.id));
  const hasMissingColors = variantColorIds.some((id) => !existingColorIdSet.has(id));
  if (hasMissingColors) {
    let updated = false;
    for (const v of variants) {
      if (!existingColorIdSet.has(v.colorId)) {
        // Re-resolve color from name/reference via PfsMapping or DB lookup
        const resolvedId = await findOrCreateColor(v.colorRef, "", { fr: v.colorName });
        if (resolvedId) {
          v.colorId = resolvedId;
          updated = true;
        } else {
          throw new Error(`Couleur non liée: "${v.colorName}" (${v.colorRef}). Liez-la dans /admin/pfs/mapping.`);
        }
      }
    }
    // Also re-resolve colors in imageGroups
    for (const g of imageGroups) {
      if (!existingColorIdSet.has(g.colorId)) {
        const resolvedId = await findOrCreateColor(g.colorRef, "", { fr: g.colorName });
        if (resolvedId) {
          g.colorId = resolvedId;
          updated = true;
        }
      }
    }
    if (updated) {
      await prisma.pfsStagedProduct.update({
        where: { id: stagedId },
        data: {
          variants: variants as unknown as import("@prisma/client").Prisma.InputJsonValue,
          imagesByColor: imageGroups as unknown as import("@prisma/client").Prisma.InputJsonValue,
        },
      });
    }
  }

  // Re-resolve manufacturing country if deleted
  if (staged.manufacturingCountryId) {
    const countryExists = await prisma.manufacturingCountry.findUnique({
      where: { id: staged.manufacturingCountryId },
      select: { id: true },
    });
    if (!countryExists) {
      staged.manufacturingCountryId = null;
    }
  }

  // Re-resolve season if deleted
  if (staged.seasonId) {
    const seasonExists = await prisma.season.findUnique({
      where: { id: staged.seasonId },
      select: { id: true },
    });
    if (!seasonExists) {
      staged.seasonId = null;
    }
  }

  // Subcategory connection
  const subCategoryIds = (staged.subCategoryIds as unknown as string[]) ?? [];

  // Create new product (SYNCING until images are confirmed)
  const product = await prisma.product.create({
    data: {
      reference: staged.reference,
      pfsProductId: staged.pfsProductId,
      name: staged.name,
      description: staged.description,
      categoryId: staged.categoryId,
      subCategories: subCategoryIds.length > 0 ? { connect: subCategoryIds.map((id) => ({ id })) } : undefined,
      isBestSeller: staged.isBestSeller,
      manufacturingCountryId: staged.manufacturingCountryId || null,
      seasonId: staged.seasonId || null,
      status: "SYNCING",
    },
  });

  const imageStats = await createProductChildren(product.id, variants, compositions, translations, imageGroups, tagNames, staged.categoryId);

  // Only set final status if ALL images were downloaded — never create a product with missing images
  if (imageStats.expected === 0 || imageStats.downloaded >= imageStats.expected) {
    await prisma.product.update({
      where: { id: product.id },
      data: { status: bjStatus },
    });
  } else {
    // Any missing images (partial or zero) — delete the product entirely
    await prisma.product.delete({ where: { id: product.id } });
    const msg = `Images incomplètes pour ${staged.reference} (${imageStats.downloaded}/${imageStats.expected}). Réessayez plus tard.`;
    await prisma.pfsStagedProduct.update({
      where: { id: stagedId },
      data: { status: "ERROR", errorMessage: msg },
    });
    logger.warn(`[PFS Approve] ${staged.reference} — ${imageStats.downloaded}/${imageStats.expected} images, produit supprimé`);
    throw new Error(msg);
  }

  // Auto-translate product name/description for missing locales (ar, zh) if enabled
  const existingLocales = translations.map((t) => t.locale);
  autoTranslateProduct(product.id, staged.name, staged.description, existingLocales);

  // Resolve PendingSimilar
  const pending = await prisma.pendingSimilar.findMany({
    where: { similarRef: staged.reference },
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
    await prisma.pendingSimilar.deleteMany({ where: { similarRef: staged.reference } });
  }

  await prisma.pfsStagedProduct.update({
    where: { id: stagedId },
    data: { status: "APPROVED", createdProductId: product.id, errorMessage: null },
  });

  await prisma.pfsPrepareJob.update({
    where: { id: staged.prepareJobId },
    data: { approvedProducts: { increment: 1 } },
  });

  // Invalidate product caches so pages show updated data immediately
  revalidateTag("products", "default");
  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${product.id}/modifier`);
  revalidatePath(`/produits/${product.id}`);

  return { productId: product.id };
}

export async function createProductChildren(
  productId: string,
  variants: StagedVariantData[],
  compositions: StagedComposition[],
  translations: StagedTranslation[],
  imageGroups: StagedImageGroup[],
  tagNames: string[] = [],
  categoryId?: string,
): Promise<{ expected: number; downloaded: number }> {
  // Create variants sequentially (need IDs for images)
  // Verify all color IDs exist before creating (FK constraint protection)
  const uniqueColorIds = [...new Set(variants.map((v) => v.colorId))];
  const existingColors = await prisma.color.findMany({
    where: { id: { in: uniqueColorIds } },
    select: { id: true },
  });
  const existingColorSet = new Set(existingColors.map((c) => c.id));
  const missingColors = uniqueColorIds.filter((id) => !existingColorSet.has(id));
  if (missingColors.length > 0) {
    throw new Error(`Couleurs manquantes en base: ${missingColors.join(", ")}. Re-lancez la préparation.`);
  }

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
    // Create PackColorLine records for PACK variants
    if (v.saleType === "PACK" && v.packColorLines && v.packColorLines.length > 0) {
      for (let lineIdx = 0; lineIdx < v.packColorLines.length; lineIdx++) {
        const line = v.packColorLines[lineIdx];
        const packColorLine = await prisma.packColorLine.create({
          data: {
            productColorId: created.id,
            position: lineIdx,
          },
        });
        for (let colorIdx = 0; colorIdx < line.colors.length; colorIdx++) {
          await prisma.packColorLineColor.create({
            data: {
              packColorLineId: packColorLine.id,
              colorId: line.colors[colorIdx].colorId,
              position: colorIdx,
            },
          });
        }
      }
    }

    // Create VariantSize records — support multiple sizes with qty + price (PACK variants)
    if (v.sizeEntries?.length) {
      for (const entry of v.sizeEntries) {
        const sizeRecord = await prisma.size.upsert({
          where: { name: entry.name },
          create: { name: entry.name },
          update: {},
        }).catch(() => prisma.size.findFirstOrThrow({ where: { name: entry.name } }));
        // Link size to category
        if (categoryId) {
          await prisma.sizeCategoryLink.createMany({
            data: [{ sizeId: sizeRecord.id, categoryId }],
            skipDuplicates: true,
          });
        }
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
      // Fallback: legacy format with just size names
      const sizes = v.sizeNames?.length ? v.sizeNames : (v.sizeName ? [v.sizeName] : []);
      for (const sizeName of sizes) {
        const sizeRecord = await prisma.size.upsert({
          where: { name: sizeName },
          create: { name: sizeName },
          update: {},
        }).catch(() => prisma.size.findFirstOrThrow({ where: { name: sizeName } }));
        // Link size to category
        if (categoryId) {
          await prisma.sizeCategoryLink.createMany({
            data: [{ sizeId: sizeRecord.id, categoryId }],
            skipDuplicates: true,
          });
        }
        await prisma.variantSize.create({
          data: { productColorId: created.id, sizeId: sizeRecord.id, quantity: 1 },
        });
      }
    }
  }

  // Download PFS images + create DB records
  // Fail fast: stop on first image failure (product will be deleted by caller)
  const imgExpected = imageGroups.reduce((sum, g) => sum + g.paths.length, 0);
  let imgDownloaded = 0;
  let imgFailed = false;

  for (const group of imageGroups) {
    if (imgFailed) break;

    // Match by colorId (database ID), then colorRef exact, then case-insensitive.
    // PFS API can use different casing for image keys vs variant references (e.g. "SILVER" vs "Silver")
    // and BJ uses name.toUpperCase (e.g. "DORÉ") while PFS uses API ref (e.g. "DORE").
    const matchingVariant = (group.colorId && createdVariants.find((v) => v.colorId === group.colorId))
      ?? createdVariants.find((v) => v.colorRef === group.colorRef)
      ?? createdVariants.find((v) => v.colorRef.toLowerCase() === group.colorRef.toLowerCase())
      ?? createdVariants.find((v) => v.colorId === group.colorRef);
    if (!matchingVariant) {
      logger.warn(`[CREATE_CHILDREN] No matching variant for image group colorRef=${group.colorRef} colorId=${group.colorId}`, { available: createdVariants.map(v => `${v.colorRef}(${v.colorId})`).join(", ") });
      imgFailed = true;
      break;
    }

    const finalPaths: { path: string; order: number }[] = [];
    for (let imgIdx = 0; imgIdx < group.paths.length; imgIdx++) {
      if (imgFailed) break;

      const imgPath = group.paths[imgIdx];
      const imgOrder = group.orders?.[imgIdx] ?? imgIdx;
      if (imgPath.startsWith("http")) {
        // PFS CDN URL — download, process to WebP, upload to R2 final
        // SSRF protection: only allow PFS CDN domains
        try {
          const urlObj = new URL(imgPath);
          if (!["static.parisfashionshops.com", "cdn.parisfashionshops.com"].includes(urlObj.hostname)) {
            logger.warn("[CREATE_CHILDREN] Blocked download from unauthorized domain", { hostname: urlObj.hostname });
            imgFailed = true;
            break;
          }
          const buffer = await downloadImage(imgPath);
          const filename = `pfs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const result = await processProductImage(buffer, "public/uploads/products", filename);
          finalPaths.push({ path: result.dbPath, order: imgOrder });
          imgDownloaded++;
        } catch (err) {
          logger.warn(`[CREATE_CHILDREN] Failed to download PFS image: ${imgPath}`, { error: err });
          imgFailed = true;
          break;
        }
      } else {
        // Already a final path (BJ existing image kept via compare modal) — use as-is
        imgDownloaded++;
        finalPaths.push({ path: imgPath, order: imgOrder });
      }
    }

    if (finalPaths.length > 0) {
      // Sort by order to maintain correct positions
      finalPaths.sort((a, b) => a.order - b.order);
      await prisma.productColorImage.createMany({
        data: finalPaths.map((fp) => ({
          productId,
          colorId: matchingVariant.colorId ?? "",
          productColorId: matchingVariant.id,
          path: fp.path,
          order: fp.order,
        })),
      });
    }
  }

  // Compositions + translations in parallel
  const dbOps: Promise<unknown>[] = [];
  if (compositions.length > 0) {
    dbOps.push(prisma.productComposition.createMany({
      data: compositions.map((c) => ({
        productId,
        compositionId: c.compositionId,
        percentage: c.percentage,
      })),
      skipDuplicates: true,
    }));
  }
  if (translations.length > 0) {
    dbOps.push(prisma.productTranslation.createMany({
      data: translations.map((t) => ({ productId, ...t })),
      skipDuplicates: true,
    }));
  }
  // Create tags
  if (tagNames.length > 0) {
    for (const tagName of tagNames) {
      const tag = await prisma.tag.findFirst({ where: { name: tagName } });
      if (tag) {
        dbOps.push(prisma.productTag.create({
          data: { productId, tagId: tag.id },
        }).catch(() => { /* skip duplicate */ }));
      }
    }
  }
  await Promise.all(dbOps);

  // Create sub-colors for variants (use exact variant ID from createdVariants)
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (v.subColors && v.subColors.length > 0) {
      const created = createdVariants[i];
      if (created) {
        await prisma.productColorSubColor.createMany({
          data: v.subColors.map((sc, idx) => ({
            productColorId: created.id,
            colorId: sc.colorId,
            position: idx,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  return { expected: imgExpected, downloaded: imgDownloaded };
}

// ─────────────────────────────────────────────
// Reject a staged product (no images to clean up — only URLs stored)
// ─────────────────────────────────────────────

export async function rejectStagedProduct(stagedId: string): Promise<void> {
  const staged = await prisma.pfsStagedProduct.findUnique({ where: { id: stagedId } });
  if (!staged) throw new Error("Produit staged non trouvé");
  if (staged.status !== "READY") throw new Error(`Statut invalide: ${staged.status}`);

  await prisma.pfsStagedProduct.update({
    where: { id: stagedId },
    data: { status: "REJECTED" },
  });

  await prisma.pfsPrepareJob.update({
    where: { id: staged.prepareJobId },
    data: { rejectedProducts: { increment: 1 } },
  });
}

// ─────────────────────────────────────────────
// Bulk operations
// ─────────────────────────────────────────────

const BULK_CONCURRENCY = 5;

export async function bulkApproveStagedProducts(
  ids: string[],
): Promise<{ results: { id: string; productId?: string; error?: string }[] }> {
  const results: { id: string; productId?: string; error?: string }[] = [];

  for (let i = 0; i < ids.length; i += BULK_CONCURRENCY) {
    const batch = ids.slice(i, i + BULK_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (id) => {
        const { productId } = await approveStagedProduct(id);
        return { id, productId };
      }),
    );

    for (let idx = 0; idx < batchResults.length; idx++) {
      const r = batchResults[idx];
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        results.push({ id: batch[idx], error: msg });
        // Persiste le message d'erreur en DB (statut reste READY pour permettre une nouvelle tentative)
        await prisma.pfsStagedProduct.update({
          where: { id: batch[idx] },
          data: { errorMessage: msg },
        }).catch(() => {});
      }
    }
  }

  return { results };
}

export async function bulkRejectStagedProducts(
  ids: string[],
): Promise<{ results: { id: string; error?: string }[] }> {
  const results: { id: string; error?: string }[] = [];

  for (let i = 0; i < ids.length; i += BULK_CONCURRENCY) {
    const batch = ids.slice(i, i + BULK_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (id) => {
        await rejectStagedProduct(id);
        return { id };
      }),
    );

    for (let idx = 0; idx < batchResults.length; idx++) {
      const r = batchResults[idx];
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        results.push({ id: batch[idx], error: msg });
      }
    }
  }

  return { results };
}
