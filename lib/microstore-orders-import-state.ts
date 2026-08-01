/**
 * Microstore — État d'import historique persistant par tenant.
 *
 * Le rattrapage historique se fait en **2 phases séquentielles** :
 *   1. CUSTOMERS : liste complète des clients via `/customer/get_by_order`
 *      (endpoint dédié qui renvoie même les clients sans commande). Total
 *      connu dès la 1ère page → progression précise `X / totalCustomers`.
 *   2. ORDERS : liste des commandes sur 5 ans en tranches de 90 jours.
 *      Total inconnu à l'avance → grimpe au fil des chunks. Chaque commande
 *      rattache/enrichit la fiche client déjà créée en phase 1.
 *
 * L'état est stocké en SiteConfig pour survivre à un redémarrage PM2 et
 * être queryable par le widget flottant.
 *
 * Clés SiteConfig :
 *   - microstore_orders_import_state    : JSON (voir MicrostoreImportState)
 *   - microstore_orders_import_stop     : "1" quand la cliente annule
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { syncMicrostoreOrders } from "@/lib/microstore-orders-sync";
import { syncMicrostoreCustomers } from "@/lib/microstore-customers-sync";
import { microstoreCountOrders } from "@/lib/microstore-client";

export type MicrostoreImportStatus = "IDLE" | "RUNNING" | "DONE" | "ERROR" | "STOPPED";
export type MicrostoreImportPhase = "CUSTOMERS" | "ORDERS" | null;

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
  /** Phase courante quand status === "RUNNING". */
  phase: MicrostoreImportPhase;
  startedAt: number | null;
  finishedAt: number | null;

  // ── Phase 1 : CUSTOMERS ────────────────────────
  /** Total clients Microstore (précis dès la 1ère page). */
  customersTotal: number;
  customersProcessed: number;
  customersCreated: number;
  customersUpdated: number;

  // ── Phase 2 : ORDERS ───────────────────────────
  /** Microstore ne renvoie pas de compteur total avant la fin du balayage —
   *  on met à jour au fil des chunks. */
  totalOrders: number;
  processedOrders: number;
  imported: number;
  updated: number;
  errors: number;
  currentChunk: number;
  totalChunks: number;

  // ── Compat / affichage ─────────────────────────
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
  phase: null,
  startedAt: null,
  finishedAt: null,
  customersTotal: 0,
  customersProcessed: 0,
  customersCreated: 0,
  customersUpdated: 0,
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
 * Séquence :
 *   1. Phase CUSTOMERS : boucle sur les pages de `/customer/get_by_order`
 *      → upsert AdminClientCard pour chaque client (même sans commande).
 *   2. Phase ORDERS : boucle sur 5 ans en tranches de 90 jours
 *      → upsert MicrostoreOrder + rattachement à la fiche client.
 *
 * L'annulation coopérative est vérifiée entre chaque page (phase 1) et entre
 * chaque tranche (phase 2).
 */
export async function startMicrostoreHistoricalImportInBackground(
  tenantId: string,
): Promise<MicrostoreImportState> {
  const current = await getMicrostoreImportState(tenantId);
  if (current.status === "RUNNING") return current;

  const YEARS_BACK = 5;

  const initial: MicrostoreImportState = {
    ...EMPTY_STATE,
    status: "RUNNING",
    phase: "CUSTOMERS",
    startedAt: Date.now(),
  };
  await setMicrostoreImportState(tenantId, initial);
  await setStopSignal(tenantId, false);

  // Fire-and-forget dans le contexte tenant (sinon fuite marketplace entre boutiques)
  void tenantALS.run(tenantId, async () => {
    try {
      // ─── Phase 1 : CUSTOMERS ─────────────────────────────
      const customersRes = await syncMicrostoreCustomers({
        tenantId,
        shouldStop: () => checkStopSignal(tenantId),
        onProgress: async ({ processed, total }) => {
          await patchMicrostoreImportState(tenantId, {
            customersProcessed: processed,
            customersTotal: total,
          });
        },
      });
      await patchMicrostoreImportState(tenantId, {
        customersCreated: customersRes.created,
        customersUpdated: customersRes.updated,
        customersTotal: customersRes.total,
      });

      // Signal d'annulation entre les 2 phases
      if (await checkStopSignal(tenantId)) {
        await patchMicrostoreImportState(tenantId, {
          status: "STOPPED",
          phase: null,
          finishedAt: Date.now(),
        });
        await setStopSignal(tenantId, false);
        return;
      }

      // ─── Phase 2 : ORDERS ────────────────────────────────
      const now = new Date();
      const overallStart = now.getTime() - YEARS_BACK * 365 * 86400_000;
      const overallStartDate = new Date(overallStart).toISOString().substring(0, 10);
      const overallEndDate = now.toISOString().substring(0, 10);

      // Pré-comptage : 1 appel léger sur toute la plage 5 ans → renvoie
      // `list_num` précis. Fige `totalOrders` dès le début pour que le widget
      // affiche `X / 1059` (au lieu de grimper au fil des chunks — bug
      // historique 1071/238 corrigé 2026-08-01).
      let preflightTotal = 0;
      try {
        const preflight = await microstoreCountOrders({
          fromDate: overallStartDate,
          toDate: overallEndDate,
        });
        preflightTotal = preflight.total;
      } catch (err) {
        logger.warn("[Microstore Import] Pré-comptage commandes échoué", {
          tenantId,
          error: err as Error,
        });
        // On continue quand même — le total sera mis à jour par les chunks
      }

      await patchMicrostoreImportState(tenantId, {
        phase: "ORDERS",
        totalOrders: preflightTotal,
        processedOrders: 0,
      });

      // ─── Passe unique sur toute la plage 5 ans ───────────
      // Microstore accepte des plages larges sans limite pratique (validé HAR
      // 2026-08-01). Plus de chunk par 90 jours : évite le bug historique
      // 1068/1059 causé par le chevauchement des bornes de chunks (jour A à la
      // fois `to` du chunk N et `from` du chunk N+1 → commandes comptées deux
      // fois).
      let imported = 0;
      let updated = 0;
      let errors = 0;
      let processed = 0;

      const res = await syncMicrostoreOrders({
        tenantId,
        fromDate: overallStartDate,
        toDate: overallEndDate,
        onProgress: async (info) => {
          processed = info.scanned;
          const safeTotal = preflightTotal > 0 ? preflightTotal : Math.max(processed, info.total);
          await patchMicrostoreImportState(tenantId, {
            processedOrders: processed,
            totalOrders: safeTotal,
            currentOrders: [
              {
                microstoreOrderId: info.lastOrderNumber,
                customerName: info.lastOrderNumber,
                totalHT: null,
                country: null,
              },
            ],
          });
          // Coupe la boucle si la cliente annule
          if (await checkStopSignal(tenantId)) {
            throw new Error("__STOPPED__");
          }
        },
      });

      imported = res.created;
      updated = res.updated;
      errors = res.errors.length;

      if (imported > 0 || updated > 0) {
        await pushMicrostoreImportEvent(tenantId, {
          orderNumber: `${overallStartDate} → ${overallEndDate}`,
          customerName: `${imported} créée${imported > 1 ? "s" : ""} · ${updated} mise${updated > 1 ? "s" : ""} à jour`,
          result: imported > 0 ? "imported" : "unchanged",
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

      const stopped = await checkStopSignal(tenantId);
      const finalState: MicrostoreImportState = {
        ...(await getMicrostoreImportState(tenantId)),
        status: stopped ? "STOPPED" : "DONE",
        phase: null,
        finishedAt: Date.now(),
        imported,
        updated,
        unchanged: updated,
        errors,
        totalOrders: preflightTotal > 0 ? preflightTotal : processed,
        processedOrders: processed,
        currentOrders: [],
      };
      await setMicrostoreImportState(tenantId, finalState);
      await setStopSignal(tenantId, false);
    } catch (err) {
      // Annulation coopérative : `onProgress` throw "__STOPPED__" quand la
      // cliente clique Annuler. On termine proprement en STOPPED, pas en ERROR.
      const isStopped = err instanceof Error && err.message === "__STOPPED__";
      if (isStopped) {
        const finalState: MicrostoreImportState = {
          ...(await getMicrostoreImportState(tenantId)),
          status: "STOPPED",
          phase: null,
          finishedAt: Date.now(),
          currentOrders: [],
        };
        await setMicrostoreImportState(tenantId, finalState);
        await setStopSignal(tenantId, false);
        return;
      }
      logger.error("[Microstore Import] Rattrapage historique échoué", {
        tenantId,
        error: err as Error,
      });
      const errorState: MicrostoreImportState = {
        ...(await getMicrostoreImportState(tenantId)),
        status: "ERROR",
        phase: null,
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
