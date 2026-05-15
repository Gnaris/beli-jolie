"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RecentlyRefreshedProduct } from "@/app/actions/admin/marketplace-refresh";

export type WarningChoice = "cancel" | "skip_recent" | "force_all";

interface AskInput {
  totalSelected: number;
  thresholdDays: number;
  recentItems: RecentlyRefreshedProduct[];
}

interface ContextValue {
  ask: (input: AskInput) => Promise<WarningChoice>;
}

const RefreshWarningContext = createContext<ContextValue | null>(null);

export function useRefreshWarning(): ContextValue {
  const ctx = useContext(RefreshWarningContext);
  if (!ctx) {
    throw new Error("useRefreshWarning must be used within <RefreshWarningProvider>");
  }
  return ctx;
}

function daysAgoLabel(days: number): string {
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "il y a 1 jour";
  return `il y a ${days} jours`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

interface ModalProps {
  input: AskInput;
  onResult: (choice: WarningChoice) => void;
}

function WarningModal({ input, onResult }: ModalProps) {
  const { totalSelected, thresholdDays, recentItems } = input;
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => { setMounted(true); }, []);

  const resolve = useCallback((choice: WarningChoice) => {
    setClosing(true);
    setTimeout(() => onResult(choice), 200);
  }, [onResult]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") resolve("cancel");
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [resolve]);

  const recentCount = recentItems.length;
  const remainingCount = totalSelected - recentCount;
  const skipDisabled = remainingCount <= 0;

  if (!mounted) return null;

  const modal = (
    <div
      ref={backdropRef}
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === backdropRef.current; }}
      onMouseUp={(e) => {
        if (e.target === backdropRef.current && mouseDownOnBackdrop.current) resolve("cancel");
        mouseDownOnBackdrop.current = false;
      }}
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 transition-all duration-200 ${
        closing ? "bg-black/0 backdrop-blur-0" : "bg-black/30 backdrop-blur-[3px]"
      }`}
      style={{ animation: closing ? undefined : "confirmFadeIn 0.2s ease-out" }}
    >
      <div
        className={`bg-bg-primary rounded-2xl shadow-xl border border-border w-full max-w-xl overflow-hidden transition-all duration-200 ${
          closing ? "opacity-0 scale-95 translate-y-2" : "opacity-100 scale-100 translate-y-0"
        }`}
        style={{ animation: closing ? undefined : "confirmSlideUp 0.25s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-amber-50">
              <svg className="w-5 h-5" fill="none" stroke="#F59E0B" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v2m0 4h.01M12 3l9.66 16.5H2.34L12 3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <h3 className="font-heading text-[15px] font-semibold text-text-primary leading-tight">
                {recentCount === 1
                  ? "1 produit a déjà été rafraîchi récemment"
                  : `${recentCount} produits ont déjà été rafraîchis récemment`}
              </h3>
              <p className="text-sm font-body text-text-secondary mt-1.5 leading-relaxed">
                Seuil configuré : moins de {thresholdDays} jour{thresholdDays > 1 ? "s" : ""}.
                {totalSelected > recentCount && remainingCount > 0 && (
                  <> Les autres ({remainingCount}) ne sont pas concernés.</>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="mx-6 mb-4 rounded-xl bg-bg-secondary border border-border overflow-hidden">
          <div className="max-h-64 overflow-y-auto divide-y divide-border">
            {recentItems.map((p) => (
              <div key={p.productId} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-body text-text-primary truncate font-medium">
                    {p.productName}
                  </p>
                  <p className="text-[11px] font-body text-text-muted truncate">
                    Réf. {p.reference}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[12px] font-body text-text-secondary">
                    {daysAgoLabel(p.daysAgo)}
                  </p>
                  <p className="text-[10px] font-body text-text-muted">
                    {formatDate(p.lastRefreshedAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="h-px bg-border mx-6" />

        <div className="px-6 py-4 flex flex-col sm:flex-row items-stretch gap-2.5">
          <button
            type="button"
            onClick={() => resolve("cancel")}
            className="sm:flex-1 inline-flex items-center justify-center whitespace-nowrap px-4 py-2.5 text-[13px] font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-lg hover:bg-bg-secondary hover:text-text-primary transition-all duration-150 active:scale-[0.98]"
          >
            Tout annuler
          </button>
          <button
            type="button"
            onClick={() => { if (!skipDisabled) resolve("skip_recent"); }}
            disabled={skipDisabled}
            title={skipDisabled ? "Aucun autre produit à rafraîchir" : undefined}
            className={`sm:flex-1 inline-flex items-center justify-center whitespace-nowrap px-4 py-2.5 text-[13px] font-medium font-body rounded-lg border transition-all duration-150 active:scale-[0.98] ${
              skipDisabled
                ? "text-text-muted border-border bg-bg-secondary opacity-50 cursor-not-allowed"
                : "text-text-secondary border-border bg-bg-secondary hover:bg-[#E5E5E5] hover:text-text-primary"
            }`}
          >
            {skipDisabled
              ? "Ignorer les récents"
              : `Ignorer les récents (${remainingCount})`}
          </button>
          <button
            type="button"
            onClick={() => resolve("force_all")}
            autoFocus
            className="sm:flex-1 inline-flex items-center justify-center whitespace-nowrap px-4 py-2.5 text-[13px] font-semibold font-body rounded-lg border border-transparent transition-all duration-150 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-1 bg-amber-500 hover:bg-amber-600 text-white focus:ring-amber-500/30"
          >
            Tout rafraîchir quand même
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export function RefreshWarningProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<{ input: AskInput; resolve: (choice: WarningChoice) => void } | null>(null);

  const ask = useCallback((input: AskInput): Promise<WarningChoice> => {
    return new Promise<WarningChoice>((resolve) => {
      setCurrent({ input, resolve });
    });
  }, []);

  function handleResult(choice: WarningChoice) {
    current?.resolve(choice);
    setCurrent(null);
  }

  return (
    <RefreshWarningContext.Provider value={{ ask }}>
      {children}
      {current && <WarningModal input={current.input} onResult={handleResult} />}
    </RefreshWarningContext.Provider>
  );
}
