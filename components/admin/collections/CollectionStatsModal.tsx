"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "@/components/ui/SmartImage";
import { getCollectionStats, type CollectionStats } from "@/app/actions/admin/collections";

interface Props {
  collectionId: string;
  collectionName: string;
  open: boolean;
  onClose: () => void;
}

export default function CollectionStatsModal({ collectionId, collectionName, open, onClose }: Props) {
  const [data, setData] = useState<CollectionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const stats = await getCollectionStats(collectionId);
      setData(stats);
    } catch {
      setError("Impossible de charger les statistiques.");
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  if (!open) return null;

  const viewsToday = data ? data.viewsAnonymousToday + data.viewsConnectedToday : 0;
  const viewsTotal = data ? data.viewsAnonymousTotal + data.viewsConnectedTotal : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-bg-primary rounded-2xl shadow-lg max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h3 className="font-heading text-lg font-bold text-text-primary">Statistiques collection</h3>
            <p className="text-xs font-body text-text-muted truncate">{collectionName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-bg-secondary transition-colors" aria-label="Fermer">
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

          {/* KPI vues (anonyme vs connecté) */}
          <div>
            <h4 className="font-heading text-sm font-semibold text-text-primary mb-3">Vues</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Aujourd'hui"
                value={fmt(viewsToday, loading && !data)}
                hint={data ? `${data.viewsConnectedToday} connectées · ${data.viewsAnonymousToday} anonymes` : "Depuis minuit"}
                color="#0EA5E9"
                icon={<IconEye />}
              />
              <StatCard
                label="Total"
                value={fmt(viewsTotal, loading && !data)}
                hint={data ? `${data.viewsConnectedTotal} connectées · ${data.viewsAnonymousTotal} anonymes` : "Depuis la création"}
                color="#2563EB"
                icon={<IconEye />}
              />
              <StatCard
                label="Connectées (total)"
                value={fmt(data?.viewsConnectedTotal, loading && !data)}
                hint="Vues identifiées"
                color="#059669"
                icon={<IconUser />}
              />
              <StatCard
                label="Anonymes (total)"
                value={fmt(data?.viewsAnonymousTotal, loading && !data)}
                hint="Visiteuses non connectées"
                color="#64748B"
                icon={<IconAnon />}
              />
            </div>
          </div>

          {/* KPI panier */}
          <div>
            <h4 className="font-heading text-sm font-semibold text-text-primary mb-3">Ajouts au panier</h4>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Aujourd'hui"
                value={fmt(data?.cartAdditionsToday, loading && !data)}
                hint="Depuis minuit"
                color="#7C3AED"
                icon={<IconCart />}
              />
              <StatCard
                label="Total"
                value={fmt(data?.cartAdditionsTotal, loading && !data)}
                hint="Depuis la création"
                color="#DB2777"
                icon={<IconCart />}
              />
            </div>
          </div>

          {/* Top produits ajoutés au panier */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-heading text-sm font-semibold text-text-primary">
                Top produits ajoutés au panier
                <span className="ml-2 text-xs text-text-muted font-body font-normal">(depuis cette collection)</span>
              </h4>
            </div>

            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-secondary">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Produit</th>
                    <th className="px-4 py-2.5 text-center font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Ajouts</th>
                    <th className="px-4 py-2.5 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Qté totale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {loading && !data && (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-text-muted font-body">Chargement…</td></tr>
                  )}
                  {!loading && data && data.topProducts.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-text-muted font-body">Aucun ajout au panier depuis cette collection pour l&apos;instant.</td></tr>
                  )}
                  {data && data.topProducts.map((p) => (
                    <tr key={p.productId} className="hover:bg-bg-secondary/50">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-bg-secondary overflow-hidden shrink-0">
                            {p.image ? (
                              <Image src={p.image} alt={p.name} width={40} height={40} className="w-full h-full object-cover" />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-text-primary font-body truncate max-w-[280px]">{p.name}</p>
                            <p className="text-xs text-text-muted font-body font-mono">{p.reference}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center text-text-secondary font-body tabular-nums">{p.additionsCount}</td>
                      <td className="px-4 py-2.5 text-right font-heading font-semibold text-text-primary tabular-nums">{p.totalQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Clientes connectées qui ont vu la collection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-heading text-sm font-semibold text-text-primary">
                Clientes qui ont vu la collection
                {data && (
                  <span className="ml-2 text-xs text-text-muted font-body font-normal">
                    ({data.clientViewers.length})
                  </span>
                )}
              </h4>
            </div>

            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-secondary">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Cliente</th>
                    <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Société</th>
                    <th className="px-4 py-2.5 text-center font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Vues</th>
                    <th className="px-4 py-2.5 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Dernière vue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {loading && !data && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-text-muted font-body">Chargement…</td></tr>
                  )}
                  {!loading && data && data.clientViewers.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-text-muted font-body">Aucune cliente connectée n&apos;a vu cette collection.</td></tr>
                  )}
                  {data && data.clientViewers.map((v) => (
                    <tr key={v.userId} className="hover:bg-bg-secondary/50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-text-primary font-body">{v.firstName} {v.lastName}</p>
                        <p className="text-xs text-text-muted font-body truncate max-w-[220px]">{v.email}</p>
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary font-body truncate max-w-[180px]">{v.company || "—"}</td>
                      <td className="px-4 py-2.5 text-center text-text-secondary font-body tabular-nums">{v.viewsCount}</td>
                      <td className="px-4 py-2.5 text-right text-text-secondary font-body text-xs">{formatDate(v.lastViewedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Clientes connectées qui ont ajouté au panier depuis la collection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-heading text-sm font-semibold text-text-primary">
                Clientes qui ont ajouté au panier
                {data && (
                  <span className="ml-2 text-xs text-text-muted font-body font-normal">
                    ({data.clientBuyers.length})
                  </span>
                )}
              </h4>
            </div>

            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-secondary">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Cliente</th>
                    <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Société</th>
                    <th className="px-4 py-2.5 text-center font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Ajouts</th>
                    <th className="px-4 py-2.5 text-center font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Qté totale</th>
                    <th className="px-4 py-2.5 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Dernier ajout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {loading && !data && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-text-muted font-body">Chargement…</td></tr>
                  )}
                  {!loading && data && data.clientBuyers.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-text-muted font-body">Aucun ajout au panier pour l&apos;instant.</td></tr>
                  )}
                  {data && data.clientBuyers.map((b) => (
                    <tr key={b.userId} className="hover:bg-bg-secondary/50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-text-primary font-body">{b.firstName} {b.lastName}</p>
                        <p className="text-xs text-text-muted font-body truncate max-w-[220px]">{b.email}</p>
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary font-body truncate max-w-[180px]">{b.company || "—"}</td>
                      <td className="px-4 py-2.5 text-center text-text-secondary font-body tabular-nums">{b.additionsCount}</td>
                      <td className="px-4 py-2.5 text-center font-heading font-semibold text-text-primary tabular-nums">{b.totalQuantity}</td>
                      <td className="px-4 py-2.5 text-right text-text-secondary font-body text-xs">{formatDate(b.lastAddedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(n: number | undefined, loading: boolean): string {
  if (loading && n === undefined) return "…";
  return (n ?? 0).toString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function IconEye() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function IconCart() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218a.75.75 0 00.737-.633l1.5-9.375a.75.75 0 00-.737-.867H5.106M7.5 14.25L5.106 5.155m0 0L4.5 3M16.5 19.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm-9.75 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function IconAnon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
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
