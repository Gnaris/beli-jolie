import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AccountEditor from "@/components/client/AccountEditor";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Tableau de bord — Beli & Jolie",
  robots: { index: false, follow: false },
};

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  PENDING:    { bg: "bg-[#FEF3C7]",   text: "text-[#92400E]",  dot: "bg-[#F59E0B]"  },
  PROCESSING: { bg: "bg-blue-50",     text: "text-blue-700",   dot: "bg-blue-500"   },
  SHIPPED:    { bg: "bg-purple-50",   text: "text-purple-700", dot: "bg-purple-500" },
  DELIVERED:  { bg: "bg-[#DCFCE7]",   text: "text-[#166534]",  dot: "bg-[#22C55E]"  },
  CANCELLED:  { bg: "bg-[#F7F7F8]",   text: "text-[#9CA3AF]",  dot: "bg-[#9CA3AF]" },
};

/* -- Mini bar chart (SVG) -- */
function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1.5 h-24">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-[#1A1A1A] rounded-t-sm transition-all"
            style={{ height: `${Math.round((d.value / max) * 80)}px`, minHeight: d.value > 0 ? "4px" : "0" }}
          />
          <span className="text-[9px] font-[family-name:var(--font-roboto)] text-[#9CA3AF] leading-none">
            {d.label}
          </span>
        </div>
      ))}
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
    <div className="bg-white rounded-xl border border-[#E5E5E5] p-5 flex items-start gap-4">
      <div className="w-11 h-11 rounded-xl bg-[#F7F7F8] flex items-center justify-center text-[#1A1A1A] shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-[family-name:var(--font-roboto)] text-[#9CA3AF] uppercase tracking-wider">
          {label}
        </p>
        <p className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#1A1A1A] mt-0.5">
          {value}
        </p>
        {sub && (
          <p className="text-xs font-[family-name:var(--font-roboto)] text-[#9CA3AF] mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion");

  const userId = session.user.id;
  const t = await getTranslations("account");
  const tOrders = await getTranslations("orders");

  const [user, orders, favorites, cart] = await Promise.all([
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
              select: { unitPrice: true, images: { select: { path: true }, orderBy: { order: "asc" }, take: 1 } },
              take: 1,
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
  ]);

  if (!user) redirect("/connexion");

  /* -- Stats -- */
  const totalOrders = orders.length;
  const totalSpent = orders.reduce((s, o) => s + o.totalTTC, 0);
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
    <div className="p-6 md:p-10 w-full">
      <div className="flex gap-6">
        {/* -- Colonne principale (gauche) -- */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* En-tete */}
          <div>
            <h1 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#1A1A1A]">
              {t("greeting", { name: user.firstName })}
            </h1>
            <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)] mt-0.5">
              {user.company} — {t("memberSince", { date: formattedDate })}
            </p>
          </div>

          {/* Bandeau statut si pas APPROVED */}
          {user.status !== "APPROVED" && (
            <div className={`${user.status === "PENDING" ? "bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]" : "bg-[#FEE2E2] border-[#FECACA] text-[#991B1B]"} border rounded-xl p-4 flex items-start gap-3`}>
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${user.status === "PENDING" ? "bg-[#F59E0B]" : "bg-[#EF4444]"}`} />
              <div>
                <p className="text-sm font-[family-name:var(--font-roboto)] font-semibold">
                  {user.status === "PENDING" ? t("pendingValidation") : t("rejected")}
                </p>
                <p className="text-sm font-[family-name:var(--font-roboto)] opacity-80 mt-0.5">
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
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
                  {t("chartTitle")}
                </h2>
                <Link href="/commandes" className="text-xs font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">
                  {t("viewAll")}
                </Link>
              </div>
              <BarChart data={monthlyData} />
            </div>

            {/* Top produits commandes */}
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
                  {t("topProducts")}
                </h2>
                <Link href="/commandes" className="text-xs font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">
                  {t("viewAll")}
                </Link>
              </div>
              {topProducts.length === 0 ? (
                <p className="text-sm font-[family-name:var(--font-roboto)] text-[#9CA3AF] py-6 text-center">
                  {t("noOrdersYet")}
                </p>
              ) : (
                <div className="space-y-2">
                  {topProducts.map((p, i) => {
                    const pct = Math.round((p.count / topProducts[0].count) * 100);
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs font-[family-name:var(--font-roboto)] text-[#9CA3AF] w-4 shrink-0">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] truncate">
                            {p.name}
                          </p>
                          <div className="h-1.5 bg-[#F0F0F0] rounded-full mt-1">
                            <div
                              className="h-1.5 bg-[#1A1A1A] rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#1A1A1A] shrink-0">
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
          <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E5E5E5] flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
                {t("recentOrders")}
              </h2>
              <Link href="/commandes" className="text-xs font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">
                {t("viewAllOrders")}
              </Link>
            </div>
            {recentOrders.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-[family-name:var(--font-roboto)] text-[#9CA3AF]">
                  {t("noOrdersYet")}
                </p>
                <Link href="/produits" className="inline-flex mt-4 justify-center text-xs px-4 py-2 bg-[#1A1A1A] text-white rounded-lg font-[family-name:var(--font-roboto)] font-medium hover:bg-[#333] transition-colors">
                  {t("viewCatalogue")}
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-[#F0F0F0]">
                {recentOrders.map((order) => {
                  const cfg = STATUS_COLORS[order.status] ?? STATUS_COLORS.PENDING;
                  const date = new Date(order.createdAt).toLocaleDateString("fr-FR", {
                    day: "numeric", month: "short", year: "numeric",
                  });
                  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
                  return (
                    <div key={order.id} className="px-5 py-3.5 flex flex-wrap items-center gap-3 hover:bg-[#F7F7F8] transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
                            {order.orderNumber}
                          </span>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-[family-name:var(--font-roboto)] font-medium ${cfg.bg} ${cfg.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {tOrders(`statuses.${order.status}`)}
                          </span>
                        </div>
                        <p className="text-xs font-[family-name:var(--font-roboto)] text-[#9CA3AF] mt-0.5">
                          {date} — {totalQty} {totalQty > 1 ? tOrders("items_plural") : tOrders("items")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
                          {order.totalTTC.toFixed(2)} {"\u20AC"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* -- Favoris recents -- */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E5E5E5] flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
                {t("myFavorites")}
              </h2>
              <Link href="/favoris" className="text-xs font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">
                {t("viewAllFavorites")}
              </Link>
            </div>
            {favorites.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-[family-name:var(--font-roboto)] text-[#9CA3AF]">
                  {t("noFavorites")}
                </p>
                <Link href="/produits" className="inline-flex mt-4 justify-center text-xs px-4 py-2 bg-[#1A1A1A] text-white rounded-lg font-[family-name:var(--font-roboto)] font-medium hover:bg-[#333] transition-colors">
                  {t("discoverCatalogue")}
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#F0F0F0]">
                {favorites.map((fav) => {
                  const primaryColor = fav.product.colors[0];
                  const img = primaryColor?.images[0]?.path;
                  return (
                    <Link
                      key={fav.id}
                      href={`/produits/${fav.product.id}`}
                      className="p-4 hover:bg-[#F7F7F8] transition-colors group"
                    >
                      {img ? (
                        <div className="aspect-square bg-[#EFEFEF] rounded-xl overflow-hidden mb-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img}
                            alt={fav.product.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                      ) : (
                        <div className="aspect-square bg-[#EFEFEF] rounded-xl mb-2 flex items-center justify-center">
                          <svg className="w-6 h-6 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                          </svg>
                        </div>
                      )}
                      <p className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] truncate">
                        {fav.product.name}
                      </p>
                      {primaryColor && (
                        <p className="text-xs font-[family-name:var(--font-roboto)] text-[#6B6B6B] mt-0.5">
                          {primaryColor.unitPrice.toFixed(2)} {"\u20AC"}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
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
        <aside className="hidden lg:block w-[460px] shrink-0">
          <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden sticky top-24">
            <div className="px-6 py-4 border-b border-[#E5E5E5]">
              <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A]">
                {t("purchaseHistory")}
              </h2>
              <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
                {allOrderedProducts.length > 1
                  ? t("productsOrdered_plural", { count: allOrderedProducts.length })
                  : t("productsOrdered", { count: allOrderedProducts.length })}
              </p>
            </div>

            {allOrderedProducts.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                  {t("noPurchases")}
                </p>
              </div>
            ) : (
              <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-4">
                <div className="grid grid-cols-2 gap-3">
                  {allOrderedProducts.map((product, i) => (
                    <Link
                      key={i}
                      href={`/produits?q=${encodeURIComponent(product.ref)}`}
                      className="group bg-[#F7F7F8] rounded-xl overflow-hidden hover:shadow-md transition-all"
                    >
                      {/* Image large */}
                      <div className="aspect-square bg-[#EFEFEF] overflow-hidden">
                        {product.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.image}
                            alt={product.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-8 h-8 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                            </svg>
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="p-3">
                        <p className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] truncate">
                          {product.name}
                        </p>
                        <p className="text-[10px] text-[#9CA3AF] font-mono truncate mt-0.5">
                          {product.ref} · {product.colorName}
                        </p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs font-[family-name:var(--font-poppins)] font-bold text-[#1A1A1A]">
                            x{product.totalQty}
                          </span>
                          <span className="text-[10px] text-[#9CA3AF] font-[family-name:var(--font-roboto)] bg-white px-2 py-0.5 rounded-full">
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
