"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { getImageSrc } from "@/lib/image-utils";
import {
  useMarketplaceRefreshQueue,
  hasError,
  type MarketplaceRefreshItem,
  type MarketplaceTarget,
  type TargetOutcome,
  type QueueItemStatus,
} from "@/components/admin/products/MarketplaceRefreshContext";

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

// Priorité d'affichage : actifs d'abord, file ensuite, terminés à la fin.
// On veut que la cliente voie immédiatement ce qui se passe, pas la pile
// d'historique.
const STATUS_PRIORITY: Record<QueueItemStatus, number> = {
  in_progress: 0,
  awaiting_callback: 1,
  queued: 2,
  done: 3,
};

function sortItems(items: MarketplaceRefreshItem[]): MarketplaceRefreshItem[] {
  return [...items].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status];
    const pb = STATUS_PRIORITY[b.status];
    if (pa !== pb) return pa - pb;
    // Au sein des "done", on remonte ceux en erreur pour qu'ils sautent aux yeux.
    if (a.status === "done" && b.status === "done") {
      const ea = hasError(a) ? 0 : 1;
      const eb = hasError(b) ? 0 : 1;
      if (ea !== eb) return ea - eb;
    }
    return 0;
  });
}

function getActionLabel(item: MarketplaceRefreshItem, mpLabel: string): string {
  if (item.mode === "publish") return `Publication sur ${mpLabel}`;
  if (item.mode === "resync") return `Resynchronisation sur ${mpLabel}`;
  return `Rafraîchissement sur ${mpLabel}`;
}

function collectOutcomes(item: MarketplaceRefreshItem): {
  label: string;
  outcome: TargetOutcome;
  isMarketplace: boolean;
}[] {
  const out: { label: string; outcome: TargetOutcome; isMarketplace: boolean }[] = [];
  if (item.options.local && item.localOutcome) {
    out.push({ label: "Boutique", outcome: item.localOutcome, isMarketplace: false });
  }
  if (item.pfsOutcome) {
    out.push({ label: "Paris Fashion Shop", outcome: item.pfsOutcome, isMarketplace: true });
  }
  if (item.ankorsOutcome) {
    out.push({ label: "Ankorstore", outcome: item.ankorsOutcome, isMarketplace: true });
  }
  if (item.efashionOutcome) {
    out.push({ label: "eFashion", outcome: item.efashionOutcome, isMarketplace: true });
  }
  return out;
}

// ── Pastille marketplace ──────────────────────────────────────────────
function MarketplaceBadge({ marketplace }: { marketplace: MarketplaceTarget }) {
  const meta = MARKETPLACE_META[marketplace];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap ${meta.badgeBg} ${meta.badgeText} ${meta.badgeBorder}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

// ── Icône principale de statut (à droite de chaque ligne) ────────────
function MainStatusIcon({ item }: { item: MarketplaceRefreshItem }) {
  if (item.status === "queued") {
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
  if (item.status === "in_progress") {
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
  if (item.status === "awaiting_callback") {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FEF3C7] text-[#B45309] shrink-0"
        aria-label="En attente de la confirmation"
        title="En attente de la confirmation de la marketplace"
      >
        <svg className="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2" />
        </svg>
      </span>
    );
  }
  // done
  const err = hasError(item);
  if (err) {
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
function ItemStatusLine({ item }: { item: MarketplaceRefreshItem }) {
  const meta = MARKETPLACE_META[item.marketplace];

  if (item.status === "queued") {
    return (
      <p className="text-[11px] font-body text-text-muted mt-1 flex items-center gap-1.5">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
        </svg>
        En file d'attente
      </p>
    );
  }
  if (item.status === "in_progress") {
    return (
      <p className={`text-[11px] font-body ${meta.accent} mt-1 flex items-center gap-1.5 font-medium`}>
        <span className="relative flex h-2 w-2">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${meta.dot}`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${meta.dot}`} />
        </span>
        {getActionLabel(item, meta.label)}…
      </p>
    );
  }
  if (item.status === "awaiting_callback") {
    return (
      <p className="text-[11px] font-body text-[#B45309] mt-1 flex items-center gap-1.5">
        <svg className="w-3 h-3 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2" />
        </svg>
        {meta.label} traite votre demande (1 à 5 min)…
      </p>
    );
  }
  // done
  const err = hasError(item);
  if (err) return null; // le bloc d'erreur prend le relais en dessous
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

// ── Bloc d'erreur détaillé (sous le statut) ──────────────────────────
function ErrorBlock({ item }: { item: MarketplaceRefreshItem }) {
  const errors: { label: string; message: string }[] = [];
  if (item.pfsOutcome && !item.pfsOutcome.ok) {
    errors.push({ label: "Paris Fashion Shop", message: item.pfsOutcome.message });
  }
  if (item.ankorsOutcome && !item.ankorsOutcome.ok) {
    errors.push({ label: "Ankorstore", message: item.ankorsOutcome.message });
  }
  if (item.efashionOutcome && !item.efashionOutcome.ok) {
    errors.push({ label: "eFashion", message: item.efashionOutcome.message });
  }
  if (errors.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg bg-red-50 border border-red-200 overflow-hidden">
      {errors.map((e, i) => (
        <div
          key={i}
          className={`px-2.5 py-2 ${i > 0 ? "border-t border-red-200" : ""}`}
        >
          <div className="flex items-start gap-2">
            <svg
              className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v4m0 3h.01M4.93 19h14.14a2 2 0 001.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16a2 2 0 001.73 3z"
              />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-red-700 leading-tight">
                Échec sur {e.label}
              </p>
              <p className="text-[11px] font-body text-red-700 whitespace-pre-line break-words leading-snug mt-0.5">
                {e.message}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Widget principal
// ─────────────────────────────────────────────────────────────────────
export function MarketplaceRefreshWidget() {
  const { items, clear, stop, isAllFinished, runningCount, queuedCount } =
    useMarketplaceRefreshQueue();
  const [minimized, setMinimized] = useState(false);

  // Déplie automatiquement quand un nouveau cycle démarre (un seul item en file).
  // Intentionnel : on ne réagit qu'aux changements de taille de la file, pas à
  // chaque mise à jour de statut.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (items.length === 1 && items[0].status === "queued") {
      setMinimized(false);
    }
  }, [items.length]);

  const sortedItems = useMemo(() => sortItems(items), [items]);

  if (items.length === 0) return null;

  const total = items.length;
  const doneItems = items.filter((i) => i.status === "done");
  const done = doneItems.length;
  const errorsCount = doneItems.filter(hasError).length;
  const awaitingCount = items.filter((i) => i.status === "awaiting_callback").length;
  const barPercent = total > 0 ? Math.round((done / total) * 100) : 0;

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

        {/* ─── Liste des items ────────────────────────────────────── */}
        <ul className="flex-1 overflow-y-auto max-h-[420px] divide-y divide-border-light">
          {sortedItems.map((item) => {
            const isActive =
              item.status === "in_progress" || item.status === "awaiting_callback";
            const outcomes = item.status === "done" ? collectOutcomes(item) : [];
            // Pour éviter le doublon avec le bloc d'erreur juste en dessous,
            // on n'affiche pas les chips d'outcome marketplace en erreur ici.
            const outcomeChips = outcomes.filter((o) => o.outcome.ok || !o.isMarketplace);

            return (
              <li
                key={item.id}
                className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                  isActive ? "bg-[#FAFAFF]" : "hover:bg-bg-secondary"
                }`}
              >
                <Link
                  href={`/admin/produits/${item.productId}/modifier`}
                  className="w-11 h-11 rounded-lg bg-bg-tertiary overflow-hidden shrink-0 flex items-center justify-center hover:ring-2 hover:ring-[#4F46E5]/30 transition-all"
                  title="Ouvrir la fiche produit"
                >
                  {item.firstImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getImageSrc(item.firstImage, "thumb")}
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/admin/produits/${item.productId}/modifier`}
                      className="text-[12px] font-mono font-semibold text-text-primary hover:text-[#4F46E5] transition-colors truncate"
                      title={item.reference}
                    >
                      {item.reference}
                    </Link>
                    <MarketplaceBadge marketplace={item.marketplace} />
                  </div>
                  <p className="text-[11px] font-body text-text-muted truncate mt-0.5">
                    {item.productName}
                  </p>

                  <ItemStatusLine item={item} />

                  {/* Chips d'outcome (ex : Boutique OK) */}
                  {outcomeChips.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {outcomeChips.map((o, i) => (
                        <OutcomeChip key={i} label={o.label} outcome={o.outcome} />
                      ))}
                    </div>
                  )}

                  {/* Bloc d'erreur détaillé */}
                  {item.status === "done" && <ErrorBlock item={item} />}
                </div>

                <MainStatusIcon item={item} />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
