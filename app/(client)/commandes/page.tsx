import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CancelOrderButton from "@/components/client/CancelOrderButton";

export const metadata: Metadata = {
  title: "Mes commandes — Beli & Jolie",
  robots: { index: false, follow: false },
};

export const STATUS_CONFIG: Record<
  string,
  { label: string; bgClass: string; textClass: string; dot: string }
> = {
  PENDING: {
    label: "En attente",
    bgClass: "bg-amber-50",
    textClass: "text-amber-700",
    dot: "bg-amber-400",
  },
  PROCESSING: {
    label: "En préparation",
    bgClass: "bg-blue-50",
    textClass: "text-blue-700",
    dot: "bg-blue-500",
  },
  SHIPPED: {
    label: "Expédiée",
    bgClass: "bg-purple-50",
    textClass: "text-purple-700",
    dot: "bg-purple-500",
  },
  DELIVERED: {
    label: "Livrée",
    bgClass: "bg-green-50",
    textClass: "text-green-700",
    dot: "bg-green-500",
  },
  CANCELLED: {
    label: "Annulée",
    bgClass: "bg-[#F5F5F5]",
    textClass: "text-[#999999]",
    dot: "bg-[#CCCCCC]",
  },
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

export default async function CommandesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion?callbackUrl=/commandes");

  const orders = await prisma.order.findMany({
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
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      {/* En-tête */}
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#1A1A1A]">
          Mes commandes
        </h1>
        <p className="text-sm text-[#999999] font-[family-name:var(--font-roboto)] mt-0.5">
          {orders.length} commande{orders.length !== 1 ? "s" : ""}
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="bg-white border border-[#E5E5E5] rounded-lg p-10 text-center">
          <svg className="w-10 h-10 text-[#CCCCCC] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
          </svg>
          <p className="text-sm font-[family-name:var(--font-roboto)] font-medium text-[#555555] mb-1">
            Aucune commande pour le moment
          </p>
          <p className="text-xs font-[family-name:var(--font-roboto)] text-[#999999] mb-5">
            Vos commandes apparaîtront ici après validation.
          </p>
          <Link href="/produits" className="btn-primary justify-center">
            Voir le catalogue
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
              <div key={order.id} className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
                {/* En-tête commande */}
                <div className="px-5 py-3.5 border-b border-[#F5F5F5] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
                      {order.orderNumber}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-[family-name:var(--font-roboto)] font-medium ${cfg.bgClass} ${cfg.textClass}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                    </span>
                  </div>
                  <span className="text-xs font-[family-name:var(--font-roboto)] text-[#999999]">{date}</span>
                </div>

                {/* Corps */}
                <div className="px-5 py-4">
                  {/* Résumé articles */}
                  <p className="text-sm font-[family-name:var(--font-roboto)] text-[#555555] mb-3">
                    {totalItems} article{totalItems !== 1 ? "s" : ""} —{" "}
                    {order.items.slice(0, 2).map((item, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        {item.productName}
                        {item.saleType === "PACK" && ` ×${item.packQty}`}
                        {item.size && ` (T.${item.size})`}
                      </span>
                    ))}
                    {order.items.length > 2 && (
                      <span className="text-[#999999]"> +{order.items.length - 2} autre{order.items.length - 2 > 1 ? "s" : ""}</span>
                    )}
                  </p>

                  {/* Livraison + totaux */}
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="text-xs font-[family-name:var(--font-roboto)] text-[#999999] space-y-0.5">
                      <p>
                        <span className="font-medium text-[#555555]">Livraison :</span>{" "}
                        {order.carrierName}
                        {order.carrierPrice === 0 ? " — Gratuit" : ` — ${order.carrierPrice.toFixed(2)} €`}
                      </p>
                      <p>
                        <span className="font-medium text-[#555555]">À :</span>{" "}
                        {order.shipCity} ({order.shipCountry})
                      </p>
                      {order.eeTrackingId && (
                        <p className="flex items-center gap-1.5">
                          <span className="font-medium text-[#555555]">Suivi :</span>
                          {trackingUrl ? (
                            <a href={trackingUrl} target="_blank" rel="noopener noreferrer"
                              className="font-mono text-[#C2516A] hover:underline">
                              {order.eeTrackingId}
                            </a>
                          ) : (
                            <span className="font-mono">{order.eeTrackingId}</span>
                          )}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <p className="text-xs font-[family-name:var(--font-roboto)] text-[#999999]">Total TTC</p>
                      <p className="font-[family-name:var(--font-poppins)] text-lg font-semibold text-[#1A1A1A]">
                        {order.totalTTC.toFixed(2)} €
                      </p>
                      {order.tvaRate === 0 && (
                        <p className="text-[10px] font-[family-name:var(--font-roboto)] text-[#999999]">TVA exonérée</p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 mt-4 pt-3 border-t border-[#F5F5F5]">
                    <Link href={`/commandes/${order.id}`}
                      className="flex items-center gap-1.5 text-xs font-[family-name:var(--font-roboto)] text-[#555555] hover:text-[#1A1A1A] transition-colors border border-[#E5E5E5] rounded px-3 py-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                      </svg>
                      Voir le détail
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
    </div>
  );
}
