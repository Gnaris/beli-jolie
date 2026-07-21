/**
 * PFS Orders — État d'import historique persistant par tenant.
 *
 * Le rattrapage historique traite 2000+ commandes en fond (10-15 min). L'état
 * est stocké en SiteConfig pour survivre à un redémarrage PM2 et être
 * queryable par le widget flottant.
 *
 * Clés SiteConfig :
 *   - pfs_orders_import_state    : JSON stringifié (voir PfsImportState)
 *   - pfs_orders_import_stop     : "1" quand la cliente annule
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";

export type PfsImportStatus = "IDLE" | "RUNNING" | "DONE" | "ERROR" | "STOPPED";

export type PfsImportEventResult = "imported" | "unchanged" | "error";

export interface PfsImportCurrentOrder {
  pfsOrderId: string;
  orderNumber: string;
  customerName: string;
  totalTTC: number | null;
  country: string | null;
}

export interface PfsImportRecentEvent {
  orderNumber: string;
  customerName: string;
  result: PfsImportEventResult;
  totalTTC: number | null;
  errorMessage?: string;
  at: number; // epoch ms
}

export interface PfsImportState {
  status: PfsImportStatus;
  startedAt: number | null; // epoch ms
  finishedAt: number | null;
  totalOrders: number;
  processedOrders: number;
  imported: number;
  skipped: number;
  unchanged: number; // Commandes déjà en BDD au même statut → aucun appel PFS détail
  currentPage: number;
  totalPages: number;
  errorMessage?: string;
  currentOrders: PfsImportCurrentOrder[]; // 5 workers en parallèle max
  recentEvents: PfsImportRecentEvent[];
}

const KEY_STATE = "pfs_orders_import_state";
const KEY_STOP = "pfs_orders_import_stop";

// Nombre max d'événements récents à garder pour le tiroir (garde le SiteConfig léger).
const RECENT_EVENTS_MAX = 30;

const EMPTY_STATE: PfsImportState = {
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

export async function getPfsImportState(tenantId: string): Promise<PfsImportState> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: KEY_STATE },
    select: { value: true },
  });
  if (!row?.value) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(row.value) as Partial<PfsImportState>;
    return { ...EMPTY_STATE, ...parsed };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function setPfsImportState(tenantId: string, state: PfsImportState): Promise<void> {
  const value = JSON.stringify(state);
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: KEY_STATE } },
    update: { value },
    create: { tenantId, key: KEY_STATE, value },
  });
}

/** Fusionne un patch partiel dans l'état persistant (utilisé par les callbacks). */
async function patchPfsImportState(
  tenantId: string,
  patch: Partial<PfsImportState>,
): Promise<void> {
  const current = await getPfsImportState(tenantId);
  await setPfsImportState(tenantId, { ...current, ...patch });
}

/** Ajoute un événement en tête de la liste des récents (max RECENT_EVENTS_MAX). */
async function pushPfsImportEvent(
  tenantId: string,
  event: PfsImportRecentEvent,
): Promise<void> {
  const current = await getPfsImportState(tenantId);
  const next = [event, ...current.recentEvents].slice(0, RECENT_EVENTS_MAX);
  await setPfsImportState(tenantId, { ...current, recentEvents: next });
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
export async function startPfsHistoricalImportInBackground(
  tenantId: string,
): Promise<PfsImportState> {
  const current = await getPfsImportState(tenantId);
  if (current.status === "RUNNING") return current;

  const initial: PfsImportState = {
    ...EMPTY_STATE,
    status: "RUNNING",
    startedAt: Date.now(),
  };
  await setPfsImportState(tenantId, initial);
  await setStopSignal(tenantId, false);

  // Fire-and-forget dans le contexte tenant.
  void tenantALS.run(tenantId, async () => {
    try {
      const { importAllPfsOrdersFor } = await import("@/lib/pfs-orders-sync");
      const result = await importAllPfsOrdersFor(
        tenantId,
        async (progress) => {
          await patchPfsImportState(tenantId, {
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
          onEvent: (event) => pushPfsImportEvent(tenantId, event),
        },
      );

      const stopped = await checkStopSignal(tenantId);
      const finalState: PfsImportState = {
        ...(await getPfsImportState(tenantId)),
        status: stopped ? "STOPPED" : "DONE",
        finishedAt: Date.now(),
        imported: result.imported,
        skipped: result.skipped,
        unchanged: result.unchanged,
        totalOrders: result.total,
        currentOrders: [],
      };
      await setPfsImportState(tenantId, finalState);
      await setStopSignal(tenantId, false);
    } catch (err) {
      logger.error("[PFS Orders Import] Import historique échoué", {
        tenantId,
        error: err as Error,
      });
      const errorState: PfsImportState = {
        ...(await getPfsImportState(tenantId)),
        status: "ERROR",
        finishedAt: Date.now(),
        errorMessage: err instanceof Error ? err.message : String(err),
        currentOrders: [],
      };
      await setPfsImportState(tenantId, errorState);
    }
  });

  return initial;
}

export async function requestStopPfsHistoricalImport(tenantId: string): Promise<void> {
  await setStopSignal(tenantId, true);
}

export async function resetPfsImportState(tenantId: string): Promise<void> {
  await setPfsImportState(tenantId, { ...EMPTY_STATE });
  await setStopSignal(tenantId, false);
}
