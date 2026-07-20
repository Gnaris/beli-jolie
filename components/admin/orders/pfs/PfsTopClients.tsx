"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PfsStatsBundle } from "@/app/actions/admin/pfs-orders";

interface Props {
  stats: PfsStatsBundle | null;
  onOpenOrder?: (id: string) => void;
}

function initials(s: string) {
  const parts = s.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
}

function formatEur(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
}

export default function PfsTopClients({ stats }: Props) {
  const [sort, setSort] = useState<"totalHT" | "ordersCount">("totalHT");
  const rows = useMemo(() => {
    if (!stats) return [];
    return [...stats.topClients].sort((a, b) =>
      sort === "totalHT" ? b.totalHT - a.totalHT : b.ordersCount - a.ordersCount,
    );
  }, [stats, sort]);

  return (
    <div className="rounded-2xl bg-bg-primary border border-border shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-xs uppercase tracking-[0.2em] text-text-muted font-medium">Top clients</div>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => setSort("totalHT")}
            className={`text-xs rounded-full px-2.5 py-1 ${
              sort === "totalHT" ? "bg-slate-900 text-white" : "bg-bg-secondary text-text-secondary"
            }`}
          >
            CA ↓
          </button>
          <button
            type="button"
            onClick={() => setSort("ordersCount")}
            className={`text-xs rounded-full px-2.5 py-1 ${
              sort === "ordersCount" ? "bg-slate-900 text-white" : "bg-bg-secondary text-text-secondary"
            }`}
          >
            Commandes ↓
          </button>
        </div>
      </div>
      {rows.length === 0 && (
        <p className="text-sm text-text-muted py-6 text-center">Aucun client sur la période sélectionnée.</p>
      )}
      <ul className="divide-y divide-border">
        {rows.map((c) => {
          const inner = (
            <>
              <span className="w-9 h-9 rounded-md bg-bg-secondary text-text-primary border border-border flex items-center justify-center font-heading font-bold text-sm uppercase">
                {initials(c.customerShop || c.customerName)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-text-primary truncate">
                  {c.customerShop || c.customerName}
                </div>
                <div className="text-xs text-text-muted truncate">
                  {c.ordersCount} commande{c.ordersCount > 1 ? "s" : ""}
                  {c.customerCountry ? ` · ${c.customerCountry}` : ""}
                  {c.customerShop && c.customerName !== c.customerShop ? ` · ${c.customerName}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="font-heading font-semibold text-text-primary">{formatEur(c.totalHT)}</div>
                <div className="text-xs text-text-muted">HT</div>
              </div>
            </>
          );
          return (
            <li key={c.pfsCustomerId}>
              {c.adminClientCardId ? (
                <Link
                  href={`/admin/utilisateurs?tab=fiches&card=${c.adminClientCardId}`}
                  className="flex items-center gap-3 py-3 -mx-2 px-2 hover:bg-bg-secondary rounded-lg"
                >
                  {inner}
                </Link>
              ) : (
                <div className="flex items-center gap-3 py-3 -mx-2 px-2">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
