"use client";

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { getImageSrc } from "@/lib/image-utils";
import {
  useMarketplaceRefreshQueue,
  hasError,
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
  type ProductGroup,
  type StatusFilter,
} from "@/components/admin/products/marketplaceRefreshGroup";

// ── Métadonnées par marketplace : couleurs + libellés ─────────────────
// Pastille colorée affichée sur chaque ligne pour reconnaître la
// marketplace cible en un coup d'œil (PFS violet, Ankorstore orange,
// eFashion bleu).
const MARKETPLACE_META: Record<
  MarketplaceTarget,
  {
    label: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    dot: string;
    accent: string;
  }
> = {
  pfs: {
    label: "Paris Fashion Shop",
    badgeBg: "bg-[#F3E8FF]",
    badgeText: "text-[#6B21A8]",
    badgeBorder: "border-[#E9D5FF]",
    dot: "bg-[#9333EA]",
    accent: "text-[#7C3AED]",
  },
  ankorstore: {
    label: "Ankorstore",
    badgeBg: "bg-[#FFEDD5]",
    badgeText: "text-[#9A3412]",
    badgeBorder: "border-[#FED7AA]",
    dot: "bg-[#EA580C]",
    accent: "text-[#EA580C]",
  },
  efashion: {
    label: "eFashion",
    badgeBg: "bg-[#DBEAFE]",
    badgeText: "text-[#1E40AF]",
    badgeBorder: "border-[#BFDBFE]",
    dot: "bg-[#2563EB]",
    accent: "text-[#2563EB]",
  },
};

function getActionVerb(mode: MarketplaceRefreshItem["mode"]): string {
  if (mode === "publish") return "Publication";
  if (mode === "resync") return "Resynchronisation";
  return "Rafraîchissement";
}

// ── Tooltip d'erreur en portail ──────────────────────────────────────
// Pourquoi un portail : le panneau du widget a `overflow-hidden` et la
// liste a `overflow-y-auto`. Un tooltip absolu posé sur la pastille était
// coupé par ces deux régions, peu importe le z-index. En le rendant
// directement dans `document.body` via createPortal + position: fixed
// calculée par rapport au rect du déclencheur, il flotte au-dessus de
// toute l'interface, même hors des limites du panneau.
function ErrorTooltipPortal({
  anchorRect,
  title,
  message,
}: {
  anchorRect: DOMRect;
  title: string;
  message: string;
}) {
  if (typeof document === "undefined") return null;

  const margin = 8;
  const width = 320;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Centre horizontalement sur la pastille, clampe pour rester dans la fenêtre.
  let left = anchorRect.left + anchorRect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

  // Préfère au-dessus ; bascule en dessous s'il n'y a pas la place.
  const preferAbove = anchorRect.top > 180;
  const style: React.CSSProperties = preferAbove
    ? { position: "fixed", left, bottom: viewportHeight - anchorRect.top + 6, width, zIndex: 9999 }
    : { position: "fixed", left, top: anchorRect.bottom + 6, width, zIndex: 9999 };

  return createPortal(
    <div
      role="tooltip"
      style={style}
      className="pointer-events-none p-2.5 bg-red-700 text-white text-[11px] font-body leading-snug rounded-lg shadow-xl whitespace-pre-line break-words max-h-[60vh] overflow-y-auto"
    >
      <span className="block font-semibold mb-0.5">{title}</span>
      {message}
    </div>,
    document.body,
  );
}

// ── Pastille marketplace avec statut intégré ─────────────────────────
// Affiche : pastille colorée par marketplace + petit icône de statut
// (sablier file / spinner en cours / horloge attente callback / ✓ / ✕).
// En cas d'erreur, un pop-over sur hover montre le message complet.
function MarketplaceStatusBadge({ item }: { item: MarketplaceRefreshItem }) {
  const meta = MARKETPLACE_META[item.marketplace];
  const outcome = getMarketplaceOutcome(item);

  const badgeRef = useRef<HTMLSpanElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  let icon: ReactNode = null;
  let errorMsg: string | null = null;
  let extraRing = "";

  if (item.status === "queued") {
    icon = (
      <svg className="w-3 h-3 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
      </svg>
    );
  } else if (item.status === "in_progress") {
    icon = (
      <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
      </svg>
    );
  } else if (item.status === "awaiting_callback") {
    icon = (
      <svg className="w-3 h-3 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2" />
      </svg>
    );
  } else if (outcome?.ok) {
    icon = (
      <svg className="w-3 h-3 text-[#15803D]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  } else if (outcome) {
    extraRing = "ring-2 ring-red-300";
    errorMsg = outcome.message;
    icon = (
      <svg className="w-3 h-3 text-[#B91C1C]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }

  // Mesure la position de la pastille au moment d'afficher le tooltip.
  // Pas de listener resize/scroll : ouverture courte (hover), recalcul à
  // chaque nouveau hover suffit pour rester correct.
  const openTooltip = () => {
    if (!errorMsg || !badgeRef.current) return;
    setAnchorRect(badgeRef.current.getBoundingClientRect());
  };
  const closeTooltip = () => setAnchorRect(null);

  return (
    <span
      ref={badgeRef}
      className="relative inline-flex"
      onMouseEnter={openTooltip}
      onMouseLeave={closeTooltip}
      onFocus={openTooltip}
      onBlur={closeTooltip}
      tabIndex={errorMsg ? 0 : -1}
    >
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap ${meta.badgeBg} ${meta.badgeText} ${meta.badgeBorder} ${extraRing}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
        {meta.label}
        {icon}
      </span>
      {errorMsg && anchorRect && (
        <ErrorTooltipPortal
          anchorRect={anchorRect}
          title={`Échec sur ${meta.label}`}
          message={errorMsg}
        />
      )}
    </span>
  );
}

// ── Icône principale de statut (à droite de chaque ligne) ────────────
// Reflète l'état du groupe entier : spinner si au moins une marketplace
// est en cours, croix rouge si au moins une est en erreur, sinon ✓.
function GroupStatusIcon({ group }: { group: ProductGroup }) {
  const hasActive = groupHasActive(group);
  const hasQueued = group.items.some((it) => it.status === "queued");
  const allDone = groupAllDone(group);
  const hasErr = groupHasError(group);

  if (hasActive) {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#EEF2FF] text-[#4F46E5] shrink-0"
        aria-label="En cours"
      >
        <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
      </span>
    );
  }
  if (hasQueued) {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-bg-tertiary text-text-muted shrink-0"
        aria-label="En attente"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5" />
          <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
        </svg>
      </span>
    );
  }
  if (allDone && hasErr) {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FEE2E2] text-[#B91C1C] shrink-0"
        aria-label="Terminé avec erreurs"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01M4.93 19h14.14a2 2 0 001.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16a2 2 0 001.73 3z" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#DCFCE7] text-[#15803D] shrink-0"
      aria-label="Terminé"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

// ── Ligne de statut sous le nom du produit ──────────────────────────
// Résume l'état du groupe en une phrase ; le détail par marketplace
// est porté par les pastilles MarketplaceStatusBadge.
function GroupStatusLine({ group }: { group: ProductGroup }) {
  const activeItems = group.items.filter(
    (it) => it.status === "in_progress" || it.status === "awaiting_callback",
  );
  const queuedItems = group.items.filter((it) => it.status === "queued");

  if (activeItems.length > 0) {
    // Mode dominant : on prend celui de l'item le plus en avance
    const mode = activeItems[0].mode;
    return (
      <p className="text-[11px] font-body text-[#4F46E5] mt-1 flex items-center gap-1.5 font-medium">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-[#4F46E5]" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#4F46E5]" />
        </span>
        {getActionVerb(mode)} en cours…
      </p>
    );
  }
  if (queuedItems.length > 0) {
    return (
      <p className="text-[11px] font-body text-text-muted mt-1 flex items-center gap-1.5">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
        </svg>
        En file d&apos;attente
      </p>
    );
  }
  // tout est done
  const errCount = group.items.filter(hasError).length;
  if (errCount > 0) {
    return (
      <p className="text-[11px] font-body text-[#B91C1C] mt-1 flex items-center gap-1.5">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01M4.93 19h14.14a2 2 0 001.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16a2 2 0 001.73 3z" />
        </svg>
        {errCount} marketplace{errCount > 1 ? "s" : ""} en erreur — survolez la pastille
      </p>
    );
  }
  return (
    <p className="text-[11px] font-body text-[#15803D] mt-1 flex items-center gap-1.5">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      Terminé
    </p>
  );
}

// ── Petit chip d'outcome (utilisé pour les "Boutique" + marketplaces
//    additionnelles quand done) ───────────────────────────────────────
function OutcomeChip({ label, outcome }: { label: string; outcome: TargetOutcome }) {
  const ok = outcome.ok;
  const archived = ok && outcome.archived;
  const cls = ok
    ? archived
      ? "bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]"
      : "bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]"
    : outcome.kind === "not_found"
      ? "bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]"
      : "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]";
  const dot = ok
    ? archived
      ? "bg-[#F59E0B]"
      : "bg-[#22C55E]"
    : outcome.kind === "not_found"
      ? "bg-[#F59E0B]"
      : "bg-[#EF4444]";
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${cls}`}
      title={ok ? (archived ? "Archivé (rupture de stock)" : "Terminé") : outcome.message}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label}
      {archived ? " · archivé" : ""}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Widget principal
// ─────────────────────────────────────────────────────────────────────
const FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "in_progress", label: "En cours" },
  { key: "success", label: "Succès" },
  { key: "error", label: "Erreur" },
];

export function MarketplaceRefreshWidget() {
  const { items, clear, stop, isAllFinished, runningCount, queuedCount } =
    useMarketplaceRefreshQueue();
  const [minimized, setMinimized] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");

  // Déplie automatiquement quand un nouveau cycle démarre (un seul item en file).
  // Intentionnel : on ne réagit qu'aux changements de taille de la file, pas à
  // chaque mise à jour de statut.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (items.length === 1 && items[0].status === "queued") {
      setMinimized(false);
    }
  }, [items.length]);

  const groups = useMemo(() => groupItemsByProduct(items), [items]);
  const sortedGroups = useMemo(() => sortGroups(groups), [groups]);
  const visibleGroups = useMemo(
    () => sortedGroups.filter((g) => groupMatchesFilter(g, filter)),
    [sortedGroups, filter],
  );

  const counts = useMemo(() => {
    let inProgress = 0;
    let success = 0;
    let error = 0;
    for (const g of groups) {
      if (groupMatchesFilter(g, "in_progress")) inProgress += 1;
      if (groupMatchesFilter(g, "success")) success += 1;
      if (groupMatchesFilter(g, "error")) error += 1;
    }
    return { all: groups.length, in_progress: inProgress, success, error };
  }, [groups]);

  if (items.length === 0) return null;

  const totalGroups = groups.length;
  const doneGroups = groups.filter((g) => groupAllDone(g));
  const doneCount = doneGroups.length;
  const errorsCount = doneGroups.filter(groupHasError).length;
  const awaitingCount = items.filter((i) => i.status === "awaiting_callback").length;
  const barPercent = totalGroups > 0 ? Math.round((doneCount / totalGroups) * 100) : 0;
  // Variables conservées pour l'API publique du widget (header / pill / barre).
  const total = totalGroups;
  const done = doneCount;

  // Position décalée du bouton chat admin (qui vit à bottom-6 right-4 / 56px)
  // → right-24 (96px) laisse environ 16px d'air entre les deux.
  const containerPos = "fixed bottom-4 right-24 z-[9000]";

  // ─── Mode réduit (pill) ───────────────────────────────────────────
  if (minimized) {
    return (
      <div className={`${containerPos} animate-fadeIn`} style={{ maxWidth: "calc(100vw - 7rem)" }}>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2.5 bg-bg-primary border border-border rounded-full pl-3 pr-4 py-2 shadow-lg hover:shadow-xl transition-all font-body group"
        >
          {!isAllFinished ? (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#EEF2FF] text-[#4F46E5]">
              <svg
                className="w-3.5 h-3.5 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2.2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992"
                />
              </svg>
            </span>
          ) : errorsCount > 0 ? (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#FEE2E2] text-[#B91C1C]">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01" />
                <circle cx="12" cy="12" r="9" strokeWidth={1.8} />
              </svg>
            </span>
          ) : (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#DCFCE7] text-[#15803D]">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
          )}
          <span className="text-[13px] font-medium text-text-primary tabular-nums">
            {done}/{total} traité{total > 1 ? "s" : ""}
          </span>
          {errorsCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold tabular-nums">
              {errorsCount} erreur{errorsCount > 1 ? "s" : ""}
            </span>
          )}
        </button>
      </div>
    );
  }

  // ─── Mode déplié ──────────────────────────────────────────────────
  let headerTitle: string;
  if (!isAllFinished) {
    headerTitle = "Synchronisation marketplaces";
  } else if (errorsCount > 0) {
    headerTitle = errorsCount === 1 ? "1 erreur à vérifier" : `${errorsCount} erreurs à vérifier`;
  } else {
    headerTitle = "Tout est à jour";
  }

  return (
    <div
      className={`${containerPos} animate-fadeIn`}
      style={{ maxWidth: "calc(100vw - 7rem)" }}
      role="region"
      aria-label="Synchronisation marketplaces"
    >
      <div className="bg-bg-primary border border-border rounded-2xl shadow-xl w-[420px] max-w-full overflow-hidden flex flex-col">
        {/* ─── Header ─────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-bg-secondary to-bg-primary">
          <div className="flex items-start gap-2.5">
            {!isAllFinished ? (
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#EEF2FF] text-[#4F46E5] shrink-0 mt-0.5">
                <svg
                  className="w-4 h-4 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992"
                  />
                </svg>
              </span>
            ) : errorsCount > 0 ? (
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#FEE2E2] text-[#B91C1C] shrink-0 mt-0.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v4m0 3h.01M4.93 19h14.14a2 2 0 001.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16a2 2 0 001.73 3z"
                  />
                </svg>
              </span>
            ) : (
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#DCFCE7] text-[#15803D] shrink-0 mt-0.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-[14px] font-semibold font-heading text-text-primary leading-tight">
                {headerTitle}
              </h3>
              <p className="text-[11px] font-body text-text-muted mt-0.5 tabular-nums">
                {done} sur {total} produit{total > 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {queuedCount > 0 && (
                <button
                  type="button"
                  onClick={stop}
                  className="p-1.5 text-text-muted hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  title="Arrêter les produits en attente"
                  aria-label="Arrêter les produits en attente"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors"
                title="Réduire"
                aria-label="Réduire"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14H5" />
                </svg>
              </button>
              {isAllFinished && (
                <button
                  type="button"
                  onClick={clear}
                  className="p-1.5 text-text-muted hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  title="Fermer"
                  aria-label="Fermer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Compteurs par statut */}
          <div className="flex items-center gap-3 mt-2.5 text-[10px] font-body text-text-muted">
            {runningCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4F46E5] animate-pulse" />
                <span className="tabular-nums font-medium text-[#4F46E5]">{runningCount}</span>
                <span>en cours</span>
              </span>
            )}
            {awaitingCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
                <span className="tabular-nums font-medium text-[#B45309]">{awaitingCount}</span>
                <span>en attente</span>
              </span>
            )}
            {queuedCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
                <span className="tabular-nums font-medium">{queuedCount}</span>
                <span>en file</span>
              </span>
            )}
            {done > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                <span className="tabular-nums font-medium text-[#15803D]">{done - errorsCount}</span>
                <span>OK</span>
              </span>
            )}
            {errorsCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                <span className="tabular-nums font-medium text-[#B91C1C]">{errorsCount}</span>
                <span>erreur{errorsCount > 1 ? "s" : ""}</span>
              </span>
            )}
          </div>
        </div>

        {/* ─── Barre de progression ───────────────────────────────── */}
        <div className="h-1 bg-bg-tertiary relative overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              isAllFinished
                ? errorsCount > 0
                  ? "bg-[#F59E0B]"
                  : "bg-[#22C55E]"
                : "bg-[#4F46E5]"
            }`}
            style={{ width: `${barPercent}%` }}
          />
        </div>

        {/* ─── Barre de filtres par statut ────────────────────────── */}
        <div className="px-4 py-2 border-b border-border bg-bg-secondary flex items-center gap-1.5 overflow-x-auto">
          {FILTER_OPTIONS.map((opt) => {
            const count = counts[opt.key];
            const active = filter === opt.key;
            const accent =
              opt.key === "in_progress"
                ? "text-[#4F46E5] border-[#C7D2FE] bg-[#EEF2FF]"
                : opt.key === "success"
                  ? "text-[#15803D] border-[#BBF7D0] bg-[#DCFCE7]"
                  : opt.key === "error"
                    ? "text-[#B91C1C] border-[#FECACA] bg-[#FEE2E2]"
                    : "text-text-primary border-border bg-bg-primary";
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFilter(opt.key)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium font-body whitespace-nowrap transition-colors ${
                  active
                    ? accent
                    : "text-text-muted border-border bg-bg-primary hover:bg-bg-tertiary"
                }`}
                aria-pressed={active}
              >
                {opt.label}
                <span className={`tabular-nums text-[10px] ${active ? "" : "opacity-70"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ─── Liste des produits (groupés) ───────────────────────── */}
        <ul className="flex-1 overflow-y-auto max-h-[420px] divide-y divide-border-light">
          {visibleGroups.length === 0 && (
            <li className="px-4 py-6 text-center text-[11px] font-body text-text-muted">
              Aucun produit ne correspond à ce filtre.
            </li>
          )}
          {visibleGroups.map((group) => {
            const isActive = groupHasActive(group);
            const localOutcome = getLocalOutcomeForGroup(group);
            // On trie les pastilles marketplace dans un ordre stable (pfs, ankorstore, efashion).
            const orderedItems = [...group.items].sort((a, b) => {
              const order: Record<MarketplaceTarget, number> = {
                pfs: 0,
                ankorstore: 1,
                efashion: 2,
              };
              return order[a.marketplace] - order[b.marketplace];
            });

            return (
              <li
                key={group.productId}
                className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                  isActive ? "bg-[#FAFAFF]" : "hover:bg-bg-secondary"
                }`}
              >
                <Link
                  href={`/admin/produits/${group.productId}/modifier`}
                  className="w-11 h-11 rounded-lg bg-bg-tertiary overflow-hidden shrink-0 flex items-center justify-center hover:ring-2 hover:ring-[#4F46E5]/30 transition-all"
                  title="Ouvrir la fiche produit"
                >
                  {group.firstImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getImageSrc(group.firstImage, "thumb")}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <svg
                      className="w-5 h-5 text-text-muted"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  )}
                </Link>

                <div className="flex-1 min-w-0">
                  <Link
                    href={`/admin/produits/${group.productId}/modifier`}
                    className="text-[12px] font-mono font-semibold text-text-primary hover:text-[#4F46E5] transition-colors truncate block"
                    title={group.reference}
                  >
                    {group.reference}
                  </Link>
                  <p className="text-[11px] font-body text-text-muted truncate mt-0.5">
                    {group.productName}
                  </p>

                  {/* Pastilles par marketplace avec leur statut */}
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {orderedItems.map((item) => (
                      <MarketplaceStatusBadge key={item.id} item={item} />
                    ))}
                    {localOutcome && (
                      <OutcomeChip label="Boutique" outcome={localOutcome} />
                    )}
                  </div>

                  <GroupStatusLine group={group} />
                </div>

                <GroupStatusIcon group={group} />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
