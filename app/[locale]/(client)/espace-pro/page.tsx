import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect, Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { getAvailableCredit } from "@/lib/credits";
import { buildProductHandle } from "@/lib/product-url";
import AccountEditor from "@/components/client/AccountEditor";
import NewsletterToggle from "@/components/client/NewsletterToggle";
import MyReviewCard, { type MyReviewInitial } from "@/components/client/MyReviewCard";
import { userHasEligibleOrder, findMyReview } from "@/lib/customer-reviews";
import LogoutButton from "@/components/client/LogoutButton";
import { getTranslations, getLocale } from "next-intl/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tMeta] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
  ]);
  return {
    title: tMeta("accountTitle", { shopName }),
    robots: { index: false, follow: false },
  };
}

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  PENDING:   { bg: "bg-amber-50",      text: "text-amber-800",   dot: "bg-warning"    },
  SHIPPED:   { bg: "bg-emerald-50",    text: "text-emerald-800", dot: "bg-success"    },
  CANCELLED: { bg: "bg-bg-secondary",  text: "text-text-muted",  dot: "bg-text-muted" },
};

/* -- Mini bar chart (SVG) -- */
function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-2 h-24" role="img" aria-label="Commandes par mois">
      {data.map((d, i) => {
        const h = Math.round((d.value / max) * 84);
        const isLast = i === data.length - 1;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <span className={`text-[10px] leading-none ${isLast ? "font-semibold text-text-primary" : "text-text-muted"}`}>
              {d.value > 0 ? d.value : ""}
            </span>
            <div
              className={`w-full max-w-[28px] rounded-md ${isLast ? "bg-text-primary" : "bg-bg-tertiary"}`}
              style={{ height: `${Math.max(h, d.value > 0 ? 6 : 2)}px` }}
            />
            <span className={`text-[10px] leading-none capitalize ${isLast ? "font-medium text-text-primary" : "text-text-muted"}`}>
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* -- Stat card -- */
function StatCard({
  label, value, sub, icon, tone = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  tone?: "neutral" | "accent";
}) {
  const iconBg = tone === "accent" ? "bg-amber-100 text-amber-700" : "bg-bg-secondary text-text-secondary";
  const subCls = tone === "accent" ? "text-amber-700 font-medium" : "text-text-muted";
  return (
    <div className="rounded-2xl border border-border bg-bg-primary p-4 sm:p-5 transition-all hover:shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-body font-semibold text-text-muted uppercase tracking-wider">{label}</p>
          <p className="font-heading text-xl sm:text-2xl font-bold text-text-primary leading-tight mt-0.5">
            {value}
          </p>
        </div>
      </div>
      {sub && <p className={`text-xs font-body mt-3 ${subCls}`}>{sub}</p>}
    </div>
  );
}

/* -- Empty state -- */
function EmptyState({
  icon, title, subtitle, ctaLabel, ctaHref,
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
      {subtitle && <p className="text-xs font-body text-text-muted mt-1 max-w-xs">{subtitle}</p>}
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
  const locale = await getLocale();
  if (!session) return redirect({ href: "/connexion", locale });

  const userId = session.user.id;
  const [t, tOrders, tNav] = await Promise.all([
    getTranslations("account"),
    getTranslations("orders"),
    getTranslations("nav"),
  ]);
  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";

  const [
    user, orders, favorites, cart, credits, availableCredit,
    ordersWithCreditNote, hasEligibleReviewOrder, myReview,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.order.findMany({
      where: { userId },
      include: {
        items: {
          select: {
            quantity: true, lineTotal: true, productName: true, productRef: true,
            colorName: true, imagePath: true, saleType: true, packQty: true, size: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.favorite.findMany({
      where: { userId },
      include: {
        product: {
          select: {
            id: true, name: true, reference: true,
            colors: {
              where: { disabled: false },
              orderBy: { isPrimary: "desc" },
              select: { colorId: true, unitPrice: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    prisma.cart.findUnique({ where: { userId }, include: { items: { select: { quantity: true } } } }),
    prisma.credit.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    getAvailableCredit(userId),
    prisma.order.findMany({
      where: { userId, creditNotePath: { not: null } },
      select: { id: true, orderNumber: true, createdAt: true, creditNotePath: true },
      orderBy: { createdAt: "desc" },
    }),
    userHasEligibleOrder(userId),
    findMyReview(userId),
  ]);

  if (!user) return redirect({ href: "/connexion", locale });

  const initialReview: MyReviewInitial | null = myReview
    ? {
        id: myReview.id,
        rating: myReview.rating,
        text: myReview.text,
        status: myReview.status,
        createdAt: myReview.createdAt.toISOString(),
        moderatedAt: myReview.moderatedAt?.toISOString() ?? null,
        moderationNote: myReview.moderationNote,
      }
    : null;

  const favProductIds = favorites.map((f) => f.product.id);
  const favFirstImages = favProductIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: favProductIds } }, orderBy: { order: "asc" } })
    : [];
  const favFirstImageMap = new Map<string, string>();
  for (const img of favFirstImages) {
    if (!favFirstImageMap.has(img.productId)) favFirstImageMap.set(img.productId, img.path);
  }

  const totalOrders = orders.length;
  const totalSpent = orders.reduce((s, o) => s + Number(o.totalTTC), 0);
  const totalItemsOrdered = orders.reduce(
    (s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0,
  );
  const cartItemCount = cart?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;

  /* -- Produits les plus commandés -- */
  const productCountMap = new Map<string, { name: string; count: number }>();
  for (const order of orders) {
    for (const item of order.items) {
      const key = item.productName;
      const existing = productCountMap.get(key) ?? { name: key, count: 0 };
      productCountMap.set(key, { ...existing, count: existing.count + item.quantity });
    }
  }
  const topProducts = [...productCountMap.values()].sort((a, b) => b.count - a.count).slice(0, 4);

  /* -- Historique produits -- */
  const productHistoryMap = new Map<string, {
    name: string; ref: string; image: string | null;
    colorName: string; orderCount: number; totalQty: number;
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
          name: item.productName, ref: item.productRef, image: item.imagePath,
          colorName: item.colorName, orderCount: 1, totalQty: item.quantity,
        });
      }
    }
  }
  const allOrderedProducts = [...productHistoryMap.values()].sort((a, b) => b.totalQty - a.totalQty);

  /* -- Commandes / mois (6 derniers) -- */
  const now = new Date();
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      label: d.toLocaleDateString(dateLocale, { month: "short" }),
      value: 0,
      year: d.getFullYear(),
      month: d.getMonth(),
    };
  });
  for (const order of orders) {
    const d = new Date(order.createdAt);
    const slot = monthlyData.find((m) => m.year === d.getFullYear() && m.month === d.getMonth());
    if (slot) slot.value++;
  }

  const recentOrders = orders.slice(0, 5);

  const formattedDate = new Date(user.createdAt).toLocaleDateString(dateLocale, {
    day: "numeric", month: "long", year: "numeric",
  });

  const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "?";

  const statusLabel = user.status === "APPROVED"
    ? t("statuses.APPROVED")
    : user.status === "PENDING"
      ? t("statuses.PENDING")
      : t("statuses.REJECTED");
  const statusDot = user.status === "APPROVED" ? "bg-success" : user.status === "PENDING" ? "bg-warning" : "bg-error";
  const statusPillCls = user.status === "APPROVED"
    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
    : user.status === "PENDING"
      ? "bg-amber-50 text-amber-800 border-amber-100"
      : "bg-red-50 text-red-800 border-red-100";

  return (
    <div className="w-full max-w-[1360px] mx-auto">
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">

        {/* ============ SIDEBAR ============ */}
        <aside className="lg:w-[320px] lg:shrink-0 lg:sticky lg:top-24 lg:self-start space-y-4">
          {/* -- Identité -- */}
          <div className="rounded-2xl border border-border bg-bg-primary p-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-bg-dark text-text-inverse flex items-center justify-center font-heading font-bold shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="font-heading font-semibold text-sm text-text-primary truncate">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-xs text-text-muted font-body truncate">{user.email}</p>
              </div>
            </div>

            <div className={`mt-4 rounded-xl border p-3 ${statusPillCls}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-body font-semibold uppercase tracking-wider opacity-70">
                  {t("companySection")}
                </p>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium">
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                  {statusLabel}
                </span>
              </div>
              <p className="text-sm font-medium mt-1 truncate">{user.company}</p>
              <p className="text-[11px] font-body mt-0.5 opacity-75">
                {t("memberSince", { date: formattedDate })}
              </p>
            </div>
          </div>

          {/* -- Avoir (si > 0) -- */}
          {availableCredit > 0 && (
            <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-bg-primary to-bg-primary p-5">
              <p className="text-[11px] font-body font-semibold uppercase tracking-wider text-emerald-800">
                {tOrders("myCredit")}
              </p>
              <p className="font-heading text-3xl font-bold text-emerald-900 mt-1">
                {availableCredit.toFixed(2)} {"€"}
              </p>
              <p className="text-xs font-body text-emerald-800/80 mt-2">
                {tOrders("usableAtCheckout")}
              </p>
              <a href="#avoirs" className="mt-3 inline-flex text-xs font-medium text-emerald-900 hover:underline">
                {t("viewAll")} →
              </a>
            </div>
          )}

          {/* -- Nav rapide (visible dès md, on la garde toujours pour raccourci en mobile aussi) -- */}
          <nav className="rounded-2xl border border-border bg-bg-primary p-3">
            <p className="text-[11px] font-body font-semibold uppercase tracking-wider text-text-muted px-2 pt-1 pb-2">
              {tNav("account")}
            </p>
            <div className="space-y-0.5">
              <span className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-bg-dark text-text-inverse text-sm font-medium">
                <span className="flex items-center gap-3">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10" />
                  </svg>
                  {t("title")}
                </span>
              </span>
              <Link href="/commandes" className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-colors">
                <span className="flex items-center gap-3">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" d="M9 12h6M9 16h6M9 8h6m3 12H6a2 2 0 01-2-2V6a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2z" />
                  </svg>
                  {tNav("orders")}
                </span>
                {totalOrders > 0 && (
                  <span className="text-[11px] font-body bg-bg-secondary text-text-secondary px-2 py-0.5 rounded-full">{totalOrders}</span>
                )}
              </Link>
              <Link href="/panier" className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-colors">
                <span className="flex items-center gap-3">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.35 2.7A1 1 0 006.5 17H19" />
                  </svg>
                  {tNav("cart")}
                </span>
                {cartItemCount > 0 && (
                  <span className="text-[11px] font-body bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">{cartItemCount}</span>
                )}
              </Link>
              <Link href="/favoris" className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-colors">
                <span className="flex items-center gap-3">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                  </svg>
                  {tNav("favorites")}
                </span>
                {favorites.length > 0 && (
                  <span className="text-[11px] font-body bg-bg-secondary text-text-secondary px-2 py-0.5 rounded-full">{favorites.length}</span>
                )}
              </Link>
              <a href="#historique" className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-colors">
                <span className="flex items-center gap-3">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  {t("purchaseHistory")}
                </span>
                {allOrderedProducts.length > 0 && (
                  <span className="text-[11px] font-body bg-bg-secondary text-text-secondary px-2 py-0.5 rounded-full">{allOrderedProducts.length}</span>
                )}
              </a>
              <Link href="/espace-pro/reclamations" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {tNav("claims")}
              </Link>
            </div>

            <div className="h-px bg-border-light my-3" />

            <div className="space-y-0.5">
              <a href="#compte" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {t("profileSection")}
              </a>
              <div className="px-1 pt-1">
                <LogoutButton />
              </div>
            </div>
          </nav>
        </aside>

        {/* ============ MAIN ============ */}
        <main className="flex-1 min-w-0 space-y-6">

          {/* Header sticky avec titre + tabs (visible dès md) */}
          <div className="rounded-2xl border border-border bg-bg-primary overflow-hidden">
            <div className="px-5 sm:px-6 py-5 flex items-start justify-between gap-4 border-b border-border-light">
              <div className="min-w-0">
                <p className="text-[11px] font-body font-semibold uppercase tracking-[0.2em] text-text-muted">
                  {t("title")}
                </p>
                <h1 className="font-heading text-2xl sm:text-3xl font-bold text-text-primary mt-1">
                  {t("greeting", { name: user.firstName })}
                </h1>
                <p className="text-sm text-text-secondary font-body mt-1">
                  {user.company} · {t("memberSince", { date: formattedDate })}
                </p>
              </div>
            </div>
            {/* Tabs = liens vers pages existantes + ancres */}
            <nav aria-label="Sections" className="flex gap-1 px-4 sm:px-6 overflow-x-auto scrollbar-none">
              <span className="shrink-0 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 border-text-primary text-text-primary">
                {t("title")}
              </span>
              <Link href="/commandes" className="shrink-0 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 border-transparent text-text-muted hover:text-text-primary hover:border-border transition-colors">
                {tNav("orders")}
              </Link>
              <a href="#historique" className="shrink-0 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 border-transparent text-text-muted hover:text-text-primary hover:border-border transition-colors">
                {t("purchaseHistory")}
              </a>
              <Link href="/favoris" className="shrink-0 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 border-transparent text-text-muted hover:text-text-primary hover:border-border transition-colors">
                {tNav("favorites")}
              </Link>
              {(credits.length > 0 || ordersWithCreditNote.length > 0) && (
                <a href="#avoirs" className="shrink-0 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 border-transparent text-text-muted hover:text-text-primary hover:border-border transition-colors">
                  {tOrders("creditNote")}
                </a>
              )}
              <a href="#compte" className="shrink-0 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 border-transparent text-text-muted hover:text-text-primary hover:border-border transition-colors">
                {t("profileSection")}
              </a>
            </nav>
          </div>

          {/* Bandeau statut */}
          {user.status === "PENDING" && (
            <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 sm:p-5 flex items-start gap-3">
              <span className="w-9 h-9 rounded-full bg-bg-primary border border-sky-200 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-sm font-body font-semibold text-sky-900">{t("pendingBannerTitle")}</p>
                <p className="text-sm font-body text-sky-800/80 mt-0.5">{t("pendingBannerDesc")}</p>
              </div>
            </div>
          )}
          {user.status === "REJECTED" && (
            <div className="bg-red-50 border-red-200 text-red-800 border rounded-2xl p-4 sm:p-5 flex items-start gap-3">
              <span className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-red-500" />
              <div>
                <p className="text-sm font-body font-semibold">{t("rejected")}</p>
                <p className="text-sm font-body opacity-80 mt-0.5">{t("rejectedDesc")}</p>
              </div>
            </div>
          )}

          {/* KPI grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label={t("statsOrders")}
              value={totalOrders}
              sub={t("statsTotal")}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                </svg>
              }
            />
            <StatCard
              label={t("statsItems")}
              value={totalItemsOrdered}
              sub={t("statsPieces")}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                </svg>
              }
            />
            <StatCard
              label={t("statsSpent")}
              value={`${totalSpent.toFixed(2)} €`}
              sub={t("statsInclShipping")}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                </svg>
              }
            />
            <StatCard
              label={t("statsCart")}
              value={cartItemCount}
              sub={cartItemCount > 0 ? t("statsCartPending") : t("statsCartEmpty")}
              tone={cartItemCount > 0 ? "accent" : "neutral"}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
              }
            />
          </div>

          {/* Commandes récentes + insights */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4">
            {/* Commandes récentes */}
            <div className="rounded-2xl border border-border bg-bg-primary overflow-hidden">
              <div className="px-5 sm:px-6 py-4 border-b border-border-light flex items-center justify-between">
                <h2 className="font-heading text-base font-semibold text-text-primary">{t("recentOrders")}</h2>
                <Link href="/commandes" className="text-xs font-body text-text-secondary hover:text-text-primary transition-colors">
                  {t("viewAllOrders")}
                </Link>
              </div>

              {recentOrders.length === 0 ? (
                <EmptyState
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                    </svg>
                  }
                  title={t("noOrdersYet")}
                  ctaLabel={t("viewCatalogue")}
                  ctaHref="/produits"
                />
              ) : (
                <>
                  {/* Desktop */}
                  <ul className="hidden md:block divide-y divide-border-light">
                    {recentOrders.map((order) => {
                      const cfg = STATUS_COLORS[order.status] ?? STATUS_COLORS.PENDING;
                      const date = new Date(order.createdAt).toLocaleDateString(dateLocale, {
                        day: "numeric", month: "short", year: "numeric",
                      });
                      const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
                      return (
                        <li key={order.id} className="px-5 sm:px-6 py-4 flex items-center gap-4 hover:bg-bg-secondary/50 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-heading text-sm font-semibold text-text-primary">{order.orderNumber}</span>
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
                            <p className={`font-heading text-sm font-semibold ${order.status === "CANCELLED" ? "text-text-muted line-through" : "text-text-primary"}`}>
                              {Number(order.totalTTC).toFixed(2)} {"€"}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Mobile */}
                  <ul className="md:hidden divide-y divide-border-light">
                    {recentOrders.map((order) => {
                      const cfg = STATUS_COLORS[order.status] ?? STATUS_COLORS.PENDING;
                      const date = new Date(order.createdAt).toLocaleDateString(dateLocale, {
                        day: "numeric", month: "short", year: "numeric",
                      });
                      const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
                      return (
                        <li key={order.id} className="px-5 py-4 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-heading text-sm font-semibold text-text-primary">{order.orderNumber}</span>
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-body font-medium ${cfg.bg} ${cfg.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {tOrders(`statuses.${order.status}`)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs font-body text-text-muted">
                            <span>{date}</span>
                            <span>{totalQty} {totalQty > 1 ? tOrders("items_plural") : tOrders("items")}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-body text-text-muted">{tOrders("total")}</span>
                            <span className={`font-heading text-sm font-semibold ${order.status === "CANCELLED" ? "text-text-muted line-through" : "text-text-primary"}`}>
                              {Number(order.totalTTC).toFixed(2)} {"€"}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>

            {/* Insights */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-bg-primary p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-heading text-sm font-semibold text-text-primary">{t("chartTitle")}</h2>
                </div>
                <BarChart data={monthlyData} />
              </div>

              <div className="rounded-2xl border border-border bg-bg-primary p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-heading text-sm font-semibold text-text-primary">{t("topProducts")}</h2>
                  <Link href="/commandes" className="text-xs font-body text-text-muted hover:text-text-primary transition-colors">
                    {t("viewAll")}
                  </Link>
                </div>
                {topProducts.length === 0 ? (
                  <p className="text-xs text-text-muted py-4 text-center">{t("noOrdersYet")}</p>
                ) : (
                  <ol className="space-y-2.5">
                    {topProducts.map((p, i) => {
                      const pct = Math.round((p.count / topProducts[0].count) * 100);
                      const barTone = i === 0 ? "bg-text-primary" : i === 1 ? "bg-text-secondary" : "bg-text-muted";
                      return (
                        <li key={i} className="flex items-center gap-3">
                          <span className="text-xs font-body text-text-muted w-3 shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-body text-text-primary truncate">{p.name}</p>
                            <div className="h-1.5 bg-bg-tertiary rounded-full mt-1.5">
                              <div className={`h-1.5 ${barTone} rounded-full transition-all duration-300`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                          <span className="text-xs font-body font-semibold text-text-primary shrink-0">×{p.count}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          </div>

          {/* Historique achats en frise (id ancre) */}
          <div id="historique" className="rounded-2xl border border-border bg-bg-primary overflow-hidden scroll-mt-24">
            <div className="px-5 sm:px-6 py-4 border-b border-border-light flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-heading text-base font-semibold text-text-primary">{t("purchaseHistory")}</h2>
                <p className="text-xs text-text-muted font-body mt-0.5">
                  {allOrderedProducts.length > 1
                    ? t("productsOrdered_plural", { count: allOrderedProducts.length })
                    : t("productsOrdered", { count: allOrderedProducts.length })}
                </p>
              </div>
            </div>

            {allOrderedProducts.length === 0 ? (
              <EmptyState
                icon={
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                  </svg>
                }
                title={t("noPurchases")}
              />
            ) : (
              <div className="overflow-x-auto p-4">
                <ul className="flex gap-3" style={{ minWidth: "max-content" }}>
                  {allOrderedProducts.slice(0, 20).map((product, i) => (
                    <li key={i} className="w-36 sm:w-40 shrink-0">
                      <Link
                        href={`/produits?q=${encodeURIComponent(product.ref)}`}
                        className="group block rounded-xl overflow-hidden border border-border-light hover:shadow-md transition-all"
                      >
                        <div className="aspect-square bg-bg-tertiary overflow-hidden relative">
                          {product.image ? (
                            <Image
                              src={product.image}
                              alt={product.name}
                              fill
                              sizes="160px"
                              className="object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                              </svg>
                            </div>
                          )}
                          <span className="absolute top-2 right-2 text-[10px] bg-bg-primary/95 backdrop-blur px-1.5 py-0.5 rounded-full font-medium text-text-primary">
                            ×{product.totalQty}
                          </span>
                        </div>
                        <div className="p-2.5">
                          <p className="text-xs font-body font-medium text-text-primary truncate">{product.name}</p>
                          <p className="text-[10px] text-text-muted font-mono truncate mt-0.5">
                            {product.ref} · {product.colorName}
                          </p>
                          <p className="text-[10px] text-text-muted font-body mt-1">
                            {product.orderCount > 1
                              ? t("orderCount_plural", { count: product.orderCount })
                              : t("orderCount", { count: product.orderCount })}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Favoris + Avis */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4">
            <div className="rounded-2xl border border-border bg-bg-primary overflow-hidden">
              <div className="px-5 sm:px-6 py-4 border-b border-border-light flex items-center justify-between">
                <h2 className="font-heading text-base font-semibold text-text-primary">{t("myFavorites")}</h2>
                <Link href="/favoris" className="text-xs font-body text-text-muted hover:text-text-primary transition-colors">
                  {t("viewAllFavorites")}
                </Link>
              </div>

              {favorites.length === 0 ? (
                <EmptyState
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                    </svg>
                  }
                  title={t("noFavorites")}
                  ctaLabel={t("discoverCatalogue")}
                  ctaHref="/produits"
                />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
                  {favorites.map((fav) => {
                    const primaryColor = fav.product.colors[0];
                    const img = favFirstImageMap.get(fav.product.id);
                    return (
                      <Link
                        key={fav.id}
                        href={`/produits/${buildProductHandle(fav.product.name, fav.product.reference)}`}
                        className="group rounded-xl overflow-hidden border border-border-light transition-all hover:shadow-md"
                      >
                        {img ? (
                          <div className="aspect-square bg-bg-tertiary overflow-hidden relative">
                            <Image
                              src={img}
                              alt={fav.product.name}
                              fill
                              sizes="(max-width: 640px) 50vw, 200px"
                              className="object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className="aspect-square bg-bg-tertiary flex items-center justify-center">
                            <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                            </svg>
                          </div>
                        )}
                        <div className="p-2.5">
                          <p className="text-xs font-body font-medium text-text-primary truncate">{fav.product.name}</p>
                          {primaryColor && (
                            <p className="text-xs font-body text-text-secondary mt-0.5">
                              {Number(primaryColor.unitPrice).toFixed(2)} {"€"}
                            </p>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            <MyReviewCard hasEligibleOrder={hasEligibleReviewOrder} initialReview={initialReview} />
          </div>

          {/* Avoirs */}
          {(credits.length > 0 || ordersWithCreditNote.length > 0) && (
            <div id="avoirs" className="rounded-2xl border border-border bg-bg-primary overflow-hidden scroll-mt-24">
              <div className="px-5 sm:px-6 py-4 border-b border-border-light flex items-center justify-between">
                <h2 className="font-heading text-base font-semibold text-text-primary">{tOrders("creditNote")}</h2>
                {availableCredit > 0 && (
                  <span className="font-heading text-sm font-bold text-success">
                    {availableCredit.toFixed(2)} {"€"}
                  </span>
                )}
              </div>
              <div className="divide-y divide-border-light">
                {ordersWithCreditNote.map((o) => (
                  <div key={o.id} className="px-5 sm:px-6 py-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-body text-sm font-medium text-text-primary">
                        {tOrders("creditNote")} — {o.orderNumber}
                      </p>
                      <p className="text-xs text-text-muted font-body mt-1">
                        {new Date(o.createdAt).toLocaleDateString(dateLocale, { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <a
                      href={`/api/client/commandes/${o.id}/credit-note`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg-dark hover:bg-primary-hover text-text-inverse text-xs font-body font-medium rounded-lg transition-colors shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
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
                    <div key={credit.id} className="px-5 sm:px-6 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-sm font-medium text-text-primary">
                            {total.toFixed(2)} {"€"}
                            <span className="text-text-muted font-normal"> — {tOrders("remaining")} : {remaining.toFixed(2)} {"€"}</span>
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`badge ${remaining > 0 && !isExpired ? "badge-success" : "badge-neutral"}`}>
                            {isExpired ? tOrders("expired") : remaining > 0 ? tOrders("active") : tOrders("used")}
                          </span>
                          {credit.expiresAt && (
                            <p className="text-[10px] text-text-muted font-body mt-1">
                              {tOrders("expiresOn")} {new Date(credit.expiresAt).toLocaleDateString(dateLocale)}
                            </p>
                          )}
                        </div>
                      </div>
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

          {/* Compte + newsletter (ancre) */}
          <div id="compte" className="space-y-6 scroll-mt-24">
            <AccountEditor
              user={{
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                company: user.company,
                phone: user.phone,
                siret: user.siret,
                vatNumber: user.vatNumber,
                addressStreet: user.addressStreet,
                addressComplement: user.addressComplement,
                addressZip: user.addressZip,
                addressCity: user.addressCity,
                addressCountry: user.addressCountry,
              }}
            />
            <NewsletterToggle acceptsNewsletter={user.acceptsNewsletter} />
          </div>

        </main>
      </div>
    </div>
  );
}
