import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { akGetVariant, bjPriceToAk } from "@/lib/ankorstore-api";
import { akUpdateStock, akUpdatePrices } from "@/lib/ankorstore-api-write";

/**
 * Fire-and-forget trigger — call after product save in BJ.
 */
export function triggerAnkorstoreSync(productId: string): void {
  syncProductToAnkorstore(productId).catch((err) => {
    logger.error("[Ankorstore Reverse] Fatal error", {
      productId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function syncProductToAnkorstore(productId: string): Promise<void> {
  // Mark as pending
  await prisma.product.update({
    where: { id: productId },
    data: { akSyncStatus: "pending", akSyncError: null },
  });

  try {
    // Load product with colors that have akVariantId
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        colors: {
          where: { akVariantId: { not: null } },
          select: {
            id: true,
            akVariantId: true,
            unitPrice: true,
            stock: true,
          },
        },
      },
    });

    if (!product || !product.akProductId) {
      logger.info("[Ankorstore Reverse] Product not linked to Ankorstore", { productId });
      await prisma.product.update({
        where: { id: productId },
        data: { akSyncStatus: null },
      });
      return;
    }

    if (product.colors.length === 0) {
      logger.info("[Ankorstore Reverse] No linked variants", { productId });
      await prisma.product.update({
        where: { id: productId },
        data: { akSyncStatus: "synced", akSyncedAt: new Date() },
      });
      return;
    }

    let changesApplied = 0;

    for (const bjColor of product.colors) {
      const akVariantId = bjColor.akVariantId!;

      try {
        // Fetch current AK state
        const akVariant = await akGetVariant(akVariantId);

        // Compare stock
        const bjStock = bjColor.stock;
        const akStock = akVariant.stockQuantity;

        if (!akVariant.isAlwaysInStock && akStock !== bjStock) {
          await akUpdateStock(akVariantId, { stockQuantity: bjStock });
          changesApplied++;
          logger.info("[Ankorstore Reverse] Stock updated", {
            variantId: akVariantId,
            from: akStock,
            to: bjStock,
          });
        }

        // Compare price
        const bjPriceCentimes = bjPriceToAk(Number(bjColor.unitPrice));
        if (akVariant.wholesalePrice !== bjPriceCentimes) {
          // Maintain the same ratio for retail price
          const ratio = akVariant.retailPrice / akVariant.wholesalePrice;
          const newRetailPrice = Math.round(bjPriceCentimes * ratio);

          await akUpdatePrices(akVariantId, {
            wholesalePrice: bjPriceCentimes,
            retailPrice: newRetailPrice,
          });
          changesApplied++;
          logger.info("[Ankorstore Reverse] Price updated", {
            variantId: akVariantId,
            from: akVariant.wholesalePrice,
            to: bjPriceCentimes,
          });
        }
      } catch (err) {
        logger.warn("[Ankorstore Reverse] Variant sync failed", {
          variantId: akVariantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Mark synced
    await prisma.product.update({
      where: { id: productId },
      data: {
        akSyncStatus: "synced",
        akSyncError: null,
        akSyncedAt: new Date(),
      },
    });

    logger.info("[Ankorstore Reverse] Sync complete", {
      productId,
      changesApplied,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.product.update({
      where: { id: productId },
      data: {
        akSyncStatus: "failed",
        akSyncError: message.substring(0, 5000),
      },
    });
    throw err;
  }
}
