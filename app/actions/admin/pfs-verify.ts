"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { verifyPfsProduct, type PfsVerifyResult, type PfsVerifyError, type PfsVerifyIssue } from "@/lib/pfs-verify";
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
            const res = await verifyPfsProduct(pid);
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
