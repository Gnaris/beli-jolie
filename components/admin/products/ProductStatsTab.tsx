"use client";

import { useEffect, useState, useTransition } from "react";
import { getProductStats } from "@/app/actions/admin/products";

type Stats = Awaited<ReturnType<typeof getProductStats>>;

export default function ProductStatsTab({ productId }: { productId: string }) {
  const [stats, setStats] = useState<Stats>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const data = await getProductStats(productId);
      setStats(data);
    });
  }, [productId]);

  if (isPending && !stats) {
    return <p className="text-sm text-text-muted font-body py-8">Chargement des statistiques...</p>;
  }

  if (!stats) {
    return <p className="text-sm text-text-muted font-body py-8">Statistiques indisponibles.</p>;
  }

  const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: "Revenu total", value: fmt(stats.totalRevenue) },
          { label: "Quantite vendue", value: String(stats.totalQuantitySold) },
          { label: "Commandes", value: String(stats.totalOrders) },
          { label: "En panier", value: String(stats.inCartsCount) },
          { label: "Vues", value: String(stats.viewCount) },
          { label: "Reclamations", value: String(stats.claimCount) },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-bg-secondary rounded-xl p-4">
            <p className="font-heading text-xl font-bold text-text-primary">{kpi.value}</p>
            <p className="text-xs text-text-muted font-body">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Monthly sales */}
      {stats.monthlySales.length > 0 && (
        <div>
          <h4 className="font-heading font-bold text-text-primary mb-3">Ventes mensuelles</h4>
          <div className="flex items-end gap-1 h-32">
            {stats.monthlySales.map((m) => {
              const maxRev = Math.max(...stats.monthlySales.map((s) => s.revenue), 1);
              const height = Math.max((m.revenue / maxRev) * 100, 2);
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1" title={`${m.month}: ${fmt(m.revenue)}`}>
                  <div className="w-full bg-accent/20 rounded-t" style={{ height: `${height}%` }}>
                    <div className="w-full h-full bg-accent/60 rounded-t" />
                  </div>
                  <span className="text-[8px] text-text-muted font-body">{m.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sales by color */}
      {stats.salesByColor.length > 0 && (
        <div>
          <h4 className="font-heading font-bold text-text-primary mb-3">Ventes par couleur</h4>
          <div className="space-y-2">
            {stats.salesByColor.map((c) => (
              <div key={c.colorName} className="flex items-center justify-between text-sm font-body">
                <span className="text-text-primary">{c.colorName}</span>
                <span className="text-text-muted">{c.quantity} pcs — {fmt(c.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top clients */}
      {stats.topClients.length > 0 && (
        <div>
          <h4 className="font-heading font-bold text-text-primary mb-3">Meilleurs clients</h4>
          <div className="space-y-2">
            {stats.topClients.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm font-body">
                <span className="text-text-primary">{c.company}</span>
                <span className="text-text-muted">{c.quantity} pcs — {fmt(c.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Price history */}
      {stats.priceHistory.length > 0 && (
        <div>
          <h4 className="font-heading font-bold text-text-primary mb-3">Historique des prix</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-2 text-xs uppercase tracking-wider text-text-muted font-semibold">Date</th>
                  <th className="text-left px-2 py-2 text-xs uppercase tracking-wider text-text-muted font-semibold">Champ</th>
                  <th className="text-right px-2 py-2 text-xs uppercase tracking-wider text-text-muted font-semibold">Ancien</th>
                  <th className="text-right px-2 py-2 text-xs uppercase tracking-wider text-text-muted font-semibold">Nouveau</th>
                  <th className="text-left px-2 py-2 text-xs uppercase tracking-wider text-text-muted font-semibold">Admin</th>
                </tr>
              </thead>
              <tbody>
                {stats.priceHistory.map((ph, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-2 py-2 text-text-muted">{new Date(ph.date).toLocaleDateString("fr-FR")}</td>
                    <td className="px-2 py-2 text-text-primary">{ph.field}</td>
                    <td className="px-2 py-2 text-right text-text-muted">{ph.oldPrice.toFixed(2)}EUR</td>
                    <td className="px-2 py-2 text-right text-text-primary font-semibold">{ph.newPrice.toFixed(2)}EUR</td>
                    <td className="px-2 py-2 text-text-muted">{ph.admin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
