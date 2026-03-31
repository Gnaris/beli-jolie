import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  akListProducts,
  extractReferenceFromSku,
  extractColorFromSku,
  akPriceToBj,
  type AkProduct,
  type AkVariant,
} from "@/lib/ankorstore-api";
import { processProductImage } from "@/lib/image-processor";

// ── Constants ──

const PRODUCT_CONCURRENCY = 10;
const IMAGE_CONCURRENCY = 15;
const MAX_LOGS = 500;

// ── Types ──

export interface AnkorstoreSyncOptions {
  limit?: number;
}

interface SyncResult {
  action: "created" | "updated" | "skipped" | "error";
  reference: string;
  error?: string;
}

// ── In-memory caches (reset per sync) ──

const colorCache = new Map<string, string>();
const categoryCache = new Map<string, string>();

// ── Log helpers ──

const productLogs: string[] = [];
const imageLogs: string[] = [];

const ts = () =>
  new Date().toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

function addLog(msg: string) {
  productLogs.push(`[${ts()}] ${msg}`);
  if (productLogs.length > MAX_LOGS) productLogs.splice(0, productLogs.length - MAX_LOGS);
}

function addImageLog(msg: string) {
  imageLogs.push(`[${ts()}] ${msg}`);
  if (imageLogs.length > MAX_LOGS) imageLogs.splice(0, imageLogs.length - MAX_LOGS);
}

// ── Main entry point ──

export async function runAnkorstoreSync(
  jobId: string,
  options?: AnkorstoreSyncOptions,
): Promise<void> {
  const limit = options?.limit || 0;

  // Reset caches
  colorCache.clear();
  categoryCache.clear();
  productLogs.length = 0;
  imageLogs.length = 0;

  // Load mappings into cache
  const mappings = await prisma.ankorstoreMapping.findMany();
  for (const m of mappings) {
    if (m.type === "productType") categoryCache.set(m.akValue, m.bjEntityId);
  }

  // Mark job as running
  await prisma.ankorstoreSyncJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  let cursor: string | undefined;
  let totalProcessed = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const errorDetails: Record<string, { error: string }> = {};

  // Resume from last cursor if available
  const job = await prisma.ankorstoreSyncJob.findUnique({ where: { id: jobId } });
  if (job?.lastCursor) {
    cursor = job.lastCursor;
    addLog(`Reprise depuis le curseur ${cursor}`);
  }

  try {
    addLog("Démarrage de la synchronisation Ankorstore...");

    while (true) {
      // Check cancellation
      const currentJob = await prisma.ankorstoreSyncJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (currentJob?.status === "CANCELLED") {
        addLog("Synchronisation annulée par l'admin.");
        break;
      }

      // Fetch page
      const { products, variants, nextCursor } = await akListProducts(cursor);
      if (products.length === 0) break;

      addLog(`Page chargée : ${products.length} produits`);

      // Build variant lookup by product
      const variantsByProduct = new Map<string, AkVariant[]>();
      for (const product of products) {
        const productVariants = product.variantIds
          .map((vid) => variants.find((v) => v.id === vid))
          .filter((v): v is AkVariant => !!v);
        variantsByProduct.set(product.id, productVariants);
      }

      // Process products in parallel batches
      const batches: AkProduct[][] = [];
      for (let i = 0; i < products.length; i += PRODUCT_CONCURRENCY) {
        batches.push(products.slice(i, i + PRODUCT_CONCURRENCY));
      }

      for (const batch of batches) {
        const results = await Promise.allSettled(
          batch.map((product) =>
            syncSingleProduct(product, variantsByProduct.get(product.id) || []),
          ),
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            const r = result.value;
            totalProcessed++;
            if (r.action === "created") totalCreated++;
            else if (r.action === "updated") totalUpdated++;
            else if (r.action === "skipped") totalSkipped++;
            else if (r.action === "error") {
              totalErrors++;
              errorDetails[r.reference] = { error: r.error || "Unknown" };
            }
          } else {
            totalProcessed++;
            totalErrors++;
          }
        }
      }

      // Update job progress
      await prisma.ankorstoreSyncJob.update({
        where: { id: jobId },
        data: {
          processedProducts: totalProcessed,
          createdProducts: totalCreated,
          updatedProducts: totalUpdated,
          skippedProducts: totalSkipped,
          errorProducts: totalErrors,
          lastCursor: cursor || null,
          errorDetails: Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
          logs: { productLogs: productLogs.slice(-200), imageLogs: imageLogs.slice(-200) },
        },
      });

      // Check limit
      if (limit > 0 && totalProcessed >= limit) {
        addLog(`Limite atteinte : ${totalProcessed}/${limit}`);
        break;
      }

      // Next page
      if (!nextCursor) break;
      cursor = nextCursor;
    }

    // Mark completed
    addLog(`Synchronisation terminée : ${totalCreated} créés, ${totalUpdated} mis à jour, ${totalSkipped} ignorés, ${totalErrors} erreurs`);
    await prisma.ankorstoreSyncJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        processedProducts: totalProcessed,
        createdProducts: totalCreated,
        updatedProducts: totalUpdated,
        skippedProducts: totalSkipped,
        errorProducts: totalErrors,
        logs: { productLogs, imageLogs },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] Sync fatal error", { jobId, error: message });
    addLog(`ERREUR FATALE : ${message}`);
    await prisma.ankorstoreSyncJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: message.substring(0, 5000),
        logs: { productLogs, imageLogs },
      },
    });
  }
}

// ── Single product sync ──

async function syncSingleProduct(
  akProduct: AkProduct,
  akVariants: AkVariant[],
): Promise<SyncResult> {
  const firstSku = akVariants[0]?.sku;
  if (!firstSku) {
    return { action: "skipped", reference: akProduct.name, error: "No variants" };
  }

  const reference = extractReferenceFromSku(firstSku);

  try {
    const existing = await prisma.product.findUnique({
      where: { reference },
      include: { colors: true },
    });

    if (existing) {
      await updateExistingProduct(existing, akProduct, akVariants);
      addLog(`✓ Mis à jour : ${reference}`);
      return { action: "updated", reference };
    }

    await createNewProduct(reference, akProduct, akVariants);
    addLog(`+ Créé : ${reference}`);
    return { action: "created", reference };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addLog(`✗ Erreur ${reference} : ${message}`);
    return { action: "error", reference, error: message };
  }
}

// ── Create new product ──

async function createNewProduct(
  reference: string,
  akProduct: AkProduct,
  akVariants: AkVariant[],
): Promise<void> {
  let categoryId = categoryCache.get(String(akProduct.productTypeId));
  if (!categoryId) {
    // Auto-create category from Ankorstore productTypeId
    const typeName = `Ankorstore ${akProduct.productTypeId}`;
    const typeSlug = `ankorstore-${akProduct.productTypeId}`;
    const created = await prisma.category.create({
      data: { name: typeName, slug: typeSlug },
    });
    categoryId = created.id;
    categoryCache.set(String(akProduct.productTypeId), categoryId);

    // Also save the mapping for future syncs
    await prisma.ankorstoreMapping.upsert({
      where: { type_akValue: { type: "productType", akValue: String(akProduct.productTypeId) } },
      create: {
        type: "productType",
        akValue: String(akProduct.productTypeId),
        akName: typeName,
        bjEntityId: categoryId,
        bjName: typeName,
      },
      update: { bjEntityId: categoryId, bjName: typeName },
    });

    addLog(`📁 Catégorie créée : ${typeName}`);
  }

  const product = await prisma.product.create({
    data: {
      reference,
      name: akProduct.name,
      description: akProduct.description,
      categoryId,
      status: akProduct.active ? "ONLINE" : "OFFLINE",
      akProductId: akProduct.id,
      akSyncStatus: "synced",
      akSyncedAt: new Date(),
    },
  });

  for (let i = 0; i < akVariants.length; i++) {
    const akVariant = akVariants[i];
    const colorName = extractColorFromSku(akVariant.sku);

    const colorId = await findOrCreateColor(colorName);

    const productColor = await prisma.productColor.create({
      data: {
        productId: product.id,
        colorId,
        unitPrice: akPriceToBj(akVariant.wholesalePrice),
        weight: 0.1,
        stock: akVariant.stockQuantity ?? 0,
        isPrimary: i === 0,
        saleType: "UNIT",
        akVariantId: akVariant.id,
      },
    });

    await downloadVariantImages(productColor.id, product.id, colorId, akVariant.images, reference);
  }
}

// ── Update existing product ──

async function updateExistingProduct(
  existing: { id: string; colors: { id: string; akVariantId: string | null; unitPrice: unknown; stock: number }[] },
  akProduct: AkProduct,
  akVariants: AkVariant[],
): Promise<void> {
  await prisma.product.update({
    where: { id: existing.id },
    data: {
      akProductId: akProduct.id,
      akSyncStatus: "synced",
      akSyncedAt: new Date(),
      akSyncError: null,
    },
  });

  for (const akVariant of akVariants) {
    const bjColor = existing.colors.find((c) => c.akVariantId === akVariant.id);
    if (bjColor) {
      await prisma.productColor.update({
        where: { id: bjColor.id },
        data: {
          unitPrice: akPriceToBj(akVariant.wholesalePrice),
          stock: akVariant.stockQuantity ?? bjColor.stock,
        },
      });
    }
  }
}

// ── Image download ──

let activeImageDownloads = 0;

async function downloadVariantImages(
  productColorId: string,
  productId: string,
  colorId: string | null,
  images: { order: number; url: string }[],
  reference: string,
): Promise<void> {
  for (const img of images) {
    while (activeImageDownloads >= IMAGE_CONCURRENCY) {
      await new Promise((r) => setTimeout(r, 100));
    }

    activeImageDownloads++;
    try {
      const cleanUrl = img.url.split("?")[0];
      addImageLog(`Téléchargement : ${reference} image ${img.order}`);

      const res = await fetch(cleanUrl, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        addImageLog(`✗ Échec téléchargement ${reference} image ${img.order} (${res.status})`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1024) {
        addImageLog(`✗ Image trop petite ${reference} image ${img.order} (${buffer.length}B)`);
        continue;
      }

      // processProductImage handles WebP conversion, 3-size generation, and R2 upload internally.
      // Filename: "<reference>_<timestamp>_<order>" to avoid collisions.
      const filename = `${reference}_${Date.now()}_${img.order}`;
      const { dbPath } = await processProductImage(buffer, "public/uploads/products", filename);

      await prisma.productColorImage.create({
        data: {
          productColorId,
          productId,
          colorId: colorId || "", // colorId from the variant's color
          path: dbPath,
          order: img.order - 1,
        },
      });

      addImageLog(`✓ Image ${reference} ${img.order} uploadée`);
    } catch (err) {
      addImageLog(`✗ Erreur image ${reference} ${img.order}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      activeImageDownloads--;
    }
  }
}

// ── Color helper ──

async function findOrCreateColor(name: string): Promise<string | null> {
  if (!name) return null;

  const normalized = name.toUpperCase().trim();
  if (colorCache.has(normalized)) return colorCache.get(normalized)!;

  const existing = await prisma.color.findFirst({
    where: { name: name.trim() },
  });

  if (existing) {
    colorCache.set(normalized, existing.id);
    return existing.id;
  }

  const created = await prisma.color.create({
    data: { name: name.trim(), hex: "#808080" },
  });

  colorCache.set(normalized, created.id);
  return created.id;
}
