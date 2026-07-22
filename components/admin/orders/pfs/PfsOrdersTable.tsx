"use client";

import { useMemo, useState } from "react";
import type {
  PfsOrderListItem,
  PfsStockDeductionState,
  PfsNothingToDeductReason,
  PfsStockFilter,
} from "@/app/actions/admin/pfs-orders";
import CustomSelect from "@/components/ui/CustomSelect";

const STATUS_ICONS: Record<"" | PfsOrderListItem["status"], string> = {
  "": "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5",
  NEW: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z",
  VALIDATED: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  SENT: "M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5",
  CANCELLED: "M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
};

const STOCK_META: Record<PfsStockDeductionState, { label: string; className: string; tooltip: string }> = {
  NOT_APPLICABLE: {
    label: "—",
    className: "bg-bg-secondary text-text-muted border-border",
    tooltip: "Statut de la commande non concerné (nouveau ou annulé).",
  },
  NOTHING_TO_DEDUCT: {
    label: "Rien à déduire",
    className: "bg-bg-secondary text-text-muted border-border",
    tooltip: "Aucun produit lié — rien à déduire.",
  },
  PENDING: {
    label: "À déduire",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    tooltip: "Cette commande sera traitée au prochain clic sur « Déduire stock PFS ».",
  },
  DONE: {
    label: "Déduit",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    tooltip: "Le stock a bien été déduit pour cette commande.",
  },
};

const STATUS_META: Record<
  PfsOrderListItem["status"],
  { label: string; className: string }
> = {
  NEW: {
    label: "Nouveau",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  VALIDATED: {
    label: "Validé",
    className: "bg-slate-100 text-slate-700 border-slate-200",
  },
  SENT: {
    label: "Envoyé",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  CANCELLED: {
    label: "Annulé",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  },
};

interface Props {
  items: PfsOrderListItem[] | null;
  total: number;
  page: number;
  totalPages: number;
  q: string;
  onQChange: (v: string) => void;
  statusFilter: "" | PfsOrderListItem["status"];
  onStatusChange: (s: "" | PfsOrderListItem["status"]) => void;
  stockFilter: PfsStockFilter;
  onStockFilterChange: (v: PfsStockFilter) => void;
  onPageChange: (n: number) => void;
  onOpen: (id: string) => void;
  onDeductClick: (id: string) => void;
  statusCounts: Record<"NEW" | "VALIDATED" | "SENT" | "CANCELLED", number> | null;
}

const STOCK_FILTER_ICONS: Record<PfsStockFilter, string> = {
  all: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5",
  pending: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  done: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  nothing: "M18.364 18.364A9 9 0 105.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L5.636 5.636",
};

export default function PfsOrdersTable(props: Props) {
  const {
    items,
    total,
    page,
    totalPages,
    q,
    onQChange,
    statusFilter,
    onStatusChange,
    stockFilter,
    onStockFilterChange,
    onPageChange,
    onOpen,
    onDeductClick,
    statusCounts,
  } = props;

  const options = useMemo(
    () => [
      { value: "", label: `Tous statuts (${total})`, icon: STATUS_ICONS[""] },
      { value: "NEW", label: `Nouveau (${statusCounts?.NEW ?? 0})`, icon: STATUS_ICONS.NEW },
      { value: "VALIDATED", label: `Validé (${statusCounts?.VALIDATED ?? 0})`, icon: STATUS_ICONS.VALIDATED },
      { value: "SENT", label: `Envoyé (${statusCounts?.SENT ?? 0})`, icon: STATUS_ICONS.SENT },
      { value: "CANCELLED", label: `Annulé (${statusCounts?.CANCELLED ?? 0})`, icon: STATUS_ICONS.CANCELLED },
    ],
    [statusCounts, total],
  );

  const stockOptions = useMemo(
    () => [
      { value: "all", label: "Stock : Tout", icon: STOCK_FILTER_ICONS.all },
      { value: "pending", label: "Stock : À déduire", icon: STOCK_FILTER_ICONS.pending },
      { value: "done", label: "Stock : Déduit", icon: STOCK_FILTER_ICONS.done },
      { value: "nothing", label: "Stock : Rien à déduire", icon: STOCK_FILTER_ICONS.nothing },
    ],
    [],
  );

  return (
    <section className="rounded-2xl bg-bg-primary border border-border shadow-sm overflow-hidden">
      <div className="p-4 border-b border-border flex flex-wrap items-center gap-3">
        <div className="text-xs uppercase tracking-[0.2em] text-text-muted font-medium">
          Toutes les commandes
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            placeholder="N° commande, client…"
            className="text-sm rounded-lg border border-border px-3 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          <CustomSelect
            value={statusFilter}
            onChange={(v) => onStatusChange(v as Props["statusFilter"])}
            options={options}
            size="sm"
            aria-label="Filtrer par statut"
            className="min-w-[210px]"
          />
          <CustomSelect
            value={stockFilter}
            onChange={(v) => onStockFilterChange(v as PfsStockFilter)}
            options={stockOptions}
            size="sm"
            aria-label="Filtrer par état de déduction du stock"
            className="min-w-[210px]"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-secondary text-xs uppercase tracking-wider text-text-muted">
            <tr>
              <th className="text-left px-5 py-3 font-medium">N° commande</th>
              <th className="text-left px-5 py-3 font-medium">Date</th>
              <th className="text-left px-5 py-3 font-medium">Client</th>
              <th className="text-right px-5 py-3 font-medium">Montant TTC</th>
              <th className="text-center px-5 py-3 font-medium">Stock</th>
              <th className="text-center px-5 py-3 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items?.map((row) => {
              const meta = STATUS_META[row.status];
              return (
                <tr
                  key={row.id}
                  onClick={() => onOpen(row.id)}
                  className="hover:bg-bg-secondary cursor-pointer"
                >
                  <td className="px-5 py-3 font-mono text-text-primary font-semibold">
                    {row.orderNumber}
                  </td>
                  <td className="px-5 py-3 text-text-secondary">
                    {new Date(row.createdAtPfs).toLocaleString("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-text-primary truncate max-w-[220px]">
                      {row.customerShop || row.customerName}
                    </div>
                    <div className="text-xs text-text-muted truncate max-w-[220px]">
                      {row.customerShop ? row.customerName : ""}
                      {row.customerCountry ? ` · ${row.customerCountry}` : ""}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-text-primary">
                    {row.totalTTC.toFixed(2).replace(".", ",")} €
                  </td>
                  <td className="px-5 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <StockBadge row={row} onDeductClick={onDeductClick} />
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={`inline-block rounded-full text-xs px-3 py-0.5 font-medium border ${meta.className}`}>
                      {meta.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {items && items.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-text-muted text-sm">
                  Aucune commande sur la période sélectionnée.
                </td>
              </tr>
            )}
            {items === null && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-text-muted text-sm">
                  Chargement…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-border flex justify-between items-center text-xs text-text-muted">
        <div>
          {items?.length ?? 0} commandes affichées sur {total.toLocaleString("fr-FR")}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded border border-border px-2 py-1 hover:bg-bg-secondary disabled:opacity-40"
          >
            ‹ Précédent
          </button>
          <span className="px-2 py-1">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded border border-border px-2 py-1 hover:bg-bg-secondary disabled:opacity-40"
          >
            Suivant ›
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Badge « Stock » avec tooltip natif pour les états simples et un popover custom
 * pour « Rien à déduire » qui liste les articles PFS non rattachés à la boutique.
 */
function StockBadge({
  row,
  onDeductClick,
}: {
  row: PfsOrderListItem;
  onDeductClick: (id: string) => void;
}) {
  const stockMeta = STOCK_META[row.stockDeductionState];
  const canShowCustomTooltip =
    row.stockDeductionState === "NOTHING_TO_DEDUCT" && !!row.stockDeductionReason;
  const isClickable = row.stockDeductionState === "PENDING";
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const handleEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!canShowCustomTooltip) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchor({ x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  };
  const handleLeave = () => setAnchor(null);

  const commonClass = `inline-block rounded-full text-xs px-3 py-0.5 font-medium border ${stockMeta.className}`;

  if (isClickable) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDeductClick(row.id);
        }}
        title="Cliquez pour prévisualiser et déduire le stock de cette commande."
        className={`${commonClass} cursor-pointer hover:brightness-95 hover:shadow-sm transition-all`}
      >
        {stockMeta.label}
      </button>
    );
  }

  return (
    <>
      <span
        className={`${commonClass} ${canShowCustomTooltip ? "cursor-help" : ""}`}
        title={canShowCustomTooltip ? undefined : stockMeta.tooltip}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter as unknown as React.FocusEventHandler<HTMLSpanElement>}
        onBlur={handleLeave}
      >
        {stockMeta.label}
      </span>

      {anchor && canShowCustomTooltip && row.stockDeductionReason && (
        <NothingToDeductTooltip anchor={anchor} reason={row.stockDeductionReason} />
      )}
    </>
  );
}

function NothingToDeductTooltip({
  anchor,
  reason,
}: {
  anchor: { x: number; y: number };
  reason: PfsNothingToDeductReason;
}) {
  const remaining = Math.max(0, reason.totalUnlinkedCount - reason.sampleUnlinkedItems.length);
  return (
    <div
      className="fixed z-[80] pointer-events-none -translate-x-1/2 w-[320px] max-w-[92vw]"
      style={{ left: anchor.x, top: anchor.y }}
      role="tooltip"
    >
      <div className="rounded-xl bg-slate-900 text-white shadow-2xl border border-slate-700 p-3.5 text-left">
        <div className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-slate-300 mb-1.5">
          Pourquoi rien à déduire ?
        </div>
        {reason.hasNoItems ? (
          <p className="text-xs text-slate-100 leading-snug">
            Cette commande PFS ne contient aucun article.
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-100 leading-snug">
              {reason.totalUnlinkedCount === 1
                ? "1 article de cette commande n'est pas rattaché à un produit de votre boutique."
                : `${reason.totalUnlinkedCount} articles de cette commande ne sont pas rattachés à un produit de votre boutique.`}
            </p>
            {reason.sampleUnlinkedItems.length > 0 && (
              <ul className="mt-2.5 space-y-1 text-[11.5px] text-slate-200">
                {reason.sampleUnlinkedItems.map((it, i) => (
                  <li key={`${it.pfsProductRef}-${i}`} className="flex gap-2">
                    <span className="font-mono text-slate-300 shrink-0">{it.pfsProductRef}</span>
                    <span className="truncate">
                      {it.productName || "Nom inconnu"}
                      {it.colorLabel ? ` · ${it.colorLabel}` : ""}
                      {it.sizeLabel ? ` · ${it.sizeLabel}` : ""}
                    </span>
                  </li>
                ))}
                {remaining > 0 && (
                  <li className="text-slate-400 italic">
                    et {remaining} autre{remaining > 1 ? "s" : ""}…
                  </li>
                )}
              </ul>
            )}
            <p className="mt-2.5 text-[11px] text-slate-400 leading-snug">
              Rattachez ces produits à votre boutique pour permettre la déduction.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
