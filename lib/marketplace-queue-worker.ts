/**
 * lib/marketplace-queue-worker.ts
 *
 * Worker singleton qui traite la file `MarketplaceRefreshJob` côté serveur.
 * Démarré une seule fois au boot via `instrumentation-node.ts`.
 *
 * Architecture :
 *  - Loop d'1 seconde (`POLL_MS`) qui scan la table à chaque tick
 *  - Au premier démarrage : sweep des jobs `IN_PROGRESS` orphelins (process tué)
 *  - Concurrence **par tenant** : `PER_TENANT_TOTAL_CONCURRENCY` jobs en vol
 *    par boutique, dont au plus `PER_TENANT_ANKORSTORE_CONCURRENCY` Ankorstore
 *    et `PER_TENANT_FAIRE_CONCURRENCY` Faire. Chaque tenant a son propre
 *    compte marketplace donc pas de collision entre boutiques.
 *  - Sélection : on itère sur les tenants qui ont des jobs QUEUED, chacun
 *    reçoit son propre budget → une boutique qui pousse 100 produits ne bloque
 *    plus les autres boutiques.
 *  - Idempotence : transitions QUEUED → IN_PROGRESS via updateMany WHERE status,
 *    pour qu'un éventuel double-tick ne lance pas deux fois le même job
 */
import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";
import { tenantALS } from "@/lib/tenant-als";
import { revalidateProductPublicPage } from "@/lib/product-url-server";
import { markStep } from "@/lib/marketplace-job-steps";
import { selectJobsToStart } from "@/lib/marketplace-queue-select";

const POLL_MS = 1000;
// Concurrence **par tenant** (2026-08-15) : chaque boutique a son propre
// budget de jobs marketplace en vol, isolé des autres. Sans ça, un tenant qui
// enqueue 100 produits monopolisait la file globale et bloquait les autres
// boutiques jusqu'à la fin de son batch. Chaque tenant a son propre compte sur
// chaque marketplace → les 5 slots Ankor par tenant ne se marchent pas dessus
// (comptes différents côté Ankor).
const PER_TENANT_TOTAL_CONCURRENCY = 5;
// 5 slots Ankorstore max par tenant, avec verrou de sérialisation par
// productId dans `selectJobsToStart` : 2 jobs Ankor ne peuvent JAMAIS toucher
// le même produit simultanément (sinon collision SKU / écrasement d'état
// pendant read-modify-write). Sur des produits distincts, aucune API Ankor
// ne bronche — le rollback 2026-08-12 était dû aux batches REFRESH qui se
// chevauchaient sur le MÊME produit, pas au parallélisme en soi.
const PER_TENANT_ANKORSTORE_CONCURRENCY = 5;
/**
 * Faire limité à 2 jobs en parallèle par tenant : au-delà, Cloudflare 1015
 * (front API Faire) coupe les requêtes avec HTTP 429 pendant 30–60s.
 * Incident 2026-08-15 — refresh en masse de 20 produits → 14 échecs FAIRE,
 * aucun autre marketplace. Combiné au backoff long dans `faireFetch`, on
 * absorbe les blocages sans remonter l'erreur à la cliente.
 */
const PER_TENANT_FAIRE_CONCURRENCY = 2;
/**
 * Batch REFRESH désactivé par flag depuis le rollback 2026-08-12. Le mode
 * batch (5 produits par POST) restait exposé aux fusions Ankor quand plusieurs
 * batches se chevauchaient dans le temps. En 1-par-1 avec le mutex kickoff,
 * aucune fusion possible et le comportement est prévisible.
 * Pour réactiver plus tard : passer à `true` + ANKORSTORE_CONCURRENCY > 1.
 */
const ANKOR_BATCH_REFRESH_ENABLED = false;
const ANKOR_REFRESH_BATCH_SIZE = 5;

const STARTUP_GUARD = Symbol.for("beliandjolie.marketplaceQueueWorker.started");
const g = globalThis as Record<symbol, unknown>;

export type JobRow = Prisma.MarketplaceRefreshJobGetPayload<Record<string, never>>;

export interface QueueJobPayload {
  reference: string;
  productName: string;
  firstImage: string | null;
  options: {
    local?: boolean;
    pfs?: boolean;
    ankorstore?: boolean;
    efashion?: boolean;
    faire?: boolean;
    orderchamp?: boolean;
    microstore?: boolean;
  };
  /**
   * Actions ciblées produites par le tooltip PFS Verify. Quand présent, le
   * worker appelle `applyPfsVerifyActionsCore` au lieu de la sync marketplace
   * standard (REFRESH/PUBLISH/RESYNC).
   */
  verifyActions?: { key: string; direction: "push" | "pull" }[];
}

// ─── TargetOutcome — forme partagée avec le client (MarketplaceRefreshContext) ──
type TargetOutcomeOk = {
  ok: true;
  archived?: boolean;
  opId?: string;
  warning?: string;
};
type TargetOutcomeFail = {
  ok: false;
  kind: "not_found" | "error";
  message: string;
};
type TargetOutcome = TargetOutcomeOk | TargetOutcomeFail;

export function startMarketplaceQueueWorker(): void {
  if (g[STARTUP_GUARD]) return;
  g[STARTUP_GUARD] = true;

  // Sweep des orphelins en arrière-plan, puis loop
  void (async () => {
    try {
      await runStartupSweep();
    } catch (err) {
      logger.error("[Marketplace Queue] Startup sweep failed", { error: err as Error });
    }
  })();

  setInterval(() => {
    void tick().catch((err: unknown) => {
      logger.error("[Marketplace Queue] Tick crashed", { error: err as Error });
    });
  }, POLL_MS);

  logger.info(
    `[Marketplace Queue] Worker démarré (poll 1s, ${PER_TENANT_TOTAL_CONCURRENCY} slots/tenant, ${PER_TENANT_ANKORSTORE_CONCURRENCY} Ankorstore/tenant, ${PER_TENANT_FAIRE_CONCURRENCY} Faire/tenant, batch REFRESH ${ANKOR_BATCH_REFRESH_ENABLED ? `taille ${ANKOR_REFRESH_BATCH_SIZE}` : "désactivé"})`,
  );
}

async function runStartupSweep(): Promise<void> {
  // Tout IN_PROGRESS au démarrage = orphelin d'un process précédent (PM2 restart)
  const res = await prisma.marketplaceRefreshJob.updateMany({
    where: { status: "IN_PROGRESS" },
    data: {
      status: "FAILED",
      errorMessage: "Serveur redémarré pendant le traitement — relancez ce produit si nécessaire.",
      completedAt: new Date(),
    },
  });
  if (res.count > 0) {
    logger.warn("[Marketplace Queue] Jobs orphelins marqués FAILED au démarrage", {
      count: res.count,
    });
  }
}

async function tick(): Promise<void> {
  // Ankorstore : plus de reconcileAwaitingCallback depuis le passage au reverse
  // back-office synchrone (2026-08-13). Les jobs sont marqués SUCCEEDED/FAILED
  // directement dans processAnkorstoreJob.
  await startQueued();
}

// ─────────────────────────────────────────────────────────────────────
// Démarrage des jobs queued en respectant la concurrence PAR TENANT
// ─────────────────────────────────────────────────────────────────────
/**
 * Exporté pour tests seulement — appelé en interne par `tick()`.
 */
export async function startQueued(): Promise<void> {
  const now = new Date();

  // Étape 1 : trouver tous les tenants qui ont au moins 1 job QUEUED éligible.
  // On boucle ensuite sur chaque tenant avec son propre budget → une boutique
  // qui pousse 100 produits ne monopolise plus la file globale.
  const tenantsRows = await prisma.marketplaceRefreshJob.findMany({
    where: {
      status: "QUEUED",
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    select: { tenantId: true },
    distinct: ["tenantId"],
  });
  if (tenantsRows.length === 0) return;

  for (const { tenantId } of tenantsRows) {
    await startQueuedForTenant(tenantId, now);
  }
}

/**
 * Alloue et démarre jusqu'à `PER_TENANT_TOTAL_CONCURRENCY` jobs pour un
 * tenant donné, dont au plus `PER_TENANT_ANKORSTORE_CONCURRENCY` Ankorstore.
 * Les jobs restent isolés entre tenants : chaque compte marketplace
 * (Ankor/PFS/eFa/Faire) est propre à sa boutique donc pas de collision.
 */
async function startQueuedForTenant(
  tenantId: string | null,
  now: Date,
): Promise<void> {
  const tenantWhere = { tenantId };

  const inFlight = await prisma.marketplaceRefreshJob.count({
    where: {
      ...tenantWhere,
      OR: [
        { status: "IN_PROGRESS" },
        { status: "AWAITING_CALLBACK", marketplace: "ANKORSTORE" },
      ],
    },
  });
  const totalBudget = Math.max(0, PER_TENANT_TOTAL_CONCURRENCY - inFlight);
  if (totalBudget <= 0) return;

  // Count Ankor du tenant + verrou de sérialisation par produit (Ankor↔Ankor).
  const ankorsInFlightRows = await prisma.marketplaceRefreshJob.findMany({
    where: {
      ...tenantWhere,
      marketplace: "ANKORSTORE",
      status: { in: ["IN_PROGRESS", "AWAITING_CALLBACK"] },
    },
    select: { productId: true },
  });
  const ankorsBudget = Math.max(
    0,
    PER_TENANT_ANKORSTORE_CONCURRENCY - ankorsInFlightRows.length,
  );
  const inFlightAnkorProductIds = new Set(ankorsInFlightRows.map((r) => r.productId));

  // Count Faire du tenant (budget dédié — Cloudflare rate-limit).
  const faireInFlightCount = await prisma.marketplaceRefreshJob.count({
    where: {
      ...tenantWhere,
      marketplace: "FAIRE",
      status: "IN_PROGRESS",
    },
  });
  const fairesBudget = Math.max(0, PER_TENANT_FAIRE_CONCURRENCY - faireInFlightCount);

  // scheduledFor = null → démarrage immédiat. Sinon on attend l'heure prévue.
  const queued = await prisma.marketplaceRefreshJob.findMany({
    where: {
      ...tenantWhere,
      status: "QUEUED",
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    take: Math.max(totalBudget * 2, 10),
  });

  const toStart = selectJobsToStart({
    queued,
    inFlightAnkorProductIds,
    totalBudget,
    ankorsBudget,
    fairesBudget,
  });

  // ─── Batch REFRESH Ankorstore ───
  // Tous les jobs de toStart appartiennent au même tenant maintenant, plus
  // besoin de re-grouper. On extrait les REFRESH Ankor éligibles au batching.
  const batchable: JobRow[] = [];
  const single: JobRow[] = [];
  for (const job of toStart) {
    if (isBatchableRefresh(job)) {
      batchable.push(job);
    } else {
      single.push(job);
    }
  }

  if (ANKOR_BATCH_REFRESH_ENABLED && batchable.length >= 2) {
    for (let i = 0; i < batchable.length; i += ANKOR_REFRESH_BATCH_SIZE) {
      const chunk = batchable.slice(i, i + ANKOR_REFRESH_BATCH_SIZE);
      if (chunk.length < 2) {
        single.push(...chunk);
      } else {
        void claimAndProcessBatchRefresh(chunk).catch((err: unknown) => {
          logger.error("[Marketplace Queue] batch refresh unexpected error", {
            tenantId,
            jobCount: chunk.length,
            error: err as Error,
          });
        });
      }
    }
  } else {
    // Batch REFRESH désactivé (rollback 2026-08-12) → tous en single.
    single.push(...batchable);
  }

  for (const job of single) {
    const claim = await prisma.marketplaceRefreshJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
    if (claim.count !== 1) continue;
    // Fire-and-forget : le traitement peut prendre 10–60s
    void processJob(job.id).catch((err: unknown) => {
      logger.error("[Marketplace Queue] processJob unexpected error", {
        jobId: job.id,
        error: err as Error,
      });
    });
  }
}

function isBatchableRefresh(job: JobRow): boolean {
  if (job.marketplace !== "ANKORSTORE") return false;
  if (job.mode !== "REFRESH") return false;
  const payload = job.payload as unknown as QueueJobPayload | null;
  if (!payload) return false;
  if (payload.options?.ankorstore === false) return false;
  // Les jobs avec verifyActions (PFS tooltip) ne sont pas Ankor mais on double-check.
  if (payload.verifyActions && payload.verifyActions.length > 0) return false;
  return true;
}

/**
 * Claim (mark IN_PROGRESS) tous les jobs du batch en une transaction, puis
 * lance le kickoff batch. Les jobs qui ne peuvent pas être claim (déjà pris
 * par un autre tick, ce qui ne devrait pas arriver) sont ignorés.
 */
async function claimAndProcessBatchRefresh(jobs: JobRow[]): Promise<void> {
  const now = new Date();
  const claimedJobIds: string[] = [];
  for (const job of jobs) {
    const claim = await prisma.marketplaceRefreshJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "IN_PROGRESS", startedAt: now },
    });
    if (claim.count === 1) claimedJobIds.push(job.id);
  }
  if (claimedJobIds.length === 0) return;
  if (claimedJobIds.length === 1) {
    // Un seul survivant → traiter en single, plus fiable qu'un batch de 1.
    void processJob(claimedJobIds[0]).catch((err: unknown) => {
      logger.error("[Marketplace Queue] processJob (batch fallback) error", {
        jobId: claimedJobIds[0],
        error: err as Error,
      });
    });
    return;
  }

  // Le tenantId doit être identique pour tous (garanti par le groupement) —
  // on wrap dans tenantALS pour que le cache Ankor résolve le bon compte.
  const tenantId = jobs[0].tenantId;
  const run = async () => {
    await runBatchRefreshJob(claimedJobIds);
  };
  if (tenantId) {
    await tenantALS.run(tenantId, run);
  } else {
    await run();
  }
}

/**
 * Traite un batch de N ≥ 2 jobs REFRESH Ankor : maintenant que le flow est
 * 100 % synchrone (back-office reverse), on boucle simplement séquentiellement
 * sur chaque produit via publishProductToAnkorstoreBo.
 * L'ancien kickoff batch async avec callback n'existe plus.
 */
async function runBatchRefreshJob(claimedJobIds: string[]): Promise<void> {
  const jobs = await prisma.marketplaceRefreshJob.findMany({
    where: { id: { in: claimedJobIds } },
    select: { id: true, productId: true },
  });

  logger.info("[Marketplace Queue] Batch REFRESH Ankor (sync)", {
    jobCount: jobs.length,
    productIds: jobs.map((j) => j.productId),
  });

  const { publishProductToAnkorstoreBo } = await import("@/app/actions/admin/ankorstore-bo");
  for (const j of jobs) {
    try {
      const res = await publishProductToAnkorstoreBo(j.productId);
      if (res.success) {
        await markAnkorstoreSuccess(j.id, false);
      } else {
        await markAnkorstoreFailed(j.id, "error", res.error ?? "Erreur inconnue");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[Marketplace Queue] Ankorstore batch item failed", {
        productId: j.productId,
        error: message,
      });
      await markAnkorstoreFailed(j.id, "error", message);
    }
    await revalidateProductPaths(j.productId);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Traitement d'un job individuel
// ─────────────────────────────────────────────────────────────────────
async function processJob(jobId: string): Promise<void> {
  const job = await prisma.marketplaceRefreshJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  // CRITIQUE multi-tenant : le worker tourne hors requête, donc l'ALS est vide.
  // Sans bind, les caches d'auth marketplaces (PFS/Ankor/eFashion/Faire)
  // retombent en "global" et servent les credentials du 1er tenant qui a écrit
  // → push BJ atterrit sur le compte marketplace d'Issyma (et inversement).
  // On wrap tout le corps de processJob dans tenantALS.run(job.tenantId, ...).
  if (job.tenantId) {
    return tenantALS.run(job.tenantId, () => processJobBody(job));
  }
  return processJobBody(job);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processJobBody(job: any): Promise<void> {
  // Garde-fou verrou : un produit verrouillé entre l'enqueue et le traitement
  // ne doit pas être rafraîchi. Couvre les 4 marketplaces (PFS / Ankor /
  // eFashion / Faire) en un seul point — défense en profondeur du guard UI.
  const jobId = job.id;
  if (job.mode === "REFRESH") {
    const lockState = await prisma.product.findUnique({
      where: { id: job.productId },
      select: { locked: true },
    });
    if (lockState?.locked) {
      await prisma.marketplaceRefreshJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: "Produit verrouillé : rafraîchissement bloqué.",
          completedAt: new Date(),
        },
      });
      await revalidateProductPaths(job.productId);
      return;
    }
  }

  try {
    const payload = job.payload as unknown as QueueJobPayload;
    if (job.marketplace === "PFS") {
      await runPfsJob(job, payload);
    } else if (job.marketplace === "EFASHION") {
      await runEfashionJob(job, payload);
    } else if (job.marketplace === "FAIRE") {
      await runFaireJob(job, payload);
    } else if (job.marketplace === "ORDERCHAMP") {
      await runOrderchampJob(job, payload);
    } else if (job.marketplace === "MICROSTORE") {
      await runMicrostoreJob(job, payload);
    } else {
      await runAnkorstoreJob(job, payload);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] Job crashed", { jobId, error: message });
    await prisma.marketplaceRefreshJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: message,
        completedAt: new Date(),
      },
    });
  }
  await revalidateProductPaths(job.productId);
}

export async function runPfsJob(job: JobRow, payload: QueueJobPayload): Promise<void> {
  await markStep(job.id, { kind: "VALIDATE", status: "done", message: "Données produit validées" });

  // Local bump (bouton « Boutique »)
  let localOutcome: TargetOutcomeOk | undefined;
  if (payload.options.local) {
    await prisma.product.update({
      where: { id: job.productId },
      data: { lastRefreshedAt: new Date() },
    });
    localOutcome = { ok: true };
  }

  let pfsOutcome: TargetOutcome | undefined;

  // Si options.pfs est explicitement false, on ne touche pas PFS — utile pour
  // un job « boutique seule » (bump lastRefreshedAt sans toucher au marketplace).
  if (job.payload && (job.payload as unknown as QueueJobPayload).options.pfs === false) {
    await prisma.marketplaceRefreshJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        localOutcome: (localOutcome as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        completedAt: new Date(),
      },
    });
    emitProductUpdated(job.productId);
    return;
  }

  // Maintenance plateforme (contrôle Beli & Jolie, affecte tous les tenants).
  // Prioritaire sur le kill switch tenant : si la plateforme est en maintenance,
  // aucune boutique ne peut envoyer, même si son propre interrupteur est ON.
  const { isMarketplaceInMaintenance, marketplaceMaintenanceMessage } = await import("@/lib/platform-config");
  if (await isMarketplaceInMaintenance("pfs")) {
    const message = marketplaceMaintenanceMessage("pfs");
    await prisma.marketplaceRefreshJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: message,
        localOutcome: (localOutcome as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        pfsOutcome: { ok: false, kind: "error", message } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    emitProductUpdated(job.productId);
    return;
  }

  // Kill switch PFS : si la marketplace est désactivée dans Paramètres, on
  // classe le job en FAILED (le local bump ci-dessus reste appliqué). Symétrique
  // à Ankorstore/eFashion/Faire.
  const { getCachedPfsEnabled } = await import("@/lib/cached-data");
  const pfsEnabled = await getCachedPfsEnabled();
  if (!pfsEnabled) {
    const message = "Sync Paris Fashion Shop désactivée dans Paramètres.";
    await prisma.marketplaceRefreshJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: message,
        localOutcome: (localOutcome as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        pfsOutcome: { ok: false, kind: "error", message } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    emitProductUpdated(job.productId);
    return;
  }

  try {
    // Branche verify-apply : le tooltip PFS Verify enqueue un job avec les
    // actions ciblées dans payload.verifyActions. On les applique et on
    // court-circuite le switch REFRESH/PUBLISH/RESYNC.
    if (payload.verifyActions && payload.verifyActions.length > 0) {
      const { applyPfsVerifyActions } = await import("@/lib/pfs-verify-apply");
      const report = await applyPfsVerifyActions(job.productId, payload.verifyActions);
      if (report.errors.length > 0) {
        // Concatène les erreurs pour le badge widget. On considère le job en
        // échec dès qu'au moins une action a échoué (comportement conservateur
        // — permet à la cliente de rejouer la sélection).
        const message = report.errors
          .slice(0, 3)
          .map((e) => e.error)
          .join(" · ");
        pfsOutcome = { ok: false, kind: "error", message };
      } else {
        pfsOutcome = {
          ok: true,
          warning:
            report.skipped.length > 0
              ? `${report.skipped.length} action(s) ignorée(s)`
              : undefined,
        };
      }
      // On relance systématiquement une vérification pour actualiser
      // `pfsCheckedAt` / `pfsCheckStatus` / `pfsCheckIssues` en BDD. Le
      // router.refresh() côté client fera passer la pastille en vert
      // (« Conforme ») si tous les écarts sont résolus, ou remontera la
      // liste réduite des écarts restants (en cas de mix succès/erreur).
      try {
        const { verifyPfsProduct } = await import("@/lib/pfs-verify");
        const verifyRes = await verifyPfsProduct(job.productId);
        if (verifyRes.ok) {
          const result = verifyRes.result;
          await prisma.product.update({
            where: { id: job.productId },
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
      } catch (err) {
        logger.warn("[PFS Verify Apply] Post-apply re-verify failed (non-blocking)", {
          productId: job.productId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (job.mode === "REFRESH") {
      await markStep(job.id, { kind: "AUTH", status: "done", message: "Session PFS établie" });
      await markStep(job.id, { kind: "ARCHIVE_OLD", status: "in_progress" });
      const { pfsRefreshProduct } = await import("@/lib/pfs-refresh");
      const res = await pfsRefreshProduct(job.productId, undefined, { skipRevalidation: true });
      if (res.success) {
        pfsOutcome = { ok: true, archived: res.archived };
        await markStep(job.id, { kind: "ARCHIVE_OLD", status: "done", message: "Ancienne fiche archivée" });
        await markStep(job.id, { kind: "CREATE_PRODUCT", status: "done", message: "Nouvelle fiche créée" });
        await markStep(job.id, { kind: "RENAME", status: "done", message: "Référence renommée" });
      } else if (res.reason === "not_found") {
        pfsOutcome = { ok: false, kind: "not_found", message: res.error };
        await markStep(job.id, { kind: "ARCHIVE_OLD", status: "error", message: res.error });
      } else {
        pfsOutcome = { ok: false, kind: "error", message: res.error };
        await markStep(job.id, { kind: "ARCHIVE_OLD", status: "error", message: res.error });
      }
    } else if (job.mode === "PUBLISH") {
      const product = await prisma.product.findUnique({
        where: { id: job.productId },
        select: { pfsProductId: true },
      });
      await markStep(job.id, { kind: "AUTH", status: "done", message: "Session PFS établie" });
      if (product?.pfsProductId) {
        // Produit déjà lié à une fiche PFS → PATCH (modification seulement).
        // ⚠️ PAS de fallback "publish" auto si le PATCH échoue : ça effacerait
        // le lien pfsProductId en base et retenterait un create sur la même
        // reference_code, ce que PFS refuse (« Référence non valide »). Cas
        // vu en réel sur A264 le 03/08 après un abort du fetch d'update.
        await markStep(job.id, { kind: "UPDATE_PRODUCT", status: "in_progress" });
        const { pfsUpdateProductInPlace } = await import("@/lib/pfs-update");
        const res = await pfsUpdateProductInPlace(job.productId, undefined, {
          skipRevalidation: true,
        });
        if (res.success) {
          pfsOutcome = { ok: true, archived: res.archived };
          await markStep(job.id, {
            kind: "UPDATE_PRODUCT",
            status: "done",
            message: `Fiche PFS mise à jour (id ${product.pfsProductId})`,
            data: { pfsProductId: product.pfsProductId },
          });
        } else {
          logger.error("[Marketplace Queue] PFS update failed (no fallback)", {
            productId: job.productId,
            error: res.error,
          });
          pfsOutcome = {
            ok: false,
            kind: "error",
            message:
              `Modification Paris Fashion Shop refusée : ${res.error ?? "erreur inconnue"}. ` +
              `Aucun produit n'a été recréé pour éviter un doublon ou un lien cassé. ` +
              `Vérifiez le contenu puis re-tentez.`,
          };
          await markStep(job.id, {
            kind: "UPDATE_PRODUCT",
            status: "error",
            message: res.error ?? "Erreur inconnue",
          });
        }
      } else {
        await markStep(job.id, { kind: "CREATE_PRODUCT", status: "in_progress" });
        const { pfsPublishProduct } = await import("@/lib/pfs-publish");
        const res = await pfsPublishProduct(job.productId, undefined, {
          skipRevalidation: true,
        });
        if (res.success) {
          pfsOutcome = { ok: true, archived: res.archived };
          await markStep(job.id, {
            kind: "CREATE_PRODUCT",
            status: "done",
            message: "Produit créé sur PFS",
          });
        } else {
          pfsOutcome = { ok: false, kind: "error", message: res.error };
          await markStep(job.id, { kind: "CREATE_PRODUCT", status: "error", message: res.error });
        }
      }
    } else if (job.mode === "RESYNC") {
      const product = await prisma.product.findUnique({
        where: { id: job.productId },
        select: { pfsProductId: true },
      });
      await markStep(job.id, { kind: "AUTH", status: "done", message: "Session PFS établie" });
      if (!product?.pfsProductId) {
        pfsOutcome = {
          ok: false,
          kind: "error",
          message: "Produit non publié sur Paris Fashion Shop.",
        };
        await markStep(job.id, {
          kind: "UPDATE_PRODUCT",
          status: "error",
          message: "Produit non publié sur Paris Fashion Shop.",
        });
      } else {
        await markStep(job.id, { kind: "UPDATE_PRODUCT", status: "in_progress", label: "Sync complète (forceFullSync)" });
        const { pfsUpdateProductInPlace } = await import("@/lib/pfs-update");
        const res = await pfsUpdateProductInPlace(job.productId, undefined, {
          skipRevalidation: true,
          forceFullSync: true,
        });
        if (res.success) {
          pfsOutcome = { ok: true, archived: res.archived };
          await markStep(job.id, {
            kind: "UPDATE_PRODUCT",
            status: "done",
            message: "Sync complète effectuée",
          });
        } else {
          pfsOutcome = { ok: false, kind: "error", message: res.error };
          await markStep(job.id, { kind: "UPDATE_PRODUCT", status: "error", message: res.error });
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] PFS unexpected error", {
      productId: job.productId,
      jobId: job.id,
      error: message,
    });
    pfsOutcome = { ok: false, kind: "error", message };
  }

  const errorMessage =
    pfsOutcome && pfsOutcome.ok === false ? pfsOutcome.message : null;
  await prisma.marketplaceRefreshJob.update({
    where: { id: job.id },
    data: {
      status: errorMessage !== null ? "FAILED" : "SUCCEEDED",
      localOutcome: (localOutcome as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      pfsOutcome: (pfsOutcome as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      errorMessage,
      completedAt: new Date(),
    },
  });
  if (errorMessage === null) {
    await markStep(job.id, { kind: "SAVE_IDS", status: "done", message: "Identifiants sauvegardés" });
  }

  emitProductUpdated(job.productId);
}

async function runAnkorstoreJob(job: JobRow, payload: QueueJobPayload): Promise<void> {
  // Si options.ankorstore est explicitement false, on classe le job en succès
  // sans rien appeler — défensif au cas où un enqueue mal formé arriverait.
  if (payload.options.ankorstore === false) {
    await prisma.marketplaceRefreshJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });
    return;
  }

  const { isMarketplaceInMaintenance: isAnkorMaintenance, marketplaceMaintenanceMessage: ankorMaintenanceMsg } =
    await import("@/lib/platform-config");
  if (await isAnkorMaintenance("ankorstore")) {
    await markAnkorstoreFailed(job.id, "error", ankorMaintenanceMsg("ankorstore"));
    return;
  }

  const { getCachedAnkorstoreEnabled } = await import("@/lib/cached-data");
  const ankorstoreEnabled = await getCachedAnkorstoreEnabled();
  if (!ankorstoreEnabled) {
    await markAnkorstoreFailed(job.id, "error", "Sync Ankorstore désactivée dans Paramètres.");
    return;
  }

  await markStep(job.id, { kind: "VALIDATE", status: "done", message: "Données produit validées" });
  await markStep(job.id, { kind: "AUTH", status: "done", message: "Session back-office Ankorstore établie" });

  try {
    // Toutes les branches convergent vers le même appel BO — 100 % synchrone,
    // pas de callback. Le mode REFRESH/PUBLISH/RESYNC ne change plus rien :
    // c'est toujours "envoyer l'état BJ actuel chez Ankor" (POST si pas de lien
    // INT, PUT sinon). Voir app/actions/admin/ankorstore-bo.ts.
    const product = await prisma.product.findUnique({
      where: { id: job.productId },
      select: { ankorsProductId: true },
    });
    const stepKind = product?.ankorsProductId ? "UPDATE_PRODUCT" : "CREATE_PRODUCT";
    await markStep(job.id, { kind: stepKind, status: "in_progress" });

    const { publishProductToAnkorstoreBo } = await import("@/app/actions/admin/ankorstore-bo");
    const res = await publishProductToAnkorstoreBo(job.productId);
    if (res.success) {
      await markStep(job.id, {
        kind: stepKind,
        status: "done",
        message: product?.ankorsProductId
          ? `Fiche Ankorstore mise à jour (id ${product.ankorsProductId})`
          : "Produit créé sur Ankorstore",
        data: product?.ankorsProductId ? { ankorsProductId: product.ankorsProductId } : undefined,
      });
      await markAnkorstoreSuccess(job.id, false);
      await markStep(job.id, { kind: "SAVE_IDS", status: "done", message: "Identifiants sauvegardés" });
    } else {
      await markStep(job.id, {
        kind: stepKind,
        status: "error",
        message: res.error ?? "Erreur inconnue",
      });
      await markAnkorstoreFailed(job.id, "error", res.error ?? "Erreur inconnue");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] Ankorstore unexpected error", {
      productId: job.productId,
      jobId: job.id,
      error: message,
    });
    await markStep(job.id, { kind: "CREATE_PRODUCT", status: "error", message });
    await markAnkorstoreFailed(job.id, "error", message);
  }
}

async function markAnkorstoreAwaiting(jobId: string, operationId: string): Promise<void> {
  const outcome: TargetOutcome = { ok: true, opId: operationId, warning: "queued" };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: "AWAITING_CALLBACK",
      ankorsOperationId: operationId,
      ankorsOutcome: outcome as Prisma.InputJsonValue,
    },
  });
}

async function markAnkorstoreSuccess(jobId: string, archived: boolean): Promise<void> {
  const outcome: TargetOutcome = { ok: true, archived };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      ankorsOutcome: outcome as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

async function markAnkorstoreFailed(
  jobId: string,
  kind: "not_found" | "error",
  message: string,
): Promise<void> {
  const outcome: TargetOutcome = { ok: false, kind, message };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      ankorsOutcome: outcome as Prisma.InputJsonValue,
      errorMessage: message,
      completedAt: new Date(),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// eFashion Paris — sync synchrone (mode update uniquement pour Lot 3 ;
// publish/refresh via shooting arrivent au Lot 4-5)
// ─────────────────────────────────────────────────────────────────────
async function runEfashionJob(job: JobRow, payload: QueueJobPayload): Promise<void> {
  if (payload.options.efashion === false) {
    await prisma.marketplaceRefreshJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });
    return;
  }

  const { isMarketplaceInMaintenance: isEfMaintenance, marketplaceMaintenanceMessage: efMaintenanceMsg } =
    await import("@/lib/platform-config");
  if (await isEfMaintenance("efashion")) {
    await markEfashionFailed(job.id, "error", efMaintenanceMsg("efashion"));
    return;
  }

  const { getCachedEfashionEnabled } = await import("@/lib/cached-data");
  const enabled = await getCachedEfashionEnabled();
  if (!enabled) {
    await markEfashionFailed(job.id, "error", "Sync eFashion désactivée dans Paramètres.");
    return;
  }

  await markStep(job.id, { kind: "VALIDATE", status: "done", message: "Données produit validées" });
  await markStep(job.id, { kind: "AUTH", status: "done", message: "Session eFashion établie" });

  try {
    const product = await prisma.product.findUnique({
      where: { id: job.productId },
      select: { efashionReferenceBase: true },
    });
    const isLinked = !!product?.efashionReferenceBase;
    const stepKind = isLinked ? "UPDATE_PRODUCT" : "CREATE_PRODUCT";

    const finalize = async (
      res: { success: true } | { success: false; error?: string | null },
    ) => {
      if (res.success) {
        await markStep(job.id, {
          kind: stepKind,
          status: "done",
          message: isLinked
            ? `Fiche eFashion mise à jour (${product?.efashionReferenceBase ?? ""})`
            : "Produit créé sur eFashion",
        });
        await markEfashionSuccess(job.id, false);
        await markStep(job.id, { kind: "SAVE_IDS", status: "done", message: "Identifiants sauvegardés" });
      } else {
        const err = res.error ?? "Erreur inconnue";
        await markStep(job.id, { kind: stepKind, status: "error", message: err });
        await markEfashionFailed(job.id, "error", err);
      }
    };

    if (job.mode === "RESYNC") {
      if (!isLinked) {
        const msg = "Produit non lié à eFashion — impossible de resynchroniser.";
        await markStep(job.id, { kind: "UPDATE_PRODUCT", status: "error", message: msg });
        await markEfashionFailed(job.id, "error", msg);
        return;
      }
      await markStep(job.id, { kind: stepKind, status: "in_progress", label: "Sync complète (forceFullSync)" });
      const { efashionUpdateProductInPlace } = await import("@/lib/efashion-update");
      await finalize(await efashionUpdateProductInPlace(job.productId, { forceFullSync: true }));
    } else if (job.mode === "PUBLISH") {
      await markStep(job.id, { kind: stepKind, status: "in_progress" });
      if (isLinked) {
        const { efashionUpdateProductInPlace } = await import("@/lib/efashion-update");
        await finalize(await efashionUpdateProductInPlace(job.productId));
      } else {
        const { efashionPublishProduct } = await import("@/lib/efashion-publish");
        await finalize(await efashionPublishProduct(job.productId));
      }
    } else if (job.mode === "REFRESH") {
      // REFRESH = renommer + soft-delete + republier (workflow PFS-like)
      // pour que les nouvelles fiches obtiennent une date de création récente
      // côté eFashion → elles remontent en premier dans le catalogue vendeur.
      // Si pas lié, on bascule sur PUBLISH classique.
      if (isLinked) {
        await markStep(job.id, { kind: "ARCHIVE_OLD", status: "in_progress" });
        const { efashionRefreshProduct } = await import("@/lib/efashion-refresh");
        const res = await efashionRefreshProduct(job.productId);
        if (res.success) {
          await markStep(job.id, { kind: "ARCHIVE_OLD", status: "done", message: "Ancienne fiche archivée" });
          await markStep(job.id, { kind: "CREATE_PRODUCT", status: "done", message: "Nouvelle fiche créée" });
          await markStep(job.id, { kind: "RENAME", status: "done", message: "Référence renommée" });
          await markEfashionSuccess(job.id, false);
          await markStep(job.id, { kind: "SAVE_IDS", status: "done", message: "Identifiants sauvegardés" });
        } else {
          const err = res.error ?? "Erreur inconnue";
          await markStep(job.id, { kind: "ARCHIVE_OLD", status: "error", message: err });
          await markEfashionFailed(job.id, "error", err);
        }
      } else {
        await markStep(job.id, { kind: "CREATE_PRODUCT", status: "in_progress" });
        const { efashionPublishProduct } = await import("@/lib/efashion-publish");
        const res = await efashionPublishProduct(job.productId);
        if (res.success) {
          await markStep(job.id, { kind: "CREATE_PRODUCT", status: "done", message: "Produit créé sur eFashion" });
          await markEfashionSuccess(job.id, false);
          await markStep(job.id, { kind: "SAVE_IDS", status: "done", message: "Identifiants sauvegardés" });
        } else {
          const err = res.error ?? "Erreur inconnue";
          await markStep(job.id, { kind: "CREATE_PRODUCT", status: "error", message: err });
          await markEfashionFailed(job.id, "error", err);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] eFashion unexpected error", {
      productId: job.productId,
      jobId: job.id,
      error: message,
    });
    await markStep(job.id, { kind: "CREATE_PRODUCT", status: "error", message });
    await markEfashionFailed(job.id, "error", message);
  }
}

async function markEfashionSuccess(jobId: string, archived: boolean): Promise<void> {
  const outcome: TargetOutcome = { ok: true, archived };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      efashionOutcome: outcome as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

async function markEfashionFailed(
  jobId: string,
  kind: "not_found" | "error",
  message: string,
): Promise<void> {
  const outcome: TargetOutcome = { ok: false, kind, message };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      efashionOutcome: outcome as Prisma.InputJsonValue,
      errorMessage: message,
      completedAt: new Date(),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Faire — sync synchrone (POST /products + PATCH /products/{id} +
// PATCH inventory). Mode REFRESH = duplication (faire-refresh).
// ─────────────────────────────────────────────────────────────────────
async function runFaireJob(job: JobRow, payload: QueueJobPayload): Promise<void> {
  if (payload.options.faire === false) {
    await prisma.marketplaceRefreshJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });
    return;
  }

  const { isMarketplaceInMaintenance: isFaireMaintenance, marketplaceMaintenanceMessage: faireMaintenanceMsg } =
    await import("@/lib/platform-config");
  if (await isFaireMaintenance("faire")) {
    await markFaireFailed(job.id, "error", faireMaintenanceMsg("faire"));
    return;
  }

  const { getCachedFaireEnabled } = await import("@/lib/cached-data");
  const enabled = await getCachedFaireEnabled();
  if (!enabled) {
    await markFaireFailed(job.id, "error", "Sync Faire désactivée dans Paramètres.");
    return;
  }

  await markStep(job.id, { kind: "VALIDATE", status: "done", message: "Données produit validées" });
  await markStep(job.id, { kind: "AUTH", status: "done", message: "Session Faire établie" });

  try {
    const product = await prisma.product.findUnique({
      where: { id: job.productId },
      select: { faireProductId: true, status: true },
    });
    const isLinked = !!product?.faireProductId;
    const stepKind = isLinked ? "UPDATE_PRODUCT" : "CREATE_PRODUCT";
    // Faire crée par défaut en DRAFT (invisible sur Faire). Si le produit BJ
    // est en ligne, on publie directement en PUBLISHED pour qu'il apparaisse
    // dans le catalogue Faire.
    const lifecycleState: "DRAFT" | "PUBLISHED" =
      product?.status === "ONLINE" ? "PUBLISHED" : "DRAFT";

    const finalizeOk = async () => {
      await markStep(job.id, {
        kind: stepKind,
        status: "done",
        message: isLinked
          ? `Fiche Faire mise à jour (id ${product?.faireProductId})`
          : "Produit créé sur Faire",
        data: isLinked && product?.faireProductId ? { faireProductId: product.faireProductId } : undefined,
      });
      await markFaireSuccess(job.id);
      await markStep(job.id, { kind: "SAVE_IDS", status: "done", message: "Identifiants sauvegardés" });
    };
    const finalizeError = async (err: string) => {
      await markStep(job.id, { kind: stepKind, status: "error", message: err });
      await markFaireFailed(job.id, "error", err);
    };

    if (job.mode === "RESYNC") {
      if (!isLinked) {
        const msg = "Produit non publié sur Faire.";
        await markStep(job.id, { kind: "UPDATE_PRODUCT", status: "error", message: msg });
        await markFaireFailed(job.id, "error", msg);
        return;
      }
      await markStep(job.id, { kind: stepKind, status: "in_progress", label: "Sync complète (forceFullSync)" });
      const { faireUpdateProduct } = await import("@/lib/faire-update");
      const res = await faireUpdateProduct(job.productId, { forceFullSync: true });
      if (res.success) await finalizeOk();
      else await finalizeError(res.error);
    } else if (job.mode === "PUBLISH") {
      await markStep(job.id, { kind: stepKind, status: "in_progress" });
      if (isLinked) {
        // Produit déjà lié à une fiche Faire → PATCH (modification seulement).
        // ⚠️ PAS de fallback "publish" auto si le PATCH échoue : ça créerait
        // un doublon côté Faire (cas vu en réel sur F137). On remonte l'erreur
        // claire pour que l'admin re-tente ou délie + relie manuellement.
        const { faireUpdateProduct } = await import("@/lib/faire-update");
        const res = await faireUpdateProduct(job.productId);
        if (res.success) {
          await finalizeOk();
        } else {
          logger.error("[Marketplace Queue] Faire update failed (no fallback)", {
            productId: job.productId,
            error: res.error,
          });
          await finalizeError(
            `Modification Faire refusée : ${res.error ?? "erreur inconnue"}. ` +
              `Aucun produit n'a été recréé pour éviter un doublon. ` +
              `Vérifiez le contenu (caractères spéciaux, champs trop longs) puis re-tentez.`,
          );
        }
      } else {
        const { fairePublishProduct } = await import("@/lib/faire-publish");
        const res = await fairePublishProduct(job.productId, { lifecycleState });
        if (res.success) await finalizeOk();
        else await finalizeError(res.error);
      }
    } else if (job.mode === "REFRESH") {
      if (isLinked) {
        await markStep(job.id, { kind: "ARCHIVE_OLD", status: "in_progress" });
        const { faireRefreshProduct } = await import("@/lib/faire-refresh");
        const res = await faireRefreshProduct(job.productId);
        if (res.success) {
          await markStep(job.id, { kind: "ARCHIVE_OLD", status: "done", message: "Ancienne fiche archivée" });
          await markStep(job.id, { kind: "CREATE_PRODUCT", status: "done", message: "Nouvelle fiche créée" });
          await markFaireSuccess(job.id);
          await markStep(job.id, { kind: "SAVE_IDS", status: "done", message: "Identifiants sauvegardés" });
        } else {
          await markStep(job.id, { kind: "ARCHIVE_OLD", status: "error", message: res.error });
          await markFaireFailed(job.id, "error", res.error);
        }
      } else {
        await markStep(job.id, { kind: "CREATE_PRODUCT", status: "in_progress" });
        const { fairePublishProduct } = await import("@/lib/faire-publish");
        const res = await fairePublishProduct(job.productId, { lifecycleState });
        if (res.success) {
          await markStep(job.id, { kind: "CREATE_PRODUCT", status: "done", message: "Produit créé sur Faire" });
          await markFaireSuccess(job.id);
          await markStep(job.id, { kind: "SAVE_IDS", status: "done", message: "Identifiants sauvegardés" });
        } else {
          await markStep(job.id, { kind: "CREATE_PRODUCT", status: "error", message: res.error });
          await markFaireFailed(job.id, "error", res.error);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] Faire unexpected error", {
      productId: job.productId,
      jobId: job.id,
      error: message,
    });
    await markStep(job.id, { kind: "CREATE_PRODUCT", status: "error", message });
    await markFaireFailed(job.id, "error", message);
  }
}

async function markFaireSuccess(jobId: string): Promise<void> {
  const outcome: TargetOutcome = { ok: true };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      faireOutcome: outcome as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

async function markFaireFailed(
  jobId: string,
  kind: "not_found" | "error",
  message: string,
): Promise<void> {
  const outcome: TargetOutcome = { ok: false, kind, message };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      faireOutcome: outcome as Prisma.InputJsonValue,
      errorMessage: message,
      completedAt: new Date(),
    },
  });
}

// ─── Orderchamp ─────────────────────────────────────────────────────────────

async function runOrderchampJob(job: JobRow, payload: QueueJobPayload): Promise<void> {
  if (payload.options.orderchamp === false) {
    await prisma.marketplaceRefreshJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });
    return;
  }

  const { isMarketplaceInMaintenance, marketplaceMaintenanceMessage } =
    await import("@/lib/platform-config");
  if (await isMarketplaceInMaintenance("orderchamp")) {
    await markOrderchampFailed(job.id, "error", marketplaceMaintenanceMessage("orderchamp"));
    return;
  }

  const { getCachedOrderchampEnabled } = await import("@/lib/cached-data");
  const enabled = await getCachedOrderchampEnabled();
  if (!enabled) {
    await markOrderchampFailed(job.id, "error", "Sync Orderchamp désactivée dans Paramètres.");
    return;
  }

  await markStep(job.id, { kind: "VALIDATE", status: "done", message: "Données produit validées" });
  await markStep(job.id, { kind: "AUTH", status: "done", message: "Session Orderchamp établie" });

  try {
    const product = await prisma.product.findUnique({
      where: { id: job.productId },
      select: { orderchampProductId: true, status: true },
    });
    const isLinked = !!product?.orderchampProductId;
    const stepKind = isLinked ? "UPDATE_PRODUCT" : "CREATE_PRODUCT";

    const finalizeOk = async () => {
      await markStep(job.id, {
        kind: stepKind,
        status: "done",
        message: isLinked
          ? `Fiche Orderchamp mise à jour (id ${product?.orderchampProductId})`
          : "Produit créé sur Orderchamp",
      });
      await markOrderchampSuccess(job.id);
      await markStep(job.id, { kind: "SAVE_IDS", status: "done", message: "Identifiants sauvegardés" });
    };
    const finalizeError = async (err: string) => {
      await markStep(job.id, { kind: stepKind, status: "error", message: err });
      await markOrderchampFailed(job.id, "error", err);
    };

    if (job.mode === "RESYNC") {
      if (!isLinked) {
        const msg = "Produit non publié sur Orderchamp.";
        await markStep(job.id, { kind: "UPDATE_PRODUCT", status: "error", message: msg });
        await markOrderchampFailed(job.id, "error", msg);
        return;
      }
      await markStep(job.id, { kind: stepKind, status: "in_progress", label: "Sync complète (forceFullSync)" });
      const { orderchampUpdateProduct } = await import("@/lib/orderchamp-update");
      const res = await orderchampUpdateProduct(job.productId, { forceFullSync: true });
      if (res.success) await finalizeOk();
      else await finalizeError(res.error ?? "Erreur inconnue");
    } else if (job.mode === "PUBLISH") {
      await markStep(job.id, { kind: stepKind, status: "in_progress" });
      if (isLinked) {
        const { orderchampUpdateProduct } = await import("@/lib/orderchamp-update");
        const res = await orderchampUpdateProduct(job.productId);
        if (res.success) await finalizeOk();
        else await finalizeError(res.error ?? "Erreur inconnue");
      } else {
        const { orderchampPublishProduct } = await import("@/lib/orderchamp-publish");
        const res = await orderchampPublishProduct(job.productId);
        if (res.success) await finalizeOk();
        else await finalizeError(res.error);
      }
    } else if (job.mode === "REFRESH") {
      // Orderchamp = productRepublish garde le MÊME ID (pas de delete+recreate)
      await markStep(job.id, { kind: stepKind, status: "in_progress" });
      const { orderchampRefreshProduct } = await import("@/lib/orderchamp-refresh");
      const res = await orderchampRefreshProduct(job.productId);
      if (res.success) await finalizeOk();
      else await finalizeError(res.error ?? "Erreur inconnue");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] Orderchamp unexpected error", {
      productId: job.productId,
      jobId: job.id,
      error: message,
    });
    await markStep(job.id, { kind: "CREATE_PRODUCT", status: "error", message });
    await markOrderchampFailed(job.id, "error", message);
  }
}

async function markOrderchampSuccess(jobId: string): Promise<void> {
  const outcome: TargetOutcome = { ok: true };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      orderchampOutcome: outcome as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

async function markOrderchampFailed(
  jobId: string,
  kind: "not_found" | "error",
  message: string,
): Promise<void> {
  const outcome: TargetOutcome = { ok: false, kind, message };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      orderchampOutcome: outcome as Prisma.InputJsonValue,
      errorMessage: message,
      completedAt: new Date(),
    },
  });
}

// ─── Microstore ─────────────────────────────────────────────────────────────

async function runMicrostoreJob(job: JobRow, payload: QueueJobPayload): Promise<void> {
  if (payload.options.microstore === false) {
    await prisma.marketplaceRefreshJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });
    return;
  }

  const { getCachedMicrostoreEnabled } = await import("@/lib/cached-data");
  const enabled = await getCachedMicrostoreEnabled();
  if (!enabled) {
    await markMicrostoreFailed(job.id, "error", "Microstore désactivée dans Paramètres.");
    return;
  }

  await markStep(job.id, { kind: "VALIDATE", status: "done", message: "Données produit validées" });
  await markStep(job.id, { kind: "AUTH", status: "done", message: "Session Microstore établie" });

  // Dispatch selon le mode. Push (PUBLISH/REFRESH/RESYNC) = renvoi de la fiche
  // complète. DISABLE/ENABLE = masquer/réafficher. DELETE = suppression dure.
  const mode = job.mode as string;
  if (mode === "DISABLE" || mode === "ENABLE") {
    await runMicrostoreDisableJob(job, mode === "DISABLE");
    return;
  }
  if (mode === "DELETE") {
    await runMicrostoreDeleteJob(job);
    return;
  }

  try {
    const product = await prisma.product.findUnique({
      where: { id: job.productId },
      select: {
        reference: true,
        microstoreProductId: true,
        microstoreLastPushedAt: true,
      } as never,
    });
    const alreadyPushed = !!(product as { microstoreLastPushedAt?: Date } | null)?.microstoreLastPushedAt;
    const stepKind = alreadyPushed ? "UPDATE_PRODUCT" : "CREATE_PRODUCT";

    await markStep(job.id, { kind: stepKind, status: "in_progress" });

    const { microstorePushProduct } = await import("@/lib/microstore-products");
    const { loadExportContext, loadExportProducts } = await import(
      "@/lib/marketplace-excel/load-products"
    );
    const [ctx, exportProducts] = await Promise.all([
      loadExportContext(),
      loadExportProducts([job.productId]),
    ]);
    const exportProduct = exportProducts[0];
    if (!exportProduct) {
      await markStep(job.id, { kind: stepKind, status: "error", message: "Produit introuvable pour l'export Microstore." });
      await markMicrostoreFailed(job.id, "error", "Produit introuvable pour l'export Microstore.");
      return;
    }
    const res = await microstorePushProduct(exportProduct, ctx);
    if (res.success) {
      await prisma.product.update({
        where: { id: job.productId },
        data: {
          microstoreLastPushedAt: new Date(),
          microstoreSyncRequired: false,
        },
      });
      await markStep(job.id, {
        kind: stepKind,
        status: "done",
        message: alreadyPushed ? "Fiche Microstore mise à jour" : "Produit créé sur Microstore",
      });
      await markMicrostoreSuccess(job.id);
      await markStep(job.id, { kind: "SAVE_IDS", status: "done", message: "Identifiants sauvegardés" });

      // Chaîne l'envoi photos via la Station de Transfert (fire-and-forget).
      // Le worker tourne déjà sous `tenantALS.run(...)` en amont, donc pas
      // besoin de re-binder l'ALS. La progression est suivie via le widget
      // « Photos Microstore » (MicrostoreUploadJob), pas via ce job de queue.
      // Ajouté le 2026-08-25 pour couvrir le chemin modale d'enregistrement
      // qui, jusque-là, poussait le produit sans jamais envoyer les photos.
      const productReference = (product as { reference?: string } | null)?.reference;
      if (productReference) {
        void (async () => {
          try {
            const { getStoredPictureStation } = await import(
              "@/lib/microstore-picture-station"
            );
            const stored = await getStoredPictureStation();
            if (!stored) return;
            const { sendProductPhotosToMicrostoreCore } = await import(
              "@/lib/microstore-photos-sync"
            );
            const psRes = await sendProductPhotosToMicrostoreCore(productReference);
            if (!psRes.success) {
              logger.warn("[Marketplace Queue] Microstore photos sync failed", {
                productId: job.productId,
                reference: productReference,
                error: psRes.error,
              });
            }
          } catch (err) {
            logger.error("[Marketplace Queue] Microstore photos sync threw", {
              error: err,
              productId: job.productId,
            });
          }
        })();
      }
    } else {
      const errMsg = res.error ?? "Erreur inconnue";
      await markStep(job.id, { kind: stepKind, status: "error", message: errMsg });
      await markMicrostoreFailed(job.id, "error", errMsg);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] Microstore unexpected error", {
      productId: job.productId,
      jobId: job.id,
      error: message,
    });
    await markStep(job.id, { kind: "CREATE_PRODUCT", status: "error", message });
    await markMicrostoreFailed(job.id, "error", message);
  }
}

/**
 * Masquer / réafficher un produit Microstore via `microstoreDisableGoods`.
 * Réplique la logique de `toggleMicrostoreProductDisabled` (server action)
 * mais sans requireAdmin — le worker ne tourne pas dans un contexte HTTP.
 */
async function runMicrostoreDisableJob(job: JobRow, disable: boolean): Promise<void> {
  try {
    const product = await prisma.product.findUnique({
      where: { id: job.productId },
      select: { microstoreProductId: true } as never,
    });
    const msId = (product as { microstoreProductId: number | null } | null)?.microstoreProductId;
    if (msId == null) {
      const msg = "Ce produit n'est pas publié sur Microstore.";
      await markStep(job.id, { kind: "UPDATE_PRODUCT", status: "error", message: msg });
      await markMicrostoreFailed(job.id, "not_found", msg);
      return;
    }

    const stepMsg = disable ? "Masquage sur Microstore" : "Réaffichage sur Microstore";
    await markStep(job.id, { kind: "UPDATE_PRODUCT", status: "in_progress", message: stepMsg });

    const { microstoreDisableGoods } = await import("@/lib/microstore-goods-crud");
    await microstoreDisableGoods({ microstoreProductId: msId, disabled: disable });

    await markStep(job.id, {
      kind: "UPDATE_PRODUCT",
      status: "done",
      message: disable ? "Produit masqué sur Microstore" : "Produit réaffiché sur Microstore",
    });
    await markMicrostoreSuccess(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] Microstore disable failed", {
      productId: job.productId,
      jobId: job.id,
      disable,
      error: message,
    });
    await markStep(job.id, { kind: "UPDATE_PRODUCT", status: "error", message });
    await markMicrostoreFailed(job.id, "error", message);
  }
}

/**
 * Suppression définitive d'un produit Microstore + reset des IDs de liaison BJ.
 * Réplique `deleteProductFromMicrostore` sans le requireAdmin.
 */
async function runMicrostoreDeleteJob(job: JobRow): Promise<void> {
  try {
    const product = await prisma.product.findUnique({
      where: { id: job.productId },
      select: { microstoreProductId: true } as never,
    });
    const msId = (product as { microstoreProductId: number | null } | null)?.microstoreProductId;
    if (msId == null) {
      const msg = "Ce produit n'est pas publié sur Microstore.";
      await markStep(job.id, { kind: "DELETE_VARIANTS", status: "error", message: msg });
      await markMicrostoreFailed(job.id, "not_found", msg);
      return;
    }

    await markStep(job.id, {
      kind: "DELETE_VARIANTS",
      status: "in_progress",
      message: "Suppression sur Microstore",
    });

    const { microstoreDeleteGoods } = await import("@/lib/microstore-goods-crud");
    await microstoreDeleteGoods(msId);

    // Reset des IDs de liaison (produit + variantes couleur).
    await prisma.$transaction([
      prisma.product.update({
        where: { id: job.productId },
        data: {
          microstoreProductId: null,
          microstoreLastPushedAt: null,
          microstoreSyncRequired: false,
          microstoreLastSyncSnapshot: null,
        } as never,
      }),
      prisma.productColor.updateMany({
        where: { productId: job.productId },
        data: { microstoreVariantId: null } as never,
      }),
    ]);

    await markStep(job.id, {
      kind: "DELETE_VARIANTS",
      status: "done",
      message: "Produit supprimé sur Microstore",
    });
    await markMicrostoreSuccess(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] Microstore delete failed", {
      productId: job.productId,
      jobId: job.id,
      error: message,
    });
    await markStep(job.id, { kind: "DELETE_VARIANTS", status: "error", message });
    await markMicrostoreFailed(job.id, "error", message);
  }
}

async function markMicrostoreSuccess(jobId: string): Promise<void> {
  const outcome: TargetOutcome = { ok: true };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      microstoreOutcome: outcome as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

async function markMicrostoreFailed(
  jobId: string,
  kind: "not_found" | "error",
  message: string,
): Promise<void> {
  const outcome: TargetOutcome = { ok: false, kind, message };
  await prisma.marketplaceRefreshJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      microstoreOutcome: outcome as Prisma.InputJsonValue,
      errorMessage: message,
      completedAt: new Date(),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
async function revalidateProductPaths(productId: string): Promise<void> {
  try {
    revalidatePath("/admin/produits");
    revalidatePath(`/admin/produits/${productId}/modifier`);
    await revalidateProductPublicPage(productId);
    revalidatePath("/produits");
    revalidateTag("products", "default");
  } catch {
    // Hors contexte de requête, revalidate peut être no-op : pas un bloquant
  }
}

function emitProductUpdated(productId: string): void {
  void (async () => {
    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { status: true },
      });
      if (product?.status === "ONLINE") {
        emitProductEvent({ type: "PRODUCT_UPDATED", productId });
      }
    } catch {
      // best-effort
    }
  })();
}
