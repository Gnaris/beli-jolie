import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedDashboardStats, getCachedLowStockCount, getCachedVisitStats } from "@/lib/cached-data";
import DashboardParticlesLoader from "@/components/admin/dashboard/DashboardParticlesLoader";
import DashboardChartsLoader from "@/components/admin/dashboard/DashboardChartsLoader";
import type { MonthlyPoint, StatusPoint, TopProduct } from "@/components/admin/dashboard/DashboardCharts";

export const metadata: Metadata = {
  title: "Tableau de bord — Admin",
};

export default async function AdminDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const now = new Date();
  const onlineThreshold = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes

  // Cached aggregate stats (5min TTL) + real-time queries in parallel
  const [
    stats,
    pendingCount,
    rejectedCount,
    onlineCount,
    onlineUsers,
    latestPending,
    lowStockCount,
    visitStats,
    recentClients,
  ] = await Promise.all([
    getCachedDashboardStats(),
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { status: "REJECTED" } }),
    prisma.user.count({
      where: { role: "CLIENT", activity: { lastSeenAt: { gte: onlineThreshold } } },
    }),
    prisma.user.findMany({
      where: { role: "CLIENT", activity: { lastSeenAt: { gte: onlineThreshold } } },
      orderBy: { activity: { lastSeenAt: "desc" } },
      take: 5,
      select: {
        id: true, firstName: true, lastName: true, company: true,
        activity: { select: { currentPage: true } },
      },
    }),
    prisma.user.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true, firstName: true, lastName: true, company: true,
        email: true, siret: true, createdAt: true,
      },
    }),
    getCachedLowStockCount(),
    getCachedVisitStats(),
    prisma.visit.findMany({
      orderBy: { createdAt: "desc" },
      distinct: ["userId"],
      take: 15,
      select: {
        createdAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            company: true,
            email: true,
          },
        },
      },
    }),
  ]);

  const {
    totalClients, approvedCount, totalOrders, totalRevenue,
    totalProducts, totalCollections, ordersThisMonth, revenueThisMonth,
    recentOrders, orderStatusRaw, topProductsRaw,
  } = stats;

  // Build monthly chart data (6 months, oldest first)
  const monthLabels: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
    monthLabels.push({ key, label });
  }

  const monthlyMap: Record<string, { orders: number; revenue: number }> = {};
  for (const { key } of monthLabels) {
    monthlyMap[key] = { orders: 0, revenue: 0 };
  }
  for (const order of recentOrders) {
    const d = new Date(order.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (monthlyMap[key]) {
      monthlyMap[key].orders += 1;
      monthlyMap[key].revenue += order.totalTTC;
    }
  }

  const monthlyData: MonthlyPoint[] = monthLabels.map(({ key, label }) => ({
    label,
    orders: monthlyMap[key].orders,
    revenue: Math.round(monthlyMap[key].revenue * 100) / 100,
  }));

  // Status distribution (pre-mapped from cache)
  const statusDist: StatusPoint[] = orderStatusRaw;

  // Top products (pre-mapped from cache)
  const topProducts: TopProduct[] = topProductsRaw;

  // Today date label
  const todayLabel = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const todayFormatted = todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1);

  return (
    <div className="space-y-8">

      {/* ── HERO BANNER ── */}
      <div className="relative overflow-hidden rounded-2xl h-44"
        style={{ background: "linear-gradient(135deg, #1A1A1A 0%, #2D2D2D 100%)" }}>
        <DashboardParticlesLoader />
        <div className="relative z-10 h-full flex flex-col justify-center px-8">
          <div className="inline-flex items-center gap-2 bg-[rgba(255,255,255,0.2)] text-[rgba(255,255,255,0.8)] text-xs font-body px-3 py-1 rounded-full mb-3 w-fit">
            {todayFormatted}
          </div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-[#FFFFFF] leading-tight">
            Bonjour, {session.user.name?.split(" ")[0] ?? "Admin"} 👋
          </h1>
          <p className="font-body text-[rgba(255,255,255,0.6)] text-sm mt-1">
            Tableau de bord — Administration
          </p>
        </div>
      </div>

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4">
        {/* Revenu total */}
        <div className="stat-card flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-bg-secondary flex items-center justify-center mb-1">
            <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
            </svg>
          </div>
          <p className="font-heading text-2xl font-bold text-text-primary">
            {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(totalRevenue)}
          </p>
          <p className="text-xs font-body text-[#6B7280]">Revenu total</p>
        </div>

        {/* Revenu ce mois */}
        <div className="stat-card flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-[#F0FDF4] flex items-center justify-center mb-1">
            <svg className="w-4 h-4 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
            </svg>
          </div>
          <p className="font-heading text-2xl font-bold text-text-primary">
            {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(revenueThisMonth)}
          </p>
          <p className="text-xs font-body text-[#6B7280]">Revenu ce mois</p>
        </div>

        {/* Commandes total */}
        <div className="stat-card flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-bg-secondary flex items-center justify-center mb-1">
            <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z" />
            </svg>
          </div>
          <p className="font-heading text-2xl font-bold text-text-primary">
            {totalOrders}
          </p>
          <p className="text-xs font-body text-[#6B7280]">Commandes</p>
        </div>

        {/* Commandes ce mois */}
        <div className="stat-card flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-bg-tertiary flex items-center justify-center mb-1">
            <svg className="w-4 h-4 text-[#4B5563]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          </div>
          <p className="font-heading text-2xl font-bold text-text-primary">
            {ordersThisMonth}
          </p>
          <p className="text-xs font-body text-[#6B7280]">Cmd ce mois</p>
        </div>

        {/* Clients actifs */}
        <div className="stat-card flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-bg-secondary flex items-center justify-center mb-1">
            <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <p className="font-heading text-2xl font-bold text-text-primary">
            {approvedCount}
          </p>
          <p className="text-xs font-body text-[#6B7280]">Clients actifs</p>
        </div>

        {/* En attente */}
        <div className={`stat-card flex flex-col gap-1 ${pendingCount > 0 ? "ring-2 ring-warning/30" : ""}`}>
          <div className="w-9 h-9 rounded-xl bg-[#FEF3C7] flex items-center justify-center mb-1">
            <svg className="w-4 h-4 text-[#F59E0B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="font-heading text-2xl font-bold text-[#F59E0B]">
            {pendingCount}
          </p>
          <p className="text-xs font-body text-[#6B7280]">En attente</p>
          {pendingCount > 0 && (
            <span className="text-xs text-[#F59E0B] font-medium font-body">
              Action requise
            </span>
          )}
        </div>

        {/* Stock bas */}
        <Link href="/admin/produits?stock=low" className={`stat-card flex flex-col gap-1 ${lowStockCount > 0 ? "ring-2 ring-[#EF4444]/30" : ""}`}>
          <div className="w-9 h-9 rounded-xl bg-[#FEF2F2] flex items-center justify-center mb-1">
            <svg className="w-4 h-4 text-[#EF4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          </div>
          <p className={`font-heading text-2xl font-bold ${lowStockCount > 0 ? "text-[#EF4444]" : "text-text-primary"}`}>
            {lowStockCount}
          </p>
          <p className="text-xs font-body text-[#6B7280]">Stock bas</p>
          {lowStockCount > 0 && (
            <span className="text-xs text-[#EF4444] font-medium font-body">
              A surveiller
            </span>
          )}
        </Link>
      </div>

      {/* ── VISITES ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center mb-1">
            <svg className="w-4 h-4 text-[#3B82F6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="font-heading text-2xl font-bold text-text-primary">
            {visitStats.today}
          </p>
          <p className="text-xs font-body text-[#6B7280]">Visites aujourd&apos;hui</p>
        </div>

        <div className="stat-card flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center mb-1">
            <svg className="w-4 h-4 text-[#3B82F6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="font-heading text-2xl font-bold text-text-primary">
            {visitStats.thisWeek}
          </p>
          <p className="text-xs font-body text-[#6B7280]">Visites cette semaine</p>
        </div>

        <div className="stat-card flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center mb-1">
            <svg className="w-4 h-4 text-[#3B82F6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="font-heading text-2xl font-bold text-text-primary">
            {visitStats.thisMonth}
          </p>
          <p className="text-xs font-body text-[#6B7280]">Visites ce mois</p>
        </div>
      </div>

      {/* ── CLIENTS EN LIGNE ── */}
      {onlineCount > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22C55E] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#22C55E]" />
              </span>
              <h2 className="font-heading text-base font-semibold text-text-primary">
                {onlineCount} client{onlineCount > 1 ? "s" : ""} en ligne
              </h2>
            </div>
            <Link
              href="/admin/utilisateurs?status=ONLINE"
              className="text-sm text-text-secondary hover:text-text-primary font-body font-medium transition-colors underline underline-offset-2"
            >
              Voir tout
            </Link>
          </div>
          <div className="flex flex-wrap gap-3">
            {onlineUsers.map((u) => (
              <Link
                key={u.id}
                href={`/admin/utilisateurs/${u.id}`}
                className="flex items-center gap-2 bg-bg-secondary hover:bg-bg-tertiary rounded-lg px-3 py-2 transition-colors"
              >
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22C55E]" />
                </span>
                <span className="text-sm font-body font-medium text-text-primary">
                  {u.firstName} {u.lastName}
                </span>
                <span className="text-xs text-text-muted font-body">
                  {u.company}
                </span>
                {u.activity?.currentPage && (
                  <span className="text-[11px] text-text-muted font-mono truncate max-w-[150px]">
                    {u.activity.currentPage}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── CHARTS ── */}
      <DashboardChartsLoader
        monthlyData={monthlyData}
        statusDist={statusDist}
        topProducts={topProducts}
      />

      {/* ── DERNIERS CLIENTS ACTIFS ── */}
      <div>
        <h2 className="font-heading text-xl font-semibold text-text-primary mb-4">
          Dernières visites clients
        </h2>
        {recentClients.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="font-body text-text-secondary text-sm">
              Aucune visite enregistrée pour le moment.
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border table-header">
                    <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider">
                      Client
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider">
                      Société
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap">
                      Dernière visite
                    </th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {recentClients.map((visit) => (
                    <tr key={visit.user.id} className="border-b border-border last:border-0 hover:bg-bg-secondary transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-body font-semibold text-text-primary text-sm">
                          {visit.user.firstName} {visit.user.lastName}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-body text-sm text-text-secondary">
                          {visit.user.company}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-body text-sm text-text-secondary">
                          {visit.user.email}
                        </p>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <p className="font-body text-xs text-text-secondary">
                          {new Date(visit.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <Link
                          href={`/admin/utilisateurs/${visit.user.id}`}
                          className="text-sm text-text-secondary hover:text-text-primary font-body font-medium transition-colors underline underline-offset-2"
                        >
                          Voir
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── DEMANDES EN ATTENTE ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-xl font-semibold text-text-primary">
            Demandes en attente
          </h2>
          {pendingCount > 5 && (
            <Link
              href="/admin/utilisateurs?status=PENDING"
              className="text-sm text-text-primary hover:text-text-secondary font-body font-medium transition-colors underline underline-offset-2"
            >
              Voir tout ({pendingCount})
            </Link>
          )}
        </div>

        {latestPending.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-[#F0FDF4] flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="font-body text-text-secondary text-sm">
              Aucune demande en attente. Tout est à jour !
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border table-header">
                    <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider">
                      Société
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider">
                      Contact
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap">
                      Email
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap">
                      SIRET
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap">
                      Date
                    </th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {latestPending.map((user) => (
                    <tr key={user.id} className="border-b border-border last:border-0 hover:bg-bg-secondary transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-body font-semibold text-text-primary text-sm">
                          {user.company}
                        </p>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <p className="font-body text-sm text-text-primary">
                          {user.firstName} {user.lastName}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-body text-sm text-text-secondary">
                          {user.email}
                        </p>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <p className="font-mono text-sm text-text-secondary">
                          {user.siret}
                        </p>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <p className="font-body text-xs text-text-secondary">
                          {new Date(user.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <Link
                          href={`/admin/utilisateurs/${user.id}`}
                          className="btn-primary text-xs"
                        >
                          Examiner
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── LIENS RAPIDES ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {[
          {
            label: "Gérer les clients",
            href: "/admin/utilisateurs",
            desc: "Voir et valider les comptes",
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            ),
          },
          {
            label: "Gérer les produits",
            href: "/admin/produits",
            desc: "Ajouter ou modifier le catalogue",
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
            ),
          },
          {
            label: "Commandes",
            href: "/admin/commandes",
            desc: "Suivre et gérer les commandes",
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z" />
              </svg>
            ),
          },
          {
            label: "Collections",
            href: "/admin/collections",
            desc: "Organiser les collections",
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
              </svg>
            ),
          },
          {
            label: "Voir le site",
            href: "/",
            desc: "Retourner sur la boutique",
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
            ),
          },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="card card-hover p-5 flex items-start gap-4"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-bg-tertiary text-text-secondary">
              {link.icon}
            </div>
            <div>
              <p className="font-body font-semibold text-text-primary text-sm">
                {link.label} →
              </p>
              <p className="text-xs text-text-muted mt-1 font-body">
                {link.desc}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
