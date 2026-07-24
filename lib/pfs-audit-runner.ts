/**
 * PFS Audit — Vérification en masse de tous les produits liés à PFS.
 *
 * Lance en tâche de fond (fire-and-forget) `verifyPfsProduct` sur tous les
 * produits ayant un `pfsProductId`. La progression et la liste des écarts
 * sont persistées en SiteConfig (par tenant) pour survivre à un redémarrage
 * PM2 et être queryable par le widget flottant.
 *
 * Seuls les produits avec écart (`status: "diff"`) ou en erreur sont conservés
 * dans `results` — les conformes ne polluent pas le payload.
 *
 * Clés SiteConfig :
 *   - pfs_audit_state : JSON stringifié (voir PfsAuditState)
 *   - pfs_audit_stop  : "1" quand la cliente annule
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import {
  verifyPfsProduct,
  loadPfsVerifyContext,
  type PfsVerifyIssue,
} from "@/lib/pfs-verify";
import { Prisma } from "@prisma/client";

export type PfsAuditStatus = "IDLE" | "RUNNING" | "DONE" | "ERROR" | "STOPPED";

export interface PfsAuditProductDiff {
  productId: string;
  reference: string;
  name: string;
  firstImage: string | null;
  issues: PfsVerifyIssue[];
  ok: true;
}

export interface PfsAuditProductError {
  productId: string;
  reference: string;
  name: string;
  firstImage: string | null;
  error: string;
  errorKind: string;
  ok: false;
}

export type PfsAuditProductResult = PfsAuditProductDiff | PfsAuditProductError;

export interface PfsAuditState {
  status: PfsAuditStatus;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  processed: number;
  okCount: number;
  diffCount: number;
  errorCount: number;
  errorMessage?: string;
  /** Uniquement les produits en écart ou en erreur (conformes exclus). */
  results: PfsAuditProductResult[];
}

const KEY_STATE = "pfs_audit_state";
const KEY_STOP = "pfs_audit_stop";
const CONCURRENCY = 10;

const EMPTY_STATE: PfsAuditState = {
  status: "IDLE",
  startedAt: null,
  finishedAt: null,
  total: 0,
  processed: 0,
  okCount: 0,
  diffCount: 0,
  errorCount: 0,
  results: [],
};

export async function getPfsAuditState(tenantId: string): Promise<PfsAuditState> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: KEY_STATE },
    select: { value: true },
  });
  if (!row?.value) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(row.value) as Partial<PfsAuditState>;
    return { ...EMPTY_STATE, ...parsed };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function setPfsAuditState(tenantId: string, state: PfsAuditState): Promise<void> {
  const value = JSON.stringify(state);
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: KEY_STATE } },
    update: { value },
    create: { tenantId, key: KEY_STATE, value },
  });
}

async function setStopSignal(tenantId: string, value: boolean): Promise<void> {
  if (value) {
    await prisma.siteConfig.upsert({
      where: { tenantId_key: { tenantId, key: KEY_STOP } },
      update: { value: "1" },
      create: { tenantId, key: KEY_STOP, value: "1" },
    });
  } else {
    await prisma.siteConfig
      .delete({ where: { tenantId_key: { tenantId, key: KEY_STOP } } })
      .catch(() => {});
  }
}

async function checkStopSignal(tenantId: string): Promise<boolean> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: KEY_STOP },
    select: { value: true },
  });
  return row?.value === "1";
}

/**
 * Démarre un audit PFS complet en tâche de fond (fire-and-forget).
 * Idempotent : renvoie l'état actuel si un audit est déjà RUNNING.
 */
export async function startPfsAuditInBackground(
  tenantId: string,
): Promise<PfsAuditState> {
  const current = await getPfsAuditState(tenantId);
  if (current.status === "RUNNING") return current;

  // Charge les produits liés à PFS. Pas de filtre statut : on audite tout ce
  // qui a un pfsProductId, y compris OFFLINE/ARCHIVED (utile pour repérer
  // des désynchros sur des produits mis en pause).
  const products = await prisma.product.findMany({
    where: { pfsProductId: { not: null } },
    select: {
      id: true,
      reference: true,
      name: true,
      primaryColorId: true,
      colors: {
        select: {
          colorId: true,
        },
      },
    },
  });

  // Récupère la 1ʳᵉ image par produit (pour affichage dans la modale).
  const firstImageByProduct = new Map<string, string | null>();
  if (products.length > 0) {
    const images = await prisma.productColorImage.findMany({
      where: { productId: { in: products.map((p) => p.id) } },
      orderBy: { order: "asc" },
      select: { productId: true, colorId: true, path: true },
    });
    const byProductColor = new Map<string, string>();
    for (const img of images) {
      const k = `${img.productId}::${img.colorId}`;
      if (!byProductColor.has(k)) byProductColor.set(k, img.path);
    }
    for (const p of products) {
      const primary = p.primaryColorId
        ? byProductColor.get(`${p.id}::${p.primaryColorId}`)
        : null;
      const fallback = p.colors
        .map((c) => (c.colorId ? byProductColor.get(`${p.id}::${c.colorId}`) : null))
        .find((v): v is string => !!v);
      firstImageByProduct.set(p.id, primary ?? fallback ?? null);
    }
  }

  const initial: PfsAuditState = {
    ...EMPTY_STATE,
    status: "RUNNING",
    startedAt: Date.now(),
    total: products.length,
  };
  await setPfsAuditState(tenantId, initial);
  await setStopSignal(tenantId, false);

  void tenantALS.run(tenantId, async () => {
    try {
      // Précharge une seule fois les 5 tables globales PFS + configs BDD
      // partagées par tous les produits. Économise 5 HTTP + 2 BDD × N produits.
      const verifyContext = await loadPfsVerifyContext();

      const queue = [...products];
      const results: PfsAuditProductResult[] = [];
      let processed = 0;
      let okCount = 0;
      let diffCount = 0;
      let errorCount = 0;

      // Flush périodique de l'état pour ne pas écrire à chaque produit
      // (économise la BDD). Toutes les 500ms ou tous les 20 produits.
      let lastFlush = Date.now();
      const flush = async () => {
        await setPfsAuditState(tenantId, {
          status: "RUNNING",
          startedAt: initial.startedAt,
          finishedAt: null,
          total: products.length,
          processed,
          okCount,
          diffCount,
          errorCount,
          results,
        });
        lastFlush = Date.now();
      };

      const workers: Promise<void>[] = [];
      for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
        workers.push(
          (async () => {
            while (queue.length > 0) {
              if (await checkStopSignal(tenantId)) return;
              const p = queue.shift();
              if (!p) return;
              try {
                const res = await verifyPfsProduct(p.id, verifyContext);
                processed++;
                if (res.ok) {
                  // Persist les champs pfsCheckedAt/Status/Issues comme le fait
                  // verifyPfsProducts — ainsi la pastille de la liste des
                  // produits se met à jour naturellement.
                  await prisma.product.update({
                    where: { id: p.id },
                    data: {
                      pfsCheckedAt: new Date(res.result.checkedAt),
                      pfsCheckStatus: res.result.status,
                      pfsCheckIssues:
                        res.result.issues.length === 0
                          ? Prisma.DbNull
                          : (res.result.issues as unknown as Prisma.InputJsonValue),
                    },
                  });
                  if (res.result.status === "ok") {
                    okCount++;
                  } else {
                    diffCount++;
                    results.push({
                      ok: true,
                      productId: p.id,
                      reference: p.reference,
                      name: p.name,
                      firstImage: firstImageByProduct.get(p.id) ?? null,
                      issues: res.result.issues,
                    });
                  }
                } else {
                  errorCount++;
                  results.push({
                    ok: false,
                    productId: p.id,
                    reference: p.reference,
                    name: p.name,
                    firstImage: firstImageByProduct.get(p.id) ?? null,
                    error: res.error.message,
                    errorKind: res.error.kind,
                  });
                }
              } catch (err) {
                processed++;
                errorCount++;
                const msg = err instanceof Error ? err.message : String(err);
                logger.error("[PFS Audit] Worker crash", { productId: p.id, error: msg });
                results.push({
                  ok: false,
                  productId: p.id,
                  reference: p.reference,
                  name: p.name,
                  firstImage: firstImageByProduct.get(p.id) ?? null,
                  error: msg,
                  errorKind: "pfs_unreachable",
                });
              }
              // Flush plus fréquent qu'avant (5/500ms au lieu de 20/500ms) pour
              // que le widget en temps réel voie les nouveaux écarts apparaître
              // rapidement — le poll client est à 1.5s.
              if (processed % 5 === 0 || Date.now() - lastFlush > 500) {
                await flush();
              }
            }
          })(),
        );
      }
      await Promise.all(workers);

      const stopped = await checkStopSignal(tenantId);
      const finalState: PfsAuditState = {
        status: stopped ? "STOPPED" : "DONE",
        startedAt: initial.startedAt,
        finishedAt: Date.now(),
        total: products.length,
        processed,
        okCount,
        diffCount,
        errorCount,
        results,
      };
      await setPfsAuditState(tenantId, finalState);
      await setStopSignal(tenantId, false);
    } catch (err) {
      logger.error("[PFS Audit] Audit échoué", { tenantId, error: err as Error });
      const errorState: PfsAuditState = {
        ...(await getPfsAuditState(tenantId)),
        status: "ERROR",
        finishedAt: Date.now(),
        errorMessage: err instanceof Error ? err.message : String(err),
      };
      await setPfsAuditState(tenantId, errorState);
    }
  });

  return initial;
}

export async function requestStopPfsAudit(tenantId: string): Promise<void> {
  await setStopSignal(tenantId, true);
}

export async function resetPfsAuditState(tenantId: string): Promise<void> {
  await setPfsAuditState(tenantId, { ...EMPTY_STATE });
  await setStopSignal(tenantId, false);
}
