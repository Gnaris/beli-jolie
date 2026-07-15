"use client";

/**
 * Tiroir « Synchro marketplaces » — refonte 2026-07-15.
 *
 * Une carte par produit dans chaque section, avec :
 *  - image cliquable (ouvre la fiche produit dans un nouvel onglet),
 *  - référence + bouton copier (feedback via useToast),
 *  - 4 badges d'état P / A / E / F (PFS, Ankor, eFashion, Faire) — chaque
 *    badge est tooltipé (portail dans document.body, hoverable, auto-recadré),
 *  - un bouton « Réessayer » en pied de carte quand au moins une marketplace
 *    du produit est en erreur.
 *
 * Sections (priorité du plus urgent au plus calme) :
 *   Erreurs (rouge, ouvert)   → produits avec au moins une erreur
 *   En cours (bleu, ouvert)   → produits avec au moins une marketplace active
 *   En attente (gris, replié) → produits queued
 *   Terminés (vert, replié)   → produits totalement ok
 *
 * Le modèle (regroupement + calcul d'état) vit dans marketplacesDrawerModel.ts
 * et est couvert par des tests Vitest.
 */

import { useEffect, useMemo, useRef } from "react";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import {
  MarketplaceBadge,
  MarketplaceTooltipHost,
  type TooltipHandle,
  type TooltipTone,
} from "./MarketplaceBadgeTooltip";
import { useToast } from "@/components/ui/Toast";
import {
  useMarketplaceRefreshQueue,
  type MarketplaceRefreshItem,
  type MarketplaceTarget,
} from "@/components/admin/products/MarketplaceRefreshContext";
import {
  cellCopyable,
  cellTooltipBody,
  cellTooltipTitle,
  groupItemsByProduct,
  MARKETPLACE_LABEL,
  MARKETPLACE_ORDER,
  type GroupSection,
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
  const { items, clear, enqueue, runningCount, queuedCount } = useMarketplaceRefreshQueue();

  const groups = useMemo(() => groupItemsByProduct(items), [items]);
  const bySection: Record<GroupSection, ProductGroup[]> = {
    errors: [],
    active: [],
    queued: [],
    done: [],
  };
  for (const g of groups) bySection[g.section].push(g);

  const activeCount = bySection.active.length + bySection.queued.length;
  const errorCount = bySection.errors.length;

  useEffect(() => {
    setBadge("marketplaces", {
      count: activeCount || errorCount,
      pulse: activeCount > 0 || errorCount > 0,
    });
  }, [activeCount, errorCount, setBadge]);

  const totalProcessed = bySection.done.length;
  const totalPlanned = groups.length;
  const pct = totalPlanned === 0 ? 0 : Math.round((totalProcessed / totalPlanned) * 100);

  const title =
    activeCount > 0
      ? `${runningCount + queuedCount} produit${runningCount + queuedCount > 1 ? "s" : ""} en cours`
      : errorCount > 0
      ? `${errorCount} erreur${errorCount > 1 ? "s" : ""}`
      : totalProcessed > 0
      ? `${totalProcessed} terminé${totalProcessed > 1 ? "s" : ""}`
      : "Aucun lot";

  const tooltipHandle = useRef<TooltipHandle | null>(null);

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

  return (
    <DrawerShell
      open={openWidget === "marketplaces"}
      onClose={close}
      accent="sky"
      eyebrow="Marketplaces"
      title={
        <span className="flex items-center gap-1.5">
          {activeCount > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          )}
          {title}
        </span>
      }
      icon={MARKETPLACES_ICON}
      footer={
        groups.length > 0 ? (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500 tabular-nums">
              {totalProcessed} / {totalPlanned}
            </span>
            <button
              type="button"
              onClick={clear}
              className="text-slate-500 hover:text-slate-700 underline"
            >
              Vider la liste
            </button>
          </div>
        ) : undefined
      }
    >
      {groups.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-slate-500">Aucune synchro en cours.</p>
          <p className="text-[11px] text-slate-400 mt-1">
            Les rafraîchissements marketplaces déclenchés depuis la page Produits
            apparaîtront ici.
          </p>
        </div>
      ) : (
        <>
          {totalPlanned > 0 && (
            <div className="px-4 py-2 border-b border-slate-100 bg-white">
              <div className="relative h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-500 to-sky-400 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
          <SectionBlock
            title="Erreurs"
            tone="rose"
            groups={bySection.errors}
            defaultOpen
            tooltipHandle={tooltipHandle}
            onRetry={retryErrorsOf}
          />
          <SectionBlock
            title="En cours"
            tone="sky"
            groups={bySection.active}
            defaultOpen
            tooltipHandle={tooltipHandle}
          />
          <SectionBlock
            title="En attente"
            tone="slate"
            groups={bySection.queued}
            tooltipHandle={tooltipHandle}
          />
          <SectionBlock
            title="Terminés"
            tone="emerald"
            groups={bySection.done}
            tooltipHandle={tooltipHandle}
          />
        </>
      )}
      <MarketplaceTooltipHost handleRef={tooltipHandle} />
    </DrawerShell>
  );
}

// ────────────────────────────────────────────────────────────────
// Section pliable
// ────────────────────────────────────────────────────────────────

type Tone = "rose" | "sky" | "slate" | "emerald";

const TONE_CLASSES: Record<
  Tone,
  { bg: string; text: string; badge: string; empty: boolean }
> = {
  rose: {
    bg: "bg-rose-50/40",
    text: "text-rose-700",
    badge: "bg-rose-100 text-rose-700",
    empty: false,
  },
  sky: {
    bg: "bg-sky-50/20",
    text: "text-slate-800",
    badge: "bg-sky-100 text-sky-700",
    empty: false,
  },
  slate: {
    bg: "",
    text: "text-slate-800",
    badge: "bg-slate-100 text-slate-600",
    empty: false,
  },
  emerald: {
    bg: "bg-emerald-50/30",
    text: "text-emerald-700",
    badge: "bg-emerald-100 text-emerald-700",
    empty: false,
  },
};

function SectionBlock({
  title,
  tone,
  groups,
  defaultOpen = false,
  tooltipHandle,
  onRetry,
}: {
  title: string;
  tone: Tone;
  groups: ProductGroup[];
  defaultOpen?: boolean;
  tooltipHandle: React.MutableRefObject<TooltipHandle | null>;
  onRetry?: (group: ProductGroup) => void;
}) {
  if (groups.length === 0) return null;
  const t = TONE_CLASSES[tone];
  return (
    <details open={defaultOpen} className="border-b border-slate-100 group/section">
      <summary
        className={`px-4 py-2.5 flex items-center gap-2 cursor-pointer hover:bg-slate-50/60 ${t.bg} list-none`}
      >
        <svg
          className="w-3.5 h-3.5 text-slate-500 transition-transform group-open/section:rotate-90"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className={`text-sm font-semibold flex-1 ${t.text}`}>{title}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${t.badge}`}>
          {groups.length}
        </span>
      </summary>
      <div className="p-3 space-y-2.5">
        {groups.map((g) => (
          <ProductCard
            key={g.productId}
            group={g}
            tooltipHandle={tooltipHandle}
            onRetry={onRetry ? () => onRetry(g) : undefined}
          />
        ))}
      </div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────
// Carte produit
// ────────────────────────────────────────────────────────────────

function ProductCard({
  group,
  tooltipHandle,
  onRetry,
}: {
  group: ProductGroup;
  tooltipHandle: React.MutableRefObject<TooltipHandle | null>;
  onRetry?: () => void;
}) {
  const toast = useToast();
  const isError = group.section === "errors";

  const copyReference = () => {
    void navigator.clipboard.writeText(group.reference).then(
      () => toast.success("Copié", `Référence ${group.reference} copiée.`),
      () => toast.error("Copie impossible", "Le presse-papier n'est pas disponible."),
    );
  };

  return (
    <div
      className={`bg-white rounded-xl overflow-hidden shadow-sm border ${
        isError ? "border-rose-200" : "border-slate-200"
      }`}
    >
      <div
        className={`px-3 py-2.5 flex items-center gap-2.5 border-b ${
          isError
            ? "bg-gradient-to-r from-rose-50 to-white border-rose-100"
            : "border-slate-100"
        }`}
      >
        <ProductThumb group={group} />
        <div className="min-w-0 flex-1">
          <p
            className="text-[13px] font-semibold truncate text-slate-800"
            title={group.productName}
          >
            {group.productName}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[11px] font-mono text-slate-500 truncate">
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
        </div>
        <StatusIcon group={group} />
      </div>

      <div className="px-3 py-2.5 flex items-center gap-1.5 flex-wrap">
        {MARKETPLACE_ORDER.map((target) => (
          <BadgeForCell
            key={target}
            target={target}
            cell={group.cells[target]}
            tooltipHandle={tooltipHandle}
          />
        ))}
      </div>

      {(isError && onRetry) || group.latestActivityAt ? (
        <div
          className={`px-3 py-2 flex items-center justify-between ${
            isError ? "border-t border-rose-100" : "border-t border-slate-100"
          }`}
        >
          <span className="text-[10px] text-slate-500">
            {group.latestActivityAt ? relativeTime(group.latestActivityAt) : ""}
          </span>
          {isError && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-rose-600 text-white font-semibold hover:bg-rose-700 transition-colors"
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
    <img
      src={group.firstImage}
      alt=""
      className="w-11 h-11 rounded-lg object-cover bg-slate-100 ring-1 ring-slate-200 group-hover:ring-sky-400 transition-shadow"
    />
  ) : (
    <div className="w-11 h-11 rounded-lg bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center">
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
      <span className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
        <svg
          className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
          />
        </svg>
      </span>
    </a>
  );
}

function StatusIcon({ group }: { group: ProductGroup }) {
  if (group.section === "active" || group.section === "queued") {
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
    <svg
      className="w-4 h-4 text-emerald-600 flex-shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={3}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
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

// ────────────────────────────────────────────────────────────────
// Utilitaires
// ────────────────────────────────────────────────────────────────

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
