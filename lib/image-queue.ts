/**
 * lib/image-queue.ts
 *
 * File d'attente serveur pour la conversion des images produit en arrière-plan.
 *
 * Pourquoi : importer 92 images d'un coup faisait que chaque POST /admin/products/images
 * faisait sharp×3 formats en synchrone (3-5 s par image), bloquant l'admin
 * pendant 5 min. Désormais le POST écrit juste le buffer brut sur disque,
 * insère un `ImageProcessingJob` et retourne en ~100 ms. Le worker singleton
 * de ce fichier picore les jobs PENDING et les traite, 3 en parallèle.
 *
 * Résilience : au boot du process Node (cf. `instrumentation-node.ts`), tout
 * job en PROCESSING est rebasculé en PENDING — la conversion sharp est
 * idempotente (les .webp sont réécrits s'ils existaient déjà). Aucune image
 * perdue après un redémarrage PM2 / un crash dev.
 *
 * Effet de bord métier : quand le dernier job en cours pour un produit lié à
 * PFS / Ankorstore / eFashion passe à DONE, on positionne les flags
 * `*SyncRequired = true` pour signaler à l'admin qu'il faut renvoyer la
 * mise à jour vers le(s) marketplace(s). Ces flags pilotent le badge orange
 * « Synchronisation nécessaire ».
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { Prisma, type ImageJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { processProductImage } from "@/lib/image-processor";

// Poll long (5 s) : `notify()` est appelé à chaque `enqueueImageJob` et
// `retryFailedImageJob`, donc le worker démarre un job dès qu'il arrive, sans
// attendre le tick. L'interval sert uniquement de filet (jobs orphelins remis
// en PENDING au boot, race conditions). Précédemment à 800 ms → ~125 requêtes
// DB/s en idle, ~90 % de CPU inutile.
const POLL_MS = 5000;
const CONCURRENCY = 3; // 3 sharp en parallèle = bon compromis CPU/IO sur VPS 2 cœurs
const RAW_DIR_KEY = "private/uploads/_image_jobs"; // hors public/, jamais servi en HTTP

const STARTUP_GUARD = Symbol.for("beliandjolie.imageQueueWorker.started");
const TICK_GUARD = Symbol.for("beliandjolie.imageQueueWorker.tick");
const g = globalThis as Record<symbol, unknown>;

/** Compte les jobs en vol côté process (PROCESSING démarrés ici, pas en DB). */
function inflight(): number {
  return (g[TICK_GUARD] as { count: number } | undefined)?.count ?? 0;
}
function adjustInflight(delta: number) {
  if (!g[TICK_GUARD]) g[TICK_GUARD] = { count: 0 };
  (g[TICK_GUARD] as { count: number }).count += delta;
}

// ─────────────────────────────────────────────
// Helpers chemins
// ─────────────────────────────────────────────

function rawDirAbsolute(): string {
  // Aligné avec resolveKey() de storage.ts : private/* → <project>/private
  return path.resolve(process.cwd(), "private", "uploads", "_image_jobs");
}

function rawPathForJob(jobId: string, ext: string): string {
  return path.join(rawDirAbsolute(), `${jobId}.${ext.replace(/^\./, "")}`);
}

// ─────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────

export interface EnqueueInput {
  /** Buffer brut du fichier reçu (any format). */
  rawBuffer: Buffer;
  /** Extension d'origine (jpg, png, webp…). */
  fileExt: string;
  /** Produit cible si déjà connu (existing product). null pour brouillon. */
  productId: string | null;
  /** Dossier cible côté storage (ex "uploads/produits/e310b"). */
  destDir: string;
  /** Basename sans extension (ex "e310b-doré-1-abc123"). */
  filename: string;
  /** Chemin BDD final (ex "/uploads/produits/e310b/e310b-doré-1-abc123.webp"). */
  dbPath: string;
}

export interface EnqueueResult {
  jobId: string;
  dbPath: string;
}

/**
 * Stocke le buffer brut sur disque + insère un job PENDING + réveille le worker.
 * Retourne le `jobId` et le `dbPath` final (le fichier WebP n'existe pas
 * encore, mais on peut référencer le chemin dans la BDD du produit dès
 * maintenant — il apparaîtra dès que le worker aura traité ce job).
 */
export async function enqueueImageJob(input: EnqueueInput): Promise<EnqueueResult> {
  await fs.mkdir(rawDirAbsolute(), { recursive: true });
  const tmpId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const rawPath = rawPathForJob(tmpId, input.fileExt);
  await fs.writeFile(rawPath, input.rawBuffer);

  const job = await prisma.imageProcessingJob.create({
    data: {
      productId: input.productId ?? null,
      rawPath,
      destDir: input.destDir,
      filename: input.filename,
      dbPath: input.dbPath,
      status: "PENDING",
    },
    select: { id: true, dbPath: true },
  });

  // Réveille le worker (pas obligatoire — l'interval finit par tomber dessus —
  // mais évite jusqu'à 800 ms de latence pour le 1er job).
  notify();

  return { jobId: job.id, dbPath: job.dbPath };
}

/**
 * Démarre le worker singleton. Appelé une seule fois au boot Node depuis
 * `instrumentation-node.ts`. Idempotent.
 */
export function startImageQueueWorker(): void {
  if (g[STARTUP_GUARD]) return;
  g[STARTUP_GUARD] = true;

  void (async () => {
    try {
      await runStartupResume();
    } catch (err) {
      logger.error("[Image Queue] Startup resume failed", { error: err as Error });
    }
  })();

  setInterval(() => {
    void tick().catch((err: unknown) => {
      logger.error("[Image Queue] Tick crashed", { error: err as Error });
    });
  }, POLL_MS);

  logger.info("[Image Queue] Worker démarré", { poll_ms: POLL_MS, concurrency: CONCURRENCY });
}

/** Force un tick immédiat (utilisé après enqueue). */
function notify(): void {
  void tick().catch((err: unknown) => {
    logger.error("[Image Queue] Notify tick crashed", { error: err as Error });
  });
}

// ─────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────

/**
 * Au boot : tous les jobs PROCESSING viennent d'un process tué. La conversion
 * sharp est idempotente (overwrite WebP), donc on les remet en PENDING
 * plutôt que FAILED — le worker reprendra naturellement.
 */
async function runStartupResume(): Promise<void> {
  const res = await prisma.imageProcessingJob.updateMany({
    where: { status: "PROCESSING" },
    data: { status: "PENDING", startedAt: null },
  });
  if (res.count > 0) {
    logger.warn("[Image Queue] Jobs PROCESSING orphelins remis en PENDING", { count: res.count });
  }
}

async function tick(): Promise<void> {
  while (inflight() < CONCURRENCY) {
    const claimed = await claimNextPending();
    if (!claimed) return;
    adjustInflight(+1);
    void runJob(claimed)
      .catch((err: unknown) => {
        logger.error("[Image Queue] runJob crashed", { error: err as Error, jobId: claimed.id });
      })
      .finally(() => {
        adjustInflight(-1);
      });
  }
}

type ClaimedJob = {
  id: string;
  productId: string | null;
  rawPath: string;
  destDir: string;
  filename: string;
};

/**
 * Pick le job PENDING le plus ancien et le passe à PROCESSING atomiquement.
 * Le `updateMany WHERE status=PENDING AND id=X` garantit qu'aucun autre tick
 * (process forké, double interval) ne traitera le même job.
 */
async function claimNextPending(): Promise<ClaimedJob | null> {
  const candidate = await prisma.imageProcessingJob.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true, productId: true, rawPath: true, destDir: true, filename: true },
  });
  if (!candidate) return null;

  const res = await prisma.imageProcessingJob.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "PROCESSING", startedAt: new Date() },
  });
  if (res.count === 0) return null; // race perdue, retentera au prochain tick
  return candidate;
}

async function runJob(job: ClaimedJob): Promise<void> {
  try {
    const buffer = await fs.readFile(job.rawPath);
    await processProductImage(buffer, job.destDir, job.filename);
    await fs.unlink(job.rawPath).catch(() => { /* best-effort */ });

    await prisma.imageProcessingJob.update({
      where: { id: job.id },
      data: { status: "DONE", completedAt: new Date(), error: null },
    });

    // Si c'était le dernier job en vol pour ce produit → flaguer les marketplaces
    // liés en "Synchronisation nécessaire". On ne touche aux flags que si rien
    // d'autre n'est en attente — sinon on attendrait que tout soit fini avant
    // de proposer un re-sync.
    if (job.productId) {
      await maybeMarkProductSyncRequired(job.productId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.imageProcessingJob.update({
      where: { id: job.id },
      data: { status: "FAILED", completedAt: new Date(), error: message },
    }).catch(() => { /* best-effort */ });
    logger.error("[Image Queue] Job FAILED", { jobId: job.id, error: err as Error });
  }
}

/**
 * Quand tous les jobs en vol pour un produit sont terminés et que le produit
 * est lié à au moins un marketplace, positionne le flag de sync correspondant.
 * Idempotent : si le flag est déjà true, l'update est un no-op.
 */
async function maybeMarkProductSyncRequired(productId: string): Promise<void> {
  const remaining = await prisma.imageProcessingJob.count({
    where: { productId, status: { in: ["PENDING", "PROCESSING"] } },
  });
  if (remaining > 0) return; // attend que tout soit traité

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      microstoreLastPushedAt: true,
    },
  });
  if (!product) return;

  const data: Prisma.ProductUpdateInput = {};
  if (product.pfsProductId) data.pfsSyncRequired = true;
  if (product.ankorsProductId) data.ankorsSyncRequired = true;
  if (product.efashionReferenceBase) data.efashionSyncRequired = true;
  if (product.faireProductId) data.faireSyncRequired = true;
  // Microstore n'a pas d'ID de produit stocké côté BJ (upsert par référence).
  // On utilise `microstoreLastPushedAt` comme preuve que le produit a déjà été
  // envoyé au moins une fois — sinon l'envoi photos n'aurait pas de fiche à
  // mettre à jour côté Microstore.
  if (product.microstoreLastPushedAt) data.microstoreSyncRequired = true;

  if (Object.keys(data).length === 0) return;
  await prisma.product.update({ where: { id: productId }, data });
  logger.info("[Image Queue] Sync required flagged", {
    productId,
    pfs: !!data.pfsSyncRequired,
    ankorstore: !!data.ankorsSyncRequired,
    efashion: !!data.efashionSyncRequired,
    faire: !!data.faireSyncRequired,
    microstore: !!data.microstoreSyncRequired,
  });
}

// ─────────────────────────────────────────────
// Lectures pour l'UI (widget de progression)
// ─────────────────────────────────────────────

export interface ImageJobView {
  id: string;
  productId: string | null;
  status: ImageJobStatus;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Renvoie les jobs récents (PENDING/PROCESSING/FAILED en cours, plus DONE
 * récents pour calculer "X/Y traités") sur les 6 dernières heures.
 * Le widget UI poll ça toutes les 2s.
 */
export async function listRecentImageJobs(
  options: { productId?: string; limit?: number } = {},
): Promise<ImageJobView[]> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  return prisma.imageProcessingJob.findMany({
    where: {
      createdAt: { gte: since },
      ...(options.productId ? { productId: options.productId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 200,
    select: {
      id: true,
      productId: true,
      status: true,
      error: true,
      createdAt: true,
      completedAt: true,
    },
  });
}

/** Relance un job FAILED → repasse en PENDING (worker le reprend). */
export async function retryFailedImageJob(jobId: string): Promise<void> {
  await prisma.imageProcessingJob.updateMany({
    where: { id: jobId, status: "FAILED" },
    data: { status: "PENDING", error: null, startedAt: null, completedAt: null },
  });
  notify();
}
