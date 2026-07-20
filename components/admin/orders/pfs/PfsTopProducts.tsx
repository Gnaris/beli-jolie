"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PfsStatsBundle } from "@/app/actions/admin/pfs-orders";

interface Props {
  stats: PfsStatsBundle | null;
}

function formatEur(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
}

export default function PfsTopProducts({ stats }: Props) {
  const [sort, setSort] = useState<"quantity" | "totalHT">("quantity");
  const rows = useMemo(() => {
    if (!stats) return [];
    return [...stats.topProducts].sort((a, b) =>
      sort === "quantity" ? b.quantitySold - a.quantitySold : b.totalHT - a.totalHT,
    );
  }, [stats, sort]);

  return (
    <div className="rounded-2xl bg-bg-primary border border-border shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-xs uppercase tracking-[0.2em] text-text-muted font-medium">Top produits vendus</div>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => setSort("quantity")}
            className={`text-xs rounded-full px-2.5 py-1 ${
              sort === "quantity" ? "bg-slate-900 text-white" : "bg-bg-secondary text-text-secondary"
            }`}
          >
            Quantité ↓
          </button>
          <button
            type="button"
            onClick={() => setSort("totalHT")}
            className={`text-xs rounded-full px-2.5 py-1 ${
              sort === "totalHT" ? "bg-slate-900 text-white" : "bg-bg-secondary text-text-secondary"
            }`}
          >
            CA ↓
          </button>
        </div>
      </div>
      {rows.length === 0 && (
        <p className="text-sm text-text-muted py-6 text-center">Aucun produit vendu sur la période.</p>
      )}
      <ul className="divide-y divide-border">
        {rows.map((p) => {
          const missing = !p.productId;
          const label = missing
            ? "Produit non présent sur notre site"
            : p.productName || p.pfsProductRef;
          const inner = (
            <>
              <div className="w-11 h-11 rounded-md bg-bg-secondary border border-border flex items-center justify-center text-xs text-text-muted shrink-0">
                {missing ? "?" : "IMG"}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`font-semibold truncate ${missing ? "italic text-text-muted" : "text-text-primary"}`}>
                  {label}
                </div>
                <div className="text-xs text-text-muted">
                  {p.pfsProductRef}
                  {sort === "totalHT" ? ` · ${p.quantitySold} pièce${p.quantitySold > 1 ? "s" : ""}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="font-heading font-semibold text-text-primary">
                  {sort === "quantity" ? p.quantitySold : formatEur(p.totalHT)}
                </div>
                <div className="text-xs text-text-muted">{sort === "quantity" ? "pièces" : "HT"}</div>
              </div>
            </>
          );
          return (
            <li key={`${p.pfsProductRef}-${p.productId ?? "none"}`}>
              {p.productId ? (
                <Link
                  href={`/admin/produits/${p.productId}`}
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
