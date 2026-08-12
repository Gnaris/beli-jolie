/**
 * Finalize d'un batch REFRESH_DELETE_OLD.
 *
 * Le callback Ankor pour un batch delete donne le status global de l'op. On
 * fetch `/operations/{id}/results` pour obtenir le détail par produit puis on
 * dispatch :
 *   - Produit succès → kickoff phase 2 CREATE_NEW individuel (mutex protégé,
 *     import endpoint qui accepte la parallélisation) → update
 *     `MarketplaceRefreshJob.ankorsOperationId` du produit pour pointer sur
 *     la nouvelle op CREATE_NEW.
 *   - Produit échec → marque le job FAILED avec la raison, ne touche pas
 *     `ankorsProductId` du produit (l'ancienne fiche est peut-être encore là).
 */

import { prisma } from "@/lib/prisma";
import { Prisma, type AnkorstoreOperation } from "@prisma/client";
import { logger } from "@/lib/logger";
import {
  ankorstoreCreateCatalogOperation,
  ankorstoreAddProductsToOperation,
  ankorstoreStartOperation,
  ankorstoreFetchOperationResults,
} from "@/lib/ankorstore-api-write";
import { ankorstoreKickoffMutex } from "@/lib/ankorstore-kickoff-mutex";
import { translateAnkorstoreErrorBundle } from "@/lib/ankorstore-error-fr";
import {
  readCallbackStatus,
  extractFailureReason,
} from "@/lib/ankorstore-publish";
import type {
  AnkorstoreBatchRefreshDeleteOldPayload,
  AnkorstoreBatchRefreshMember,
} from "@/lib/ankorstore-refresh-batch";

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
  // aiguiller correctement.
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

  // Index par externalId — chaque member a un externalId qui matche.
  const resultByExternalId = new Map<string, (typeof results)[number]>();
  for (const r of results) resultByExternalId.set(r.externalProductId, r);

  let succeededCount = 0;
  let failedCount = 0;

  for (const member of payload.members) {
    const result = resultByExternalId.get(member.externalId);
    if (!result) {
      // Ankor n'a pas rendu de résultat pour ce produit → considérer comme échec.
      await failMemberJob(
        op.id,
        member,
        `Aucun résultat Ankorstore pour ce produit (external_id=${member.externalId}).`,
      );
      failedCount++;
      continue;
    }

    if (result.status === "success") {
      // Phase 2 : kickoff CREATE_NEW individuel pour ce produit (mutex protégé
      // — l'endpoint import supporte le parallèle en séquentiel via mutex).
      try {
        const newOpId = await ankorstoreKickoffMutex(async () => {
          const { operationId } = await ankorstoreCreateCatalogOperation("import");
          const addResp = await ankorstoreAddProductsToOperation(operationId, [
            member.nextProductInput,
          ]);
          if (addResp.totalProductsCount === 0) {
            throw new Error(
              "Ankorstore n'a accepté aucun produit (payload silencieusement rejeté).",
            );
          }
          await ankorstoreStartOperation(operationId);
          return operationId;
        });

        // Persister la nouvelle op CREATE_NEW et rebrancher le job du produit
        // dessus.
        await prisma.$transaction([
          prisma.ankorstoreOperation.create({
            data: {
              id: newOpId,
              productId: member.productId,
              type: "REFRESH_CREATE_NEW",
              status: "PENDING",
              payload: member.nextPublishPayload as unknown as Prisma.InputJsonValue,
              tenantId: op.tenantId ?? null,
            },
          }),
          prisma.marketplaceRefreshJob.updateMany({
            where: {
              productId: member.productId,
              marketplace: "ANKORSTORE",
              status: "AWAITING_CALLBACK",
              ankorsOperationId: op.id,
            },
            data: { ankorsOperationId: newOpId },
          }),
        ]);

        logger.info("[Ankorstore Batch Refresh] Phase 2 kicked off", {
          batchOpId: op.id,
          createOpId: newOpId,
          productId: member.productId,
          reference: member.reference,
        });
        succeededCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Phase 1 OK côté Ankor (delete fait) mais phase 2 refusée. On lâche
        // le lien local (ankorsProductId = null) pour permettre un « Publier »
        // manuel après correction.
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
          `Phase 1 OK mais phase 2 (création) refusée : ${msg}. Vous pouvez relancer via « Publier ».`,
        );
        failedCount++;
      }
    } else {
      // Ankor a échoué la suppression pour ce produit. On garde l'ancienne
      // fiche telle quelle (ankorsProductId inchangé) et on marque le job
      // FAILED.
      const readable = result.failureReason
        ? translateAnkorstoreErrorBundle(result.failureReason)
        : "Suppression Ankorstore refusée";
      await failMemberJob(op.id, member, readable);
      failedCount++;
    }
  }

  // Marquer l'op batch DELETE_OLD terminée.
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
  logger.info("[Ankorstore Batch Refresh] DELETE_OLD finalized", {
    operationId: op.id,
    succeeded: succeededCount,
    failed: failedCount,
    finalStatus,
  });
}

async function failEntireBatch(
  op: AnkorstoreOperation,
  payload: AnkorstoreBatchRefreshDeleteOldPayload,
  callbackPayload: unknown,
  reason: string,
): Promise<void> {
  logger.warn("[Ankorstore Batch Refresh] Entire batch failed", {
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
