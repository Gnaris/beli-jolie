/**
 * Ankorstore Refresh — Delete + re-import a product to make it appear as "new"
 *
 * Flow:
 * 1. Search Ankorstore for existing variant SKUs
 * 2. Delete the product from Ankorstore (3-step async operation)
 * 3. Clear local ankorsProductId so re-push treats it as "import"
 * 4. Re-push the product as a new import
 * 5. Update local createdAt → now
 */

import { prisma } from "@/lib/prisma";
import { ankorstoreSearchVariants } from "@/lib/ankorstore-api";
import { ankorstoreDeleteProduct } from "@/lib/ankorstore-api-write";
import { pushProductToAnkorstoreInternal } from "@/app/actions/admin/ankorstore";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";

export interface AnkorstoreRefreshProgress {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

type ProgressCallback = (progress: AnkorstoreRefreshProgress) => void;

export async function ankorstoreRefreshProduct(
  productId: string,
  onProgress?: ProgressCallback,
): Promise<{ success: boolean; error?: string }> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      reference: true,
      ankorsProductId: true,
    },
  });

  if (!product) return { success: false, error: "Produit introuvable" };

  const progress: AnkorstoreRefreshProgress = {
    productId,
    productName: product.name,
    reference: product.reference,
    status: "in_progress",
  };

  const report = (step: string) => {
    progress.step = step;
    onProgress?.(progress);
  };

  try {
    // ── Step 1: Search Ankorstore for existing variant SKUs ──
    report("Recherche des variantes sur Ankorstore...");
    const ankorsVariants = await ankorstoreSearchVariants({ skuOrName: product.reference });
    const skus = ankorsVariants
      .map((v) => v.sku)
      .filter((s): s is string => !!s && s.startsWith(product.reference));

    if (skus.length === 0) {
      logger.warn("[Ankorstore Refresh] No variants found, skipping delete step", { reference: product.reference });
    }

    // ── Step 2: Delete from Ankorstore ──
    if (skus.length > 0) {
      report(`Suppression d'Ankorstore (${skus.length} variantes)...`);
      logger.info("[Ankorstore Refresh] Deleting product", { reference: product.reference, skuCount: skus.length });

      const deleteResult = await ankorstoreDeleteProduct(product.reference, skus);

      if (!deleteResult.success) {
        // Non-fatal: log warning and continue — the re-import as "update" will still work
        logger.warn("[Ankorstore Refresh] Delete failed, will attempt re-push as update", {
          reference: product.reference,
          error: deleteResult.error,
        });
      } else {
        logger.info("[Ankorstore Refresh] Delete succeeded", { reference: product.reference });
      }
    }

    // ── Step 3: Clear local link so re-push treats it as "import" ──
    report("Préparation de la re-création...");
    await prisma.product.update({
      where: { id: productId },
      data: {
        ankorsProductId: null,
        ankorsMatchedAt: null,
        ankorsSyncStatus: null,
        ankorsSyncError: null,
        ankorsSyncedAt: null,
      },
    });
    logger.info("[Ankorstore Refresh] Cleared local Ankorstore link", { productId });

    // ── Step 4: Re-push as new import ──
    report("Re-création sur Ankorstore...");
    const pushResult = await pushProductToAnkorstoreInternal(productId, "import", { skipRevalidation: true, forceCreate: true });

    if (!pushResult.success) {
      throw new Error(pushResult.error || "Échec de la re-création sur Ankorstore");
    }

    // ── Step 5: Update local createdAt ──
    report("Mise à jour de la date de création...");
    await prisma.product.update({
      where: { id: productId },
      data: { createdAt: new Date() },
    });

    // ── Step 6: Invalidate caches & notify ──
    revalidateTag("products", "default");
    emitProductEvent({ type: "PRODUCT_UPDATED", productId });

    logger.info("[Ankorstore Refresh] Successfully refreshed product", { reference: product.reference });
    progress.status = "success";
    progress.step = "Terminé";
    onProgress?.(progress);

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Refresh] Error refreshing product", { reference: product.reference, error: errorMsg });

    progress.status = "error";
    progress.error = errorMsg;
    onProgress?.(progress);

    return { success: false, error: errorMsg };
  }
}
