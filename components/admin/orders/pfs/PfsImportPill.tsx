"use client";

/**
 * Pill flottant affichant la progression de l'import historique PFS.
 * Monté globalement dans le layout admin. Se cache automatiquement quand
 * aucun import n'est actif, puis reste visible quelques secondes après
 * DONE / ERROR pour laisser le temps de le voir.
 */

import { useEffect, useRef, useState } from "react";
import {
  acknowledgePfsHistoricalImport,
  getPfsImportStateAction,
  stopPfsHistoricalImport,
  type PfsImportState,
} from "@/app/actions/admin/pfs-orders";

const POLL_MS = 3000;
const AUTO_HIDE_AFTER_DONE_MS = 15_000;

export default function PfsImportPill() {
  const [state, setState] = useState<PfsImportState | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getPfsImportStateAction();
        if (cancelled) return;
        setState(s);
        if (s.status === "RUNNING") {
          setTimeout(tick, POLL_MS);
        } else if (s.status === "DONE" || s.status === "ERROR" || s.status === "STOPPED") {
          if (hideTimer.current) clearTimeout(hideTimer.current);
          hideTimer.current = setTimeout(() => {
            void acknowledgePfsHistoricalImport().catch(() => {});
            setState(null);
          }, AUTO_HIDE_AFTER_DONE_MS);
        } else {
          setTimeout(tick, POLL_MS * 3);
        }
      } catch {
        setTimeout(tick, POLL_MS * 3);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!state || state.status === "IDLE") return null;

  const isRunning = state.status === "RUNNING";
  const isDone = state.status === "DONE";
  const isError = state.status === "ERROR";
  const isStopped = state.status === "STOPPED";
  const percent =
    state.totalOrders > 0
      ? Math.min(100, Math.round((state.processedOrders / state.totalOrders) * 100))
      : 0;

  return (
    <div
      className="fixed bottom-4 right-24 md:bottom-6 md:right-28 z-[9002] w-72 max-w-[calc(100vw-6rem)] rounded-2xl bg-white border border-slate-200 shadow-2xl"
      role="status"
    >
      <div className="flex items-start gap-3 p-3">
        <div
          className="w-9 h-9 rounded-md text-white font-heading font-bold text-sm flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg,#4f46e5,#6366f1)" }}
        >
          P
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500 font-medium">
              Import PFS
            </div>
            {isRunning && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </div>
          <div className="text-sm font-semibold text-slate-900 mt-0.5">
            {isRunning && `${state.processedOrders} / ${state.totalOrders} commandes`}
            {isDone && `Import terminé — ${state.processedOrders} importées`}
            {isError && "Import interrompu par une erreur"}
            {isStopped && `Import annulé — ${state.processedOrders} déjà importées`}
          </div>
          {isRunning && (
            <>
              <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${percent}%`,
                    background: "linear-gradient(90deg,#4f46e5,#6366f1)",
                  }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                <span>{percent} % · page {state.currentPage}/{state.totalPages}</span>
                <button
                  type="button"
                  onClick={() => void stopPfsHistoricalImport()}
                  className="text-slate-600 hover:text-slate-900 hover:underline"
                >
                  Annuler
                </button>
              </div>
            </>
          )}
          {isError && state.errorMessage && (
            <div className="mt-1 text-[11px] text-rose-600 truncate">{state.errorMessage}</div>
          )}
          {(isDone || isError || isStopped) && (
            <button
              type="button"
              onClick={() => {
                void acknowledgePfsHistoricalImport();
                setState(null);
              }}
              className="mt-2 text-[11px] text-slate-600 hover:text-slate-900 hover:underline"
            >
              Fermer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
