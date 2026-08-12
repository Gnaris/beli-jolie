/**
 * Ankorstore Batch Refresh — Phase 1 (delete groupé).
 *
 * Permet de rafraîchir N produits en UN SEUL POST delete côté Ankor. Levé pour
 * contourner le comportement de dédup silencieux de l'endpoint delete d'Ankor :
 * si on fait 2 POST séquentiels (même à 10 s d'intervalle), Ankor renvoie
 * l'opId de la précédente et IGNORE le nouveau payload (vérifié en réel
 * 2026-08-12).
 *
 * Design :
 *   - 1 op batch = 1 row `AnkorstoreOperation` avec id = opId Ankor
 *   - `productId` = premier produit du batch (contrainte NOT NULL Prisma)
 *   - `payload.batch = true` — discriminant lu par le webhook finalize
 *   - `payload.members[]` — liste des produits avec toutes les données figées
 *     nécessaires à la phase 2 (nextProductInput + nextPublishPayload)
 *   - Tous les `MarketplaceRefreshJob` du batch ont `ankorsOperationId` = id
 *     de cette op batch.
 *
 * Une fois le callback reçu :
 *   - Le finalize batch itère sur `/operations/{id}/results`, dispatch par
 *     `externalProductId`, et pour chaque produit succès kick une phase 2
 *     CREATE_NEW **individuelle** (via mutex kickoff import — safe pour
 *     concurrence > 1). Pour chaque produit échec : marque le job FAILED.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getCachedAnkorstoreEnabled } from "@/lib/cached-data";
import {
  ankorstoreKickoffBatchDelete,
  type AnkorstoreCatalogProductInput,
} from "@/lib/ankorstore-api-write";
import { ankorstoreKickoffMutex } from "@/lib/ankorstore-kickoff-mutex";
import {
  ankorstoreGetProduct,
  ankorstoreGetVariants,
} from "@/lib/ankorstore-api";
import {
  buildPublishProductInput,
  type AnkorstorePublishPayload,
} from "@/lib/ankorstore-publish";

// ─────────────────────────────────────────────
// Types (partagés avec le finalize webhook)
// ─────────────────────────────────────────────

export interface AnkorstoreBatchRefreshMember {
  productId: string;
  reference: string;
  externalId: string;
  oldAnkorsProductId: string;
  oldVariantSkus: string[];
  nextProductInput: AnkorstoreCatalogProductInput;
  nextPublishPayload: AnkorstorePublishPayload;
}

export interface AnkorstoreBatchRefreshDeleteOldPayload {
  batch: true;
  members: AnkorstoreBatchRefreshMember[];
}

export type AnkorstoreBatchRefreshResult =
  | {
      success: true;
      operationId: string;
      memberProductIds: string[]; // les produits effectivement inclus
      rejectedByProductId: Record<string, string>; // { productId: raison } — produits filtrés
    }
  | { success: false; error: string; rejectedByProductId: Record<string, string> };

// ─────────────────────────────────────────────
// Kickoff
// ─────────────────────────────────────────────

/**
 * Lance un batch refresh sur N produits. Le callback pour l'op retournée
 * contiendra les résultats des N produits.
 *
 * Chaque produit est chargé, validé, ses SKU récupérés chez Ankor. Les
 * produits qui échouent à cette étape sont retournés dans
 * `rejectedByProductId` — le batch continue avec les autres.
 *
 * Si TOUS les produits sont rejetés → `{ success: false }`.
 */
export async function ankorstoreKickoffBatchRefresh(
  productIds: string[],
): Promise<AnkorstoreBatchRefreshResult> {
  if (productIds.length === 0) {
    return {
      success: false,
      error: "[Batch Refresh] Liste de produits vide",
      rejectedByProductId: {},
    };
  }

  if (!(await getCachedAnkorstoreEnabled())) {
    return {
      success: false,
      error: "La marketplace Ankorstore est désactivée dans Paramètres > Marketplaces.",
      rejectedByProductId: Object.fromEntries(
        productIds.map((id) => [id, "kill switch actif"]),
      ),
    };
  }

  const rejected: Record<string, string> = {};
  const members: AnkorstoreBatchRefreshMember[] = [];
  const deletePayload: { externalId: string; variantSkus: string[] }[] = [];

  for (const productId of productIds) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, reference: true, ankorsProductId: true },
    });
    if (!product) {
      rejected[productId] = "Produit introuvable en base";
      continue;
    }
    if (!product.ankorsProductId) {
      rejected[productId] = "Produit non publié sur Ankorstore";
      continue;
    }

    // Anti-double-refresh : refuse si une op refresh récente est PENDING.
    const inflight = await prisma.ankorstoreOperation.findFirst({
      where: {
        productId,
        status: "PENDING",
        type: { in: ["PUBLISH", "REFRESH_DELETE_OLD", "REFRESH_CREATE_NEW"] },
        createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) },
      },
    });
    if (inflight) {
      rejected[productId] =
        "Une opération Ankorstore est déjà en cours sur ce produit.";
      continue;
    }

    // Charger le produit chez Ankor pour récupérer external_id + SKUs actuels.
    try {
      const oldExisting = await ankorstoreGetProduct(product.ankorsProductId);
      if (!oldExisting) {
        rejected[productId] = "Produit Ankorstore introuvable";
        continue;
      }
      if (oldExisting.archived) {
        rejected[productId] =
          "Produit archivé sur Ankorstore — désarchivez via le brand dashboard.";
        continue;
      }

      const oldVariants = await ankorstoreGetVariants(product.ankorsProductId);
      const oldVariantSkus = oldVariants
        .map((v) => v.sku)
        .filter((s): s is string => !!s && s.trim().length > 0);
      if (oldVariantSkus.length === 0) {
        rejected[productId] =
          "SKUs Ankorstore introuvables — réessayez d'ici quelques minutes.";
        continue;
      }

      const externalId = oldExisting.externalId ?? product.reference;

      const built = await buildPublishProductInput(productId);
      if (!built.ok) {
        rejected[productId] = built.error;
        continue;
      }

      members.push({
        productId,
        reference: product.reference,
        externalId,
        oldAnkorsProductId: product.ankorsProductId,
        oldVariantSkus,
        nextProductInput: built.input,
        nextPublishPayload: built.payload,
      });
      deletePayload.push({ externalId, variantSkus: oldVariantSkus });
    } catch (err) {
      rejected[productId] = err instanceof Error ? err.message : String(err);
    }
  }

  if (members.length === 0) {
    return {
      success: false,
      error: "Aucun produit valide dans le batch",
      rejectedByProductId: rejected,
    };
  }

  // POST unique — sous mutex par prudence (défend aussi contre les concurrents
  // publish/update qui pourraient nous voler l'opId Ankor).
  try {
    const { operationId } = await ankorstoreKickoffMutex(() =>
      ankorstoreKickoffBatchDelete(deletePayload),
    );

    const batchPayload: AnkorstoreBatchRefreshDeleteOldPayload = {
      batch: true,
      members,
    };

    // Persister l'op AVANT tout callback. `productId` colonne = 1er du batch
    // (contrainte Prisma NOT NULL) ; les membres réels sont dans le payload.
    logger.info("[Ankorstore Batch Refresh] Persisting REFRESH_DELETE_OLD (batch)", {
      operationId,
      batchSize: members.length,
      productIds: members.map((m) => m.productId),
    });
    const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");
    await persistAnkorstoreOperation({
      id: operationId,
      productId: members[0].productId,
      type: "REFRESH_DELETE_OLD",
      payload: batchPayload as unknown as Prisma.InputJsonValue,
      context: "Ankorstore Batch Refresh",
    });

    logger.info("[Ankorstore Batch Refresh] Kicked off (DELETE_OLD)", {
      operationId,
      batchSize: members.length,
      references: members.map((m) => m.reference),
    });

    return {
      success: true,
      operationId,
      memberProductIds: members.map((m) => m.productId),
      rejectedByProductId: rejected,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Batch Refresh] Kickoff failed", {
      batchSize: members.length,
      error: err,
    });
    return {
      success: false,
      error: errorMsg,
      rejectedByProductId: rejected,
    };
  }
}

/** Type guard pour distinguer un payload batch d'un payload single. */
export function isBatchRefreshPayload(
  payload: unknown,
): payload is AnkorstoreBatchRefreshDeleteOldPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { batch?: unknown }).batch === true &&
    Array.isArray((payload as { members?: unknown }).members)
  );
}
