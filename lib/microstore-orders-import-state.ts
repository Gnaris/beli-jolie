/**
 * Microstore Orders — État d'import historique persistant par tenant.
 *
 * Le rattrapage historique traite N commandes en fond. L'état est stocké en
 * SiteConfig pour survivre à un redémarrage PM2 et être queryable par le widget
 * flottant.
 *
 * Clés SiteConfig :
 *   - microstore_orders_import_state    : JSON stringifié (voir MicrostoreImportState)
 *   - microstore_orders_import_stop     : "1" quand la cliente annule
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { syncMicrostoreOrders } from "@/lib/microstore-orders-sync";

export type MicrostoreImportStatus = "IDLE" | "RUNNING" | "DONE" | "ERROR" | "STOPPED";

export type MicrostoreImportEventResult = "imported" | "unchanged" | "error";

export interface MicrostoreImportCurrentOrder {
  microstoreOrderId: string;
  customerName: string;
  totalHT: number | null;
  country: string | null;
}

export interface MicrostoreImportRecentEvent {
  orderNumber: string;
  customerName: string;
  result: MicrostoreImportEventResult;
  totalHT: number | null;
  errorMessage?: string;
  at: number;
}

export interface MicrostoreImportState {
  status: MicrostoreImportStatus;
  startedAt: number | null;
  finishedAt: number | null;
  /** Microstore ne renvoie pas de compteur total tant que la liste n'est pas
   *  complètement chargée — on met à jour au fil des chunks. */
  totalOrders: number;
  processedOrders: number;
  imported: number;
  updated: number;
  errors: number;
  currentChunk: number;
  totalChunks: number;
  /** Aliases pour compat avec le composant partagé SourceSection (widget). */
  currentPage: number;
  unchanged: number;
  skipped: number;
  errorMessage?: string;
  currentOrders: MicrostoreImportCurrentOrder[];
  recentEvents: MicrostoreImportRecentEvent[];
}

const KEY_STATE = "microstore_orders_import_state";
const KEY_STOP = "microstore_orders_import_stop";
const RECENT_EVENTS_MAX = 30;

const EMPTY_STATE: MicrostoreImportState = {
  status: "IDLE",
  startedAt: null,
  finishedAt: null,
  totalOrders: 0,
  processedOrders: 0,
  imported: 0,
  updated: 0,
  errors: 0,
  currentChunk: 0,
  totalChunks: 0,
  currentPage: 0,
  unchanged: 0,
  skipped: 0,
  currentOrders: [],
  recentEvents: [],
};

export async function getMicrostoreImportState(
  tenantId: string,
): Promise<MicrostoreImportState> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: KEY_STATE },
    select: { value: true },
  });
  if (!row?.value) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(row.value) as Partial<MicrostoreImportState>;
    return { ...EMPTY_STATE, ...parsed };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function setMicrostoreImportState(
  tenantId: string,
  state: MicrostoreImportState,
): Promise<void> {
  const value = JSON.stringify(state);
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: KEY_STATE } },
    update: { value },
    create: { tenantId, key: KEY_STATE, value },
  });
}

async function patchMicrostoreImportState(
  tenantId: string,
  patch: Partial<MicrostoreImportState>,
): Promise<void> {
  const current = await getMicrostoreImportState(tenantId);
  await setMicrostoreImportState(tenantId, { ...current, ...patch });
}

async function pushMicrostoreImportEvent(
  tenantId: string,
  event: MicrostoreImportRecentEvent,
): Promise<void> {
  const current = await getMicrostoreImportState(tenantId);
  const next = [event, ...current.recentEvents].slice(0, RECENT_EVENTS_MAX);
  await setMicrostoreImportState(tenantId, { ...current, recentEvents: next });
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
 * Démarre le rattrapage historique en tâche de fond (fire-and-forget).
 * Idempotent : renvoie l'état actuel si un import est déjà RUNNING.
 *
 * Parcourt 5 années en tranches de 90 jours. Progression et events poussés au
 * fur et à mesure pour affichage live dans le widget.
 */
export async function startMicrostoreHistoricalImportInBackground(
  tenantId: string,
): Promise<MicrostoreImportState> {
  const current = await getMicrostoreImportState(tenantId);
  if (current.status === "RUNNING") return current;

  const CHUNK_DAYS = 90;
  const YEARS_BACK = 5;
  const totalChunks = Math.ceil((YEARS_BACK * 365) / CHUNK_DAYS);

  const initial: MicrostoreImportState = {
    ...EMPTY_STATE,
    status: "RUNNING",
    startedAt: Date.now(),
    totalChunks,
  };
  await setMicrostoreImportState(tenantId, initial);
  await setStopSignal(tenantId, false);

  // Fire-and-forget dans le contexte tenant (sinon fuite marketplace entre boutiques)
  void tenantALS.run(tenantId, async () => {
    let imported = 0;
    let updated = 0;
    let errors = 0;
    let processed = 0;
    let total = 0;
    let chunkIdx = 0;

    try {
      const now = new Date();
      const overallStart = now.getTime() - YEARS_BACK * 365 * 86400_000;
      let cursor = now.getTime();

      while (cursor > overallStart) {
        // Signal d'annulation
        if (await checkStopSignal(tenantId)) break;

        chunkIdx += 1;
        const to = new Date(cursor);
        const from = new Date(Math.max(overallStart, cursor - CHUNK_DAYS * 86400_000));
        const fromStr = from.toISOString().substring(0, 10);
        const toStr = to.toISOString().substring(0, 10);

        await patchMicrostoreImportState(tenantId, {
          currentChunk: chunkIdx,
          currentPage: chunkIdx, // alias pour SourceSection
          currentOrders: [],
        });

        const res = await syncMicrostoreOrders({
          tenantId,
          fromDate: fromStr,
          toDate: toStr,
          onProgress: async (info) => {
            processed += 1;
            total = Math.max(total, info.total);
            await patchMicrostoreImportState(tenantId, {
              processedOrders: processed,
              totalOrders: total,
              currentOrders: [
                {
                  microstoreOrderId: info.lastOrderNumber,
                  customerName: info.lastOrderNumber,
                  totalHT: null,
                  country: null,
                },
              ],
            });
          },
        });

        imported += res.created;
        updated += res.updated;
        errors += res.errors.length;

        // Push events pour chaque commande créée / mise à jour
        // (res.errors est déjà détaillé ; les succès on résume par chunk pour ne
        // pas spammer)
        if (res.created > 0) {
          await pushMicrostoreImportEvent(tenantId, {
            orderNumber: `${fromStr} → ${toStr}`,
            customerName: `${res.created} nouvelles`,
            result: "imported",
            totalHT: null,
            at: Date.now(),
          });
        } else if (res.updated > 0) {
          await pushMicrostoreImportEvent(tenantId, {
            orderNumber: `${fromStr} → ${toStr}`,
            customerName: `${res.updated} mises à jour`,
            result: "unchanged",
            totalHT: null,
            at: Date.now(),
          });
        }
        for (const e of res.errors) {
          await pushMicrostoreImportEvent(tenantId, {
            orderNumber: e.microstoreOrderId,
            customerName: "erreur",
            result: "error",
            totalHT: null,
            errorMessage: e.error,
            at: Date.now(),
          });
        }

        await patchMicrostoreImportState(tenantId, {
          imported,
          updated,
          unchanged: updated, // alias pour SourceSection
          errors,
        });

        cursor -= CHUNK_DAYS * 86400_000;
      }

      const stopped = await checkStopSignal(tenantId);
      const finalState: MicrostoreImportState = {
        ...(await getMicrostoreImportState(tenantId)),
        status: stopped ? "STOPPED" : "DONE",
        finishedAt: Date.now(),
        imported,
        updated,
        unchanged: updated,
        errors,
        totalOrders: total,
        processedOrders: processed,
        currentOrders: [],
      };
      await setMicrostoreImportState(tenantId, finalState);
      await setStopSignal(tenantId, false);
    } catch (err) {
      logger.error("[Microstore Orders Import] Rattrapage historique échoué", {
        tenantId,
        error: err as Error,
      });
      const errorState: MicrostoreImportState = {
        ...(await getMicrostoreImportState(tenantId)),
        status: "ERROR",
        finishedAt: Date.now(),
        errorMessage: err instanceof Error ? err.message : String(err),
        currentOrders: [],
      };
      await setMicrostoreImportState(tenantId, errorState);
    }
  });

  return initial;
}

export async function requestStopMicrostoreHistoricalImport(tenantId: string): Promise<void> {
  await setStopSignal(tenantId, true);
}

export async function resetMicrostoreImportState(tenantId: string): Promise<void> {
  await setMicrostoreImportState(tenantId, { ...EMPTY_STATE });
  await setStopSignal(tenantId, false);
}
