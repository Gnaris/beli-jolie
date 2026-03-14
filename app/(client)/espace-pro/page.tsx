import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Tableau de bord — Beli & Jolie",
  robots: { index: false, follow: false },
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "En attente",
  PROCESSING: "En préparation",
  SHIPPED: "Expédiée",
  DELIVERED: "Livrée",
  CANCELLED: "Annulée",
};

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  PENDING:    { bg: "bg-amber-50",   text: "text-amber-700",  dot: "bg-amber-400"  },
  PROCESSING: { bg: "bg-blue-50",    text: "text-blue-700",   dot: "bg-blue-500"   },
  SHIPPED:    { bg: "bg-purple-50",  text: "text-purple-700", dot: "bg-purple-500" },
  DELIVERED:  { bg: "bg-green-50",   text: "text-green-700",  dot: "bg-green-500"  },
  CANCELLED:  { bg: "bg-[#F5F5F5]", text: "text-[#999999]",  dot: "bg-[#CCCCCC]" },
};

/* ── Mini bar chart (SVG) ─────────────────── */
function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1.5 h-24">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-[#C2516A] rounded-t-sm transition-all"
            style={{ height: `${Math.round((d.value / max) * 80)}px`, minHeight: d.value > 0 ? "4px" : "0" }}
          />
          <span className="text-[9px] font-[family-name:var(--font-roboto)] text-[#999999] leading-none">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Stat card ────────────────────────────── */
function StatCard({
  label, value, sub, icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-lg p-5 flex items-start gap-4">
      <div className="w-10 h-10 rounded-lg bg-[#F5F5F5] flex items-center justify-center text-[#C2516A] shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-[family-name:var(--font-roboto)] text-[#999999] uppercase tracking-wider">
          {label}
        </p>
        <p className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#1A1A1A] mt-0.5">
          {value}
        </p>
        {sub && (
          <p className="text-xs font-[family-name:var(--font-roboto)] text-[#999999] mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion");

  const userId = session.user.id;

  const [user, orders, favorites, cart] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.order.findMany({
      where: { userId },
      include: {
        items: { select: { quantity: true, lineTotal: true, productName: true, colorName: true, imagePath: true, saleType: true, packQty: true, size: true } },
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
              where: { isPrimary: true },
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

  /* ── Stats ── */
  const totalOrders = orders.length;
  const totalSpent = orders.reduce((s, o) => s + o.totalTTC, 0);
  const totalItemsOrdered = orders.reduce(
    (s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0),
    0
  );
  const cartItemCount = cart?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;

  /* ── Produits commandés les plus fréquents ── */
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

  /* ── Commandes par mois (6 derniers mois) ── */
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

  /* ── Commandes récentes ── */
  const recentOrders = orders.slice(0, 5);

  const formattedDate = new Date(user.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">

      {/* En-tête */}
      <div>
        <h1 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#1A1A1A]">
          Bonjour, {user.firstName}
        </h1>
        <p className="text-sm text-[#999999] font-[family-name:var(--font-roboto)] mt-0.5">
          {user.company} — Membre depuis le {formattedDate}
        </p>
      </div>

      {/* Bandeau statut si pas APPROVED */}
      {user.status !== "APPROVED" && (
        <div className={`${user.status === "PENDING" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-red-50 border-red-200 text-red-700"} border rounded-lg p-4 flex items-start gap-3`}>
          <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${user.status === "PENDING" ? "bg-amber-400" : "bg-red-500"}`} />
          <div>
            <p className="text-sm font-[family-name:var(--font-roboto)] font-semibold">
              {user.status === "PENDING" ? "En attente de validation" : "Demande refusée"}
            </p>
            <p className="text-sm font-[family-name:var(--font-roboto)] opacity-80 mt-0.5">
              {user.status === "PENDING"
                ? "Votre dossier est en cours d'examen. Vous recevrez une confirmation sous 48h ouvrées."
                : "Votre demande n'a pas été acceptée. Contactez-nous pour plus d'informations."}
            </p>
          </div>
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Commandes"
          value={totalOrders}
          sub="au total"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
            </svg>
          }
        />
        <StatCard
          label="Articles commandés"
          value={totalItemsOrdered}
          sub="pièces au total"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
            </svg>
          }
        />
        <StatCard
          label="Total dépensé"
          value={`${totalSpent.toFixed(2)} €`}
          sub="TTC, livraison incluse"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          }
        />
        <StatCard
          label="Panier"
          value={cartItemCount}
          sub={cartItemCount > 0 ? "articles en attente" : "panier vide"}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
          }
        />
      </div>

      {/* ── Graphiques + Top produits ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Graphique commandes par mois */}
        <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
              Commandes (6 derniers mois)
            </h2>
            <Link href="/commandes" className="text-xs font-[family-name:var(--font-roboto)] text-[#C2516A] hover:underline">
              Voir tout
            </Link>
          </div>
          <BarChart data={monthlyData} />
        </div>

        {/* Top produits commandés */}
        <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
              Produits les plus commandés
            </h2>
            <Link href="/commandes" className="text-xs font-[family-name:var(--font-roboto)] text-[#C2516A] hover:underline">
              Voir tout
            </Link>
          </div>
          {topProducts.length === 0 ? (
            <p className="text-sm font-[family-name:var(--font-roboto)] text-[#999999] py-6 text-center">
              Aucune commande pour le moment
            </p>
          ) : (
            <div className="space-y-2">
              {topProducts.map((p, i) => {
                const pct = Math.round((p.count / topProducts[0].count) * 100);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs font-[family-name:var(--font-roboto)] text-[#999999] w-4 shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] truncate">
                        {p.name}
                      </p>
                      <div className="h-1 bg-[#F5F5F5] rounded-full mt-1">
                        <div
                          className="h-1 bg-[#C2516A] rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#1A1A1A] shrink-0">
                      ×{p.count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Commandes récentes ── */}
      <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E5E5E5] flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
            Commandes récentes
          </h2>
          <Link href="/commandes" className="text-xs font-[family-name:var(--font-roboto)] text-[#C2516A] hover:underline">
            Voir toutes les commandes
          </Link>
        </div>
        {recentOrders.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-[family-name:var(--font-roboto)] text-[#999999]">
              Aucune commande pour le moment
            </p>
            <Link href="/produits" className="btn-primary inline-flex mt-4 justify-center text-xs">
              Voir le catalogue
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-[#F5F5F5]">
            {recentOrders.map((order) => {
              const cfg = STATUS_COLORS[order.status] ?? STATUS_COLORS.PENDING;
              const date = new Date(order.createdAt).toLocaleDateString("fr-FR", {
                day: "numeric", month: "short", year: "numeric",
              });
              const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
              return (
                <div key={order.id} className="px-5 py-3.5 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
                        {order.orderNumber}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-[family-name:var(--font-roboto)] font-medium ${cfg.bg} ${cfg.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {STATUS_LABEL[order.status]}
                      </span>
                    </div>
                    <p className="text-xs font-[family-name:var(--font-roboto)] text-[#999999] mt-0.5">
                      {date} — {totalQty} article{totalQty > 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
                      {order.totalTTC.toFixed(2)} €
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Favoris récents ── */}
      <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E5E5E5] flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
            Favoris
          </h2>
          <Link href="/favoris" className="text-xs font-[family-name:var(--font-roboto)] text-[#C2516A] hover:underline">
            Voir tous les favoris
          </Link>
        </div>
        {favorites.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-[family-name:var(--font-roboto)] text-[#999999]">
              Aucun produit en favori
            </p>
            <Link href="/produits" className="btn-primary inline-flex mt-4 justify-center text-xs">
              Découvrir le catalogue
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#F5F5F5]">
            {favorites.map((fav) => {
              const primaryColor = fav.product.colors[0];
              const img = primaryColor?.images[0]?.path;
              return (
                <Link
                  key={fav.id}
                  href={`/produits/${fav.product.id}`}
                  className="p-4 hover:bg-[#FAFAFA] transition-colors group"
                >
                  {img ? (
                    <div className="aspect-square bg-[#F5F5F5] rounded-md overflow-hidden mb-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img}
                        alt={fav.product.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                  ) : (
                    <div className="aspect-square bg-[#F5F5F5] rounded-md mb-2 flex items-center justify-center">
                      <svg className="w-6 h-6 text-[#CCCCCC]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                      </svg>
                    </div>
                  )}
                  <p className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] truncate">
                    {fav.product.name}
                  </p>
                  {primaryColor && (
                    <p className="text-xs font-[family-name:var(--font-roboto)] text-[#C2516A] mt-0.5">
                      {primaryColor.unitPrice.toFixed(2)} €
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Informations compte ── */}
      <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E5E5E5]">
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
            Mon compte
          </h2>
        </div>
        <div className="divide-y divide-[#F5F5F5]">
          {[
            { label: "Société", value: user.company },
            { label: "Email", value: user.email },
            { label: "Téléphone", value: user.phone },
            { label: "SIRET", value: user.siret, mono: true },
            ...(user.vatNumber ? [{ label: "N° TVA", value: user.vatNumber, mono: true }] : []),
          ].map(({ label, value, mono }) => (
            <div key={label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 px-5 py-3">
              <span className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#999999] uppercase tracking-wider w-24 shrink-0">
                {label}
              </span>
              <span className={`text-sm text-[#1A1A1A] ${mono ? "font-mono" : "font-[family-name:var(--font-roboto)]"}`}>
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
