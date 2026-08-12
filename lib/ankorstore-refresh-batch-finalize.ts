/**
 * Finalize d'un batch REFRESH_DELETE_OLD + Phase 2 batch CREATE_NEW.
 *
 * Le callback Ankor pour un batch delete donne le status global de l'op. On
 * fetch `/operations/{id}/results` pour obtenir le détail par produit puis on
 * enchaîne :
 *   - Produits succès → **1 seul POST import** groupé pour tous à la fois
 *     (Phase 2 batch). Zéro risque de dédup Ankor puisqu'un seul kickoff.
 *   - Produits échec delete → marque leurs jobs FAILED, ne touche pas
 *     `ankorsProductId` du produit (l'ancienne fiche est peut-être encore là).
 *
 * Un second callback arrive plus tard pour le batch CREATE_NEW → on lookup
 * chaque produit par firstSku, on mappe les variantes, on finalise les N
 * jobs d'un coup.
 */

import { prisma } from "@/lib/prisma";
import { Prisma, type AnkorstoreOperation } from "@prisma/client";
import { logger } from "@/lib/logger";
import {
  ankorstoreCreateCatalogOperation,
  ankorstoreAddProductsToOperation,
  ankorstoreStartOperation,
  ankorstoreFetchOperationResults,
  ankorstoreLookupProductIdBySku,
} from "@/lib/ankorstore-api-write";
import { ankorstoreGetVariants } from "@/lib/ankorstore-api";
import { ankorstoreKickoffMutex } from "@/lib/ankorstore-kickoff-mutex";
import { translateAnkorstoreErrorBundle } from "@/lib/ankorstore-error-fr";
import {
  readCallbackStatus,
  extractFailureReason,
} from "@/lib/ankorstore-publish";
import type {
  AnkorstoreBatchRefreshDeleteOldPayload,
  AnkorstoreBatchRefreshCreateNewPayload,
  AnkorstoreBatchRefreshMember,
} from "@/lib/ankorstore-refresh-batch";

// ─────────────────────────────────────────────
// Phase 1 finalize + Phase 2 kickoff (batch)
// ─────────────────────────────────────────────

export async function finalizeBatchRefreshDeleteOld(
  op: AnkorstoreOperation,
  callbackPayload: unknown,
): Promise<void> {
  const callbackStatus = readCallbackStatus(callbackPayload);
  const payload = op.payload as unknown as AnkorstoreBatchRefreshDeleteOldPayload;

  logger.info("[Ankorstore Batch Refresh] Finalize DELETE_OLD", {
    operationId: op.id,
    batchSize: payload.members.length,
    callbackStatus,
  });

  // Cas simple : Ankor a rejeté ENTIÈREMENT le batch → tous les produits en
  // échec, aucun refresh ne s'est produit chez eux.
  if (callbackStatus === "failed" || callbackStatus === "skipped") {
    const reason = extractFailureReason(callbackPayload);
    await failEntireBatch(op, payload, callbackPayload, reason);
    return;
  }

  // succeeded ou partially_failed → on fetch le détail par produit pour
  // séparer les succès (à enchaîner en Phase 2) des échecs delete.
  let results: {
    externalProductId: string;
    status: "success" | "failure";
    failureReason: string | null;
    issues: unknown[];
  }[];
  try {
    results = await ankorstoreFetchOperationResults(op.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Batch Refresh] Fetch results failed", {
      operationId: op.id,
      error: msg,
    });
    await failEntireBatch(op, payload, callbackPayload, `Résultats introuvables : ${msg}`);
    return;
  }

  const resultByExternalId = new Map<string, (typeof results)[number]>();
  for (const r of results) resultByExternalId.set(r.externalProductId, r);

  const successMembers: AnkorstoreBatchRefreshMember[] = [];
  let deleteFailedCount = 0;

  for (const member of payload.members) {
    const result = resultByExternalId.get(member.externalId);
    if (!result) {
      await failMemberJob(
        op.id,
        member,
        `Aucun résultat Ankorstore pour ce produit (external_id=${member.externalId}).`,
      );
      deleteFailedCount++;
      continue;
    }

    if (result.status === "success") {
      successMembers.push(member);
    } else {
      const readable = result.failureReason
        ? translateAnkorstoreErrorBundle(result.failureReason)
        : "Suppression Ankorstore refusée";
      await failMemberJob(op.id, member, readable);
      deleteFailedCount++;
    }
  }

  // Aucun succès à enchaîner : batch DELETE terminé (échec total en Phase 1).
  if (successMembers.length === 0) {
    await prisma.ankorstoreOperation.update({
      where: { id: op.id },
      data: {
        status: "FAILED",
        callbackPayload: callbackPayload as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    logger.info("[Ankorstore Batch Refresh] DELETE_OLD terminé — aucune Phase 2 (tous en échec)", {
      operationId: op.id,
      failed: deleteFailedCount,
    });
    return;
  }

  // Phase 2 batch : 1 seul POST /operations avec les N produits successifs.
  // Bug 2026-08-12 : les N kickoffs individuels séquentiels sous mutex étaient
  // sujets à la dédup Ankor (POST /operations renvoie le même opId tant que
  // l'op précédente n'est pas totalement `started` côté leur backend). En
  // groupant en 1 seul kickoff, on élimine la classe de bug.
  let createOpId: string;
  try {
    createOpId = await ankorstoreKickoffMutex(async () => {
      const { operationId } = await ankorstoreCreateCatalogOperation("import");
      const addResp = await ankorstoreAddProductsToOperation(
        operationId,
        successMembers.map((m) => m.nextProductInput),
      );
      if (addResp.totalProductsCount !== successMembers.length) {
        // Dans le cas batch, mismatch = payload partiellement rejeté (rare) OU
        // l'op est réellement partagée (autre kickoff concurrent). On log
        // mais on continue avec start — le finalize CREATE_NEW ira chercher
        // les résultats par externalId pour dispatcher correctement.
        logger.warn(
          "[Ankorstore Batch Refresh] Phase 2 batch add partial ack",
          {
            operationId,
            sent: successMembers.length,
            acknowledged: addResp.totalProductsCount,
          },
        );
      }
      await ankorstoreStartOperation(operationId);
      return operationId;
    });
  } catch (err) {
    // Kickoff Phase 2 catastrophique : delete a réussi mais on n'a même pas
    // pu créer l'op import. On lâche le lien local pour permettre un Publier.
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Batch Refresh] Phase 2 batch kickoff failed", {
      batchOpId: op.id,
      batchSize: successMembers.length,
      error: err,
    });
    await prisma.ankorstoreOperation.update({
      where: { id: op.id },
      data: {
        status: deleteFailedCount === 0 ? "FAILED" : "PARTIALLY_FAILED",
        callbackPayload: callbackPayload as Prisma.InputJsonValue,
        errorMessage: `Phase 1 OK mais kickoff Phase 2 refusé : ${msg}`,
        completedAt: new Date(),
      },
    });
    for (const member of successMembers) {
      await prisma.$transaction([
        prisma.product.update({
          where: { id: member.productId },
          data: {
            ankorsProductId: null,
            ankorsLastSyncSnapshot: Prisma.DbNull,
          },
        }),
        prisma.productColor.updateMany({
          where: { productId: member.productId },
          data: { ankorsVariantId: null },
        }),
      ]);
      await failMemberJob(
        op.id,
        member,
        `Phase 1 OK mais Phase 2 (création groupée) refusée : ${msg}. Vous pouvez relancer via « Publier ».`,
      );
    }
    return;
  }

  // Persister la row batch CREATE_NEW (productId = 1er membre, contrainte
  // NOT NULL Prisma). Les membres réels sont dans payload.members[].
  const batchCreatePayload: AnkorstoreBatchRefreshCreateNewPayload = {
    batch: true,
    members: successMembers,
  };
  const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");
  await persistAnkorstoreOperation({
    id: createOpId,
    productId: successMembers[0].productId,
    type: "REFRESH_CREATE_NEW",
    payload: batchCreatePayload as unknown as Prisma.InputJsonValue,
    context: "Ankorstore Batch Refresh Phase 2",
  });

  // Rebrancher tous les jobs des membres succès sur cette op batch CREATE_NEW.
  await prisma.marketplaceRefreshJob.updateMany({
    where: {
      productId: { in: successMembers.map((m) => m.productId) },
      marketplace: "ANKORSTORE",
      status: "AWAITING_CALLBACK",
      ankorsOperationId: op.id,
    },
    data: { ankorsOperationId: createOpId },
  });

  logger.info("[Ankorstore Batch Refresh] Phase 2 batch kicked off", {
    batchDeleteOpId: op.id,
    batchCreateOpId: createOpId,
    successCount: successMembers.length,
    deleteFailedCount,
  });

  // Marquer l'op batch DELETE_OLD terminée. Phase 2 tourne maintenant chez
  // Ankor et sera finalisée par `finalizeBatchRefreshCreateNew` au callback.
  const deleteFinalStatus =
    deleteFailedCount === 0
      ? "SUCCEEDED"
      : "PARTIALLY_FAILED";
  await prisma.ankorstoreOperation.update({
    where: { id: op.id },
    data: {
      status: deleteFinalStatus,
      callbackPayload: callbackPayload as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
  logger.info("[Ankorstore Batch Refresh] DELETE_OLD finalized", {
    operationId: op.id,
    successMembers: successMembers.length,
    deleteFailed: deleteFailedCount,
    finalStatus: deleteFinalStatus,
  });
}

// ─────────────────────────────────────────────
// Phase 2 finalize (batch CREATE_NEW)
// ─────────────────────────────────────────────

/**
 * Finalize un batch REFRESH_CREATE_NEW. Le callback Ankor donne le status
 * global du batch import ; on fetch `/operations/{id}/results` pour le
 * détail par externalId, puis pour chaque produit succès on lookup
 * ankorsProductId + variantes et on met à jour la BDD.
 */
export async function finalizeBatchRefreshCreateNew(
  op: AnkorstoreOperation,
  callbackPayload: unknown,
): Promise<void> {
  const callbackStatus = readCallbackStatus(callbackPayload);
  const payload = op.payload as unknown as AnkorstoreBatchRefreshCreateNewPayload;

  logger.info("[Ankorstore Batch Refresh] Finalize CREATE_NEW", {
    operationId: op.id,
    batchSize: payload.members.length,
    callbackStatus,
  });

  if (callbackStatus === "failed" || callbackStatus === "skipped") {
    // Ankor a rejeté tout le batch import → tous les produits en échec, on
    // unlink les liens locaux.
    const reason = extractFailureReason(callbackPayload);
    await failBatchCreateNew(op, payload, callbackPayload, reason);
    return;
  }

  // Fetch résultats par externalId
  let results: {
    externalProductId: string;
    status: "success" | "failure";
    failureReason: string | null;
    issues: unknown[];
  }[];
  try {
    results = await ankorstoreFetchOperationResults(op.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Batch Refresh] Fetch CREATE_NEW results failed", {
      operationId: op.id,
      error: msg,
    });
    await failBatchCreateNew(op, payload, callbackPayload, `Résultats introuvables : ${msg}`);
    return;
  }

  const resultByExternalId = new Map<string, (typeof results)[number]>();
  for (const r of results) resultByExternalId.set(r.externalProductId, r);

  let succeededCount = 0;
  let failedCount = 0;

  for (const member of payload.members) {
    const result = resultByExternalId.get(member.externalId);
    if (!result || result.status !== "success") {
      const reason = result?.failureReason
        ? translateAnkorstoreErrorBundle(result.failureReason)
        : "Ankor n'a pas retourné de résultat pour ce produit dans le batch import";
      await failBatchMember(op.id, member, reason);
      failedCount++;
      continue;
    }

    try {
      const firstSku = member.nextPublishPayload.firstSku;
      const ankorsProductId = await ankorstoreLookupProductIdBySku(firstSku, {
        maxAttempts: 6,
        initialDelayMs: 3000,
        pollDelayMs: 8000,
      });
      if (!ankorsProductId) {
        throw new Error(`SKU ${firstSku} introuvable chez Ankor après 40 s d'attente`);
      }

      const variants = await ankorstoreGetVariants(ankorsProductId);
      const variantBySku = new Map(
        variants.filter((v) => v.sku != null).map((v) => [v.sku as string, v.id]),
      );
      const variantIdUpdates: { localVariantId: string; ankorsVariantId: string }[] = [];
      for (const [sku, bjVariantId] of Object.entries(member.nextPublishPayload.skuToBjVariantId)) {
        const ankorsVariantId = variantBySku.get(sku);
        if (ankorsVariantId) {
          variantIdUpdates.push({ localVariantId: bjVariantId, ankorsVariantId });
        }
      }

      await prisma.$transaction([
        prisma.product.update({
          where: { id: member.productId },
          data: {
            ankorsProductId,
            ankorsLastSyncSnapshot: Prisma.DbNull,
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
        prisma.marketplaceRefreshJob.updateMany({
          where: {
            productId: member.productId,
            marketplace: "ANKORSTORE",
            status: "AWAITING_CALLBACK",
            ankorsOperationId: op.id,
          },
          data: {
            status: "SUCCEEDED",
            ankorsOutcome: {
              ok: true,
              archived: false,
            } as unknown as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        }),
      ]);
      succeededCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("[Ankorstore Batch Refresh] CREATE_NEW member lookup failed", {
        batchOpId: op.id,
        productId: member.productId,
        reference: member.reference,
        error: msg,
      });
      await failBatchMember(op.id, member, msg);
      failedCount++;
    }
  }

  const finalStatus =
    failedCount === 0
      ? "SUCCEEDED"
      : succeededCount === 0
        ? "FAILED"
        : "PARTIALLY_FAILED";
  await prisma.ankorstoreOperation.update({
    where: { id: op.id },
    data: {
      status: finalStatus,
      callbackPayload: callbackPayload as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
  logger.info("[Ankorstore Batch Refresh] CREATE_NEW finalized", {
    operationId: op.id,
    succeeded: succeededCount,
    failed: failedCount,
    finalStatus,
  });
}

// ─────────────────────────────────────────────
// Helpers privés
// ─────────────────────────────────────────────

async function failEntireBatch(
  op: AnkorstoreOperation,
  payload: AnkorstoreBatchRefreshDeleteOldPayload,
  callbackPayload: unknown,
  reason: string,
): Promise<void> {
  logger.warn("[Ankorstore Batch Refresh] Entire batch DELETE failed", {
    operationId: op.id,
    batchSize: payload.members.length,
    reason,
  });
  await prisma.ankorstoreOperation.update({
    where: { id: op.id },
    data: {
      status: "FAILED",
      callbackPayload: callbackPayload as Prisma.InputJsonValue,
      errorMessage: reason,
      completedAt: new Date(),
    },
  });
  for (const member of payload.members) {
    await failMemberJob(
      op.id,
      member,
      `Suppression Ankorstore refusée pour tout le lot : ${reason}`,
    );
  }
}

async function failBatchCreateNew(
  op: AnkorstoreOperation,
  payload: AnkorstoreBatchRefreshCreateNewPayload,
  callbackPayload: unknown,
  reason: string,
): Promise<void> {
  logger.warn("[Ankorstore Batch Refresh] Batch CREATE_NEW rejeté", {
    operationId: op.id,
    batchSize: payload.members.length,
    reason,
  });
  await prisma.ankorstoreOperation.update({
    where: { id: op.id },
    data: {
      status: "FAILED",
      callbackPayload: callbackPayload as Prisma.InputJsonValue,
      errorMessage: reason,
      completedAt: new Date(),
    },
  });
  for (const member of payload.members) {
    await failBatchMember(
      op.id,
      member,
      `Création Ankorstore refusée pour tout le lot : ${reason}`,
    );
  }
}

async function failMemberJob(
  batchOpId: string,
  member: AnkorstoreBatchRefreshMember,
  message: string,
): Promise<void> {
  await prisma.marketplaceRefreshJob.updateMany({
    where: {
      productId: member.productId,
      marketplace: "ANKORSTORE",
      status: "AWAITING_CALLBACK",
      ankorsOperationId: batchOpId,
    },
    data: {
      status: "FAILED",
      errorMessage: message,
      completedAt: new Date(),
      ankorsOutcome: { ok: false, kind: "error", message } as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Fail un membre du batch CREATE_NEW : on unlink le produit local car
 * la fiche a été supprimée en Phase 1 mais la recréation a échoué.
 */
async function failBatchMember(
  batchOpId: string,
  member: AnkorstoreBatchRefreshMember,
  message: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.product.update({
      where: { id: member.productId },
      data: {
        ankorsProductId: null,
        ankorsLastSyncSnapshot: Prisma.DbNull,
      },
    }),
    prisma.productColor.updateMany({
      where: { productId: member.productId },
      data: { ankorsVariantId: null },
    }),
    prisma.marketplaceRefreshJob.updateMany({
      where: {
        productId: member.productId,
        marketplace: "ANKORSTORE",
        status: "AWAITING_CALLBACK",
        ankorsOperationId: batchOpId,
      },
      data: {
        status: "FAILED",
        errorMessage: `${message}. Cliquez « Publier » pour recréer.`,
        completedAt: new Date(),
        ankorsOutcome: {
          ok: false,
          kind: "error",
          message,
        } as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);
}
