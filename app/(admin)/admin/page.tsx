import type { Metadata } from "next";
import Link from "next/link";
import { getDashboardOverview, countryFlagEmoji } from "@/lib/dashboard-overview";
import DashboardKpiCard from "@/components/admin/dashboard/DashboardKpiCard";
import DashboardRevenueChart from "@/components/admin/dashboard/DashboardRevenueChart";
import DashboardCategoryDonut from "@/components/admin/dashboard/DashboardCategoryDonut";
import DashboardStatusDonut from "@/components/admin/dashboard/DashboardStatusDonut";

export const metadata: Metadata = { title: "Tableau de bord — Admin" };
export const dynamic = "force-dynamic";

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtInt(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}
function fmtPct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits).replace(".", ",")} %`;
}
function fmtRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `il y a ${days} j`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
function orderStatusChip(status: string) {
  switch (status) {
    case "SHIPPED":   return { label: "Expédiée",       cls: "bg-emerald-100 text-emerald-700" };
    case "VALIDATED": return { label: "Validée",        cls: "bg-sky-100 text-sky-700" };
    case "PENDING":   return { label: "En préparation", cls: "bg-amber-100 text-amber-700" };
    case "CANCELLED": return { label: "Annulée",        cls: "bg-rose-100 text-rose-700" };
    default:          return { label: status,            cls: "bg-zinc-100 text-zinc-700" };
  }
}

export default async function AdminDashboardPage() {
  const data = await getDashboardOverview();
  const monthRange = (() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
    return `${fmt(start)} – ${fmt(end)}`;
  })();

  return (
    // Neutralise le wrapper blanc du shell admin : fond slate pour laisser
    // "flotter" les cartes de la maquette.
    <div className="lg:-m-8 lg:p-6 lg:bg-slate-50 lg:rounded-2xl lg:min-h-[calc(100vh-180px)]">
      <div className="max-w-[1800px] mx-auto space-y-4">

        {/* ─── Entête ──────────────────────────────────────────── */}
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-heading text-[22px] md:text-[26px] font-bold tracking-tight text-text-primary">
              Tableau de bord
            </h1>
            <p className="text-[12px] text-text-muted mt-1">
              Voici un aperçu de votre activité e-commerce aujourd&apos;hui.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 bg-white border border-zinc-200 rounded-xl px-3 py-2 text-[11.5px] font-medium text-zinc-600 shadow-sm cursor-default"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            {monthRange}
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M5 7l5 5 5-5H5z" /></svg>
          </button>
        </header>

        {/* ─── KPIs ────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <DashboardKpiCard kpi={data.kpis.totalRevenue} />
          <DashboardKpiCard kpi={data.kpis.todayRevenue} />
          <DashboardKpiCard kpi={data.kpis.totalOrders} />
          <DashboardKpiCard kpi={data.kpis.uniqueClients} />
        </section>

        {/* ─── Évolution + Répartition ventes ──────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,1fr)] gap-3">
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">
                Évolution du chiffre d&apos;affaires
              </h2>
              <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full bg-[#246bfe]" />Chiffre d&apos;affaires</span>
                <span className="flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full bg-[#08a66a]" />Commandes</span>
              </div>
            </div>
            <div className="px-2 pb-3">
              <DashboardRevenueChart points={data.dailyRevenue} />
            </div>
          </article>

          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Répartition des ventes</h2>
              <Link href="/admin/categories" className="text-[10px] text-[#246bfe] hover:underline">
                Détails →
              </Link>
            </div>
            <DashboardCategoryDonut slices={data.categoryBreakdown} total={data.categoryTotal} />
          </article>
        </section>

        {/* ─── Top produits · Ventes catégories · Statut ──────── */}
        <section className="grid grid-cols-1 lg:grid-cols-[1.25fr_1.25fr_.95fr] gap-3">
          {/* Top produits */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Top 5 des produits les plus vendus</h2>
              <Link href="/admin/produits" className="text-[10px] text-[#246bfe] hover:underline">Voir tout →</Link>
            </div>
            <div className="overflow-x-auto px-3 pb-3">
              {data.topProducts.length === 0 ? (
                <p className="text-[11px] text-text-muted p-4">Pas encore de ventes.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-zinc-500 text-[9.5px] uppercase tracking-wider">
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100 w-6">#</th>
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100">Produit</th>
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100 text-right">Ventes</th>
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100 text-right">CA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.map((p, i) => (
                      <tr key={p.reference} className="border-b border-zinc-50 last:border-0">
                        <td className="py-2.5 px-2 text-zinc-500 font-medium">{i + 1}</td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-md bg-zinc-100 grid place-items-center overflow-hidden shrink-0">
                              {p.imagePath ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.imagePath} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-xs text-zinc-400">◇</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-text-primary truncate max-w-[180px]">{p.name}</div>
                              <div className="text-[9.5px] text-zinc-400 truncate">{p.reference}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right text-zinc-700 tabular-nums">{fmtInt(p.sales)}</td>
                        <td className="py-2.5 px-2 text-right text-zinc-700 tabular-nums">{fmtMoney(p.revenue)} €</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </article>

          {/* Ventes par catégorie */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Ventes par catégorie</h2>
              <Link href="/admin/categories" className="text-[10px] text-[#246bfe] hover:underline">Voir tout →</Link>
            </div>
            <div className="overflow-x-auto px-3 pb-3">
              {data.categoryBreakdown.length === 0 ? (
                <p className="text-[11px] text-text-muted p-4">Aucune donnée.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-zinc-500 text-[9.5px] uppercase tracking-wider">
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100">Catégorie</th>
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100 text-right">Ventes</th>
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100 text-right">CA</th>
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.categoryBreakdown.map((c) => (
                      <tr key={c.name} className="border-b border-zinc-50 last:border-0">
                        <td className="py-2.5 px-2">
                          <span className="inline-flex items-center gap-2 text-text-primary font-medium">
                            <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                            {c.name}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right text-zinc-700 tabular-nums">{fmtInt(c.sales)}</td>
                        <td className="py-2.5 px-2 text-right text-zinc-700 tabular-nums">{fmtMoney(c.revenue)} €</td>
                        <td className="py-2.5 px-2 text-right text-zinc-500 tabular-nums">{fmtPct(c.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </article>

          {/* Statut commandes */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Statut des commandes</h2>
            </div>
            <DashboardStatusDonut slices={data.orderStatus} total={data.orderStatusTotal} />
          </article>
        </section>

        {/* ─── Stock faible · Activité · Marketing ────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Stock faible */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Stock — produits en faible quantité</h2>
              <Link href="/admin/produits" className="text-[10px] text-[#246bfe] hover:underline">Voir tout →</Link>
            </div>
            <div className="overflow-x-auto px-3 pb-3">
              {data.lowStock.length === 0 ? (
                <p className="text-[11px] text-text-muted p-4">Aucun produit en alerte stock.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-zinc-500 text-[9.5px] uppercase tracking-wider">
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100">Produit</th>
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100 text-right">Stock</th>
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100 text-right">Seuil</th>
                      <th className="py-2 px-2 font-semibold border-b border-zinc-100 text-right">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lowStock.map((v) => {
                      const sevLabel = v.severity === "critical" ? "Critique" : v.severity === "low" ? "Faible" : "À surveiller";
                      const sevCls = v.severity === "warn" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700";
                      return (
                        <tr key={v.productId + v.colorLabel} className="border-b border-zinc-50 last:border-0">
                          <td className="py-2.5 px-2">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-md bg-zinc-100 overflow-hidden grid place-items-center shrink-0">
                                {v.imagePath ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={v.imagePath} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <span className="text-xs text-zinc-400">◇</span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-text-primary truncate max-w-[160px]">{v.name}</div>
                                <div className="text-[9.5px] text-zinc-400 truncate">{v.colorLabel}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-right font-semibold text-rose-600 tabular-nums">{v.stock}</td>
                          <td className="py-2.5 px-2 text-right text-zinc-500 tabular-nums">{v.threshold}</td>
                          <td className="py-2.5 px-2 text-right">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold ${sevCls}`}>
                              {sevLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </article>

          {/* Activité récente */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Activité récente</h2>
            </div>
            <div className="px-4 pb-4 space-y-3">
              {data.activity.length === 0 ? (
                <p className="text-[11px] text-text-muted">Pas d&apos;activité récente.</p>
              ) : data.activity.map((e, i) => {
                const icon =
                  e.kind === "order_new" ? "🛒"
                  : e.kind === "order_shipped" ? "🚚"
                  : e.kind === "user_new" ? "👤"
                  : "📦";
                return (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-blue-50 text-[#246bfe] grid place-items-center text-[13px] shrink-0">{icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-text-primary truncate">{e.title}</div>
                      <div className="text-[10px] text-text-muted">
                        {e.detail} · {fmtRelative(e.at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          {/* Performances marketing */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Performances marketing</h2>
            </div>
            <div className="grid grid-cols-3 gap-3 px-4 pb-3">
              <div className="pr-3 border-r border-zinc-100">
                <div className="text-[9px] text-text-muted uppercase tracking-wider">Visites 30j</div>
                <div className="text-[15px] font-bold text-text-primary tabular-nums mt-1">{fmtInt(data.marketing.visits)}</div>
              </div>
              <div className="pr-3 border-r border-zinc-100">
                <div className="text-[9px] text-text-muted uppercase tracking-wider">Conversion</div>
                <div className="text-[15px] font-bold text-text-primary tabular-nums mt-1">{fmtPct(data.marketing.conversionRate, 2)}</div>
              </div>
              <div>
                <div className="text-[9px] text-text-muted uppercase tracking-wider">Panier moyen</div>
                <div className="text-[15px] font-bold text-text-primary tabular-nums mt-1">{fmtMoney(data.marketing.avgBasket)} €</div>
              </div>
            </div>
            <div className="px-4 pb-4">
              <div className="flex items-end gap-1.5 h-[90px] border-b border-zinc-100 pb-2">
                {data.marketing.weeklyVisits.map((b, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full">
                    <div
                      className="w-full rounded-t-md bg-[#5a91ff] min-h-[6px] mt-auto transition-all"
                      style={{ height: `${Math.max(b.pct, 6)}%` }}
                      title={`${b.label} : ${b.count} visites`}
                    />
                    <span className="text-[9px] text-text-muted">{b.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-[9.5px] text-text-muted mt-2">Visites par jour · 7 derniers jours</p>
            </div>
          </article>
        </section>

        {/* ─── Commandes · Clients · Géographie ───────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Commandes récentes */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Commandes récentes</h2>
              <Link href="/admin/commandes" className="text-[10px] text-[#246bfe] hover:underline">Voir tout →</Link>
            </div>
            <div className="px-4 pb-3">
              {data.recentOrders.length === 0 ? (
                <p className="text-[11px] text-text-muted py-4">Aucune commande.</p>
              ) : data.recentOrders.map((o) => {
                const chip = orderStatusChip(o.status);
                return (
                  <Link
                    key={o.orderNumber}
                    href={`/admin/commandes/${o.orderNumber}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-3 py-2.5 border-b border-zinc-50 last:border-0 hover:bg-zinc-50/60 rounded-md -mx-2 px-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-[10.5px] font-semibold text-text-primary">#{o.orderNumber}</div>
                      <div className="text-[9.5px] text-text-muted">{fmtRelative(o.createdAt)}</div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold ${chip.cls}`}>
                        {chip.label}
                      </span>
                      <span className="text-[10.5px] font-semibold text-text-primary tabular-nums">
                        {fmtMoney(o.totalTTC)} €
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </article>

          {/* Clients récents */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Clients récents</h2>
              <Link href="/admin/clients" className="text-[10px] text-[#246bfe] hover:underline">Voir tout →</Link>
            </div>
            <div className="px-4 pb-3">
              {data.recentCustomers.length === 0 ? (
                <p className="text-[11px] text-text-muted py-4">Aucun client.</p>
              ) : data.recentCustomers.map((c) => (
                <Link
                  key={c.id}
                  href={`/admin/clients/${c.id}`}
                  className="flex items-center gap-3 py-2.5 border-b border-zinc-50 last:border-0 hover:bg-zinc-50/60 rounded-md -mx-2 px-2 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 grid place-items-center text-[10px] font-bold shrink-0">
                    {c.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10.5px] font-semibold text-text-primary truncate">{c.name}</div>
                    <div className="text-[9.5px] text-text-muted truncate">{c.email}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10.5px] font-semibold text-text-primary tabular-nums">
                      {c.spend > 0 ? `${fmtMoney(c.spend)} €` : "—"}
                    </div>
                    <div className="text-[9px] text-text-muted">{fmtRelative(c.signedUpAt)}</div>
                  </div>
                </Link>
              ))}
            </div>
          </article>

          {/* Répartition géographique */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Répartition géographique</h2>
            </div>
            <div className="px-4 pb-4">
              <div
                aria-hidden
                className="relative h-[110px] rounded-xl mb-3 grid place-items-center text-[32px] overflow-hidden"
                style={{ background: "linear-gradient(135deg,#edf5ff,#dfeeff)", color: "#4d86e7" }}
              >
                <span
                  className="absolute border border-[#bcd5fb] rounded-full"
                  style={{ width: 180, height: 90, transform: "rotate(-20deg)" }}
                />
                <span
                  className="absolute border border-[#bcd5fb] rounded-full"
                  style={{ width: 230, height: 65, transform: "rotate(25deg)" }}
                />
                <span className="relative">🌐</span>
              </div>
              {data.topCountries.length === 0 ? (
                <p className="text-[11px] text-text-muted">Pas encore de ventes.</p>
              ) : data.topCountries.map((c) => (
                <div key={c.code} className="flex items-center gap-2.5 py-1.5 text-[11px]">
                  <span className="text-[14px] leading-none">{countryFlagEmoji(c.code) || "🏳️"}</span>
                  <span className="text-text-primary">{c.name}</span>
                  <span className="ml-auto font-semibold text-text-primary tabular-nums">{fmtPct(c.share)}</span>
                </div>
              ))}
            </div>
          </article>
        </section>

      </div>
    </div>
  );
}
