/**
 * PFS Import Background Processor
 *
 * Runs as a fire-and-forget async function: creates products one by one
 * from PFS, updates ImportJob progress in DB, and emits SSE events for
 * real-time UI updates. Survives client disconnection.
 *
 * Supports cancellation: checks job status before each product —
 * if CANCELLED, stops immediately.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  approveAndImportPfsProduct,
  cleanupOrphanedSyncingProducts,
  PfsImportCancelledError,
} from "@/lib/pfs-import";
import { invalidatePfsListCache } from "@/lib/pfs-list-cache";
import { emitProductEvent, type ImportProgressResult } from "@/lib/product-events";

/** Intervalle entre deux vérifications DB du statut d'annulation (ms). */
const CANCEL_POLL_INTERVAL_MS = 2000;

/** Au-delà de ce nombre d'items, on bascule en mode "gros import" pour
 *  ménager PFS et le VPS : concurrence réduite + pauses entre lots. */
const LARGE_IMPORT_THRESHOLD = 1000;

/** Concurrence "normale" : bon compromis sur le VPS Hostinger (4 cores) —
 *  au-delà, le sharp WebP lossless en parallèle sature le CPU. */
const SMALL_IMPORT_CONCURRENCY = 6;

/** Concurrence "gros import" : on tape PFS avec moitié moins de calls
 *  parallèles, pour rester sous le rate-limit côté Salesforce. */
const LARGE_IMPORT_CONCURRENCY = 3;

/** Nombre de produits traités d'affilée avant une pause inter-lots. */
const IMPORT_CHUNK_SIZE = 500;

/** Pause à la fin de chaque lot (ms). Laisse PFS reprendre son souffle
 *  pendant 5 s avant de relancer la cadence. */
const IMPORT_CHUNK_PAUSE_MS = 5000;

export interface ImportPacing {
  concurrency: number;
  chunkSize: number;
  chunkPauseMs: number;
}

/**
 * Calcule la cadence d'import (concurrence + pauses) en fonction du volume.
 * Petits imports : on garde la cadence rapide. Gros imports : on ralentit
 * pour ménager l'API PFS et le VPS.
 */
export function getImportPacing(itemsCount: number): ImportPacing {
  const isLarge = itemsCount > LARGE_IMPORT_THRESHOLD;
  return {
    concurrency: isLarge ? LARGE_IMPORT_CONCURRENCY : SMALL_IMPORT_CONCURRENCY,
    chunkSize: IMPORT_CHUNK_SIZE,
    chunkPauseMs: isLarge ? IMPORT_CHUNK_PAUSE_MS : 0,
  };
}

/**
 * Exécute une opération Prisma avec retry automatique en cas de déconnexion.
 * MySQL ferme les connexions inactives après wait_timeout — pendant l'import
 * d'images qui peut durer longtemps, la connexion expire. Ce wrapper
 * re-tente automatiquement l'opération pour rétablir la connexion.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = ((err as Error).message || "").toLowerCase();
      const isConnectionError =
        msg.includes("server has closed the connection") ||
        msg.includes("econnreset") ||
        msg.includes("socket hang up") ||
        msg.includes("connection lost") ||
        msg.includes("etimedout");
      if (!isConnectionError || attempt === retries) throw err;
      logger.warn("[PFS Import Processor] DB connection lost, retrying", {
        attempt,
        retries,
        err: (err as Error).message,
      });
      // Petit délai avant retry pour laisser la connexion se rétablir
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error("withRetry: unreachable");
}

export interface PfsImportItem {
  pfsId: string;
  reference: string;
  name: string;
}

/**
 * Process a PFS import job: import products one by one, update progress,
 * emit SSE events. Callable as fire-and-forget.
 */
export async function processPfsImport(jobId: string): Promise<void> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) {
    logger.error("[PFS Import Processor] Job not found", { jobId });
    return;
  }

  const items: PfsImportItem[] = (job.resultDetails as { items?: PfsImportItem[] })?.items ?? [];
  if (items.length === 0) {
    await withRetry(() => prisma.importJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", errorMessage: "Aucun produit à importer" },
    }));
    return;
  }

  // Cache vidé : on veut une vue fraîche du catalogue PFS pour ce job (les
  // workers se partageront ensuite le même index en mémoire).
  invalidatePfsListCache();

  // Cadence adaptée au volume : les gros imports (> 1000 produits) tournent
  // en concurrence réduite et avec une pause entre chaque lot.
  const pacing = getImportPacing(items.length);
  logger.info("[PFS Import Processor] Import démarré", {
    jobId,
    itemsCount: items.length,
    concurrency: pacing.concurrency,
    chunkSize: pacing.chunkSize,
    chunkPauseMs: pacing.chunkPauseMs,
  });

  // Mark as processing
  await withRetry(() => prisma.importJob.update({
    where: { id: jobId },
    data: { status: "PROCESSING", totalItems: items.length },
  }));

  emitProgress(jobId, 0, items.length, 0, 0, "PROCESSING", [], pacing.concurrency);

  // Sondage périodique du statut en DB pour détecter l'annulation
  // AUSSI pendant qu'un produit est en cours d'import (téléchargement d'images).
  let jobCancelled = false;
  const cancelPoller = setInterval(async () => {
    try {
      const current = await withRetry(() => prisma.importJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      }));
      if (current?.status === "CANCELLED") {
        jobCancelled = true;
      }
    } catch (err) {
      logger.warn("[PFS Import Processor] Cancel poll failed", { jobId, err: (err as Error).message });
    }
  }, CANCEL_POLL_INTERVAL_MS);

  const results: { pfsId: string; reference: string; name: string; status: "ok" | "error" | "cancelled"; productId?: string; error?: string }[] = [];
  let success = 0;
  let errors = 0;
  let processed = 0;
  let nextIndex = 0;

  // Gestion des pauses entre lots de `chunkSize` items. Tous les workers
  // attendent ensemble la même pause via une promesse partagée — quand le
  // 1er à franchir la limite la crée, les autres s'y greffent.
  let chunkPausePromise: Promise<void> | null = null;
  let lastPausedAtChunk = 0;
  const maybeChunkPause = async (): Promise<void> => {
    if (pacing.chunkPauseMs <= 0) return;
    if (chunkPausePromise) {
      await chunkPausePromise;
      return;
    }
    const currentChunk = Math.floor(nextIndex / pacing.chunkSize);
    if (currentChunk <= lastPausedAtChunk) return;
    if (nextIndex === 0 || nextIndex >= items.length) return;
    lastPausedAtChunk = currentChunk;
    logger.info("[PFS Import Processor] Pause entre lots PFS", {
      jobId,
      reachedAt: nextIndex,
      chunkPauseMs: pacing.chunkPauseMs,
    });
    chunkPausePromise = new Promise<void>((r) => setTimeout(r, pacing.chunkPauseMs))
      .then(() => { chunkPausePromise = null; });
    await chunkPausePromise;
  };

  const worker = async (): Promise<void> => {
    while (true) {
      // Double-vérif synchrone avant de réclamer le prochain produit (au cas où
      // le poller n'aurait pas encore tourné depuis le dernier tick).
      if (!jobCancelled) {
        const current = await withRetry(() => prisma.importJob.findUnique({
          where: { id: jobId },
          select: { status: true },
        }));
        if (current?.status === "CANCELLED") jobCancelled = true;
      }
      if (jobCancelled) return;

      // Si on entame un nouveau lot, on observe la pause inter-lots avant de
      // claim le prochain index. Tous les workers attendent ensemble.
      await maybeChunkPause();
      if (jobCancelled) return;

      const i = nextIndex++;
      if (i >= items.length) return;
      const item = items[i];

      try {
        const result = await approveAndImportPfsProduct(item.pfsId, {
          isCancelled: () => jobCancelled,
        });
        success++;
        results.push({
          pfsId: item.pfsId,
          reference: item.reference,
          name: item.name,
          status: "ok",
          productId: result.productId,
        });
      } catch (err) {
        if (err instanceof PfsImportCancelledError) {
          // Produit partiel déjà supprimé par approveAndImportPfsProduct.
          logger.info("[PFS Import Processor] Product import cancelled mid-flight", {
            jobId, pfsId: item.pfsId, reference: item.reference,
          });
          results.push({
            pfsId: item.pfsId,
            reference: item.reference,
            name: item.name,
            status: "cancelled",
          });
          return;
        }
        errors++;
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({
          pfsId: item.pfsId,
          reference: item.reference,
          name: item.name,
          status: "error",
          error: errMsg,
        });
        logger.warn("[PFS Import Processor] Product import failed", {
          jobId,
          pfsId: item.pfsId,
          reference: item.reference,
          error: errMsg,
        });
      }

      processed++;
      await withRetry(() => prisma.importJob.update({
        where: { id: jobId },
        data: {
          processedItems: processed,
          successItems: success,
          errorItems: errors,
          resultDetails: { items, results },
        },
      }));

      emitProgress(jobId, processed, items.length, success, errors, "PROCESSING", results, pacing.concurrency);
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(pacing.concurrency, items.length) }, () => worker()),
    );
  } finally {
    clearInterval(cancelPoller);
  }

  if (jobCancelled) {
    logger.info("[PFS Import Processor] Job cancelled", { jobId, processed });

    // Filet de sécurité : balaye et supprime tout produit resté en statut
    // SYNCING parmi les pfsIds de ce job. Le cleanup unitaire dans
    // approveAndImportPfsProduct gère le cas normal, mais ce sweep couvre les
    // edge cases (cleanup raté, worker tué, race condition) pour qu'aucun
    // produit partiel ne traîne dans le catalogue après un arrêt.
    try {
      const pfsIds = items.map((it) => it.pfsId);
      const sweep = await cleanupOrphanedSyncingProducts(pfsIds, job.createdAt);
      if (sweep.deletedCount > 0) {
        logger.info("[PFS Import Processor] Orphan SYNCING products cleaned up after cancel", {
          jobId,
          deletedCount: sweep.deletedCount,
          references: sweep.references,
        });
      }
    } catch (err) {
      logger.warn("[PFS Import Processor] Orphan sweep failed", {
        jobId,
        err: (err as Error).message,
      });
    }

    await withRetry(() => prisma.importJob.update({
      where: { id: jobId },
      data: {
        processedItems: processed,
        successItems: success,
        errorItems: errors,
        resultDetails: { items, results },
      },
    }));
    emitProgress(jobId, processed, items.length, success, errors, "FAILED", results, pacing.concurrency);
    return;
  }

  // Done — build summary with references
  const successRefs = results.filter((r) => r.status === "ok").map((r) => r.reference);
  const errorRefs = results.filter((r) => r.status === "error").map((r) => `${r.reference} (${r.error})`);

  const summaryParts: string[] = [];
  if (success > 0) summaryParts.push(`${success} produit(s) créé(s) : ${successRefs.join(", ")}`);
  if (errors > 0) summaryParts.push(`${errors} produit(s) en échec : ${errorRefs.join(", ")}`);
  const summary = summaryParts.join(" — ");

  const finalStatus = errors === items.length ? "FAILED" : "COMPLETED";
  await withRetry(() => prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: finalStatus,
      resultDetails: { items, results, summary, successRefs, errorRefs },
      errorMessage: errors > 0 ? summary : null,
    },
  }));

  emitProgress(jobId, items.length, items.length, success, errors, finalStatus, results, pacing.concurrency);
  logger.info("[PFS Import Processor] Job completed", { jobId, success, errors, summary });
}

function emitProgress(
  jobId: string,
  processed: number,
  total: number,
  success: number,
  errors: number,
  status: "PROCESSING" | "COMPLETED" | "FAILED",
  results: ImportProgressResult[],
  concurrency: number,
) {
  // Copie minimale : on n'a besoin que des champs utiles au client pour
  // afficher le badge (pfsId + status + productId + error). `reference` et
  // `name` figurent déjà dans la liste d'items côté client.
  const compactResults: ImportProgressResult[] = results.map((r) => ({
    pfsId: r.pfsId,
    status: r.status,
    productId: r.productId,
    error: r.error,
  }));
  emitProductEvent({
    type: "IMPORT_PROGRESS",
    productId: jobId,
    importProgress: {
      jobId,
      processed,
      total,
      success,
      errors,
      status,
      results: compactResults,
      concurrency,
    },
  });
}
