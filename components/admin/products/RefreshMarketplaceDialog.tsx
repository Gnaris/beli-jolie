"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MarketplaceRefreshOptions } from "@/app/actions/admin/marketplace-refresh";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface AskInput {
  count: number;
  firstProductName?: string;
  showPfs: boolean;
  showAnkorstore: boolean;
  showEfashion: boolean;
  showFaire: boolean;
}

interface ContextValue {
  ask: (input: AskInput) => Promise<MarketplaceRefreshOptions | null>;
}

const RefreshMarketplaceContext = createContext<ContextValue | null>(null);

export function useRefreshMarketplacePrompt(): ContextValue {
  const ctx = useContext(RefreshMarketplaceContext);
  if (!ctx) {
    throw new Error("useRefreshMarketplacePrompt must be used within <RefreshMarketplacePromptProvider>");
  }
  return ctx;
}

// ─────────────────────────────────────────────
// Marketplace metadata
// ─────────────────────────────────────────────

type MarketplaceKey = "local" | "pfs" | "ankorstore" | "efashion" | "faire";

interface MarketplaceMeta {
  key: MarketplaceKey;
  label: string;
  chipInitials: string;
  chipClass: string;
  barClass: string;
  activeClass: string;
  switchOnClass: string;
  hoverBorderClass: string;
  description: string;
  warning?: { title: string; body: string };
}

const BOUTIQUE: MarketplaceMeta = {
  key: "local",
  label: "Remettre en Nouveauté",
  chipInitials: "B&J",
  chipClass: "bg-gradient-to-br from-slate-400 to-slate-600",
  barClass: "bg-gradient-to-r from-slate-400 to-slate-600",
  activeClass: "bg-gradient-to-br from-slate-500/[0.08] via-white to-white",
  switchOnClass: "bg-slate-600",
  hoverBorderClass: "hover:border-slate-300",
  description:
    "Le produit réapparaîtra dans la section « Nouveautés » pendant 30 jours sur votre boutique.",
};

const MARKETPLACES: Record<Exclude<MarketplaceKey, "local">, MarketplaceMeta> = {
  pfs: {
    key: "pfs",
    label: "Paris Fashion Shop",
    chipInitials: "PFS",
    chipClass: "bg-gradient-to-br from-violet-400 to-violet-600",
    barClass: "bg-gradient-to-r from-violet-400 to-violet-600",
    activeClass: "bg-gradient-to-br from-violet-500/[0.06] via-white to-white",
    switchOnClass: "bg-violet-600",
    hoverBorderClass: "hover:border-violet-200",
    description:
      "Crée une nouvelle fiche PFS avec la référence en cours, puis supprime l'ancienne.",
  },
  ankorstore: {
    key: "ankorstore",
    label: "Ankorstore",
    chipInitials: "AKR",
    chipClass: "bg-gradient-to-br from-emerald-400 to-emerald-600",
    barClass: "bg-gradient-to-r from-emerald-400 to-emerald-600",
    activeClass: "bg-gradient-to-br from-emerald-500/[0.08] via-white to-white",
    switchOnClass: "bg-emerald-600",
    hoverBorderClass: "hover:border-emerald-200",
    description:
      "Crée une nouvelle fiche Ankorstore, puis archive l'ancienne. Traitement en arrière-plan.",
  },
  efashion: {
    key: "efashion",
    label: "eFashion Paris",
    chipInitials: "eF",
    chipClass: "bg-gradient-to-br from-amber-400 to-amber-600",
    barClass: "bg-gradient-to-r from-amber-400 to-amber-600",
    activeClass: "bg-gradient-to-br from-amber-500/[0.08] via-white to-white",
    switchOnClass: "bg-amber-600",
    hoverBorderClass: "hover:border-amber-200",
    description: "Renvoie infos, photos, prix et stock à eFashion.",
    warning: {
      title: "Ticket de shooting",
      body:
        "Créera un ticket de shooting à valider dans la fenêtre eFashion en bas à droite.",
    },
  },
  faire: {
    key: "faire",
    label: "Faire",
    chipInitials: "Fai",
    chipClass: "bg-gradient-to-br from-rose-400 to-rose-600",
    barClass: "bg-gradient-to-r from-rose-400 to-rose-600",
    activeClass: "bg-gradient-to-br from-rose-500/[0.08] via-white to-white",
    switchOnClass: "bg-rose-600",
    hoverBorderClass: "hover:border-rose-200",
    description:
      "Crée une nouvelle fiche Faire, puis supprime l'ancienne.",
  },
};

// ─────────────────────────────────────────────
// Switch component (inline, on/off)
// ─────────────────────────────────────────────

function Switch({
  checked,
  onChange,
  onColorClass,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  onColorClass: string;
}) {
  return (
    <span
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex items-center h-[22px] w-[40px] rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
        checked ? onColorClass : "bg-border-dark"
      }`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
          checked ? "translate-x-[21px]" : "translate-x-[3px]"
        }`}
      />
    </span>
  );
}

// ─────────────────────────────────────────────
// Marketplace card
// ─────────────────────────────────────────────

function MarketplaceCard({
  meta,
  checked,
  onToggle,
}: {
  meta: MarketplaceMeta;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div
      onClick={() => onToggle(!checked)}
      className={`relative overflow-hidden rounded-2xl border border-border cursor-pointer transition-all ${
        meta.hoverBorderClass
      } ${checked ? meta.activeClass : "bg-white"}`}
    >
      {/* Top colored bar */}
      <div className={`absolute inset-x-0 top-0 h-[3px] ${meta.barClass}`} />

      <div className="flex items-start gap-3 p-4">
        <div
          className={`flex items-center justify-center w-[42px] h-[42px] rounded-xl text-white font-heading font-bold text-xs shrink-0 ${meta.chipClass}`}
        >
          {meta.chipInitials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="font-semibold text-text-primary text-sm">{meta.label}</span>
            <Switch checked={checked} onChange={onToggle} onColorClass={meta.switchOnClass} />
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">{meta.description}</p>
          {meta.warning && (
            <div className="inline-flex items-start gap-1.5 mt-2 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200">
              <svg
                className="w-3 h-3 text-amber-700 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span className="text-[10px] text-amber-900 leading-tight">
                Créera un <span className="font-semibold">ticket de shooting</span> à valider dans la fenêtre eFashion en bas à droite.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────

interface ModalProps {
  input: AskInput;
  onResult: (options: MarketplaceRefreshOptions | null) => void;
}

function Modal({ input, onResult }: ModalProps) {
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const mouseDownOnBackdrop = useRef(false);
  const [state, setState] = useState<Record<MarketplaceKey, boolean>>({
    local: false,
    pfs: false,
    ankorstore: false,
    efashion: false,
    faire: false,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const resolve = useCallback(
    (options: MarketplaceRefreshOptions | null) => {
      setClosing(true);
      setTimeout(() => onResult(options), 200);
    },
    [onResult],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") resolve(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [resolve]);

  const activeMarketplaces: Array<Exclude<MarketplaceKey, "local">> = [];
  if (input.showPfs) activeMarketplaces.push("pfs");
  if (input.showAnkorstore) activeMarketplaces.push("ankorstore");
  if (input.showEfashion) activeMarketplaces.push("efashion");
  if (input.showFaire) activeMarketplaces.push("faire");

  const selectedCount =
    Number(state.local) +
    Number(state.pfs) +
    Number(state.ankorstore) +
    Number(state.efashion) +
    Number(state.faire);

  const confirmDisabled = selectedCount === 0;

  const title =
    input.count === 1 ? "Rafraîchir ce produit ?" : `Rafraîchir ${input.count} produits ?`;
  const subtitle =
    input.count === 1 && input.firstProductName
      ? `« ${input.firstProductName} » — choisissez où le rafraîchir.`
      : input.count === 1
        ? "Choisissez où le rafraîchir."
        : "Les options s'appliqueront à tous les produits sélectionnés.";

  function handleConfirm() {
    if (confirmDisabled) return;
    resolve({
      local: state.local,
      pfs: state.pfs,
      ankorstore: state.ankorstore,
      efashion: state.efashion,
      faire: state.faire,
    });
  }

  if (!mounted) return null;

  const modal = (
    <div
      ref={backdropRef}
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === backdropRef.current;
      }}
      onMouseUp={(e) => {
        if (e.target === backdropRef.current && mouseDownOnBackdrop.current) resolve(null);
        mouseDownOnBackdrop.current = false;
      }}
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 transition-all duration-200 ${
        closing ? "bg-black/0 backdrop-blur-0" : "bg-black/40 backdrop-blur-[3px]"
      }`}
      style={{ animation: closing ? undefined : "refreshModalFadeIn 0.2s ease-out" }}
    >
      <div
        className={`relative w-full max-w-xl bg-bg-primary rounded-3xl shadow-2xl border border-border overflow-hidden transition-all duration-200 ${
          closing ? "opacity-0 scale-95 translate-y-2" : "opacity-100 scale-100 translate-y-0"
        }`}
        style={{ animation: closing ? undefined : "refreshModalSlideUp 0.25s cubic-bezier(0.16,1,0.3,1)" }}
      >
        {/* Header */}
        <div className="px-6 md:px-8 pt-5 pb-5 bg-gradient-to-b from-bg-secondary to-bg-primary border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-2 pl-2 pr-3 py-1 rounded-full bg-slate-100 border border-slate-200 mb-3">
                <span className="w-2 h-2 rounded-full bg-slate-500" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-700">
                  Rafraîchir
                </span>
              </div>
              <h2 className="font-heading text-xl md:text-2xl font-bold text-text-primary leading-tight">
                {title}
              </h2>
              <p className="text-sm text-text-muted mt-1">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => resolve(null)}
              className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-text-muted hover:text-text-primary transition shrink-0"
              aria-label="Fermer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto" style={{ maxHeight: "60vh" }}>
          {/* Section : Boutique */}
          <div className="px-6 md:px-8 pt-5 pb-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1 h-4 rounded-full bg-slate-500" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-700">
                Boutique
              </span>
            </div>
            <MarketplaceCard
              meta={BOUTIQUE}
              checked={state.local}
              onToggle={(v) => setState((prev) => ({ ...prev, local: v }))}
            />
          </div>

          {/* Section : Marketplaces */}
          {activeMarketplaces.length > 0 && (
            <div className="px-6 md:px-8 pt-5 pb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1 h-4 rounded-full bg-slate-500" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-700">
                  Marketplaces
                </span>
              </div>
              <div className="space-y-2.5">
                {activeMarketplaces.map((k) => (
                  <MarketplaceCard
                    key={k}
                    meta={MARKETPLACES[k]}
                    checked={state[k]}
                    onToggle={(v) => setState((prev) => ({ ...prev, [k]: v }))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-bg-primary px-6 md:px-8 py-4 flex items-center justify-between gap-3">
          <div className="text-xs text-text-muted">
            {selectedCount === 0 ? (
              "Aucune destination sélectionnée"
            ) : (
              <>
                <span className="font-semibold text-text-primary">
                  {selectedCount} destination{selectedCount > 1 ? "s" : ""}
                </span>{" "}
                sélectionnée{selectedCount > 1 ? "s" : ""}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => resolve(null)}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition rounded-lg"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmDisabled}
              title={confirmDisabled ? "Activez au moins une destination" : undefined}
              className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white rounded-xl shadow-sm transition ${
                confirmDisabled
                  ? "bg-slate-300 cursor-not-allowed"
                  : "bg-gradient-to-r from-slate-600 to-slate-800 hover:from-slate-700 hover:to-slate-900"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Rafraîchir
            </button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes refreshModalFadeIn {
          from {
            background-color: rgba(0, 0, 0, 0);
          }
          to {
            background-color: rgba(0, 0, 0, 0.4);
          }
        }
        @keyframes refreshModalSlideUp {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );

  return createPortal(modal, document.body);
}

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

export function RefreshMarketplacePromptProvider({ children }: { children: React.ReactNode }) {
  const idRef = useRef(0);
  const [current, setCurrent] = useState<{
    id: number;
    input: AskInput;
    resolve: (v: MarketplaceRefreshOptions | null) => void;
  } | null>(null);

  const ask = useCallback((input: AskInput): Promise<MarketplaceRefreshOptions | null> => {
    return new Promise((resolve) => {
      const id = ++idRef.current;
      setCurrent({ id, input, resolve });
    });
  }, []);

  function handleResult(options: MarketplaceRefreshOptions | null) {
    current?.resolve(options);
    setCurrent(null);
  }

  return (
    <RefreshMarketplaceContext.Provider value={{ ask }}>
      {children}
      {current && <Modal key={current.id} input={current.input} onResult={handleResult} />}
    </RefreshMarketplaceContext.Provider>
  );
}
