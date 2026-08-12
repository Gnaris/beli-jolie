/**
 * Ankorstore Delete — Mode callback-only (kickoff + finalize).
 *
 * Pour supprimer un produit existant sur Ankorstore. Le kickoff lit les SKUs
 * actuels sur Ankorstore (nécessaires au payload de delete) puis envoie la
 * requête. Le webhook confirmera plus tard via `ankorstoreFinalizeDelete`.
 *
 * Utilisé par les server actions de suppression admin (mass + single).
 */

import { prisma } from "@/lib/prisma";
import { Prisma, type AnkorstoreOperation } from "@prisma/client";
import { ankorstoreKickoffDelete } from "@/lib/ankorstore-api-write";
import { ankorstoreKickoffMutex } from "@/lib/ankorstore-kickoff-mutex";
import { ankorstoreGetVariants } from "@/lib/ankorstore-api";
import {
  readCallbackStatus,
  extractFailureReason,
  fetchDetailedFailureMessage,
} from "@/lib/ankorstore-publish";
import {
  ANKORSTORE_SNAPSHOT_VERSION,
  type AnkorstoreSyncSnapshot,
} from "@/lib/ankorstore-sync-diff";
import { logger } from "@/lib/logger";

export type AnkorstoreDeleteKickoffResult =
  | { success: true; operationId: string }
  | { success: false; error: string };

/**
 * Payload sauvegardé pour DELETE.
 *
 * - Suppression complète (produit retiré entièrement) : seuls reference et
 *   oldAnkorsProductId sont posés.
 * - Suppression partielle (une/plusieurs couleurs retirées d'un produit qui
 *   reste publié) : `variantOnlyDeletedAnkorsVariantIds` liste les IDs AS à
 *   purger du snapshot local au moment du finalize.
 */
export interface AnkorstoreDeletePayload {
  reference: string;
  oldAnkorsProductId: string;
  variantOnlyDeletedAnkorsVariantIds?: string[];
}

/**
 * Lance la suppression d'un produit sur Ankorstore. Demande les SKUs actuels
 * (le payload de delete exige une liste non vide) puis envoie la requête.
 */
export async function ankorstoreKickoffStandaloneDelete(args: {
  productId: string;
  reference: string;
  ankorsProductId: string;
}): Promise<AnkorstoreDeleteKickoffResult> {
  const { productId, reference, ankorsProductId } = args;

  // Cancel any earlier pending op for this product (they're moot once we delete)
  await prisma.ankorstoreOperation.updateMany({
    where: { productId, status: "PENDING" },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  try {
    const variants = await ankorstoreGetVariants(ankorsProductId);
    const skus = variants
      .map((v) => v.sku)
      .filter((s): s is string => !!s && s.trim().length > 0);
    if (skus.length === 0) {
      return {
        success: false,
        error:
          "Aucune variante trouvée sur Ankorstore — impossible de supprimer (la suppression sans SKU est silencieusement ignorée par l'API).",
      };
    }

    const operationId = await ankorstoreKickoffMutex(async () => {
      const { operationId } = await ankorstoreKickoffDelete(reference, skus);

      const payload: AnkorstoreDeletePayload = { reference, oldAnkorsProductId: ankorsProductId };

      logger.info("[Ankorstore Delete] Persisting DELETE row", {
        operationId,
        productId,
        reference,
        skuCount: skus.length,
      });
      const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");
      await persistAnkorstoreOperation({
        id: operationId,
        productId,
        type: "DELETE",
        payload: payload as unknown as Prisma.InputJsonValue,
        context: "Ankorstore Delete",
      });
      return operationId;
    });

    logger.info("[Ankorstore Delete] Kicked off", {
      operationId,
      productId,
      reference,
      skuCount: skus.length,
    });

    return { success: true, operationId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Delete] Kickoff failed", { productId, error: err });
    return { success: false, error: errorMsg };
  }
}

/**
 * Lance la suppression PARTIELLE de variantes (couleurs supprimées localement)
 * d'un produit qui reste publié sur Ankorstore. Le finalize purgera ces
 * variantes du snapshot local sur succès.
 */
export async function ankorstoreKickoffVariantDelete(args: {
  productId: string;
  reference: string;
  ankorsProductId: string;
  removedVariants: { ankorsVariantId: string; sku: string }[];
}): Promise<AnkorstoreDeleteKickoffResult> {
  const { productId, reference, ankorsProductId, removedVariants } = args;

  if (removedVariants.length === 0) {
    return { success: false, error: "Aucune variante à supprimer" };
  }

  try {
    const skus = removedVariants
      .map((v) => v.sku)
      .filter((s): s is string => !!s && s.trim().length > 0);
    if (skus.length === 0) {
      return { success: false, error: "Aucun SKU valide pour la suppression partielle" };
    }

    const operationId = await ankorstoreKickoffMutex(async () => {
      const { operationId } = await ankorstoreKickoffDelete(reference, skus);

      const payload: AnkorstoreDeletePayload = {
        reference,
        oldAnkorsProductId: ankorsProductId,
        variantOnlyDeletedAnkorsVariantIds: removedVariants.map((v) => v.ankorsVariantId),
      };

      logger.info("[Ankorstore Delete] Persisting variant-only DELETE row", {
        operationId,
        productId,
        reference,
        skuCount: skus.length,
      });
      const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");
      await persistAnkorstoreOperation({
        id: operationId,
        productId,
        type: "DELETE",
        payload: payload as unknown as Prisma.InputJsonValue,
        context: "Ankorstore Delete",
      });
      return operationId;
    });

    logger.info("[Ankorstore Delete] Variant-only kickoff", {
      operationId,
      productId,
      reference,
      skuCount: skus.length,
    });

    return { success: true, operationId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Delete] Variant-only kickoff failed", {
      productId,
      reference,
      error: err,
    });
    return { success: false, error: errorMsg };
  }
}

/**
 * Finalize a DELETE operation.
 *
 * - Suppression complète : juste journaliser, le produit local est déjà parti.
 * - Suppression partielle (variantOnlyDeletedAnkorsVariantIds présent) :
 *   sur succès, retirer ces variantes du snapshot pour que le diff suivant
 *   ne tente pas de re-supprimer. Sur échec, laisser le snapshot intact pour
 *   pouvoir réessayer.
 */
export async function ankorstoreFinalizeDelete(
  op: AnkorstoreOperation,
  callbackPayload: unknown,
): Promise<void> {
  if (op.status !== "PENDING") return;

  const callbackStatus = readCallbackStatus(callbackPayload);
  const payload = op.payload as unknown as AnkorstoreDeletePayload;
  const variantOnlyIds = payload.variantOnlyDeletedAnkorsVariantIds ?? [];

  if (callbackStatus === "succeeded" || callbackStatus === "partially_failed") {
    if (variantOnlyIds.length > 0) {
      try {
        const product = await prisma.product.findUnique({
          where: { id: op.productId },
          select: { ankorsLastSyncSnapshot: true },
        });
        const raw = product?.ankorsLastSyncSnapshot;
        if (raw && typeof raw === "object") {
          const snapshot = raw as Partial<AnkorstoreSyncSnapshot>;
          if (
            snapshot.schemaVersion === ANKORSTORE_SNAPSHOT_VERSION &&
            snapshot.variants
          ) {
            const cleanedVariants = { ...snapshot.variants };
            for (const vid of variantOnlyIds) delete cleanedVariants[vid];
            const cleanedSnapshot: AnkorstoreSyncSnapshot = {
              ...(snapshot as AnkorstoreSyncSnapshot),
              variants: cleanedVariants,
            };
            await prisma.product.update({
              where: { id: op.productId },
              data: {
                ankorsLastSyncSnapshot:
                  cleanedSnapshot as unknown as Prisma.InputJsonValue,
              },
            });
          }
        }
      } catch (err) {
        logger.error("[Ankorstore Delete] Snapshot cleanup failed", {
          operationId: op.id,
          productId: op.productId,
          error: err,
        });
      }
    }

    await prisma.ankorstoreOperation.update({
      where: { id: op.id },
      data: {
        status: callbackStatus === "succeeded" ? "SUCCEEDED" : "PARTIALLY_FAILED",
        callbackPayload: callbackPayload as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    logger.info("[Ankorstore Delete] Finalized", {
      operationId: op.id,
      productId: op.productId,
      status: callbackStatus,
      variantOnly: variantOnlyIds.length > 0,
    });
    return;
  }

  const detailed = await fetchDetailedFailureMessage(op.id);
  const errorMessage = detailed ?? extractFailureReason(callbackPayload);
  await prisma.ankorstoreOperation.update({
    where: { id: op.id },
    data: {
      status: "FAILED",
      callbackPayload: callbackPayload as Prisma.InputJsonValue,
      errorMessage,
      completedAt: new Date(),
    },
  });
  logger.warn("[Ankorstore Delete] Operation failed", {
    operationId: op.id,
    productId: op.productId,
    status: callbackStatus,
    errorMessage,
  });
}
