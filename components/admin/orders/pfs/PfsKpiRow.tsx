"use client";

import type { PfsStatsBundle } from "@/app/actions/admin/pfs-orders";

interface Props {
  stats: PfsStatsBundle | null;
}

function formatEur(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
}

function formatInt(n: number) {
  return new Intl.NumberFormat("fr-FR").format(n);
}

export default function PfsKpiRow({ stats }: Props) {
  const k = stats?.kpis;
  return (
    <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <KpiCard label="Commandes" value={k ? formatInt(k.ordersCount) : "…"} hint={stats?.statusCounts ? statusHint(stats.statusCounts) : ""} />
      <KpiCard label="CA HT" value={k ? formatEur(k.totalHT) : "…"} hint={k ? `TTC : ${formatEur(k.totalTTC)}` : ""} />
      <KpiCard label="Panier moyen" value={k ? formatEur(k.avgBasketTTC) : "…"} hint="TTC / commande" />
      <KpiCard
        label="Clients uniques"
        value={k ? formatInt(k.uniqueCustomers) : "…"}
        hint={k && k.newCustomers > 0 ? `dont ${k.newCustomers} nouveau${k.newCustomers > 1 ? "x" : ""}` : ""}
      />
      <KpiCard label="Articles vendus" value={k ? formatInt(k.itemsSold) : "…"} hint={k && k.ordersCount > 0 ? `${Math.round(k.itemsSold / k.ordersCount)} pièces / commande` : ""} />
    </section>
  );
}

function statusHint(counts: Record<string, number>) {
  const parts: string[] = [];
  if (counts.NEW) parts.push(`${counts.NEW} nouveau${counts.NEW > 1 ? "x" : ""}`);
  if (counts.VALIDATED) parts.push(`${counts.VALIDATED} validé${counts.VALIDATED > 1 ? "s" : ""}`);
  if (counts.SENT) parts.push(`${counts.SENT} envoyé${counts.SENT > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-bg-primary border border-border shadow-sm p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-text-muted">{label}</div>
      <div className="font-heading text-3xl font-bold text-text-primary mt-2 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-text-muted mt-1">{hint}</div>}
    </div>
  );
}
