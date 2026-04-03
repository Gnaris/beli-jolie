"use client";

import { useEffect, useState, useTransition } from "react";
import { getStockHistory } from "@/app/actions/admin/stock";

type Movement = Awaited<ReturnType<typeof getStockHistory>>[number];

const TYPE_BADGES: Record<string, { className: string; label: string }> = {
  MANUAL_IN:  { className: "badge badge-success", label: "Entree" },
  MANUAL_OUT: { className: "badge badge-warning", label: "Sortie" },
  ORDER:      { className: "badge badge-info",    label: "Commande" },
  CANCEL:     { className: "badge badge-neutral",  label: "Annulation" },
  RETURN:     { className: "badge badge-purple",   label: "Retour" },
  IMPORT:     { className: "badge badge-neutral",  label: "Import" },
};

interface StockHistoryTableProps {
  productColorId: string;
  refreshKey?: number;
}

export default function StockHistoryTable({ productColorId, refreshKey }: StockHistoryTableProps) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const data = await getStockHistory(productColorId);
      setMovements(data);
    });
  }, [productColorId, refreshKey]);

  if (isPending && movements.length === 0) {
    return <p className="text-sm text-text-muted font-body py-4">Chargement...</p>;
  }

  if (movements.length === 0) {
    return <p className="text-sm text-text-muted font-body py-4">Aucun mouvement de stock.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-body">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-2 py-2 text-xs uppercase tracking-wider text-text-muted font-semibold">Date</th>
            <th className="text-left px-2 py-2 text-xs uppercase tracking-wider text-text-muted font-semibold">Type</th>
            <th className="text-right px-2 py-2 text-xs uppercase tracking-wider text-text-muted font-semibold">Qte</th>
            <th className="text-left px-2 py-2 text-xs uppercase tracking-wider text-text-muted font-semibold">Raison</th>
            <th className="text-left px-2 py-2 text-xs uppercase tracking-wider text-text-muted font-semibold">Commande</th>
            <th className="text-left px-2 py-2 text-xs uppercase tracking-wider text-text-muted font-semibold">Admin</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => {
            const badge = TYPE_BADGES[m.type] || { className: "badge badge-neutral", label: m.type };
            return (
              <tr key={m.id} className="border-b border-border/50 hover:bg-bg-secondary/50">
                <td className="px-2 py-2 text-text-muted whitespace-nowrap">
                  {new Date(m.createdAt).toLocaleDateString("fr-FR", {
                    day: "2-digit", month: "2-digit", year: "2-digit",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </td>
                <td className="px-2 py-2">
                  <span className={badge.className}>{badge.label}</span>
                </td>
                <td className={`px-2 py-2 text-right font-semibold ${m.quantity > 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                  {m.quantity > 0 ? "+" : ""}{m.quantity}
                </td>
                <td className="px-2 py-2 text-text-muted max-w-[200px] truncate">
                  {m.reason || "—"}
                </td>
                <td className="px-2 py-2">
                  {m.order ? (
                    <a href={`/admin/commandes/${m.orderId}`} className="text-text-primary underline hover:no-underline">
                      {m.order.orderNumber}
                    </a>
                  ) : "—"}
                </td>
                <td className="px-2 py-2 text-text-muted">
                  {m.createdBy ? `${m.createdBy.firstName} ${m.createdBy.lastName}` : "Systeme"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
