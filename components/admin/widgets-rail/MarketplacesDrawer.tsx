"use client";

/**
 * Tiroir « Marketplaces » — refonte 2026-08-14.
 *
 * 5 vues empilées via un système d'onglets en haut du panneau :
 *  - Création       : jobs intent=create (première publication chez le marketplace)
 *  - Modification   : jobs intent=update ou resync (fiche déjà liée)
 *  - Liaison        : LinkJob client + jobs marketplace intent=link
 *  - Rafraîchissement : mode refresh sans étalement (départ immédiat)
 *  - Étalement      : mode refresh avec scheduledFor futur (lot planifié)
 *
 * Chaque carte produit affiche :
 *   - Photo + nom + référence + puce d'action (mode ou intent)
 *   - Chips marketplaces P/A/E/F avec pastille verte/rouge/sky selon l'état
 *   - **Timeline verticale des étapes** poussées par le worker
 *     (voir lib/marketplace-job-steps.ts). Pastilles + libellé FR + durée +
 *     message. Fallback compact si `steps` absent (anciens jobs).
 *   - Bloc erreur détaillé avec cause FR + boutons Relancer / Ignorer
 *
 * La vue Étalement montre en plus la timeline horizontale des prochains créneaux.
 */

import { useEffect, useMemo, useState } from "react";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  hasError as itemHasError,
  isItemActive,
  useMarketplaceRefreshQueue,
  type MarketplaceRefreshItem,
  type MarketplaceTarget,
  type TargetOutcome,
} from "@/components/admin/products/MarketplaceRefreshContext";
import { useMarketplaceLinkJobs } from "@/components/admin/products/MarketplaceLinkContext";
import { getImageSrc } from "@/lib/image-utils";
import {
  bucketViews,
  groupItemsByProductAndMode,
  VIEW_LABEL,
  VIEW_ORDER,
  type ProductGroup,
  type ViewBucketProduct,
  type ViewKey,
  type MarketplaceCell,
  type LinkJobLike,
  MARKETPLACE_ORDER,
} from "./marketplacesDrawerModel";

// Couleurs figées par marketplace (cf. CLAUDE.md — bloc « Couleurs des initiales »).
const MARKETPLACE_META: Record<MarketplaceTarget, { letter: string; name: string; grad: string }> = {
  pfs: { letter: "P", name: "PFS", grad: "linear-gradient(135deg,#4f46e5,#6366f1)" },
  ankorstore: { letter: "A", name: "Ankorstore", grad: "linear-gradient(135deg,#0ea5e9,#38bdf8)" },
  efashion: { letter: "E", name: "eFashion", grad: "linear-gradient(135deg,#db2777,#ec4899)" },
  faire: { letter: "F", name: "Faire", grad: "linear-gradient(135deg,#f59e0b,#fbbf24)" },
  orderchamp: { letter: "O", name: "Orderchamp", grad: "linear-gradient(135deg,#f97316,#fdba74)" },
  microstore: { letter: "M", name: "Microstore", grad: "linear-gradient(135deg,#0891b2,#22d3ee)" },
};

const VIEW_ACCENT: Record<ViewKey, { chip: string; chipText: string; barActive: string; icon: React.ReactNode }> = {
  creation: {
    chip: "bg-blue-100",
    chipText: "text-blue-700",
    barActive: "bg-gradient-to-r from-blue-600 to-cyan-500",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
  },
  update: {
    chip: "bg-emerald-100",
    chipText: "text-emerald-700",
    barActive: "bg-gradient-to-r from-emerald-600 to-emerald-400",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
        />
      </svg>
    ),
  },
  sync: {
    chip: "bg-violet-100",
    chipText: "text-violet-700",
    barActive: "bg-gradient-to-r from-violet-600 to-violet-400",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
        />
      </svg>
    ),
  },
  link: {
    chip: "bg-fuchsia-100",
    chipText: "text-fuchsia-700",
    barActive: "bg-gradient-to-r from-fuchsia-600 to-pink-400",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
        />
      </svg>
    ),
  },
  refresh: {
    chip: "bg-sky-100",
    chipText: "text-sky-700",
    barActive: "bg-gradient-to-r from-sky-600 to-sky-400",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
        />
      </svg>
    ),
  },
  scheduled: {
    chip: "bg-amber-100",
    chipText: "text-amber-800",
    barActive: "bg-gradient-to-r from-amber-500 to-orange-400",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
};

const MARKETPLACES_ICON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
    />
  </svg>
);

// ────────────────────────────────────────────────────────────────
// Composant racine
// ────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "active" | "errors" | "done";

export function MarketplacesDrawer() {
  const { openWidget, close, setBadge } = useRightRail();
  const { items, clear, enqueue, runningCount, queuedCount, stop, dismiss } =
    useMarketplaceRefreshQueue();
  const {
    jobs: linkJobs,
    activeCount: linkActiveCount,
    dismissJob: dismissLinkJob,
    clearFinished: clearFinishedLinkJobs,
  } = useMarketplaceLinkJobs();
  const toast = useToast();
  const { confirm } = useConfirm();

  // Tick 1s si un job planifié est en attente : sert au compte à rebours de
  // la vue Étalement + à faire basculer un item scheduled → refresh à échéance.
  const hasScheduled = items.some((i) => Boolean(i.scheduledFor));
  const nowMs = useNowTick(hasScheduled ? 1_000 : items.some(isItemActive) ? 5_000 : null);

  const groups = useMemo(() => groupItemsByProductAndMode(items, nowMs), [items, nowMs]);
  const views = useMemo(() => bucketViews(groups, linkJobs, nowMs), [groups, linkJobs, nowMs]);

  const errorCount = views.reduce((n, v) => n + v.kpi.errors, 0);
  const activeCount = views.reduce((n, v) => n + v.kpi.active + v.kpi.queued, 0);
  const totalProcessed = views.reduce((n, v) => n + v.kpi.done, 0);
  const totalPlanned = totalProcessed + activeCount + errorCount;
  const linkErrorCount = linkJobs.filter((j) => j.status === "error").length;

  // Badge FAB : compteur global + halo pulsant si actif ou erreur
  useEffect(() => {
    const totalErr = errorCount + linkErrorCount;
    setBadge("marketplaces", {
      count: activeCount || totalErr,
      pulse: activeCount > 0 || totalErr > 0,
    });
  }, [activeCount, errorCount, linkActiveCount, linkErrorCount, setBadge]);

  // Onglet actif : par défaut "creation". On bascule automatiquement sur le
  // premier onglet non vide si l'utilisatrice n'a rien à voir sur celui-ci
  // au moment de l'ouverture — évite l'écran « Aucune activité » d'entrée.
  const [activeTab, setActiveTab] = useState<ViewKey>("creation");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    if (openWidget !== "marketplaces") return;
    // À l'ouverture, si "creation" est vide mais qu'une autre vue a du contenu,
    // bascule proprement.
    const creation = views.find((v) => v.key === "creation");
    if (creation && (creation.groups.length > 0 || creation.linkJobs.length > 0)) return;
    const firstNonEmpty = views.find((v) => v.groups.length > 0 || v.linkJobs.length > 0);
    if (firstNonEmpty) setActiveTab(firstNonEmpty.key);
    // On ne veut PAS re-basculer à chaque tick : seulement à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWidget]);

  const activeView = views.find((v) => v.key === activeTab) ?? views[0];

  const title =
    activeCount > 0
      ? `${runningCount + queuedCount} produit${runningCount + queuedCount > 1 ? "s" : ""} en cours`
      : errorCount > 0
        ? `${errorCount} erreur${errorCount > 1 ? "s" : ""}`
        : totalProcessed > 0
          ? `${totalProcessed} terminé${totalProcessed > 1 ? "s" : ""}`
          : "Aucune activité";

  const onStopQueued = async () => {
    if (queuedCount === 0) return;
    const label = `${queuedCount} produit${queuedCount > 1 ? "s" : ""}`;
    const ok = await confirm({
      type: "warning",
      title: "Arrêter les envois suivants ?",
      message: `${label} en attente ${queuedCount > 1 ? "seront retirés" : "sera retiré"} de la file. Les envois déjà démarrés se terminent normalement.`,
      confirmLabel: "Arrêter les suivants",
    });
    if (!ok) return;
    stop();
    toast.success(
      "File arrêtée",
      `${label} retiré${queuedCount > 1 ? "s" : ""}. Les envois en cours vont se terminer.`,
    );
  };

  const retryOneGroup = (group: ProductGroup) => {
    const inputs = group.items
      .filter((it) => {
        const outcome = outcomeForMarketplace(it, it.marketplace);
        return outcome && outcome.ok === false;
      })
      .map((it) => ({
        productId: it.productId,
        reference: it.reference,
        productName: it.productName,
        firstImage: it.firstImage,
        options: it.options,
        mode: it.mode,
        marketplace: it.marketplace,
      }));
    if (inputs.length > 0) enqueue(inputs);
  };

  const retryAllErrorsInView = () => {
    if (!activeView) return;
    const inputs: Parameters<typeof enqueue>[0] = [];
    for (const g of activeView.groups) {
      if (g.section !== "errors") continue;
      for (const it of g.items) {
        const outcome = outcomeForMarketplace(it, it.marketplace);
        if (outcome && outcome.ok === false) {
          inputs.push({
            productId: it.productId,
            reference: it.reference,
            productName: it.productName,
            firstImage: it.firstImage,
            options: it.options,
            mode: it.mode,
            marketplace: it.marketplace,
          });
        }
      }
    }
    if (inputs.length > 0) {
      enqueue(inputs);
      toast.success(
        "Relancé",
        `${inputs.length} envoi${inputs.length > 1 ? "s" : ""} en erreur remis en file.`,
      );
    }
  };

  const dismissGroup = (group: ProductGroup) => {
    const ids = group.items
      .filter((it) => it.status === "queued" || it.status === "done")
      .map((it) => it.id);
    if (ids.length > 0) dismiss(ids);
  };

  const clearDone = () => {
    clear();
    clearFinishedLinkJobs();
  };

  const isEmpty = groups.length === 0 && linkJobs.length === 0;

  return (
    <DrawerShell
      open={openWidget === "marketplaces"}
      onClose={close}
      accent="sky"
      eyebrow="Marketplaces"
      size="fullscreen"
      title={
        <span className="flex items-center gap-1.5">
          {activeCount > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
          )}
          {title}
        </span>
      }
      icon={MARKETPLACES_ICON}
      footer={
        !isEmpty ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-500 tabular-nums">
              {totalProcessed} / {totalPlanned} traités
            </span>
            <div className="flex items-center gap-2.5">
              {queuedCount > 0 && (
                <button
                  type="button"
                  onClick={() => void onStopQueued()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-100 text-rose-700 font-semibold hover:bg-rose-200 transition-colors"
                >
                  Arrêter ({queuedCount})
                </button>
              )}
              <button
                type="button"
                onClick={clearDone}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white font-semibold hover:bg-slate-900 transition-colors"
              >
                Vider terminés
              </button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col h-full min-h-0 bg-slate-50/60">
        {/* ─── Bandeau KPI aurora sky compact ─── */}
        {!isEmpty && (
          <div className="flex-shrink-0 px-6 pt-5 pb-4">
            <div className="mx-auto max-w-4xl grid grid-cols-4 gap-3">
              <KpiTile label="En cours" value={runningCount} tone="sky" pulse={runningCount > 0} />
              <KpiTile label="En attente" value={queuedCount} tone="slate" />
              <KpiTile label="Erreurs" value={errorCount + linkErrorCount} tone="rose" />
              <KpiTile label="Terminés" value={totalProcessed} tone="emerald" />
            </div>
          </div>
        )}

        {/* ─── Onglets (5 vues) ─── */}
        <div className="flex-shrink-0 px-6 border-b border-slate-200 overflow-x-auto scrollbar-none">
          <div className="mx-auto max-w-6xl flex gap-1">
            {VIEW_ORDER.map((key) => {
              const view = views.find((v) => v.key === key);
              const badge =
                (view?.kpi.errors ?? 0) +
                (view?.kpi.active ?? 0) +
                (view?.kpi.queued ?? 0) +
                (view?.kpi.done ?? 0) +
                (key === "link" ? view?.linkJobs.length ?? 0 : 0);
              const isActive = activeTab === key;
              const meta = VIEW_LABEL[key];
              const accent = VIEW_ACCENT[key];
              const hasErrors = (view?.kpi.errors ?? 0) > 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setActiveTab(key);
                    setStatusFilter("all");
                  }}
                  className={`relative flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap transition-colors border-b-2 ${
                    isActive
                      ? `${accent.chipText} border-current`
                      : "text-slate-500 hover:text-slate-700 border-transparent"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${isActive ? accent.chip : "bg-slate-100"} ${isActive ? accent.chipText : "text-slate-500"}`}>
                    {accent.icon}
                  </span>
                  <span>{meta.title}</span>
                  {badge > 0 && (
                    <span
                      className={`ml-1 px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${
                        hasErrors
                          ? "bg-rose-500 text-white"
                          : isActive
                            ? accent.chip + " " + accent.chipText
                            : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── Filtre statut ─── */}
        {activeView && (activeView.groups.length > 0 || activeView.linkJobs.length > 0) && (
          <div className="flex-shrink-0 px-6 py-3.5 bg-white border-b border-slate-200 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")} label="Tous" />
              <FilterChip
                active={statusFilter === "active"}
                onClick={() => setStatusFilter("active")}
                label="En cours"
                dot="bg-sky-500"
              />
              <FilterChip
                active={statusFilter === "errors"}
                onClick={() => setStatusFilter("errors")}
                label="Erreurs"
                dot="bg-rose-500"
              />
              <FilterChip
                active={statusFilter === "done"}
                onClick={() => setStatusFilter("done")}
                label="Terminés"
                dot="bg-emerald-500"
              />
            </div>
            {activeView.kpi.errors > 0 && (
              <button
                type="button"
                onClick={retryAllErrorsInView}
                className="ml-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-rose-100 text-rose-700 text-sm font-bold hover:bg-rose-200 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0113.5-4M20 14a8 8 0 01-13.5 4" />
                </svg>
                Relancer les {activeView.kpi.errors} erreurs
              </button>
            )}
          </div>
        )}

        {/* ─── Contenu scrollable ─── */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {isEmpty ? (
            <EmptyState />
          ) : activeView ? (
            <ViewContent
              view={activeView}
              statusFilter={statusFilter}
              nowMs={nowMs}
              onRetry={retryOneGroup}
              onDismiss={dismissGroup}
              onDismissLinkJob={dismissLinkJob}
            />
          ) : null}
        </div>
      </div>
    </DrawerShell>
  );
}

// ────────────────────────────────────────────────────────────────
// Sous-composants
// ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="p-8 h-full min-h-[280px] flex items-center justify-center text-center">
      <div>
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 flex items-center justify-center text-sky-500 mb-4">
          {MARKETPLACES_ICON}
        </div>
        <p className="text-base font-semibold text-slate-700">Aucune synchro en cours</p>
        <p className="text-sm text-slate-500 mt-1.5 max-w-[340px] mx-auto">
          Vos envois vers PFS, Ankorstore, eFashion, Faire et Orderchamp s'afficheront ici, rangés par type d'action.
        </p>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
  pulse,
}: {
  label: string;
  value: number;
  tone: "sky" | "rose" | "emerald" | "slate";
  pulse?: boolean;
}) {
  const toneClasses: Record<typeof tone, string> = {
    sky: "bg-sky-50 border-sky-200 text-sky-700",
    rose: "bg-rose-50 border-rose-200 text-rose-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    slate: "bg-slate-50 border-slate-200 text-slate-600",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClasses[tone]}`}>
      <div className="text-[11px] uppercase tracking-widest font-bold opacity-80">{label}</div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-2xl font-bold tabular-nums leading-none">{value}</span>
        {pulse && value > 0 && (
          <span className="w-2 h-2 rounded-full bg-current opacity-70 animate-pulse" />
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  dot,
  variant,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dot?: string;
  variant?: "dark";
}) {
  const base = "px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-colors";
  const styles = active
    ? variant === "dark"
      ? "bg-slate-900 text-white"
      : "bg-sky-100 text-sky-700"
    : "text-slate-500 hover:bg-slate-100";
  return (
    <button type="button" onClick={onClick} className={`${base} ${styles}`}>
      {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
      {label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────
// Contenu d'une vue (liste de cartes + éventuelle timeline étalement)
// ────────────────────────────────────────────────────────────────

function ViewContent({
  view,
  statusFilter,
  nowMs,
  onRetry,
  onDismiss,
  onDismissLinkJob,
}: {
  view: ViewBucketProduct;
  statusFilter: StatusFilter;
  nowMs: number;
  onRetry: (group: ProductGroup) => void;
  onDismiss: (group: ProductGroup) => void;
  onDismissLinkJob: (id: string) => void;
}) {
  const filteredGroups = useMemo(() => {
    let arr = view.groups.slice();

    // Filtre statut cellule-par-cellule : un produit peut apparaître dans PLUSIEURS
    // filtres (ex: "En cours" ET "Erreurs" si une marketplace tourne et une autre a échoué).
    // - En cours : au moins une case marketplace active/queued
    // - Erreurs  : au moins une case marketplace en erreur
    // - Terminés : TOUTES les cases ciblées sont "done", zéro erreur, zéro active/queued
    if (statusFilter === "errors") {
      arr = arr.filter((g) =>
        Object.values(g.cells).some((c) => c?.kind === "error"),
      );
    } else if (statusFilter === "active") {
      arr = arr.filter((g) =>
        Object.values(g.cells).some((c) => c?.kind === "active" || c?.kind === "queued"),
      );
    } else if (statusFilter === "done") {
      arr = arr.filter((g) => {
        const targeted = Object.values(g.cells).filter(
          (c): c is NonNullable<typeof c> => c != null && c.kind !== "not-targeted",
        );
        if (targeted.length === 0) return false;
        return targeted.every((c) => c.kind === "done");
      });
    }

    // Ordre : erreurs > actifs > scheduled/queued > done
    const rank = (g: ProductGroup) =>
      g.section === "errors" ? 0 : g.section === "active" ? 1 : g.section === "scheduled" || g.section === "queued" ? 2 : 3;
    arr.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      // Dans les scheduled : tri par heure prévue croissante.
      if (a.earliestScheduledFor && b.earliestScheduledFor) {
        return Date.parse(a.earliestScheduledFor) - Date.parse(b.earliestScheduledFor);
      }
      // Sinon : tri par activité la plus récente descendante.
      const la = a.latestActivityAt ? Date.parse(a.latestActivityAt) : 0;
      const lb = b.latestActivityAt ? Date.parse(b.latestActivityAt) : 0;
      return lb - la;
    });

    return arr;
  }, [view.groups, statusFilter]);

  const filteredLinkJobs = useMemo(() => {
    if (view.key !== "link") return [];
    let arr = view.linkJobs.slice();
    if (statusFilter === "errors") arr = arr.filter((j) => j.status === "error");
    else if (statusFilter === "active") arr = arr.filter((j) => j.status === "in_progress");
    else if (statusFilter === "done") arr = arr.filter((j) => j.status === "done");
    const rank = (j: LinkJobLike) => (j.status === "error" ? 0 : j.status === "in_progress" ? 1 : 2);
    arr.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return b.startedAt - a.startedAt;
    });
    return arr;
  }, [view.key, view.linkJobs, statusFilter]);

  if (filteredGroups.length === 0 && filteredLinkJobs.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-base text-slate-500">Rien à afficher dans cette vue avec les filtres actifs.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {view.key === "scheduled" && (
        <ScheduleHeader view={view} groups={filteredGroups} nowMs={nowMs} />
      )}
      <div className="space-y-3">
        {filteredGroups.map((group) => (
          <ProductJobRow
            key={`${group.productId}::${group.dominantMode}`}
            group={group}
            view={view.key}
            onRetry={() => onRetry(group)}
            onDismiss={() => onDismiss(group)}
          />
        ))}
        {filteredLinkJobs.map((job) => (
          <LinkJobRow key={job.id} job={job} onDismiss={() => onDismissLinkJob(job.id)} />
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Vue Étalement — bandeau planificateur + mini-timeline horizontale
// ────────────────────────────────────────────────────────────────

function ScheduleHeader({
  view,
  groups,
  nowMs,
}: {
  view: ViewBucketProduct;
  groups: ProductGroup[];
  nowMs: number;
}) {
  // Prochain slot = groupe scheduled le plus proche dans le futur
  const nextSlot = groups.find((g) => g.earliestScheduledFor);
  const nextAtMs = nextSlot?.earliestScheduledFor ? Date.parse(nextSlot.earliestScheduledFor) : null;
  const countdownMs = nextAtMs !== null ? Math.max(0, nextAtMs - nowMs) : null;

  // Intervalle inféré à partir des 2 premiers slots.
  const intervalMs = useMemo(() => {
    const scheduled = groups.filter((g) => g.earliestScheduledFor);
    if (scheduled.length < 2) return null;
    const t0 = Date.parse(scheduled[0].earliestScheduledFor!);
    const t1 = Date.parse(scheduled[1].earliestScheduledFor!);
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
    return t1 - t0;
  }, [groups]);

  const remaining = groups.length;
  const endAtMs =
    nextAtMs !== null && intervalMs !== null && remaining > 0
      ? nextAtMs + intervalMs * (remaining - 1)
      : null;

  if (!nextSlot) return null;

  return (
    <div className="mx-auto max-w-4xl rounded-2xl bg-gradient-to-br from-amber-50 via-white to-amber-50 border-2 border-amber-200 p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0 text-amber-700">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-widest font-bold text-amber-700">
            Planificateur actif
          </div>
          <div className="text-base font-bold text-slate-800 mt-1">
            {remaining} rafraîchissement{remaining > 1 ? "s" : ""} étalé{remaining > 1 ? "s" : ""}
            {intervalMs !== null && <> · 1 toutes les {formatDurationHuman(intervalMs)}</>}
          </div>
          <div className="text-sm text-slate-600 mt-1.5">
            Prochain envoi dans{" "}
            <span className="font-bold text-amber-700 tabular-nums">
              {countdownMs !== null ? formatCountdownMMSS(countdownMs) : "—"}
            </span>
            {endAtMs !== null && (
              <>
                {" · "}fin estimée à{" "}
                <span className="font-bold">{formatClockTime(endAtMs)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Timeline horizontale mini — 6 prochains créneaux max */}
      <div className="mt-5 grid grid-cols-6 gap-2">
        {groups.slice(0, 6).map((g, idx) => {
          const atMs = g.earliestScheduledFor ? Date.parse(g.earliestScheduledFor) : null;
          const isNext = idx === 0;
          return (
            <div
              key={g.productId}
              className={`rounded-lg border p-2 text-center ${
                isNext
                  ? "bg-amber-100 border-amber-400 ring-2 ring-amber-200"
                  : "bg-white border-slate-200"
              }`}
              title={g.productName}
            >
              <div className="text-[11px] font-semibold text-slate-500">
                {atMs !== null ? formatClockTime(atMs) : "—"}
              </div>
              <div className="text-[11px] font-bold text-slate-700 truncate mt-0.5">
                {g.reference || g.productName.slice(0, 6)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Ligne produit — une par produit + type d'action. Refonte 2026-08-25 :
// affichage horizontal 1 ligne = 1 produit, avec 6 cases marketplace côte
// à côte montrant l'état par marketplace (en cours + progression / ✓ /
// message d'erreur court / « non envoyé » grisé). Cases responsive :
// stack sous md, grid 6 colonnes au-delà.
// ────────────────────────────────────────────────────────────────

function ProductJobRow({
  group,
  view,
  onRetry,
  onDismiss,
}: {
  group: ProductGroup;
  view: ViewKey;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const isError = group.section === "errors";
  const isDone = group.section === "done";
  const isActive = group.section === "active";
  const isScheduled = group.section === "scheduled";

  const dominantItem = pickDominantItem(group.items);
  const startedAtMs = dominantItem?.startedAt ? Date.parse(dominantItem.startedAt) : null;
  const completedAtMs = dominantItem?.completedAt ? Date.parse(dominantItem.completedAt) : null;

  const cardBorder = isError ? "border-2 border-rose-200" : "border border-slate-200";
  const cardShadow = isError ? "shadow-sm shadow-rose-100" : "";

  return (
    <article className={`bg-white rounded-2xl ${cardBorder} ${cardShadow} overflow-hidden transition-shadow hover:shadow-sm`}>
      <div className="p-4 flex flex-col md:flex-row md:items-center gap-4">
        {/* Colonne 1 : image + nom + réf */}
        <div className="flex items-center gap-3 md:w-[300px] md:flex-shrink-0 min-w-0">
          <ProductImage src={group.firstImage} alt={group.productName} active={isActive} error={isError} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <ActionChip view={view} />
              {isScheduled && dominantItem?.scheduledFor && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] uppercase tracking-widest font-bold">
                  À {formatClockTime(Date.parse(dominantItem.scheduledFor))}
                </span>
              )}
            </div>
            <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">
              {group.productName}
            </h3>
            <div className="text-xs text-slate-400 font-mono truncate mt-0.5">{group.reference}</div>
          </div>
        </div>

        {/* Colonne 2 : 6 cases marketplace */}
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {MARKETPLACE_ORDER.map((m) => (
              <MarketplaceCellBox key={m} target={m} cell={group.cells[m]} />
            ))}
          </div>
        </div>

        {/* Colonne 3 : durée + retirer si non-actif/non-erreur */}
        <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center gap-1.5 md:w-[90px] md:flex-shrink-0">
          {startedAtMs !== null && (
            <span className="text-xs text-slate-400 tabular-nums">
              {isDone ? "en " : ""}
              <LiveDuration startedAtMs={startedAtMs} completedAtMs={completedAtMs} />
            </span>
          )}
          {!isActive && !isError && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs text-slate-400 hover:text-slate-700 font-semibold"
            >
              ✕ Retirer
            </button>
          )}
        </div>
      </div>

      {/* Encadré erreur — liste des marketplaces en erreur avec message détaillé */}
      {isError && <ErrorPanel group={group} onRetry={onRetry} onDismiss={onDismiss} />}
    </article>
  );
}

// ────────────────────────────────────────────────────────────────
// Case marketplace compacte — juste initiale + statut (Succès / En cours /
// Erreur / Non envoyé). Le détail des erreurs est affiché en dessous de
// la ligne dans ErrorPanel, une entrée par marketplace en erreur.
// ────────────────────────────────────────────────────────────────

function MarketplaceCellBox({
  target,
  cell,
}: {
  target: MarketplaceTarget;
  cell?: MarketplaceCell;
}) {
  const meta = MARKETPLACE_META[target];
  const kind = cell?.kind ?? "not-targeted";

  const tone = (() => {
    switch (kind) {
      case "done":
        return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" };
      case "error":
        return { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700" };
      case "active":
        return { bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700" };
      case "queued":
        return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800" };
      case "not-targeted":
      default:
        return { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-400" };
    }
  })();

  const label = (() => {
    switch (kind) {
      case "done":
        return "Succès";
      case "error":
        return "Erreur";
      case "active":
        return cell?.driver?.status === "awaiting_callback" ? "Attente" : "En cours";
      case "queued":
        return cell?.driver?.scheduledFor ? "Programmé" : "En attente";
      case "not-targeted":
      default:
        return "Non envoyé";
    }
  })();

  const errorMessage =
    kind === "error" && cell?.outcome && cell.outcome.ok === false
      ? cell.outcome.message
      : null;

  return (
    <div
      className={`rounded-lg border ${tone.bg} ${tone.border} px-2.5 py-2 flex items-center gap-2`}
      title={`${meta.name} — ${label}${errorMessage ? " : " + errorMessage : ""}`}
    >
      <span
        className="w-6 h-6 rounded-md text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0"
        style={{ background: meta.grad }}
      >
        {meta.letter}
      </span>
      <span className={`text-xs font-bold ${tone.text} truncate`}>{label}</span>
    </div>
  );
}

function pickDominantItem(items: MarketplaceRefreshItem[]): MarketplaceRefreshItem | null {
  if (items.length === 0) return null;
  const actives = items.filter(isItemActive);
  const pool = actives.length > 0 ? actives : items;
  return pool.reduce((best, cur) => (recencyOf(cur) >= recencyOf(best) ? cur : best));
}

function recencyOf(item: MarketplaceRefreshItem): number {
  if (isItemActive(item)) return Number.POSITIVE_INFINITY;
  if (item.completedAt) {
    const t = Date.parse(item.completedAt);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function ProductImage({
  src,
  alt,
  active,
  error,
}: {
  src: string | null;
  alt: string;
  active?: boolean;
  error?: boolean;
}) {
  const halo = error
    ? "ring-2 ring-rose-300"
    : active
      ? "ring-2 ring-sky-300"
      : "ring-1 ring-slate-200";
  const imgSrc = src ? getImageSrc(src) : null;
  return (
    <div className="relative w-16 h-16 flex-shrink-0">
      <div className={`w-full h-full rounded-xl overflow-hidden ${halo} bg-gradient-to-br from-slate-100 to-slate-200`}>
        {imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgSrc} alt={alt} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400 font-medium">
            IMG
          </div>
        )}
      </div>
      {active && (
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-sky-500 ring-2 ring-white flex items-center justify-center z-10">
          <svg className="w-3 h-3 text-white animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6" />
          </svg>
        </div>
      )}
    </div>
  );
}

function ActionChip({ view }: { view: ViewKey }) {
  const accent = VIEW_ACCENT[view];
  const meta = VIEW_LABEL[view];
  return (
    <span className={`px-2 py-0.5 rounded-md ${accent.chip} ${accent.chipText} text-[11px] uppercase tracking-widest font-bold`}>
      {meta.title}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────
// Encadré erreur détaillé — 1 bloc par marketplace en erreur
// ────────────────────────────────────────────────────────────────

function ErrorPanel({
  group,
  onRetry,
  onDismiss,
}: {
  group: ProductGroup;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  // Collecte les erreurs par marketplace
  const errors: { target: MarketplaceTarget; message: string }[] = [];
  for (const m of MARKETPLACE_ORDER) {
    const cell = group.cells[m];
    if (cell?.kind === "error" && cell.outcome && cell.outcome.ok === false) {
      errors.push({ target: m, message: cell.outcome.message });
    }
  }
  if (errors.length === 0) return null;

  return (
    <div className="mx-4 mb-4 rounded-xl bg-rose-50 border border-rose-200 p-4 space-y-3">
      {errors.map((err) => {
        const meta = MARKETPLACE_META[err.target];
        return (
          <div key={err.target} className="flex items-start gap-3">
            <div
              className="w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
              style={{ background: meta.grad }}
            >
              {meta.letter}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-rose-800">
                {meta.name} — {err.message.split(":")[0] || "Erreur"}
              </div>
              <div className="text-[13px] text-rose-700 mt-1 leading-snug">{err.message}</div>
            </div>
          </div>
        );
      })}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onRetry}
          className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold transition"
        >
          Relancer
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 text-sm font-bold transition"
        >
          Ignorer
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Ligne spécifique aux LinkJob (client-side)
// ────────────────────────────────────────────────────────────────

function LinkJobRow({ job, onDismiss }: { job: LinkJobLike; onDismiss: () => void }) {
  const meta = MARKETPLACE_META[job.marketplace];
  const isError = job.status === "error";
  const isActive = job.status === "in_progress";
  const isDone = job.status === "done";

  const borderClass = isError ? "border-2 border-rose-200" : "border border-slate-200";

  return (
    <article className={`bg-white rounded-2xl ${borderClass} overflow-hidden`}>
      <div className="p-4 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex items-center gap-3 md:w-[300px] md:flex-shrink-0 min-w-0">
          <ProductImage src={job.productImage} alt={job.productName} active={isActive} error={isError} />
          <div className="flex-1 min-w-0">
            <span className="inline-block px-2 py-0.5 rounded-md bg-fuchsia-100 text-fuchsia-700 text-[11px] uppercase tracking-widest font-bold mb-1">
              Liaison
            </span>
            <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">
              {job.productName}
            </h3>
            <div className="text-xs text-slate-400 font-mono truncate mt-0.5">{job.reference}</div>
          </div>
        </div>

        <div className="flex-1 flex items-center gap-3 min-w-0">
          <span
            className="w-8 h-8 rounded-lg text-white text-xs font-bold flex items-center justify-center flex-shrink-0"
            style={{ background: meta.grad }}
          >
            {meta.letter}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-500 font-medium">→ Vers {meta.name}</div>
            {isDone && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] leading-snug mt-1">
                {job.linkedCount !== undefined && job.linkedCount > 0 && (
                  <span className="text-emerald-700 font-semibold">
                    ✓ {job.linkedCount} liée{job.linkedCount > 1 ? "s" : ""}
                  </span>
                )}
                {job.createdCount !== undefined && job.createdCount > 0 && (
                  <span className="text-sky-700 font-semibold">
                    ＋ {job.createdCount} créée{job.createdCount > 1 ? "s" : ""}
                  </span>
                )}
                {job.deletedCount !== undefined && job.deletedCount > 0 && (
                  <span className="text-rose-700 font-semibold">
                    − {job.deletedCount} suppr.
                  </span>
                )}
                {job.importedCount !== undefined && job.importedCount > 0 && (
                  <span className="text-emerald-700 font-semibold">
                    ⇩ {job.importedCount} import.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {!isActive && (
          <div className="flex md:flex-col items-center md:items-end gap-1.5 md:w-[90px] md:flex-shrink-0">
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs text-slate-400 hover:text-slate-700 font-semibold"
            >
              ✕ Retirer
            </button>
          </div>
        )}
      </div>

      {isError && job.error && (
        <div className="mx-4 mb-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 leading-snug">
          {job.error}
        </div>
      )}
    </article>
  );
}

// ────────────────────────────────────────────────────────────────
// Helpers temps
// ────────────────────────────────────────────────────────────────

function useNowTick(intervalMs: number | null): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Compteur de durée en direct. Tick 100 ms tant que `completedAtMs` est null,
 * puis se fige sur la valeur finale. Format : X.Y s < 1 min, sinon X min YY s.
 * Isolé dans son propre composant pour ne pas re-render l'arbre entier.
 */
function LiveDuration({
  startedAtMs,
  completedAtMs,
}: {
  startedAtMs: number;
  completedAtMs: number | null;
}) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (completedAtMs !== null) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [completedAtMs]);
  const ms =
    completedAtMs !== null ? completedAtMs - startedAtMs : Math.max(0, now - startedAtMs);
  return <>{formatDurationLive(ms)}</>;
}

export function formatDurationLive(ms: number): string {
  if (ms < 1000) return `${Math.floor(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 3600) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m} min ${String(s).padStart(2, "0")} s`;
  }
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

function formatCountdownMMSS(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDurationHuman(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min`;
  const h = Math.floor(ms / (60 * 60_000));
  const remainMin = Math.round((ms - h * 60 * 60_000) / 60_000);
  if (remainMin === 0) return `${h} h`;
  return `${h} h ${String(remainMin).padStart(2, "0")}`;
}

function formatClockTime(atMs: number): string {
  const d = new Date(atMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function outcomeForMarketplace(
  item: MarketplaceRefreshItem,
  target: MarketplaceTarget,
): TargetOutcome | undefined {
  if (target === "ankorstore") return item.ankorsOutcome;
  if (target === "efashion") return item.efashionOutcome;
  if (target === "faire") return item.faireOutcome;
  if (target === "orderchamp") return item.orderchampOutcome;
  if (target === "microstore") return item.microstoreOutcome;
  return item.pfsOutcome;
}

// ────────────────────────────────────────────────────────────────
// Legacy compat — export conservé pour les tests hérités
// ────────────────────────────────────────────────────────────────

export interface LegacyErrorGroup {
  productId: string;
  productName: string;
  reference: string;
  firstImage: string | null;
  latestCompletedAt: string | null;
  items: MarketplaceRefreshItem[];
}

export function groupErrorsByProduct(
  items: ReadonlyArray<MarketplaceRefreshItem>,
): LegacyErrorGroup[] {
  const map = new Map<string, LegacyErrorGroup>();
  const order: string[] = [];
  for (const it of items) {
    if (!itemHasError(it)) continue;
    const cur = map.get(it.productId);
    if (cur) {
      cur.items.push(it);
      if (it.firstImage) cur.firstImage = it.firstImage;
      if (it.productName) cur.productName = it.productName;
      if (it.completedAt) {
        if (!cur.latestCompletedAt || it.completedAt > cur.latestCompletedAt) {
          cur.latestCompletedAt = it.completedAt;
        }
      }
    } else {
      map.set(it.productId, {
        productId: it.productId,
        productName: it.productName,
        reference: it.reference,
        firstImage: it.firstImage,
        latestCompletedAt: it.completedAt ?? null,
        items: [it],
      });
      order.push(it.productId);
    }
  }
  return order.map((pid) => map.get(pid)!).filter(Boolean);
}
