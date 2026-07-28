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
  const { items, clear, enqueue, runningCount, queuedCount, stop } =
    useMarketplaceRefreshQueue();
  const {
    jobs: linkJobs,
    activeCount: linkActiveCount,
    dismissJob: dismissLinkJob,
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
      size="wide"
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
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-slate-500 tabular-nums">
              {totalProcessed} / {totalPlanned} traités
            </span>
            <div className="flex items-center gap-3">
              {queuedCount > 0 && (
                <button
                  type="button"
                  onClick={() => void onStopQueued()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 font-semibold hover:bg-rose-200 transition-colors"
                  title="Retire les produits en attente. Les envois déjà démarrés se terminent."
                >
                  <svg
                    className="w-3 h-3"
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
                onClick={clear}
                className="text-slate-500 hover:text-slate-700 underline"
              >
                Vider la liste
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 p-3 h-full min-h-0">
          {columns.map((col) => (
            <ColumnCard
              key={col.key}
              bucket={col}
              tooltipHandle={tooltipHandle}
              nowMs={nowMs}
              onRetry={retryErrorsOf}
              onStopColumn={
                col.key !== "link"
                  ? () => void onStopMode(col.key as QueueItemMode, col.queuedItemCount)
                  : undefined
              }
              onDismissLinkJob={dismissLinkJob}
            />
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

function ColumnCard({
  bucket,
  tooltipHandle,
  nowMs,
  onRetry,
  onStopColumn,
  onDismissLinkJob,
}: {
  bucket: ColumnBucket;
  tooltipHandle: React.MutableRefObject<TooltipHandle | null>;
  nowMs: number;
  onRetry: (group: ProductGroup) => void;
  onStopColumn?: () => void;
  onDismissLinkJob: (id: string) => void;
}) {
  const acc = COLUMN_ACCENT[bucket.key];
  const meta = COLUMN_LABEL[bucket.key];
  const total = bucket.groups.length + bucket.linkJobs.length;

  // Ordre d'affichage : erreurs > actifs > planifiés/queued > terminés.
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
    return [
      ...sections.errors,
      ...sections.active,
      ...sections.scheduled,
      ...sections.queued,
      ...sections.done,
    ];
  }, [bucket.groups]);

  const orderedLinks = useMemo(() => {
    const inProgress = bucket.linkJobs.filter((j) => j.status === "in_progress");
    const errors = bucket.linkJobs.filter((j) => j.status === "error");
    const done = bucket.linkJobs.filter((j) => j.status === "done");
    return [...errors, ...inProgress, ...done];
  }, [bucket.linkJobs]);

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
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col shadow-sm min-h-0 h-full">
      <div className={`h-1 flex-shrink-0 ${acc.bar}`} />

      {/* En-tête colonne */}
      <div
        className={`px-3 py-2.5 border-b border-slate-100 flex items-center gap-2.5 bg-gradient-to-b ${acc.header}`}
      >
        <span
          className={`w-8 h-8 rounded-lg ring-1 flex items-center justify-center flex-shrink-0 ${acc.iconBg} ${acc.iconText}`}
        >
          {acc.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-heading font-bold leading-tight ${acc.title}`}>
            {meta.title}
          </div>
          <div className="text-[10px] text-slate-500 truncate">{meta.subtitle}</div>
        </div>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums ${acc.countBg}`}
        >
          {total}
        </span>
        {onStopColumn && bucket.queuedItemCount > 0 && (
          <button
            type="button"
            onClick={onStopColumn}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white text-rose-700 text-[10px] font-semibold hover:bg-rose-50 ring-1 ring-rose-200 transition-colors flex-shrink-0"
            title={`Retire les ${bucket.queuedItemCount} envoi(s) de cette catégorie encore en attente`}
          >
            Arrêter ({bucket.queuedItemCount})
          </button>
        )}
      </div>

      {/* Bandeau KPI 4 tuiles */}
      <KpiStrip kpi={bucket.kpi} />

      {/* Bandeau "Prochain départ" pour la colonne Refresh uniquement */}
      {nextScheduled && (
        <NextDepartureBanner
          group={nextScheduled}
          nowMs={nowMs}
          intervalMs={intervalMs}
        />
      )}

      {/* Liste défilante */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {total === 0 ? (
          <div className="text-center text-[11px] text-slate-400 py-4">
            Rien pour l'instant.
          </div>
        ) : bucket.key === "link" ? (
          orderedLinks.map((j) => (
            <LinkJobCard key={j.id} job={j} onDismiss={() => onDismissLinkJob(j.id)} />
          ))
        ) : (
          orderedGroups.map((g, idx) => (
            <ProductCard
              key={`${g.productId}-${g.dominantMode}`}
              group={g}
              tooltipHandle={tooltipHandle}
              onRetry={g.section === "errors" ? () => onRetry(g) : undefined}
              scheduledInfo={
                g.earliestScheduledFor ? { nowMs, isNext: idx === 0 } : undefined
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Bandeau KPI 4 tuiles (Err. / Cours / Att. / OK)
// ────────────────────────────────────────────────────────────────

function KpiStrip({
  kpi,
}: {
  kpi: { errors: number; active: number; queued: number; done: number };
}) {
  return (
    <div className="grid grid-cols-4 gap-1 px-2 py-2 border-b border-slate-100 bg-slate-50/50">
      <KpiTile label="Err." value={kpi.errors} tone={kpi.errors > 0 ? "rose" : "slate"} />
      <KpiTile label="Cours" value={kpi.active} tone={kpi.active > 0 ? "sky" : "slate"} />
      <KpiTile label="Att." value={kpi.queued} tone={kpi.queued > 0 ? "indigo" : "slate"} />
      <KpiTile label="OK" value={kpi.done} tone={kpi.done > 0 ? "emerald" : "slate"} />
    </div>
  );
}

const KPI_TONES = {
  rose: { bg: "bg-rose-50 ring-rose-100", label: "text-rose-700", value: "text-rose-800" },
  sky: { bg: "bg-sky-50 ring-sky-100", label: "text-sky-700", value: "text-sky-800" },
  indigo: {
    bg: "bg-indigo-50 ring-indigo-100",
    label: "text-indigo-700",
    value: "text-indigo-800",
  },
  emerald: {
    bg: "bg-emerald-50 ring-emerald-100",
    label: "text-emerald-700",
    value: "text-emerald-800",
  },
  slate: { bg: "bg-slate-50 ring-slate-100", label: "text-slate-400", value: "text-slate-400" },
} as const;

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: keyof typeof KPI_TONES;
}) {
  const t = KPI_TONES[tone];
  return (
    <div className={`text-center rounded-md py-1 ring-1 ${t.bg}`}>
      <div className={`text-[9px] uppercase tracking-wider font-bold ${t.label}`}>{label}</div>
      <div className={`text-sm font-bold tabular-nums ${t.value}`}>{value}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Carte produit — colonnes publish/refresh/resync (garde les 4 badges P/A/E/F)
// ────────────────────────────────────────────────────────────────

function ProductCard({
  group,
  tooltipHandle,
  onRetry,
  scheduledInfo,
}: {
  group: ProductGroup;
  tooltipHandle: React.MutableRefObject<TooltipHandle | null>;
  onRetry?: () => void;
  scheduledInfo?: { nowMs: number; isNext: boolean };
}) {
  const toast = useToast();
  const isError = group.section === "errors";
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

  // Premier message d'erreur détaillé (marketplace + texte) pour affichage direct sous la carte
  const firstErrorText = useMemo(() => {
    for (const target of MARKETPLACE_ORDER) {
      const cell = group.cells[target];
      if (cell.kind === "error" && cell.outcome && cell.outcome.ok === false) {
        return `${MARKETPLACE_LABEL[target]} : « ${cell.outcome.message} »`;
      }
    }
    return null;
  }, [group.cells]);

  const copyReference = () => {
    void navigator.clipboard.writeText(group.reference).then(
      () => toast.success("Copié", `Référence ${group.reference} copiée.`),
      () => toast.error("Copie impossible", "Le presse-papier n'est pas disponible."),
    );
  };

  return (
    <div
      className={`rounded-lg overflow-hidden shadow-sm border p-2.5 ${
        isError
          ? "border-rose-200 bg-gradient-to-br from-rose-50/60 to-white"
          : isNext
          ? "border-2 border-indigo-300 ring-2 ring-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white"
          : group.section === "active"
          ? "border-sky-200 bg-gradient-to-br from-sky-50/60 to-white"
          : group.section === "done"
          ? "border-emerald-200 bg-white"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-2">
        <ProductThumb group={group} />
        <div className="min-w-0 flex-1">
          <p
            className="text-[12px] font-semibold truncate text-slate-800 leading-tight"
            title={group.productName}
          >
            {group.productName}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[10px] font-mono text-slate-500 truncate">
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
                className="w-3 h-3"
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
        </div>
        {isScheduled && scheduledAtMs !== null ? (
          <div className="text-right flex-shrink-0">
            <div className="text-[9px] uppercase tracking-wider text-indigo-600 font-bold">
              Départ
            </div>
            <div className="text-[13px] font-bold text-indigo-800 tabular-nums leading-tight">
              {remainingMs !== null
                ? formatCountdownMMSS(remainingMs)
                : formatClockTime(scheduledAtMs)}
            </div>
          </div>
        ) : (
          <StatusIcon group={group} />
        )}
      </div>

      {isNext && (
        <div className="mt-1.5">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-indigo-600 text-white text-[9px] font-bold uppercase tracking-wider">
            Prochain
          </span>
        </div>
      )}

      {/* Les 4 badges P/A/E/F */}
      <div className="mt-2 flex items-center gap-1 flex-wrap">
        {MARKETPLACE_ORDER.map((target) => (
          <BadgeForCell
            key={target}
            target={target}
            cell={group.cells[target]}
            tooltipHandle={tooltipHandle}
          />
        ))}
      </div>

      {firstErrorText && (
        <div className="mt-1.5 text-[10px] text-rose-700 leading-snug italic">
          {firstErrorText}
        </div>
      )}

      {(isError && onRetry) || group.latestActivityAt ? (
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10px] text-slate-500">
            {group.latestActivityAt ? relativeTime(group.latestActivityAt) : ""}
          </span>
          {isError && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-600 text-white hover:bg-rose-700 transition-colors"
            >
              <svg
                className="w-2.5 h-2.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={3}
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
        </div>
      ) : null}
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
      className="w-11 h-11 rounded-md object-cover bg-slate-100 ring-1 ring-slate-200 group-hover:ring-sky-400 transition-shadow"
    />
  ) : (
    <div className="w-11 h-11 rounded-md bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center">
      <svg
        className="w-5 h-5 text-slate-400"
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

function StatusIcon({ group }: { group: ProductGroup }) {
  if (
    group.section === "active" ||
    group.section === "queued" ||
    group.section === "scheduled"
  ) {
    return (
      <svg
        className="w-4 h-4 text-sky-600 animate-spin flex-shrink-0"
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
    return (
      <svg
        className="w-4 h-4 text-rose-600 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  return (
    <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
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
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
      className="relative overflow-hidden mx-2 mt-2 rounded-lg text-white px-3 py-2 flex-shrink-0"
      style={{ background: "linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)" }}
    >
      <div className="absolute -top-8 -right-6 w-24 h-24 rounded-full bg-white/10 blur-2xl pointer-events-none" />
      <div className="relative flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.18em] font-bold text-sky-100/90">
            Prochain départ
          </div>
          <div className="text-[11px] truncate mt-0.5" title={group.productName}>
            « {group.productName} »
          </div>
          {intervalMs !== null && (
            <div className="text-[10px] text-sky-100/85 mt-0.5">
              1 produit toutes les <b className="text-white">{formatDurationHuman(intervalMs)}</b>
            </div>
          )}
        </div>
        <div className="font-heading font-bold text-xl tabular-nums flex-shrink-0">
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
    <div className={`rounded-lg overflow-hidden shadow-sm border p-2.5 ${borderCls}`}>
      <div className="flex items-center gap-2">
        {job.productImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getImageSrc(job.productImage, "thumb")}
            alt=""
            className="w-11 h-11 rounded-md object-cover bg-slate-100 ring-1 ring-slate-200 flex-shrink-0"
          />
        ) : (
          <div className="w-11 h-11 rounded-md bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center text-[10px] text-slate-400 font-semibold flex-shrink-0">
            IMG
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p
            className="text-[12px] font-semibold truncate text-slate-800 leading-tight"
            title={job.productName}
          >
            {job.productName}
          </p>
          <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
            {job.reference}
          </div>
        </div>
        {job.status === "in_progress" && (
          <svg
            className="w-4 h-4 text-fuchsia-600 animate-spin flex-shrink-0"
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
          <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
            ✓
          </span>
        )}
        {job.status === "error" && (
          <svg
            className="w-4 h-4 text-rose-600 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
          → Vers
        </span>
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold text-white"
          style={{ background: meta.grad }}
        >
          {meta.name}
        </span>
      </div>

      {job.status === "in_progress" && (
        <div className="mt-1.5 text-[10px] text-fuchsia-700">
          Liaison en cours…
        </div>
      )}
      {job.status === "done" && (
        <div className="mt-1.5 space-y-0.5 text-[10px] leading-snug">
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
        <div className="mt-1.5 text-[10px] text-rose-700 leading-snug italic">
          {job.error}
        </div>
      )}

      {job.status !== "in_progress" && (
        <div className="mt-1.5 flex items-center justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="text-slate-400 hover:text-slate-700 text-[10px] px-1"
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
