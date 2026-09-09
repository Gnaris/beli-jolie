"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  verifyPfsProduct,
  loadPfsVerifyContext,
  type PfsVerifyResult,
  type PfsVerifyError,
  type PfsVerifyIssue,
} from "@/lib/pfs-verify";
import {
  applyPfsVerifyActions as applyPfsVerifyActionsCore,
  applyPfsVerifyPullsOnly,
  type PfsVerifyActionInput,
  type PfsVerifyApplyReport,
} from "@/lib/pfs-verify-apply";
import {
  computePfsPullEligibleMarketplaces,
  type PfsPullEligibleMarketplace,
} from "@/lib/pfs-verify-eligible-marketplaces";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export interface PfsVerifyOutcome {
  productId: string;
  reference: string;
  ok: boolean;
  status?: "ok" | "diff";
  issueCount?: number;
  /** Liste complète des écarts — permet à la pastille de peupler le tooltip
   *  immédiatement sans attendre un refresh de la liste des produits. */
  issues?: PfsVerifyIssue[];
  checkedAt?: string;
  /** Renseigné quand l'audit s'est fait en mode partiel (comparaison
   *  variantes uniquement). Cf. `PfsVerifyResult.partialAuditReason`. */
  partialAuditReason?: string;
  error?: { kind: PfsVerifyError["kind"]; message: string };
}

/**
 * Vérifie plusieurs produits PFS en parallèle (concurrency 5, aligné sur la
 * limite implicite de l'API PFS + rate-limit interne de fetchWithRetry).
 *
 * Écrit `pfsCheckedAt`, `pfsCheckStatus` et `pfsCheckIssues` sur chaque produit
 * dont la vérification aboutit. Les erreurs n'écrivent rien en base : le
 * produit reste dans son dernier état de vérif connu (l'utilisatrice voit le
 * message d'erreur via le toast côté client).
 */
export async function verifyPfsProducts(
  productIds: string[],
): Promise<{ success: true; outcomes: PfsVerifyOutcome[] } | { success: false; error: string }> {
  await requireAdmin();

  if (productIds.length === 0) {
    return { success: true, outcomes: [] };
  }

  // Charger les références pour retourner dans l'outcome (utile côté UI pour
  // les logs / toasts). Un findMany est bien plus économe qu'une lecture par
  // produit dans verifyPfsProduct + relookup ici.
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, reference: true, pfsProductId: true },
  });
  const refById = new Map(products.map((p) => [p.id, p.reference]));

  const outcomes: PfsVerifyOutcome[] = [];

  // Précharge une seule fois les tables globales PFS + configs BDD partagées
  // par tous les produits (évite 5 HTTP + 2 BDD redondants par produit).
  const verifyContext = await loadPfsVerifyContext();

  // Concurrency = 5 (mêmes limites que le refresh en lot). PFS a son propre
  // limiter à 2 slots côté fetchWithRetry, donc on ne le sature pas.
  const CONCURRENCY = 5;
  const queue = [...productIds];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const pid = queue.shift();
          if (!pid) return;
          const reference = refById.get(pid) ?? "?";
          try {
            const res = await verifyPfsProduct(pid, verifyContext);
            if (res.ok) {
              await persistVerifyResult(pid, res.result);
              outcomes.push({
                productId: pid,
                reference,
                ok: true,
                status: res.result.status,
                issueCount: res.result.issueCount,
                issues: res.result.issues,
                checkedAt: res.result.checkedAt,
                ...(res.result.partialAuditReason
                  ? { partialAuditReason: res.result.partialAuditReason }
                  : {}),
              });
            } else {
              outcomes.push({
                productId: pid,
                reference,
                ok: false,
                error: { kind: res.error.kind, message: res.error.message },
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("[PFS Verify] Worker crash", { productId: pid, error: msg });
            outcomes.push({
              productId: pid,
              reference,
              ok: false,
              error: { kind: "pfs_unreachable", message: msg },
            });
          }
        }
      })(),
    );
  }
  await Promise.all(workers);

  // Revalidate liste produits pour que la pastille se rafraîchisse sans full reload.
  revalidateTag("products", "default");

  return { success: true, outcomes };
}

async function persistVerifyResult(productId: string, result: PfsVerifyResult): Promise<void> {
  await prisma.product.update({
    where: { id: productId },
    data: {
      pfsCheckedAt: new Date(result.checkedAt),
      pfsCheckStatus: result.status,
      pfsCheckIssues:
        result.issues.length === 0
          ? Prisma.DbNull
          : (result.issues as unknown as Prisma.InputJsonValue),
    },
  });
}

/**
 * Vérifie un unique produit. Utilisé par le clic sur la pastille verte
 * (« Conforme · cliquez pour revérifier ») et sur l'icône « Non vérifié »
 * (état initial). Retourne l'issue list pour mise à jour optimiste côté UI.
 */
export async function verifySinglePfsProduct(
  productId: string,
): Promise<
  | { success: true; outcome: PfsVerifyOutcome }
  | { success: false; error: string }
> {
  const r = await verifyPfsProducts([productId]);
  if (!r.success) return { success: false, error: r.error };
  const outcome = r.outcomes[0];
  if (!outcome) {
    return { success: false, error: "Aucun résultat retourné" };
  }
  return { success: true, outcome };
}

/**
 * Applique les choix « Envoyer PFS » / « Prendre PFS » de la cliente sur les
 * écarts du produit, puis relance une vérification pour retourner l'état à
 * jour du tooltip.
 *
 * Retourne :
 *  - `report`  : synthèse des actions (appliquées / ignorées / erreurs).
 *  - `outcome` : nouveau résultat de vérification (peuple la pastille sans reload).
 */
export async function applyPfsVerifyActions(
  productId: string,
  actions: PfsVerifyActionInput[],
): Promise<
  | { success: true; report: PfsVerifyApplyReport; outcome: PfsVerifyOutcome }
  | { success: false; error: string }
> {
  await requireAdmin();

  if (!Array.isArray(actions) || actions.length === 0) {
    return { success: false, error: "Aucune action à appliquer" };
  }
  // Validation légère avant appel core (défense en profondeur).
  for (const a of actions) {
    if (typeof a?.key !== "string" || (a?.direction !== "push" && a?.direction !== "pull")) {
      return { success: false, error: "Action invalide (clé ou direction manquante)" };
    }
  }

  let report: PfsVerifyApplyReport;
  try {
    report = await applyPfsVerifyActionsCore(productId, actions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Verify Apply] Crash", { productId, error: msg });
    return { success: false, error: msg };
  }

  // Relancer une vérification pour tenir le tooltip à jour.
  const verifyRes = await verifyPfsProducts([productId]);
  if (!verifyRes.success) {
    return { success: false, error: verifyRes.error };
  }
  const outcome = verifyRes.outcomes[0];
  if (!outcome) {
    return { success: false, error: "Vérification post-application n'a rien retourné" };
  }

  revalidateTag("products", "default");
  return { success: true, report, outcome };
}

/**
 * Applique **uniquement les pulls** de façon synchrone, calcule les
 * marketplaces (Ankor / eFashion / Faire) éligibles à une propagation, et
 * retourne les pushs restants pour que l'UI puisse les enqueue en tâche de
 * fond via la file marketplace habituelle.
 *
 * Utilisé par la pastille PFS : quand la cliente clique « Valider » et qu'au
 * moins un « Prendre PFS » est demandé, ce endpoint lui rend la main tout de
 * suite avec :
 *  - `pulledCount`         : nombre de champs locaux modifiés (0 = rien
 *                            n'a changé chez nous).
 *  - `eligibleMarketplaces`: marketplaces sur lesquelles proposer la modale
 *                            de push (produit lié + non désactivé côté
 *                            produit + non désactivé côté système + configuré).
 *  - `remainingPushActions`: pushs à faire côté PFS, à enqueue tel quel dans
 *                            la marketplace queue par l'UI (mode "resync").
 *  - `outcome`             : nouveau résultat de vérification (rafraîchit
 *                            la pastille du produit).
 */
export async function applyPfsVerifyPullsAndCollect(
  productId: string,
  actions: PfsVerifyActionInput[],
): Promise<
  | {
      success: true;
      report: PfsVerifyApplyReport;
      pulledCount: number;
      eligibleMarketplaces: PfsPullEligibleMarketplace[];
      remainingPushActions: PfsVerifyActionInput[];
      outcome: PfsVerifyOutcome;
    }
  | { success: false; error: string }
> {
  await requireAdmin();

  if (!Array.isArray(actions) || actions.length === 0) {
    return { success: false, error: "Aucune action à appliquer" };
  }
  for (const a of actions) {
    if (typeof a?.key !== "string" || (a?.direction !== "push" && a?.direction !== "pull")) {
      return { success: false, error: "Action invalide (clé ou direction manquante)" };
    }
  }

  let pullsResult: Awaited<ReturnType<typeof applyPfsVerifyPullsOnly>>;
  try {
    pullsResult = await applyPfsVerifyPullsOnly(productId, actions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Verify PullsOnly] Crash", { productId, error: msg });
    return { success: false, error: msg };
  }

  const pulledCount = pullsResult.report.applied.filter(
    (a) => a.direction === "pull",
  ).length;

  const eligibleMarketplaces =
    pulledCount > 0 ? await computePfsPullEligibleMarketplaces(productId) : [];

  const verifyRes = await verifyPfsProducts([productId]);
  if (!verifyRes.success) {
    return { success: false, error: verifyRes.error };
  }
  const outcome = verifyRes.outcomes[0];
  if (!outcome) {
    return { success: false, error: "Vérification post-pull n'a rien retourné" };
  }

  revalidateTag("products", "default");
  return {
    success: true,
    report: pullsResult.report,
    pulledCount,
    eligibleMarketplaces,
    remainingPushActions: pullsResult.remainingPushActions,
    outcome,
  };
}
