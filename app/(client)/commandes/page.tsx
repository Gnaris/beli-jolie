import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import CancelOrderButton from "@/components/client/CancelOrderButton";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: `Mes commandes — ${shopName}`,
    robots: { index: false, follow: false },
  };
}

export const STATUS_CONFIG: Record<string, { badgeClass: string }> = {
  PENDING:    { badgeClass: "badge badge-warning" },
  PROCESSING: { badgeClass: "badge badge-info" },
  SHIPPED:    { badgeClass: "badge badge-purple" },
  DELIVERED:  { badgeClass: "badge badge-success" },
  CANCELLED:  { badgeClass: "badge badge-neutral" },
};

export function getTrackingUrl(carrierName: string, trackingId: string): string | null {
  const n = carrierName.toLowerCase();
  if (n.includes("colissimo"))                         return `https://www.laposte.fr/outils/suivre-vos-envois?code=${trackingId}`;
  if (n.includes("chronopost"))                        return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${trackingId}`;
  if (n.includes("mondial relay") || n.includes("mondialrelay")) return `https://www.mondialrelay.fr/suivi-de-colis/?NumExpedition=${trackingId}`;
  if (n.includes("dhl"))                               return `https://www.dhl.com/fr-fr/home/tracking.html?tracking-id=${trackingId}`;
  if (n.includes("ups"))                               return `https://www.ups.com/track?loc=fr_FR&tracknum=${trackingId}`;
  if (n.includes("fedex") || n.includes("tnt"))        return `https://www.fedex.com/fedextrack/?trknbr=${trackingId}`;
  if (n.includes("gls"))                               return `https://gls-group.com/FR/fr/suivi-colis.html?match=${trackingId}`;
  if (n.includes("dpd"))                               return `https://www.dpd.fr/trace/${trackingId}`;
  return null;
}

interface CommandesPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function CommandesPage({ searchParams }: CommandesPageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion?callbackUrl=/commandes");

  const t = await getTranslations("orders");
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const PAGE_SIZE = 20;

  const [orders, totalCount] = await Promise.all([
    prisma.order.findMany({
      where: { userId: session.user.id },
      include: {
        items: {
          select: {
            productName: true,
            colorName: true,
            quantity: true,
            saleType: true,
            packQty: true,
            size: true,
            sizesJson: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.order.count({ where: { userId: session.user.id } }),
  ]);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-4 md:p-6 lg:p-10 w-full relative overflow-hidden">
      {/* En-tete */}
      <div className="mb-6">
        <h1 className="font-heading text-xl font-semibold text-text-primary">
          {t("title")}
        </h1>
        <p className="text-sm text-text-secondary font-body mt-0.5">
          {totalCount !== 1 ? t("count_plural", { count: totalCount }) : t("count", { count: totalCount })}
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="bg-bg-primary border border-border rounded-xl p-10 text-center">
          <svg className="w-10 h-10 text-text-muted mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
          </svg>
          <p className="text-sm font-body font-medium text-text-secondary mb-1">
            {t("empty")}
          </p>
          <p className="text-xs font-body text-text-muted mb-5">
            {t("emptyDesc")}
          </p>
          <Link href="/produits" className="inline-flex items-center justify-center px-5 py-2.5 bg-bg-dark text-text-inverse text-sm font-body font-medium rounded-lg hover:bg-primary-hover transition-colors">
            {t("browseCatalogue")}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const cfg        = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.PENDING;
            const date       = new Date(order.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
            const totalItems = order.items.reduce((s, i) => s + i.quantity, 0);
            const trackingUrl = order.eeTrackingId ? getTrackingUrl(order.carrierName, order.eeTrackingId) : null;

            return (
              <div key={order.id} className="bg-bg-primary border border-border rounded-xl overflow-hidden transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] hover:border-accent/20">
                {/* En-tete commande */}
                <div className="px-4 sm:px-5 py-3.5 border-b border-border flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    <span className="font-heading text-sm font-semibold text-text-primary">
                      {order.orderNumber}
                    </span>
                    <span className={`${cfg.badgeClass} text-xs`}>
                      {t(`statuses.${order.status}`)}
                    </span>
                  </div>
                  <span className="text-xs font-body text-text-muted">{date}</span>
                </div>

                {/* Corps */}
                <div className="px-4 sm:px-5 py-4">
                  {/* Resume articles */}
                  <p className="text-sm font-body text-text-secondary mb-3">
                    {totalItems} {totalItems !== 1 ? t("items_plural") : t("items")} —{" "}
                    {order.items.slice(0, 2).map((item, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        {item.productName}
                        {item.saleType === "PACK" && ` x${item.packQty}`}
                        {(() => {
                          if (item.sizesJson) {
                            try {
                              const sizes: { name: string; quantity: number }[] = JSON.parse(item.sizesJson);
                              if (sizes.length > 0) return ` (${sizes.map(s => `${s.name}×${s.quantity}`).join(", ")})`;
                            } catch { /* ignore */ }
                          }
                          if (item.size) return ` (${t("sizeOption", { size: item.size })})`;
                          return null;
                        })()}
                      </span>
                    ))}
                    {order.items.length > 2 && (
                      <span className="text-text-muted"> +{order.items.length - 2} {order.items.length - 2 > 1 ? t("other_plural") : t("other")}</span>
                    )}
                  </p>

                  {/* Livraison + totaux */}
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="text-xs font-body text-text-muted space-y-0.5">
                      <p>
                        <span className="font-medium text-text-secondary">{t("shippingLabel")}</span>{" "}
                        {order.carrierName}
                        {Number(order.carrierPrice) === 0 ? ` — ${t("free")}` : ` — ${Number(order.carrierPrice).toFixed(2)} \u20AC`}
                      </p>
                      <p>
                        <span className="font-medium text-text-secondary">{t("deliveryTo")}</span>{" "}
                        {order.shipCity} ({order.shipCountry})
                      </p>
                      {order.eeTrackingId && (
                        <p className="flex items-center gap-1.5">
                          <span className="font-medium text-text-secondary">{t("trackingLabel")}</span>
                          {trackingUrl ? (
                            <a href={trackingUrl} target="_blank" rel="noopener noreferrer"
                              className="font-mono text-text-primary hover:underline">
                              {order.eeTrackingId}
                            </a>
                          ) : (
                            <span className="font-mono">{order.eeTrackingId}</span>
                          )}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <p className="text-xs font-body text-text-muted">{t("totalTTC")}</p>
                      <p className="font-heading text-lg font-semibold text-text-primary">
                        {Number(order.totalTTC).toFixed(2)} {"\u20AC"}
                      </p>
                      {order.tvaRate === 0 && (
                        <p className="text-[10px] font-body text-text-muted">{t("tvaExempt")}</p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border">
                    <Link href={`/commandes/${order.id}`}
                      className="flex items-center gap-1.5 text-xs font-body text-text-secondary hover:text-accent hover:border-accent transition-all duration-200 border border-border rounded-lg px-3 py-2 min-h-[44px]">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {t("details")}
                    </Link>

                    {order.status === "PENDING" && (
                      <CancelOrderButton orderId={order.id} orderNumber={order.orderNumber} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {page > 1 && (
            <Link
              href={`/commandes?page=${page - 1}`}
              className="px-4 py-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-body text-text-secondary border border-border rounded-lg hover:bg-bg-secondary transition-colors"
            >
              &larr;
            </Link>
          )}
          <span className="text-sm font-body text-text-muted">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/commandes?page=${page + 1}`}
              className="px-4 py-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-body text-text-secondary border border-border rounded-lg hover:bg-bg-secondary transition-colors"
            >
              &rarr;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
