/**
 * PFS Prepare Processor
 *
 * Prepares PFS products for review before creating them in the BJ database.
 * Downloads data + images to staging, stores in PfsStagedProduct for admin approval.
 *
 * Flow: Prepare (staging) → Review (edit) → Approve (create in DB) / Reject (delete)
 */

import { prisma } from "@/lib/prisma";
import {
  pfsListProducts,
  type PfsProduct,
} from "@/lib/pfs-api";
import { processProductImage } from "@/lib/image-processor";
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
import { rename, unlink, mkdir, access } from "fs/promises";

// Lower concurrency for prepare to avoid PFS API rate-limiting
// Each product makes 2 API calls (getVariants + checkReference) so 5 products = 10 concurrent API calls
const PREPARE_CONCURRENCY = 5;
import path from "path";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface StagedSubColor {
  colorId: string;
  colorName: string;
  hex: string | null;
  patternImage: string | null;
}

export interface StagedVariantData {
  colorId: string;
  colorRef: string;
  colorName: string;
  subColors?: StagedSubColor[];
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
  paths: string[]; // staging paths like /uploads/products/staging/pfs_...webp
  orders?: number[]; // optional: explicit order for each path (same length as paths)
}

// ─────────────────────────────────────────────
// Image staging
// ─────────────────────────────────────────────

const STAGING_DIR = "public/uploads/products/staging";

async function downloadAndProcessStagingImages(
  imageUrls: string[],
  reference: string,
  colorRef: string,
): Promise<string[]> {
  const results = await Promise.allSettled(
    imageUrls.map(async (url, idx) => {
      let buffer: Buffer | null = null;
      try {
        buffer = await downloadImage(url);
      } catch {
        // Download failed
      }
      if (!buffer) return null;
      try {
        const filename = `pfs_${reference}_${colorRef}_${idx}_${Date.now()}`;
        const result = await processProductImage(buffer, STAGING_DIR, filename);
        return { path: result.dbPath, order: idx };
      } catch {
        return null;
      }
    }),
  );

  return results
    .map((r) => (r.status === "fulfilled" && r.value ? r.value : null))
    .filter((r): r is { path: string; order: number } => r !== null)
    .sort((a, b) => a.order - b.order)
    .map((r) => r.path);
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

    // Check if product already exists in DB by reference
    const existingProduct = await prisma.product.findFirst({
      where: { reference: bjRef },
      include: {
        colors: {
          include: {
            color: true,
            subColors: { include: { color: true } },
            images: true,
          },
        },
        compositions: { include: { composition: true } },
        category: true,
      },
    });

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

    const activeVariants = (variantDetails.length > 0 ? variantDetails : pfsProduct.variants)
      .filter((v) => v.is_active);

    if (activeVariants.length === 0) {
      addLog(`  ⏭ ${bjRef} — Aucune variante active, skip`);
      return { status: "error", reference: bjRef, error: "Aucune variante active" };
    }

    // Detect default color
    const allImages = pfsProduct.images;
    const defaultColorRef = detectDefaultColorRef(
      allImages,
      refDetails?.product?.default_color,
    );

    const variants: StagedVariantData[] = [];

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

        variants.push({
          colorId,
          colorRef: v.item.color.reference,
          colorName: v.item.color.labels?.fr || v.item.color.reference,
          unitPrice: bjPrice,
          weight,
          stock: v.stock_qty,
          saleType: "UNIT",
          packQuantity: null,
          sizeName: v.item.size || null,
          isPrimary: false,
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

        variants.push({
          colorId,
          colorRef: pack.color.reference,
          colorName: pack.color.labels?.fr || pack.color.reference,
          unitPrice: bjPrice,
          weight,
          stock: v.stock_qty,
          saleType: "PACK",
          packQuantity: packQty,
          sizeName: pack.sizes?.[0]?.size || null,
          isPrimary: false,
          discountType,
          discountValue,
        });
      }
    }

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

    // ── Product name/description ──
    const nameFr = pfsProduct.labels?.fr || bjRef;
    const descriptionFr = refDetails?.product?.description?.fr || nameFr;

    // ── Translations ──
    const translations: StagedTranslation[] = [];
    for (const locale of ["en", "de", "es", "it"]) {
      const name = pfsProduct.labels?.[locale];
      const desc = refDetails?.product?.description?.[locale] || name;
      if (name) {
        translations.push({ locale, name, description: desc || name });
      }
    }

    // ── Duplicate detection ──
    let existsInDb = false;
    let existingProductId: string | null = null;
    let differences: Array<{ field: string; stagedValue: unknown; existingValue: unknown }> | null = null;

    if (existingProduct) {
      existsInDb = true;
      existingProductId = existingProduct.id;
      differences = [];

      // Compare name
      if (existingProduct.name !== nameFr) {
        differences.push({ field: "name", stagedValue: nameFr, existingValue: existingProduct.name });
      }

      // Compare description
      if (existingProduct.description !== descriptionFr) {
        differences.push({ field: "description", stagedValue: descriptionFr, existingValue: existingProduct.description || "" });
      }

      // Compare category
      if (existingProduct.categoryId !== categoryId) {
        differences.push({
          field: "category",
          stagedValue: categoryName,
          existingValue: existingProduct.category?.name || "",
        });
      }

      // Compare isBestSeller
      const stagedBestSeller = pfsProduct.is_star === 1;
      if (existingProduct.isBestSeller !== stagedBestSeller) {
        differences.push({ field: "isBestSeller", stagedValue: stagedBestSeller, existingValue: existingProduct.isBestSeller });
      }

      // Compare variant count
      const existingVariantCount = existingProduct.colors.length;
      if (existingVariantCount !== variants.length) {
        differences.push({ field: "variantCount", stagedValue: variants.length, existingValue: existingVariantCount });
      }

      // Compare colors (check if sync has colors that don't exist in app)
      const existingColorNames = new Set(existingProduct.colors.map(c => c.color?.name).filter(Boolean) as string[]);
      const stagedColorNames = variants.map(v => v.colorName);
      const newColors = stagedColorNames.filter(cn => !existingColorNames.has(cn));
      if (newColors.length > 0) {
        differences.push({ field: "newColors", stagedValue: newColors, existingValue: [...existingColorNames] });
      }

      // Compare prices (check each matching variant)
      for (const sv of variants) {
        const matchingExisting = existingProduct.colors.find(c => c.color?.name === sv.colorName);
        if (matchingExisting) {
          if (Math.abs(matchingExisting.unitPrice - sv.unitPrice) > 0.01) {
            differences.push({
              field: `price_${sv.colorName}`,
              stagedValue: sv.unitPrice,
              existingValue: matchingExisting.unitPrice,
            });
          }
          if (matchingExisting.stock !== sv.stock) {
            differences.push({
              field: `stock_${sv.colorName}`,
              stagedValue: sv.stock,
              existingValue: matchingExisting.stock,
            });
          }
        }
      }

      // Compare compositions
      const existingCompNames = existingProduct.compositions.map(c => c.composition.name).sort();
      const stagedCompNames = compositions.map(c => c.name).sort();
      if (JSON.stringify(existingCompNames) !== JSON.stringify(stagedCompNames)) {
        differences.push({ field: "compositions", stagedValue: stagedCompNames, existingValue: existingCompNames });
      }

      if (differences.length === 0) differences = null;

      addLog(`  ⚠️ ${bjRef} — existe déjà en BDD${differences ? ` (${differences.length} différence(s))` : " (identique)"}`);
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
        existsInDb,
        existingProductId,
        differences: differences as unknown as import("@prisma/client").Prisma.InputJsonValue,
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
        existsInDb,
        existingProductId,
        differences: differences as unknown as import("@prisma/client").Prisma.InputJsonValue,
        status: "PREPARING",
      },
    });

    addLog(`  ✅ ${bjRef} données préparées — images en file d'attente`);

    // ── Build image task ──
    const imageTask = async () => {
      try {
        const colorImages = extractColorImages(pfsProduct.images);
        const imageGroups: StagedImageGroup[] = [];

        for (const [colorRef, urls] of colorImages) {
          const limitedUrls = urls.slice(0, 5).map(fullSizeImageUrl);
          const paths = await downloadAndProcessStagingImages(limitedUrls, bjRef, colorRef);

          // Find color name from variants (case-insensitive — PFS API may use
          // different casing for image keys vs variant color references)
          const matchingVariant = variants.find((v) => v.colorRef === colorRef)
            ?? variants.find((v) => v.colorRef.toLowerCase() === colorRef.toLowerCase());
          const colorName = matchingVariant?.colorName || colorRef;
          // Use colorRef as fallback (not "") so orphan groups remain uniquely identifiable
          const colorId = matchingVariant?.colorId || colorRef;

          if (paths.length > 0) {
            imageGroups.push({ colorRef, colorName, colorId, paths });
          }
        }

        // Update staged product with images + set READY
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
      if (maxProducts > 0 && processed >= maxProducts) break;

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
          const total = maxProducts > 0
            ? Math.min(response.state.active, maxProducts)
            : response.state.active;
          addProductLog(`📊 Total produits actifs PFS: ${response.state.active}${maxProducts > 0 ? ` (limité à ${maxProducts})` : ""}`);
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

      // Apply limit
      if (maxProducts > 0) {
        const remaining = maxProducts - processed;
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
                addImageLog(`⬇️ ${ref} — téléchargement en cours...`);
                try {
                  await result.imageTask!();
                  addImageLog(`✅ ${ref} — images téléchargées`);
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

    // Wait for remaining image tasks
    addProductLog(`🏁 Produits terminés — ${processed} traités (✅${ready} ❌${errored})`);
    const remaining = activeImageTasks + pendingImageTasks.length;
    if (remaining > 0) {
      addImageLog(`⏳ ${remaining} image(s) restante(s)...`);
    }

    imagePoolDrained = true;
    tryDrainImagePool();
    await imagePoolDone;

    addImageLog(`🏁 Images terminées — ${completedImageTasks} OK${failedImageTasks > 0 ? `, ${failedImageTasks} échouées` : ""}`);
    await closePlaywright();

    // Count actual ready products from DB
    const finalReady = await prisma.pfsStagedProduct.count({
      where: { prepareJobId: jobId, status: "READY" },
    });

    addProductLog(`🏁 Préparation terminée — ${finalReady} produits prêts pour validation`);

    await prisma.pfsPrepareJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
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

  console.log(`[APPROVE] stagedId=${stagedId} existsInDb=${staged.existsInDb} existingProductId=${staged.existingProductId}`);
  console.log(`[APPROVE] variants count=${variants.length}:`, variants.map(v => `${v.colorName}(${v.colorId}/${v.colorRef}/${v.saleType})`));
  console.log(`[APPROVE] imageGroups count=${imageGroups.length}:`, imageGroups.map(g => `${g.colorName}(${g.colorId}/${g.colorRef})`));

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

  // Check if product already exists
  const existing = await prisma.product.findFirst({
    where: {
      OR: [
        { reference: staged.reference },
        { pfsProductId: staged.pfsProductId },
      ],
    },
    select: { id: true },
  });

  // Subcategory connection for the many-to-many relation
  const subCategoryIds = (staged.subCategoryIds as unknown as string[]) ?? [];
  const subCategoryConnect = subCategoryIds.length > 0
    ? { set: subCategoryIds.map((id) => ({ id })) }
    : { set: [] as { id: string }[] };

  if (existing) {
    // Update existing inside a transaction to prevent partial corruption
    const productId = existing.id;

    await prisma.$transaction(async (tx) => {
      // Delete images before colors (FK constraint: ProductColorImage → ProductColor)
      await tx.productColorImage.deleteMany({ where: { productId } });
      // Delete children in parallel (safe: no FK between them)
      await Promise.all([
        tx.productComposition.deleteMany({ where: { productId } }),
        tx.productColor.deleteMany({ where: { productId } }),
        tx.productTranslation.deleteMany({ where: { productId } }),
        tx.productTag.deleteMany({ where: { productId } }),
      ]);
      // Update product fields
      await tx.product.update({
        where: { id: productId },
        data: {
          name: staged.name,
          description: staged.description,
          categoryId: staged.categoryId,
          subCategories: subCategoryConnect,
          pfsProductId: staged.pfsProductId,
          isBestSeller: staged.isBestSeller,
          manufacturingCountryId: staged.manufacturingCountryId || null,
          seasonId: staged.seasonId || null,
          status: "ONLINE",
        },
      });
    });

    await createProductChildren(productId, variants, compositions, translations, imageGroups, tagNames);

    await prisma.pfsStagedProduct.update({
      where: { id: stagedId },
      data: { status: "APPROVED", createdProductId: productId, errorMessage: null },
    });

    // Update job counters
    await prisma.pfsPrepareJob.update({
      where: { id: staged.prepareJobId },
      data: { approvedProducts: { increment: 1 } },
    });

    return { productId };
  }

  // Create new product
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
      status: "ONLINE",
    },
  });

  await createProductChildren(product.id, variants, compositions, translations, imageGroups, tagNames);

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

  return { productId: product.id };
}

async function createProductChildren(
  productId: string,
  variants: StagedVariantData[],
  compositions: StagedComposition[],
  translations: StagedTranslation[],
  imageGroups: StagedImageGroup[],
  tagNames: string[] = [],
): Promise<void> {
  // Create variants sequentially (need IDs for images)
  console.log("[CREATE_CHILDREN] variants:", variants.length, "imageGroups:", imageGroups.length);
  console.log("[CREATE_CHILDREN] variant details:", variants.map(v => `${v.colorName}(${v.colorId}/${v.colorRef}/${v.saleType})`));
  console.log("[CREATE_CHILDREN] imageGroup details:", imageGroups.map(g => `${g.colorName}(${g.colorId}/${g.colorRef}) paths=${g.paths.length}`));
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
    console.log(`[CREATE_CHILDREN] Created variant id=${created.id} colorId=${created.colorId} colorRef=${v.colorRef}`);

    // Create VariantSize record if PFS provided a size
    if (v.sizeName) {
      const sizeRecord = await prisma.size.upsert({
        where: { name: v.sizeName },
        create: { name: v.sizeName },
        update: {},
      });
      await prisma.variantSize.create({
        data: { productColorId: created.id, sizeId: sizeRecord.id, quantity: 1 },
      });
    }
  }

  // Move images from staging to final + create DB records
  for (const group of imageGroups) {
    // Match by colorId (database ID), then colorRef exact, then case-insensitive.
    // PFS API can use different casing for image keys vs variant references (e.g. "SILVER" vs "Silver")
    // and BJ uses name.toUpperCase (e.g. "DORÉ") while PFS uses API ref (e.g. "DORE").
    const matchingVariant = (group.colorId && createdVariants.find((v) => v.colorId === group.colorId))
      ?? createdVariants.find((v) => v.colorRef === group.colorRef)
      ?? createdVariants.find((v) => v.colorRef.toLowerCase() === group.colorRef.toLowerCase())
      ?? createdVariants.find((v) => v.colorId === group.colorRef);
    if (!matchingVariant) {
      console.log(`[CREATE_CHILDREN] WARNING: No matching variant for image group colorRef=${group.colorRef} colorId=${group.colorId}. Available: ${createdVariants.map(v => `${v.colorRef}(${v.colorId})`).join(", ")}`);
      continue;
    }

    const finalPaths: { path: string; order: number }[] = [];
    for (let imgIdx = 0; imgIdx < group.paths.length; imgIdx++) {
      const imgPath = group.paths[imgIdx];
      const imgOrder = group.orders?.[imgIdx] ?? imgIdx;
      if (imgPath.startsWith("http")) {
        // External PFS CDN URL — download and process to local WebP
        // SSRF protection: only allow PFS CDN domains
        try {
          const urlObj = new URL(imgPath);
          if (!["static.parisfashionshops.com", "cdn.parisfashionshops.com"].includes(urlObj.hostname)) {
            console.warn(`[CREATE_CHILDREN] Blocked download from unauthorized domain: ${urlObj.hostname}`);
            continue;
          }
          const buffer = await downloadImage(imgPath);
          const filename = `pfs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const result = await processProductImage(buffer, "public/uploads/products", filename);
          finalPaths.push({ path: result.dbPath, order: imgOrder });
        } catch (err) {
          console.warn(`[CREATE_CHILDREN] Failed to download external image: ${imgPath}`, err);
        }
      } else if (imgPath.includes("/staging/")) {
        // PFS staging image — needs to be moved to final directory
        try {
          const finalPath = await moveImageFromStaging(imgPath);
          finalPaths.push({ path: finalPath, order: imgOrder });
        } catch {
          // Source file missing — check if already moved (same staging image used by another color group)
          const finalDbPath = imgPath.replace("/uploads/products/staging/", "/uploads/products/");
          try {
            await access(path.join(process.cwd(), "public", finalDbPath));
            finalPaths.push({ path: finalDbPath, order: imgOrder });
          } catch {
            console.warn(`[CREATE_CHILDREN] Staging image not found and not already moved: ${imgPath}`);
          }
        }
      } else {
        // Already a final path (BJ existing image kept via compare modal) — use as-is
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
}

// ─────────────────────────────────────────────
// Move image from staging to final directory
// ─────────────────────────────────────────────

async function moveImageFromStaging(stagingDbPath: string): Promise<string> {
  // stagingDbPath = "/uploads/products/staging/pfs_xxx.webp"
  // finalDbPath   = "/uploads/products/pfs_xxx.webp"
  const finalDbPath = stagingDbPath.replace("/uploads/products/staging/", "/uploads/products/");

  const cwd = process.cwd();
  const suffixes = ["", "_md", "_thumb"];
  const ext = ".webp";

  for (const suffix of suffixes) {
    const baseSrc = stagingDbPath.replace(ext, `${suffix}${ext}`);
    const baseDst = finalDbPath.replace(ext, `${suffix}${ext}`);
    const srcAbs = path.join(cwd, "public", baseSrc);
    const dstAbs = path.join(cwd, "public", baseDst);

    // Ensure destination directory exists
    await mkdir(path.dirname(dstAbs), { recursive: true });
    await rename(srcAbs, dstAbs);
  }

  return finalDbPath;
}

// ─────────────────────────────────────────────
// Reject a staged product → delete images
// ─────────────────────────────────────────────

export async function rejectStagedProduct(stagedId: string): Promise<void> {
  const staged = await prisma.pfsStagedProduct.findUnique({ where: { id: stagedId } });
  if (!staged) throw new Error("Produit staged non trouvé");
  if (staged.status !== "READY") throw new Error(`Statut invalide: ${staged.status}`);

  const imageGroups = staged.imagesByColor as unknown as StagedImageGroup[];

  // Delete all staging images
  for (const group of imageGroups) {
    for (const imgPath of group.paths) {
      await deleteStagingImage(imgPath);
    }
  }

  await prisma.pfsStagedProduct.update({
    where: { id: stagedId },
    data: { status: "REJECTED" },
  });

  await prisma.pfsPrepareJob.update({
    where: { id: staged.prepareJobId },
    data: { rejectedProducts: { increment: 1 } },
  });
}

async function deleteStagingImage(dbPath: string): Promise<void> {
  const cwd = process.cwd();
  const ext = ".webp";
  const suffixes = ["", "_md", "_thumb"];

  for (const suffix of suffixes) {
    const fullPath = dbPath.replace(ext, `${suffix}${ext}`);
    const absPath = path.join(cwd, "public", fullPath);
    await unlink(absPath).catch(() => {}); // Ignore if already deleted
  }
}

// ─────────────────────────────────────────────
// Compare selections types
// ─────────────────────────────────────────────

export interface CompareSelections {
  name: "bj" | "pfs";
  description: "bj" | "pfs";
  category: "bj" | "pfs";
  compositions: "bj" | "pfs";
  variants: Record<string, "bj" | "pfs" | "add">;
  // Image slots: key = colorGroupKey (colorId::subNames), value = array of 5 slots (path or null)
  imageSlots: Record<string, (string | null)[]>;
}

/**
 * Apply compare selections to a staged product before approval.
 * For fields where the user chose "bj", overwrite the staged product
 * with the existing BJ product values so that the approve function
 * will write back the same data (no change).
 *
 * For variants/images, merge based on per-key selections:
 * - "bj": keep existing BJ variant/image (overwrite staged with BJ data)
 * - "pfs": use PFS data (keep staged as-is)
 * - "add": new from PFS (keep staged + mark as addition)
 */
async function applyCompareSelections(
  stagedId: string,
  selections: CompareSelections,
): Promise<void> {
  const staged = await prisma.pfsStagedProduct.findUnique({ where: { id: stagedId } });
  if (!staged || !staged.existingProductId) return;
  const existingProductId = staged.existingProductId;

  // Fetch the existing BJ product with full relations
  const existing = await prisma.product.findUnique({
    where: { id: existingProductId },
    include: {
      category: { select: { id: true, name: true } },
      colors: {
        include: {
          color: { select: { id: true, name: true, hex: true, patternImage: true } },
          subColors: {
            include: {
              color: { select: { id: true, name: true, hex: true, patternImage: true } },
            },
            orderBy: { position: "asc" },
          },
          variantSizes: { select: { size: { select: { name: true } } } },
          images: {
            select: { path: true, order: true },
            orderBy: { order: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      compositions: {
        include: { composition: { select: { id: true, name: true } } },
      },
    },
  });
  if (!existing) return;

  const updateData: Record<string, unknown> = {};

  // Simple fields
  if (selections.name === "bj") updateData.name = existing.name;
  if (selections.description === "bj") updateData.description = existing.description;
  if (selections.category === "bj") {
    updateData.categoryId = existing.categoryId;
    updateData.categoryName = existing.category.name;
  }

  // Compositions
  if (selections.compositions === "bj") {
    updateData.compositions = existing.compositions.map((c) => ({
      compositionId: c.compositionId,
      name: c.composition.name,
      percentage: c.percentage,
    }));
  }

  // Variants — build merged list
  const stagedVariants = (typeof staged.variants === "string"
    ? JSON.parse(staged.variants) : staged.variants ?? []) as StagedVariantData[];
  const stagedImages = (typeof staged.imagesByColor === "string"
    ? JSON.parse(staged.imagesByColor) : staged.imagesByColor ?? []) as StagedImageGroup[];

  // Build BJ variants in staged format
  const bjVariants: StagedVariantData[] = existing.colors.map((pc) => ({
    colorId: pc.color?.id ?? "",
    colorRef: pc.color?.name.toUpperCase().replace(/\s+/g, "_") ?? "",
    colorName: pc.color?.name ?? "",
    subColors: pc.subColors.map((sc) => ({
      colorId: sc.color.id,
      colorName: sc.color.name,
      hex: sc.color.hex,
      patternImage: sc.color.patternImage,
    })),
    unitPrice: pc.unitPrice,
    weight: pc.weight,
    stock: pc.stock,
    saleType: pc.saleType as "UNIT" | "PACK",
    packQuantity: pc.packQuantity,
    sizeName: pc.variantSizes?.[0]?.size.name ?? null,
    isPrimary: pc.isPrimary,
    discountType: pc.discountType as "PERCENT" | "AMOUNT" | null,
    discountValue: pc.discountValue,
  }));

  // Build BJ image groups
  const bjImageGroups = new Map<string, StagedImageGroup>();
  for (const pc of existing.colors) {
    if (!pc.color) continue;
    const subNames = pc.subColors.map((sc) => sc.color.name).join(",");
    const key = `${pc.color.id}::${subNames}`;
    if (!bjImageGroups.has(key)) {
      bjImageGroups.set(key, {
        colorRef: pc.color.name.toUpperCase().replace(/\s+/g, "_"),
        colorName: pc.color.name,
        colorId: pc.color.id,
        paths: [],
      });
    }
    const group = bjImageGroups.get(key)!;
    for (const img of pc.images) {
      if (!group.paths.includes(img.path)) group.paths.push(img.path);
    }
  }

  // Merge variants based on selections
  const variantKey = (v: StagedVariantData) => {
    const subNames = (v.subColors ?? []).map((sc) => sc.colorName).join(",");
    return `${v.colorId}::${subNames}::${v.saleType}`;
  };

  const bjByKey = new Map<string, StagedVariantData[]>();
  for (const v of bjVariants) {
    const k = variantKey(v);
    if (!bjByKey.has(k)) bjByKey.set(k, []);
    bjByKey.get(k)!.push(v);
  }
  const pfsByKey = new Map<string, StagedVariantData[]>();
  for (const v of stagedVariants) {
    const k = variantKey(v);
    if (!pfsByKey.has(k)) pfsByKey.set(k, []);
    pfsByKey.get(k)!.push(v);
  }

  const mergedVariants: StagedVariantData[] = [];
  const processedKeys = new Set<string>();

  // Process selections
  for (const [key, choice] of Object.entries(selections.variants)) {
    processedKeys.add(key);
    if (choice === "bj") {
      const bjVars = bjByKey.get(key);
      if (bjVars) {
        mergedVariants.push(...bjVars);
      }
      // If "bj" selected but variant doesn't exist in BJ → skip (user chose to ignore this PFS variant)
    } else if (choice === "pfs" || choice === "add") {
      const pfsVars = pfsByKey.get(key);
      if (pfsVars) mergedVariants.push(...pfsVars);
    }
  }

  // Add any unprocessed BJ variants (not in selections → keep BJ)
  for (const [key, vars] of bjByKey) {
    if (!processedKeys.has(key)) mergedVariants.push(...vars);
  }

  updateData.variants = mergedVariants;

  // Build images from imageSlots — convert slot arrays back to StagedImageGroup format
  const mergedImages: StagedImageGroup[] = [];
  const processedColorIds = new Set<string>();

  for (const [key, slots] of Object.entries(selections.imageSlots)) {
    // Extract colorId from key (format: "colorId::subNames" or "colorRef::subNames" when colorId was empty)
    const [rawColorId] = key.split("::");

    // Find matching color info from BJ or staged data
    const bjGroup = bjImageGroups.get(key);
    // Try exact colorId match, then case-insensitive colorRef match (handles PFS
    // prepare bug where colorId="" and key falls back to colorRef like "SILVER")
    const stagedGroup = stagedImages.find((g) => g.colorId === rawColorId)
      ?? stagedImages.find((g) => g.colorRef.toLowerCase() === rawColorId.toLowerCase());
    const sourceGroup = bjGroup ?? stagedGroup;

    // Resolve the actual database colorId — rawColorId might be a PFS colorRef
    // string (e.g. "SILVER") instead of a UUID when PFS prepare had a case mismatch
    let resolvedColorId = rawColorId;
    if (sourceGroup?.colorId) {
      resolvedColorId = sourceGroup.colorId;
    }
    // If still not a valid DB ID, try to find from merged variants
    if (!resolvedColorId || resolvedColorId === sourceGroup?.colorRef) {
      const matchVar = mergedVariants.find((v) =>
        v.colorRef.toLowerCase() === rawColorId.toLowerCase()
        || v.colorName.toLowerCase() === rawColorId.toLowerCase()
      );
      if (matchVar) resolvedColorId = matchVar.colorId;
    }

    processedColorIds.add(resolvedColorId);
    // Also track the raw key to avoid double-processing
    processedColorIds.add(rawColorId);

    // Preserve slot positions — keep original order from the 5-slot array
    const paths: string[] = [];
    const orders: number[] = [];
    for (let i = 0; i < slots.length; i++) {
      if (slots[i]) {
        paths.push(slots[i]!);
        orders.push(i);
      }
    }
    if (paths.length === 0) continue;

    mergedImages.push({
      colorRef: sourceGroup?.colorRef ?? rawColorId,
      colorName: sourceGroup?.colorName ?? rawColorId,
      colorId: resolvedColorId,
      paths,
      orders,
    });
  }

  // Fallback: for any PFS variant being added whose color isn't in imageSlots,
  // include the original PFS staged images
  for (const [vKey, choice] of Object.entries(selections.variants)) {
    if (choice !== "pfs" && choice !== "add") continue;
    const pfsVars = pfsByKey.get(vKey);
    if (!pfsVars || pfsVars.length === 0) continue;
    const varColorId = pfsVars[0].colorId;
    const varColorRef = pfsVars[0].colorRef;
    // Check if already processed (by colorId, colorRef, or colorName)
    if (processedColorIds.has(varColorId) || processedColorIds.has(varColorRef)) continue;
    processedColorIds.add(varColorId);
    // Find PFS images for this color (by colorId or case-insensitive colorRef)
    const pfsImgGroup = stagedImages.find((g) => g.colorId === varColorId)
      ?? stagedImages.find((g) => g.colorRef.toLowerCase() === varColorRef.toLowerCase());
    if (pfsImgGroup && pfsImgGroup.paths.length > 0) {
      mergedImages.push({ ...pfsImgGroup, colorId: varColorId });
    }
  }

  updateData.imagesByColor = mergedImages;

  // Update the staged product with merged data
  await prisma.pfsStagedProduct.update({
    where: { id: stagedId },
    data: updateData,
  });
}

// ─────────────────────────────────────────────
// Bulk operations
// ─────────────────────────────────────────────

const BULK_CONCURRENCY = 5;

export async function bulkApproveStagedProducts(
  ids: string[],
  selections?: CompareSelections,
): Promise<{ results: { id: string; productId?: string; error?: string }[] }> {
  const results: { id: string; productId?: string; error?: string }[] = [];

  for (let i = 0; i < ids.length; i += BULK_CONCURRENCY) {
    const batch = ids.slice(i, i + BULK_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (id) => {
        // If selections are provided (single product compare flow), apply them first
        if (selections) {
          await applyCompareSelections(id, selections);
        }
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
