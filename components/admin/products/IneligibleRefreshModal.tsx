"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IneligibilityReason } from "@/lib/refresh-eligibility";
import { labelForIneligibility } from "@/lib/refresh-eligibility";

export type IneligibleChoice = "cancel" | "skip_ineligible";

export interface IneligibleItem {
  productId: string;
  reference: string;
  productName: string;
  firstImage?: string | null;
  reason: IneligibilityReason;
}

interface AskInput {
  totalSelected: number;
  ineligibleItems: IneligibleItem[];
}

interface ContextValue {
  ask: (input: AskInput) => Promise<IneligibleChoice>;
}

const IneligibleRefreshContext = createContext<ContextValue | null>(null);

export function useIneligibleRefresh(): ContextValue {
  const ctx = useContext(IneligibleRefreshContext);
  if (!ctx) {
    throw new Error("useIneligibleRefresh must be used within <IneligibleRefreshProvider>");
  }
  return ctx;
}

interface ModalProps {
  input: AskInput;
  onResult: (choice: IneligibleChoice) => void;
}

function IneligibleModal({ input, onResult }: ModalProps) {
  const { totalSelected, ineligibleItems } = input;
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => { setMounted(true); }, []);

  const resolve = useCallback((choice: IneligibleChoice) => {
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

  const ineligibleCount = ineligibleItems.length;
  const remainingCount = totalSelected - ineligibleCount;
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
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-red-50">
              <svg className="w-5 h-5" fill="none" stroke="#DC2626" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <h3 className="font-heading text-[15px] font-semibold text-text-primary leading-tight">
                {ineligibleCount === 1
                  ? "1 produit ne peut pas être rafraîchi"
                  : `${ineligibleCount} produits ne peuvent pas être rafraîchis`}
              </h3>
              <p className="text-sm font-body text-text-secondary mt-1.5 leading-relaxed">
                Seuls les produits En ligne et complets peuvent être rafraîchis.
                {remainingCount > 0 && (
                  <> Les autres ({remainingCount}) ne sont pas concernés.</>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="mx-6 mb-4 rounded-xl bg-bg-secondary border border-border overflow-hidden">
          <div className="max-h-64 overflow-y-auto divide-y divide-border">
            {ineligibleItems.map((p) => (
              <div key={p.productId} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {p.firstImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.firstImage}
                      alt=""
                      className="w-8 h-8 rounded-md object-cover bg-bg-primary border border-border shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-[13px] font-body text-text-primary truncate font-medium">
                      {p.productName}
                    </p>
                    <p className="text-[11px] font-body text-text-muted truncate">
                      Réf. {p.reference}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-body font-medium text-red-600 bg-red-50 border border-red-100 rounded-full px-2.5 py-1 shrink-0">
                  {labelForIneligibility(p.reason)}
                </span>
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
            onClick={() => { if (!skipDisabled) resolve("skip_ineligible"); }}
            disabled={skipDisabled}
            autoFocus={!skipDisabled}
            title={skipDisabled ? "Aucun autre produit à rafraîchir" : undefined}
            className={`sm:flex-1 inline-flex items-center justify-center whitespace-nowrap px-4 py-2.5 text-[13px] font-semibold font-body rounded-lg border transition-all duration-150 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-1 ${
              skipDisabled
                ? "text-text-muted border-border bg-bg-secondary opacity-50 cursor-not-allowed"
                : "bg-[#6366F1] hover:bg-[#4F46E5] text-white border-transparent focus:ring-[#6366F1]/30"
            }`}
          >
            {skipDisabled
              ? "Ignorer les non éligibles"
              : `Ignorer et continuer (${remainingCount})`}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export function IneligibleRefreshProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<{ input: AskInput; resolve: (choice: IneligibleChoice) => void } | null>(null);

  const ask = useCallback((input: AskInput): Promise<IneligibleChoice> => {
    return new Promise<IneligibleChoice>((resolve) => {
      setCurrent({ input, resolve });
    });
  }, []);

  function handleResult(choice: IneligibleChoice) {
    current?.resolve(choice);
    setCurrent(null);
  }

  return (
    <IneligibleRefreshContext.Provider value={{ ask }}>
      {children}
      {current && <IneligibleModal input={current.input} onResult={handleResult} />}
    </IneligibleRefreshContext.Provider>
  );
}
