/**
 * Faire Orders — État d'import historique persistant par tenant.
 *
 * Le rattrapage historique traite N commandes en fond. L'état est stocké en
 * SiteConfig pour survivre à un redémarrage PM2 et être queryable par le widget
 * flottant.
 *
 * Clés SiteConfig :
 *   - faire_orders_import_state    : JSON stringifié (voir FaireImportState)
 *   - faire_orders_import_stop     : "1" quand la cliente annule
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";

export type FaireImportStatus = "IDLE" | "RUNNING" | "DONE" | "ERROR" | "STOPPED";

export type FaireImportEventResult = "imported" | "unchanged" | "error";

export interface FaireImportCurrentOrder {
  faireOrderId: string;
  displayId: string;
  customerName: string;
  totalHT: number | null;
  country: string | null;
}

export interface FaireImportRecentEvent {
  orderNumber: string;
  customerName: string;
  result: FaireImportEventResult;
  totalHT: number | null;
  errorMessage?: string;
  at: number;
}

export interface FaireImportState {
  status: FaireImportStatus;
  startedAt: number | null;
  finishedAt: number | null;
  /** Faire ne renvoie pas de compteur total dans la pagination — reste 0. */
  totalOrders: number;
  processedOrders: number;
  imported: number;
  skipped: number;
  unchanged: number;
  currentPage: number;
  errorMessage?: string;
  currentOrders: FaireImportCurrentOrder[];
  recentEvents: FaireImportRecentEvent[];
}

const KEY_STATE = "faire_orders_import_state";
const KEY_STOP = "faire_orders_import_stop";
const RECENT_EVENTS_MAX = 30;

const EMPTY_STATE: FaireImportState = {
  status: "IDLE",
  startedAt: null,
  finishedAt: null,
  totalOrders: 0,
  processedOrders: 0,
  imported: 0,
  skipped: 0,
  unchanged: 0,
  currentPage: 0,
  currentOrders: [],
  recentEvents: [],
};

export async function getFaireImportState(tenantId: string): Promise<FaireImportState> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: KEY_STATE },
    select: { value: true },
  });
  if (!row?.value) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(row.value) as Partial<FaireImportState>;
    return { ...EMPTY_STATE, ...parsed };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function setFaireImportState(tenantId: string, state: FaireImportState): Promise<void> {
  const value = JSON.stringify(state);
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: KEY_STATE } },
    update: { value },
    create: { tenantId, key: KEY_STATE, value },
  });
}

async function patchFaireImportState(
  tenantId: string,
  patch: Partial<FaireImportState>,
): Promise<void> {
  const current = await getFaireImportState(tenantId);
  await setFaireImportState(tenantId, { ...current, ...patch });
}

async function pushFaireImportEvent(
  tenantId: string,
  event: FaireImportRecentEvent,
): Promise<void> {
  const current = await getFaireImportState(tenantId);
  const next = [event, ...current.recentEvents].slice(0, RECENT_EVENTS_MAX);
  await setFaireImportState(tenantId, { ...current, recentEvents: next });
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
export async function startFaireHistoricalImportInBackground(
  tenantId: string,
): Promise<FaireImportState> {
  const current = await getFaireImportState(tenantId);
  if (current.status === "RUNNING") return current;

  const initial: FaireImportState = {
    ...EMPTY_STATE,
    status: "RUNNING",
    startedAt: Date.now(),
  };
  await setFaireImportState(tenantId, initial);
  await setStopSignal(tenantId, false);

  // Fire-and-forget dans le contexte tenant (sinon fuite marketplace entre boutiques)
  void tenantALS.run(tenantId, async () => {
    try {
      const { importAllFaireOrdersFor } = await import("@/lib/faire-orders-sync");
      const result = await importAllFaireOrdersFor(
        tenantId,
        async (progress) => {
          await patchFaireImportState(tenantId, {
            status: "RUNNING",
            processedOrders: progress.processedOrders,
            currentPage: progress.currentPage,
            currentOrders: progress.currentOrders,
          });
        },
        {
          stopSignal: () => checkStopSignal(tenantId),
          onEvent: (event) => pushFaireImportEvent(tenantId, event),
        },
      );

      const stopped = await checkStopSignal(tenantId);
      const finalState: FaireImportState = {
        ...(await getFaireImportState(tenantId)),
        status: stopped ? "STOPPED" : "DONE",
        finishedAt: Date.now(),
        imported: result.imported,
        skipped: result.skipped,
        unchanged: result.unchanged,
        totalOrders: result.total,
        currentOrders: [],
      };
      await setFaireImportState(tenantId, finalState);
      await setStopSignal(tenantId, false);
    } catch (err) {
      logger.error("[Faire Orders Import] Import historique échoué", {
        tenantId,
        error: err as Error,
      });
      const errorState: FaireImportState = {
        ...(await getFaireImportState(tenantId)),
        status: "ERROR",
        finishedAt: Date.now(),
        errorMessage: err instanceof Error ? err.message : String(err),
        currentOrders: [],
      };
      await setFaireImportState(tenantId, errorState);
    }
  });

  return initial;
}

export async function requestStopFaireHistoricalImport(tenantId: string): Promise<void> {
  await setStopSignal(tenantId, true);
}

export async function resetFaireImportState(tenantId: string): Promise<void> {
  await setFaireImportState(tenantId, { ...EMPTY_STATE });
  await setStopSignal(tenantId, false);
}
