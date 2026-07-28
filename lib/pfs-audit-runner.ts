/**
 * PFS Audit — Vérification en masse de tous les produits liés à PFS.
 *
 * Lance en tâche de fond (fire-and-forget) `verifyPfsProduct` sur tous les
 * produits ayant un `pfsProductId`. La progression (compteurs) est persistée
 * en SiteConfig ; les écarts détaillés sont stockés dans la table
 * `PfsAuditResult` (une ligne par écart) pour scaler à des dizaines de
 * milliers de produits sans faire exploser la case JSON de SiteConfig.
 *
 * Clés SiteConfig :
 *   - pfs_audit_state : JSON des compteurs (voir PfsAuditPersistedState)
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
import { randomUUID } from "crypto";

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

/**
 * Payload compact stocké en SiteConfig. Ne contient QUE les compteurs et
 * l'identifiant du run — les écarts détaillés sont dans `PfsAuditResult`.
 * Taille constante, quel que soit le nombre d'écarts.
 */
interface PfsAuditPersistedState {
  status: PfsAuditStatus;
  auditRunId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  processed: number;
  okCount: number;
  diffCount: number;
  errorCount: number;
  errorMessage?: string;
}

const KEY_STATE = "pfs_audit_state";
const KEY_STOP = "pfs_audit_stop";
const CONCURRENCY = 10;

const EMPTY_PERSISTED: PfsAuditPersistedState = {
  status: "IDLE",
  auditRunId: null,
  startedAt: null,
  finishedAt: null,
  total: 0,
  processed: 0,
  okCount: 0,
  diffCount: 0,
  errorCount: 0,
};

async function readPersistedState(tenantId: string): Promise<PfsAuditPersistedState> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: KEY_STATE },
    select: { value: true },
  });
  if (!row?.value) return { ...EMPTY_PERSISTED };
  try {
    const parsed = JSON.parse(row.value) as Partial<PfsAuditPersistedState>;
    // Compat : les anciens payloads contenaient un tableau `results`.
    // On l'ignore silencieusement — les nouveaux runs alimenteront la table.
    return { ...EMPTY_PERSISTED, ...parsed };
  } catch {
    return { ...EMPTY_PERSISTED };
  }
}

async function writePersistedState(
  tenantId: string,
  state: PfsAuditPersistedState,
): Promise<void> {
  const value = JSON.stringify(state);
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: KEY_STATE } },
    update: { value },
    create: { tenantId, key: KEY_STATE, value },
  });
}

async function fetchAuditResults(
  tenantId: string,
  auditRunId: string | null,
): Promise<PfsAuditProductResult[]> {
  if (!auditRunId) return [];
  const rows = await prisma.pfsAuditResult.findMany({
    where: { tenantId, auditRunId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r): PfsAuditProductResult => {
    if (r.ok) {
      return {
        ok: true,
        productId: r.productId,
        reference: r.reference,
        name: r.name,
        firstImage: r.firstImage,
        issues: (r.issues as unknown as PfsVerifyIssue[]) ?? [],
      };
    }
    return {
      ok: false,
      productId: r.productId,
      reference: r.reference,
      name: r.name,
      firstImage: r.firstImage,
      error: r.errorMessage ?? "",
      errorKind: r.errorKind ?? "unknown",
    };
  });
}

export async function getPfsAuditState(tenantId: string): Promise<PfsAuditState> {
  const persisted = await readPersistedState(tenantId);
  const results = await fetchAuditResults(tenantId, persisted.auditRunId);
  return {
    status: persisted.status,
    startedAt: persisted.startedAt,
    finishedAt: persisted.finishedAt,
    total: persisted.total,
    processed: persisted.processed,
    okCount: persisted.okCount,
    diffCount: persisted.diffCount,
    errorCount: persisted.errorCount,
    errorMessage: persisted.errorMessage,
    results,
  };
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
  const current = await readPersistedState(tenantId);
  if (current.status === "RUNNING") return getPfsAuditState(tenantId);

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

  // Nouveau run — purge les écarts des runs précédents pour ce tenant.
  await prisma.pfsAuditResult.deleteMany({ where: { tenantId } });

  const auditRunId = randomUUID();
  const initial: PfsAuditPersistedState = {
    status: "RUNNING",
    auditRunId,
    startedAt: Date.now(),
    finishedAt: null,
    total: products.length,
    processed: 0,
    okCount: 0,
    diffCount: 0,
    errorCount: 0,
  };
  await writePersistedState(tenantId, initial);
  await setStopSignal(tenantId, false);

  void tenantALS.run(tenantId, async () => {
    try {
      // Précharge une seule fois les 5 tables globales PFS + configs BDD
      // partagées par tous les produits. Économise 5 HTTP + 2 BDD × N produits.
      const verifyContext = await loadPfsVerifyContext();

      const queue = [...products];
      let processed = 0;
      let okCount = 0;
      let diffCount = 0;
      let errorCount = 0;

      // Flush périodique des compteurs (payload constant, ne dépend plus des
      // écarts). Toutes les 500ms ou tous les 5 produits.
      let lastFlush = Date.now();
      const flush = async () => {
        await writePersistedState(tenantId, {
          status: "RUNNING",
          auditRunId,
          startedAt: initial.startedAt,
          finishedAt: null,
          total: products.length,
          processed,
          okCount,
          diffCount,
          errorCount,
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
                    await prisma.pfsAuditResult.create({
                      data: {
                        tenantId,
                        auditRunId,
                        productId: p.id,
                        reference: p.reference,
                        name: p.name,
                        firstImage: firstImageByProduct.get(p.id) ?? null,
                        ok: true,
                        issues: res.result.issues as unknown as Prisma.InputJsonValue,
                      },
                    });
                  }
                } else {
                  errorCount++;
                  await prisma.pfsAuditResult.create({
                    data: {
                      tenantId,
                      auditRunId,
                      productId: p.id,
                      reference: p.reference,
                      name: p.name,
                      firstImage: firstImageByProduct.get(p.id) ?? null,
                      ok: false,
                      errorMessage: res.error.message,
                      errorKind: res.error.kind,
                    },
                  });
                }
              } catch (err) {
                processed++;
                errorCount++;
                const msg = err instanceof Error ? err.message : String(err);
                logger.error("[PFS Audit] Worker crash", { productId: p.id, error: msg });
                await prisma.pfsAuditResult
                  .create({
                    data: {
                      tenantId,
                      auditRunId,
                      productId: p.id,
                      reference: p.reference,
                      name: p.name,
                      firstImage: firstImageByProduct.get(p.id) ?? null,
                      ok: false,
                      errorMessage: msg,
                      errorKind: "pfs_unreachable",
                    },
                  })
                  .catch((e) => {
                    logger.error("[PFS Audit] Insert result failed", {
                      productId: p.id,
                      error: e as Error,
                    });
                  });
              }
              // Flush fréquent pour que le widget voie la progression en
              // temps réel — le poll client est à 1.5s.
              if (processed % 5 === 0 || Date.now() - lastFlush > 500) {
                await flush();
              }
            }
          })(),
        );
      }
      await Promise.all(workers);

      const stopped = await checkStopSignal(tenantId);
      const finalState: PfsAuditPersistedState = {
        status: stopped ? "STOPPED" : "DONE",
        auditRunId,
        startedAt: initial.startedAt,
        finishedAt: Date.now(),
        total: products.length,
        processed,
        okCount,
        diffCount,
        errorCount,
      };
      await writePersistedState(tenantId, finalState);
      await setStopSignal(tenantId, false);
    } catch (err) {
      logger.error("[PFS Audit] Audit échoué", { tenantId, error: err as Error });
      const previous = await readPersistedState(tenantId);
      const errorState: PfsAuditPersistedState = {
        ...previous,
        status: "ERROR",
        finishedAt: Date.now(),
        errorMessage: err instanceof Error ? err.message : String(err),
      };
      await writePersistedState(tenantId, errorState);
    }
  });

  return getPfsAuditState(tenantId);
}

export async function requestStopPfsAudit(tenantId: string): Promise<void> {
  await setStopSignal(tenantId, true);
}

export async function resetPfsAuditState(tenantId: string): Promise<void> {
  await writePersistedState(tenantId, { ...EMPTY_PERSISTED });
  await setStopSignal(tenantId, false);
  await prisma.pfsAuditResult.deleteMany({ where: { tenantId } });
}
