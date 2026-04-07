import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import OrderItemImage from "@/components/ui/OrderItemImage";
import ClientOrderItemsList from "@/components/client/orders/OrderItemsList";
import OrderModifications from "@/components/client/orders/OrderModifications";
import CancelOrderButton from "@/components/client/CancelOrderButton";
import ReorderButton from "@/components/client/orders/ReorderButton";
import SuccessToast from "@/components/client/SuccessToast";
import { STATUS_CONFIG, getTrackingUrl } from "@/app/(client)/commandes/page";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: `Detail commande — ${shopName}`,
    robots: { index: false, follow: false },
  };
}

export default async function CommandeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  void searchParams;
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion?callbackUrl=/commandes");

  const t = await getTranslations("orders");

  const order = await prisma.order.findFirst({
    where: { id, userId: session.user.id },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      itemModifications: true,
    },
  });

  if (!order) notFound();

  const cfg         = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.PENDING;
  const trackingUrl = order.eeTrackingId ? getTrackingUrl(order.carrierName, order.eeTrackingId) : null;
  const date        = new Date(order.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });

  // Etapes de suivi
  const steps: { status: string; label: string; done: boolean }[] = [
    { status: "PENDING",    label: t("statusReceived"),       done: true },
    { status: "PROCESSING", label: t("statuses.PROCESSING"),  done: ["PROCESSING", "SHIPPED", "DELIVERED"].includes(order.status) },
    { status: "SHIPPED",    label: t("statuses.SHIPPED"),     done: ["SHIPPED", "DELIVERED"].includes(order.status) },
    { status: "DELIVERED",  label: t("statuses.DELIVERED"),   done: order.status === "DELIVERED" },
  ];
  const isCancelled = order.status === "CANCELLED";

  return (
    <div className="p-4 md:p-6 lg:p-10 w-full space-y-6 relative overflow-hidden">
      <Suspense fallback={null}><SuccessToast /></Suspense>

      {/* Fil d'Ariane */}
      <div className="flex items-center gap-2 text-sm font-body text-text-muted">
        <Link href="/commandes" className="hover:text-text-primary transition-colors">{t("title")}</Link>
        <span>/</span>
        <span className="text-text-primary font-medium">{order.orderNumber}</span>
      </div>

      {/* En-tete */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold text-text-primary">
            {order.orderNumber}
          </h1>
          <p className="text-sm text-text-secondary font-body mt-0.5">{date}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`${cfg.badgeClass} text-xs`}>
            {t(`statuses.${order.status}`)}
          </span>
          {order.status === "PENDING" && (
            <CancelOrderButton orderId={order.id} orderNumber={order.orderNumber} />
          )}
          <ReorderButton orderId={order.id} />
          {order.status !== "CANCELLED" && (
            <Link
              href={`/espace-pro/reclamations/nouveau?order=${order.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-body font-medium text-text-secondary border border-border rounded-lg hover:bg-bg-secondary transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              {t("createClaim")}
            </Link>
          )}
        </div>
      </div>

      {/* -- Suivi -- */}
      {!isCancelled && (
        <div className="bg-bg-primary border border-border rounded-xl p-5">
          <h2 className="font-heading text-sm font-semibold text-text-primary mb-4">
            {t("orderProgress")}
          </h2>
          <div className="relative">
            {/* Barre de progression */}
            <div className="absolute top-3.5 left-3.5 right-3.5 h-0.5 bg-[#E5E5E5]" />
            <div
              className="absolute top-3.5 left-3.5 h-0.5 bg-bg-dark transition-all duration-500"
              style={{ width: `${(steps.filter((s) => s.done).length - 1) / (steps.length - 1) * 100}%` }}
            />
            <div className="relative flex justify-between">
              {steps.map((step) => (
                <div key={step.status} className="flex flex-col items-center gap-2">
                  <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center z-10 transition-colors ${
                    step.done
                      ? "bg-bg-dark border-bg-dark text-text-inverse"
                      : "bg-bg-primary border-border text-[#E5E5E5]"
                  }`}>
                    {step.done ? (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-[#E5E5E5]" />
                    )}
                  </div>
                  <span className={`text-[10px] font-body text-center max-w-16 ${
                    step.done ? "text-text-primary font-medium" : "text-text-muted"
                  }`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Numero de suivi */}
          {order.eeTrackingId && (
            <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-center gap-3">
              <div>
                <p className="text-xs font-body text-text-muted">{t("trackingNumber")}</p>
                <p className="font-mono text-sm font-medium text-text-primary mt-0.5">{order.eeTrackingId}</p>
              </div>
              {trackingUrl && (
                <a
                  href={trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 bg-bg-dark hover:bg-primary-hover text-text-inverse text-xs font-body font-medium rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  {t("trackOn", { carrier: order.carrierName })}
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* -- Livraison + Facturation -- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-bg-primary border border-border rounded-xl p-5">
          <h2 className="font-heading text-sm font-semibold text-text-primary mb-3">
            {t("deliveryAddress")}
          </h2>
          <div className="text-sm font-body space-y-2">
            {order.shipCompany && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("companyLabel")}</p>
                <p className="text-text-primary">{order.shipCompany}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("firstNameLabel")}</p>
                <p className="text-text-primary">{order.shipFirstName}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("lastNameLabel")}</p>
                <p className="text-text-primary">{order.shipLastName}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("addressLabel2")}</p>
              <p className="text-text-primary">{order.shipAddress1}</p>
              {order.shipAddress2 && <p className="text-text-primary">{order.shipAddress2}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("zipCodeLabel")}</p>
                <p className="text-text-primary">{order.shipZipCode}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("cityLabel")}</p>
                <p className="text-text-primary">{order.shipCity}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("countryLabel")}</p>
              <p className="text-text-primary">{order.shipCountry}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("emailLabel")}</p>
                <p className="text-text-primary">{order.clientEmail}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("phoneLabel")}</p>
                <p className="text-text-primary">{order.clientPhone}</p>
              </div>
            </div>
            {order.clientVatNumber && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("vatNumberLabel")}</p>
                <p className="text-text-primary font-mono text-xs">{order.clientVatNumber}</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-bg-primary border border-border rounded-xl p-5">
          <h2 className="font-heading text-sm font-semibold text-text-primary mb-3">
            {t("billingInfo")}
          </h2>
          <div className="text-sm font-body space-y-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("companyLabel")}</p>
              <p className="text-text-primary">{order.clientCompany}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("firstNameLabel")}</p>
                <p className="text-text-primary">{order.shipFirstName}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("lastNameLabel")}</p>
                <p className="text-text-primary">{order.shipLastName}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("addressLabel2")}</p>
              <p className="text-text-primary">{order.shipAddress1}</p>
              {order.shipAddress2 && <p className="text-text-primary">{order.shipAddress2}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("zipCodeLabel")}</p>
                <p className="text-text-primary">{order.shipZipCode}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("cityLabel")}</p>
                <p className="text-text-primary">{order.shipCity}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("countryLabel")}</p>
              <p className="text-text-primary">{order.shipCountry}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("emailLabel")}</p>
                <p className="text-text-primary">{order.clientEmail}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("phoneLabel")}</p>
                <p className="text-text-primary">{order.clientPhone}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("siretLabel")}</p>
              <p className="text-text-primary font-mono text-xs">{order.clientSiret}</p>
            </div>
            {order.clientVatNumber && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{t("vatNumberLabel")}</p>
                <p className="text-text-primary font-mono text-xs">{order.clientVatNumber}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* -- Bon de commande -- */}
      <div className="bg-bg-primary border border-border rounded-xl p-5">
        <h2 className="font-heading text-sm font-semibold text-text-primary mb-1">
          {t("orderForm")}
        </h2>
        <p className="text-xs text-text-muted font-body mb-4">
          {t("orderFormDesc")}
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href={`/api/client/commandes/${order.id}/pdf`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-bg-dark hover:bg-primary-hover text-text-inverse text-sm font-body font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {t("downloadOrderWithPrices")}
          </a>
          <a
            href={`/api/client/commandes/${order.id}/pdf?noPrices=1`}
            className="inline-flex items-center gap-2 px-4 py-2 border border-border text-text-primary text-sm font-body font-medium rounded-lg hover:bg-bg-secondary transition-colors"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {t("downloadOrderNoPrices")}
          </a>
        </div>
      </div>

      {/* -- Facture + Avoir -- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Facture */}
        <div className="bg-bg-primary border border-border rounded-xl p-5 flex flex-col justify-between gap-4">
          <div>
            <h2 className="font-heading text-sm font-semibold text-text-primary">
              {t("invoice")}
            </h2>
            {order.invoicePath ? (
              <p className="text-xs text-text-muted font-body mt-0.5">
                {t("invoiceAvailable")}
              </p>
            ) : (
              <p className="text-xs text-text-muted font-body mt-2">
                {t("invoiceUnavailable")}
              </p>
            )}
          </div>
          {order.invoicePath && (
            <a
              href={`/api/client/commandes/${order.id}/invoice`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-bg-dark hover:bg-primary-hover text-text-inverse text-sm font-body font-medium rounded-lg transition-colors self-start"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {t("downloadInvoice")}
            </a>
          )}
        </div>

        {/* Avoir */}
        <div className="bg-bg-primary border border-border rounded-xl p-5 flex flex-col justify-between gap-4">
          <div>
            <h2 className="font-heading text-sm font-semibold text-text-primary">
              {t("creditNote")}
            </h2>
            {order.creditNotePath ? (
              <p className="text-xs text-text-muted font-body mt-0.5">
                {t("creditNoteAvailable")}
              </p>
            ) : (
              <p className="text-xs text-text-muted font-body mt-2">
                {t("noCreditNote")}
              </p>
            )}
          </div>
          {order.creditNotePath && (
            <a
              href={`/api/client/commandes/${order.id}/credit-note`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-bg-dark hover:bg-primary-hover text-text-inverse text-sm font-body font-medium rounded-lg transition-colors self-start"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {t("downloadCreditNote")}
            </a>
          )}
        </div>
      </div>

      {/* -- Articles Modifiés (si modifications) -- */}
      {order.itemModifications.length > 0 && (
        <OrderModifications
          modifications={order.itemModifications.map((mod) => {
            const item = order.items.find((i) => i.id === mod.orderItemId);
            return {
              orderItemId: mod.orderItemId,
              originalQuantity: mod.originalQuantity,
              newQuantity: mod.newQuantity,
              reason: mod.reason as "OUT_OF_STOCK" | "CLIENT_REQUEST",
              priceDifference: Number(mod.priceDifference),
              productName: item?.productName ?? "",
              productRef: item?.productRef ?? "",
              colorName: item?.colorName ?? "",
              imagePath: item?.imagePath ?? null,
              unitPrice: Number(item?.unitPrice ?? 0),
            };
          })}
        />
      )}

      {/* -- Articles -- */}
      <div className="bg-bg-primary border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border">
          <h2 className="font-heading text-sm font-semibold text-text-primary">
            {t("articleList")} ({order.items.reduce((s, i) => s + i.quantity, 0)})
          </h2>
        </div>
        <ClientOrderItemsList items={order.items.map((item) => {
          const mod = order.itemModifications.find((m) => m.orderItemId === item.id);
          return {
            ...item,
            unitPrice: Number(item.unitPrice),
            lineTotal: Number(item.lineTotal),
            modification: mod ? {
              originalQuantity: mod.originalQuantity,
              newQuantity: mod.newQuantity,
              reason: mod.reason,
            } : null,
          };
        })} />

        {/* Totaux */}
        <div className="px-5 py-4 bg-bg-secondary border-t border-border space-y-1.5">
          <div className="flex justify-between text-sm font-body text-text-secondary">
            <span>{t("subtotalHT")}</span>
            <span>{Number(order.subtotalHT).toFixed(2)} {"\u20AC"}</span>
          </div>
          <div className="flex justify-between text-sm font-body text-text-secondary">
            <span>{t("shippingCost")} ({order.carrierName})</span>
            <span>{Number(order.carrierPrice) === 0 ? t("free") : `${Number(order.carrierPrice).toFixed(2)} \u20AC`}</span>
          </div>
          <div className="flex justify-between text-sm font-body text-text-secondary">
            <span>{t("tva")} ({(order.tvaRate * 100).toFixed(0)} %)</span>
            <span>{Number(order.tvaAmount).toFixed(2)} {"\u20AC"}</span>
          </div>
          {order.tvaRate === 0 && (
            <p className="text-[10px] text-text-muted font-body">
              {t("tvaExemptDetail")}
            </p>
          )}
          <div className="flex justify-between font-heading font-semibold text-base text-text-primary pt-2 border-t border-border">
            <span>{t("totalTTC")}</span>
            <span>{Number(order.totalTTC).toFixed(2)} {"\u20AC"}</span>
          </div>
        </div>
      </div>

      {/* Retour */}
      <Link href="/commandes" className="inline-flex items-center gap-1.5 text-sm font-body text-text-secondary hover:text-text-primary transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        {t("backToOrders")}
      </Link>
    </div>
  );
}
