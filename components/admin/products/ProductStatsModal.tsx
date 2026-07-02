"use client";

import { useEffect, useState, useCallback } from "react";

interface ClientRow {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  totalQty: number;
  totalSpent: number;
  ordersCount: number;
  lastOrderDate: string;
}

interface StatsResponse {
  totalSold: number;
  inCart: number;
  revenue: number;
  totalClients: number;
  page: number;
  pageSize: number;
  totalPages: number;
  clients: ClientRow[];
}

interface Props {
  productId: string;
  productName: string;
  reference: string;
}

export default function ProductStatsModal({ productId, productName, reference }: Props) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/${productId}/stats?page=${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: StatsResponse = await res.json();
      setData(json);
    } catch {
      setError("Impossible de charger les statistiques.");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (!open) return;
    load(page);
  }, [open, page, load]);

  function close() {
    setOpen(false);
    setPage(1);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary bg-bg-primary border border-border rounded-md hover:bg-bg-secondary hover:border-border-dark hover:text-text-primary transition-all font-body shadow-sm whitespace-nowrap"
        title="Voir les statistiques de ce produit"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
        Stats
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={close} />
          <div className="relative bg-bg-primary rounded-2xl shadow-lg max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-heading text-lg font-bold text-text-primary">
                  Statistiques produit
                </h3>
                <p className="text-xs font-body text-text-muted truncate">
                  {productName} — <span className="font-mono">{reference}</span>
                </p>
              </div>
              <button onClick={close} className="p-1 rounded-lg hover:bg-bg-secondary transition-colors" aria-label="Fermer">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-auto flex-1 p-6 space-y-6">
              {error && (
                <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 text-sm text-[#DC2626] font-body">
                  {error}
                </div>
              )}

              {/* Cartes chiffres */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatCard
                  label="Unités vendues"
                  value={data ? data.totalSold.toString() : (loading ? "…" : "0")}
                  hint="Hors commandes annulées"
                  color="#15803D"
                  icon={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218a.75.75 0 00.737-.633l1.5-9.375a.75.75 0 00-.737-.867H5.106M7.5 14.25L5.106 5.155m0 0L4.5 3M16.5 19.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm-9.75 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" /></svg>
                  }
                />
                <StatCard
                  label="Dans des paniers"
                  value={data ? data.inCart.toString() : (loading ? "…" : "0")}
                  hint="Quantité actuellement réservée"
                  color="#7C3AED"
                  icon={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218a.75.75 0 00.737-.633l1.5-9.375a.75.75 0 00-.737-.867H5.106M7.5 14.25L5.106 5.155m0 0L4.5 3M16.5 19.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm-9.75 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" /></svg>
                  }
                />
                <StatCard
                  label="Chiffre d'affaires"
                  value={data ? `${data.revenue.toFixed(2)} €` : (loading ? "…" : "0,00 €")}
                  hint="Cumul HT toutes commandes"
                  color="#1A1A1A"
                  icon={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>
                  }
                />
              </div>

              {/* Tableau clients */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-heading text-sm font-semibold text-text-primary">
                    Clients ayant déjà commandé ce produit
                    {data && (
                      <span className="ml-2 text-xs text-text-muted font-body font-normal">
                        ({data.totalClients})
                      </span>
                    )}
                  </h4>
                </div>

                <div className="border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-secondary">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Client</th>
                        <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Société</th>
                        <th className="px-4 py-2.5 text-center font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Cmd</th>
                        <th className="px-4 py-2.5 text-center font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Qté totale</th>
                        <th className="px-4 py-2.5 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Total dépensé</th>
                        <th className="px-4 py-2.5 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Dernière cmd</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-light">
                      {loading && !data && (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted font-body">Chargement…</td></tr>
                      )}
                      {!loading && data && data.clients.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted font-body">Aucun client n&apos;a encore commandé ce produit.</td></tr>
                      )}
                      {data && data.clients.map((c) => (
                        <tr key={c.userId} className="hover:bg-bg-secondary/50">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-text-primary font-body">
                              {c.firstName} {c.lastName}
                            </p>
                            <p className="text-xs text-text-muted font-body truncate max-w-[200px]">{c.email}</p>
                          </td>
                          <td className="px-4 py-2.5 text-text-secondary font-body truncate max-w-[180px]">{c.company || "—"}</td>
                          <td className="px-4 py-2.5 text-center text-text-secondary font-body tabular-nums">{c.ordersCount}</td>
                          <td className="px-4 py-2.5 text-center font-heading font-semibold text-text-primary tabular-nums">{c.totalQty}</td>
                          <td className="px-4 py-2.5 text-right text-text-primary font-body tabular-nums">{c.totalSpent.toFixed(2)} €</td>
                          <td className="px-4 py-2.5 text-right text-text-secondary font-body text-xs">
                            {new Date(c.lastOrderDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {data && data.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4">
                    <p className="text-xs text-text-muted font-body tabular-nums">
                      Page <span className="font-semibold text-text-secondary">{data.page}</span> sur {data.totalPages}
                      {" — "}
                      <span className="font-semibold text-text-secondary">
                        {(data.page - 1) * data.pageSize + 1}
                        {"–"}
                        {Math.min(data.page * data.pageSize, data.totalClients)}
                      </span>
                      {" sur "}{data.totalClients}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={data.page <= 1 || loading}
                        className="px-3 py-1.5 text-xs font-body font-medium border border-border rounded-lg bg-bg-primary text-text-secondary hover:border-bg-dark hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Précédent
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage((p) => p + 1)}
                        disabled={data.page >= data.totalPages || loading}
                        className="px-3 py-1.5 text-xs font-body font-medium border border-border rounded-lg bg-bg-primary text-text-secondary hover:border-bg-dark hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Suivant
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatCard({
  label, value, hint, color, icon,
}: {
  label: string;
  value: string;
  hint: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-bg-primary border border-border rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2" style={{ color }}>
        {icon}
        <p className="text-[11px] font-body uppercase tracking-wider font-semibold">{label}</p>
      </div>
      <p className="text-2xl font-heading font-bold text-text-primary tabular-nums">{value}</p>
      <p className="text-[11px] text-text-muted font-body mt-1">{hint}</p>
    </div>
  );
}
