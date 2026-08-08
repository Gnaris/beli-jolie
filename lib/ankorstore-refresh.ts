/**
 * Ankorstore Refresh — Mode callback-only (kickoff + 2 finalize handlers).
 *
 * Stratégie 2-phases :
 *   1. Phase DELETE_OLD : on supprime l'ancien produit (POST /operations/delete)
 *      et on attend le callback. La row `AnkorstoreOperation` (type
 *      REFRESH_DELETE_OLD) porte dans son `payload` le `productInput` figé du
 *      nouveau produit à créer après la suppression.
 *   2. Phase CREATE_NEW : déclenchée par le webhook après confirmation du
 *      delete, on crée le nouveau produit (POST import operation). La row
 *      `AnkorstoreOperation` (type REFRESH_CREATE_NEW) porte le payload publish
 *      classique (firstSku, skuToBjVariantId, allVariantsOutOfStock).
 *   3. Webhook finalize → lookup ankorsProductId via SKU, sauvegarde locale,
 *      bump `lastRefreshedAt`.
 *
 * Si une étape échoue, on désaccouple le produit local
 * (`ankorsProductId = null`) pour permettre un retry via « Publier ».
 */

import { prisma } from "@/lib/prisma";
import { Prisma, type AnkorstoreOperation } from "@prisma/client";
import {
  ankorstoreKickoffDelete,
  ankorstoreCreateCatalogOperation,
  ankorstoreAddProductsToOperation,
  ankorstoreStartOperation,
  ankorstoreLookupProductIdBySku,
  type AnkorstoreCatalogProductInput,
} from "@/lib/ankorstore-api-write";
import {
  ankorstoreGetProduct,
  ankorstoreGetVariants,
} from "@/lib/ankorstore-api";
import {
  buildPublishProductInput,
  readCallbackStatus,
  extractFailureReason,
  fetchDetailedFailureMessage,
  type AnkorstorePublishPayload,
} from "@/lib/ankorstore-publish";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";
import { getCachedAnkorstoreEnabled } from "@/lib/cached-data";

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

export type AnkorstoreRefreshKickoffResult =
  | { success: true; operationId: string }
  | { success: false; reason: "not_found"; error: string }
  | { success: false; reason: "error"; error: string };

/** Payload sauvegardé pour REFRESH_DELETE_OLD. */
export interface AnkorstoreRefreshDeleteOldPayload {
  oldAnkorsProductId: string;
  reference: string;
  // Le produit à créer en phase 2 — figé à l'instant du clic « Rafraîchir ».
  nextProductInput: AnkorstoreCatalogProductInput;
  nextPublishPayload: AnkorstorePublishPayload;
  // SKU de l'ancien produit (gardés pour pouvoir retry sur "Could not archive SKUs")
  oldVariantSkus: string[];
  // Compteur de retry — incrémenté à chaque "Could not archive SKUs" failure.
  archiveRetryCount?: number;
}

const MAX_ARCHIVE_RETRIES = 3;

// ─────────────────────────────────────────────
// Kickoff (Phase 1 : delete old)
// ─────────────────────────────────────────────

/**
 * Lance la première phase du refresh : suppression de l'ancien produit sur
 * Ankorstore. Le webhook déclenchera la phase 2 (création du nouveau).
 */
export async function ankorstoreKickoffRefresh(
  productId: string,
): Promise<AnkorstoreRefreshKickoffResult> {
  // Kill switch : si Ankorstore est désactivé dans Paramètres, refuse
  // immédiatement — même si l'appelant contourne le worker de la file.
  if (!(await getCachedAnkorstoreEnabled())) {
    return {
      success: false,
      reason: "error",
      error: "La marketplace Ankorstore est désactivée dans Paramètres > Marketplaces.",
    };
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, reference: true, ankorsProductId: true },
  });

  if (!product) {
    return { success: false, reason: "error", error: "Produit introuvable en base" };
  }
  if (!product.ankorsProductId) {
    return {
      success: false,
      reason: "not_found",
      error: "Produit non publié sur Ankorstore",
    };
  }

  const oldAnkorsProductId = product.ankorsProductId;

  // Refuse if another publish/refresh operation is already in flight for this
  // product — superseding would corrupt the 2-phase delete/create chain.
  // A 30-min cutoff lets us recover from genuinely stuck PENDING ops (lost
  // webhook) by allowing a fresh attempt after that delay.
  const inflight = await prisma.ankorstoreOperation.findFirst({
    where: {
      productId,
      status: "PENDING",
      type: { in: ["PUBLISH", "REFRESH_DELETE_OLD", "REFRESH_CREATE_NEW"] },
      createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) },
    },
  });
  if (inflight) {
    return {
      success: false,
      reason: "error",
      error:
        "Une opération Ankorstore est déjà en cours sur ce produit. Patientez quelques minutes ou consultez la file en bas à droite.",
    };
  }

  try {
    // Step 1: Verify old product exists on Ankorstore
    const oldExisting = await ankorstoreGetProduct(oldAnkorsProductId);
    if (!oldExisting) {
      return {
        success: false,
        reason: "not_found",
        error: "Produit Ankorstore introuvable",
      };
    }

    // Si le produit est déjà archivé côté Ankorstore, on ne peut RIEN faire :
    // l'API refuse de l'archiver (déjà fait) ET refuse de le réactiver via
    // l'opération update. La désarchivation se fait uniquement via le brand
    // dashboard Ankorstore. Validé en réel 2026-05-12.
    if (oldExisting.archived) {
      return {
        success: false,
        reason: "error",
        error:
          "Le produit est archivé sur Ankorstore et ne peut pas être rafraîchi. " +
          "Désarchivez-le sur https://www.ankorstore.com/brand-dashboard puis réessayez.",
      };
    }

    // Step 2: Fetch old SKUs (required by the delete endpoint)
    let oldVariantSkus: string[] = [];
    try {
      const oldVariants = await ankorstoreGetVariants(oldAnkorsProductId);
      oldVariantSkus = oldVariants
        .map((v) => v.sku)
        .filter((s): s is string => !!s && s.trim().length > 0);
    } catch (err) {
      logger.warn("[Ankorstore Refresh] getVariants failed", {
        ankorsProductId: oldAnkorsProductId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (oldVariantSkus.length === 0) {
      return {
        success: false,
        reason: "error",
        error:
          "Impossible de récupérer les SKU des variantes Ankorstore. Réessayez d'ici quelques minutes.",
      };
    }

    const oldExternalId = oldExisting.externalId ?? product.reference;

    // Step 3: Build the FUTURE product input (frozen for phase 2)
    const built = await buildPublishProductInput(productId);
    if (!built.ok) {
      return { success: false, reason: "error", error: built.error };
    }

    // Step 4: Kick off the delete operation
    const { operationId } = await ankorstoreKickoffDelete(oldExternalId, oldVariantSkus);

    const payload: AnkorstoreRefreshDeleteOldPayload = {
      oldAnkorsProductId,
      reference: product.reference,
      nextProductInput: built.input,
      nextPublishPayload: built.payload,
      oldVariantSkus,
      archiveRetryCount: 0,
    };

    logger.info("[Ankorstore Refresh] Persisting REFRESH_DELETE_OLD row", {
      operationId,
      productId,
      reference: product.reference,
    });
    const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");
    await persistAnkorstoreOperation({
      id: operationId,
      productId,
      type: "REFRESH_DELETE_OLD",
      payload: payload as unknown as Prisma.InputJsonValue,
      context: "Ankorstore Refresh",
    });

    logger.info("[Ankorstore Refresh] Kicked off (DELETE_OLD)", {
      operationId,
      productId,
      reference: product.reference,
    });

    return { success: true, operationId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Refresh] Kickoff failed", { productId, error: err });
    return { success: false, reason: "error", error: errorMsg };
  }
}

// ─────────────────────────────────────────────
// Finalize Phase 1 (DELETE_OLD callback) → kicks off Phase 2
// ─────────────────────────────────────────────

/**
 * Finalize the DELETE_OLD phase. On success, kicks off the CREATE_NEW phase.
 * On failure, clears the local ankorsProductId (so user can retry via Publier).
 */
export async function ankorstoreFinalizeRefreshDeleteOld(
  op: AnkorstoreOperation,
  callbackPayload: unknown,
): Promise<void> {
  // Accept PENDING (normal flow) and CANCELLED (orphan recovery — webhook
  // route already verified no superseding op exists for this product).
  if (op.status !== "PENDING" && op.status !== "CANCELLED") {
    logger.info("[Ankorstore Refresh] Delete-old finalize skipped — already terminal", {
      operationId: op.id,
      status: op.status,
    });
    return;
  }

  const callbackStatus = readCallbackStatus(callbackPayload);
  const payload = op.payload as unknown as AnkorstoreRefreshDeleteOldPayload;

  if (callbackStatus !== "succeeded" && callbackStatus !== "partially_failed") {
    // Delete failed. Si la raison est "Could not archive SKUs" (bug transitoire
    // côté Ankorstore), on retente en lançant une nouvelle delete operation,
    // jusqu'à MAX_ARCHIVE_RETRIES fois.
    const detailed = await fetchDetailedFailureMessage(op.id);
    const baseReason = detailed ?? extractFailureReason(callbackPayload);
    const isArchiveFailure = /could not archive/i.test(baseReason);
    const currentRetry = payload.archiveRetryCount ?? 0;

    if (isArchiveFailure && currentRetry < MAX_ARCHIVE_RETRIES) {
      // Re-kick une nouvelle DELETE_OLD avec compteur incrémenté
      try {
        const { operationId: retryOpId } = await ankorstoreKickoffDelete(
          payload.reference,
          payload.oldVariantSkus,
        );
        const nextPayload: AnkorstoreRefreshDeleteOldPayload = {
          ...payload,
          archiveRetryCount: currentRetry + 1,
        };
        logger.info("[Ankorstore Refresh] Persisting REFRESH_DELETE_OLD retry row", {
          operationId: retryOpId,
          previousOpId: op.id,
          productId: op.productId,
        });
        await prisma.$transaction([
          prisma.ankorstoreOperation.update({
            where: { id: op.id },
            data: {
              status: "CANCELLED",
              callbackPayload: callbackPayload as Prisma.InputJsonValue,
              errorMessage: `Retry archive (${currentRetry + 1}/${MAX_ARCHIVE_RETRIES})`,
              completedAt: new Date(),
            },
          }),
          prisma.ankorstoreOperation.create({
            data: {
              id: retryOpId,
              productId: op.productId,
              type: "REFRESH_DELETE_OLD",
              status: "PENDING",
              payload: nextPayload as unknown as Prisma.InputJsonValue,
            },
          }),
        ]);
        logger.info("[Ankorstore Refresh] Delete-old retry kicked off", {
          previousOpId: op.id,
          newOpId: retryOpId,
          attempt: currentRetry + 1,
          productId: op.productId,
        });
        return;
      } catch (err) {
        logger.error("[Ankorstore Refresh] Retry kickoff failed", {
          operationId: op.id,
          error: err,
        });
        // Tombera dans le bloc FAILED ci-dessous
      }
    }

    await prisma.ankorstoreOperation.update({
      where: { id: op.id },
      data: {
        status: "FAILED",
        callbackPayload: callbackPayload as Prisma.InputJsonValue,
        errorMessage: `Suppression de l'ancien produit échouée: ${baseReason}`,
        completedAt: new Date(),
      },
    });
    logger.warn("[Ankorstore Refresh] Delete-old failed — aborting refresh", {
      operationId: op.id,
      productId: op.productId,
      status: callbackStatus,
      retries: currentRetry,
    });
    return;
  }

  // Old deleted. Mark phase 1 done and kick off phase 2.
  try {
    const { operationId: newOpId } = await ankorstoreCreateCatalogOperation("import");
    const addResp = await ankorstoreAddProductsToOperation(newOpId, [payload.nextProductInput]);
    if (addResp.totalProductsCount === 0) {
      throw new Error("Ankorstore n'a accepté aucun produit (payload silencieusement rejeté).");
    }
    await ankorstoreStartOperation(newOpId);

    logger.info("[Ankorstore Refresh] Persisting REFRESH_CREATE_NEW row", {
      operationId: newOpId,
      deleteOpId: op.id,
      productId: op.productId,
    });
    await prisma.$transaction([
      prisma.ankorstoreOperation.update({
        where: { id: op.id },
        data: {
          status: "SUCCEEDED",
          callbackPayload: callbackPayload as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      }),
      prisma.ankorstoreOperation.create({
        data: {
          id: newOpId,
          productId: op.productId,
          type: "REFRESH_CREATE_NEW",
          status: "PENDING",
          payload: payload.nextPublishPayload as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    logger.info("[Ankorstore Refresh] Phase 1 done, Phase 2 kicked off", {
      deleteOpId: op.id,
      createOpId: newOpId,
      productId: op.productId,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Old is deleted, but we couldn't kick off CREATE. Clear local ankorsProductId.
    await prisma.$transaction([
      prisma.product.update({
        where: { id: op.productId },
        data: {
          ankorsProductId: null,
          ankorsLastSyncSnapshot: Prisma.DbNull,
        },
      }),
      prisma.productColor.updateMany({
        where: { productId: op.productId },
        data: { ankorsVariantId: null },
      }),
      prisma.ankorstoreOperation.update({
        where: { id: op.id },
        data: {
          status: "FAILED",
          callbackPayload: callbackPayload as Prisma.InputJsonValue,
          errorMessage: `Phase 1 OK mais phase 2 (création) refusée : ${errorMsg}. Vous pouvez relancer via « Publier ».`,
          completedAt: new Date(),
        },
      }),
    ]);

    logger.error("[Ankorstore Refresh] Phase 2 kickoff failed after delete", {
      operationId: op.id,
      productId: op.productId,
      error: err,
    });
  }
}

// ─────────────────────────────────────────────
// Finalize Phase 2 (CREATE_NEW callback)
// ─────────────────────────────────────────────

/**
 * Finalize the CREATE_NEW phase. Same as publish finalize but bumps
 * lastRefreshedAt so the product appears as « Nouveauté ».
 */
export async function ankorstoreFinalizeRefreshCreateNew(
  op: AnkorstoreOperation,
  callbackPayload: unknown,
): Promise<void> {
  // Accept PENDING (normal flow) and CANCELLED (orphan recovery — webhook
  // route already verified no superseding op exists for this product).
  if (op.status !== "PENDING" && op.status !== "CANCELLED") {
    logger.info("[Ankorstore Refresh] Create-new finalize skipped — already terminal", {
      operationId: op.id,
      status: op.status,
    });
    return;
  }

  const callbackStatus = readCallbackStatus(callbackPayload);
  const payload = op.payload as unknown as AnkorstorePublishPayload;

  if (callbackStatus === "failed" || callbackStatus === "skipped") {
    // Create failed. Old is gone, new wasn't created. Clear local ankorsProductId.
    const detailed = await fetchDetailedFailureMessage(op.id);
    const baseReason = detailed ?? extractFailureReason(callbackPayload);
    await prisma.$transaction([
      prisma.product.update({
        where: { id: op.productId },
        data: {
          ankorsProductId: null,
          ankorsLastSyncSnapshot: Prisma.DbNull,
        },
      }),
      prisma.productColor.updateMany({
        where: { productId: op.productId },
        data: { ankorsVariantId: null },
      }),
      prisma.ankorstoreOperation.update({
        where: { id: op.id },
        data: {
          status: "FAILED",
          callbackPayload: callbackPayload as Prisma.InputJsonValue,
          errorMessage: `Création du nouveau produit échouée : ${baseReason}. Vous pouvez relancer via « Publier ».`,
          completedAt: new Date(),
        },
      }),
    ]);
    logger.warn("[Ankorstore Refresh] Create-new failed", {
      operationId: op.id,
      productId: op.productId,
      status: callbackStatus,
    });
    return;
  }

  // succeeded or partially_failed — lookup product ID
  try {
    const ankorsProductId = await ankorstoreLookupProductIdBySku(payload.firstSku);
    if (!ankorsProductId) {
      throw new Error(
        `Produit créé mais introuvable via le SKU "${payload.firstSku}".`,
      );
    }

    const variants = await ankorstoreGetVariants(ankorsProductId);
    const ankorsVariantBySku = new Map(
      variants.filter((v) => v.sku != null).map((v) => [v.sku as string, v.id]),
    );

    const variantIdUpdates: { localVariantId: string; ankorsVariantId: string }[] = [];
    for (const [sku, bjVariantId] of Object.entries(payload.skuToBjVariantId)) {
      const ankorsVariantId = ankorsVariantBySku.get(sku);
      if (ankorsVariantId) {
        variantIdUpdates.push({ localVariantId: bjVariantId, ankorsVariantId });
      } else {
        logger.warn("[Ankorstore Refresh] Variant ID not found", { sku, ankorsProductId });
      }
    }

    await prisma.$transaction([
      prisma.product.update({
        where: { id: op.productId },
        data: {
          ankorsProductId,
          ankorsLastSyncSnapshot: Prisma.DbNull,
          // Refresh complet (delete + recreate) → tout est aligné avec Ankorstore
          ankorsSyncRequired: false,
          lastRefreshedAt: new Date(),
        },
      }),
      ...variantIdUpdates.map((u) =>
        prisma.productColor.update({
          where: { id: u.localVariantId },
          data: { ankorsVariantId: u.ankorsVariantId },
        }),
      ),
      prisma.ankorstoreOperation.update({
        where: { id: op.id },
        data: {
          status: callbackStatus === "succeeded" ? "SUCCEEDED" : "PARTIALLY_FAILED",
          callbackPayload: callbackPayload as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      }),
    ]);

    revalidateTag("products", "default");
    emitProductEvent({ type: "PRODUCT_UPDATED", productId: op.productId });

    logger.info("[Ankorstore Refresh] Phase 2 finalized", {
      operationId: op.id,
      ankorsProductId,
      variantsMapped: variantIdUpdates.length,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.ankorstoreOperation.update({
      where: { id: op.id },
      data: {
        status: "FAILED",
        callbackPayload: callbackPayload as Prisma.InputJsonValue,
        errorMessage: errorMsg,
        completedAt: new Date(),
      },
    });
    logger.error("[Ankorstore Refresh] Create-new finalize error", {
      operationId: op.id,
      productId: op.productId,
      error: err,
    });
  }
}
