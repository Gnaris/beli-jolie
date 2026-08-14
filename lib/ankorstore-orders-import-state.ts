/**
 * Ankorstore Orders — État d'import historique persistant par tenant.
 *
 * Calqué sur `lib/efashion-orders-import-state.ts`. Stocké en SiteConfig pour
 * survivre à un redémarrage PM2 et être queryable par le widget flottant.
 *
 * Clés SiteConfig :
 *   - ankorstore_orders_import_state    : JSON stringifié (voir AnkorstoreImportState)
 *   - ankorstore_orders_import_stop     : "1" quand la cliente annule
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";

export type AnkorstoreImportStatus = "IDLE" | "RUNNING" | "DONE" | "ERROR" | "STOPPED";

export type AnkorstoreImportEventResult = "imported" | "unchanged" | "error";

export interface AnkorstoreImportCurrentOrder {
  uuid: string;
  reference: string;
  customerName: string;
  totalHT: number | null;
  country: string | null;
}

export interface AnkorstoreImportRecentEvent {
  reference: string;
  customerName: string;
  result: AnkorstoreImportEventResult;
  totalHT: number | null;
  errorMessage?: string;
  at: number;
}

export interface AnkorstoreImportState {
  status: AnkorstoreImportStatus;
  startedAt: number | null;
  finishedAt: number | null;
  totalOrders: number;
  processedOrders: number;
  imported: number;
  skipped: number;
  unchanged: number;
  currentPage: number;
  totalPages: number;
  errorMessage?: string;
  currentOrders: AnkorstoreImportCurrentOrder[];
  recentEvents: AnkorstoreImportRecentEvent[];
}

const KEY_STATE = "ankorstore_orders_import_state";
const KEY_STOP = "ankorstore_orders_import_stop";
const RECENT_EVENTS_MAX = 30;

const EMPTY_STATE: AnkorstoreImportState = {
  status: "IDLE",
  startedAt: null,
  finishedAt: null,
  totalOrders: 0,
  processedOrders: 0,
  imported: 0,
  skipped: 0,
  unchanged: 0,
  currentPage: 0,
  totalPages: 0,
  currentOrders: [],
  recentEvents: [],
};

export async function getAnkorstoreImportState(
  tenantId: string,
): Promise<AnkorstoreImportState> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: KEY_STATE },
    select: { value: true },
  });
  if (!row?.value) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(row.value) as Partial<AnkorstoreImportState>;
    return { ...EMPTY_STATE, ...parsed };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function setAnkorstoreImportState(
  tenantId: string,
  state: AnkorstoreImportState,
): Promise<void> {
  const value = JSON.stringify(state);
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: KEY_STATE } },
    update: { value },
    create: { tenantId, key: KEY_STATE, value },
  });
}

async function patchAnkorstoreImportState(
  tenantId: string,
  patch: Partial<AnkorstoreImportState>,
): Promise<void> {
  const current = await getAnkorstoreImportState(tenantId);
  await setAnkorstoreImportState(tenantId, { ...current, ...patch });
}

async function pushAnkorstoreImportEvent(
  tenantId: string,
  event: AnkorstoreImportRecentEvent,
): Promise<void> {
  const current = await getAnkorstoreImportState(tenantId);
  const next = [event, ...current.recentEvents].slice(0, RECENT_EVENTS_MAX);
  await setAnkorstoreImportState(tenantId, { ...current, recentEvents: next });
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
 * Démarre l'import historique en tâche de fond (fire-and-forget).
 * Idempotent : renvoie l'état actuel si un import est déjà RUNNING.
 */
export async function startAnkorstoreHistoricalImportInBackground(
  tenantId: string,
): Promise<AnkorstoreImportState> {
  const current = await getAnkorstoreImportState(tenantId);
  if (current.status === "RUNNING") return current;

  const initial: AnkorstoreImportState = {
    ...EMPTY_STATE,
    status: "RUNNING",
    startedAt: Date.now(),
  };
  await setAnkorstoreImportState(tenantId, initial);
  await setStopSignal(tenantId, false);

  void tenantALS.run(tenantId, async () => {
    try {
      const { importAllAnkorstoreOrdersFor } = await import(
        "@/lib/ankorstore-orders-sync"
      );
      const result = await importAllAnkorstoreOrdersFor(
        tenantId,
        async (progress) => {
          await patchAnkorstoreImportState(tenantId, {
            status: "RUNNING",
            totalOrders: progress.totalOrders,
            processedOrders: progress.processedOrders,
            currentPage: progress.currentPage,
            totalPages: progress.totalPages,
            currentOrders: progress.currentOrders,
          });
        },
        {
          stopSignal: () => checkStopSignal(tenantId),
          onEvent: (event) => pushAnkorstoreImportEvent(tenantId, event),
        },
      );

      const stopped = await checkStopSignal(tenantId);
      const finalState: AnkorstoreImportState = {
        ...(await getAnkorstoreImportState(tenantId)),
        status: stopped ? "STOPPED" : "DONE",
        finishedAt: Date.now(),
        imported: result.imported,
        skipped: result.skipped,
        unchanged: result.unchanged,
        totalOrders: result.total,
        currentOrders: [],
      };
      await setAnkorstoreImportState(tenantId, finalState);
      await setStopSignal(tenantId, false);
    } catch (err) {
      logger.error("[Ankorstore Orders Import] Import historique échoué", {
        tenantId,
        error: err as Error,
      });
      const errorState: AnkorstoreImportState = {
        ...(await getAnkorstoreImportState(tenantId)),
        status: "ERROR",
        finishedAt: Date.now(),
        errorMessage: err instanceof Error ? err.message : String(err),
        currentOrders: [],
      };
      await setAnkorstoreImportState(tenantId, errorState);
    }
  });

  return initial;
}

export async function requestStopAnkorstoreHistoricalImport(
  tenantId: string,
): Promise<void> {
  await setStopSignal(tenantId, true);
}

export async function resetAnkorstoreImportState(tenantId: string): Promise<void> {
  await setAnkorstoreImportState(tenantId, { ...EMPTY_STATE });
  await setStopSignal(tenantId, false);
}
