/**
 * lib/marketplace-queue-worker.ts
 *
 * Worker singleton qui traite la file `MarketplaceRefreshJob` côté serveur.
 * Démarré une seule fois au boot via `instrumentation-node.ts`.
 *
 * Architecture :
 *  - Loop d'1 seconde (`POLL_MS`) qui scan la table à chaque tick
 *  - Au premier démarrage : sweep des jobs `IN_PROGRESS` orphelins (process tué)
 *  - Concurrence : 5 jobs total en vol, dont au plus 3 Ankorstore
 *    (Ankorstore comptabilise IN_PROGRESS + AWAITING_CALLBACK)
 *  - Réconciliation : pour les jobs `AWAITING_CALLBACK` Ankorstore, on suit la
 *    dernière `AnkorstoreOperation` du produit (qui chaîne automatiquement
 *    REFRESH_DELETE_OLD → REFRESH_CREATE_NEW)
 *  - Idempotence : transitions QUEUED → IN_PROGRESS via updateMany WHERE status,
 *    pour qu'un éventuel double-tick ne lance pas deux fois le même job
 */
import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";
import { tenantALS } from "@/lib/tenant-als";

const POLL_MS = 1000;
const TOTAL_CONCURRENCY = 5;
const ANKORSTORE_CONCURRENCY = 1;

const STARTUP_GUARD = Symbol.for("beliandjolie.marketplaceQueueWorker.started");
const g = globalThis as Record<symbol, unknown>;

type JobRow = Prisma.MarketplaceRefreshJobGetPayload<Record<string, never>>;

interface QueueJobPayload {
  reference: string;
  productName: string;
  firstImage: string | null;
  options: {
    local?: boolean;
    pfs?: boolean;
    ankorstore?: boolean;
    efashion?: boolean;
    faire?: boolean;
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

  logger.info("[Marketplace Queue] Worker démarré (poll 1s, 5 slots, 1 Ankorstore)");
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
  await reconcileAwaitingCallback();
  await startQueued();
}

// ─────────────────────────────────────────────────────────────────────
// Réconciliation des Ankorstore en AWAITING_CALLBACK
// ─────────────────────────────────────────────────────────────────────
async function reconcileAwaitingCallback(): Promise<void> {
  const awaiting = await prisma.marketplaceRefreshJob.findMany({
    where: {
      status: "AWAITING_CALLBACK",
      marketplace: "ANKORSTORE",
    },
    select: { id: true, productId: true },
  });
  if (awaiting.length === 0) return;

  const productIds = Array.from(new Set(awaiting.map((j) => j.productId)));
  // Pour chaque produit, on récupère la dernière opération non-CANCELLED.
  // Elle suit la chaîne DELETE_OLD → CREATE_NEW automatiquement.
  const ops = await prisma.ankorstoreOperation.findMany({
    where: { productId: { in: productIds }, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      productId: true,
      type: true,
      status: true,
      errorMessage: true,
    },
  });
  const latestByProduct = new Map<string, (typeof ops)[number]>();
  for (const op of ops) {
    if (!latestByProduct.has(op.productId)) latestByProduct.set(op.productId, op);
  }

  // Prépare la liste des updates à faire, puis lance tout en parallèle. Avant :
  // chaque `await prisma.update()` faisait un round-trip DB séquentiel — sur 20
  // jobs en attente, ça bloquait le tick 2-4 s. En parallélisant, on descend à
  // <500 ms même sur 100 jobs.
  type PendingUpdate = {
    jobId: string;
    productId: string;
    data: Prisma.MarketplaceRefreshJobUpdateInput;
    emitSuccess: boolean;
  };
  const pending: PendingUpdate[] = [];

  for (const job of awaiting) {
    const latest = latestByProduct.get(job.productId);
    if (!latest || latest.status === "PENDING") continue;

    if (latest.status === "SUCCEEDED" || latest.status === "PARTIALLY_FAILED") {
      const outcome: TargetOutcome = {
        ok: true,
        archived: false,
        warning:
          latest.status === "PARTIALLY_FAILED"
            ? "Succès partiel — vérifiez le tableau de bord Ankorstore."
            : undefined,
      };
      pending.push({
        jobId: job.id,
        productId: job.productId,
        data: {
          status: "SUCCEEDED",
          ankorsOutcome: outcome as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
        emitSuccess: true,
      });
    } else if (latest.status === "FAILED") {
      const message = latest.errorMessage ?? "Opération échouée sur Ankorstore.";
      const outcome: TargetOutcome = { ok: false, kind: "error", message };
      pending.push({
        jobId: job.id,
        productId: job.productId,
        data: {
          status: "FAILED",
          ankorsOutcome: outcome as Prisma.InputJsonValue,
          errorMessage: message,
          completedAt: new Date(),
        },
        emitSuccess: false,
      });
    }
  }

  if (pending.length === 0) return;

  await Promise.all(
    pending.map((p) =>
      prisma.marketplaceRefreshJob.update({ where: { id: p.jobId }, data: p.data }),
    ),
  );

  // Revalidation / SSE : hors update DB, séquentiel mais rapide (cache tag reset).
  for (const p of pending) {
    revalidateProductPaths(p.productId);
    if (p.emitSuccess) emitProductUpdated(p.productId);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Démarrage des jobs queued en respectant la concurrence
// ─────────────────────────────────────────────────────────────────────
async function startQueued(): Promise<void> {
  const inFlight = await prisma.marketplaceRefreshJob.count({
    where: {
      OR: [
        { status: "IN_PROGRESS" },
        { status: "AWAITING_CALLBACK", marketplace: "ANKORSTORE" },
      ],
    },
  });
  const totalBudget = Math.max(0, TOTAL_CONCURRENCY - inFlight);
  if (totalBudget <= 0) return;

  const ankorsInFlight = await prisma.marketplaceRefreshJob.count({
    where: {
      marketplace: "ANKORSTORE",
      status: { in: ["IN_PROGRESS", "AWAITING_CALLBACK"] },
    },
  });
  let ankorsBudget = Math.max(0, ANKORSTORE_CONCURRENCY - ankorsInFlight);

  // On prend un peu plus de jobs queued pour pouvoir filtrer les Ankorstore au-delà du budget.
  // scheduledFor = null → démarrage immédiat. Sinon on attend l'heure prévue (étalement).
  const now = new Date();
  const queued = await prisma.marketplaceRefreshJob.findMany({
    where: {
      status: "QUEUED",
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    // Tri par heure prévue puis par ordre d'arrivée : les jobs planifiés partent
    // à leur heure, les immédiats sortent dans l'ordre où ils ont été créés.
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    take: Math.max(totalBudget * 2, 10),
  });

  const toStart: JobRow[] = [];
  for (const job of queued) {
    if (toStart.length >= totalBudget) break;
    if (job.marketplace === "ANKORSTORE") {
      if (ankorsBudget <= 0) continue;
      ankorsBudget--;
    }
    toStart.push(job);
  }

  for (const job of toStart) {
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
      revalidateProductPaths(job.productId);
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
  revalidateProductPaths(job.productId);
}

async function runPfsJob(job: JobRow, payload: QueueJobPayload): Promise<void> {
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
      const { pfsRefreshProduct } = await import("@/lib/pfs-refresh");
      const res = await pfsRefreshProduct(job.productId, undefined, { skipRevalidation: true });
      if (res.success) {
        pfsOutcome = { ok: true, archived: res.archived };
      } else if (res.reason === "not_found") {
        pfsOutcome = { ok: false, kind: "not_found", message: res.error };
      } else {
        pfsOutcome = { ok: false, kind: "error", message: res.error };
      }
    } else if (job.mode === "PUBLISH") {
      const product = await prisma.product.findUnique({
        where: { id: job.productId },
        select: { pfsProductId: true },
      });
      if (product?.pfsProductId) {
        const { pfsUpdateProductInPlace } = await import("@/lib/pfs-update");
        const res = await pfsUpdateProductInPlace(job.productId, undefined, {
          skipRevalidation: true,
        });
        if (res.success) {
          pfsOutcome = { ok: true, archived: res.archived };
        } else {
          // Fallback identique à publishProductToMarketplaces : on reset les IDs
          // et on retente en mode publish.
          logger.warn("[Marketplace Queue] PFS update failed, fallback to publish", {
            productId: job.productId,
            error: res.error,
          });
          await prisma.product.update({
            where: { id: job.productId },
            data: { pfsProductId: null, pfsLastSyncSnapshot: Prisma.DbNull },
          });
          await prisma.productColor.updateMany({
            where: { productId: job.productId },
            data: { pfsVariantId: null },
          });
          const { pfsPublishProduct } = await import("@/lib/pfs-publish");
          const pubRes = await pfsPublishProduct(job.productId, undefined, {
            skipRevalidation: true,
          });
          if (pubRes.success) {
            pfsOutcome = { ok: true, archived: pubRes.archived };
          } else {
            pfsOutcome = { ok: false, kind: "error", message: pubRes.error };
          }
        }
      } else {
        const { pfsPublishProduct } = await import("@/lib/pfs-publish");
        const res = await pfsPublishProduct(job.productId, undefined, {
          skipRevalidation: true,
        });
        if (res.success) {
          pfsOutcome = { ok: true, archived: res.archived };
        } else {
          pfsOutcome = { ok: false, kind: "error", message: res.error };
        }
      }
    } else if (job.mode === "RESYNC") {
      const product = await prisma.product.findUnique({
        where: { id: job.productId },
        select: { pfsProductId: true },
      });
      if (!product?.pfsProductId) {
        pfsOutcome = {
          ok: false,
          kind: "error",
          message: "Produit non publié sur Paris Fashion Shop.",
        };
      } else {
        const { pfsUpdateProductInPlace } = await import("@/lib/pfs-update");
        const res = await pfsUpdateProductInPlace(job.productId, undefined, {
          skipRevalidation: true,
          forceFullSync: true,
        });
        if (res.success) {
          pfsOutcome = { ok: true, archived: res.archived };
        } else {
          pfsOutcome = { ok: false, kind: "error", message: res.error };
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

  try {
    if (job.mode === "REFRESH") {
      const { ankorstoreKickoffRefresh } = await import("@/lib/ankorstore-refresh");
      const res = await ankorstoreKickoffRefresh(job.productId);
      if (res.success) {
        await markAnkorstoreAwaiting(job.id, res.operationId);
      } else if (res.reason === "not_found") {
        await markAnkorstoreFailed(job.id, "not_found", res.error);
      } else {
        await markAnkorstoreFailed(job.id, "error", res.error);
      }
    } else if (job.mode === "PUBLISH") {
      const product = await prisma.product.findUnique({
        where: { id: job.productId },
        select: { ankorsProductId: true },
      });
      if (product?.ankorsProductId) {
        const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
        const res = await ankorstoreKickoffUpdate(job.productId, { skipRevalidation: true });
        if (!res.success) {
          await markAnkorstoreFailed(job.id, "error", res.error);
        } else if (res.operationId === null) {
          // Tout est passé en PATCH synchrone — pas de callback à attendre
          await markAnkorstoreSuccess(job.id, res.archived ?? false);
        } else {
          await markAnkorstoreAwaiting(job.id, res.operationId);
        }
      } else {
        const { ankorstoreKickoffPublish } = await import("@/lib/ankorstore-publish");
        const res = await ankorstoreKickoffPublish(job.productId);
        if (res.success) {
          await markAnkorstoreAwaiting(job.id, res.operationId);
        } else {
          await markAnkorstoreFailed(job.id, "error", res.error);
        }
      }
    } else if (job.mode === "RESYNC") {
      const product = await prisma.product.findUnique({
        where: { id: job.productId },
        select: { ankorsProductId: true },
      });
      if (!product?.ankorsProductId) {
        await markAnkorstoreFailed(job.id, "error", "Produit non publié sur Ankorstore.");
      } else {
        const { ankorstoreKickoffUpdate } = await import("@/lib/ankorstore-update");
        const res = await ankorstoreKickoffUpdate(job.productId, {
          forceFullSync: true,
          skipRevalidation: true,
        });
        if (!res.success) {
          await markAnkorstoreFailed(job.id, "error", res.error);
        } else if (res.operationId === null) {
          await markAnkorstoreSuccess(job.id, res.archived ?? false);
        } else {
          await markAnkorstoreAwaiting(job.id, res.operationId);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] Ankorstore unexpected error", {
      productId: job.productId,
      jobId: job.id,
      error: message,
    });
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

  try {
    const product = await prisma.product.findUnique({
      where: { id: job.productId },
      select: { efashionReferenceBase: true },
    });
    const isLinked = !!product?.efashionReferenceBase;

    if (job.mode === "RESYNC") {
      if (!isLinked) {
        await markEfashionFailed(
          job.id,
          "error",
          "Produit non lié à eFashion — impossible de resynchroniser.",
        );
        return;
      }
      const { efashionUpdateProductInPlace } = await import("@/lib/efashion-update");
      const res = await efashionUpdateProductInPlace(job.productId, { forceFullSync: true });
      if (res.success) {
        await markEfashionSuccess(job.id, false);
      } else {
        await markEfashionFailed(job.id, "error", res.error ?? "Erreur inconnue");
      }
    } else if (job.mode === "PUBLISH") {
      if (isLinked) {
        // Déjà publié → update incrémental (équivalent du fallback PFS).
        const { efashionUpdateProductInPlace } = await import("@/lib/efashion-update");
        const res = await efashionUpdateProductInPlace(job.productId);
        if (res.success) {
          await markEfashionSuccess(job.id, false);
        } else {
          await markEfashionFailed(job.id, "error", res.error ?? "Erreur inconnue");
        }
      } else {
        // 1ʳᵉ publication via workflow shooting
        const { efashionPublishProduct } = await import("@/lib/efashion-publish");
        const res = await efashionPublishProduct(job.productId);
        if (res.success) {
          await markEfashionSuccess(job.id, false);
        } else {
          await markEfashionFailed(job.id, "error", res.error ?? "Erreur inconnue");
        }
      }
    } else if (job.mode === "REFRESH") {
      // REFRESH = renommer + soft-delete + republier (workflow PFS-like)
      // pour que les nouvelles fiches obtiennent une date de création récente
      // côté eFashion → elles remontent en premier dans le catalogue vendeur.
      // Si pas lié, on bascule sur PUBLISH classique.
      if (isLinked) {
        const { efashionRefreshProduct } = await import("@/lib/efashion-refresh");
        const res = await efashionRefreshProduct(job.productId);
        if (res.success) await markEfashionSuccess(job.id, false);
        else await markEfashionFailed(job.id, "error", res.error ?? "Erreur inconnue");
      } else {
        const { efashionPublishProduct } = await import("@/lib/efashion-publish");
        const res = await efashionPublishProduct(job.productId);
        if (res.success) await markEfashionSuccess(job.id, false);
        else await markEfashionFailed(job.id, "error", res.error ?? "Erreur inconnue");
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] eFashion unexpected error", {
      productId: job.productId,
      jobId: job.id,
      error: message,
    });
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

  try {
    const product = await prisma.product.findUnique({
      where: { id: job.productId },
      select: { faireProductId: true, status: true },
    });
    const isLinked = !!product?.faireProductId;
    // Faire crée par défaut en DRAFT (invisible sur Faire). Si le produit BJ
    // est en ligne, on publie directement en PUBLISHED pour qu'il apparaisse
    // dans le catalogue Faire.
    const lifecycleState: "DRAFT" | "PUBLISHED" =
      product?.status === "ONLINE" ? "PUBLISHED" : "DRAFT";

    if (job.mode === "RESYNC") {
      if (!isLinked) {
        await markFaireFailed(job.id, "error", "Produit non publié sur Faire.");
        return;
      }
      const { faireUpdateProduct } = await import("@/lib/faire-update");
      const res = await faireUpdateProduct(job.productId, { forceFullSync: true });
      if (res.success) await markFaireSuccess(job.id);
      else await markFaireFailed(job.id, "error", res.error);
    } else if (job.mode === "PUBLISH") {
      if (isLinked) {
        // Produit déjà lié à une fiche Faire → PATCH (modification seulement).
        // ⚠️ PAS de fallback "publish" auto si le PATCH échoue : ça créerait
        // un doublon côté Faire (cas vu en réel sur F137). On remonte l'erreur
        // claire pour que l'admin re-tente ou délie + relie manuellement.
        const { faireUpdateProduct } = await import("@/lib/faire-update");
        const res = await faireUpdateProduct(job.productId);
        if (res.success) {
          await markFaireSuccess(job.id);
        } else {
          logger.error("[Marketplace Queue] Faire update failed (no fallback)", {
            productId: job.productId,
            error: res.error,
          });
          await markFaireFailed(
            job.id,
            "error",
            `Modification Faire refusée : ${res.error ?? "erreur inconnue"}. ` +
              `Aucun produit n'a été recréé pour éviter un doublon. ` +
              `Vérifiez le contenu (caractères spéciaux, champs trop longs) puis re-tentez.`,
          );
        }
      } else {
        const { fairePublishProduct } = await import("@/lib/faire-publish");
        const res = await fairePublishProduct(job.productId, { lifecycleState });
        if (res.success) await markFaireSuccess(job.id);
        else await markFaireFailed(job.id, "error", res.error);
      }
    } else if (job.mode === "REFRESH") {
      if (isLinked) {
        const { faireRefreshProduct } = await import("@/lib/faire-refresh");
        const res = await faireRefreshProduct(job.productId);
        if (res.success) await markFaireSuccess(job.id);
        else await markFaireFailed(job.id, "error", res.error);
      } else {
        const { fairePublishProduct } = await import("@/lib/faire-publish");
        const res = await fairePublishProduct(job.productId, { lifecycleState });
        if (res.success) await markFaireSuccess(job.id);
        else await markFaireFailed(job.id, "error", res.error);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Queue] Faire unexpected error", {
      productId: job.productId,
      jobId: job.id,
      error: message,
    });
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

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function revalidateProductPaths(productId: string): void {
  try {
    revalidatePath("/admin/produits");
    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath(`/produits/${productId}`);
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
