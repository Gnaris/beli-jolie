"use client";

/**
 * Tiroir « Import commandes eFashion Paris » — calqué sur `PfsImportDrawer`.
 * Poll toutes les 1,5 s pendant un import, 6 s au repos.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acknowledgeEfashionHistoricalImport,
  getEfashionImportStateAction,
  startEfashionHistoricalImport,
  stopEfashionHistoricalImport,
  type EfashionImportState,
  type EfashionImportRecentEvent,
} from "@/app/actions/admin/efashion-orders";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";

const POLL_ACTIVE_MS = 1500;
const POLL_IDLE_MS = 6000;
const DISPLAYED_EVENTS_MAX = 30;

const EFASHION_ICON = (
  <span className="w-5 h-5 flex items-center justify-center text-[13px] font-heading font-bold text-white">
    E
  </span>
);

function formatMoney(n: number | null): string {
  if (n == null) return "";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatRelative(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h}h`;
}

function eventKey(ev: EfashionImportRecentEvent): string {
  return `${ev.orderNumber}-${ev.at}-${ev.result}`;
}

export function EfashionImportDrawer() {
  const { openWidget, close, setBadge } = useRightRail();
  const isOpen = openWidget === "efashion-import";

  const [state, setState] = useState<EfashionImportState | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await getEfashionImportStateAction();
        if (cancelled) return;
        setState(s);
        const active = s.status === "RUNNING";
        setBadge("efashion-import", {
          count: active ? s.processedOrders : 0,
          pulse: active,
        });
        pollTimerRef.current = setTimeout(poll, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
      } catch {
        pollTimerRef.current = setTimeout(poll, POLL_IDLE_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [setBadge]);

  const onStart = useCallback(async () => {
    setStarting(true);
    try {
      const s = await startEfashionHistoricalImport();
      setState(s);
    } finally {
      setStarting(false);
    }
  }, []);

  const onStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopEfashionHistoricalImport();
    } finally {
      setStopping(false);
    }
  }, []);

  const onAck = useCallback(async () => {
    await acknowledgeEfashionHistoricalImport();
    const s = await getEfashionImportStateAction();
    setState(s);
  }, []);

  const events = useMemo<EfashionImportRecentEvent[]>(
    () => (state?.recentEvents ?? []).slice(0, DISPLAYED_EVENTS_MAX),
    [state],
  );

  const running = state?.status === "RUNNING";
  const done = state?.status === "DONE";
  const stopped = state?.status === "STOPPED";
  const errored = state?.status === "ERROR";
  const progressPct = state && state.totalOrders > 0
    ? Math.min(100, Math.round((state.processedOrders / state.totalOrders) * 100))
    : 0;

  const title = (
    <div>
      <div>Import commandes eFashion</div>
      <div className="text-xs font-normal text-white/80 mt-0.5">
        {running
          ? `Page ${state?.currentPage ?? "?"} / ${state?.totalPages ?? "?"} · ${state?.processedOrders ?? 0} / ${state?.totalOrders ?? 0} commandes`
          : done
          ? "Import terminé"
          : stopped
          ? "Import interrompu"
          : errored
          ? "Erreur d'import"
          : "Aucun import en cours"}
      </div>
    </div>
  );

  return (
    <DrawerShell
      open={isOpen}
      onClose={close}
      title={title}
      eyebrow="Import commandes eFashion"
      icon={EFASHION_ICON}
      accent="rose"
      autoScrollFullscreen
      footer={
        <div className="flex items-center gap-2">
          {!running && (
            <button
              type="button"
              onClick={onStart}
              disabled={starting}
              className="rounded-lg bg-slate-900 text-white text-sm px-4 py-2 hover:bg-slate-800 disabled:opacity-50"
            >
              {starting ? "…" : "Lancer l'import historique"}
            </button>
          )}
          {running && (
            <button
              type="button"
              onClick={onStop}
              disabled={stopping}
              className="rounded-lg border border-border bg-white text-sm px-4 py-2 hover:bg-bg-secondary disabled:opacity-50"
            >
              {stopping ? "Arrêt…" : "Interrompre"}
            </button>
          )}
          {(done || stopped || errored) && (
            <button
              type="button"
              onClick={onAck}
              className="rounded-lg border border-border bg-white text-sm px-4 py-2 hover:bg-bg-secondary"
            >
              Effacer
            </button>
          )}
        </div>
      }
    >
      <div className="p-5 space-y-4">
        {state && state.totalOrders > 0 && (
          <div>
            <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pink-500 to-rose-500 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-xs text-text-muted mt-1">
              {progressPct}% · {state.imported} importées · {state.unchanged} déjà à jour ·{" "}
              {state.skipped} ignorées
            </div>
          </div>
        )}

        {running && state && state.currentOrders.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-[0.16em] font-bold text-text-muted mb-2">
              En cours ({state.currentOrders.length})
            </div>
            <ul className="space-y-1">
              {state.currentOrders.map((c) => (
                <li key={c.efashionOrderId} className="text-sm flex items-baseline gap-2">
                  <span className="font-mono text-text-primary">{c.orderNumber}</span>
                  <span className="text-text-muted truncate flex-1">{c.customerName}</span>
                  <span className="text-text-secondary tabular-nums">{formatMoney(c.totalHT)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {events.length > 0 && (
          <details open>
            <summary className="cursor-pointer text-xs uppercase tracking-[0.16em] font-bold text-text-muted mb-2">
              Journal ({events.length})
            </summary>
            <ul className="space-y-1 mt-2 max-h-[300px] overflow-y-auto">
              {events.map((ev) => (
                <li key={eventKey(ev)} className="text-xs flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      ev.result === "imported"
                        ? "bg-emerald-500"
                        : ev.result === "unchanged"
                        ? "bg-slate-400"
                        : "bg-rose-500"
                    }`}
                  />
                  <span className="font-mono text-text-primary">{ev.orderNumber}</span>
                  <span className="text-text-muted truncate flex-1">{ev.customerName}</span>
                  <span className="text-text-muted">{formatRelative(ev.at, now)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {errored && state?.errorMessage && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm">
            {state.errorMessage}
          </div>
        )}
      </div>
    </DrawerShell>
  );
}
