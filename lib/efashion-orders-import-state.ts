/**
 * eFashion Orders — État d'import historique persistant par tenant.
 *
 * Calqué sur `lib/pfs-orders-import-state.ts`. Stocké en SiteConfig pour
 * survivre à un redémarrage PM2 et être queryable par le widget flottant.
 *
 * Clés SiteConfig :
 *   - efashion_orders_import_state    : JSON stringifié (voir EfashionImportState)
 *   - efashion_orders_import_stop     : "1" quand la cliente annule
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";

export type EfashionImportStatus = "IDLE" | "RUNNING" | "DONE" | "ERROR" | "STOPPED";

export type EfashionImportEventResult = "imported" | "unchanged" | "error";

export interface EfashionImportCurrentOrder {
  efashionOrderId: string;
  orderNumber: string;
  customerName: string;
  totalHT: number | null;
  country: string | null;
}

export interface EfashionImportRecentEvent {
  orderNumber: string;
  customerName: string;
  result: EfashionImportEventResult;
  totalHT: number | null;
  errorMessage?: string;
  at: number;
}

export interface EfashionImportState {
  status: EfashionImportStatus;
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
  currentOrders: EfashionImportCurrentOrder[];
  recentEvents: EfashionImportRecentEvent[];
}

const KEY_STATE = "efashion_orders_import_state";
const KEY_STOP = "efashion_orders_import_stop";
const RECENT_EVENTS_MAX = 30;

const EMPTY_STATE: EfashionImportState = {
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

export async function getEfashionImportState(tenantId: string): Promise<EfashionImportState> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: KEY_STATE },
    select: { value: true },
  });
  if (!row?.value) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(row.value) as Partial<EfashionImportState>;
    return { ...EMPTY_STATE, ...parsed };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function setEfashionImportState(
  tenantId: string,
  state: EfashionImportState,
): Promise<void> {
  const value = JSON.stringify(state);
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: KEY_STATE } },
    update: { value },
    create: { tenantId, key: KEY_STATE, value },
  });
}

async function patchEfashionImportState(
  tenantId: string,
  patch: Partial<EfashionImportState>,
): Promise<void> {
  const current = await getEfashionImportState(tenantId);
  await setEfashionImportState(tenantId, { ...current, ...patch });
}

async function pushEfashionImportEvent(
  tenantId: string,
  event: EfashionImportRecentEvent,
): Promise<void> {
  const current = await getEfashionImportState(tenantId);
  const next = [event, ...current.recentEvents].slice(0, RECENT_EVENTS_MAX);
  await setEfashionImportState(tenantId, { ...current, recentEvents: next });
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
export async function startEfashionHistoricalImportInBackground(
  tenantId: string,
): Promise<EfashionImportState> {
  const current = await getEfashionImportState(tenantId);
  if (current.status === "RUNNING") return current;

  const initial: EfashionImportState = {
    ...EMPTY_STATE,
    status: "RUNNING",
    startedAt: Date.now(),
  };
  await setEfashionImportState(tenantId, initial);
  await setStopSignal(tenantId, false);

  void tenantALS.run(tenantId, async () => {
    try {
      const { importAllEfashionOrdersFor } = await import("@/lib/efashion-orders-sync");
      const result = await importAllEfashionOrdersFor(
        tenantId,
        async (progress) => {
          await patchEfashionImportState(tenantId, {
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
          onEvent: (event) => pushEfashionImportEvent(tenantId, event),
        },
      );

      const stopped = await checkStopSignal(tenantId);
      const finalState: EfashionImportState = {
        ...(await getEfashionImportState(tenantId)),
        status: stopped ? "STOPPED" : "DONE",
        finishedAt: Date.now(),
        imported: result.imported,
        skipped: result.skipped,
        unchanged: result.unchanged,
        totalOrders: result.total,
        currentOrders: [],
      };
      await setEfashionImportState(tenantId, finalState);
      await setStopSignal(tenantId, false);
    } catch (err) {
      logger.error("[eFashion Orders Import] Import historique échoué", {
        tenantId,
        error: err as Error,
      });
      const errorState: EfashionImportState = {
        ...(await getEfashionImportState(tenantId)),
        status: "ERROR",
        finishedAt: Date.now(),
        errorMessage: err instanceof Error ? err.message : String(err),
        currentOrders: [],
      };
      await setEfashionImportState(tenantId, errorState);
    }
  });

  return initial;
}

export async function requestStopEfashionHistoricalImport(tenantId: string): Promise<void> {
  await setStopSignal(tenantId, true);
}

export async function resetEfashionImportState(tenantId: string): Promise<void> {
  await setEfashionImportState(tenantId, { ...EMPTY_STATE });
  await setStopSignal(tenantId, false);
}
