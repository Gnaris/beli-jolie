/**
 * État persistant de l'import historique Orderchamp — même contrat que
 * `lib/faire-orders-import-state.ts`. Stocké en SiteConfig par tenant :
 *   - `orderchamp_orders_import_state` : JSON { status, startedAt, processed, created, updated, events[] }
 *   - `orderchamp_orders_import_stop`  : "1" si l'admin a demandé l'arrêt
 *
 * Utilisé par la modale « Import complet » côté admin et par le worker
 * `importAllOrderchampOrdersFor`. Fire-and-forget côté déclencheur (server
 * action) : on lance l'import dans `tenantALS.run` et on met à jour le state
 * au fil de l'eau.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { importAllOrderchampOrdersFor } from "@/lib/orderchamp-orders-sync";

const STATE_KEY = "orderchamp_orders_import_state";
const STOP_KEY = "orderchamp_orders_import_stop";
const RECENT_EVENTS_MAX = 30;

export type OrderchampImportStatus = "idle" | "running" | "done" | "cancelled" | "error";

export interface OrderchampImportEvent {
  at: string; // ISO
  message: string;
  kind: "info" | "success" | "warning" | "error";
}

export interface OrderchampImportState {
  status: OrderchampImportStatus;
  startedAt: string | null;
  finishedAt: string | null;
  processed: number;
  created: number;
  updated: number;
  events: OrderchampImportEvent[];
  errorMessage?: string;
}

const DEFAULT_STATE: OrderchampImportState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  processed: 0,
  created: 0,
  updated: 0,
  events: [],
};

async function readState(tenantId: string): Promise<OrderchampImportState> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: STATE_KEY },
    select: { value: true },
  });
  if (!row?.value) return DEFAULT_STATE;
  try {
    return JSON.parse(row.value) as OrderchampImportState;
  } catch {
    return DEFAULT_STATE;
  }
}

async function writeState(tenantId: string, state: OrderchampImportState): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: STATE_KEY } },
    update: { value: JSON.stringify(state) },
    create: { tenantId, key: STATE_KEY, value: JSON.stringify(state) },
  });
}

async function readStopFlag(tenantId: string): Promise<boolean> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: STOP_KEY },
    select: { value: true },
  });
  return row?.value === "1";
}

async function clearStopFlag(tenantId: string): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: STOP_KEY } },
    update: { value: "0" },
    create: { tenantId, key: STOP_KEY, value: "0" },
  });
}

export async function requestStopOrderchampImport(tenantId: string): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId, key: STOP_KEY } },
    update: { value: "1" },
    create: { tenantId, key: STOP_KEY, value: "1" },
  });
}

export async function getOrderchampImportState(tenantId: string): Promise<OrderchampImportState> {
  return readState(tenantId);
}

function pushEvent(state: OrderchampImportState, event: OrderchampImportEvent): OrderchampImportState {
  const next = [...state.events, event];
  if (next.length > RECENT_EVENTS_MAX) next.splice(0, next.length - RECENT_EVENTS_MAX);
  return { ...state, events: next };
}

/**
 * Kick off (fire-and-forget) — retourne immédiatement, tourne en tâche de fond
 * dans le contexte tenant courant. Idempotent : si un import est déjà en cours
 * (status === "running"), no-op.
 */
export async function startOrderchampHistoricalImport(tenantId: string): Promise<{ started: boolean; reason?: string }> {
  const current = await readState(tenantId);
  if (current.status === "running") {
    return { started: false, reason: "Un import est déjà en cours." };
  }
  await clearStopFlag(tenantId);
  const startedAt = new Date().toISOString();
  const initial: OrderchampImportState = {
    status: "running",
    startedAt,
    finishedAt: null,
    processed: 0,
    created: 0,
    updated: 0,
    events: [{ at: startedAt, message: "Import démarré.", kind: "info" }],
  };
  await writeState(tenantId, initial);

  // Fire-and-forget dans le contexte tenant (préserve ALS).
  void tenantALS.run(tenantId, async () => {
    try {
      await importAllOrderchampOrdersFor(
        tenantId,
        async (p) => {
          const state = await readState(tenantId);
          const updated: OrderchampImportState = {
            ...state,
            processed: p.processed,
            created: p.created,
            updated: p.updated,
          };
          if (p.currentOrder) {
            const msg = `Commande ${p.currentOrder.displayId || p.currentOrder.orderchampOrderId} — ${p.currentOrder.customerName}`;
            await writeState(tenantId, pushEvent(updated, {
              at: new Date().toISOString(),
              message: msg,
              kind: "info",
            }));
          } else {
            await writeState(tenantId, updated);
          }
        },
        async () => readStopFlag(tenantId),
      );
      const finished = await readState(tenantId);
      const stopped = await readStopFlag(tenantId);
      const finalState: OrderchampImportState = {
        ...finished,
        status: stopped ? "cancelled" : "done",
        finishedAt: new Date().toISOString(),
      };
      await writeState(
        tenantId,
        pushEvent(finalState, {
          at: new Date().toISOString(),
          message: stopped
            ? `Import annulé après ${finished.processed} commande(s).`
            : `Import terminé — ${finished.created} créée(s), ${finished.updated} mise(s) à jour.`,
          kind: stopped ? "warning" : "success",
        }),
      );
      await clearStopFlag(tenantId);
    } catch (err) {
      logger.error("[Orderchamp Orders] Import historique échoué", { tenantId, error: err as Error });
      const failed = await readState(tenantId);
      await writeState(tenantId, pushEvent({
        ...failed,
        status: "error",
        finishedAt: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
      }, {
        at: new Date().toISOString(),
        message: `Erreur : ${err instanceof Error ? err.message : String(err)}`,
        kind: "error",
      }));
    }
  });

  return { started: true };
}
