/**
 * lib/translation-queue.ts
 *
 * File d'attente serveur pour les lots de traduction déclenchés par le bouton
 * « Tout traduire » de l'admin. Chaque clic sur ce bouton crée un job en BDD
 * (`TranslationJob`) qui est ensuite consommé par le worker singleton de ce
 * fichier — pendant que l'admin continue à naviguer sur le site.
 *
 * Pourquoi : avant, le bouton « Tout traduire » posait un voile blanc plein
 * écran (LoadingOverlay) qui bloquait toute interaction pendant plusieurs
 * minutes. Ici, le POST retourne immédiatement, le worker prend le relais, et
 * un tiroir à droite (`components/admin/widgets-rail/TranslationDrawer.tsx`)
 * affiche le progrès en temps réel avec le mot en cours de traduction.
 *
 * Résilience : au boot du process Node (cf. `instrumentation-node.ts`), tout
 * job en PROCESSING est rebasculé en PENDING. La traduction est idempotente
 * (upsert par (entityId, locale)), donc rejouer un item déjà partiellement
 * traduit n'a aucun effet secondaire.
 */

import { Prisma, type TranslationJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { translatePhrases, PFS_TRANSLATION_LOCALES } from "@/lib/pfs-translate";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";

// Nombre d'items envoyés dans un seul appel à l'API PFS `translatePhrases`.
// L'API accepte un batch de clés → gain ~10× vs 1 appel par mot.
const TRANSLATION_BATCH_SIZE = 10;

const POLL_MS = 1000; // 1 tick / seconde — la traduction est lente (~500 ms/mot)
const RECENT_DONE_LIMIT_MS = 5 * 60_000; // garder 5 min les jobs DONE visibles dans le tiroir

const STARTUP_GUARD = Symbol.for("beliandjolie.translationQueueWorker.started");
const g = globalThis as Record<symbol, unknown>;

// ─────────────────────────────────────────────
// Types + constantes
// ─────────────────────────────────────────────

export const SUPPORTED_ENTITY_TYPES = [
  "color",
  "tag",
  "composition",
  "category",
  "subcategory",
  "season",
  "collection",
] as const;
export type TranslationEntityType = (typeof SUPPORTED_ENTITY_TYPES)[number];

export interface TranslationJobItem {
  id: string;
  text: string;
}

export interface EnqueueTranslationInput {
  section: string;
  entityType: TranslationEntityType;
  items: TranslationJobItem[];
}

// ─────────────────────────────────────────────
// API publique — enqueue + list + dismiss
// ─────────────────────────────────────────────

export async function enqueueTranslationJob(
  input: EnqueueTranslationInput,
): Promise<{ jobId: string }> {
  const items = input.items.filter((i) => i.id && i.text.trim());
  const job = await prisma.translationJob.create({
    data: {
      section: input.section,
      entityType: input.entityType,
      items: items as unknown as Prisma.InputJsonValue,
      totalCount: items.length,
    },
    select: { id: true },
  });
  // Ping le worker en tâche de fond (kick pour ne pas attendre le prochain poll).
  setImmediate(() => tickIfIdle());
  return { jobId: job.id };
}

/** Jobs visibles dans le tiroir : actifs OU récemment terminés/dismiss depuis peu. */
export async function listRecentTranslationJobs() {
  const cutoff = new Date(Date.now() - RECENT_DONE_LIMIT_MS);
  return prisma.translationJob.findMany({
    where: {
      OR: [
        { status: { in: ["PENDING", "PROCESSING"] } },
        // DONE/FAILED récents et non dismiss
        {
          status: { in: ["DONE", "FAILED"] },
          dismissedAt: null,
          completedAt: { gte: cutoff },
        },
      ],
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 20,
  });
}

/** Cache un job du tiroir (soft delete) — utilisé par le bouton croix de la ligne. */
export async function dismissTranslationJob(id: string): Promise<void> {
  await prisma.translationJob.update({
    where: { id },
    data: { dismissedAt: new Date() },
  }).catch(() => {}); // no-op si déjà supprimé
}

/** Dismiss tous les jobs DONE/FAILED (bouton « Vider »). */
export async function dismissDoneTranslationJobs(): Promise<{ removed: number }> {
  const res = await prisma.translationJob.updateMany({
    where: {
      status: { in: ["DONE", "FAILED"] },
      dismissedAt: null,
    },
    data: { dismissedAt: new Date() },
  });
  return { removed: res.count };
}

// ─────────────────────────────────────────────
// Persistance de la traduction (upsert par table)
// ─────────────────────────────────────────────

async function persistTranslation(
  entityType: TranslationEntityType,
  entityId: string,
  locale: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  switch (entityType) {
    case "color":
      await prisma.colorTranslation.upsert({
        where: { colorId_locale: { colorId: entityId, locale } },
        update: { name: trimmed },
        create: { colorId: entityId, locale, name: trimmed },
      });
      return;
    case "tag":
      await prisma.tagTranslation.upsert({
        where: { tagId_locale: { tagId: entityId, locale } },
        update: { name: trimmed },
        create: { tagId: entityId, locale, name: trimmed },
      });
      return;
    case "composition":
      await prisma.compositionTranslation.upsert({
        where: { compositionId_locale: { compositionId: entityId, locale } },
        update: { name: trimmed },
        create: { compositionId: entityId, locale, name: trimmed },
      });
      return;
    case "category":
      await prisma.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: entityId, locale } },
        update: { name: trimmed },
        create: { categoryId: entityId, locale, name: trimmed },
      });
      return;
    case "subcategory":
      await prisma.subCategoryTranslation.upsert({
        where: { subCategoryId_locale: { subCategoryId: entityId, locale } },
        update: { name: trimmed },
        create: { subCategoryId: entityId, locale, name: trimmed },
      });
      return;
    case "season":
      await prisma.seasonTranslation.upsert({
        where: { seasonId_locale: { seasonId: entityId, locale } },
        update: { name: trimmed },
        create: { seasonId: entityId, locale, name: trimmed },
      });
      return;
    case "collection":
      await prisma.collectionTranslation.upsert({
        where: { collectionId_locale: { collectionId: entityId, locale } },
        update: { name: trimmed },
        create: { collectionId: entityId, locale, name: trimmed },
      });
      return;
  }
}

// ─────────────────────────────────────────────
// Worker singleton
// ─────────────────────────────────────────────

let running = false;

/** Démarre le worker (idempotent — safe à ré-appeler). */
export function startTranslationQueueWorker(): void {
  if (g[STARTUP_GUARD]) return;
  g[STARTUP_GUARD] = true;

  // Reprise après crash : rebascule les PROCESSING orphelins en PENDING.
  prisma.translationJob
    .updateMany({
      where: { status: "PROCESSING" },
      data: { status: "PENDING", startedAt: null },
    })
    .then((res) => {
      if (res.count > 0) {
        logger.info(`[Translation Queue] ${res.count} job(s) PROCESSING remis en PENDING au boot`);
      }
    })
    .catch((err) => {
      logger.warn("[Translation Queue] Sweep PROCESSING au boot échoué", { error: err });
    });

  // Boucle de poll.
  const tick = () => {
    void tickIfIdle().finally(() => {
      setTimeout(tick, POLL_MS);
    });
  };
  tick();

  logger.info("[Translation Queue] Worker démarré");
}

/** Traite le prochain job PENDING si aucun n'est déjà en cours. */
async function tickIfIdle(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const job = await prisma.translationJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!job) return;
    await processJob(job.id);
  } catch (err) {
    logger.error("[Translation Queue] Erreur de tick", { error: err as Error });
  } finally {
    running = false;
  }
}

async function processJob(jobId: string): Promise<void> {
  const job = await prisma.translationJob.update({
    where: { id: jobId },
    data: { status: "PROCESSING", startedAt: new Date() },
  });

  // CRITIQUE multi-tenant : le worker tourne hors requête. Sans bind ALS, les
  // caches d'auth (getCachedPfsCredentials, tokenCacheByTenant, etc.) tombent
  // en "global" et servent les credentials du 1er tenant qui a écrit — fuite
  // catastrophique. On wrap tout le corps dans tenantALS.run(job.tenantId).
  if (job.tenantId) {
    const { tenantALS } = await import("@/lib/tenant-als");
    return tenantALS.run(job.tenantId, () => processJobBody(job, jobId));
  }
  return processJobBody(job, jobId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processJobBody(job: any, jobId: string): Promise<void> {

  const items = (job.items as unknown as TranslationJobItem[]) ?? [];
  const entityType = job.entityType as TranslationEntityType;
  let done = 0;
  let errors = 0;

  // Découpe la liste en batches de TRANSLATION_BATCH_SIZE (défaut 10). Chaque
  // batch = 1 seul appel API PFS pour toutes les phrases → gain ~10× vs mot
  // par mot. L'API accepte un objet { clé: texte } et renvoie { clé: { locale: trad } }.
  for (let start = 0; start < items.length; start += TRANSLATION_BATCH_SIZE) {
    const batch = items.slice(start, start + TRANSLATION_BATCH_SIZE);

    // Affichage temps réel : on montre le 1er mot du batch en cours.
    const preview = batch[0]?.text.slice(0, 500) ?? null;
    await prisma.translationJob
      .update({
        where: { id: jobId },
        data: {
          currentItemText: preview,
          currentItemTranslation: null,
          currentLocale: null,
        },
      })
      .catch(() => {}); // si le job a été dismiss entre-temps

    // Clés = item.id — l'API renvoie les traductions avec les mêmes clés en sortie.
    const phrases: Record<string, string> = {};
    for (const item of batch) {
      if (item.text.trim()) phrases[item.id] = item.text;
    }

    let result: Awaited<ReturnType<typeof translatePhrases>> = null;
    try {
      result = await translatePhrases(phrases);
    } catch (err) {
      logger.warn("[Translation Queue] Batch échoué (API)", {
        jobId,
        batchSize: batch.length,
        error: err as Error,
      });
    }

    // Persistance : upsert par (entityId, locale) pour chaque item du batch.
    for (const item of batch) {
      const perLocale = result?.[item.id];
      let anyWritten = false;
      if (perLocale) {
        for (const locale of NON_DEFAULT_LOCALES) {
          if (!(PFS_TRANSLATION_LOCALES as readonly string[]).includes(locale)) continue;
          const value = perLocale[locale as (typeof PFS_TRANSLATION_LOCALES)[number]];
          if (value && value.trim()) {
            try {
              await persistTranslation(entityType, item.id, locale, value);
              anyWritten = true;
            } catch (err) {
              logger.warn("[Translation Queue] Persist échoué", {
                jobId,
                itemId: item.id,
                locale,
                error: err as Error,
              });
            }
          }
        }
      }
      if (!anyWritten) errors++;
      done++;
    }

    // Un seul update de progression par batch (au lieu d'1 par mot × 2 locales).
    await prisma.translationJob
      .update({
        where: { id: jobId },
        data: { doneCount: done, errorCount: errors },
      })
      .catch(() => {});
  }

  await prisma.translationJob.update({
    where: { id: jobId },
    data: {
      status: "DONE",
      completedAt: new Date(),
      currentItemText: null,
      currentItemTranslation: null,
      currentLocale: null,
    },
  });
}

// ─────────────────────────────────────────────
// Tests helpers (exportés pour Vitest)
// ─────────────────────────────────────────────

export const __test = {
  processJob,
  persistTranslation,
};

export type { TranslationJobStatus };
