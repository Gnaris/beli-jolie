"use client";

import { useMemo } from "react";
import type { PfsOrderListItem } from "@/app/actions/admin/pfs-orders";

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
      { key: "", label: `Tous statuts (${total})` },
      { key: "NEW", label: `Nouveau (${statusCounts?.NEW ?? 0})` },
      { key: "VALIDATED", label: `Validé (${statusCounts?.VALIDATED ?? 0})` },
      { key: "SENT", label: `Envoyé (${statusCounts?.SENT ?? 0})` },
      { key: "CANCELLED", label: `Annulé (${statusCounts?.CANCELLED ?? 0})` },
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
          <select
            value={statusFilter}
            onChange={(e) => onStatusChange(e.target.value as Props["statusFilter"])}
            className="text-sm rounded-lg border border-border px-3 py-1.5 bg-white"
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-secondary text-xs uppercase tracking-wider text-text-muted">
            <tr>
              <th className="text-left px-5 py-3 font-medium">N° commande</th>
              <th className="text-left px-5 py-3 font-medium">Date</th>
              <th className="text-left px-5 py-3 font-medium">Client</th>
              <th className="text-left px-5 py-3 font-medium">Transporteur</th>
              <th className="text-right px-5 py-3 font-medium">Montant TTC</th>
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
                  <td className="px-5 py-3 text-text-secondary">{row.carrier || "—"}</td>
                  <td className="px-5 py-3 text-right font-semibold text-text-primary">
                    {row.totalTTC.toFixed(2).replace(".", ",")} €
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
