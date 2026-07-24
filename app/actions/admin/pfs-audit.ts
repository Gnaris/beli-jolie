"use server";

/**
 * Server actions pour l'audit PFS de masse.
 *
 * - startPfsAuditAction  : lance l'audit en tâche de fond (fire-and-forget).
 * - getPfsAuditStateAction : renvoie l'état courant (utilisé par le widget en polling).
 * - cancelPfsAuditAction : positionne le stop-signal pour interrompre proprement.
 * - applyPfsAuditFixesForProductAction : applique les pulls sur un seul produit
 *   audité (utilisé par le bouton « Modifier depuis PFS » d'une carte).
 * - bulkApplyPfsAuditFixesAction : applique les pulls sur tous les produits
 *   audités qui ont des écarts corrigeables (bouton « Tout modifier depuis PFS »).
 */

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import {
  startPfsAuditInBackground,
  getPfsAuditState,
  requestStopPfsAudit,
  resetPfsAuditState,
  type PfsAuditState,
} from "@/lib/pfs-audit-runner";
import {
  applyPfsVerifyPullsOnly,
  type PfsVerifyActionInput,
} from "@/lib/pfs-verify-apply";
import { isPullSupportedLotB, issueKey } from "@/lib/pfs-verify-apply-shared";
import type { PfsVerifyIssue } from "@/lib/pfs-verify";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export async function startPfsAuditAction(): Promise<
  { success: true; state: PfsAuditState } | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    const state = await startPfsAuditInBackground(tenant.id);
    return { success: true, state };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Audit] Start failed", { error: msg });
    return { success: false, error: msg };
  }
}

export async function getPfsAuditStateAction(): Promise<
  { success: true; state: PfsAuditState } | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    const state = await getPfsAuditState(tenant.id);
    return { success: true, state };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

export async function cancelPfsAuditAction(): Promise<
  { success: true } | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    await requestStopPfsAudit(tenant.id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Ré-initialise l'état d'audit (bouton « Fermer et oublier » de la modale). */
export async function dismissPfsAuditAction(): Promise<
  { success: true } | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    await resetPfsAuditState(tenant.id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Application des corrections ────────────────────────────────────────────

interface ApplySingleResult {
  productId: string;
  reference: string;
  appliedCount: number;
  skippedCount: number;
  errorCount: number;
  firstError?: string;
}

/**
 * Convertit les écarts corrigeables d'un produit en actions "pull" prêtes à
 * être envoyées à `applyPfsVerifyPullsOnly`. Les écarts bloqués côté Lot B ou
 * marqués `pullBlocked` par le serveur sont écartés (à corriger à la main).
 */
function buildPullActionsFromIssues(issues: PfsVerifyIssue[]): PfsVerifyActionInput[] {
  return issues
    .filter((iss) => !iss.pullBlocked && isPullSupportedLotB(iss.scope, iss.field))
    .map((iss) => ({ key: issueKey(iss), direction: "pull" as const }));
}

/**
 * Applique les corrections PFS → nous sur un seul produit audité, sans
 * proposer de propagation marketplace (contrairement à la modale de la
 * pastille : ici c'est un mode "batch fix" — la cliente propagera plus tard
 * depuis la ligne du tableau qui portera le drapeau « Synchro nécessaire »).
 *
 * L'entrée `issues` est la liste des écarts déjà connue côté client (extraite
 * du state d'audit) — on évite un nouvel appel PFS.
 */
export async function applyPfsAuditFixesForProductAction(
  productId: string,
  issues: PfsVerifyIssue[],
): Promise<
  | { success: true; result: ApplySingleResult }
  | { success: false; error: string }
> {
  await requireAdmin();
  const actions = buildPullActionsFromIssues(issues);
  if (actions.length === 0) {
    return { success: false, error: "Aucun écart corrigeable automatiquement." };
  }
  try {
    const { report } = await applyPfsVerifyPullsOnly(productId, actions);
    revalidateTag("products", "default");
    return {
      success: true,
      result: {
        productId,
        reference: "",
        appliedCount: report.applied.length,
        skippedCount: report.skipped.length,
        errorCount: report.errors.length,
        firstError: report.errors[0]?.error,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Audit Apply] Crash", { productId, error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Applique les corrections sur tous les produits audités passés en paramètre.
 * Concurrency 5 (aligné sur l'audit lui-même et sur `verifyPfsProducts`).
 */
export async function bulkApplyPfsAuditFixesAction(
  items: { productId: string; issues: PfsVerifyIssue[] }[],
): Promise<
  | {
      success: true;
      totalProducts: number;
      appliedProducts: number;
      failedProducts: number;
      firstError?: string;
    }
  | { success: false; error: string }
> {
  await requireAdmin();
  if (items.length === 0) {
    return { success: true, totalProducts: 0, appliedProducts: 0, failedProducts: 0 };
  }
  try {
    const CONCURRENCY = 5;
    const queue = [...items];
    let appliedProducts = 0;
    let failedProducts = 0;
    let firstError: string | undefined;
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const it = queue.shift();
            if (!it) return;
            const actions = buildPullActionsFromIssues(it.issues);
            if (actions.length === 0) {
              // Rien à corriger → pas une erreur, on n'incrémente rien
              continue;
            }
            try {
              await applyPfsVerifyPullsOnly(it.productId, actions);
              appliedProducts++;
            } catch (err) {
              failedProducts++;
              const msg = err instanceof Error ? err.message : String(err);
              if (!firstError) firstError = `${it.productId} : ${msg}`;
              logger.error("[PFS Audit Bulk Apply] Product failed", {
                productId: it.productId,
                error: msg,
              });
            }
          }
        })(),
      );
    }
    await Promise.all(workers);
    revalidateTag("products", "default");
    return {
      success: true,
      totalProducts: items.length,
      appliedProducts,
      failedProducts,
      firstError,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Audit Bulk Apply] Crash", { error: msg });
    return { success: false, error: msg };
  }
}
