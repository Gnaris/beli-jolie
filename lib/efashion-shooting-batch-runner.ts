/**
 * eFashion — Orchestre l'envoi groupé de la file shooting.
 *
 * Le contrat clé : **un seul ticket de shooting créé** côté eFashion pour
 * l'ensemble des produits (PUBLISH + nouvelles fiches issues des REFRESH).
 *
 * Visibilité côté UI : chaque produit a une ligne MarketplaceRefreshJob créée
 * en IN_PROGRESS avant l'appel à ce runner. Au fil des résultats, on met à
 * jour chaque ligne en SUCCEEDED/FAILED → le widget marketplace en bas à
 * droite affiche la progression comme pour les autres marketplaces.
 *
 * Stratégie :
 *   - Si seulement PUBLISH : `efashionPublishProductsBatch`
 *   - Si seulement REFRESH : `efashionRefreshProductsBatch`
 *   - Si les 2 : on lance REFRESH d'abord (qui contient un publish batch interne
 *     pour ses nouvelles fiches), puis PUBLISH derrière (avec son propre shooting)
 *
 * ⚠️ La V1 mélange : si l'utilisatrice a PUBLISH + REFRESH dans la même
 * file, ça créera 2 shootings (1 pour les refresh, 1 pour les publish).
 * Pour fusionner en 1 seul, il faudra étendre `efashionPublishProductsBatch`
 * pour accepter aussi les nouvelles fiches issues des refresh — refacto à
 * envisager en V2 si l'utilisatrice signale que 2 tickets pour 1 validation
 * la dérange.
 */

import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { efashionPublishProductsBatch } from "@/lib/efashion-publish-batch";
import { efashionRefreshProductsBatch } from "@/lib/efashion-refresh-batch";

export interface RunBatchInput {
  toPublish: string[];
  toRefresh: string[];
  /** productId → MarketplaceRefreshJob id (pour mettre à jour le statut au fil de l'eau) */
  jobIdByProduct: Record<string, string>;
}

export interface RunBatchOutcome {
  totalAttempted: number;
  totalSucceeded: number;
  totalFailed: number;
  errors: Array<{ productId: string; error: string }>;
}

interface ItemOutcome {
  productId: string;
  success: boolean;
  error?: string;
}

async function markJobDone(
  jobId: string,
  productId: string,
  success: boolean,
  errorMessage: string | undefined,
): Promise<void> {
  const outcome = success
    ? { ok: true as const, archived: false }
    : { ok: false as const, kind: "error" as const, message: errorMessage ?? "Erreur inconnue" };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: success ? "SUCCEEDED" : "FAILED",
      efashionOutcome: outcome as Prisma.InputJsonValue,
      errorMessage: success ? null : (errorMessage ?? null),
      completedAt: new Date(),
    },
  });
  // Best-effort : on rafraîchit les pages admin pour que le produit affiche
  // tout de suite son nouveau badge eFashion (vert si succès).
  try {
    revalidatePath("/admin/produits");
    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidateTag("products", "default");
  } catch {
    // hors contexte de requête en background → no-op
  }
}

export async function runEfashionShootingBatch(
  input: RunBatchInput,
): Promise<RunBatchOutcome> {
  const errors: Array<{ productId: string; error: string }> = [];
  let succeeded = 0;
  let failed = 0;

  const updateAll = async (results: ItemOutcome[]) => {
    for (const r of results) {
      const jobId = input.jobIdByProduct[r.productId];
      if (jobId) {
        await markJobDone(jobId, r.productId, r.success, r.error);
      }
      if (r.success) succeeded++;
      else {
        failed++;
        errors.push({ productId: r.productId, error: r.error ?? "Erreur inconnue" });
      }
    }
  };

  if (input.toRefresh.length > 0) {
    logger.info("[eFashion Shooting Batch] Démarrage refresh groupé", {
      count: input.toRefresh.length,
    });
    const outcome = await efashionRefreshProductsBatch(input.toRefresh);
    await updateAll(
      outcome.results.map((r) => ({
        productId: r.productId,
        success: r.success,
        error: r.error,
      })),
    );
    logger.info("[eFashion Shooting Batch] Refresh groupé terminé", {
      success: outcome.results.filter((r) => r.success).length,
      failed: outcome.results.filter((r) => !r.success).length,
    });
  }

  if (input.toPublish.length > 0) {
    logger.info("[eFashion Shooting Batch] Démarrage publish groupé", {
      count: input.toPublish.length,
    });
    const outcome = await efashionPublishProductsBatch(input.toPublish);
    await updateAll(
      outcome.results.map((r) => ({
        productId: r.productId,
        success: r.success,
        error: r.error,
      })),
    );
    logger.info("[eFashion Shooting Batch] Publish groupé terminé", {
      success: outcome.results.filter((r) => r.success).length,
      failed: outcome.results.filter((r) => !r.success).length,
    });
  }

  return {
    totalAttempted: input.toPublish.length + input.toRefresh.length,
    totalSucceeded: succeeded,
    totalFailed: failed,
    errors,
  };
}
