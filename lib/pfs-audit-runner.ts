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
import {
  captureProductSnapshot,
  diffProductSnapshots,
  createPfsAuditRun,
  finalizePfsAuditRunError,
  finalizePfsAuditRunSuccess,
  persistProductChange,
} from "@/lib/pfs-audit-history";
import {
  applyPfsVerifyPullsOnly,
  isPullSupportedLotB,
  issueKey,
  type PfsVerifyActionInput,
} from "@/lib/pfs-verify-apply";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import { sendMail } from "@/lib/email";
import { resolveJobIntentsBulk } from "@/lib/marketplace-job-intent";
import { dedupeEnqueueDrafts } from "@/lib/marketplace-queue-dedupe";

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
  /** true = déclenché par le scheduler auto (SiteConfig `pfs_audit_auto_enabled`). */
  autoTriggered?: boolean;
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
  /** true = ce run a été lancé par le scheduler auto. */
  autoTriggered?: boolean;
  /** Id du PfsAuditRun (table journal) associé — présent uniquement en auto. */
  historyRunId?: string | null;
}

const KEY_STATE = "pfs_audit_state";
const KEY_STOP = "pfs_audit_stop";
const CONCURRENCY = 10;

// Config auto — clés SiteConfig
export const KEY_AUTO_ENABLED = "pfs_audit_auto_enabled";
/** Intervalle stocké en secondes (nouveau format — libre : jour/heure/min/sec). */
export const KEY_AUTO_INTERVAL_SECONDS = "pfs_audit_auto_interval_seconds";
/** Intervalle legacy en heures — lu en fallback si secondes absent. */
export const KEY_AUTO_INTERVAL_HOURS = "pfs_audit_auto_interval_hours";
export const KEY_AUTO_ALERT_EMAIL = "pfs_audit_auto_alert_email";
export const KEY_AUTO_LAST_RUN_AT = "pfs_audit_auto_last_run_at";
/** Timestamp de mise en pause (ms). Absent ou "0" = pas en pause. */
export const KEY_AUTO_PAUSED_AT = "pfs_audit_auto_paused_at";
/** Timestamp de fin d'audit auto (ms). Posé quand la post-run enqueue des jobs
 *  marketplace : tant que la valeur est présente, le chrono du prochain audit
 *  auto est figé (règle validée cliente 2026-09-08 : ne pas relancer un audit
 *  tant que les propagations tournent, sinon on spam des bugs).
 *  Effacé quand plus aucun `MarketplaceRefreshJob` QUEUED/IN_PROGRESS. */
export const KEY_AUDIT_AWAITING_PROPAGATIONS = "pfs_audit_awaiting_propagations";
/** Minimum absolu 30 s : évite de saturer PFS si la cliente met tout à zéro par erreur. */
export const MIN_AUTO_INTERVAL_SECONDS = 30;
/** Legacy — conservé pour compat de tests / imports historiques. */
export const MIN_AUTO_INTERVAL_HOURS = 1;

/**
 * Résout l'intervalle en secondes depuis les 2 clés SiteConfig. Priorité au
 * nouveau format `pfs_audit_auto_interval_seconds` ; fallback sur l'ancien
 * `pfs_audit_auto_interval_hours` × 3600. Clamp au minimum absolu.
 */
export function resolveIntervalSeconds(rows: { key: string; value: string }[]): number {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const rawSec = Number(map.get(KEY_AUTO_INTERVAL_SECONDS) ?? "");
  if (Number.isFinite(rawSec) && rawSec >= MIN_AUTO_INTERVAL_SECONDS) return rawSec;
  const rawHours = Number(map.get(KEY_AUTO_INTERVAL_HOURS) ?? "");
  if (Number.isFinite(rawHours) && rawHours > 0) {
    const asSec = rawHours * 3600;
    return asSec >= MIN_AUTO_INTERVAL_SECONDS ? asSec : MIN_AUTO_INTERVAL_SECONDS;
  }
  return MIN_AUTO_INTERVAL_SECONDS;
}

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
  autoTriggered: false,
  historyRunId: null,
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
  // dismissedAt filter : les cartes que la cliente a « Ignorées » ou
  // corrigées via « Modifier depuis PFS » ne doivent plus ressusciter au
  // refresh. Elles restent en BDD (traçabilité) mais sont invisibles.
  const rows = await prisma.pfsAuditResult.findMany({
    where: { tenantId, auditRunId, dismissedAt: null },
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
    autoTriggered: persisted.autoTriggered ?? false,
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
 *
 * @param opts.autoTriggered Passer `true` depuis le scheduler (workers).
 *   Active la logique post-run automatique : auto-apply des corrections,
 *   propagation marketplaces, écriture dans le journal historique, désactivation
 *   du toggle auto + envoi mail admin en cas de moindre erreur.
 */
export async function startPfsAuditInBackground(
  tenantId: string,
  opts?: { autoTriggered?: boolean },
): Promise<PfsAuditState> {
  const autoTriggered = opts?.autoTriggered === true;
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
  // Journal historique : uniquement pour les runs auto. Le run est créé
  // en RUNNING, finalisé en DONE/ERROR à la fin.
  const historyRunId = autoTriggered
    ? await createPfsAuditRun(tenantId, true).catch((err) => {
        logger.error("[PFS Audit] Création historique impossible", {
          tenantId,
          error: err as Error,
        });
        return null;
      })
    : null;
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
    autoTriggered,
    historyRunId,
  };
  await writePersistedState(tenantId, initial);
  await setStopSignal(tenantId, false);
  // Reset du chrono de l'audit auto au DÉMARRAGE : sans ça, `lastRunAt` reste
  // sur la fin du run précédent et le chrono continue à descendre pendant
  // l'audit courant. Écriture inconditionnelle — bénigne si auto désactivé.
  await setSiteConfig(KEY_AUTO_LAST_RUN_AT, String(Date.now()), { tenantId });
  // Audit MANUEL : désactive l'audit auto. Règle validée cliente le 2026-09-08 :
  // « quand on lance manuellement l'audit, il faut arrêter l'auto — il faut
  // l'activer manuellement pour le reprendre ». Le bandeau bascule sur
  // « Audit automatique désactivé » ; réactivation via Paramètres → PFS.
  if (!autoTriggered) {
    await setSiteConfig(KEY_AUTO_ENABLED, "0", { tenantId });
  }

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
      // Coupure nette : si `pfs_audit_stop` a été posé entre-temps (hard stop
      // depuis l'UI), on écrit IDLE plutôt que RUNNING — ça rétablit l'état
      // que le hard stop a posé, y compris si un flush concurrent a réussi à
      // ressusciter RUNNING dans la fenêtre de course entre le check du stop
      // signal et l'upsert (~ms de latence BDD).
      let lastFlush = Date.now();
      const flush = async () => {
        if (await checkStopSignal(tenantId)) {
          await writePersistedState(tenantId, { ...EMPTY_PERSISTED });
          return;
        }
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

      // Hard stop demandé pendant le run : le state IDLE est déjà posé par
      // `hardStopPfsAudit`, on rend la main sans rien réécrire (sinon on
      // ressuscite le run en STOPPED avec ses compteurs partiels). On laisse
      // aussi le stop signal en place — c'est le prochain `startPfsAuditInBackground`
      // qui le nettoiera.
      if (stopped) return;

      // ─── Branche auto : à la fin du scan, applique + propage + journal ─
      // Comportement figé avec la cliente : la MOINDRE erreur technique OU
      // le moindre écart bloqué (compo non mappée, variante ajoutée côté PFS,
      // champ non-pull-able Lot B) → stop total, désactive l'auto, mail admin.
      if (autoTriggered && historyRunId) {
        try {
          const outcome = await runAutoPostAudit({
            tenantId,
            auditRunId,
            historyRunId,
          });
          // Nouvelle vérif du stop signal : la post-run peut prendre plusieurs
          // secondes (pull PFS + writes BDD par produit). Si un hard stop est
          // arrivé pendant, on ne touche à rien — le state IDLE reste, et la
          // désactivation de l'auto par `handleAutoAuditFailure` (côté outcome
          // ko) n'est PAS souhaitable si l'utilisateur a explicitement stoppé.
          if (await checkStopSignal(tenantId)) return;
          // Re-reset du chrono à la fin (en plus du début) pour que le
          // bandeau affiche la valeur pleine dès la fin, pas
          // « interval - durée_audit ». Le chrono est caché pendant l'audit
          // (bandeau « Audit en cours… »), donc pas de saut visible.
          await setSiteConfig(KEY_AUTO_LAST_RUN_AT, String(Date.now()), {
            tenantId,
          });
          const doneState: PfsAuditPersistedState = {
            status: outcome.ok ? "DONE" : "ERROR",
            auditRunId,
            startedAt: initial.startedAt,
            finishedAt: Date.now(),
            total: products.length,
            processed,
            okCount,
            diffCount,
            errorCount,
            errorMessage: outcome.ok ? undefined : outcome.reason,
            autoTriggered: true,
            historyRunId,
          };
          await writePersistedState(tenantId, doneState);
          await setStopSignal(tenantId, false);
          return;
        } catch (err) {
          // Filet ultime — un crash du post-run auto passe aussi par la voie
          // erreur (mail + désactivation). Sauf si l'utilisateur a hard-stop
          // entretemps : dans ce cas on avale le crash silencieusement.
          if (await checkStopSignal(tenantId).catch(() => false)) return;
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("[PFS Audit Auto] Post-run échoué", {
            tenantId,
            error: msg,
          });
          await handleAutoAuditFailure(tenantId, historyRunId, msg);
          await setSiteConfig(KEY_AUTO_LAST_RUN_AT, String(Date.now()), {
            tenantId,
          });
          const errorState: PfsAuditPersistedState = {
            status: "ERROR",
            auditRunId,
            startedAt: initial.startedAt,
            finishedAt: Date.now(),
            total: products.length,
            processed,
            okCount,
            diffCount,
            errorCount,
            errorMessage: msg,
            autoTriggered: true,
            historyRunId,
          };
          await writePersistedState(tenantId, errorState);
          await setStopSignal(tenantId, false);
          return;
        }
      }

      // Chemin nominal : audit manuel qui a fini sans coupure (stopped = false,
      // testé plus haut). On écrit DONE et on nettoie le stop signal.
      // Re-reset du chrono auto à la fin : chrono à valeur pleine côté UI
      // dès la fermeture — pas « interval - durée_audit ».
      await setSiteConfig(KEY_AUTO_LAST_RUN_AT, String(Date.now()), { tenantId });
      const finalState: PfsAuditPersistedState = {
        status: "DONE",
        auditRunId,
        startedAt: initial.startedAt,
        finishedAt: Date.now(),
        total: products.length,
        processed,
        okCount,
        diffCount,
        errorCount,
        autoTriggered,
        historyRunId,
      };
      await writePersistedState(tenantId, finalState);
      await setStopSignal(tenantId, false);
    } catch (err) {
      logger.error("[PFS Audit] Audit échoué", { tenantId, error: err as Error });
      const msg = err instanceof Error ? err.message : String(err);
      // Hard stop pendant un crash : on ne touche à rien (state IDLE déjà posé).
      if (await checkStopSignal(tenantId).catch(() => false)) return;
      if (autoTriggered && historyRunId) {
        await handleAutoAuditFailure(tenantId, historyRunId, msg);
        await setSiteConfig(KEY_AUTO_LAST_RUN_AT, String(Date.now()), {
          tenantId,
        }).catch(() => {});
      }
      const previous = await readPersistedState(tenantId);
      const errorState: PfsAuditPersistedState = {
        ...previous,
        status: "ERROR",
        finishedAt: Date.now(),
        errorMessage: msg,
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

/**
 * Coupure nette d'un audit en cours — équivalent d'un « arrêt total » :
 *   1. Pose le stop signal (les workers en cours sortent au prochain check,
 *      et leurs writes intermédiaires sont neutralisés par le check inline
 *      dans `flush()` — cf. plus haut).
 *   2. Purge la table `PfsAuditResult` pour ce tenant → toutes les cartes
 *      affichées dans le drawer disparaissent immédiatement.
 *   3. Reset le state en IDLE → le drawer bascule sur l'écran vide.
 *   4. Désactive l'audit auto (`pfs_audit_auto_enabled = "0"`). Règle validée
 *      cliente le 2026-09-08 : « si on arrête l'audit en bas à droite, ça
 *      désactive aussi l'auto ». Réactivation via le bouton « Réactiver »
 *      du bandeau chrono (ou Paramètres → PFS).
 *
 * Le stop signal reste posé après ; c'est le prochain
 * `startPfsAuditInBackground` qui le nettoie au démarrage.
 */
export async function hardStopPfsAudit(tenantId: string): Promise<void> {
  await setStopSignal(tenantId, true);
  await prisma.pfsAuditResult.deleteMany({ where: { tenantId } });
  // Finalise le PfsAuditRun encore en RUNNING (seulement pour les runs auto,
  // mais on filtre par tenantId + status, donc no-op si aucun run auto n'est
  // en cours). Sans ça, un audit auto arrêté manuellement reste marqué
  // « en cours » dans l'onglet Historique du drawer, pour toujours.
  await prisma.pfsAuditRun.updateMany({
    where: { tenantId, status: "RUNNING" },
    data: {
      status: "ERROR",
      finishedAt: new Date(),
      errorMessage: "Audit interrompu manuellement",
    },
  });
  await writePersistedState(tenantId, { ...EMPTY_PERSISTED });
  await setSiteConfig(KEY_AUTO_ENABLED, "0", { tenantId });
}

/**
 * Marque les résultats d'audit passés en paramètre comme « dismissed » — la
 * cliente les a soit ignorés, soit corrigés depuis PFS. Ils resteront invisibles
 * du drawer, même après un refresh navigateur ou depuis un autre PC.
 *
 * Retourne :
 *  - `remaining` : nombre de résultats encore visibles pour l'audit courant.
 *  - `autoReset` : true si tout est dismissed et qu'on a purgé l'état d'audit
 *    (évite au drawer de rester bloqué en mode « Aucun écart » vide).
 */
/**
 * Patche le PfsAuditResult courant pour retirer les compositions PFS
 * manquantes qui viennent d'être créées (identifiées par leurs Uids
 * Salesforce). Sur chaque issue "composition" impactée :
 *   - retire les Uids créés de `missingLocalPfs`
 *   - si `missingLocalPfs` devient vide, lève `pullBlocked` +
 *     `blockingMappingIssue` (la compo existe désormais localement,
 *     la valeur PFS peut être pull)
 * Ce patch est persisté en BDD → survit aux polls suivants. C'est ce qui
 * évite le flicker « débloqué puis re-bloqué » côté UI.
 */
export async function stripMissingCompositionsFromAudit(
  tenantId: string,
  createdPfsUids: string[],
): Promise<{ updated: number }> {
  if (createdPfsUids.length === 0) return { updated: 0 };
  const persisted = await readPersistedState(tenantId);
  if (!persisted.auditRunId) return { updated: 0 };
  const uidSet = new Set(createdPfsUids);
  // Charge uniquement les rows qui ont au moins une issue avec missingLocalPfs
  // — le filtre JSON est coûteux, on préfère filtrer côté app.
  const rows = await prisma.pfsAuditResult.findMany({
    where: { tenantId, auditRunId: persisted.auditRunId, ok: true, dismissedAt: null },
    select: { id: true, issues: true },
  });
  let updated = 0;
  for (const row of rows) {
    const issues = (row.issues as unknown as PfsVerifyIssue[]) ?? [];
    let touched = false;
    const nextIssues = issues.map((iss) => {
      if (!iss.missingLocalPfs || iss.missingLocalPfs.length === 0) return iss;
      const kept = iss.missingLocalPfs.filter((m) => !(m.pfsUid && uidSet.has(m.pfsUid)));
      if (kept.length === iss.missingLocalPfs.length) return iss;
      touched = true;
      const next: PfsVerifyIssue = { ...iss };
      if (kept.length > 0) next.missingLocalPfs = kept;
      else delete next.missingLocalPfs;
      if (kept.length === 0) {
        // Plus aucune compo manquante sur cet issue → on lève le blocage.
        // (Autres types de blocage restent gérés par leurs propres issues.)
        delete next.pullBlocked;
        delete next.blockingMappingIssue;
      }
      return next;
    });
    if (!touched) continue;
    await prisma.pfsAuditResult.update({
      where: { id: row.id },
      data: { issues: nextIssues as unknown as Prisma.InputJsonValue },
    });
    updated++;
  }
  return { updated };
}

export async function dismissAuditResults(
  tenantId: string,
  productIds: string[],
): Promise<{ remaining: number; autoReset: boolean }> {
  if (productIds.length === 0) {
    return { remaining: 0, autoReset: false };
  }
  const persisted = await readPersistedState(tenantId);
  if (!persisted.auditRunId) {
    return { remaining: 0, autoReset: false };
  }
  await prisma.pfsAuditResult.updateMany({
    where: {
      tenantId,
      auditRunId: persisted.auditRunId,
      productId: { in: productIds },
      dismissedAt: null,
    },
    data: { dismissedAt: new Date() },
  });
  const remaining = await prisma.pfsAuditResult.count({
    where: { tenantId, auditRunId: persisted.auditRunId, dismissedAt: null },
  });
  // Si l'audit est terminé (DONE/STOPPED) et qu'il ne reste rien à traiter,
  // on ferme automatiquement le run — le drawer retombe en état IDLE et
  // n'apparaît plus au prochain refresh.
  const isFinal = persisted.status === "DONE" || persisted.status === "STOPPED";
  if (remaining === 0 && isFinal) {
    await resetPfsAuditState(tenantId);
    return { remaining: 0, autoReset: true };
  }
  return { remaining, autoReset: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-AUDIT — Post-run automatique : applique, propage, journalise, alerte
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Détermine si une issue est corrigeable automatiquement par un pull PFS.
 * Utilisé par le runner auto pour filtrer les écarts à appliquer produit par
 * produit. Les écarts non corrigeables (compo non mappée, champ Lot C comme
 * catégorie, etc.) sont ignorés — l'audit continue sur les autres produits.
 * Seule une erreur technique (crash apply, PFS unreachable) stoppe tout.
 */
function isIssueAutoPullable(iss: PfsVerifyIssue): boolean {
  if (iss.pullBlocked) return false;
  if (iss.blockingMappingIssue) return false;
  if (iss.missingLocalPfs && iss.missingLocalPfs.length > 0) return false;
  if (!isPullSupportedLotB(iss.scope, iss.field)) return false;
  return true;
}

/**
 * Post-audit auto : décide si tout est corrigeable sans erreur, applique les
 * corrections produit par produit, écrit le journal historique, et enfin
 * enqueue une propagation vers les autres marketplaces (best-effort).
 *
 * Renvoie `{ ok: true }` si tout s'est bien passé, sinon `{ ok: false, reason }`
 * — le caller finalise l'audit en ERROR et envoie le mail admin.
 */
async function runAutoPostAudit(args: {
  tenantId: string;
  auditRunId: string;
  historyRunId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { tenantId, auditRunId, historyRunId } = args;

  // 1. Charge les résultats de ce run (uniquement les produits en écart/erreur).
  const rows = await prisma.pfsAuditResult.findMany({
    where: { tenantId, auditRunId, dismissedAt: null },
    orderBy: { createdAt: "asc" },
  });

  // 2. La MOINDRE erreur technique bloque tout.
  const firstTechError = rows.find((r) => !r.ok);
  if (firstTechError) {
    const reason = `Erreur technique sur « ${firstTechError.name} » (réf. ${firstTechError.reference}) : ${firstTechError.errorMessage ?? "erreur inconnue"}`;
    await handleAutoAuditFailure(tenantId, historyRunId, reason);
    return { ok: false, reason };
  }

  // 3. Applique les corrections produit par produit + écrit le journal.
  //    Les écarts non corrigeables auto (Lot C : catégorie, saison, pays,
  //    genre… + compo non mappée + variantes structurelles) sont **skippés
  //    par écart** — l'audit ne s'arrête pas là-dessus, elle les corrigera à
  //    la main. Seule une erreur technique côté PFS/apply arrête tout.
  let changedProducts = 0;
  const productsToPropagate: string[] = [];
  for (const r of rows) {
    if (!r.ok) continue;
    const issues = (r.issues as unknown as PfsVerifyIssue[]) ?? [];
    const actions: PfsVerifyActionInput[] = issues
      .filter(isIssueAutoPullable)
      .map((iss) => ({
        key: issueKey(iss),
        direction: "pull" as const,
      }));
    if (actions.length === 0) continue;

    const before = await captureProductSnapshot(r.productId);
    if (!before) continue;

    try {
      const { report } = await applyPfsVerifyPullsOnly(r.productId, actions);
      if (report.errors.length > 0) {
        const err = report.errors[0];
        const reason = `Application PFS impossible sur « ${r.name} » (réf. ${r.reference}) : ${err.error}`;
        await handleAutoAuditFailure(tenantId, historyRunId, reason);
        return { ok: false, reason };
      }
      const after = await captureProductSnapshot(r.productId);
      if (!after) continue;
      const changes = diffProductSnapshots(before, after);
      if (changes.length > 0) {
        changedProducts++;
        await persistProductChange(
          historyRunId,
          tenantId,
          {
            productId: r.productId,
            reference: r.reference,
            name: r.name,
            firstImage: r.firstImage,
          },
          changes,
        );
        productsToPropagate.push(r.productId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const reason = `Application PFS impossible sur « ${r.name} » (réf. ${r.reference}) : ${msg}`;
      await handleAutoAuditFailure(tenantId, historyRunId, reason);
      return { ok: false, reason };
    }
  }

  // 4. Finalise le journal DONE.
  await finalizePfsAuditRunSuccess(historyRunId, rows.length, changedProducts);

  // 5. Propagation marketplaces — best-effort, ne casse pas le succès.
  //    Enqueue jobs dans MarketplaceRefreshJob : traités asynchrone par le
  //    worker, visibles dans le widget flottant Marketplaces. Un échec côté
  //    Ankor/eFa/Faire/OC laissera un job FAILED dans le widget (attendu).
  if (productsToPropagate.length > 0) {
    void enqueueMarketplacePropagation(tenantId, productsToPropagate).catch((err) => {
      logger.error("[PFS Audit Auto] Propagation marketplaces échouée", {
        tenantId,
        error: err as Error,
      });
    });
  }

  logger.info("[PFS Audit Auto] Run terminé", {
    tenantId,
    historyRunId,
    totalProducts: rows.length,
    changedProducts,
    propagatedProducts: productsToPropagate.length,
  });
  return { ok: true };
}

/**
 * Enqueue des jobs marketplace RESYNC pour tous les produits corrigés, sur
 * chaque marketplace éligible (Ankor, eFashion, Faire, Orderchamp, Microstore).
 * Traités par le marketplace-queue-worker. Erreurs remontent dans le widget
 * Marketplaces (widget en bas à droite), pas dans l'audit lui-même.
 *
 * ⚠️ RESYNC (pas REFRESH) — l'audit auto ne doit **jamais** recréer une fiche
 * marketplace. Sur eFashion et Faire, le mode `REFRESH` fait un delete + recreate
 * qui casse les URLs, favoris et stats acheteuses. RESYNC = update in place avec
 * `forceFullSync: true` : renvoie la fiche complète sur le même ID marketplace.
 * Le bouton « Rafraîchir » manuel de l'admin reste en `REFRESH` (choix humain).
 */
type PropagateMkt = "ankorstore" | "efashion" | "faire" | "orderchamp" | "microstore";

async function enqueueMarketplacePropagation(
  tenantId: string,
  productIds: string[],
): Promise<void> {
  interface JobDraft {
    productId: string;
    reference: string;
    productName: string;
    firstImage: string | null;
    marketplace: PropagateMkt;
  }
  const drafts: JobDraft[] = [];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      reference: true,
      name: true,
      primaryColorId: true,
      status: true,
      ankorsProductId: true,
      ankorsEnabled: true,
      efashionEnabled: true,
      faireProductId: true,
      faireEnabled: true,
      orderchampProductId: true,
      orderchampEnabled: true,
      microstoreProductId: true,
      colors: {
        select: {
          colorId: true,
          efashionProductId: true,
          images: {
            orderBy: { order: "asc" },
            take: 1,
            select: { path: true },
          },
        },
      },
    },
  });
  const firstImageByProduct = new Map<string, string | null>();
  for (const p of products) {
    const primary = p.primaryColorId
      ? p.colors.find((c) => c.colorId === p.primaryColorId)?.images[0]?.path
      : null;
    const fallback = p.colors
      .map((c) => c.images[0]?.path)
      .find((v): v is string => !!v);
    firstImageByProduct.set(p.id, primary ?? fallback ?? null);
  }
  // Lecture DIRECTE SiteConfig (bypass cache stale) : chaque marketplace est
  // considérée connectée uniquement si sa clé de config est bien présente ET
  // le kill-switch "products_management_enabled" n'est pas à "false"/"0".
  // Sans ça, une clé retirée après démarrage du scheduler resterait "true"
  // en cache 5 min et un job fantôme serait créé.
  const configRows = await prisma.siteConfig.findMany({
    where: {
      tenantId,
      key: {
        in: [
          "ankorstore_bo_email",
          "ankorstore_products_management_enabled",
          "efashion_email",
          "efashion_products_management_enabled",
          "faire_api_key",
          "faire_products_management_enabled",
          "orderchamp_api_key",
          "orderchamp_products_management_enabled",
          "microstore_session_key",
          "microstore_products_management_enabled",
        ],
      },
    },
    select: { key: true, value: true },
  });
  const configMap = new Map(configRows.map((r) => [r.key, r.value]));
  const isConnected = (credentialKey: string, killSwitchKey: string): boolean => {
    const hasCred = !!(configMap.get(credentialKey) ?? "").trim();
    const kill = configMap.get(killSwitchKey);
    // kill "0" ou "false" = OFF. Absent = ON par défaut.
    const enabled = kill !== "0" && kill !== "false";
    return hasCred && enabled;
  };
  const ankConnected = isConnected("ankorstore_bo_email", "ankorstore_products_management_enabled");
  const efaConnected = isConnected("efashion_email", "efashion_products_management_enabled");
  const faiConnected = isConnected("faire_api_key", "faire_products_management_enabled");
  const ocConnected = isConnected("orderchamp_api_key", "orderchamp_products_management_enabled");
  // Microstore : le check simple (clé présente + kill switch) ne suffit pas —
  // la session Microstore peut être expirée (durée ~1 an) et la Station de
  // transfert d'images peut aussi être expirée (7 j). Sans preflight complet,
  // un job partait quand même dans la file et échouait au niveau du worker
  // avec un message pas toujours actionnable. On appelle donc le même
  // preflight que le push direct — si !ok, on n'enqueue simplement rien pour
  // Microstore (log lisible dans les logs pour la cliente).
  const { assertMicrostorePushAllowed } = await import("@/lib/microstore-preflight");
  const microPreflight = await assertMicrostorePushAllowed();
  const microConnected = microPreflight.ok;

  logger.info("[PFS Audit Auto] Propagation — marketplaces connectées", {
    tenantId,
    ankorstore: ankConnected,
    efashion: efaConnected,
    faire: faiConnected,
    orderchamp: ocConnected,
    microstore: microConnected,
    microstoreBlockReason: microPreflight.ok ? undefined : microPreflight.reason,
  });

  for (const p of products) {
    const info = { productId: p.id, reference: p.reference, productName: p.name, firstImage: firstImageByProduct.get(p.id) ?? null };
    if (p.ankorsProductId && p.ankorsEnabled && ankConnected) drafts.push({ ...info, marketplace: "ankorstore" });
    const hasEfashionLink = p.colors.some((c) => c.efashionProductId != null);
    if (hasEfashionLink && p.efashionEnabled && efaConnected) drafts.push({ ...info, marketplace: "efashion" });
    if (p.faireProductId && p.faireEnabled && faiConnected) drafts.push({ ...info, marketplace: "faire" });
    if (p.orderchampProductId && p.orderchampEnabled && ocConnected && p.status !== "OFFLINE") {
      drafts.push({ ...info, marketplace: "orderchamp" });
    }
    if (p.microstoreProductId && microConnected) drafts.push({ ...info, marketplace: "microstore" });
  }
  if (drafts.length === 0) return;

  const mpDb: Record<PropagateMkt, "ANKORSTORE" | "EFASHION" | "FAIRE" | "ORDERCHAMP" | "MICROSTORE"> = {
    ankorstore: "ANKORSTORE",
    efashion: "EFASHION",
    faire: "FAIRE",
    orderchamp: "ORDERCHAMP",
    microstore: "MICROSTORE",
  };

  // Dédoublonnage — un audit auto qui re-tourne toutes les X minutes peut
  // ré-enfiler les mêmes RESYNC que le run précédent tant qu'ils n'ont pas
  // fini. Le helper filtre contre les QUEUED existants (mais pas les
  // IN_PROGRESS, qui doivent laisser un nouveau job s'empiler derrière pour
  // capturer les modifs récentes).
  const { toCreate, deduplicated } = await dedupeEnqueueDrafts(
    drafts.map((d) => ({
      productId: d.productId,
      marketplace: mpDb[d.marketplace],
      mode: "RESYNC" as const,
      _draft: d,
    })),
  );

  if (toCreate.length === 0) {
    logger.info("[PFS Audit Auto] Aucun nouveau job — tous déjà en file", {
      tenantId,
      deduplicated,
    });
    return;
  }

  const intents = await resolveJobIntentsBulk(
    toCreate.map((d) => ({
      productId: d._draft.productId,
      marketplace: d._draft.marketplace,
      mode: "resync" as const,
      scheduled: false,
    })),
  );
  await prisma.$transaction(
    toCreate.map((d, i) => {
      // Poser explicitement le flag de la marketplace visée dans payload.options
      // pour que le worker ne se rabatte pas sur le comportement par défaut ni
      // ne saute silencieusement le vrai push.
      const options: Record<string, boolean> = { local: false };
      options[d._draft.marketplace] = true;
      // `pfsAudit: true` : marque ce job comme provenant d'un audit auto —
      // le bandeau chrono s'en sert pour compter combien de propagations
      // restent à finir avant de relancer le décompte du prochain audit.
      options.pfsAudit = true;
      return prisma.marketplaceRefreshJob.create({
        data: {
          productId: d._draft.productId,
          tenantId,
          marketplace: d.marketplace,
          mode: "RESYNC",
          intent: intents[i],
          payload: {
            reference: d._draft.reference,
            productName: d._draft.productName,
            firstImage: d._draft.firstImage,
            options,
          },
          status: "QUEUED",
        },
      });
    }),
  );
  // Pose le flag qui gèle le chrono du prochain audit auto tant que la file
  // n'est pas retombée à zéro. `getPfsAuditNextRunAction` efface ce flag et
  // reset `lastRunAt` quand la file est vide (cf. `pfs-audit-auto.ts`).
  await setSiteConfig(KEY_AUDIT_AWAITING_PROPAGATIONS, String(Date.now()), {
    tenantId,
  });
  logger.info("[PFS Audit Auto] Jobs marketplace enqueue", {
    tenantId,
    jobs: toCreate.length,
    deduplicated,
  });
}

/**
 * En cas d'erreur pendant un run auto : marque le run journal en ERROR,
 * désactive le toggle auto (elle devra le réactiver depuis les paramètres),
 * et envoie un mail à l'adresse d'alerte configurée.
 */
async function handleAutoAuditFailure(
  tenantId: string,
  historyRunId: string | null,
  reason: string,
): Promise<void> {
  if (historyRunId) {
    await finalizePfsAuditRunError(historyRunId, reason).catch((err) => {
      logger.error("[PFS Audit Auto] Finalisation historique en erreur impossible", {
        tenantId,
        error: err as Error,
      });
    });
  }
  await setSiteConfig(KEY_AUTO_ENABLED, "0", { tenantId }).catch((err) => {
    logger.error("[PFS Audit Auto] Désactivation kill-switch impossible", {
      tenantId,
      error: err as Error,
    });
  });
  await sendAuditAlertMail(tenantId, reason).catch((err) => {
    logger.error("[PFS Audit Auto] Envoi mail d'alerte impossible", {
      tenantId,
      error: err as Error,
    });
  });
}

/**
 * Résout l'adresse de destination du mail d'alerte : priorité à
 * `pfs_audit_auto_alert_email` (spécifique à cette feature), fallback sur
 * `admin_personal_email` déjà utilisé pour les autres alertes.
 */
async function resolveAlertEmailRecipient(tenantId: string): Promise<string | null> {
  const rows = await prisma.siteConfig.findMany({
    where: {
      tenantId,
      key: { in: [KEY_AUTO_ALERT_EMAIL, "admin_personal_email"] },
    },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const specific = (map.get(KEY_AUTO_ALERT_EMAIL) ?? "").trim();
  if (specific) return specific;
  const fallback = (map.get("admin_personal_email") ?? "").trim();
  return fallback || null;
}

async function sendAuditAlertMail(tenantId: string, reason: string): Promise<void> {
  const to = await resolveAlertEmailRecipient(tenantId);
  if (!to) {
    logger.warn("[PFS Audit Auto] Aucune adresse d'alerte configurée — mail non envoyé", {
      tenantId,
    });
    return;
  }
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;">
  <p><strong>L'audit PFS automatique a été interrompu.</strong></p>
  <p>Motif : ${escapeHtml(reason)}</p>
  <p>Le déclencheur automatique a été <strong>désactivé</strong>. Pour le réactiver, allez dans <em>Paramètres → Marketplaces → PFS → Audit automatique</em> après avoir traité les blocages depuis le widget « Audit PFS » de la fenêtre flottante.</p>
  <p style="color:#64748b;font-size:12px;">Ce mail est envoyé par votre back-office Beli &amp; Jolie.</p>
</div>`.trim();
  await sendMail({
    to,
    subject: "Audit PFS interrompu — action requise",
    html,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
