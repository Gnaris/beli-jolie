"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MarketplaceRefreshOptions } from "@/app/actions/admin/marketplace-refresh";
import { useMarketplaceMaintenance } from "@/components/admin/products/MarketplaceMaintenanceContext";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type ActionMode = "refresh" | "update" | "archive";

interface AskInput {
  count: number;
  firstProductName?: string;
  showPfs: boolean;
  showAnkorstore: boolean;
  showEfashion: boolean;
  showFaire: boolean;
  /** Optionnel : IDs des produits sélectionnés. Sert à afficher combien de
   *  produits ont chaque marketplace activée / désactivée. */
  productIds?: string[];
  /** Titre et sous-titre personnalisés (par défaut, "Rafraîchir X produits ?").
   *  Utilisé quand la modale sert à propager une modif de stock/prix. */
  title?: string;
  subtitle?: string;
  /** Libellé du bouton principal (défaut "Confirmer"). */
  confirmLabel?: string;
  /** Libellé de l'eyebrow en haut (défaut "Rafraîchir"). */
  eyebrow?: string;
  /** Affiche la carte "Boutique / Remettre en Nouveauté". Défaut true
   *  (parcours Rafraîchir). Mettre à false pour les flux
   *  propagation de modifs, propagation statut ou synchronisation où
   *  la Nouveauté n'a aucun sens. */
  showBoutique?: boolean;
  /** Pré-coche toutes les marketplaces affichées (showPfs/…/showFaire).
   *  Défaut false. À utiliser pour les propagations et synchronisations où
   *  la cliente veut cocher tout par défaut. */
  defaultAllChecked?: boolean;
  /** Verbe d'action injecté dans « À {actionLabel} » (tuile KPI verte) et
   *  « X à {actionLabel} » (compteur sous chaque carte marketplace). Défaut
   *  « rafraîchir ». À utiliser pour les flux propagation stock/prix/poids
   *  (« mettre à jour »), synchronisation, publication, archivage, etc. */
  actionLabel?: string;
  /** Mode d'action : contrôle la phrase de description sous chaque marketplace.
   *  - "refresh" (défaut) : « Crée une nouvelle fiche … puis supprime l'ancienne ».
   *  - "update" : « Envoie les nouvelles valeurs à la fiche existante ».
   *  - "archive" : « Met la fiche hors ligne ».
   *  Ne touche pas au ticket de shooting eFashion — celui-ci reste piloté par
   *  `showBoutique` (uniquement présent sur le parcours "Rafraîchir"). */
  actionMode?: ActionMode;
}

interface MarketplaceEnabledCounts {
  pfs: { enabled: number; disabled: number };
  ankorstore: { enabled: number; disabled: number };
  efashion: { enabled: number; disabled: number };
  faire: { enabled: number; disabled: number };
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
  descriptions: Record<ActionMode, string>;
  warning?: { title: string; body: string };
}

// Ronds d'initiale marketplace — gradients FIGÉS du CLAUDE.md.
// Initiales : P / A / E / F / B&J (1 lettre pour les MP, sauf Boutique).
const BOUTIQUE: MarketplaceMeta = {
  key: "local",
  label: "Remettre en Nouveauté",
  chipInitials: "B&J",
  chipClass: "",
  barClass: "",
  activeClass: "",
  switchOnClass: "bg-bg-dark",
  hoverBorderClass: "hover:border-border-dark",
  // La boutique n'est proposée que sur le parcours "Rafraîchir"
  // (showBoutique=true). Les autres modes réutilisent le même texte
  // pour rester safe si un futur flux l'affichait.
  descriptions: {
    refresh:
      "Le produit réapparaîtra dans la section « Nouveautés » pendant 30 jours sur votre boutique.",
    update:
      "Le produit réapparaîtra dans la section « Nouveautés » pendant 30 jours sur votre boutique.",
    archive:
      "Le produit réapparaîtra dans la section « Nouveautés » pendant 30 jours sur votre boutique.",
  },
};

const MARKETPLACES: Record<Exclude<MarketplaceKey, "local">, MarketplaceMeta> = {
  pfs: {
    key: "pfs",
    label: "Paris Fashion Shop",
    chipInitials: "P",
    chipClass: "",
    barClass: "",
    activeClass: "",
    switchOnClass: "bg-bg-dark",
    hoverBorderClass: "hover:border-border-dark",
    descriptions: {
      refresh:
        "Crée une nouvelle fiche PFS avec la référence en cours, puis supprime l'ancienne.",
      update:
        "Envoie les nouvelles valeurs à la fiche PFS existante.",
      archive:
        "Met la fiche PFS hors ligne (archivée).",
    },
  },
  ankorstore: {
    key: "ankorstore",
    label: "Ankorstore",
    chipInitials: "A",
    chipClass: "",
    barClass: "",
    activeClass: "",
    switchOnClass: "bg-bg-dark",
    hoverBorderClass: "hover:border-border-dark",
    descriptions: {
      refresh:
        "Crée une nouvelle fiche Ankorstore, puis archive l'ancienne. Traitement en arrière-plan.",
      update:
        "Envoie les nouvelles valeurs à la fiche Ankorstore. Traitement en arrière-plan.",
      archive:
        "Met la fiche Ankorstore hors ligne. Traitement en arrière-plan.",
    },
  },
  efashion: {
    key: "efashion",
    label: "eFashion Paris",
    chipInitials: "E",
    chipClass: "",
    barClass: "",
    activeClass: "",
    switchOnClass: "bg-bg-dark",
    hoverBorderClass: "hover:border-border-dark",
    descriptions: {
      refresh: "Renvoie infos, photos, prix et stock à eFashion.",
      update: "Envoie les nouvelles valeurs à la fiche eFashion existante.",
      archive: "Met la fiche eFashion hors ligne.",
    },
    warning: {
      title: "Ticket de shooting",
      body:
        "Créera un ticket de shooting à valider dans la fenêtre eFashion en bas à droite.",
    },
  },
  faire: {
    key: "faire",
    label: "Faire",
    chipInitials: "F",
    chipClass: "",
    barClass: "",
    activeClass: "",
    switchOnClass: "bg-bg-dark",
    hoverBorderClass: "hover:border-border-dark",
    descriptions: {
      refresh:
        "Crée une nouvelle fiche Faire, puis supprime l'ancienne.",
      update:
        "Envoie les nouvelles valeurs à la fiche Faire existante.",
      archive:
        "Met la fiche Faire hors ligne.",
    },
  },
};

// Style inline pour les ronds d'initiale (gradients CLAUDE.md).
const CHIP_GRADIENT: Record<MarketplaceKey, string> = {
  local:      "linear-gradient(135deg,#64748b,#334155)",
  pfs:        "linear-gradient(135deg,#4f46e5,#6366f1)",
  ankorstore: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
  efashion:   "linear-gradient(135deg,#db2777,#ec4899)",
  faire:      "linear-gradient(135deg,#f59e0b,#fbbf24)",
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
  enabledCount,
  disabledCount,
  totalSelected,
  isRefreshFlow,
  inMaintenance = false,
  actionLabel,
  actionMode,
}: {
  meta: MarketplaceMeta;
  checked: boolean;
  onToggle: (v: boolean) => void;
  enabledCount?: number;
  disabledCount?: number;
  totalSelected?: number;
  /** true seulement sur le parcours "Rafraîchir" (nouvelle fiche eFashion →
   *  ticket de shooting). false sur Propager modifs / Propager statut /
   *  Synchroniser (la fiche existante est réutilisée, pas de shooting). */
  isRefreshFlow?: boolean;
  /** Maintenance plateforme active — coupe l'interaction et affiche un badge dédié. */
  inMaintenance?: boolean;
  /** Verbe pour le compteur « X à {actionLabel} ». Défaut « rafraîchir ». */
  actionLabel: string;
  /** Mode d'action — sélectionne la description à afficher. */
  actionMode: ActionMode;
}) {
  // Maintenance prend priorité sur "désactivé pour toute la sélection".
  const allDisabled =
    inMaintenance ||
    (typeof enabledCount === "number" &&
      typeof totalSelected === "number" &&
      enabledCount === 0 &&
      totalSelected > 0);
  const showCounts =
    typeof enabledCount === "number" &&
    typeof disabledCount === "number" &&
    totalSelected !== undefined &&
    totalSelected > 1;

  return (
    <div
      onClick={() => !allDisabled && onToggle(!checked)}
      className={`relative overflow-hidden rounded-2xl border transition-colors ${
        allDisabled
          ? "border-border-dark bg-bg-secondary cursor-not-allowed opacity-70"
          : checked
            ? "border-border-dark bg-bg-secondary cursor-pointer"
            : "border-border bg-bg-primary hover:border-border-dark cursor-pointer"
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className="flex items-center justify-center w-[42px] h-[42px] rounded-xl text-white font-heading font-bold text-sm shrink-0"
          style={{
            background: CHIP_GRADIENT[meta.key],
            filter: allDisabled ? "grayscale(1) brightness(0.85)" : undefined,
          }}
        >
          {meta.chipInitials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span
                className={`font-semibold text-sm ${
                  allDisabled ? "text-text-muted line-through" : "text-text-primary"
                }`}
              >
                {meta.label}
              </span>
              {allDisabled && (
                inMaintenance ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse" />
                    En maintenance
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)] border border-[#FDE68A]">
                    Désactivée sur toute la sélection
                  </span>
                )
              )}
            </div>
            {!allDisabled && (
              <Switch
                checked={checked}
                onChange={onToggle}
                onColorClass="bg-bg-dark"
              />
            )}
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">{meta.descriptions[actionMode]}</p>

          {/* Compteurs "à rafraîchir / sautés" (mode bulk avec productIds) */}
          {showCounts && !allDisabled && (
            <div className="flex items-center gap-3 mt-2 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1 text-[color:var(--color-success)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-success)]" />
                {enabledCount} à {actionLabel}
              </span>
              {disabledCount! > 0 && (
                <span className="inline-flex items-center gap-1 text-[color:var(--color-warning)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-warning)]" />
                  {disabledCount} sauté(s)
                </span>
              )}
            </div>
          )}

          {/* Ticket de shooting eFashion : uniquement quand on rafraîchit
              (nouvelle fiche créée). Pas de shooting sur propagation/synchro. */}
          {meta.warning && !allDisabled && isRefreshFlow && (
            <div className="inline-flex items-start gap-1.5 mt-2 px-2 py-1 rounded-lg bg-[color:var(--color-warning-bg)] border border-[#FDE68A]">
              <svg
                className="w-3 h-3 text-[color:var(--color-warning)] flex-shrink-0 mt-0.5"
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
              <span className="text-[10px] text-[color:var(--color-warning)] leading-tight">
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
  const showBoutique = input.showBoutique ?? true;
  const defaultAllChecked = input.defaultAllChecked ?? false;
  const maintenance = useMarketplaceMaintenance();
  const [state, setState] = useState<Record<MarketplaceKey, boolean>>({
    // La case "Boutique / Remettre en Nouveauté" ne fait sens que sur le
    // parcours "Rafraîchir" — pas sur les propagations de modifs, statut, ni
    // synchronisation. Donc pas de pré-cochage local, même en defaultAllChecked.
    local: false,
    // Ne pas pré-cocher les marketplaces en maintenance : le job serait refusé.
    pfs: defaultAllChecked && input.showPfs && !maintenance.pfs,
    ankorstore: defaultAllChecked && input.showAnkorstore && !maintenance.ankorstore,
    efashion: defaultAllChecked && input.showEfashion && !maintenance.efashion,
    faire: defaultAllChecked && input.showFaire && !maintenance.faire,
  });
  // Cadence — visible seulement pour count > 1. Défaut : Immédiat.
  const [cadenceMode, setCadenceMode] = useState<"immediate" | "spread">("immediate");
  const [presetMs, setPresetMs] = useState<number | null>(10 * 60_000);
  const [customAmount, setCustomAmount] = useState<number>(10);
  const [customUnit, setCustomUnit] = useState<CadenceUnit>("m");
  // Cadence uniquement sur le parcours "Rafraîchir" (showBoutique=true).
  // Sur propagation stock/prix/poids, propagation statut, synchro et publish
  // depuis la fiche produit, on veut appliquer la modif tout de suite — pas
  // d'étalement possible.
  const showCadence = input.count > 1 && showBoutique;

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

  // ── Compteurs "activés/désactivés" par marketplace pour la sélection ──
  const [counts, setCounts] = useState<MarketplaceEnabledCounts | null>(null);
  useEffect(() => {
    const ids = input.productIds ?? [];
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/marketplace-enabled-counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productIds: ids }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as MarketplaceEnabledCounts;
        if (!cancelled) setCounts(data);
      } catch {
        // silencieux — la modale reste utilisable, juste sans compteurs
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.productIds]);

  const totalIds = input.productIds?.length ?? input.count;
  const totalDisabled = counts
    ? Math.max(
        counts.pfs.disabled,
        counts.ankorstore.disabled,
        counts.efashion.disabled,
        counts.faire.disabled,
      )
    : 0;

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
    input.title ??
    (input.count === 1 ? "Rafraîchir ce produit ?" : `Rafraîchir ${input.count} produits ?`);
  const subtitle =
    input.subtitle ??
    (input.count === 1 && input.firstProductName
      ? `« ${input.firstProductName} » — choisissez où le rafraîchir.`
      : input.count === 1
        ? "Choisissez où le rafraîchir."
        : "Les options s'appliqueront à tous les produits sélectionnés.");
  const eyebrow = input.eyebrow ?? "Rafraîchir";
  const actionLabel = input.actionLabel ?? "rafraîchir";
  const actionMode: ActionMode = input.actionMode ?? "refresh";

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
        className={`relative w-full max-w-2xl bg-bg-primary rounded-3xl shadow-2xl border border-border overflow-hidden transition-all duration-200 ${
          closing ? "opacity-0 scale-95 translate-y-2" : "opacity-100 scale-100 translate-y-0"
        }`}
        style={{ animation: closing ? undefined : "refreshModalSlideUp 0.25s cubic-bezier(0.16,1,0.3,1)" }}
      >
        {/* Header */}
        <div className="px-6 md:px-8 pt-5 pb-5 bg-bg-primary border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div
                className="text-[10.5px] font-bold uppercase text-text-muted mb-2"
                style={{ letterSpacing: "0.2em" }}
              >
                {eyebrow}
              </div>
              <h2 className="font-heading text-xl md:text-2xl font-bold text-text-primary leading-tight">
                {title}
              </h2>
              <p className="text-sm text-text-secondary mt-1">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => resolve(null)}
              className="w-8 h-8 rounded-full hover:bg-bg-secondary flex items-center justify-center text-text-muted hover:text-text-primary transition shrink-0"
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
          {/* KPI : compteurs sélectionnés / à rafraîchir / ignorés (bulk uniquement) */}
          {input.count > 1 && counts && (
            <div className="px-6 md:px-8 pt-5">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-2xl p-3 bg-bg-secondary border border-border">
                  <div
                    className="text-[10px] font-bold uppercase text-text-muted mb-1"
                    style={{ letterSpacing: "0.18em" }}
                  >
                    Sélectionnés
                  </div>
                  <div className="font-heading text-2xl font-bold text-text-primary">
                    {totalIds}
                  </div>
                </div>
                <div className="rounded-2xl p-3 bg-[color:var(--color-success-bg)] border border-[#BBF7D0]">
                  <div
                    className="text-[10px] font-bold uppercase text-[color:var(--color-success)] mb-1"
                    style={{ letterSpacing: "0.18em" }}
                  >
                    À {actionLabel}
                  </div>
                  <div className="font-heading text-2xl font-bold text-[color:var(--color-success)]">
                    {totalIds - totalDisabled}
                  </div>
                </div>
                <div className="rounded-2xl p-3 bg-[color:var(--color-warning-bg)] border border-[#FDE68A]">
                  <div
                    className="text-[10px] font-bold uppercase text-[color:var(--color-warning)] mb-1"
                    style={{ letterSpacing: "0.18em" }}
                  >
                    Ignorés (désactivés)
                  </div>
                  <div className="font-heading text-2xl font-bold text-[color:var(--color-warning)]">
                    {totalDisabled}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section : Boutique — masquée sur les flux propagation/synchro
              (la Nouveauté n'a rien à voir avec une modif stock ou une resync). */}
          {showBoutique && (
            <div className="px-6 md:px-8 pt-5 pb-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1 h-4 rounded-full bg-bg-dark" />
                <span
                  className="text-[10px] font-bold uppercase text-text-muted"
                  style={{ letterSpacing: "0.18em" }}
                >
                  Boutique
                </span>
              </div>
              <MarketplaceCard
                meta={BOUTIQUE}
                checked={state.local}
                onToggle={(v) => setState((prev) => ({ ...prev, local: v }))}
                actionLabel={actionLabel}
                actionMode={actionMode}
              />
            </div>
          )}

          {/* Section : Marketplaces */}
          {activeMarketplaces.length > 0 && (
            <div className="px-6 md:px-8 pt-5 pb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1 h-4 rounded-full bg-bg-dark" />
                <span
                  className="text-[10px] font-bold uppercase text-text-muted"
                  style={{ letterSpacing: "0.18em" }}
                >
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
                    enabledCount={counts ? counts[k].enabled : undefined}
                    disabledCount={counts ? counts[k].disabled : undefined}
                    totalSelected={totalIds}
                    isRefreshFlow={showBoutique}
                    inMaintenance={maintenance[k]}
                    actionLabel={actionLabel}
                    actionMode={actionMode}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Section : Cadence — visible seulement en mode bulk (count > 1).
              Look ardoise pur (validé maquette 2026-07-20) : plus d'indigo. */}
          {showCadence && (
            <div className="px-6 md:px-8 pt-6 pb-6 bg-gradient-to-b from-white to-bg-secondary border-t border-dashed border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1 h-4 rounded-full bg-bg-dark" />
                <span
                  className="text-[10px] font-bold uppercase text-text-muted"
                  style={{ letterSpacing: "0.18em" }}
                >
                  Cadence
                </span>
              </div>
              <p className="text-xs text-text-muted mb-4 mt-2">
                Choisissez un délai entre chaque produit pour étaler l&apos;effet
                «&nbsp;Nouveauté&nbsp;». Le 1<sup>er</sup> part tout de suite, le suivant après
                le délai, etc.
              </p>

              {/* Toggle Immédiat / Étaler */}
              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-bg-secondary border border-border mb-4">
                <button
                  type="button"
                  onClick={() => setCadenceMode("immediate")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs transition-colors ${
                    cadenceMode === "immediate"
                      ? "text-text-inverse bg-bg-dark shadow-sm font-semibold"
                      : "text-text-muted hover:text-text-primary font-medium"
                  }`}
                >
                  Immédiat
                </button>
                <button
                  type="button"
                  onClick={() => setCadenceMode("spread")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs transition-colors ${
                    cadenceMode === "spread"
                      ? "text-text-inverse bg-bg-dark shadow-sm font-semibold"
                      : "text-text-muted hover:text-text-primary font-medium"
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
                              ? "font-semibold bg-bg-dark text-text-inverse border border-bg-dark shadow-sm"
                              : "font-medium bg-bg-primary border border-border text-text-secondary hover:border-border-dark"
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Personnalisé */}
                  <div className="rounded-2xl border border-border bg-bg-primary p-4">
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
                        className="w-24 px-3 py-2 rounded-lg border border-border text-sm font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-bg-dark/30 focus:border-bg-dark"
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
                                  ? "bg-bg-dark text-text-inverse"
                                  : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
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
                    <div className="mt-4 rounded-2xl bg-bg-secondary border border-border p-3.5 flex items-start gap-2.5">
                      <svg
                        className="w-4 h-4 text-text-secondary mt-0.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                      >
                        <circle cx="12" cy="12" r="9" strokeWidth={1.6} />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                      </svg>
                      <div className="text-[11.5px] text-text-primary leading-relaxed">
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
              className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl transition ${
                confirmDisabled
                  ? "bg-bg-tertiary text-text-muted cursor-not-allowed"
                  : "bg-bg-dark text-text-inverse hover:bg-black"
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
              {input.confirmLabel ?? (intervalMs > 0 ? "Planifier" : "Rafraîchir")}
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
