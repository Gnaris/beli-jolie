"use client";

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { getImageSrc } from "@/lib/image-utils";
import {
  useMarketplaceRefreshQueue,
  type MarketplaceRefreshItem,
  type MarketplaceTarget,
  type TargetOutcome,
} from "@/components/admin/products/MarketplaceRefreshContext";
import {
  groupItemsByProduct,
  sortGroups,
  groupHasActive,
  groupHasError,
  groupAllDone,
  groupMatchesFilter,
  getMarketplaceOutcome,
  getLocalOutcomeForGroup,
  getGroupScheduledFor,
  getGroupErrors,
  type ProductGroup,
  type StatusFilter,
} from "@/components/admin/products/marketplaceRefreshGroup";

// ── Métadonnées par marketplace : couleurs + libellés ─────────────────
// Palette compacte pour le nouveau design (pastilles + points colorés).
const MARKETPLACE_META: Record<
  MarketplaceTarget,
  {
    label: string;
    short: string;
    dotBg: string; // point coloré dans la timeline (fond)
    pillBg: string; // fond de pastille en carte hero (translucide sur dégradé)
    pillText: string;
    pillDot: string;
    solidBg: string; // pastille pleine dans les rangées standards
    solidText: string;
    solidBorder: string;
  }
> = {
  pfs: {
    label: "Paris Fashion Shop",
    short: "PFS",
    dotBg: "bg-violet-500",
    pillBg: "bg-white/15",
    pillText: "text-white",
    pillDot: "bg-violet-300",
    solidBg: "bg-violet-50",
    solidText: "text-violet-700",
    solidBorder: "border-violet-200",
  },
  ankorstore: {
    label: "Ankorstore",
    short: "AKR",
    dotBg: "bg-emerald-500",
    pillBg: "bg-white/15",
    pillText: "text-white",
    pillDot: "bg-emerald-300",
    solidBg: "bg-emerald-50",
    solidText: "text-emerald-700",
    solidBorder: "border-emerald-200",
  },
  efashion: {
    label: "eFashion",
    short: "eF",
    dotBg: "bg-amber-500",
    pillBg: "bg-white/15",
    pillText: "text-white",
    pillDot: "bg-amber-300",
    solidBg: "bg-amber-50",
    solidText: "text-amber-700",
    solidBorder: "border-amber-200",
  },
  faire: {
    label: "Faire",
    short: "Fai",
    dotBg: "bg-rose-500",
    pillBg: "bg-white/15",
    pillText: "text-white",
    pillDot: "bg-rose-300",
    solidBg: "bg-rose-50",
    solidText: "text-rose-700",
    solidBorder: "border-rose-200",
  },
  orderchamp: {
    label: "Orderchamp",
    short: "OC",
    dotBg: "bg-orange-500",
    pillBg: "bg-white/15",
    pillText: "text-white",
    pillDot: "bg-orange-300",
    solidBg: "bg-orange-50",
    solidText: "text-orange-700",
    solidBorder: "border-orange-200",
  },
};

function getActionVerb(mode: MarketplaceRefreshItem["mode"]): string {
  if (mode === "publish") return "Publication";
  if (mode === "resync") return "Resynchronisation";
  return "Rafraîchissement";
}

// Résout le libellé long d'une marketplace pour l'affichage du tooltip.
type ErrorWithLabel = { marketplace: MarketplaceTarget; label: string; message: string };
function withLabels(
  errors: ReturnType<typeof getGroupErrors>,
): ErrorWithLabel[] {
  return errors.map((e) => ({
    marketplace: e.marketplace,
    label: MARKETPLACE_META[e.marketplace].label,
    message: e.message,
  }));
}

// ── Hook : tick chaque seconde pour rafraîchir les comptes à rebours ──
// N'est activé que quand des items planifiés sont en attente. Décorrélé du
// polling serveur (qui reste à 2s).
function useCountdownTick(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return tick;
}

// ── Formatage temps ────────────────────────────────────────────────────
function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "à l'instant";
  const totalSeconds = Math.round(msRemaining / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    if (minutes < 10 && seconds > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  if (remainMin === 0) return `${hours} h`;
  return `${hours} h ${String(remainMin).padStart(2, "0")}`;
}

function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatEndClock(date: Date): string {
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return formatClock(date);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  ) {
    return `demain ${formatClock(date)}`;
  }
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${d}/${m} ${formatClock(date)}`;
}

// ── Tooltip d'erreur en portail ──────────────────────────────────────
// Utilisé pour montrer le message complet au survol d'une pastille en erreur.
function ErrorTooltipPortal({
  anchorRect,
  title,
  message,
  onMouseEnter,
  onMouseLeave,
}: {
  anchorRect: DOMRect;
  title: string;
  message: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (typeof document === "undefined") return null;

  const margin = 8;
  const width = 320;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = anchorRect.left + anchorRect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

  const preferAbove = anchorRect.top > 180;
  const style: React.CSSProperties = preferAbove
    ? { position: "fixed", left, bottom: viewportHeight - anchorRect.top + 6, width, zIndex: 9999 }
    : { position: "fixed", left, top: anchorRect.bottom + 6, width, zIndex: 9999 };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return createPortal(
    <div
      role="tooltip"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="p-2.5 bg-red-700 text-white text-[11px] font-body leading-snug rounded-lg shadow-xl whitespace-pre-line break-words max-h-[60vh] overflow-y-auto select-text"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="block font-semibold">{title}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-white text-[10px] font-medium transition-colors"
          title="Copier le message d'erreur"
          aria-label="Copier le message d'erreur"
        >
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
      <div className="select-text cursor-text">{message}</div>
    </div>,
    document.body,
  );
}

// ── Tooltip d'erreurs pour toute une ligne produit ────────────────────
// Affiche la liste des marketplaces en échec avec leur message respectif.
function RowErrorsTooltipPortal({
  anchorRect,
  reference,
  errors,
  onMouseEnter,
  onMouseLeave,
}: {
  anchorRect: DOMRect;
  reference: string;
  errors: ErrorWithLabel[];
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (typeof document === "undefined") return null;

  const margin = 8;
  const width = 340;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = anchorRect.left + anchorRect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

  const preferAbove = anchorRect.top > 300;
  const style: React.CSSProperties = preferAbove
    ? { position: "fixed", left, bottom: viewportHeight - anchorRect.top + 6, width, zIndex: 9999 }
    : { position: "fixed", left, top: anchorRect.bottom + 6, width, zIndex: 9999 };

  const handleCopy = async () => {
    try {
      const text = errors.map((e) => `${e.label}: ${e.message}`).join("\n\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  const heading =
    errors.length === 1
      ? `Échec sur ${errors[0].label}`
      : `${errors.length} échecs sur ${reference}`;

  return createPortal(
    <div
      role="tooltip"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="p-3 bg-red-700 text-white text-[11px] font-body leading-snug rounded-lg shadow-xl max-h-[60vh] overflow-y-auto select-text"
    >
      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-white/20">
        <span className="font-semibold text-[12px]">{heading}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-white text-[10px] font-medium transition-colors"
          title="Copier les messages d'erreur"
          aria-label="Copier les messages d'erreur"
        >
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
      <div className="space-y-2.5">
        {errors.map((e) => (
          <div key={e.marketplace}>
            {errors.length > 1 && (
              <div className="text-[10px] uppercase tracking-wider font-semibold text-red-100 mb-0.5">
                {e.label}
              </div>
            )}
            <div className="whitespace-pre-line break-words select-text cursor-text">
              {e.message}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ── Pastille marketplace compact (points colorés) ─────────────────────
// Utilisée dans les rangées de la timeline. Le tooltip d'erreur détaillé
// est géré au niveau de la ligne produit (RowErrorsTooltipPortal), pas ici.
function CompactMarketplaceDot({
  item,
  onDim,
}: {
  item: MarketplaceRefreshItem;
  onDim?: boolean;
}) {
  const meta = MARKETPLACE_META[item.marketplace];
  const outcome = getMarketplaceOutcome(item);
  const isErr = outcome && !outcome.ok;

  return (
    <span className={`relative inline-flex ${onDim ? "opacity-60" : ""}`}>
      <span
        className={`w-2 h-2 rounded-full ${meta.dotBg} ${
          isErr ? "ring-2 ring-red-300" : ""
        }`}
        title={meta.label}
      />
    </span>
  );
}

// ── Pastille marketplace dans le hero (fond translucide sur dégradé) ──
function HeroMarketplacePill({ item }: { item: MarketplaceRefreshItem }) {
  const meta = MARKETPLACE_META[item.marketplace];
  const outcome = getMarketplaceOutcome(item);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isErr = outcome && !outcome.ok;
  const errorMsg = isErr ? outcome.message || "Erreur non renseignée" : null;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setAnchorRect(null), 200);
  };
  const openTooltip = () => {
    if (!errorMsg || !anchorRef.current) return;
    cancelClose();
    setAnchorRect(anchorRef.current.getBoundingClientRect());
  };

  let statusIcon: ReactNode = null;
  if (item.status === "in_progress") {
    statusIcon = (
      <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 9h5V4M3 20v-5h5m-5 0l3.2 3.2a8.25 8.25 0 0013.8-3.7M4 10a8.25 8.25 0 0113.8-3.7L21 9.5" />
      </svg>
    );
  } else if (item.status === "awaiting_callback") {
    statusIcon = (
      <svg className="w-3 h-3 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2" />
      </svg>
    );
  } else if (outcome?.ok) {
    statusIcon = (
      <svg className="w-3 h-3 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  } else if (outcome && !outcome.ok) {
    statusIcon = (
      <svg className="w-3 h-3 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }

  return (
    <span
      ref={anchorRef}
      onMouseEnter={openTooltip}
      onMouseLeave={scheduleClose}
      className={`inline-flex items-center gap-1.5 pl-2 pr-2 py-0.5 rounded-md backdrop-blur text-[10px] font-semibold border ${
        isErr ? "border-red-300/70 ring-1 ring-red-200/50 cursor-help" : "border-white/25"
      } ${meta.pillBg} ${meta.pillText}`}
      title={isErr ? undefined : meta.label}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.pillDot}`} />
      {meta.short}
      {statusIcon}
      {errorMsg && anchorRect && (
        <ErrorTooltipPortal
          anchorRect={anchorRect}
          title={`Échec sur ${meta.label}`}
          message={errorMsg}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />
      )}
    </span>
  );
}

// ── Chip d'outcome local (bump Nouveauté) ─────────────────────────────
function OutcomeChip({ label, outcome }: { label: string; outcome: TargetOutcome }) {
  const ok = outcome.ok;
  const archived = ok && outcome.archived;
  const cls = ok
    ? archived
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-emerald-50 text-emerald-700 border-emerald-200"
    : outcome.kind === "not_found"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-red-50 text-red-700 border-red-200";
  const dot = ok
    ? archived
      ? "bg-amber-500"
      : "bg-emerald-500"
    : outcome.kind === "not_found"
      ? "bg-amber-500"
      : "bg-red-500";
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${cls}`}
      title={ok ? (archived ? "Archivé (rupture de stock)" : "Terminé") : outcome.message}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
      {archived ? " · archivé" : ""}
    </span>
  );
}

// ── Filtres (segmented tabs) ─────────────────────────────────────────
const FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "in_progress", label: "Suivants" },
  { key: "success", label: "Terminés" },
  { key: "error", label: "Erreurs" },
];

// ═══════════════════════════════════════════════════════════════════════
// Widget principal
// ═══════════════════════════════════════════════════════════════════════
export function MarketplaceRefreshWidget() {
  const { items, clear, stop, isAllFinished, queuedCount } = useMarketplaceRefreshQueue();
  const [minimized, setMinimized] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");

  // Groupes + tri
  const groups = useMemo(() => groupItemsByProduct(items), [items]);
  const sortedGroups = useMemo(() => sortGroups(groups), [groups]);
  const visibleGroups = useMemo(
    () => sortedGroups.filter((g) => groupMatchesFilter(g, filter)),
    [sortedGroups, filter],
  );

  // Compteurs par onglet
  const counts = useMemo(() => {
    let in_progress = 0;
    let success = 0;
    let error = 0;
    for (const g of groups) {
      if (groupMatchesFilter(g, "in_progress")) in_progress += 1;
      if (groupMatchesFilter(g, "success")) success += 1;
      if (groupMatchesFilter(g, "error")) error += 1;
    }
    return { all: groups.length, in_progress, success, error };
  }, [groups]);

  // Hero = 1er groupe actif (in_progress > awaiting_callback), sinon 1er queued.
  const heroGroup = useMemo<ProductGroup | null>(() => {
    const active = sortedGroups.find((g) => groupHasActive(g));
    if (active) return active;
    const queued = sortedGroups.find(
      (g) => g.items.some((it) => it.status === "queued") && !groupAllDone(g),
    );
    return queued ?? null;
  }, [sortedGroups]);

  // Ouverture auto quand un nouveau cycle démarre (1 seul item queued).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (items.length === 1 && items[0].status === "queued") {
      setMinimized(false);
    }
  }, [items.length]);

  // Estimation de fin : max(scheduledFor) parmi les queued, + ~2min de traitement.
  const endEstimate = useMemo<Date | null>(() => {
    let latest = 0;
    for (const g of groups) {
      const s = getGroupScheduledFor(g);
      if (s) {
        const ms = s.getTime();
        if (ms > latest) latest = ms;
      }
    }
    if (latest === 0) return null;
    return new Date(latest + 2 * 60_000);
  }, [groups]);

  // Cadence détectée : intervalle entre les deux premiers scheduledFor.
  const detectedCadenceMs = useMemo<number | null>(() => {
    const scheds: number[] = [];
    for (const g of groups) {
      const s = getGroupScheduledFor(g);
      if (s) scheds.push(s.getTime());
    }
    if (scheds.length < 2) return null;
    scheds.sort((a, b) => a - b);
    const diff = scheds[1] - scheds[0];
    if (diff <= 0) return null;
    return diff;
  }, [groups]);

  // Progression : done / total
  const totalGroups = groups.length;
  const doneGroups = groups.filter((g) => groupAllDone(g));
  const doneCount = doneGroups.length;
  const errorsCount = doneGroups.filter(groupHasError).length;
  const progressPct = totalGroups > 0 ? Math.round((doneCount / totalGroups) * 100) : 0;

  // Tick 1s pour rafraîchir les comptes à rebours.
  const hasScheduled = groups.some((g) => (getGroupScheduledFor(g)?.getTime() ?? 0) > Date.now());
  useCountdownTick(hasScheduled);

  if (items.length === 0) return null;

  // Position : décalée pour ne pas chevaucher le chat admin (bottom-4 right-4).
  // Sur mobile, on colle au bord avec un peu de marge, largeur pleine.
  const containerPos = "fixed bottom-4 right-4 md:right-24 z-[9000]";

  // ─── Mode réduit (pill) ─────────────────────────────────────────────
  if (minimized) {
    return (
      <div className={`${containerPos} animate-fadeIn`} style={{ maxWidth: "calc(100vw - 2rem)" }}>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className={`flex items-center gap-2.5 rounded-full pl-2 pr-4 py-2 shadow-lg hover:shadow-xl transition-all font-body ${
            !isAllFinished
              ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white"
              : errorsCount > 0
                ? "bg-bg-primary border border-red-200 text-text-primary"
                : "bg-bg-primary border border-emerald-200 text-text-primary"
          }`}
          title="Ouvrir le suivi"
        >
          {!isAllFinished ? (
            <span className="relative w-7 h-7">
              <svg className="w-7 h-7 -rotate-90" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={4} />
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  fill="none"
                  stroke="white"
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeDasharray={100.5}
                  strokeDashoffset={100.5 - (progressPct / 100) * 100.5}
                />
              </svg>
            </span>
          ) : errorsCount > 0 ? (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-700">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01" />
                <circle cx="12" cy="12" r="9" strokeWidth={1.8} />
              </svg>
            </span>
          ) : (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
          )}
          <span className="text-[13px] font-semibold tabular-nums">
            {!isAllFinished
              ? heroGroup && (getGroupScheduledFor(heroGroup)?.getTime() ?? 0) > Date.now()
                ? `Prochain dans ${formatCountdown(getGroupScheduledFor(heroGroup)!.getTime() - Date.now())}`
                : `${doneCount}/${totalGroups} traités`
              : `${doneCount}/${totalGroups} traités`}
          </span>
          {isAllFinished && errorsCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold tabular-nums">
              {errorsCount} erreur{errorsCount > 1 ? "s" : ""}
            </span>
          )}
        </button>
      </div>
    );
  }

  // ─── Mode déplié ────────────────────────────────────────────────────
  const heroItems = heroGroup ? heroGroup.items : [];
  const heroSortedItems = [...heroItems].sort((a, b) => {
    const order: Record<MarketplaceTarget, number> = { pfs: 0, ankorstore: 1, efashion: 2, faire: 3, orderchamp: 4 };
    return order[a.marketplace] - order[b.marketplace];
  });
  const heroMode = heroItems[0]?.mode ?? "refresh";
  const isHeroScheduled =
    heroGroup !== null &&
    !groupHasActive(heroGroup) &&
    (getGroupScheduledFor(heroGroup)?.getTime() ?? 0) > Date.now();

  return (
    <div
      className={`${containerPos} animate-fadeIn`}
      style={{ maxWidth: "calc(100vw - 2rem)" }}
      role="region"
      aria-label="Synchronisation marketplaces"
    >
      <div className="bg-bg-primary border border-border rounded-3xl shadow-2xl w-[380px] sm:w-[440px] max-w-full overflow-hidden flex flex-col">

        {/* ═══ HERO ═══ */}
        {heroGroup && !isAllFinished ? (
          <div className="relative px-5 pt-5 pb-4 bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 text-white overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -bottom-16 -left-10 w-40 h-40 rounded-full bg-fuchsia-300/20 blur-2xl" />

            <div className="relative flex items-start gap-3">
              {/* Anneau progression */}
              <div className="relative w-14 h-14 shrink-0">
                <svg className="w-14 h-14 -rotate-90" viewBox="0 0 40 40">
                  <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={3} />
                  <circle
                    cx="20"
                    cy="20"
                    r="17"
                    fill="none"
                    stroke="white"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeDasharray={106.8}
                    strokeDashoffset={106.8 - (progressPct / 100) * 106.8}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[12px] font-bold tabular-nums">
                    {doneCount}/{totalGroups}
                  </span>
                </div>
              </div>

              {/* Titre + réf */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  {isHeroScheduled ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
                      <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-indigo-100">
                        Prochain
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                      <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-indigo-100">
                        {getActionVerb(heroMode)}
                      </span>
                    </>
                  )}
                </div>
                <Link
                  href={`/admin/produits/${heroGroup.productId}/modifier`}
                  className="text-[13px] font-mono font-bold hover:underline"
                >
                  {heroGroup.reference}
                </Link>
                <p className="text-[12px] text-indigo-100 truncate mt-0.5">{heroGroup.productName}</p>
              </div>

              {/* Actions header */}
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  className="p-1.5 text-white/80 hover:text-white hover:bg-white/15 rounded-lg transition-colors"
                  title="Réduire"
                  aria-label="Réduire"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14H5" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Pastilles marketplaces + statuts */}
            <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
              {heroSortedItems.map((it) => (
                <HeroMarketplacePill key={it.id} item={it} />
              ))}
            </div>

            {/* Compte à rebours si planifié, ou meta ligne */}
            <div className="relative mt-3 flex items-center justify-between gap-2 text-[11px] text-indigo-100">
              {isHeroScheduled ? (
                <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur px-2 py-1 rounded-md">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                  </svg>
                  <span className="text-white font-semibold">
                    Dans{" "}
                    <span className="tabular-nums">
                      {formatCountdown(getGroupScheduledFor(heroGroup)!.getTime() - Date.now())}
                    </span>
                  </span>
                </div>
              ) : detectedCadenceMs ? (
                <div className="inline-flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>
                    Un produit toutes les{" "}
                    <span className="text-white font-semibold">{formatCountdown(detectedCadenceMs)}</span>
                  </span>
                </div>
              ) : (
                <div />
              )}
              {endEstimate && (
                <div className="whitespace-nowrap">
                  Fin&nbsp;:{" "}
                  <span className="text-white font-semibold tabular-nums">{formatEndClock(endEstimate)}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          // Header résumé quand tout est fini
          <div className="relative px-5 pt-4 pb-4 bg-gradient-to-br from-slate-50 to-bg-primary border-b border-border">
            <div className="flex items-start gap-3">
              <span
                className={`inline-flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${
                  errorsCount > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {errorsCount > 0 ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v4m0 3h.01M4.93 19h14.14a2 2 0 001.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16a2 2 0 001.73 3z"
                    />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              <div className="flex-1 min-w-0">
                <h3 className="text-[15px] font-semibold text-text-primary">
                  {errorsCount > 0
                    ? errorsCount === 1
                      ? "1 erreur à vérifier"
                      : `${errorsCount} erreurs à vérifier`
                    : "Tout est à jour"}
                </h3>
                <p className="text-[11px] text-text-muted mt-0.5 tabular-nums">
                  {doneCount} sur {totalGroups} produit{totalGroups > 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors"
                  title="Réduire"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14H5" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={clear}
                  className="p-1.5 text-text-muted hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  title="Fermer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Barre progression fine */}
        {!isAllFinished && (
          <div className="h-1 bg-bg-tertiary relative overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {/* ═══ Onglets segmentés + Stop ═══ */}
        <div className="px-3 sm:px-4 pt-3 pb-2 bg-bg-primary flex items-center gap-1.5 border-b border-border-light overflow-x-auto">
          {FILTER_OPTIONS.map((opt) => {
            const count = counts[opt.key];
            const active = filter === opt.key;
            const isDark = active && opt.key === "in_progress";
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFilter(opt.key)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
                  isDark
                    ? "bg-slate-900 text-white"
                    : active
                      ? opt.key === "success"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : opt.key === "error"
                          ? "bg-red-50 text-red-700 border border-red-200"
                          : "bg-slate-100 text-slate-700 border border-slate-200"
                      : "bg-white text-text-muted border border-border hover:border-border-dark"
                }`}
                aria-pressed={active}
              >
                {opt.label}
                <span className={`tabular-nums text-[10px] ${active ? "" : "opacity-60"}`}>
                  {count}
                </span>
              </button>
            );
          })}
          <div className="flex-1" />
          {queuedCount > 0 && (
            <button
              type="button"
              onClick={() => stop()}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-red-600 border border-red-100 hover:bg-red-50 whitespace-nowrap"
              title="Arrêter tous les rafraîchissements en attente"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Tout stopper
            </button>
          )}
        </div>

        {/* ═══ TIMELINE VERTICALE ═══ */}
        <div className="relative px-4 sm:px-5 pt-3 pb-3 max-h-[380px] overflow-y-auto">
          {visibleGroups.length === 0 && (
            <div className="py-6 text-center text-[11px] font-body text-text-muted">
              Aucun produit ne correspond à ce filtre.
            </div>
          )}

          {visibleGroups.length > 0 && (
            <>
              {/* Ligne verticale (rendue seulement si plusieurs items) */}
              {visibleGroups.length > 1 && (
                <div className="absolute left-[calc(1rem+17px)] sm:left-[calc(1.25rem+17px)] top-3 bottom-3 w-px bg-gradient-to-b from-indigo-300 via-border to-border-light" />
              )}
              <TimelineList
                groups={visibleGroups}
                heroGroupId={heroGroup?.productId ?? null}
              />
            </>
          )}
        </div>

        {/* Footer récap */}
        {(doneCount > 0 || endEstimate) && (
          <div className="px-4 py-2.5 border-t border-border-light bg-bg-secondary flex items-center justify-between text-[10.5px]">
            <div className="text-text-muted">
              <span className="tabular-nums font-semibold text-emerald-700">{doneCount - errorsCount}</span> OK
              {errorsCount > 0 && (
                <>
                  {" · "}
                  <span className="tabular-nums font-semibold text-red-700">{errorsCount}</span> erreur
                  {errorsCount > 1 ? "s" : ""}
                </>
              )}
              {queuedCount > 0 && (
                <>
                  {" · "}
                  <span className="tabular-nums font-semibold text-amber-700">{queuedCount}</span> en file
                </>
              )}
            </div>
            {endEstimate && !isAllFinished && (
              <div className="text-text-muted">
                Fin&nbsp;: <span className="tabular-nums font-semibold text-text-primary">{formatEndClock(endEstimate)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TIMELINE — liste verticale des groupes
// ─────────────────────────────────────────────────────────────────────
// Tous les groupes sont affichés ; le conteneur parent s'occupe du scroll.

function TimelineList({
  groups,
  heroGroupId,
}: {
  groups: ProductGroup[];
  heroGroupId: string | null;
}) {
  // On garde tous les produits dans la liste — même celui affiché dans le hero.
  // La liste reste cohérente du début à la fin (sinon la timeline paraît vide
  // pendant qu'un seul produit est en cours de traitement).
  // "isNext" = 1er produit non-hero (le prochain à démarrer si un lot est étalé).
  const nextIndex = groups.findIndex((g) => g.productId !== heroGroupId);
  return (
    <ul className="space-y-3 relative">
      {groups.map((g, idx) => (
        <TimelineRow
          key={g.productId}
          group={g}
          isNext={idx === nextIndex}
          dim={false}
        />
      ))}
    </ul>
  );
}

// ─── Ligne individuelle de la timeline ────────────────────────────────
function TimelineRow({
  group,
  isNext,
  dim,
}: {
  group: ProductGroup;
  isNext: boolean;
  dim: boolean;
}) {
  const scheduledAt = getGroupScheduledFor(group);
  const now = Date.now();
  const isScheduled = scheduledAt !== null && scheduledAt.getTime() > now;
  const isActive = groupHasActive(group);
  const isDone = groupAllDone(group);
  const isErr = groupHasError(group);

  const localOutcome = getLocalOutcomeForGroup(group);

  const orderedItems = [...group.items].sort((a, b) => {
    const order: Record<MarketplaceTarget, number> = { pfs: 0, ankorstore: 1, efashion: 2, faire: 3, orderchamp: 4 };
    return order[a.marketplace] - order[b.marketplace];
  });

  // ── Hover tooltip d'erreur au niveau de la ligne complète ────────────
  // Si le produit a au moins un échec, survoler n'importe où sur la carte
  // affiche la liste des marketplaces en erreur avec leur message.
  const errors = isErr ? withLabels(getGroupErrors(group)) : [];
  const rowRef = useRef<HTMLLIElement | null>(null);
  const [rowAnchorRect, setRowAnchorRect] = useState<DOMRect | null>(null);
  const rowCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRowClose = () => {
    if (rowCloseTimer.current) {
      clearTimeout(rowCloseTimer.current);
      rowCloseTimer.current = null;
    }
  };
  const scheduleRowClose = () => {
    cancelRowClose();
    rowCloseTimer.current = setTimeout(() => setRowAnchorRect(null), 200);
  };
  const openRowTooltip = () => {
    if (errors.length === 0 || !rowRef.current) return;
    cancelRowClose();
    setRowAnchorRect(rowRef.current.getBoundingClientRect());
  };
  const rowErrorTooltip =
    errors.length > 0 && rowAnchorRect ? (
      <RowErrorsTooltipPortal
        anchorRect={rowAnchorRect}
        reference={group.reference}
        errors={errors}
        onMouseEnter={cancelRowClose}
        onMouseLeave={scheduleRowClose}
      />
    ) : null;
  const rowHoverProps = {
    onMouseEnter: openRowTooltip,
    onMouseLeave: scheduleRowClose,
  };

  // Ligne "carte" spéciale pour le prochain planifié (Next).
  if (isNext && isScheduled) {
    return (
      <li
        ref={rowRef}
        {...rowHoverProps}
        className={`relative flex gap-3 items-start ${isErr ? "cursor-help" : ""}`}
      >
        <div className="relative shrink-0">
          <div className="w-[34px] h-[34px] rounded-full bg-white border-2 border-indigo-500 flex items-center justify-center shadow-sm ring-4 ring-indigo-50">
            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="absolute -bottom-1 -right-1 px-1 py-px rounded-full bg-indigo-600 text-white text-[8px] font-bold uppercase tracking-wider">
            Next
          </span>
        </div>
        <div className="flex-1 min-w-0 pb-1">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
            <div className="flex items-start gap-2.5">
              <Link
                href={`/admin/produits/${group.productId}/modifier`}
                className="w-9 h-9 rounded-md bg-bg-tertiary overflow-hidden shrink-0 flex items-center justify-center hover:ring-2 hover:ring-indigo-300 transition-all"
                title="Ouvrir la fiche"
              >
                {group.firstImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={getImageSrc(group.firstImage, "thumb")} alt="" className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/admin/produits/${group.productId}/modifier`}
                    className="text-[12px] font-mono font-semibold text-text-primary hover:text-indigo-700 truncate"
                  >
                    {group.reference}
                  </Link>
                  <span className="text-[10px] font-semibold text-indigo-700 tabular-nums whitespace-nowrap">
                    {formatClock(scheduledAt!)}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted truncate mt-0.5">{group.productName}</p>
                <div className="flex items-center gap-1 mt-1.5">
                  {orderedItems.map((it) => (
                    <CompactMarketplaceDot key={it.id} item={it} />
                  ))}
                  <span className="text-[10px] text-text-muted ml-1">
                    {orderedItems.length} marketplace{orderedItems.length > 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-2.5 pt-2.5 border-t border-indigo-100 flex items-center justify-between">
              <div className="inline-flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 bg-indigo-500" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600" />
                </span>
                <span className="text-[11px] font-semibold text-indigo-800">
                  Dans <span className="tabular-nums">{formatCountdown(scheduledAt!.getTime() - now)}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
        {rowErrorTooltip}
      </li>
    );
  }

  // Ligne standard (planifié plus loin, terminé, ou en erreur).
  const dotClasses = isActive
    ? "border-indigo-400 ring-4 ring-indigo-50"
    : isErr
      ? "border-red-300 ring-4 ring-red-50"
      : isDone
        ? "border-emerald-300 ring-4 ring-emerald-50"
        : isScheduled
          ? "border-border"
          : "border-border";
  const dotIcon = isActive ? (
    <svg className="w-4 h-4 text-indigo-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 9h5V4M3 20v-5h5m-5 0l3.2 3.2a8.25 8.25 0 0013.8-3.7M4 10a8.25 8.25 0 0113.8-3.7L21 9.5" />
    </svg>
  ) : isErr ? (
    <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ) : isDone ? (
    <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
    </svg>
  );

  const timeLabel = isScheduled
    ? formatClock(scheduledAt!)
    : isActive
      ? "…"
      : isDone
        ? "OK"
        : "";

  return (
    <li
      ref={rowRef}
      {...rowHoverProps}
      className={`relative flex gap-3 items-start ${dim ? "opacity-70" : ""} ${
        isErr ? "cursor-help" : ""
      }`}
    >
      <div
        className={`w-[34px] h-[34px] rounded-full bg-white border flex items-center justify-center shrink-0 ${dotClasses}`}
      >
        {dotIcon}
      </div>
      <div className="flex-1 min-w-0 pt-1">
        <div className="flex items-start gap-2.5">
          <Link
            href={`/admin/produits/${group.productId}/modifier`}
            className="w-9 h-9 rounded-md bg-bg-tertiary overflow-hidden shrink-0 flex items-center justify-center hover:ring-2 hover:ring-slate-300 transition-all"
            title="Ouvrir la fiche"
          >
            {group.firstImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={getImageSrc(group.firstImage, "thumb")} alt="" className="w-full h-full object-cover" />
            ) : (
              <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            )}
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/admin/produits/${group.productId}/modifier`}
                className="text-[12px] font-mono font-semibold text-text-primary hover:text-indigo-700 truncate"
              >
                {group.reference}
              </Link>
              {timeLabel && (
                <span
                  className={`text-[10px] tabular-nums whitespace-nowrap ${
                    isScheduled ? "text-text-muted" : isErr ? "text-red-700 font-semibold" : "text-text-muted"
                  }`}
                >
                  {timeLabel}
                </span>
              )}
            </div>
            <p className="text-[11px] text-text-muted truncate mt-0.5">{group.productName}</p>
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {orderedItems.map((it) => (
                <CompactMarketplaceDot key={it.id} item={it} onDim={dim} />
              ))}
              {isScheduled && (
                <span className="text-[10px] text-text-muted ml-1">
                  dans <span className="tabular-nums">{formatCountdown(scheduledAt!.getTime() - now)}</span>
                </span>
              )}
              {localOutcome && <OutcomeChip label="Boutique" outcome={localOutcome} />}
            </div>
          </div>
        </div>
      </div>
      {rowErrorTooltip}
    </li>
  );
}
