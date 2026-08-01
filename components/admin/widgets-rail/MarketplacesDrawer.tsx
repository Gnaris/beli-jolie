"use client";

/**
 * Tiroir « Synchro marketplaces » — refonte 2026-07-28.
 *
 * 4 colonnes côte à côte par TYPE D'ACTION (drawer size="wide") :
 *   - Modifications       (emerald) — mode publish
 *   - Rafraîchissements   (sky)     — mode refresh, seul à afficher le bandeau
 *                                     "Prochain départ" quand un lot est étalé
 *   - Synchronisations    (violet)  — mode resync
 *   - Liaisons            (fuchsia) — jobs MarketplaceLinkContext
 *
 * Chaque colonne a :
 *   - un en-tête (icône + libellé + compteur total)
 *   - un bandeau KPI 4 tuiles (Err. · Cours · Att. · OK)
 *   - une liste défilante de cartes produit
 *
 * Chaque carte produit (colonnes publish/refresh/resync) garde ses 4 badges
 * P/A/E/F pour voir l'état par marketplace. Les cartes de la colonne
 * « Liaisons » n'ont qu'un badge « → Vers <marketplace> » puisqu'une liaison
 * ne concerne qu'une seule marketplace à la fois.
 *
 * Le regroupement (produit + mode) reste dans marketplacesDrawerModel.ts et
 * est couvert par des tests Vitest.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import {
  MarketplaceBadge,
  MarketplaceTooltipHost,
  type TooltipHandle,
  type TooltipTone,
} from "./MarketplaceBadgeTooltip";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  useMarketplaceRefreshQueue,
  type MarketplaceRefreshItem,
  type MarketplaceTarget,
  type QueueItemMode,
} from "@/components/admin/products/MarketplaceRefreshContext";
import {
  useMarketplaceLinkJobs,
  type LinkJob,
} from "@/components/admin/products/MarketplaceLinkContext";
import { getImageSrc } from "@/lib/image-utils";
import {
  bucketColumns,
  cellCopyable,
  cellTooltipBody,
  cellTooltipTitle,
  COLUMN_LABEL,
  COLUMN_ORDER,
  groupItemsByProductAndMode,
  MARKETPLACE_LABEL,
  MARKETPLACE_ORDER,
  type ColumnBucket,
  type ColumnKey,
  type MarketplaceCell,
  type ProductGroup,
} from "./marketplacesDrawerModel";

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
// Drawer
// ────────────────────────────────────────────────────────────────

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

  const nowMs = useNowTick(items.some((i) => Boolean(i.scheduledFor)) ? 1_000 : null);

  const groups = useMemo(
    () => groupItemsByProductAndMode(items, nowMs),
    [items, nowMs],
  );

  const columns = useMemo(
    () => bucketColumns(groups, linkJobs),
    [groups, linkJobs],
  );

  const errorCount = columns.reduce((n, c) => n + c.kpi.errors, 0);
  const activeCount = columns.reduce(
    (n, c) => n + c.kpi.active + c.kpi.queued,
    0,
  );
  const totalProcessed = columns.reduce((n, c) => n + c.kpi.done, 0);
  const totalPlanned =
    totalProcessed + activeCount + errorCount;
  const pct = totalPlanned === 0 ? 0 : Math.round((totalProcessed / totalPlanned) * 100);

  const linkErrorCount = linkJobs.filter((j) => j.status === "error").length;

  useEffect(() => {
    const totalErr = errorCount + linkErrorCount;
    setBadge("marketplaces", {
      count: activeCount || totalErr,
      pulse: activeCount > 0 || totalErr > 0,
    });
  }, [activeCount, errorCount, linkActiveCount, linkErrorCount, setBadge]);

  const title =
    activeCount > 0
      ? `${runningCount + queuedCount} produit${runningCount + queuedCount > 1 ? "s" : ""} en cours`
      : errorCount > 0
      ? `${errorCount} erreur${errorCount > 1 ? "s" : ""}`
      : totalProcessed > 0
      ? `${totalProcessed} terminé${totalProcessed > 1 ? "s" : ""}`
      : "Aucune activité";

  const tooltipHandle = useRef<TooltipHandle | null>(null);

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

  const onStopMode = async (mode: QueueItemMode, queuedCountForMode: number) => {
    if (queuedCountForMode === 0) return;
    const noun = COLUMN_LABEL[mode].short;
    const label = `${queuedCountForMode} ${noun}${queuedCountForMode > 1 ? "s" : ""} en attente`;
    const ok = await confirm({
      type: "warning",
      title: `Arrêter les ${noun}s suivants ?`,
      message: `${label} ${queuedCountForMode > 1 ? "seront retirés" : "sera retiré"} de la file. Les envois déjà démarrés se terminent normalement.`,
      confirmLabel: "Arrêter cette catégorie",
    });
    if (!ok) return;
    stop(mode);
    toast.success(
      "Catégorie arrêtée",
      `${label} retiré${queuedCountForMode > 1 ? "s" : ""}. Les autres actions continuent normalement.`,
    );
  };

  const dismissGroup = (group: ProductGroup) => {
    // Ne cible que les items qu'on a le droit de retirer (queued / done / erreur).
    // Les items en vol (in_progress / awaiting_callback) restent — sinon on
    // couperait un appel marketplace au milieu.
    const ids = group.items
      .filter(
        (it) =>
          it.status === "queued" || it.status === "done",
      )
      .map((it) => it.id);
    if (ids.length > 0) dismiss(ids);
  };

  // Vide UNIQUEMENT les cartes ✓ Terminé d'une colonne. Les erreurs restent
  // (visibles pour retry) et les en-cours/queued restent (« Arrêter » les
  // gère). Demande cliente 2026-07-31.
  const clearDoneInColumn = (bucket: ColumnBucket) => {
    if (bucket.key === "link") {
      for (const job of bucket.linkJobs) {
        if (job.status === "done") dismissLinkJob(job.id);
      }
      return;
    }
    const doneItemIds: string[] = [];
    for (const g of bucket.groups) {
      if (g.section !== "done") continue;
      for (const it of g.items) {
        if (it.status === "done") doneItemIds.push(it.id);
      }
    }
    if (doneItemIds.length > 0) dismiss(doneItemIds);
  };

  const retryErrorsOf = (group: ProductGroup) => {
    const inputs = group.items
      .filter((it) => {
        const outcome =
          it.marketplace === "pfs"
            ? it.pfsOutcome
            : it.marketplace === "ankorstore"
            ? it.ankorsOutcome
            : it.marketplace === "efashion"
            ? it.efashionOutcome
            : it.faireOutcome;
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
          {totalPlanned > 0 && (
            <span className="ml-2 text-xs font-normal text-sky-100/85 tabular-nums">
              · {totalProcessed} / {totalPlanned} ({pct}%)
            </span>
          )}
        </span>
      }
      icon={MARKETPLACES_ICON}
      footer={
        !isEmpty ? (
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-500 tabular-nums">
              {totalProcessed} / {totalPlanned} traités
            </span>
            <div className="flex items-center gap-3">
              {queuedCount > 0 && (
                <button
                  type="button"
                  onClick={() => void onStopQueued()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-100 text-rose-700 font-semibold hover:bg-rose-200 transition-colors"
                  title="Retire les produits en attente. Les envois déjà démarrés se terminent."
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z"
                    />
                  </svg>
                  Arrêter les suivants ({queuedCount})
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  clear();
                  clearFinishedLinkJobs();
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-semibold shadow-sm hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-colors"
                title="Retire toutes les cartes ✓ terminées dans toutes les colonnes en une fois. N'affecte pas les envois en cours, en attente ou en erreur."
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
                Tout vider
              </button>
            </div>
          </div>
        ) : undefined
      }
    >
      {isEmpty ? (
        <div className="p-6 h-full flex items-center justify-center text-center">
          <div>
            <p className="text-sm text-slate-500">Aucune synchro en cours.</p>
            <p className="text-[11px] text-slate-400 mt-1">
              Les rafraîchissements et liaisons marketplaces déclenchés depuis la page Produits
              apparaîtront ici, rangés par type d'action.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex gap-5 p-5 h-full min-h-0 overflow-x-auto overflow-y-hidden">
          {columns
            .filter((col) => col.groups.length > 0 || col.linkJobs.length > 0)
            .map((col) => (
              <div
                key={col.key}
                className="w-[840px] flex-shrink-0 h-full min-h-0"
              >
                <ColumnCard
                  bucket={col}
                  tooltipHandle={tooltipHandle}
                  nowMs={nowMs}
                  onRetry={retryErrorsOf}
                  onDismiss={dismissGroup}
                  onStopColumn={
                    col.key !== "link" && col.key !== "publication"
                      ? () => void onStopMode(col.key as QueueItemMode, col.queuedItemCount)
                      : undefined
                  }
                  onDismissLinkJob={dismissLinkJob}
                  onClearDone={() => clearDoneInColumn(col)}
                />
              </div>
            ))}
        </div>
      )}
      <MarketplaceTooltipHost handleRef={tooltipHandle} />
    </DrawerShell>
  );
}

// ────────────────────────────────────────────────────────────────
// Colonne
// ────────────────────────────────────────────────────────────────

const COLUMN_ACCENT: Record<
  ColumnKey,
  {
    bar: string;
    header: string;
    iconBg: string;
    iconText: string;
    title: string;
    countBg: string;
    icon: React.ReactNode;
  }
> = {
  publication: {
    bar: "bg-gradient-to-r from-blue-600 to-cyan-500",
    header: "from-blue-50/40 to-white",
    iconBg: "bg-blue-100 ring-blue-200",
    iconText: "text-blue-700",
    title: "text-blue-800",
    countBg: "bg-blue-100 text-blue-700",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 4.5v15m7.5-7.5h-15"
        />
      </svg>
    ),
  },
  publish: {
    bar: "bg-gradient-to-r from-emerald-600 to-emerald-400",
    header: "from-emerald-50/40 to-white",
    iconBg: "bg-emerald-100 ring-emerald-200",
    iconText: "text-emerald-700",
    title: "text-emerald-800",
    countBg: "bg-emerald-100 text-emerald-700",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
        />
      </svg>
    ),
  },
  refresh: {
    bar: "bg-gradient-to-r from-sky-600 to-sky-400",
    header: "from-sky-50/40 to-white",
    iconBg: "bg-sky-100 ring-sky-200",
    iconText: "text-sky-700",
    title: "text-sky-800",
    countBg: "bg-sky-100 text-sky-700",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
        />
      </svg>
    ),
  },
  resync: {
    bar: "bg-gradient-to-r from-violet-600 to-violet-400",
    header: "from-violet-50/40 to-white",
    iconBg: "bg-violet-100 ring-violet-200",
    iconText: "text-violet-700",
    title: "text-violet-800",
    countBg: "bg-violet-100 text-violet-700",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
        />
      </svg>
    ),
  },
  link: {
    bar: "bg-gradient-to-r from-fuchsia-600 to-pink-400",
    header: "from-fuchsia-50/40 to-white",
    iconBg: "bg-fuchsia-100 ring-fuchsia-200",
    iconText: "text-fuchsia-700",
    title: "text-fuchsia-800",
    countBg: "bg-fuchsia-100 text-fuchsia-700",
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
};

type ColumnFilter = "all" | "errors" | "active" | "queued" | "done";

function ColumnCard({
  bucket,
  tooltipHandle,
  nowMs,
  onRetry,
  onDismiss,
  onStopColumn,
  onDismissLinkJob,
  onClearDone,
}: {
  bucket: ColumnBucket;
  tooltipHandle: React.MutableRefObject<TooltipHandle | null>;
  nowMs: number;
  onRetry: (group: ProductGroup) => void;
  onDismiss: (group: ProductGroup) => void;
  onStopColumn?: () => void;
  onDismissLinkJob: (id: string) => void;
  onClearDone: () => void;
}) {
  const acc = COLUMN_ACCENT[bucket.key];
  const meta = COLUMN_LABEL[bucket.key];
  const total = bucket.groups.length + bucket.linkJobs.length;

  // Filtre actif sur la colonne — piloté par les tuiles cliquables du
  // bandeau KPI (« Tous » / Err. / Cours / Att. / OK). Par défaut « Tous »
  // pour ne rien masquer.
  const [filter, setFilter] = useState<ColumnFilter>("all");

  // Nombre de cartes ✓ Terminé retirables dans cette colonne (source de vérité
  // du bouton « Vider terminés (N) »). On compte les groupes en section
  // "done" pour les colonnes publish/refresh/resync et les link jobs status
  // "done" pour la colonne link — un groupe partiellement terminé (in_progress
  // pas encore fini) n'est pas comptabilisé pour éviter de retirer une carte
  // qui est encore en train de bouger.
  const doneCardsCount =
    bucket.key === "link"
      ? bucket.linkJobs.filter((j) => j.status === "done").length
      : bucket.groups.filter((g) => g.section === "done").length;

  // Ordre d'affichage : erreurs > actifs > planifiés/queued > terminés.
  // Puis application du filtre actif — filter === "queued" englobe aussi les
  // "scheduled" (lots étalés en attente d'une heure de départ).
  const orderedGroups = useMemo(() => {
    const sections: Record<string, ProductGroup[]> = {
      errors: [],
      active: [],
      scheduled: [],
      queued: [],
      done: [],
    };
    for (const g of bucket.groups) sections[g.section].push(g);
    sections.scheduled.sort((a, b) => {
      const ta = a.earliestScheduledFor ? Date.parse(a.earliestScheduledFor) : 0;
      const tb = b.earliestScheduledFor ? Date.parse(b.earliestScheduledFor) : 0;
      return ta - tb;
    });
    const all = [
      ...sections.errors,
      ...sections.active,
      ...sections.scheduled,
      ...sections.queued,
      ...sections.done,
    ];
    if (filter === "all") return all;
    if (filter === "errors") return sections.errors;
    if (filter === "active") return sections.active;
    if (filter === "queued") return [...sections.scheduled, ...sections.queued];
    return sections.done;
  }, [bucket.groups, filter]);

  const orderedLinks = useMemo(() => {
    const inProgress = bucket.linkJobs.filter((j) => j.status === "in_progress");
    const errors = bucket.linkJobs.filter((j) => j.status === "error");
    const done = bucket.linkJobs.filter((j) => j.status === "done");
    if (filter === "all") return [...errors, ...inProgress, ...done];
    if (filter === "errors") return errors;
    if (filter === "active") return inProgress;
    if (filter === "queued") return []; // pas d'état queued sur les liaisons
    return done;
  }, [bucket.linkJobs, filter]);

  const nextScheduled =
    bucket.key === "refresh" && bucket.hasScheduled
      ? orderedGroups.find((g) => g.section === "scheduled") ?? null
      : null;

  const intervalMs = useMemo(() => {
    if (bucket.key !== "refresh") return null;
    const scheduled = orderedGroups.filter((g) => g.earliestScheduledFor);
    if (scheduled.length < 2) return null;
    const t0 = Date.parse(scheduled[0].earliestScheduledFor!);
    const t1 = Date.parse(scheduled[1].earliestScheduledFor!);
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
    return t1 - t0;
  }, [bucket.key, orderedGroups]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col shadow-sm min-h-0 h-full">
      <div className={`h-1.5 flex-shrink-0 ${acc.bar}`} />

      {/* En-tête colonne */}
      <div
        className={`px-4 py-3.5 border-b border-slate-100 flex items-center gap-3 bg-gradient-to-b ${acc.header}`}
      >
        <span
          className={`w-11 h-11 rounded-xl ring-1 flex items-center justify-center flex-shrink-0 ${acc.iconBg} ${acc.iconText}`}
        >
          {acc.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className={`text-base font-heading font-bold leading-tight ${acc.title}`}>
            {meta.title}
          </div>
          <div className="text-[11px] text-slate-500 truncate mt-0.5">{meta.subtitle}</div>
        </div>
        <span
          className={`text-sm font-semibold px-2.5 py-1 rounded-full tabular-nums ${acc.countBg}`}
        >
          {total}
        </span>
        {onStopColumn && bucket.queuedItemCount > 0 && (
          <button
            type="button"
            onClick={onStopColumn}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-rose-700 text-[11px] font-semibold hover:bg-rose-50 ring-1 ring-rose-200 transition-colors flex-shrink-0"
            title={`Retire les ${bucket.queuedItemCount} envoi(s) de cette catégorie encore en attente`}
          >
            Arrêter ({bucket.queuedItemCount})
          </button>
        )}
      </div>

      {/* Bandeau KPI 5 tuiles cliquables — filtre la liste par état */}
      <FilterStrip
        kpi={bucket.kpi}
        total={total}
        activeFilter={filter}
        onFilterChange={setFilter}
        hideQueued={bucket.key === "link"}
      />

      {/* Bandeau "Prochain départ" pour la colonne Refresh uniquement */}
      {nextScheduled && (
        <NextDepartureBanner
          group={nextScheduled}
          nowMs={nowMs}
          intervalMs={intervalMs}
        />
      )}

      {/* Liste défilante — respecte le filtre actif */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        {total === 0 ? (
          <div className="text-center text-[11px] text-slate-400 py-4">
            Rien pour l'instant.
          </div>
        ) : bucket.key === "link" ? (
          orderedLinks.length === 0 ? (
            <FilterEmpty filter={filter} onReset={() => setFilter("all")} />
          ) : (
            orderedLinks.map((j) => (
              <LinkJobCard key={j.id} job={j} onDismiss={() => onDismissLinkJob(j.id)} />
            ))
          )
        ) : orderedGroups.length === 0 ? (
          <FilterEmpty filter={filter} onReset={() => setFilter("all")} />
        ) : (
          orderedGroups.map((g, idx) => (
            <ProductCard
              key={`${g.productId}-${g.dominantMode}`}
              group={g}
              tooltipHandle={tooltipHandle}
              onRetry={g.section === "errors" ? () => onRetry(g) : undefined}
              onDismiss={
                g.section === "errors" || g.section === "done" || g.section === "queued" || g.section === "scheduled"
                  ? () => onDismiss(g)
                  : undefined
              }
              scheduledInfo={
                g.earliestScheduledFor ? { nowMs, isNext: idx === 0 } : undefined
              }
            />
          ))
        )}
      </div>

      {/* Pied de colonne — bouton « Vider ceux terminés » visible quand
          au moins 1 carte ✓ est présente. Ne touche pas les erreurs / en
          cours / en attente. */}
      {doneCardsCount > 0 && (
        <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5">
          <button
            type="button"
            onClick={onClearDone}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-white text-emerald-700 text-xs font-semibold hover:bg-emerald-50 ring-1 ring-emerald-200 transition-colors px-3 py-2"
            title="Retire les cartes terminées de cette colonne. N'affecte pas les erreurs, ni les envois en cours ou en attente."
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Vider ceux terminés ({doneCardsCount})
          </button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Bandeau KPI 4 tuiles (Err. / Cours / Att. / OK)
// ────────────────────────────────────────────────────────────────

const FILTER_LABEL: Record<ColumnFilter, string> = {
  all: "aucune carte",
  errors: "aucune erreur",
  active: "aucun envoi en cours",
  queued: "aucun envoi en attente",
  done: "aucune carte terminée",
};

function FilterEmpty({
  filter,
  onReset,
}: {
  filter: ColumnFilter;
  onReset: () => void;
}) {
  return (
    <div className="text-center text-[12px] text-slate-400 py-6">
      {FILTER_LABEL[filter]}
      {filter !== "all" && (
        <>
          {" — "}
          <button
            type="button"
            onClick={onReset}
            className="underline text-slate-500 hover:text-slate-700"
          >
            afficher tout
          </button>
        </>
      )}
    </div>
  );
}

function FilterStrip({
  kpi,
  total,
  activeFilter,
  onFilterChange,
  hideQueued,
}: {
  kpi: { errors: number; active: number; queued: number; done: number };
  total: number;
  activeFilter: ColumnFilter;
  onFilterChange: (f: ColumnFilter) => void;
  /** Colonne « Liaisons » n'a pas d'état queued — on masque la tuile Att. */
  hideQueued?: boolean;
}) {
  const cols = hideQueued ? "grid-cols-4" : "grid-cols-5";
  return (
    <div className={`grid ${cols} gap-1.5 px-3 py-2.5 border-b border-slate-100 bg-slate-50/50`}>
      <KpiTile
        label="Tous"
        value={total}
        tone={total > 0 ? "slate-strong" : "slate"}
        active={activeFilter === "all"}
        onClick={() => onFilterChange("all")}
      />
      <KpiTile
        label="Err."
        value={kpi.errors}
        tone={kpi.errors > 0 ? "rose" : "slate"}
        active={activeFilter === "errors"}
        onClick={() => onFilterChange(activeFilter === "errors" ? "all" : "errors")}
      />
      <KpiTile
        label="Cours"
        value={kpi.active}
        tone={kpi.active > 0 ? "sky" : "slate"}
        active={activeFilter === "active"}
        onClick={() => onFilterChange(activeFilter === "active" ? "all" : "active")}
      />
      {!hideQueued && (
        <KpiTile
          label="Att."
          value={kpi.queued}
          tone={kpi.queued > 0 ? "indigo" : "slate"}
          active={activeFilter === "queued"}
          onClick={() => onFilterChange(activeFilter === "queued" ? "all" : "queued")}
        />
      )}
      <KpiTile
        label="OK"
        value={kpi.done}
        tone={kpi.done > 0 ? "emerald" : "slate"}
        active={activeFilter === "done"}
        onClick={() => onFilterChange(activeFilter === "done" ? "all" : "done")}
      />
    </div>
  );
}

const KPI_TONES = {
  rose: {
    bg: "bg-rose-50 ring-rose-100",
    activeBg: "bg-rose-100 ring-rose-400 ring-2",
    label: "text-rose-700",
    value: "text-rose-800",
  },
  sky: {
    bg: "bg-sky-50 ring-sky-100",
    activeBg: "bg-sky-100 ring-sky-400 ring-2",
    label: "text-sky-700",
    value: "text-sky-800",
  },
  indigo: {
    bg: "bg-indigo-50 ring-indigo-100",
    activeBg: "bg-indigo-100 ring-indigo-400 ring-2",
    label: "text-indigo-700",
    value: "text-indigo-800",
  },
  emerald: {
    bg: "bg-emerald-50 ring-emerald-100",
    activeBg: "bg-emerald-100 ring-emerald-400 ring-2",
    label: "text-emerald-700",
    value: "text-emerald-800",
  },
  slate: {
    bg: "bg-slate-50 ring-slate-100",
    activeBg: "bg-slate-100 ring-slate-400 ring-2",
    label: "text-slate-400",
    value: "text-slate-400",
  },
  "slate-strong": {
    bg: "bg-slate-100 ring-slate-200",
    activeBg: "bg-slate-800 ring-slate-800 ring-2",
    label: "text-slate-700",
    value: "text-slate-900",
  },
} as const;

function KpiTile({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: keyof typeof KPI_TONES;
  active?: boolean;
  /** Rendu comme <button> cliquable si fourni. Sinon <div> statique
   *  (compat ancien usage). */
  onClick?: () => void;
}) {
  const t = KPI_TONES[tone];
  const bg = active ? t.activeBg : t.bg;
  // Quand actif + tone slate-strong, on inverse le texte pour matcher le fond
  // sombre (utilisé pour la tuile « Tous »).
  const activeInverseText = active && tone === "slate-strong";
  const labelCls = activeInverseText ? "text-slate-200" : t.label;
  const valueCls = activeInverseText ? "text-white" : t.value;
  const commonCls = `text-center rounded-lg py-1.5 ring-1 transition-colors ${bg}`;
  const inner = (
    <>
      <div className={`text-[10px] uppercase tracking-wider font-bold ${labelCls}`}>
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums leading-tight ${valueCls}`}>
        {value}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active ?? false}
        className={`${commonCls} hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-slate-400 cursor-pointer`}
      >
        {inner}
      </button>
    );
  }
  return <div className={commonCls}>{inner}</div>;
}

// ────────────────────────────────────────────────────────────────
// Carte produit — colonnes publish/refresh/resync (garde les 4 badges P/A/E/F)
// Refonte 2026-07-31 : image plus grande, chip mode, status pill, footer clair.
// ────────────────────────────────────────────────────────────────

const MODE_CHIP: Record<ColumnKey, { label: string; className: string }> = {
  publication: { label: "Publication", className: "bg-blue-100 text-blue-800 ring-blue-200" },
  publish: { label: "Modification", className: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  refresh: { label: "Rafraîchissement", className: "bg-sky-100 text-sky-800 ring-sky-200" },
  resync: { label: "Synchronisation", className: "bg-violet-100 text-violet-800 ring-violet-200" },
  link: { label: "Liaison", className: "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200" },
};

function ProductCard({
  group,
  tooltipHandle,
  onRetry,
  onDismiss,
  scheduledInfo,
}: {
  group: ProductGroup;
  tooltipHandle: React.MutableRefObject<TooltipHandle | null>;
  onRetry?: () => void;
  /** Retire la carte de la liste (marque les jobs correspondants CANCELLED côté serveur). */
  onDismiss?: () => void;
  scheduledInfo?: { nowMs: number; isNext: boolean };
}) {
  const toast = useToast();
  const isError = group.section === "errors";
  const isActive = group.section === "active";
  const isDone = group.section === "done";
  const isScheduled = Boolean(scheduledInfo && group.earliestScheduledFor);
  const isNext = Boolean(scheduledInfo?.isNext && isScheduled);
  const scheduledAtMs =
    isScheduled && group.earliestScheduledFor
      ? Date.parse(group.earliestScheduledFor)
      : null;
  const remainingMs =
    scheduledAtMs !== null && scheduledInfo
      ? Math.max(0, scheduledAtMs - scheduledInfo.nowMs)
      : null;

  // Compte par état sur les 4 marketplaces
  const cellStats = useMemo(() => {
    let done = 0;
    let active = 0;
    let error = 0;
    let queued = 0;
    let targeted = 0;
    for (const t of MARKETPLACE_ORDER) {
      const c = group.cells[t];
      if (c.kind === "not-targeted") continue;
      targeted += 1;
      if (c.kind === "done") done += 1;
      else if (c.kind === "active") active += 1;
      else if (c.kind === "error") error += 1;
      else if (c.kind === "queued") queued += 1;
    }
    return { done, active, error, queued, targeted };
  }, [group.cells]);

  // Toutes les erreurs (marketplace + message) pour affichage détaillé
  const errorDetails = useMemo(() => {
    const errors: { marketplace: string; message: string }[] = [];
    for (const target of MARKETPLACE_ORDER) {
      const cell = group.cells[target];
      if (cell.kind === "error" && cell.outcome && cell.outcome.ok === false) {
        errors.push({
          marketplace: MARKETPLACE_LABEL[target],
          message: cell.outcome.message,
        });
      }
    }
    return errors;
  }, [group.cells]);

  const copyReference = () => {
    void navigator.clipboard.writeText(group.reference).then(
      () => toast.success("Copié", `Référence ${group.reference} copiée.`),
      () => toast.error("Copie impossible", "Le presse-papier n'est pas disponible."),
    );
  };

  const cardBorder = isError
    ? "border-rose-200 bg-gradient-to-br from-rose-50/60 to-white"
    : isNext
    ? "border-2 border-indigo-300 ring-2 ring-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white"
    : isActive
    ? "border-sky-200 bg-gradient-to-br from-sky-50/60 to-white"
    : isDone
    ? "border-emerald-200 bg-white"
    : "border-slate-200 bg-white";

  const modeChip = MODE_CHIP[group.dominantColumn];

  return (
    <div className={`rounded-2xl overflow-hidden shadow-sm border p-4 ${cardBorder}`}>
      {/* ── En-tête : image + infos + status pill ── */}
      <div className="flex items-start gap-4">
        <ProductThumb group={group} />

        {/* Infos produit */}
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          {/* Chip mode + Prochain (facultatif) */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`inline-flex items-center text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-md ring-1 ${modeChip.className}`}
            >
              {modeChip.label}
            </span>
            {isNext && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider">
                Prochain
              </span>
            )}
          </div>

          {/* Nom produit — jusqu'à 2 lignes, plus tronqué agressivement */}
          <p
            className="text-base font-heading font-bold text-slate-900 leading-snug line-clamp-2"
            title={group.productName}
          >
            {group.productName}
          </p>

          {/* Référence copiable */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono text-slate-500 truncate">
              {group.reference}
            </span>
            <button
              type="button"
              onClick={copyReference}
              className="text-slate-400 hover:text-sky-600 transition-colors flex-shrink-0"
              title="Copier la référence"
              aria-label={`Copier la référence ${group.reference}`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </button>
          </div>

          {/* Compteur marketplaces */}
          <p className="text-[11px] text-slate-500">
            {cellStats.targeted > 1
              ? `${cellStats.done}/${cellStats.targeted} marketplaces traitées`
              : `1 marketplace ciblée`}
          </p>
        </div>

        {/* Bloc statut à droite — pill grande + countdown si scheduled */}
        <div className="flex-shrink-0">
          {isScheduled && scheduledAtMs !== null ? (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-indigo-600 font-bold">
                Départ dans
              </div>
              <div className="text-xl font-heading font-bold text-indigo-800 tabular-nums leading-tight mt-0.5">
                {remainingMs !== null
                  ? formatCountdownMMSS(remainingMs)
                  : formatClockTime(scheduledAtMs)}
              </div>
            </div>
          ) : (
            <StatusPill group={group} />
          )}
        </div>
      </div>

      {/* ── Ligne 2 : Badges marketplace P/A/E/F ── */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mr-1">
          Marketplaces
        </span>
        {MARKETPLACE_ORDER.map((target) => (
          <BadgeForCell
            key={target}
            target={target}
            cell={group.cells[target]}
            tooltipHandle={tooltipHandle}
          />
        ))}
      </div>

      {/* ── Bloc erreurs détaillé ── */}
      {errorDetails.length > 0 && (
        <div className="mt-3 rounded-lg bg-rose-50/70 border border-rose-200 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-rose-700 text-[11px] font-bold uppercase tracking-wider">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            {errorDetails.length > 1 ? `${errorDetails.length} erreurs` : "Erreur"}
          </div>
          <ul className="space-y-1 text-[12px] text-rose-800 leading-snug">
            {errorDetails.map((e, i) => (
              <li key={i}>
                <b>{e.marketplace}</b> — {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Footer : timestamp + actions ── */}
      {(group.latestActivityAt || (isError && onRetry) || onDismiss) && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            {group.latestActivityAt
              ? relativeTime(group.latestActivityAt)
              : isActive
              ? "en cours…"
              : ""}
          </span>
          <div className="flex items-center gap-1.5">
            {isError && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full bg-rose-600 text-white hover:bg-rose-700 transition-colors"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-5.5M20 15a8 8 0 01-14 5.5"
                  />
                </svg>
                Réessayer
              </button>
            )}
            {onDismiss && (isError || isDone) && (
              <button
                type="button"
                onClick={onDismiss}
                className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                title="Retirer cette carte de la liste"
              >
                ✕ Retirer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductThumb({ group }: { group: ProductGroup }) {
  const href = `/admin/produits/${group.productId}/modifier`;
  const content = group.firstImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={group.firstImage}
      alt=""
      className="w-28 h-28 rounded-2xl object-cover bg-slate-100 ring-1 ring-slate-200 group-hover:ring-sky-400 transition-shadow"
    />
  ) : (
    <div className="w-28 h-28 rounded-2xl bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center">
      <svg
        className="w-10 h-10 text-slate-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={1.6}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z"
        />
      </svg>
    </div>
  );
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Voir la fiche produit"
      className="relative group flex-shrink-0 block"
    >
      {content}
    </a>
  );
}

// Pill de statut (haut-droite de la carte produit). Purement décoratif —
// pas cliquable. Pour retirer la carte, la cliente utilise le bouton
// « ✕ Retirer » dédié dans le footer (le double bouton prêtait à confusion,
// bug remonté 2026-07-31).
function StatusPill({ group }: { group: ProductGroup }) {
  const section = group.section;
  if (section === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 text-sky-800 ring-1 ring-sky-200 px-3 py-1.5 text-xs font-bold">
        <svg
          className="w-3.5 h-3.5 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        En cours
      </span>
    );
  }
  if (section === "queued" || section === "scheduled") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200 px-3 py-1.5 text-xs font-bold">
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        En attente
      </span>
    );
  }
  if (section === "errors") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 text-rose-800 ring-1 ring-rose-200 px-3 py-1.5 text-xs font-bold">
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.4}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Erreur
      </span>
    );
  }
  // done
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200 px-3 py-1.5 text-xs font-bold">
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
      Terminé
    </span>
  );
}

function StatusIcon({
  group,
  onDismiss,
}: {
  group: ProductGroup;
  /** Si fourni, la croix (erreur) ou le check (terminé) deviennent un vrai
   *  bouton qui retire la carte de la liste. */
  onDismiss?: () => void;
}) {
  if (
    group.section === "active" ||
    group.section === "queued" ||
    group.section === "scheduled"
  ) {
    // Spinner en cours — pas cliquable (on ne coupe pas un envoi en vol).
    return (
      <svg
        className="w-5 h-5 text-sky-600 animate-spin flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth={4}
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    );
  }
  if (group.section === "errors") {
    // Croix cliquable = retire la ligne de la liste. Sans onDismiss, on retombe
    // sur l'ancien affichage (pur indicateur visuel).
    if (onDismiss) {
      return (
        <button
          type="button"
          onClick={onDismiss}
          title="Retirer cette ligne"
          aria-label="Retirer cette ligne"
          className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-rose-600 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-300 transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      );
    }
    return (
      <svg
        className="w-5 h-5 text-rose-600 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  // Section "done" : pastille verte cliquable pour retirer.
  if (onDismiss) {
    return (
      <button
        type="button"
        onClick={onDismiss}
        title="Retirer cette ligne"
        aria-label="Retirer cette ligne"
        className="group flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 hover:bg-rose-500 text-white text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-300"
      >
        <span className="group-hover:hidden">✓</span>
        <span className="hidden group-hover:inline text-xs">✕</span>
      </button>
    );
  }
  return (
    <span className="w-7 h-7 rounded-full bg-emerald-500 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
      ✓
    </span>
  );
}

// ────────────────────────────────────────────────────────────────
// Badge marketplace (branché sur MarketplaceBadge / tooltip portalé)
// ────────────────────────────────────────────────────────────────

const CELL_STYLE: Record<
  MarketplaceCell["kind"],
  { className: string; dotClassName: string; tone: TooltipTone }
> = {
  "not-targeted": {
    className: "bg-slate-100 text-slate-400",
    dotClassName: "bg-slate-300",
    tone: "neutral",
  },
  queued: {
    className: "bg-slate-100 text-slate-500",
    dotClassName: "bg-slate-300",
    tone: "neutral",
  },
  active: {
    className: "bg-sky-100 text-sky-700",
    dotClassName: "bg-sky-500 animate-pulse",
    tone: "progress",
  },
  done: {
    className: "bg-emerald-100 text-emerald-700",
    dotClassName: "bg-emerald-500",
    tone: "ok",
  },
  error: {
    className: "bg-rose-600 text-white",
    dotClassName: "bg-white",
    tone: "error",
  },
};

function BadgeForCell({
  target,
  cell,
  tooltipHandle,
}: {
  target: MarketplaceTarget;
  cell: MarketplaceCell;
  tooltipHandle: React.MutableRefObject<TooltipHandle | null>;
}) {
  const style = CELL_STYLE[cell.kind];
  const suffix =
    cell.kind === "active" ? (
      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth={4}
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    ) : null;
  return (
    <MarketplaceBadge
      label={MARKETPLACE_LABEL[target]}
      tone={style.tone}
      className={style.className}
      dotClassName={style.dotClassName}
      suffix={suffix}
      tooltipTitle={cellTooltipTitle(target, cell)}
      tooltipBody={cellTooltipBody(cell)}
      copyable={cellCopyable(cell)}
      tooltipHandle={tooltipHandle}
      size="md"
    />
  );
}

// ────────────────────────────────────────────────────────────────
// Bandeau "Prochain départ" — inséré dans la colonne Refresh
// ────────────────────────────────────────────────────────────────

function NextDepartureBanner({
  group,
  nowMs,
  intervalMs,
}: {
  group: ProductGroup;
  nowMs: number;
  intervalMs: number | null;
}) {
  const scheduledAtMs = group.earliestScheduledFor
    ? Date.parse(group.earliestScheduledFor)
    : null;
  if (scheduledAtMs === null || !Number.isFinite(scheduledAtMs)) return null;
  const remainingMs = Math.max(0, scheduledAtMs - nowMs);

  return (
    <div
      className="relative overflow-hidden mx-3 mt-3 rounded-xl text-white px-4 py-3 flex-shrink-0"
      style={{ background: "linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)" }}
    >
      <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-sky-100/90">
            Prochain départ
          </div>
          <div className="text-sm truncate mt-1" title={group.productName}>
            « {group.productName} »
          </div>
          {intervalMs !== null && (
            <div className="text-[11px] text-sky-100/85 mt-1">
              1 produit toutes les <b className="text-white">{formatDurationHuman(intervalMs)}</b>
            </div>
          )}
        </div>
        <div className="font-heading font-bold text-3xl tabular-nums flex-shrink-0">
          {formatCountdownMMSS(remainingMs)}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Carte Liaison (colonne « Liaisons »)
// ────────────────────────────────────────────────────────────────

const LINK_MKT_META: Record<
  LinkJob["marketplace"],
  { name: string; grad: string }
> = {
  pfs: { name: "PFS", grad: "linear-gradient(135deg,#4f46e5,#6366f1)" },
  ankorstore: { name: "Ankorstore", grad: "linear-gradient(135deg,#0ea5e9,#38bdf8)" },
  efashion: { name: "eFashion", grad: "linear-gradient(135deg,#db2777,#ec4899)" },
  faire: { name: "Faire", grad: "linear-gradient(135deg,#f59e0b,#fbbf24)" },
};

function LinkJobCard({ job, onDismiss }: { job: LinkJob; onDismiss: () => void }) {
  const meta = LINK_MKT_META[job.marketplace];
  const borderCls =
    job.status === "in_progress"
      ? "border-fuchsia-200 bg-gradient-to-br from-fuchsia-50/40 to-white"
      : job.status === "done"
      ? "border-emerald-200 bg-white"
      : "border-rose-200 bg-gradient-to-br from-rose-50/60 to-white";

  return (
    <div className={`rounded-xl overflow-hidden shadow-sm border p-3.5 ${borderCls}`}>
      <div className="flex items-center gap-3">
        {job.productImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getImageSrc(job.productImage, "thumb")}
            alt=""
            className="w-16 h-16 rounded-lg object-cover bg-slate-100 ring-1 ring-slate-200 flex-shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center text-[11px] text-slate-400 font-semibold flex-shrink-0">
            IMG
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold truncate text-slate-800 leading-tight"
            title={job.productName}
          >
            {job.productName}
          </p>
          <div className="text-[11.5px] font-mono text-slate-500 truncate mt-1">
            {job.reference}
          </div>
        </div>
        {job.status === "in_progress" && (
          <svg
            className="w-5 h-5 text-fuchsia-600 animate-spin flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth={4}
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {job.status === "done" && (
          <span className="w-7 h-7 rounded-full bg-emerald-500 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
            ✓
          </span>
        )}
        {job.status === "error" && (
          <svg
            className="w-5 h-5 text-rose-600 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
          → Vers
        </span>
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold text-white"
          style={{ background: meta.grad }}
        >
          {meta.name}
        </span>
      </div>

      {job.status === "in_progress" && (
        <div className="mt-2 text-xs text-fuchsia-700">
          Liaison en cours…
        </div>
      )}
      {job.status === "done" && (
        <div className="mt-2 space-y-1 text-xs leading-snug">
          {job.linkedCount !== undefined && job.linkedCount > 0 && (
            <div className="text-emerald-700">
              ✓ {job.linkedCount} variante{job.linkedCount > 1 ? "s" : ""} liée
              {job.linkedCount > 1 ? "s" : ""}
            </div>
          )}
          {job.createdCount !== undefined && job.createdCount > 0 && (
            <div className="text-sky-700">
              ＋ {job.createdCount} couleur{job.createdCount > 1 ? "s" : ""} créée
              {job.createdCount > 1 ? "s" : ""} chez le marketplace
            </div>
          )}
          {job.deletedCount !== undefined && job.deletedCount > 0 && (
            <div className="text-rose-700">
              − {job.deletedCount} variante{job.deletedCount > 1 ? "s" : ""} supprimée
              {job.deletedCount > 1 ? "s" : ""} chez le marketplace
            </div>
          )}
          {job.importedCount !== undefined && job.importedCount > 0 && (
            <div className="text-emerald-700">
              ⇩ {job.importedCount} variante{job.importedCount > 1 ? "s" : ""} importée
              {job.importedCount > 1 ? "s" : ""} depuis le marketplace
            </div>
          )}
        </div>
      )}
      {job.status === "error" && job.error && (
        <div className="mt-2 text-[11.5px] text-rose-700 leading-snug italic">
          {job.error}
        </div>
      )}

      {job.status !== "in_progress" && (
        <div className="mt-2 flex items-center justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="text-slate-400 hover:text-slate-700 text-[11px] px-1"
            aria-label="Retirer"
          >
            ✕ Retirer
          </button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Hook & formatters temps
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
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
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

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "à l'instant";
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

// ────────────────────────────────────────────────────────────────
// Compat : legacy `groupErrorsByProduct` (utilisée par les tests hérités)
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
