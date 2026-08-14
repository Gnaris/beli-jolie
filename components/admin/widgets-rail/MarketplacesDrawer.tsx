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
 *   - Bloc erreur détaillé avec cause FR + boutons Rejouer / Ignorer
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
  type JobStepEntry,
  type MarketplaceRefreshItem,
  type MarketplaceTarget,
  type TargetOutcome,
} from "@/components/admin/products/MarketplaceRefreshContext";
import {
  useMarketplaceLinkJobs,
  type LinkJob,
} from "@/components/admin/products/MarketplaceLinkContext";
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

// Libellés FR par défaut des kinds d'étapes. Doit rester aligné avec
// lib/marketplace-job-steps.ts::STEP_LABELS (dupliqué ici pour ne pas importer
// un module serveur dans un fichier client).
const STEP_LABELS_FR: Record<string, string> = {
  VALIDATE: "Validation des données",
  AUTH: "Authentification marketplace",
  DIFF: "Calcul du diff",
  FETCH_REMOTE: "Lecture de l'état marketplace",
  CREATE_PRODUCT: "Création du produit",
  UPDATE_PRODUCT: "Mise à jour du produit",
  CREATE_VARIANTS: "Création des variantes",
  UPDATE_VARIANTS: "Mise à jour des variantes",
  DELETE_VARIANTS: "Suppression des variantes orphelines",
  UPLOAD_IMAGES: "Upload des images",
  SYNC_ATTRIBUTES: "Sync composition et attributs",
  ARCHIVE_OLD: "Archivage de l'ancienne fiche",
  RENAME: "Renommage de la référence",
  PUBLISH: "Publication finale",
  SAVE_IDS: "Sauvegarde des identifiants",
  IMPORT_VARIANT: "Import de la variante",
  LINK_IDS: "Liaison des identifiants",
  POST_SYNC: "Synchronisation complète post-liaison",
};

// Couleurs figées par marketplace (cf. CLAUDE.md — bloc « Couleurs des initiales »).
const MARKETPLACE_META: Record<MarketplaceTarget, { letter: string; name: string; grad: string }> = {
  pfs: { letter: "P", name: "PFS", grad: "linear-gradient(135deg,#4f46e5,#6366f1)" },
  ankorstore: { letter: "A", name: "Ankorstore", grad: "linear-gradient(135deg,#0ea5e9,#38bdf8)" },
  efashion: { letter: "E", name: "eFashion", grad: "linear-gradient(135deg,#db2777,#ec4899)" },
  faire: { letter: "F", name: "Faire", grad: "linear-gradient(135deg,#f59e0b,#fbbf24)" },
};

const VIEW_ACCENT: Record<ViewKey, { chip: string; chipText: string; barActive: string; icon: React.ReactNode }> = {
  creation: {
    chip: "bg-blue-100",
    chipText: "text-blue-700",
    barActive: "bg-gradient-to-r from-blue-600 to-cyan-500",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
  },
  update: {
    chip: "bg-emerald-100",
    chipText: "text-emerald-700",
    barActive: "bg-gradient-to-r from-emerald-600 to-emerald-400",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
        />
      </svg>
    ),
  },
  link: {
    chip: "bg-fuchsia-100",
    chipText: "text-fuchsia-700",
    barActive: "bg-gradient-to-r from-fuchsia-600 to-pink-400",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
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
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
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
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
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
type MarketplaceFilter = "all" | MarketplaceTarget;

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
  const [marketplaceFilter, setMarketplaceFilter] = useState<MarketplaceFilter>("all");

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
        "Rejoué",
        `${inputs.length} envoi${inputs.length > 1 ? "s" : ""} en erreur re-planifié${inputs.length > 1 ? "s" : ""}.`,
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
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-500 tabular-nums">
              {totalProcessed} / {totalPlanned} traités
            </span>
            <div className="flex items-center gap-2">
              {queuedCount > 0 && (
                <button
                  type="button"
                  onClick={() => void onStopQueued()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 font-semibold hover:bg-rose-200 transition-colors"
                >
                  Arrêter ({queuedCount})
                </button>
              )}
              <button
                type="button"
                onClick={clearDone}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 transition-colors"
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
          <div className="flex-shrink-0 px-4 pt-3 pb-2">
            <div className="grid grid-cols-4 gap-1.5">
              <KpiTile label="En cours" value={activeCount - queuedCount} tone="sky" pulse={activeCount > 0} />
              <KpiTile label="En attente" value={queuedCount} tone="slate" />
              <KpiTile label="Erreurs" value={errorCount + linkErrorCount} tone="rose" />
              <KpiTile label="Terminés" value={totalProcessed} tone="emerald" />
            </div>
          </div>
        )}

        {/* ─── Onglets (5 vues) ─── */}
        <div className="flex-shrink-0 px-3 border-b border-slate-200 overflow-x-auto scrollbar-none">
          <div className="flex gap-1">
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
                  className={`relative flex items-center gap-1.5 px-2.5 py-2 text-[11px] font-bold whitespace-nowrap transition-colors border-b-2 ${
                    isActive
                      ? `${accent.chipText} border-current`
                      : "text-slate-500 hover:text-slate-700 border-transparent"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className={`w-5 h-5 rounded-md flex items-center justify-center ${isActive ? accent.chip : "bg-slate-100"} ${isActive ? accent.chipText : "text-slate-500"}`}>
                    {accent.icon}
                  </span>
                  <span>{meta.title}</span>
                  {badge > 0 && (
                    <span
                      className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold tabular-nums ${
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

        {/* ─── Filtres marketplace + statut ─── */}
        {activeView && (activeView.groups.length > 0 || activeView.linkJobs.length > 0) && (
          <div className="flex-shrink-0 px-4 py-2 bg-white border-b border-slate-200 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[9px] uppercase tracking-widest text-slate-400 font-bold mr-1">Marketplaces</span>
              <FilterChip
                active={marketplaceFilter === "all"}
                onClick={() => setMarketplaceFilter("all")}
                label="Tous"
                variant="dark"
              />
              {MARKETPLACE_ORDER.map((m) => (
                <MarketplaceInitialChip
                  key={m}
                  target={m}
                  active={marketplaceFilter === m}
                  onClick={() => setMarketplaceFilter(marketplaceFilter === m ? "all" : m)}
                />
              ))}
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-1">
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
                className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-100 text-rose-700 text-[11px] font-bold hover:bg-rose-200 transition"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0113.5-4M20 14a8 8 0 01-13.5 4" />
                </svg>
                Rejouer les {activeView.kpi.errors} erreurs
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
              marketplaceFilter={marketplaceFilter}
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
    <div className="p-6 h-full min-h-[280px] flex items-center justify-center text-center">
      <div>
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 flex items-center justify-center text-sky-500 mb-3">
          {MARKETPLACES_ICON}
        </div>
        <p className="text-sm font-semibold text-slate-700">Aucune synchro en cours</p>
        <p className="text-[11px] text-slate-500 mt-1 max-w-[280px] mx-auto">
          Vos envois vers PFS, Ankorstore, eFashion et Faire s'afficheront ici, rangés par type d'action.
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
    <div className={`rounded-lg border px-2 py-1.5 ${toneClasses[tone]}`}>
      <div className="text-[9px] uppercase tracking-widest font-bold opacity-80">{label}</div>
      <div className="flex items-center gap-1 mt-0.5">
        <span className="text-lg font-bold tabular-nums leading-none">{value}</span>
        {pulse && value > 0 && (
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 animate-pulse" />
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
  const base = "px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors";
  const styles = active
    ? variant === "dark"
      ? "bg-slate-900 text-white"
      : "bg-sky-100 text-sky-700"
    : "text-slate-500 hover:bg-slate-100";
  return (
    <button type="button" onClick={onClick} className={`${base} ${styles}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      {label}
    </button>
  );
}

function MarketplaceInitialChip({
  target,
  active,
  onClick,
}: {
  target: MarketplaceTarget;
  active: boolean;
  onClick: () => void;
}) {
  const meta = MARKETPLACE_META[target];
  return (
    <button
      type="button"
      onClick={onClick}
      title={meta.name}
      style={{ background: meta.grad }}
      className={`w-6 h-6 rounded-md text-white text-[10px] font-bold flex items-center justify-center transition ${
        active ? "ring-2 ring-offset-1 ring-slate-900" : "opacity-80 hover:opacity-100"
      }`}
    >
      {meta.letter}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────
// Contenu d'une vue (liste de cartes + éventuelle timeline étalement)
// ────────────────────────────────────────────────────────────────

function ViewContent({
  view,
  statusFilter,
  marketplaceFilter,
  nowMs,
  onRetry,
  onDismiss,
  onDismissLinkJob,
}: {
  view: ViewBucketProduct;
  statusFilter: StatusFilter;
  marketplaceFilter: MarketplaceFilter;
  nowMs: number;
  onRetry: (group: ProductGroup) => void;
  onDismiss: (group: ProductGroup) => void;
  onDismissLinkJob: (id: string) => void;
}) {
  const filteredGroups = useMemo(() => {
    let arr = view.groups.slice();

    // Filtre marketplace : masque les cartes dont AUCUN item ne cible la marketplace choisie
    if (marketplaceFilter !== "all") {
      arr = arr.filter((g) => g.items.some((it) => it.marketplace === marketplaceFilter));
    }

    // Filtre statut : errors / active / done / all
    if (statusFilter === "errors") {
      arr = arr.filter((g) => g.section === "errors");
    } else if (statusFilter === "active") {
      arr = arr.filter((g) => g.section === "active" || g.section === "queued" || g.section === "scheduled");
    } else if (statusFilter === "done") {
      arr = arr.filter((g) => g.section === "done");
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
  }, [view.groups, statusFilter, marketplaceFilter]);

  const filteredLinkJobs = useMemo(() => {
    if (view.key !== "link") return [];
    let arr = view.linkJobs.slice();
    if (marketplaceFilter !== "all") arr = arr.filter((j) => j.marketplace === marketplaceFilter);
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
  }, [view.key, view.linkJobs, statusFilter, marketplaceFilter]);

  if (filteredGroups.length === 0 && filteredLinkJobs.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-slate-500">Rien à afficher dans cette vue avec les filtres actifs.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {view.key === "scheduled" && (
        <ScheduleHeader view={view} groups={filteredGroups} nowMs={nowMs} />
      )}
      {filteredGroups.map((group) => (
        <ProductJobCard
          key={`${group.productId}::${group.dominantMode}`}
          group={group}
          view={view.key}
          nowMs={nowMs}
          onRetry={() => onRetry(group)}
          onDismiss={() => onDismiss(group)}
        />
      ))}
      {filteredLinkJobs.map((job) => (
        <LinkJobCard key={job.id} job={job} onDismiss={() => onDismissLinkJob(job.id)} />
      ))}
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
    <div className="rounded-2xl bg-gradient-to-br from-amber-50 via-white to-amber-50 border-2 border-amber-200 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0 text-amber-700">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-bold text-amber-700">
            Planificateur actif
          </div>
          <div className="text-sm font-bold text-slate-800 mt-0.5">
            {remaining} rafraîchissement{remaining > 1 ? "s" : ""} étalé{remaining > 1 ? "s" : ""}
            {intervalMs !== null && <> · 1 toutes les {formatDurationHuman(intervalMs)}</>}
          </div>
          <div className="text-[11px] text-slate-600 mt-1">
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
      <div className="mt-4 grid grid-cols-6 gap-1.5">
        {groups.slice(0, 6).map((g, idx) => {
          const atMs = g.earliestScheduledFor ? Date.parse(g.earliestScheduledFor) : null;
          const isNext = idx === 0;
          return (
            <div
              key={g.productId}
              className={`rounded-lg border p-1.5 text-center ${
                isNext
                  ? "bg-amber-100 border-amber-400 ring-2 ring-amber-200"
                  : "bg-white border-slate-200"
              }`}
              title={g.productName}
            >
              <div className="text-[9px] font-semibold text-slate-500">
                {atMs !== null ? formatClockTime(atMs) : "—"}
              </div>
              <div className="text-[9px] font-bold text-slate-700 truncate mt-0.5">
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
// Carte produit d'un job marketplace
// ────────────────────────────────────────────────────────────────

function ProductJobCard({
  group,
  view,
  nowMs,
  onRetry,
  onDismiss,
}: {
  group: ProductGroup;
  view: ViewKey;
  nowMs: number;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const isError = group.section === "errors";
  const isDone = group.section === "done";
  const isActive = group.section === "active";
  const isScheduled = group.section === "scheduled";
  const isQueued = group.section === "queued";

  // On prend l'item le plus récent comme source de steps + outcome à afficher.
  const dominantItem = pickDominantItem(group.items);
  const steps = Array.isArray(dominantItem?.steps) ? dominantItem?.steps ?? [] : [];
  const targetedMarketplaces = uniqueMarketplaces(group.items);

  // Durée écoulée si actif, ou durée totale si terminé
  const startedAtMs = dominantItem?.startedAt ? Date.parse(dominantItem.startedAt) : null;
  const completedAtMs = dominantItem?.completedAt ? Date.parse(dominantItem.completedAt) : null;
  const durationMs =
    startedAtMs !== null && completedAtMs !== null
      ? completedAtMs - startedAtMs
      : startedAtMs !== null
        ? nowMs - startedAtMs
        : null;

  const cardBorder = isError ? "border-2 border-rose-200" : "border border-slate-200";
  const cardShadow = isError ? "shadow-sm shadow-rose-100" : "";

  return (
    <article className={`bg-white rounded-2xl ${cardBorder} ${cardShadow} overflow-hidden transition-shadow hover:shadow-md`}>
      {/* Header */}
      <div className="p-3 flex items-start gap-3">
        <ProductImage src={group.firstImage} alt={group.productName} active={isActive} error={isError} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <ActionChip view={view} />
            {isError && (
              <span className="px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 text-[9px] uppercase tracking-widest font-bold">
                Erreur
              </span>
            )}
            {isScheduled && dominantItem?.scheduledFor && (
              <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[9px] uppercase tracking-widest font-bold">
                À {formatClockTime(Date.parse(dominantItem.scheduledFor))}
              </span>
            )}
            <span className="text-[10px] text-slate-400 font-mono">{group.reference}</span>
          </div>
          <h3 className="text-[13px] font-bold text-slate-900 leading-tight line-clamp-2">
            {group.productName}
          </h3>
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {targetedMarketplaces.map((m) => {
              const cell = group.cells[m];
              return <MarketplaceChip key={m} target={m} cell={cell} />;
            })}
            {durationMs !== null && (
              <span className="ml-auto text-[10px] text-slate-400 tabular-nums">
                {isDone ? "en " : ""}{formatDurationHuman(durationMs)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Barre de progression globale — visible si actif */}
      {isActive && steps.length > 0 && (
        <div className="px-3 pb-2">
          <StepsProgress steps={steps} />
        </div>
      )}

      {/* Encadré erreur — visible si erreur */}
      {isError && (
        <ErrorPanel group={group} onRetry={onRetry} onDismiss={onDismiss} />
      )}

      {/* Timeline détaillée des étapes */}
      {steps.length > 0 && (
        <div className="px-3 pb-3">
          <div className="rounded-xl bg-slate-50/50 border border-slate-100 p-3">
            <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-2.5">
              Étapes détaillées
            </div>
            <StepsTimeline steps={steps} />
          </div>
        </div>
      )}

      {/* Footer actions — visible sur done/queued/scheduled */}
      {!isActive && !isError && (
        <div className="px-3 pb-2.5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="text-[10px] text-slate-400 hover:text-slate-700 font-semibold px-1"
          >
            ✕ Retirer
          </button>
        </div>
      )}
    </article>
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

function uniqueMarketplaces(items: MarketplaceRefreshItem[]): MarketplaceTarget[] {
  const set = new Set<MarketplaceTarget>();
  for (const it of items) set.add(it.marketplace);
  return MARKETPLACE_ORDER.filter((m) => set.has(m));
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
    <div className={`relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 ${halo} bg-gradient-to-br from-slate-100 to-slate-200`}>
      {imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imgSrc} alt={alt} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400 font-medium">
          IMG
        </div>
      )}
      {active && (
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-sky-500 ring-2 ring-white flex items-center justify-center">
          <svg className="w-2.5 h-2.5 text-white animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
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
    <span className={`px-1.5 py-0.5 rounded-md ${accent.chip} ${accent.chipText} text-[9px] uppercase tracking-widest font-bold`}>
      {meta.title}
    </span>
  );
}

function MarketplaceChip({ target, cell }: { target: MarketplaceTarget; cell?: MarketplaceCell }) {
  const meta = MARKETPLACE_META[target];
  const status = cell?.kind ?? "not-targeted";
  const statusDot =
    status === "done"
      ? "bg-emerald-500"
      : status === "error"
        ? "bg-rose-500"
        : status === "active"
          ? "bg-sky-500 animate-pulse"
          : status === "queued"
            ? "bg-amber-400"
            : "bg-slate-300";
  return (
    <span
      title={`${meta.name} — ${statusLabel(status)}`}
      className="relative w-5 h-5 rounded-md text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0"
      style={{ background: meta.grad }}
    >
      {meta.letter}
      <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 ring-white ${statusDot}`} />
    </span>
  );
}

function statusLabel(kind: MarketplaceCell["kind"]): string {
  switch (kind) {
    case "done":
      return "Terminé";
    case "error":
      return "Erreur";
    case "active":
      return "En cours";
    case "queued":
      return "En attente";
    case "not-targeted":
      return "Non ciblé";
  }
}

// ────────────────────────────────────────────────────────────────
// Barre de progression + Timeline verticale des étapes
// ────────────────────────────────────────────────────────────────

function StepsProgress({ steps }: { steps: JobStepEntry[] }) {
  const total = steps.length;
  const done = steps.filter((s) => s.status === "done" || s.status === "error" || s.status === "skipped").length;
  const inProgress = steps.find((s) => s.status === "in_progress");
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div>
      <div className="flex items-center gap-2 text-[10px] mb-1">
        <span className="font-bold text-slate-600">
          Étape {done + (inProgress ? 1 : 0)}/{total}
        </span>
        {inProgress && (
          <>
            <span className="text-slate-400">·</span>
            <span className="text-sky-700 font-semibold truncate">
              {inProgress.label ?? STEP_LABELS_FR[inProgress.kind] ?? inProgress.kind}
            </span>
          </>
        )}
        <span className="ml-auto tabular-nums font-bold text-sky-600">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden relative">
        <div
          className="h-full bg-gradient-to-r from-sky-400 via-sky-500 to-sky-600 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StepsTimeline({ steps }: { steps: JobStepEntry[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, idx) => (
        <StepRow key={`${step.kind}-${idx}`} step={step} isLast={idx === steps.length - 1} />
      ))}
    </ol>
  );
}

function StepRow({ step, isLast }: { step: JobStepEntry; isLast: boolean }) {
  const label = step.label ?? STEP_LABELS_FR[step.kind] ?? step.kind;
  const durationMs = stepDuration(step);

  let dot: React.ReactNode;
  let line: string;
  let labelClass: string;
  switch (step.status) {
    case "done":
      dot = (
        <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center ring-2 ring-emerald-50">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
      line = "bg-emerald-200";
      labelClass = "text-slate-800 font-bold";
      break;
    case "in_progress":
      dot = (
        <div className="w-5 h-5 rounded-full bg-sky-500 flex items-center justify-center ring-2 ring-sky-100">
          <svg className="w-3 h-3 text-white animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6" />
          </svg>
        </div>
      );
      line = "bg-sky-200 opacity-50";
      labelClass = "text-sky-800 font-bold";
      break;
    case "error":
      dot = (
        <div className="w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center ring-2 ring-rose-50">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      );
      line = "bg-rose-200";
      labelClass = "text-rose-800 font-bold";
      break;
    case "skipped":
      dot = (
        <div className="w-5 h-5 rounded-full bg-slate-200 border-2 border-slate-300 flex items-center justify-center">
          <div className="w-1 h-1 rounded-full bg-slate-400" />
        </div>
      );
      line = "bg-slate-100";
      labelClass = "text-slate-500 font-semibold italic";
      break;
    case "pending":
    default:
      dot = (
        <div className="w-5 h-5 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center">
          <div className="w-1 h-1 rounded-full bg-slate-300" />
        </div>
      );
      line = "bg-slate-100";
      labelClass = "text-slate-400 font-semibold";
      break;
  }

  return (
    <li className="flex items-start gap-2.5 relative">
      <div className="relative flex-shrink-0 pt-0.5">
        {dot}
        {!isLast && <div className={`absolute left-1/2 top-5 w-px h-5 -translate-x-1/2 ${line}`} />}
      </div>
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-center gap-2">
          <div className={`text-[12px] leading-tight ${labelClass}`}>{label}</div>
          {step.total !== undefined && step.current !== undefined && step.status === "in_progress" && (
            <span className="text-[10px] text-sky-600 tabular-nums font-bold">
              {step.current}/{step.total}
            </span>
          )}
          {durationMs !== null && (
            <span className="ml-auto text-[10px] text-slate-400 tabular-nums">
              {formatDurationHuman(durationMs)}
            </span>
          )}
        </div>
        {step.message && (
          <div
            className={`text-[10.5px] leading-snug mt-0.5 ${
              step.status === "error" ? "text-rose-700" : "text-slate-500"
            }`}
          >
            {step.message}
          </div>
        )}
      </div>
    </li>
  );
}

function stepDuration(step: JobStepEntry): number | null {
  if (!step.startedAt) return null;
  const start = Date.parse(step.startedAt);
  if (!Number.isFinite(start)) return null;
  const end = step.completedAt ? Date.parse(step.completedAt) : Date.now();
  if (!Number.isFinite(end) || end < start) return null;
  return end - start;
}

// ────────────────────────────────────────────────────────────────
// Encadré erreur détaillé
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
    <div className="mx-3 mb-3 rounded-xl bg-rose-50 border border-rose-200 p-3 space-y-2">
      {errors.map((err) => {
        const meta = MARKETPLACE_META[err.target];
        return (
          <div key={err.target} className="flex items-start gap-2">
            <div
              className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
              style={{ background: meta.grad }}
            >
              {meta.letter}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold text-rose-800">
                {meta.name} — {err.message.split(":")[0] || "Erreur"}
              </div>
              <div className="text-[10.5px] text-rose-700 mt-0.5 leading-snug">{err.message}</div>
            </div>
          </div>
        );
      })}
      <div className="flex gap-1.5 pt-1">
        <button
          type="button"
          onClick={onRetry}
          className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[10.5px] font-bold transition"
        >
          Rejouer
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-2.5 py-1 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 text-[10.5px] font-bold transition"
        >
          Ignorer
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Carte spécifique aux LinkJob (client-side)
// ────────────────────────────────────────────────────────────────

function LinkJobCard({ job, onDismiss }: { job: LinkJob; onDismiss: () => void }) {
  const meta = MARKETPLACE_META[job.marketplace];
  const isDone = job.status === "done";
  const isError = job.status === "error";
  const isActive = job.status === "in_progress";

  const borderClass = isError ? "border-2 border-rose-200" : "border border-slate-200";

  return (
    <article className={`bg-white rounded-2xl ${borderClass} p-3`}>
      <div className="flex items-start gap-3">
        <ProductImage src={job.productImage} alt={job.productName} active={isActive} error={isError} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="px-1.5 py-0.5 rounded-md bg-fuchsia-100 text-fuchsia-700 text-[9px] uppercase tracking-widest font-bold">
              Liaison
            </span>
            <span className="text-[10px] text-slate-400 font-mono">{job.reference}</span>
          </div>
          <h3 className="text-[13px] font-bold text-slate-900 leading-tight line-clamp-2">
            {job.productName}
          </h3>
          <div className="flex items-center gap-2 mt-1.5">
            <span
              className="w-5 h-5 rounded-md text-white text-[9px] font-bold flex items-center justify-center"
              style={{ background: meta.grad }}
            >
              {meta.letter}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">→ Vers {meta.name}</span>
          </div>
        </div>
      </div>

      {isDone && (
        <div className="mt-2 space-y-0.5 text-[11px] leading-snug pl-1">
          {job.linkedCount !== undefined && job.linkedCount > 0 && (
            <div className="text-emerald-700 font-semibold">
              ✓ {job.linkedCount} variante{job.linkedCount > 1 ? "s" : ""} liée{job.linkedCount > 1 ? "s" : ""}
            </div>
          )}
          {job.createdCount !== undefined && job.createdCount > 0 && (
            <div className="text-sky-700 font-semibold">
              ＋ {job.createdCount} couleur{job.createdCount > 1 ? "s" : ""} créée{job.createdCount > 1 ? "s" : ""} chez le marketplace
            </div>
          )}
          {job.deletedCount !== undefined && job.deletedCount > 0 && (
            <div className="text-rose-700 font-semibold">
              − {job.deletedCount} variante{job.deletedCount > 1 ? "s" : ""} supprimée{job.deletedCount > 1 ? "s" : ""}
            </div>
          )}
          {job.importedCount !== undefined && job.importedCount > 0 && (
            <div className="text-emerald-700 font-semibold">
              ⇩ {job.importedCount} variante{job.importedCount > 1 ? "s" : ""} importée{job.importedCount > 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {isError && job.error && (
        <div className="mt-2 rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-[11px] text-rose-700 leading-snug">
          {job.error}
        </div>
      )}

      {!isActive && (
        <div className="mt-2 flex items-center justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="text-[10px] text-slate-400 hover:text-slate-700 font-semibold px-1"
          >
            ✕ Retirer
          </button>
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
