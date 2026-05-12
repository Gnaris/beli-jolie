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
import { ankorstoreGetVariants } from "@/lib/ankorstore-api";
import {
  readCallbackStatus,
  extractFailureReason,
  fetchDetailedFailureMessage,
} from "@/lib/ankorstore-publish";
import { logger } from "@/lib/logger";

export type AnkorstoreDeleteKickoffResult =
  | { success: true; operationId: string }
  | { success: false; error: string };

/** Payload sauvegardé pour DELETE (rien d'utile à finaliser au-delà du log). */
export interface AnkorstoreDeletePayload {
  reference: string;
  oldAnkorsProductId: string;
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

    const { operationId } = await ankorstoreKickoffDelete(reference, skus);

    const payload: AnkorstoreDeletePayload = { reference, oldAnkorsProductId: ankorsProductId };

    await prisma.ankorstoreOperation.create({
      data: {
        id: operationId,
        productId,
        type: "DELETE",
        status: "PENDING",
        payload: payload as unknown as Prisma.InputJsonValue,
      },
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
 * Finalize a DELETE operation. Just records the outcome; no DB mutations
 * needed (the local product was deleted synchronously by the admin action).
 */
export async function ankorstoreFinalizeDelete(
  op: AnkorstoreOperation,
  callbackPayload: unknown,
): Promise<void> {
  if (op.status !== "PENDING") return;

  const callbackStatus = readCallbackStatus(callbackPayload);

  if (callbackStatus === "succeeded" || callbackStatus === "partially_failed") {
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
