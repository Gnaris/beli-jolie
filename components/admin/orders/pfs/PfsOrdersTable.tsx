"use client";

import { useMemo } from "react";
import type { PfsOrderListItem, PfsStockDeductionState } from "@/app/actions/admin/pfs-orders";
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
    label: "N/A",
    className: "bg-bg-secondary text-text-muted border-border",
    tooltip: "Aucun produit lié — rien à déduire.",
  },
  PENDING: {
    label: "À déduire",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    tooltip: "Cette commande sera traitée au prochain clic sur « Déduire stock PFS ».",
  },
  PARTIAL: {
    label: "Partiel",
    className: "bg-amber-50 text-amber-800 border-amber-300",
    tooltip: "Une partie du stock a été déduite. Certaines lignes n'ont pas pu être traitées.",
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
  onPageChange: (n: number) => void;
  onOpen: (id: string) => void;
  statusCounts: Record<"NEW" | "VALIDATED" | "SENT" | "CANCELLED", number> | null;
}

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
    onPageChange,
    onOpen,
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
                  <td className="px-5 py-3 text-center">
                    {(() => {
                      const stockMeta = STOCK_META[row.stockDeductionState];
                      const showRatio =
                        row.stockDeductionState === "PARTIAL" ||
                        row.stockDeductionState === "PENDING";
                      return (
                        <span
                          className={`inline-block rounded-full text-xs px-3 py-0.5 font-medium border ${stockMeta.className}`}
                          title={stockMeta.tooltip}
                        >
                          {stockMeta.label}
                          {showRatio && row.stockDeductionEligibleCount > 0
                            ? ` ${row.stockDeductionDoneCount}/${row.stockDeductionEligibleCount}`
                            : ""}
                        </span>
                      );
                    })()}
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
