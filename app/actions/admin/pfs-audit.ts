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
  dismissAuditResults,
  type PfsAuditState,
} from "@/lib/pfs-audit-runner";
import {
  applyPfsVerifyPullsOnly,
  type PfsVerifyActionInput,
} from "@/lib/pfs-verify-apply";
import { isPullSupportedLotB, issueKey } from "@/lib/pfs-verify-apply-shared";
import type { PfsVerifyIssue } from "@/lib/pfs-verify";
import {
  computePfsPullEligibleMarketplaces,
  type PfsPullEligibleMarketplace,
} from "@/lib/pfs-verify-eligible-marketplaces";
import { prisma } from "@/lib/prisma";

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

/**
 * Marque un ou plusieurs résultats d'audit comme « dismissed » (Ignorer / après
 * correction PFS). Persiste en BDD pour que les cartes ne reviennent pas au
 * refresh. Si tous les résultats sont dismissed, l'audit est reset auto.
 */
export async function dismissPfsAuditResultsAction(
  productIds: string[],
): Promise<
  | { success: true; remaining: number; autoReset: boolean }
  | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    const result = await dismissAuditResults(tenant.id, productIds);
    return { success: true, ...result };
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
  /** Marketplaces (hors PFS) sur lesquelles on peut propager les valeurs
   *  fraîchement récupérées. Vide si le produit n'est lié à aucune autre
   *  marketplace ou si les kill-switches / credentials manquent. */
  eligibleMarketplaces: PfsPullEligibleMarketplace[];
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
    // Marketplaces éligibles : uniquement si au moins un pull a été appliqué
    // (sinon rien à propager). On les renvoie au client pour qu'il puisse
    // proposer la modale de synchronisation dans la foulée.
    const eligibleMarketplaces =
      report.applied.length > 0
        ? await computePfsPullEligibleMarketplaces(productId)
        : [];
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
        eligibleMarketplaces,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Audit Apply] Crash", { productId, error: msg });
    return { success: false, error: msg };
  }
}

export interface BulkApplyPerProductResult {
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  /** true = pull appliqué (le produit peut être proposé à la propagation
   *  marketplaces). false = échec ou rien de corrigeable. */
  ok: boolean;
  eligibleMarketplaces: PfsPullEligibleMarketplace[];
  error?: string;
}

/**
 * Applique les corrections sur tous les produits audités passés en paramètre.
 * Concurrency 5 (aligné sur l'audit lui-même et sur `verifyPfsProducts`).
 *
 * Renvoie en plus `perProduct` : pour chaque produit corrigé, la liste des
 * marketplaces éligibles à une propagation (hors PFS). L'UI s'en sert pour
 * proposer une modale unique « Envoyer aussi sur Ankor/eFashion/Faire ? »
 * juste après le clic « Tout modifier depuis PFS ».
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
      perProduct: BulkApplyPerProductResult[];
    }
  | { success: false; error: string }
> {
  await requireAdmin();
  if (items.length === 0) {
    return {
      success: true,
      totalProducts: 0,
      appliedProducts: 0,
      failedProducts: 0,
      perProduct: [],
    };
  }
  try {
    // Précharge les métadonnées d'affichage (nom + 1ʳᵉ image) pour tous les
    // produits en une seule requête — l'UI en a besoin pour la modale de
    // propagation marketplace qui suit le bulk apply.
    const productIds = items.map((it) => it.productId);
    const meta = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        reference: true,
        name: true,
        primaryColorId: true,
        colors: { select: { colorId: true } },
      },
    });
    const images = await prisma.productColorImage.findMany({
      where: { productId: { in: productIds } },
      orderBy: { order: "asc" },
      select: { productId: true, colorId: true, path: true },
    });
    const firstImgByPC = new Map<string, string>();
    for (const img of images) {
      const k = `${img.productId}::${img.colorId}`;
      if (!firstImgByPC.has(k)) firstImgByPC.set(k, img.path);
    }
    const metaById = new Map(
      meta.map((m) => {
        const primary = m.primaryColorId
          ? firstImgByPC.get(`${m.id}::${m.primaryColorId}`)
          : null;
        const fallback = m.colors
          .map((c) => (c.colorId ? firstImgByPC.get(`${m.id}::${c.colorId}`) : null))
          .find((v): v is string => !!v);
        return [
          m.id,
          {
            reference: m.reference,
            name: m.name,
            firstImage: primary ?? fallback ?? null,
          },
        ] as const;
      }),
    );

    const CONCURRENCY = 5;
    const queue = [...items];
    const perProduct: BulkApplyPerProductResult[] = [];
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
            const info = metaById.get(it.productId) ?? {
              reference: "?",
              name: "?",
              firstImage: null,
            };
            const actions = buildPullActionsFromIssues(it.issues);
            if (actions.length === 0) {
              // Rien à corriger → pas une erreur, on n'incrémente rien
              continue;
            }
            try {
              const { report } = await applyPfsVerifyPullsOnly(it.productId, actions);
              appliedProducts++;
              const eligible =
                report.applied.length > 0
                  ? await computePfsPullEligibleMarketplaces(it.productId)
                  : [];
              perProduct.push({
                productId: it.productId,
                reference: info.reference,
                productName: info.name,
                firstImage: info.firstImage,
                ok: true,
                eligibleMarketplaces: eligible,
              });
            } catch (err) {
              failedProducts++;
              const msg = err instanceof Error ? err.message : String(err);
              if (!firstError) firstError = `${it.productId} : ${msg}`;
              logger.error("[PFS Audit Bulk Apply] Product failed", {
                productId: it.productId,
                error: msg,
              });
              perProduct.push({
                productId: it.productId,
                reference: info.reference,
                productName: info.name,
                firstImage: info.firstImage,
                ok: false,
                eligibleMarketplaces: [],
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
      perProduct,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Audit Bulk Apply] Crash", { error: msg });
    return { success: false, error: msg };
  }
}
