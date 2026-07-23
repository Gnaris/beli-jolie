"use client";

import type { MarketplaceStatsBundle } from "@/app/actions/admin/marketplace-orders";
import MarketplaceBadge from "./MarketplaceBadge";

interface Props {
  stats: MarketplaceStatsBundle | null;
}

function formatEur(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
}
function formatInt(n: number) {
  return new Intl.NumberFormat("fr-FR").format(n);
}

export default function MarketplaceKpiRow({ stats }: Props) {
  const k = stats?.kpis;
  return (
    <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <KpiCard
        label="Commandes"
        value={k ? formatInt(k.ordersCount) : "…"}
        hint={
          k
            ? `${formatInt(k.bySource.PFS.ordersCount)} PFS · ${formatInt(k.bySource.EFASHION.ordersCount)} eFashion · ${formatInt(k.bySource.ANKORSTORE.ordersCount)} Ankor`
            : ""
        }
        badges
      />
      <KpiCard
        label="CA HT cumulé"
        value={k ? formatEur(k.totalHT) : "…"}
        hint={
          k
            ? `PFS ${formatEur(k.bySource.PFS.totalHT)} · eFashion ${formatEur(k.bySource.EFASHION.totalHT)} · Ankor ${formatEur(k.bySource.ANKORSTORE.totalHT)}`
            : ""
        }
      />
      <KpiCard
        label="Panier moyen"
        value={k ? formatEur(k.avgBasketHT) : "…"}
        hint="HT / commande"
      />
      <KpiCard
        label="Clients uniques"
        value={k ? formatInt(k.uniqueCustomers) : "…"}
        hint="fusionnés cross-marketplace"
      />
      <KpiCard
        label="Articles vendus"
        value={k ? formatInt(k.itemsSold) : "…"}
        hint={
          k && k.ordersCount > 0 ? `${Math.round(k.itemsSold / k.ordersCount)} pièces / commande` : ""
        }
      />
    </section>
  );
}

function KpiCard({
  label,
  value,
  hint,
  badges,
}: {
  label: string;
  value: string;
  hint?: string;
  badges?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-bg-primary border border-border shadow-sm p-4 relative">
      {badges && (
        <div className="absolute top-3 right-3 flex gap-1">
          <MarketplaceBadge source="PFS" size="xs" />
          <MarketplaceBadge source="EFASHION" size="xs" />
          <MarketplaceBadge source="ANKORSTORE" size="xs" />
        </div>
      )}
      <div className="text-xs uppercase tracking-[0.2em] text-text-muted">{label}</div>
      <div className="font-heading text-3xl font-bold text-text-primary mt-2 tabular-nums">
        {value}
      </div>
      {hint && <div className="text-xs text-text-muted mt-1">{hint}</div>}
    </div>
  );
}
