"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import type { MarketplaceId, MarketplaceSyncProgress } from "@/lib/product-events";
import { subscribeSSE } from "@/lib/shared-sse";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface MarketplaceState {
  marketplace: MarketplaceId;
  step: string;
  progress: number;
  status: "pending" | "in_progress" | "success" | "error";
  error?: string;
}

interface MarketplaceSyncContextValue {
  /** Start watching sync for one or more products. Call after save. */
  startSync: (productIds: string | string[], marketplaces: MarketplaceId[]) => void;
  /** Product IDs currently being synced */
  syncingProductIds: Set<string>;
}

const MarketplaceSyncContext = createContext<MarketplaceSyncContextValue | null>(null);

export function useMarketplaceSync(): MarketplaceSyncContextValue {
  const ctx = useContext(MarketplaceSyncContext);
  if (!ctx) throw new Error("useMarketplaceSync must be used within <MarketplaceSyncProvider>");
  return ctx;
}

// ─────────────────────────────────────────────
// Marketplace metadata
// ─────────────────────────────────────────────

const MARKETPLACE_META: Record<MarketplaceId, { label: string; icon: string; gradient: string; accentColor: string }> = {
  pfs: {
    label: "Paris Fashion Shop",
    icon: "P",
    gradient: "from-violet-500 to-purple-600",
    accentColor: "#8B5CF6",
  },
  ankorstore: {
    label: "Ankorstore",
    icon: "A",
    gradient: "from-emerald-500 to-teal-600",
    accentColor: "#10B981",
  },
};

// ─────────────────────────────────────────────
// Animated check / error icons
// ─────────────────────────────────────────────

function SuccessIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <circle cx="12" cy="12" r="11" fill="#22C55E" opacity="0.15" />
      <path
        d="M7.5 12.5L10.5 15.5L16.5 9.5"
        stroke="#22C55E"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ animation: "checkDraw 0.4s ease-out forwards" }}
        strokeDasharray="20"
        strokeDashoffset="20"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <circle cx="12" cy="12" r="11" fill="#EF4444" opacity="0.15" />
      <path d="M9 9L15 15M15 9L9 15" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SpinnerIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0 animate-spin">
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2.5" opacity="0.2" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PendingIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0" opacity="0.4">
      <circle cx="12" cy="12" r="10" stroke="#9CA3AF" strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="2" fill="#9CA3AF" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Single marketplace card
// ─────────────────────────────────────────────

function MarketplaceCard({ state }: { state: MarketplaceState }) {
  const meta = MARKETPLACE_META[state.marketplace];
  const isActive = state.status === "in_progress";
  const isDone = state.status === "success";
  const isError = state.status === "error";

  return (
    <div
      className={`
        relative overflow-hidden rounded-xl border transition-all duration-500
        ${isActive ? "border-border-dark shadow-md" : "border-border shadow-sm"}
        ${isDone ? "bg-emerald-50/50" : isError ? "bg-red-50/50" : "bg-bg-primary"}
      `}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <div
          className={`
            flex items-center justify-center w-9 h-9 rounded-lg text-white text-sm font-bold
            bg-gradient-to-br ${meta.gradient}
            ${isActive ? "animate-pulse" : ""}
          `}
        >
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-text-primary">{meta.label}</span>
            {isDone && <SuccessIcon />}
            {isError && <ErrorIcon />}
            {isActive && <SpinnerIcon color={meta.accentColor} />}
            {state.status === "pending" && <PendingIcon />}
          </div>
          <p className={`text-xs mt-0.5 truncate ${isError ? "text-red-600" : "text-text-secondary"}`}>
            {state.step}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 pb-4 pt-1">
        <div className="relative h-2 rounded-full bg-bg-tertiary overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${state.progress}%`,
              background: isError
                ? "#EF4444"
                : isDone
                  ? "#22C55E"
                  : `linear-gradient(90deg, ${meta.accentColor}, ${meta.accentColor}dd)`,
            }}
          />
          {/* Shimmer effect when active */}
          {isActive && (
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${state.progress}%`,
                background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)",
                animation: "shimmer 1.5s ease-in-out infinite",
              }}
            />
          )}
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[11px] text-text-tertiary">
            {isDone ? "Terminé" : isError ? "Erreur" : "En cours..."}
          </span>
          <span className="text-[11px] font-medium text-text-secondary">
            {state.progress}%
          </span>
        </div>
      </div>

      {/* Error details */}
      {isError && state.error && (
        <div className="mx-4 mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
          <p className="text-xs text-red-700 leading-relaxed break-words">{state.error}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Aggregate helpers (multi-product)
// ─────────────────────────────────────────────

interface PerProductState {
  status: "pending" | "in_progress" | "success" | "error";
  progress: number;
  step: string;
  error?: string;
}

function computeAggregate(
  marketplace: MarketplaceId,
  perProduct: Map<string, Map<MarketplaceId, PerProductState>>,
  total: number,
): MarketplaceState {
  let sumProgress = 0;
  let inProgress = 0, success = 0, errors = 0;
  let lastStep = "En attente...";
  let lastError: string | undefined;

  for (const [, mkStates] of perProduct) {
    const s = mkStates.get(marketplace);
    if (!s) continue;
    sumProgress += s.progress;
    if (s.status === "success") success++;
    else if (s.status === "error") { errors++; lastError = s.error; }
    else if (s.status === "in_progress") { inProgress++; lastStep = s.step; }
  }

  const avgProgress = total > 0 ? Math.round(sumProgress / total) : 0;
  const allDone = success + errors === total;

  let status: MarketplaceState["status"];
  if (allDone) status = errors > 0 ? "error" : "success";
  else if (inProgress > 0 || success > 0) status = "in_progress";
  else status = "pending";

  let step: string;
  if (total === 1) {
    // Single product — show actual step from server
    const firstEntry = perProduct.values().next().value;
    const s = firstEntry?.get(marketplace);
    step = s?.step ?? lastStep;
  } else {
    if (allDone) {
      step = errors > 0
        ? `${success}/${total} réussi(s), ${errors} erreur(s)`
        : `${total} produit${total > 1 ? "s" : ""} synchronisé${total > 1 ? "s" : ""}`;
    } else {
      step = `${success + errors}/${total} produit${total > 1 ? "s" : ""}...`;
    }
  }

  return { marketplace, step, progress: avgProgress, status, error: lastError };
}

// ─────────────────────────────────────────────
// Mini widget (bottom-right, visible only on syncing product page)
// ─────────────────────────────────────────────

function MiniSyncWidget({
  states,
  syncingProductIds,
  onExpand,
  onDismiss,
}: {
  states: Map<MarketplaceId, MarketplaceState>;
  syncingProductIds: Set<string>;
  onExpand: () => void;
  onDismiss: () => void;
}) {
  const pathname = usePathname();
  const [widgetFadeIn, setWidgetFadeIn] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setWidgetFadeIn(true));
  }, []);

  // Only show on the product page being synced
  // URL pattern: /admin/produits/{id}/modifier
  const isOnSyncingProductPage = (() => {
    if (syncingProductIds.size === 0) return false;
    const match = pathname.match(/\/admin\/produits\/([^/]+)\/modifier/);
    if (match) return syncingProductIds.has(match[1]);
    // Also show on /admin/produits (list page) for bulk syncs
    if (pathname === "/admin/produits" && syncingProductIds.size > 1) return true;
    return false;
  })();

  if (!isOnSyncingProductPage) return null;

  const allDone = Array.from(states.values()).every(
    (s) => s.status === "success" || s.status === "error"
  );
  const hasError = Array.from(states.values()).some((s) => s.status === "error");
  const allSuccess = allDone && !hasError;

  // Compute overall progress
  const totalProgress = states.size > 0
    ? Math.round(Array.from(states.values()).reduce((sum, s) => sum + s.progress, 0) / states.size)
    : 0;

  return (
    <div
      className={`
        fixed bottom-4 right-4 z-[9998] transition-all duration-300
        ${widgetFadeIn ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}
      `}
    >
      <div
        className={`
          bg-bg-primary rounded-xl border shadow-lg overflow-hidden cursor-pointer
          hover:shadow-xl transition-shadow duration-200
          ${allSuccess ? "border-emerald-300" : hasError ? "border-red-300" : "border-border-dark"}
        `}
        style={{ width: 280 }}
        onClick={onExpand}
      >
        {/* Compact header */}
        <div className="flex items-center gap-2.5 px-3.5 py-2.5">
          {allSuccess ? (
            <SuccessIcon />
          ) : hasError ? (
            <ErrorIcon />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 animate-spin" style={{ animationDuration: "2s" }}>
              <circle cx="12" cy="12" r="10" stroke="var(--color-accent)" strokeWidth="2.5" opacity="0.2" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-text-primary truncate">
              {allSuccess
                ? "Synchronisation terminée"
                : hasError
                  ? "Erreurs de synchronisation"
                  : "Synchronisation en cours..."}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {Array.from(states.values()).map((s) => {
                const meta = MARKETPLACE_META[s.marketplace];
                return (
                  <span
                    key={s.marketplace}
                    className={`
                      inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full
                      ${s.status === "success" ? "bg-emerald-100 text-emerald-700"
                        : s.status === "error" ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-600"}
                    `}
                  >
                    {meta.icon}
                    {s.status === "success" ? "✓" : s.status === "error" ? "✗" : `${s.progress}%`}
                  </span>
                );
              })}
            </div>
          </div>
          {allDone ? (
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              className="p-1 rounded-lg hover:bg-bg-tertiary transition-colors"
              title="Fermer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onExpand(); }}
              className="p-1 rounded-lg hover:bg-bg-tertiary transition-colors"
              title="Agrandir"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* Mini progress bar (only when not done) */}
        {!allDone && (
          <div className="h-1 bg-bg-tertiary">
            <div
              className="h-full transition-all duration-700 ease-out"
              style={{
                width: `${totalProgress}%`,
                background: "linear-gradient(90deg, var(--color-accent), var(--color-accent-dark, var(--color-accent)))",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

export function MarketplaceSyncProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [states, setStates] = useState<Map<MarketplaceId, MarketplaceState>>(new Map());
  const [sessionId, setSessionId] = useState(0);
  const [syncingProductIds, setSyncingProductIds] = useState<Set<string>>(new Set());
  const sseUnsubRef = useRef<(() => void) | null>(null);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Multi-product tracking
  const trackedIdsRef = useRef<Set<string>>(new Set());
  const trackedMarketplacesRef = useRef<MarketplaceId[]>([]);
  const perProductRef = useRef<Map<string, Map<MarketplaceId, PerProductState>>>(new Map());

  useEffect(() => { setMounted(true); }, []);

  // SSE listener via shared connection — subscribes/unsubscribes on session change
  useEffect(() => {
    if (sessionId === 0) return;

    const unsubscribe = subscribeSSE((data) => {
      const event = data as { type?: string; productId?: string; marketplaceSync?: MarketplaceSyncProgress };
      if (event.type !== "MARKETPLACE_SYNC") return;
      if (!event.productId || !trackedIdsRef.current.has(event.productId)) return;

      const sync = event.marketplaceSync;
      if (!sync) return;

      // Update per-product state
      const pp = perProductRef.current;
      let mkMap = pp.get(event.productId);
      if (!mkMap) {
        mkMap = new Map();
        pp.set(event.productId, mkMap);
      }
      mkMap.set(sync.marketplace, {
        status: sync.status,
        progress: sync.progress,
        step: sync.step,
        error: sync.error,
      });

      // Recompute aggregate for all tracked marketplaces
      const total = trackedIdsRef.current.size;
      const newStates = new Map<MarketplaceId, MarketplaceState>();
      for (const m of trackedMarketplacesRef.current) {
        newStates.set(m, computeAggregate(m, pp, total));
      }
      setStates(newStates);
    });
    sseUnsubRef.current = unsubscribe;

    return () => {
      unsubscribe();
      sseUnsubRef.current = null;
    };
  }, [sessionId]);

  function dismiss() {
    setFadeIn(false);
    setMinimized(false);
    setTimeout(() => {
      setVisible(false);
      setStates(new Map());
      setSyncingProductIds(new Set());
      trackedIdsRef.current = new Set();
      trackedMarketplacesRef.current = [];
      perProductRef.current = new Map();
      // Unsubscribe from shared SSE (closes connection if no other subscribers)
      if (sseUnsubRef.current) {
        sseUnsubRef.current();
        sseUnsubRef.current = null;
      }
      setSessionId(0);
    }, 300);
  }

  // Auto-dismiss when all marketplaces are done (success or error)
  useEffect(() => {
    if (states.size === 0 || !visible) return;

    const allDone = Array.from(states.values()).every(
      (s) => s.status === "success" || s.status === "error"
    );
    const hasError = Array.from(states.values()).some((s) => s.status === "error");

    if (allDone && !minimized) {
      // If no errors, auto-dismiss after 2.5s. If errors, stay open.
      if (!hasError) {
        autoDismissTimerRef.current = setTimeout(() => {
          dismiss();
        }, 2500);
      }
    }

    // When minimized and all done with no errors, auto-dismiss widget after 5s
    if (allDone && minimized && !hasError) {
      autoDismissTimerRef.current = setTimeout(() => {
        dismiss();
      }, 5000);
    }

    return () => {
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current);
        autoDismissTimerRef.current = null;
      }
    };
  }, [states, visible, minimized]);

  function minimize() {
    // Cancel auto-dismiss timer if any
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
    setFadeIn(false);
    setTimeout(() => {
      setMinimized(true);
    }, 300);
  }

  function expand() {
    setMinimized(false);
    requestAnimationFrame(() => setFadeIn(true));
  }

  const startSync = useCallback((productIdOrIds: string | string[], marketplaces: MarketplaceId[]) => {
    const ids = Array.isArray(productIdOrIds) ? productIdOrIds : [productIdOrIds];

    // Setup tracking
    trackedIdsRef.current = new Set(ids);
    trackedMarketplacesRef.current = marketplaces;
    setSyncingProductIds(new Set(ids));

    // Init per-product state
    const pp = new Map<string, Map<MarketplaceId, PerProductState>>();
    for (const id of ids) {
      const mkMap = new Map<MarketplaceId, PerProductState>();
      for (const m of marketplaces) {
        mkMap.set(m, { status: "pending", progress: 0, step: "En attente..." });
      }
      pp.set(id, mkMap);
    }
    perProductRef.current = pp;

    // Init display states
    const initial = new Map<MarketplaceId, MarketplaceState>();
    for (const m of marketplaces) {
      initial.set(m, { marketplace: m, step: "En attente...", progress: 0, status: "pending" });
    }
    setStates(initial);
    setVisible(true);
    setMinimized(false);
    setSessionId((prev) => prev + 1);
    requestAnimationFrame(() => setFadeIn(true));
  }, []);

  const allDone = states.size > 0 && Array.from(states.values()).every(
    (s) => s.status === "success" || s.status === "error"
  );
  const allSuccess = allDone && Array.from(states.values()).every((s) => s.status === "success");
  const hasError = Array.from(states.values()).some((s) => s.status === "error");
  const activeCount = Array.from(states.values()).filter((s) => s.status === "in_progress").length;

  const ctx: MarketplaceSyncContextValue = { startSync, syncingProductIds };

  return (
    <MarketplaceSyncContext.Provider value={ctx}>
      {children}

      {/* Full overlay (when not minimized) */}
      {mounted && visible && !minimized && createPortal(
        <div
          className={`fixed inset-0 z-[9999] flex items-center justify-center transition-all duration-300 ${
            fadeIn
              ? "bg-black/35 backdrop-blur-[3px] opacity-100"
              : "bg-black/0 backdrop-blur-0 opacity-0"
          }`}
          style={{ pointerEvents: fadeIn ? "auto" : "none" }}
        >
          <div
            className={`
              w-full max-w-md mx-4 bg-bg-primary rounded-2xl shadow-xl border border-border
              transition-all duration-300
              ${fadeIn ? "scale-100 translate-y-0 opacity-100" : "scale-95 translate-y-4 opacity-0"}
            `}
          >
            {/* Header */}
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent-light">
                  {allSuccess ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M7.5 12.5L10.5 15.5L16.5 9.5" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : hasError ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M12 9v4m0 3h.01" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" />
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="animate-spin" style={{ animationDuration: "2s" }}>
                      <circle cx="12" cy="12" r="10" stroke="var(--color-accent)" strokeWidth="2" opacity="0.2" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-text-primary font-heading">
                    {allSuccess
                      ? "Synchronisation terminée"
                      : hasError
                        ? "Synchronisation avec erreurs"
                        : "Synchronisation en cours"}
                  </h3>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {allDone
                      ? allSuccess
                        ? "Tous les marketplaces ont été synchronisés avec succès."
                        : "Certains marketplaces ont rencontré des erreurs."
                      : `${activeCount} marketplace(s) en cours de synchronisation...`}
                  </p>
                </div>
              </div>
            </div>

            {/* Marketplace cards */}
            <div className="px-6 pb-2 flex flex-col gap-3">
              {Array.from(states.values()).map((s) => (
                <MarketplaceCard key={s.marketplace} state={s} />
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 pb-6 pt-3">
              {allDone ? (
                <button
                  onClick={dismiss}
                  className={`
                    w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                    ${hasError
                      ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                      : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                    }
                  `}
                >
                  {hasError ? "Fermer" : "OK"}
                </button>
              ) : (
                <button
                  onClick={minimize}
                  className="w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-200 bg-bg-secondary text-text-secondary hover:bg-bg-tertiary border border-border flex items-center justify-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" />
                  </svg>
                  Mettre en arrière-plan
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Mini widget (when minimized) */}
      {mounted && visible && minimized && createPortal(
        <MiniSyncWidget
          states={states}
          syncingProductIds={syncingProductIds}
          onExpand={expand}
          onDismiss={dismiss}
        />,
        document.body
      )}

      {/* Keyframes */}
      <style jsx global>{`
        @keyframes checkDraw {
          to { stroke-dashoffset: 0; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </MarketplaceSyncContext.Provider>
  );
}
