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
  ankorstoreLookupProductIdBySku,
  AnkorstoreSharedOperationError,
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

        // Persister la nouvelle op CREATE_NEW. En cas de P2002 avec un autre
        // productId, on est victime d'un opId partagé — ne PAS rebrancher le
        // job dessus (sinon orphelin : le webhook finalisera l'autre produit
        // et le nôtre restera AWAITING_CALLBACK à jamais).
        const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");
        const persistResult = await persistAnkorstoreOperation({
          id: newOpId,
          productId: member.productId,
          type: "REFRESH_CREATE_NEW",
          payload: member.nextPublishPayload as unknown as Prisma.InputJsonValue,
          context: "Ankorstore Batch Refresh Phase 2",
        });

        if (!persistResult.inserted && !persistResult.sameProduct) {
          // Opération Ankor partagée avec un autre produit → même traitement
          // que AnkorstoreSharedOperationError : fail explicite.
          throw new AnkorstoreSharedOperationError(newOpId, 1, 2);
        }

        await prisma.marketplaceRefreshJob.updateMany({
          where: {
            productId: member.productId,
            marketplace: "ANKORSTORE",
            status: "AWAITING_CALLBACK",
            ankorsOperationId: op.id,
          },
          data: { ankorsOperationId: newOpId },
        });

        logger.info("[Ankorstore Batch Refresh] Phase 2 kicked off", {
          batchOpId: op.id,
          createOpId: newOpId,
          productId: member.productId,
          reference: member.reference,
        });
        succeededCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isShared = err instanceof AnkorstoreSharedOperationError;

        // Cas fusion Ankor : la fiche est peut-être bien créée chez eux via
        // l'op fusionnée. Tenter un lookup par SKU avant d'unlink — si trouvé,
        // on rebranche proprement et on marque le job SUCCEEDED.
        if (isShared) {
          const recovered = await tryRecoverBySku(op.id, member);
          if (recovered) {
            logger.info(
              "[Ankorstore Batch Refresh] Récupéré via lookup SKU après fusion Ankor",
              {
                batchOpId: op.id,
                productId: member.productId,
                reference: member.reference,
                newAnkorsProductId: recovered.ankorsProductId,
              },
            );
            succeededCount++;
            continue;
          }
        }

        // Phase 1 OK côté Ankor (delete fait) mais phase 2 refusée sans
        // récupération possible. On lâche le lien local (ankorsProductId =
        // null) pour permettre un « Publier » manuel après correction.
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
          isShared
            ? `Ankorstore a fusionné cette création avec un autre kickoff et la fiche est introuvable. Cliquez « Publier » pour recréer.`
            : `Phase 1 OK mais phase 2 (création) refusée : ${msg}. Vous pouvez relancer via « Publier ».`,
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

/**
 * Récupération inline quand Ankor a fusionné notre kickoff avec un autre.
 * On lookup le nouveau ankorsProductId via le firstSku figé dans le member
 * (identique à ce qu'on a envoyé à Ankor), puis on rebranche Product +
 * ProductColor et on finalise le job. Retourne null si le SKU n'est pas
 * indexé chez Ankor (donc la fusion a en fait rejeté notre produit).
 *
 * Constaté prod 2026-08-12 : Ankor met parfois 15-20s à indexer un SKU
 * après le succès de l'op import. Retries généreux (jusqu'à ~40s) pour
 * laisser le temps à l'index.
 */
async function tryRecoverBySku(
  batchOpId: string,
  member: AnkorstoreBatchRefreshMember,
): Promise<{ ankorsProductId: string } | null> {
  try {
    const firstSku = member.nextPublishPayload.firstSku;
    const skuToBjVariantId = member.nextPublishPayload.skuToBjVariantId;
    if (!firstSku || !skuToBjVariantId) return null;

    // maxAttempts=6, delays cumul : 3+5+8+8+8+8 = 40s
    const ankorsProductId = await ankorstoreLookupProductIdBySku(firstSku, {
      maxAttempts: 6,
      initialDelayMs: 3000,
      pollDelayMs: 8000,
    });
    if (!ankorsProductId) return null;

    const variants = await ankorstoreGetVariants(ankorsProductId);
    const variantBySku = new Map(
      variants.filter((v) => v.sku != null).map((v) => [v.sku as string, v.id]),
    );

    const variantIdUpdates: { localVariantId: string; ankorsVariantId: string }[] = [];
    for (const [sku, bjVariantId] of Object.entries(skuToBjVariantId)) {
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
          ankorsOperationId: batchOpId,
        },
        data: {
          status: "SUCCEEDED",
          ankorsOutcome: {
            ok: true,
            archived: false,
            warning: "Ankorstore avait fusionné l'opération — synchronisé via SKU.",
          } as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      }),
    ]);

    return { ankorsProductId };
  } catch (err) {
    logger.warn("[Ankorstore Batch Refresh] Recovery by SKU failed", {
      batchOpId,
      productId: member.productId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
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
