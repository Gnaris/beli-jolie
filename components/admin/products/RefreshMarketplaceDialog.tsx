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

// Raccourcis proposés dans la section Cadence. Ordre = affichage.
const CADENCE_PRESETS: Array<{ label: string; ms: number }> = [
  { label: "1 min", ms: 60_000 },
  { label: "5 min", ms: 5 * 60_000 },
  { label: "10 min", ms: 10 * 60_000 },
  { label: "20 min", ms: 20 * 60_000 },
  { label: "30 min", ms: 30 * 60_000 },
  { label: "1 h", ms: 60 * 60_000 },
];

type CadenceUnit = "s" | "m" | "h";

function unitToMs(unit: CadenceUnit): number {
  if (unit === "s") return 1_000;
  if (unit === "h") return 60 * 60_000;
  return 60_000;
}

function formatDurationHuman(ms: number): string {
  if (ms < 60_000) {
    const s = Math.round(ms / 1000);
    return `${s} s`;
  }
  if (ms < 60 * 60_000) {
    const min = Math.round(ms / 60_000);
    return `${min} min`;
  }
  const h = Math.floor(ms / (60 * 60_000));
  const remainMin = Math.round((ms - h * 60 * 60_000) / 60_000);
  if (remainMin === 0) return `${h} h`;
  return `${h} h ${String(remainMin).padStart(2, "0")}`;
}

function formatEndTime(endsAt: Date): string {
  const now = new Date();
  const sameDay =
    endsAt.getFullYear() === now.getFullYear() &&
    endsAt.getMonth() === now.getMonth() &&
    endsAt.getDate() === now.getDate();
  const hh = String(endsAt.getHours()).padStart(2, "0");
  const mm = String(endsAt.getMinutes()).padStart(2, "0");
  if (sameDay) return `aujourd'hui vers ${hh}:${mm}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (
    endsAt.getFullYear() === tomorrow.getFullYear() &&
    endsAt.getMonth() === tomorrow.getMonth() &&
    endsAt.getDate() === tomorrow.getDate()
  ) {
    return `demain vers ${hh}:${mm}`;
  }
  const d = String(endsAt.getDate()).padStart(2, "0");
  const m = String(endsAt.getMonth() + 1).padStart(2, "0");
  return `le ${d}/${m} vers ${hh}:${mm}`;
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
  // Cadence — visible seulement pour count > 1. Défaut : Immédiat.
  const [cadenceMode, setCadenceMode] = useState<"immediate" | "spread">("immediate");
  const [presetMs, setPresetMs] = useState<number | null>(10 * 60_000);
  const [customAmount, setCustomAmount] = useState<number>(10);
  const [customUnit, setCustomUnit] = useState<CadenceUnit>("m");
  const showCadence = input.count > 1;

  // Interval final choisi. 0 = pas d'étalement.
  const intervalMs =
    showCadence && cadenceMode === "spread"
      ? presetMs !== null
        ? presetMs
        : Math.max(1, Math.round(customAmount)) * unitToMs(customUnit)
      : 0;

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
      intervalMs: intervalMs > 0 ? intervalMs : undefined,
    });
  }

  // Résumé de la cadence : dernier départ, fin estimée.
  const cadenceSummary = (() => {
    if (!showCadence || cadenceMode !== "spread" || intervalMs <= 0) return null;
    const lastStartMs = (input.count - 1) * intervalMs;
    // Estimation grossière : on ajoute 2 min pour le dernier produit (durée moyenne d'un refresh).
    const endsAt = new Date(Date.now() + lastStartMs + 2 * 60_000);
    return { lastStartMs, endText: formatEndTime(endsAt) };
  })();

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

          {/* Section : Cadence — visible seulement en mode bulk (count > 1) */}
          {showCadence && (
            <div className="px-6 md:px-8 pt-6 pb-6 bg-gradient-to-b from-white to-slate-50/60 border-t border-dashed border-border">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <span className="w-1 h-4 rounded-full bg-indigo-500" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-700">
                    Cadence
                  </span>
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                  Nouveau
                </span>
              </div>
              <p className="text-xs text-text-muted mb-4">
                Choisissez un délai entre chaque produit pour étaler l&apos;effet
                «&nbsp;Nouveauté&nbsp;». Le 1<sup>er</sup> part tout de suite, le suivant après
                le délai, etc.
              </p>

              {/* Toggle Immédiat / Étaler */}
              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200 mb-4">
                <button
                  type="button"
                  onClick={() => setCadenceMode("immediate")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    cadenceMode === "immediate"
                      ? "text-white bg-gradient-to-r from-slate-600 to-slate-800 shadow-sm font-semibold"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Immédiat
                </button>
                <button
                  type="button"
                  onClick={() => setCadenceMode("spread")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    cadenceMode === "spread"
                      ? "text-white bg-gradient-to-r from-indigo-500 to-indigo-600 shadow-sm font-semibold"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Étaler
                </button>
              </div>

              {cadenceMode === "spread" && (
                <>
                  {/* Raccourcis */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {CADENCE_PRESETS.map((p) => {
                      const active = presetMs === p.ms;
                      return (
                        <button
                          key={p.ms}
                          type="button"
                          onClick={() => setPresetMs(p.ms)}
                          className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
                            active
                              ? "font-semibold bg-indigo-600 text-white border border-indigo-600 shadow-sm"
                              : "font-medium bg-white border border-slate-200 text-slate-700 hover:border-indigo-300"
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Personnalisé */}
                  <div className="rounded-2xl border border-border bg-white p-4">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div>
                        <div className="text-xs font-semibold text-text-primary">Personnalisé</div>
                        <div className="text-[11px] text-text-muted">
                          Ajustez au chiffre près.
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={customAmount}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v >= 1) {
                            setCustomAmount(Math.floor(v));
                            setPresetMs(null); // sortie du preset actif
                          }
                        }}
                        className="w-24 px-3 py-2 rounded-lg border border-border text-sm font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                      <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                        {(["s", "m", "h"] as CadenceUnit[]).map((u) => {
                          const active = customUnit === u && presetMs === null;
                          const label = u === "s" ? "Secondes" : u === "m" ? "Minutes" : "Heures";
                          return (
                            <button
                              key={u}
                              type="button"
                              onClick={() => {
                                setCustomUnit(u);
                                setPresetMs(null);
                              }}
                              className={`px-3 py-2 border-r border-border last:border-r-0 transition-colors ${
                                active
                                  ? "bg-indigo-50 text-indigo-700"
                                  : "bg-white text-text-secondary hover:bg-bg-secondary"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Résumé */}
                  {cadenceSummary && (
                    <div className="mt-4 rounded-2xl bg-indigo-50/70 border border-indigo-100 p-3.5 flex items-start gap-2.5">
                      <svg
                        className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                      >
                        <circle cx="12" cy="12" r="9" strokeWidth={1.6} />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                      </svg>
                      <div className="text-[11.5px] text-indigo-900 leading-relaxed">
                        1 produit toutes les{" "}
                        <span className="font-semibold">{formatDurationHuman(intervalMs)}</span>.
                        Le dernier partira dans{" "}
                        <span className="font-semibold">
                          {formatDurationHuman(cadenceSummary.lastStartMs)}
                        </span>
                        . Fin estimée&nbsp;:{" "}
                        <span className="font-semibold">{cadenceSummary.endText}</span>.
                      </div>
                    </div>
                  )}
                </>
              )}
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
              {intervalMs > 0 ? "Planifier" : "Rafraîchir"}
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
