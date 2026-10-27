import type { Metadata } from "next";
import Link from "next/link";
import { getDashboardOverview } from "@/lib/dashboard-overview";
import { parsePeriod } from "@/lib/dashboard-period";
import DashboardKpiCard from "@/components/admin/dashboard/DashboardKpiCard";
import DashboardRevenueChart from "@/components/admin/dashboard/DashboardRevenueChart";
import DashboardCategoryDonut from "@/components/admin/dashboard/DashboardCategoryDonut";
import DashboardPeriodPicker from "@/components/admin/dashboard/DashboardPeriodPicker";

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
function fmtInactivity(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} j`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mois`;
  const years = Math.floor(days / 365);
  return `${years} an${years > 1 ? "s" : ""}`;
}
function waHref(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 6) return null;
  return `https://wa.me/${digits}`;
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const { period: periodRaw } = await searchParams;
  const period = parsePeriod(periodRaw);
  const data = await getDashboardOverview({ period });

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
          </div>
          <DashboardPeriodPicker current={data.period} periodLabel={data.periodLabel} />
        </header>

        {/* ─── KPIs ────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <DashboardKpiCard kpi={data.kpis.totalRevenue} />
          <DashboardKpiCard kpi={data.kpis.todayRevenue} />
          <DashboardKpiCard kpi={data.kpis.totalOrders} />
          <DashboardKpiCard kpi={data.kpis.uniqueClients} />
        </section>

        {/* ─── Visiteurs aujourd'hui (connectés · anonymes) ────── */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm dashboard-card-in p-4 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 grid place-items-center shrink-0 ring-1 ring-emerald-200">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-text-muted uppercase tracking-wider">Visiteurs connectés · aujourd&apos;hui</div>
              <div className="text-[22px] font-bold text-text-primary tabular-nums leading-tight mt-0.5">
                {fmtInt(data.todayVisits.authenticated)}
              </div>
            </div>
          </article>

          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm dashboard-card-in p-4 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-sky-100 text-sky-700 grid place-items-center shrink-0 ring-1 ring-sky-200">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M6 21a6 6 0 0 1 12 0" />
                <path d="M9 8h.01" />
                <path d="M15 8h.01" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-text-muted uppercase tracking-wider">Visiteurs anonymes · aujourd&apos;hui</div>
              <div className="text-[22px] font-bold text-text-primary tabular-nums leading-tight mt-0.5">
                {fmtInt(data.todayVisits.anonymous)}
              </div>
            </div>
          </article>
        </section>

        {/* ─── Évolution + Répartition ventes ──────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,1fr)] gap-3">
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm dashboard-card-in">
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
              <DashboardRevenueChart buckets={data.revenueBuckets} />
            </div>
          </article>

          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm dashboard-card-in">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Répartition des ventes</h2>
              <Link href="/admin/categories" className="text-[10px] text-[#246bfe] hover:underline">
                Détails →
              </Link>
            </div>
            <DashboardCategoryDonut slices={data.categoryBreakdown} total={data.categoryTotal} />
          </article>
        </section>

        {/* ─── Top produits · Ventes par catégorie (2 colonnes) ──── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm dashboard-card-in">
          <div className="flex items-center justify-between gap-3 p-5 pb-3">
            <h2 className="text-[15px] font-semibold text-text-primary">Top 100 des produits les plus vendus</h2>
            <Link href="/admin/produits" className="text-[11px] text-[#246bfe] hover:underline">Voir tout →</Link>
          </div>
          <div className="px-4 pb-4">
            {data.topProducts.length === 0 ? (
              <p className="text-[12px] text-text-muted p-4">Pas encore de ventes.</p>
            ) : (
              <table className="w-full text-[13px] table-fixed">
                <thead>
                  <tr className="text-left text-zinc-500 text-[10.5px] uppercase tracking-wider">
                    <th className="py-2.5 px-3 font-semibold border-b border-zinc-100 w-10">#</th>
                    <th className="py-2.5 px-3 font-semibold border-b border-zinc-100">Produit</th>
                    <th className="py-2.5 px-3 font-semibold border-b border-zinc-100 text-right w-20">Ventes</th>
                    <th className="py-2.5 px-3 font-semibold border-b border-zinc-100 text-right w-24">CA</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p, i) => (
                    <tr key={p.reference} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/40 transition-colors">
                      <td className="py-3 px-3 text-zinc-500 font-semibold tabular-nums">{i + 1}</td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-lg bg-zinc-100 grid place-items-center overflow-hidden shrink-0">
                            {p.imagePath ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.imagePath} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-sm text-zinc-400">◇</span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-text-primary truncate">{p.name}</div>
                            <div className="text-[11px] text-zinc-400 truncate">{p.reference}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right text-zinc-700 tabular-nums font-medium">{fmtInt(p.sales)}</td>
                      <td className="py-3 px-3 text-right text-zinc-700 tabular-nums font-medium">{fmtMoney(p.revenue)} €</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>

        {/* ─── Ventes par catégorie ────────────────────────────── */}
        <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm dashboard-card-in">
          <div className="flex items-center justify-between gap-3 p-5 pb-3">
            <h2 className="text-[15px] font-semibold text-text-primary">Ventes par catégorie</h2>
            <Link href="/admin/categories" className="text-[11px] text-[#246bfe] hover:underline">Voir tout →</Link>
          </div>
          <div className="overflow-x-auto px-4 pb-4">
            {data.categoryBreakdown.length === 0 ? (
              <p className="text-[12px] text-text-muted p-4">Aucune donnée.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-zinc-500 text-[10.5px] uppercase tracking-wider">
                    <th className="py-2.5 px-3 font-semibold border-b border-zinc-100">Catégorie</th>
                    <th className="py-2.5 px-3 font-semibold border-b border-zinc-100 text-right">Ventes</th>
                    <th className="py-2.5 px-3 font-semibold border-b border-zinc-100 text-right">CA</th>
                    <th className="py-2.5 px-3 font-semibold border-b border-zinc-100 text-right w-20">%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categoryBreakdown.map((c) => (
                    <tr key={c.name} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/40 transition-colors">
                      <td className="py-3 px-3">
                        <span className="inline-flex items-center gap-2.5 text-text-primary font-medium">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                          {c.name}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right text-zinc-700 tabular-nums font-medium">{fmtInt(c.sales)}</td>
                      <td className="py-3 px-3 text-right text-zinc-700 tabular-nums font-medium">{fmtMoney(c.revenue)} €</td>
                      <td className="py-3 px-3 text-right text-zinc-500 tabular-nums">{fmtPct(c.share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>
        </section>

        {/* ─── Stock faible · Clients inactifs · Marketing ─────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Stock faible */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm dashboard-card-in">
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

          {/* Clients inactifs — à relancer */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm dashboard-card-in">
            <div className="flex items-center justify-between gap-3 p-4 pb-2">
              <h2 className="text-[13px] font-semibold text-text-primary">Clients à relancer — inactifs</h2>
              <Link href="/admin/clients" className="text-[10px] text-[#246bfe] hover:underline">Voir tout →</Link>
            </div>
            <div className="px-3 pb-3">
              {data.inactiveClients.length === 0 ? (
                <p className="text-[11px] text-text-muted p-4">Aucun client inactif détecté.</p>
              ) : (
                <ul className="divide-y divide-zinc-50">
                  {data.inactiveClients.map((c) => {
                    const refDate = c.lastActiveAt ?? c.signedUpAt;
                    const inactivityLabel = c.lastActiveAt
                      ? `Inactif depuis ${fmtInactivity(refDate)}`
                      : `Jamais connecté · inscrit il y a ${fmtInactivity(c.signedUpAt)}`;
                    const wa = waHref(c.phone);
                    return (
                      <li key={c.id} className="flex items-center gap-3 py-2.5">
                        <Link
                          href={`/admin/clients/${c.id}`}
                          className="flex items-center gap-2.5 min-w-0 flex-1 hover:opacity-80 transition-opacity"
                        >
                          <div className="w-8 h-8 rounded-full bg-rose-100 text-rose-800 grid place-items-center text-[10px] font-bold shrink-0">
                            {c.initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-semibold text-text-primary truncate">{c.name}</div>
                            <div className="text-[9.5px] text-text-muted truncate">{inactivityLabel}</div>
                          </div>
                        </Link>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {wa && c.hasWhatsapp !== false ? (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`WhatsApp · ${c.phone}`}
                              className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center hover:bg-emerald-200 transition-colors"
                              aria-label={`Contacter ${c.name} sur WhatsApp`}
                            >
                              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true">
                                <path d="M20.52 3.48A11.9 11.9 0 0 0 12.05 0C5.5 0 .2 5.3.2 11.84a11.74 11.74 0 0 0 1.6 5.93L0 24l6.37-1.67a11.86 11.86 0 0 0 5.68 1.45h.01c6.54 0 11.84-5.3 11.84-11.84a11.76 11.76 0 0 0-3.38-8.46zM12.06 21.8h-.01a9.88 9.88 0 0 1-5.03-1.38l-.36-.21-3.78.99 1.01-3.69-.23-.38a9.84 9.84 0 0 1-1.5-5.25c0-5.44 4.42-9.86 9.87-9.86 2.63 0 5.11 1.03 6.97 2.89a9.8 9.8 0 0 1 2.89 6.98c0 5.44-4.42 9.86-9.86 9.86zm5.4-7.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15s-.77.96-.94 1.16c-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.74-1.64-2.04-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.01-1.04 2.47 0 1.46 1.07 2.87 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.5 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35z"/>
                              </svg>
                            </a>
                          ) : null}
                          <a
                            href={`mailto:${c.email}`}
                            title={`E-mail · ${c.email}`}
                            className="w-7 h-7 rounded-full bg-sky-100 text-sky-700 grid place-items-center hover:bg-sky-200 transition-colors"
                            aria-label={`Envoyer un e-mail à ${c.name}`}
                          >
                            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="3" y="5" width="18" height="14" rx="2" />
                              <path d="m3 7 9 6 9-6" />
                            </svg>
                          </a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </article>

          {/* Performances marketing */}
          <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm dashboard-card-in">
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

      </div>
    </div>
  );
}
