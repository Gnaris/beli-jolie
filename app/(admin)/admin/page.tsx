import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedDashboardStats, getCachedLowStockCount } from "@/lib/cached-data";
import { getVisitStats } from "@/lib/visit-stats";
import DashboardChartsLoader from "@/components/admin/dashboard/DashboardChartsLoader";
import VisitorStats from "@/components/admin/dashboard/VisitorStats";
import type { MonthlyPoint, StatusPoint, TopProduct } from "@/components/admin/dashboard/DashboardCharts";

export const metadata: Metadata = {
  title: "Tableau de bord — Admin",
};

// ─── Tuile KPI (carte cliquable ou non) ────────────────────────────────────
function KpiTile({
  href, label, value, sub, icon, accent = "neutral", highlight = false,
}: {
  href?: string;
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: "neutral" | "emerald" | "sky" | "amber" | "rose" | "violet";
  highlight?: boolean;
}) {
  const accentMap = {
    neutral: {
      cardBg: "bg-bg-primary",
      iconBg: "bg-bg-secondary", iconText: "text-text-secondary",
      border: "border-border", valueText: "text-text-primary",
      ring: "", glow: "",
    },
    emerald: {
      cardBg: "bg-gradient-to-br from-emerald-50/80 via-bg-primary to-bg-primary",
      iconBg: "bg-emerald-100 ring-1 ring-emerald-200", iconText: "text-emerald-700",
      border: "border-emerald-200", valueText: "text-emerald-700",
      ring: "", glow: "before:bg-emerald-300/40",
    },
    sky: {
      cardBg: highlight
        ? "bg-gradient-to-br from-sky-100 via-sky-50 to-bg-primary"
        : "bg-gradient-to-br from-sky-50/80 via-bg-primary to-bg-primary",
      iconBg: "bg-sky-100 ring-1 ring-sky-200", iconText: "text-sky-700",
      border: highlight ? "border-sky-300" : "border-sky-200",
      valueText: "text-sky-700",
      ring: highlight ? "ring-1 ring-sky-200" : "",
      glow: "before:bg-sky-300/40",
    },
    amber: {
      cardBg: highlight
        ? "bg-gradient-to-br from-amber-100 via-amber-50 to-bg-primary"
        : "bg-gradient-to-br from-amber-50/80 via-bg-primary to-bg-primary",
      iconBg: "bg-amber-100 ring-1 ring-amber-200", iconText: "text-amber-700",
      border: highlight ? "border-amber-300" : "border-amber-200",
      valueText: "text-amber-700",
      ring: highlight ? "ring-1 ring-amber-200" : "",
      glow: "before:bg-amber-300/40",
    },
    rose: {
      cardBg: highlight
        ? "bg-gradient-to-br from-rose-100 via-rose-50 to-bg-primary"
        : "bg-gradient-to-br from-rose-50/80 via-bg-primary to-bg-primary",
      iconBg: "bg-rose-100 ring-1 ring-rose-200", iconText: "text-rose-700",
      border: highlight ? "border-rose-300" : "border-rose-200",
      valueText: "text-rose-700",
      ring: highlight ? "ring-1 ring-rose-200" : "",
      glow: "before:bg-rose-300/40",
    },
    violet: {
      cardBg: "bg-gradient-to-br from-violet-50/80 via-bg-primary to-bg-primary",
      iconBg: "bg-violet-100 ring-1 ring-violet-200", iconText: "text-violet-700",
      border: "border-violet-200", valueText: "text-violet-700",
      ring: "", glow: "before:bg-violet-300/40",
    },
  }[accent];

  const base = `relative overflow-hidden border ${accentMap.border} ${accentMap.ring} ${accentMap.cardBg} rounded-2xl p-4 sm:p-5 shadow-sm transition-all`;
  const interactive = href ? "hover:shadow-md hover:-translate-y-0.5 cursor-pointer" : "";
  // halo top-right
  const haloBefore = `before:content-[''] before:absolute before:-top-12 before:-right-12 before:w-32 before:h-32 before:rounded-full before:blur-3xl ${accentMap.glow}`;

  const inner = (
    <>
      <div className="relative flex items-center justify-between mb-3 sm:mb-4">
        <span className={`inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${accentMap.iconBg} ${accentMap.iconText}`}>
          {icon}
        </span>
        {href && (
          <span className={`${accentMap.iconText} opacity-50 group-hover:opacity-100 transition-opacity`}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M10 7h7v7" /></svg>
          </span>
        )}
      </div>
      <p className={`relative font-heading text-2xl sm:text-3xl font-bold tabular-nums leading-none ${accentMap.valueText}`}>
        {value}
      </p>
      <p className="relative text-xs sm:text-sm font-body text-text-secondary mt-1.5 sm:mt-2">{label}</p>
      {sub && <p className="relative text-[11px] font-body text-text-muted mt-0.5">{sub}</p>}
    </>
  );

  if (href) return <Link href={href} className={`group ${base} ${interactive} ${haloBefore} block`}>{inner}</Link>;
  return <div className={`${base} ${haloBefore}`}>{inner}</div>;
}

// ─── Tuile alerte (pill cliquable dans le hero) ────────────────────────────
function AlertPill({ href, count, label, tone }: { href: string; count: number; label: string; tone: "amber" | "rose" }) {
  const toneMap = {
    amber: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100",
    rose:  "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100",
  }[tone];
  const dot = tone === "amber" ? "bg-amber-500" : "bg-rose-500";
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-full border text-xs font-body font-medium transition-colors ${toneMap}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="font-semibold tabular-nums">{count}</span>
      <span>{label}</span>
    </Link>
  );
}

// ─── Tuile lien rapide brandée ─────────────────────────────────────────────
function QuickLinkTile({
  href, label, desc, icon, accent,
}: {
  href: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  accent: { from: string; to: string };
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl border border-border bg-bg-primary shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <div
        className="absolute inset-x-0 top-0 h-1 transition-all group-hover:h-1.5"
        style={{ background: `linear-gradient(90deg, ${accent.from}, ${accent.to})` }}
      />
      <div className="p-4 sm:p-5 flex flex-col h-full min-h-[112px]">
        <div className="flex items-center justify-between mb-3">
          <span
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-white shadow-sm"
            style={{ background: `linear-gradient(135deg, ${accent.from}, ${accent.to})` }}
          >
            {icon}
          </span>
          <svg className="w-4 h-4 text-text-muted group-hover:text-text-primary transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </div>
        <div className="mt-auto">
          <p className="font-heading font-semibold text-text-primary text-sm leading-tight">{label}</p>
          <p className="text-[11px] sm:text-xs text-text-muted mt-1 font-body leading-snug">{desc}</p>
        </div>
      </div>
    </Link>
  );
}

// ─── Header de section avec petite étincelle ───────────────────────────────
function SectionHeader({ eyebrow, title }: { eyebrow: string; title?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="w-1 h-4 rounded-full bg-bg-dark/40" />
      <h2 className="font-heading text-[11px] sm:text-xs uppercase tracking-[0.18em] text-text-secondary font-semibold">
        {eyebrow}
      </h2>
      {title && <span className="font-body text-xs text-text-muted">· {title}</span>}
    </div>
  );
}

export default async function AdminDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const now = new Date();

  const [stats, pendingCount, _rejectedCount, latestPending, lowStockCount, visitStats] = await Promise.all([
    getCachedDashboardStats(),
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { status: "REJECTED" } }),
    prisma.user.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, firstName: true, lastName: true, company: true, email: true, siret: true, createdAt: true },
    }),
    getCachedLowStockCount(),
    getVisitStats(),
  ]);

  const {
    approvedCount, totalOrders, totalRevenue, pendingOrders, revenueToday,
    recentOrders, orderStatusRaw, topProductsRaw,
  } = stats;

  // Build monthly chart data
  const monthLabels: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
    monthLabels.push({ key, label });
  }
  const monthlyMap: Record<string, { orders: number; revenue: number }> = {};
  for (const { key } of monthLabels) monthlyMap[key] = { orders: 0, revenue: 0 };
  for (const order of recentOrders) {
    const d = new Date(order.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (monthlyMap[key]) {
      monthlyMap[key].orders += 1;
      monthlyMap[key].revenue += order.totalTTC;
    }
  }
  const monthlyData: MonthlyPoint[] = monthLabels.map(({ key, label }) => ({
    label, orders: monthlyMap[key].orders, revenue: Math.round(monthlyMap[key].revenue * 100) / 100,
  }));

  const statusDist: StatusPoint[] = orderStatusRaw;
  const topProducts: TopProduct[] = topProductsRaw;

  const todayLabel = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const todayFormatted = todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1);
  const firstName = session.user.name?.split(" ")[0] ?? "Admin";

  const fmtEur = (n: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

  function initialsOf(first: string, last: string) {
    return `${(first?.[0] ?? "").toUpperCase()}${(last?.[0] ?? "").toUpperCase()}`.trim() || "?";
  }

  return (
    <div className="space-y-8 sm:space-y-10">

      {/* ════════════════════════ HERO COMMAND CENTER ════════════════════════ */}
      <div className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        {/* Fond aurora : superposition de halos colorés très doux */}
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-white to-sky-50" />
        <div
          className="absolute inset-0 opacity-60 pointer-events-none"
          style={{
            background: `
              radial-gradient(circle at 10% 10%, rgba(167, 139, 250, 0.35) 0%, transparent 45%),
              radial-gradient(circle at 90% 20%, rgba(56, 189, 248, 0.25) 0%, transparent 45%),
              radial-gradient(circle at 80% 100%, rgba(251, 191, 36, 0.18) 0%, transparent 45%),
              radial-gradient(circle at 0% 100%, rgba(52, 211, 153, 0.18) 0%, transparent 45%)
            `,
          }}
        />
        {/* Texture pointillée fine au-dessus */}
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, #1A1A1A 1px, transparent 0)",
          backgroundSize: "18px 18px",
        }} />

        <div className="relative p-5 sm:p-7 md:p-9">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-dark text-white shadow-sm">
                  <svg className="w-3 h-3 text-amber-300" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />
                  </svg>
                  <span className="font-body text-[10px] sm:text-[11px] uppercase tracking-[0.18em] font-semibold">
                    Cockpit administrateur
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/70 backdrop-blur-sm border border-white/50 text-text-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-body text-[10px] sm:text-[11px] uppercase tracking-wider font-medium">En ligne</span>
                </span>
                <span className="hidden sm:inline-flex font-body text-xs text-text-secondary truncate">
                  · {todayFormatted}
                </span>
              </div>
              <h1 className="font-heading text-2xl sm:text-3xl md:text-4xl font-bold text-text-primary leading-tight tracking-tight">
                Bonjour, {firstName}.
              </h1>
              <p className="font-body text-sm sm:text-base text-text-secondary mt-1.5 sm:mt-2 max-w-xl">
                Voici l&apos;état de votre boutique aujourd&apos;hui — d&apos;un coup d&apos;œil.
              </p>
              {/* Date affichée sur mobile */}
              <p className="sm:hidden font-body text-xs text-text-muted mt-2">{todayFormatted}</p>
            </div>

            {(pendingCount > 0 || lowStockCount > 0) && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {pendingCount > 0 && (
                  <AlertPill
                    href="/admin/utilisateurs?status=PENDING"
                    count={pendingCount}
                    label={`demande${pendingCount > 1 ? "s" : ""} à examiner`}
                    tone="amber"
                  />
                )}
                {lowStockCount > 0 && (
                  <AlertPill
                    href="/admin/produits?stock=low"
                    count={lowStockCount}
                    label={`produit${lowStockCount > 1 ? "s" : ""} en stock bas`}
                    tone="rose"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ════════════════════════ KPIs DU JOUR (bento) ════════════════════════ */}
      <section>
        <SectionHeader eyebrow="Aujourd'hui" title="indicateurs clés" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <KpiTile
            label="Revenu du jour"
            value={fmtEur(revenueToday)}
            accent="emerald"
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
            }
          />
          <KpiTile
            href="/admin/commandes?status=PENDING"
            label="Commandes à traiter"
            value={pendingOrders.toString()}
            accent="sky"
            highlight={pendingOrders > 0}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 01-8 0" />
              </svg>
            }
          />
          <KpiTile
            href="/admin/utilisateurs?status=PENDING"
            label="Clients à examiner"
            value={pendingCount.toString()}
            accent="amber"
            highlight={pendingCount > 0}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 11h-6M19 8v6" />
              </svg>
            }
          />
          <KpiTile
            href="/admin/produits?stock=low"
            label="Stock bas"
            value={lowStockCount.toString()}
            accent="rose"
            highlight={lowStockCount > 0}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            }
          />
        </div>
      </section>

      {/* ════════════════════════ VISITEURS ════════════════════════ */}
      <section>
        <SectionHeader eyebrow="Visiteurs" title="trafic du site" />
        <VisitorStats stats={visitStats} />
      </section>

      {/* ════════════════════════ VUE D'ENSEMBLE ════════════════════════ */}
      <section>
        <SectionHeader eyebrow="Vue d'ensemble" title="totaux historiques" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <KpiTile
            label="Revenu total"
            value={fmtEur(totalRevenue)}
            accent="emerald"
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M7 14l4-4 4 4 5-5" />
              </svg>
            }
          />
          <KpiTile
            label="Commandes au total"
            value={totalOrders.toString()}
            accent="sky"
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 01-8 0" />
              </svg>
            }
          />
          <KpiTile
            label="Clients actifs"
            value={approvedCount.toString()}
            accent="violet"
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
            }
          />
        </div>
      </section>

      {/* ════════════════════════ CHARTS ════════════════════════ */}
      <section>
        <SectionHeader eyebrow="Analytics" title="6 derniers mois & catalogue" />
        <DashboardChartsLoader monthlyData={monthlyData} statusDist={statusDist} topProducts={topProducts} />
      </section>

      {/* ════════════════════════ DEMANDES EN ATTENTE ════════════════════════ */}
      <section>
        <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
          <div>
            <SectionHeader eyebrow="À examiner" title="dernières demandes clients" />
          </div>
          {pendingCount > 5 && (
            <Link
              href="/admin/utilisateurs?status=PENDING"
              className="text-xs sm:text-sm text-text-primary hover:text-text-secondary font-body font-medium transition-colors underline underline-offset-2"
            >
              Voir tout ({pendingCount})
            </Link>
          )}
        </div>

        {latestPending.length === 0 ? (
          <div className="rounded-2xl border border-border bg-bg-primary p-8 sm:p-10 text-center shadow-sm">
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="font-body text-text-secondary text-sm">Aucune demande en attente. Tout est à jour !</p>
          </div>
        ) : (
          <>
            {/* Mobile : liste de cartes */}
            <div className="md:hidden space-y-3">
              {latestPending.map((user) => (
                <Link
                  key={user.id}
                  href={`/admin/utilisateurs/${user.id}`}
                  className="block bg-bg-primary border border-border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700 flex items-center justify-center font-heading font-semibold text-sm shrink-0">
                      {initialsOf(user.firstName, user.lastName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body font-semibold text-text-primary text-sm truncate">{user.company}</p>
                      <p className="font-body text-xs text-text-secondary mt-0.5">{user.firstName} {user.lastName}</p>
                      <p className="font-body text-xs text-text-muted mt-1 truncate">{user.email}</p>
                      <div className="flex items-center justify-between mt-2.5">
                        <span className="font-mono text-[11px] text-text-muted">{user.siret}</span>
                        <span className="font-body text-[11px] text-text-muted">
                          {new Date(user.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Desktop : table */}
            <div className="hidden md:block bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-bg-secondary/60">
                      <th className="px-5 py-3 text-left text-[11px] font-body font-semibold text-text-secondary uppercase tracking-wider">Société</th>
                      <th className="px-5 py-3 text-left text-[11px] font-body font-semibold text-text-secondary uppercase tracking-wider">Contact</th>
                      <th className="px-5 py-3 text-left text-[11px] font-body font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap">Email</th>
                      <th className="px-5 py-3 text-left text-[11px] font-body font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap">SIRET</th>
                      <th className="px-5 py-3 text-left text-[11px] font-body font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap">Date</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {latestPending.map((user) => (
                      <tr key={user.id} className="border-b border-border-light last:border-0 hover:bg-bg-secondary/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700 flex items-center justify-center font-heading font-semibold text-xs shrink-0">
                              {initialsOf(user.firstName, user.lastName)}
                            </div>
                            <p className="font-body font-semibold text-text-primary text-sm">{user.company}</p>
                          </div>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <p className="font-body text-sm text-text-primary">{user.firstName} {user.lastName}</p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-body text-sm text-text-secondary">{user.email}</p>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <p className="font-mono text-sm text-text-secondary">{user.siret}</p>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <p className="font-body text-xs text-text-secondary">
                            {new Date(user.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          <Link href={`/admin/utilisateurs/${user.id}`} className="btn-primary text-xs">Examiner</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ════════════════════════ ACCÈS RAPIDES ════════════════════════ */}
      <section>
        <SectionHeader eyebrow="Accès rapides" title="naviguer dans l'admin" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
          <QuickLinkTile
            href="/admin/utilisateurs"
            label="Clients"
            desc="Voir et valider les comptes"
            accent={{ from: "#7C3AED", to: "#A855F7" }}
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>}
          />
          <QuickLinkTile
            href="/admin/produits"
            label="Produits"
            desc="Catalogue, photos, sync"
            accent={{ from: "#0E7C66", to: "#1AB58A" }}
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><path d="M3.27 6.96L12 12.01l8.73-5.05" /><path d="M12 22.08V12" /></svg>}
          />
          <QuickLinkTile
            href="/admin/commandes"
            label="Commandes"
            desc="Suivre et expédier"
            accent={{ from: "#1E40AF", to: "#3B82F6" }}
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" /></svg>}
          />
          <QuickLinkTile
            href="/admin/collections"
            label="Collections"
            desc="Organiser les regroupements"
            accent={{ from: "#B45309", to: "#F59E0B" }}
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>}
          />
          <QuickLinkTile
            href="/"
            label="Voir le site"
            desc="Vue visiteur en boutique"
            accent={{ from: "#1A1A1A", to: "#4B5563" }}
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>}
          />
        </div>
      </section>
    </div>
  );
}
