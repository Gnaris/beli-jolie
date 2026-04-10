import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { getAvailableCredit } from "@/lib/credits";
import AccountEditor from "@/components/client/AccountEditor";
import LogoutButton from "@/components/client/LogoutButton";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: `Tableau de bord — ${shopName}`,
    robots: { index: false, follow: false },
  };
}

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  PENDING:    { bg: "bg-amber-50",     text: "text-amber-800",   dot: "bg-warning"    },
  PROCESSING: { bg: "bg-blue-50",     text: "text-blue-700",    dot: "bg-info"       },
  SHIPPED:    { bg: "bg-purple-50",   text: "text-purple-700",  dot: "bg-purple-500" },
  DELIVERED:  { bg: "bg-emerald-50",  text: "text-emerald-800", dot: "bg-success"    },
  CANCELLED:  { bg: "bg-bg-secondary", text: "text-text-muted",  dot: "bg-text-muted" },
};

/* -- Mini bar chart (SVG) -- */
function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="relative">
      {/* Grid lines */}
      <div className="absolute inset-0 flex flex-col justify-between pointer-events-none" style={{ bottom: "24px" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="border-b border-border-light w-full" />
        ))}
      </div>
      <div className="flex items-end gap-3 h-32 relative" role="img" aria-label="Orders per month chart">
        {data.map((d, i) => {
          const barHeight = Math.round((d.value / max) * 96);
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              {/* Value label */}
              <span className="text-[10px] font-body font-semibold text-text-secondary leading-none">
                {d.value > 0 ? d.value : ""}
              </span>
              <div
                className="w-full max-w-[40px] bg-accent/80 rounded-md transition-all duration-300 hover:bg-accent"
                style={{ height: `${barHeight}px`, minHeight: d.value > 0 ? "6px" : "0" }}
                role="presentation"
                aria-label={`${d.label}: ${d.value}`}
              />
              <span className="text-[10px] font-body text-text-muted leading-none capitalize">
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -- Stat card -- */
function StatCard({
  label, value, sub, icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-bg-primary rounded-2xl border border-border p-6 flex items-start gap-4 transition-all duration-200 hover:shadow-md">
      <div className="w-11 h-11 rounded-xl bg-bg-tertiary flex items-center justify-center text-accent shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-body text-text-muted uppercase tracking-wider font-bold">
          {label}
        </p>
        <p className="font-heading text-2xl font-semibold text-text-primary mt-1">
          {value}
        </p>
        {sub && (
          <p className="text-xs font-body text-text-muted mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

/* -- Empty state -- */
function EmptyState({
  icon,
  title,
  subtitle,
  ctaLabel,
  ctaHref,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <div className="py-10 px-6 flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-full bg-bg-tertiary flex items-center justify-center text-text-muted mb-4">
        {icon}
      </div>
      <p className="text-sm font-body font-medium text-text-secondary">{title}</p>
      {subtitle && (
        <p className="text-xs font-body text-text-muted mt-1 max-w-xs">{subtitle}</p>
      )}
      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="inline-flex mt-4 justify-center text-xs px-5 py-2.5 bg-bg-dark text-text-inverse rounded-lg font-body font-medium hover:bg-primary-hover transition-colors"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion");

  const userId = session.user.id;
  const [t, tOrders] = await Promise.all([
    getTranslations("account"),
    getTranslations("orders"),
  ]);

  const [user, orders, favorites, cart, credits, availableCredit, ordersWithCreditNote] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.order.findMany({
      where: { userId },
      include: {
        items: { select: { quantity: true, lineTotal: true, productName: true, productRef: true, colorName: true, imagePath: true, saleType: true, packQty: true, size: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.favorite.findMany({
      where: { userId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            reference: true,
            colors: {
              orderBy: { isPrimary: "desc" },
              select:  { colorId: true, unitPrice: true },
              take:    1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    prisma.cart.findUnique({
      where: { userId },
      include: { items: { select: { quantity: true } } },
    }),
    prisma.credit.findMany({
      where: { userId },
      include: { claim: { select: { reference: true } } },
      orderBy: { createdAt: "desc" },
    }),
    getAvailableCredit(userId),
    prisma.order.findMany({
      where: { userId, creditNotePath: { not: null } },
      select: { id: true, orderNumber: true, createdAt: true, creditNotePath: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!user) redirect("/connexion");

  // Fetch first image for favorited products
  const favProductIds = favorites.map((f) => f.product.id);
  const favFirstImages = favProductIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: favProductIds } }, orderBy: { order: "asc" } })
    : [];
  const favFirstImageMap = new Map<string, string>();
  for (const img of favFirstImages) {
    if (!favFirstImageMap.has(img.productId)) favFirstImageMap.set(img.productId, img.path);
  }

  /* -- Stats -- */
  const totalOrders = orders.length;
  const totalSpent = orders.reduce((s, o) => s + Number(o.totalTTC), 0);
  const totalItemsOrdered = orders.reduce(
    (s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0),
    0
  );
  const cartItemCount = cart?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;

  /* -- Produits commandes les plus frequents -- */
  const productCountMap = new Map<string, { name: string; count: number }>();
  for (const order of orders) {
    for (const item of order.items) {
      const key = item.productName;
      const existing = productCountMap.get(key) ?? { name: key, count: 0 };
      productCountMap.set(key, { ...existing, count: existing.count + item.quantity });
    }
  }
  const topProducts = [...productCountMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  /* -- Historique complet des produits commandes -- */
  const productHistoryMap = new Map<string, {
    name: string;
    ref: string;
    image: string | null;
    colorName: string;
    orderCount: number;
    totalQty: number;
  }>();
  for (const order of orders) {
    for (const item of order.items) {
      const key = `${item.productRef}__${item.colorName}`;
      const existing = productHistoryMap.get(key);
      if (existing) {
        existing.orderCount++;
        existing.totalQty += item.quantity;
      } else {
        productHistoryMap.set(key, {
          name: item.productName,
          ref: item.productRef,
          image: item.imagePath,
          colorName: item.colorName,
          orderCount: 1,
          totalQty: item.quantity,
        });
      }
    }
  }
  const allOrderedProducts = [...productHistoryMap.values()]
    .sort((a, b) => b.totalQty - a.totalQty);

  /* -- Commandes par mois (6 derniers mois) -- */
  const now = new Date();
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      label: d.toLocaleDateString("fr-FR", { month: "short" }),
      value: 0,
      year: d.getFullYear(),
      month: d.getMonth(),
    };
  });
  for (const order of orders) {
    const d = new Date(order.createdAt);
    const slot = monthlyData.find(
      (m) => m.year === d.getFullYear() && m.month === d.getMonth()
    );
    if (slot) slot.value++;
  }

  /* -- Commandes recentes -- */
  const recentOrders = orders.slice(0, 5);

  const formattedDate = new Date(user.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="p-4 md:p-6 lg:p-10 w-full relative overflow-hidden">
      <div className="flex gap-8 relative">
        {/* -- Colonne principale (gauche) -- */}
        <div className="flex-1 min-w-0 space-y-8">

          {/* En-tete */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-heading text-xl font-semibold text-text-primary">
                {t("greeting", { name: user.firstName })}
              </h1>
              <p className="text-sm text-text-secondary font-body mt-1">
                {user.company} — {t("memberSince", { date: formattedDate })}
              </p>
            </div>
            <LogoutButton />
          </div>

          {/* Bandeau statut si pas APPROVED */}
          {user.status !== "APPROVED" && (
            <div className={`${user.status === "PENDING" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-red-50 border-red-200 text-red-800"} border rounded-2xl p-5 flex items-start gap-3`}>
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${user.status === "PENDING" ? "bg-warning" : "bg-red-500"}`} />
              <div>
                <p className="text-sm font-body font-semibold">
                  {user.status === "PENDING" ? t("pendingValidation") : t("rejected")}
                </p>
                <p className="text-sm font-body opacity-80 mt-0.5">
                  {user.status === "PENDING"
                    ? t("pendingValidationDesc")
                    : t("rejectedDesc")}
                </p>
              </div>
            </div>
          )}

          {/* -- Stat cards -- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label={t("statsOrders")}
              value={totalOrders}
              sub={t("statsTotal")}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                </svg>
              }
            />
            <StatCard
              label={t("statsItems")}
              value={totalItemsOrdered}
              sub={t("statsPieces")}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                </svg>
              }
            />
            <StatCard
              label={t("statsSpent")}
              value={`${totalSpent.toFixed(2)} \u20AC`}
              sub={t("statsInclShipping")}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                </svg>
              }
            />
            <StatCard
              label={t("statsCart")}
              value={cartItemCount}
              sub={cartItemCount > 0 ? t("statsCartPending") : t("statsCartEmpty")}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
              }
            />
          </div>

          {/* -- Graphiques + Top produits -- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Graphique commandes par mois */}
            <div className="bg-bg-primary rounded-2xl border border-border p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-heading text-sm font-semibold text-text-primary">
                  {t("chartTitle")}
                </h2>
                <Link href="/commandes" className="text-xs font-body text-text-secondary hover:text-accent transition-colors">
                  {t("viewAll")}
                </Link>
              </div>
              <BarChart data={monthlyData} />
            </div>

            {/* Top produits commandes */}
            <div className="bg-bg-primary rounded-2xl border border-border p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-heading text-sm font-semibold text-text-primary">
                  {t("topProducts")}
                </h2>
                <Link href="/commandes" className="text-xs font-body text-text-secondary hover:text-accent transition-colors">
                  {t("viewAll")}
                </Link>
              </div>
              {topProducts.length === 0 ? (
                <EmptyState
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                    </svg>
                  }
                  title={t("noOrdersYet")}
                />
              ) : (
                <div className="space-y-3">
                  {topProducts.map((p, i) => {
                    const pct = Math.round((p.count / topProducts[0].count) * 100);
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs font-body text-text-muted w-4 shrink-0">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-body text-text-primary truncate">
                            {p.name}
                          </p>
                          <div className="h-1.5 bg-bg-tertiary rounded-full mt-1.5">
                            <div
                              className="h-1.5 bg-accent rounded-full transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs font-body font-semibold text-text-primary shrink-0">
                          x{p.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* -- Commandes recentes -- */}
          <div className="bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-heading text-sm font-semibold text-text-primary">
                {t("recentOrders")}
              </h2>
              <Link href="/commandes" className="text-xs font-body text-text-secondary hover:text-text-primary transition-colors">
                {t("viewAllOrders")}
              </Link>
            </div>
            {recentOrders.length === 0 ? (
              <EmptyState
                icon={
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                  </svg>
                }
                title={t("noOrdersYet")}
                ctaLabel={t("viewCatalogue")}
                ctaHref="/produits"
              />
            ) : (
              <>
                {/* Desktop table view */}
                <div className="hidden md:block divide-y divide-border-light">
                  {recentOrders.map((order) => {
                    const cfg = STATUS_COLORS[order.status] ?? STATUS_COLORS.PENDING;
                    const date = new Date(order.createdAt).toLocaleDateString("fr-FR", {
                      day: "numeric", month: "short", year: "numeric",
                    });
                    const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
                    return (
                      <div key={order.id} className="px-6 py-4 flex items-center gap-4 hover:bg-bg-secondary/50 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="font-heading text-sm font-semibold text-text-primary">
                              {order.orderNumber}
                            </span>
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-body font-medium ${cfg.bg} ${cfg.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {tOrders(`statuses.${order.status}`)}
                            </span>
                          </div>
                          <p className="text-xs font-body text-text-muted mt-1">
                            {date} — {totalQty} {totalQty > 1 ? tOrders("items_plural") : tOrders("items")}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-heading text-sm font-semibold text-text-primary">
                            {Number(order.totalTTC).toFixed(2)} {"\u20AC"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Mobile card view */}
                <div className="md:hidden divide-y divide-border-light">
                  {recentOrders.map((order) => {
                    const cfg = STATUS_COLORS[order.status] ?? STATUS_COLORS.PENDING;
                    const date = new Date(order.createdAt).toLocaleDateString("fr-FR", {
                      day: "numeric", month: "short", year: "numeric",
                    });
                    const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
                    return (
                      <div key={order.id} className="px-5 py-4 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-heading text-sm font-semibold text-text-primary">
                            {order.orderNumber}
                          </span>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-body font-medium ${cfg.bg} ${cfg.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {tOrders(`statuses.${order.status}`)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs font-body">
                          <span className="text-text-muted">{date}</span>
                          <span className="text-text-muted">
                            {totalQty} {totalQty > 1 ? tOrders("items_plural") : tOrders("items")}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-body text-text-muted">{tOrders("total")}</span>
                          <span className="font-heading text-sm font-semibold text-text-primary">
                            {Number(order.totalTTC).toFixed(2)} {"\u20AC"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* -- Avoirs -- */}
          {(credits.length > 0 || ordersWithCreditNote.length > 0) && (
            <div className="bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <h2 className="font-heading text-sm font-semibold text-text-primary">
                  {tOrders("creditNote")}
                </h2>
                {availableCredit > 0 && (
                  <span className="font-heading text-sm font-bold text-success">
                    {availableCredit.toFixed(2)} {"\u20AC"}
                  </span>
                )}
              </div>
              <div className="divide-y divide-border-light">
                {ordersWithCreditNote.map((o) => (
                  <div key={o.id} className="px-6 py-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-body text-sm font-medium text-text-primary">
                        {tOrders("creditNote")} — {o.orderNumber}
                      </p>
                      <p className="text-xs text-text-muted font-body mt-1">
                        {new Date(o.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <a
                      href={`/api/client/commandes/${o.id}/credit-note`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg-dark hover:bg-primary-hover text-text-inverse text-xs font-body font-medium rounded-lg transition-colors shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      {tOrders("downloadCreditNote")}
                    </a>
                  </div>
                ))}
                {credits.map((credit) => {
                  const remaining = Number(credit.remainingAmount);
                  const total = Number(credit.amount);
                  const usedPct = total > 0 ? Math.round(((total - remaining) / total) * 100) : 100;
                  const isExpired = credit.expiresAt && new Date(credit.expiresAt) < new Date();
                  return (
                    <div key={credit.id} className="px-6 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-sm font-medium text-text-primary">
                            {total.toFixed(2)} {"\u20AC"}
                            <span className="text-text-muted font-normal"> — {tOrders("remaining")} : {remaining.toFixed(2)} {"\u20AC"}</span>
                          </p>
                          {credit.claim && (
                            <p className="text-xs text-text-muted font-body mt-1">
                              {tOrders("claimRef")} {credit.claim.reference}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`badge ${remaining > 0 && !isExpired ? "badge-success" : "badge-neutral"}`}>
                            {isExpired ? tOrders("expired") : remaining > 0 ? tOrders("active") : tOrders("used")}
                          </span>
                          {credit.expiresAt && (
                            <p className="text-[10px] text-text-muted font-body mt-1">
                              {tOrders("expiresOn")} {new Date(credit.expiresAt).toLocaleDateString("fr-FR")}
                            </p>
                          )}
                        </div>
                      </div>
                      {/* Credit usage progress bar */}
                      <div className="mt-3 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-300 ${remaining > 0 && !isExpired ? "bg-success" : "bg-text-muted"}`}
                          style={{ width: `${100 - usedPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* -- Favoris recents -- */}
          <div className="bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-heading text-sm font-semibold text-text-primary">
                {t("myFavorites")}
              </h2>
              <Link href="/favoris" className="text-xs font-body text-text-secondary hover:text-text-primary transition-colors">
                {t("viewAllFavorites")}
              </Link>
            </div>
            {favorites.length === 0 ? (
              <EmptyState
                icon={
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                  </svg>
                }
                title={t("noFavorites")}
                ctaLabel={t("discoverCatalogue")}
                ctaHref="/produits"
              />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4">
                {favorites.map((fav) => {
                  const primaryColor = fav.product.colors[0];
                  const img = favFirstImageMap.get(fav.product.id);
                  return (
                    <Link
                      key={fav.id}
                      href={`/produits/${fav.product.id}`}
                      className="group rounded-xl overflow-hidden transition-all duration-200 hover:shadow-md"
                    >
                      {img ? (
                        <div className="aspect-square bg-bg-tertiary rounded-xl overflow-hidden relative">
                          <Image
                            src={img}
                            alt={fav.product.name}
                            fill
                            sizes="(max-width: 640px) 50vw, 25vw"
                            className="object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        </div>
                      ) : (
                        <div className="aspect-square bg-bg-tertiary rounded-xl flex items-center justify-center">
                          <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                          </svg>
                        </div>
                      )}
                      <div className="p-3">
                        <p className="text-xs font-body font-medium text-text-primary truncate">
                          {fav.product.name}
                        </p>
                        {primaryColor && (
                          <p className="text-xs font-body text-text-secondary mt-0.5">
                            {Number(primaryColor.unitPrice).toFixed(2)} {"\u20AC"}
                          </p>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* -- Purchase history: mobile/tablet horizontal scroll -- */}
          <div className="lg:hidden">
            <div className="bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="font-heading text-sm font-semibold text-text-primary">
                  {t("purchaseHistory")}
                </h2>
                <p className="text-xs text-text-muted font-body mt-0.5">
                  {allOrderedProducts.length > 1
                    ? t("productsOrdered_plural", { count: allOrderedProducts.length })
                    : t("productsOrdered", { count: allOrderedProducts.length })}
                </p>
              </div>

              {allOrderedProducts.length === 0 ? (
                <EmptyState
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                    </svg>
                  }
                  title={t("noPurchases")}
                />
              ) : (
                <div className="overflow-x-auto p-4">
                  <div className="flex gap-3" style={{ minWidth: "max-content" }}>
                    {allOrderedProducts.slice(0, 10).map((product, i) => (
                      <Link
                        key={i}
                        href={`/produits?q=${encodeURIComponent(product.ref)}`}
                        className="group w-36 shrink-0 bg-bg-secondary rounded-xl overflow-hidden hover:shadow-md transition-all"
                      >
                        <div className="aspect-square bg-bg-tertiary overflow-hidden relative">
                          {product.image ? (
                            <Image
                              src={product.image}
                              alt={product.name}
                              fill
                              sizes="144px"
                              className="object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="p-2.5">
                          <p className="text-xs font-body font-medium text-text-primary truncate">
                            {product.name}
                          </p>
                          <p className="text-[10px] text-text-muted font-mono truncate mt-0.5">
                            {product.ref}
                          </p>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-xs font-heading font-bold text-text-primary">
                              x{product.totalQty}
                            </span>
                            <span className="text-[10px] text-text-muted font-body">
                              {product.orderCount > 1
                                ? t("orderCount_plural", { count: product.orderCount })
                                : t("orderCount", { count: product.orderCount })}
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* -- Informations compte (editable) -- */}
          <AccountEditor user={{
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            company: user.company,
            phone: user.phone,
            siret: user.siret,
            address: (user as unknown as { address: string | null }).address,
            vatNumber: user.vatNumber,
          }} />
        </div>

        {/* -- Colonne droite : Historique des produits commandes -- */}
        <aside className="hidden lg:block w-[380px] shrink-0">
          <div className="bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm sticky top-24">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-heading text-base font-semibold text-text-primary">
                {t("purchaseHistory")}
              </h2>
              <p className="text-xs text-text-muted font-body mt-1">
                {allOrderedProducts.length > 1
                  ? t("productsOrdered_plural", { count: allOrderedProducts.length })
                  : t("productsOrdered", { count: allOrderedProducts.length })}
              </p>
            </div>

            {allOrderedProducts.length === 0 ? (
              <EmptyState
                icon={
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                  </svg>
                }
                title={t("noPurchases")}
              />
            ) : (
              <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-4">
                <div className="grid grid-cols-2 gap-3">
                  {allOrderedProducts.map((product, i) => (
                    <Link
                      key={i}
                      href={`/produits?q=${encodeURIComponent(product.ref)}`}
                      className="group bg-bg-secondary rounded-xl overflow-hidden hover:shadow-md transition-all duration-200"
                    >
                      {/* Image large */}
                      <div className="aspect-square bg-bg-tertiary overflow-hidden relative">
                        {product.image ? (
                          <Image
                            src={product.image}
                            alt={product.name}
                            fill
                            sizes="(max-width: 1024px) 0vw, 180px"
                            className="object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                            </svg>
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="p-3">
                        <p className="text-xs font-body font-medium text-text-primary truncate">
                          {product.name}
                        </p>
                        <p className="text-[10px] text-text-muted font-mono truncate mt-0.5">
                          {product.ref} · {product.colorName}
                        </p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs font-heading font-bold text-text-primary">
                            x{product.totalQty}
                          </span>
                          <span className="text-[10px] text-text-muted font-body bg-bg-primary px-2 py-0.5 rounded-full">
                            {product.orderCount > 1
                              ? t("orderCount_plural", { count: product.orderCount })
                              : t("orderCount", { count: product.orderCount })}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
