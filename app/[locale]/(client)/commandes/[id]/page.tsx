import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import OrderColumnsView from "@/components/client/orders/OrderColumnsView";
import CancelOrderButton from "@/components/client/CancelOrderButton";
import ReorderButton from "@/components/client/orders/ReorderButton";
import SuccessToast from "@/components/client/SuccessToast";
import { STATUS_CONFIG, getTrackingUrl } from "@/app/[locale]/(client)/commandes/page";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { floorMoney } from "@/lib/order-totals";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tMeta] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
  ]);
  return {
    title: tMeta("orderDetailTitle", { shopName }),
    robots: { index: false, follow: false },
  };
}

// Mapping regex → logo SVG local (aligné avec CheckoutClient)
const CARRIER_LOGOS: Array<{ pattern: RegExp; path: string; bg?: string }> = [
  { pattern: /chronopost/i,     path: "/uploads/carriers/chronopost.svg" },
  { pattern: /colissimo/i,      path: "/uploads/carriers/colissimo.svg" },
  { pattern: /dhl/i,            path: "/uploads/carriers/dhl.svg", bg: "#FFCC00" },
  { pattern: /dpd/i,            path: "/uploads/carriers/dpd.svg" },
  { pattern: /\bgls\b/i,        path: "/uploads/carriers/gls.svg" },
  { pattern: /mondial.?relay/i, path: "/uploads/carriers/mondial-relay.svg" },
];

function getCarrierLogo(name: string | null | undefined): { path: string; bg?: string } | null {
  if (!name) return null;
  for (const entry of CARRIER_LOGOS) {
    if (entry.pattern.test(name)) return { path: entry.path, bg: entry.bg };
  }
  return null;
}

export default async function CommandeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id, locale } = await params;
  const sp = await searchParams;
  const justSucceeded = sp.success === "1";
  const session = await getServerSession(authOptions);
  if (!session) return redirect({ href: { pathname: "/connexion", query: { callbackUrl: "/commandes" } }, locale });

  const t = await getTranslations("orders");

  const order = await prisma.order.findFirst({
    where: { id, userId: session.user.id },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      itemModifications: true,
    },
  });

  if (!order) notFound();

  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.PENDING;
  const trackingUrl = order.eeTrackingId ? getTrackingUrl(order.carrierName, order.eeTrackingId) : null;
  const date = new Date(order.createdAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const dateShort = new Date(order.createdAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "short",
  });
  const timeShort = new Date(order.createdAt).toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Étapes de suivi
  const steps: { status: string; label: string; done: boolean; active: boolean }[] = [
    { status: "PENDING",   label: t("statusReceived"),     done: true, active: order.status === "PENDING" },
    { status: "VALIDATED", label: t("statuses.VALIDATED"), done: order.status === "VALIDATED" || order.status === "SHIPPED", active: order.status === "VALIDATED" },
    { status: "SHIPPED",   label: t("statuses.SHIPPED"),   done: order.status === "SHIPPED", active: order.status === "SHIPPED" },
  ];
  const isCancelled = order.status === "CANCELLED";
  const totalArticles = order.items.reduce((s, i) => s + i.quantity, 0);
  const carrierLogo = getCarrierLogo(order.carrierName);

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-6 lg:p-8 w-full space-y-6">
      <Suspense fallback={null}>
        <SuccessToast />
      </Suspense>

      {/* ───────── Fil d'Ariane ───────── */}
      <div className="flex items-center gap-2 text-sm font-body text-text-muted">
        <Link href="/commandes" className="hover:text-text-primary transition-colors">
          {t("title")}
        </Link>
        <span>/</span>
        <span className="text-text-primary font-medium">{order.orderNumber}</span>
      </div>

      {/* ───────── HERO SUCCESS (uniquement quand ?success=1 et pas annulée) ───────── */}
      {justSucceeded && !isCancelled && (
        <div className="bg-bg-primary border border-border rounded-2xl shadow-sm p-8 md:p-10 text-center">
          <div className="w-16 h-16 rounded-full bg-success flex items-center justify-center mx-auto mb-5" aria-hidden="true">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-success font-semibold mb-2">
            {t("orderConfirmedEyebrow")}
          </div>
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-text-primary mb-3">
            {t("thankYouMessage", { name: order.shipFirstName || session.user.name || "" })}
          </h1>
          <p className="text-sm text-text-secondary font-body leading-relaxed max-w-md mx-auto">
            {t("orderRegisteredWith")} <span className="font-mono font-semibold text-text-primary">{order.orderNumber}</span>
            <br />
            {t("confirmationSentTo")} <span className="text-text-primary">{order.clientEmail}</span>
          </p>
        </div>
      )}

      {/* ───────── En-tête classique (si pas success ou annulée) ───────── */}
      {!justSucceeded && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-heading text-xl font-semibold text-text-primary">{order.orderNumber}</h1>
              <span className={`${cfg.badgeClass} text-xs`}>{t(`statuses.${order.status}`)}</span>
            </div>
            <p className="text-sm text-text-secondary font-body mt-1">
              {date} · {totalArticles} article{totalArticles > 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
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
      )}

      {/* ───────── Timeline suivi (ardoise, aligné OrdersTableClient) ───────── */}
      {!isCancelled && (
        <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-5 md:p-6">
          <div className="text-[11px] uppercase tracking-widest text-text-muted mb-5 text-center font-semibold">
            {t("orderProgress")}
          </div>
          <div className="grid grid-cols-3 gap-4 relative">
            {/* Ligne de fond */}
            <div className="absolute top-4 left-[16.66%] right-[16.66%] h-0.5 bg-border" aria-hidden="true" />
            {/* Ligne remplie selon avancement */}
            <div
              className="absolute top-4 left-[16.66%] h-0.5 bg-text-secondary transition-all duration-500"
              style={{ width: `${Math.max(0, (steps.filter((s) => s.done).length - 1) / (steps.length - 1) * 66.66)}%` }}
              aria-hidden="true"
            />

            {steps.map((step, i) => {
              const state = step.active ? "active" : step.done ? "done" : "todo";
              const dotClass =
                state === "active"
                  ? "bg-bg-dark text-white shadow-[0_4px_12px_rgba(24,24,27,0.25)]"
                  : state === "done"
                    ? "bg-text-secondary text-white"
                    : "bg-bg-tertiary text-text-muted border border-dashed border-border-dark";
              return (
                <div key={step.status} className="text-center relative z-10">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-heading text-xs font-bold mx-auto mb-3 ${dotClass}`}>
                    {step.done && !step.active ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </div>
                  <div className={`text-sm font-heading font-semibold ${state === "active" ? "text-text-primary" : state === "done" ? "text-text-secondary" : "text-text-muted"}`}>
                    {step.label}
                  </div>
                  {step.active && (
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {step.status === "PENDING" ? `${dateShort} · ${timeShort}` : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Numéro de suivi transporteur (si expédiée) */}
          {order.eeTrackingId && (
            <div className="mt-6 pt-5 border-t border-border flex flex-wrap items-center gap-3 justify-between">
              <div className="flex items-center gap-3">
                <CarrierLogoBox name={order.carrierName} />
                <div>
                  <p className="text-xs font-body text-text-muted uppercase tracking-widest font-semibold">
                    {t("trackingNumber")}
                  </p>
                  <p className="font-mono text-sm font-medium text-text-primary mt-0.5">{order.eeTrackingId}</p>
                </div>
              </div>
              {trackingUrl && (
                <a
                  href={trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-bg-dark hover:bg-primary-hover text-text-inverse text-xs font-body font-medium rounded-lg transition-colors"
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
        </section>
      )}

      {/* ───────── 3 cards infos : Livraison + Paiement + Facture ───────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Livraison */}
        <div className="bg-bg-primary border border-border rounded-2xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V5a1 1 0 00-1-1H4a1 1 0 00-1 1v11a1 1 0 001 1h1m8 0h6m-6-8h4l3 5v3a1 1 0 01-1 1h-2" />
            </svg>
            <span className="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
              {t("deliveryLabel")}
            </span>
          </div>
          {order.carrierName && (
            <div className="flex items-center gap-2 mb-2">
              <CarrierLogoBox name={order.carrierName} size="sm" />
              <span className="text-sm font-heading font-semibold text-text-primary truncate">{order.carrierName}</span>
            </div>
          )}
          <p className="text-sm text-text-primary font-body font-medium mt-2">
            {order.shipCompany || `${order.shipFirstName} ${order.shipLastName}`}
          </p>
          <p className="text-xs text-text-secondary font-body leading-relaxed">
            {order.shipAddress1}
            {order.shipAddress2 ? `, ${order.shipAddress2}` : ""}
            <br />
            {order.shipZipCode} {order.shipCity}, {order.shipCountry}
          </p>
          {order.eeTrackingId ? (
            <div className="text-[11px] text-text-muted pt-3 mt-3 border-t border-border font-mono">
              {order.eeTrackingId}
            </div>
          ) : (
            <div className="text-[11px] text-text-muted pt-3 mt-3 border-t border-border">
              {t("trackingSoon")}
            </div>
          )}
        </div>

        {/* Paiement */}
        <div className="bg-bg-primary border border-border rounded-2xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
            <span className="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
              {t("paymentLabel")}
            </span>
          </div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-6 rounded bg-bg-dark flex items-center justify-center text-white text-[9px] font-heading font-bold italic" aria-hidden="true">
              CB
            </div>
            <span className="text-sm font-heading font-semibold text-text-primary">{t("paidByCard")}</span>
          </div>
          <p className="text-xs text-text-secondary font-body">{t("securedByStripe")}</p>
          <div className="pt-3 mt-3 border-t border-border flex items-baseline justify-between">
            <span className="text-xs text-text-muted">{t("amountPaid")}</span>
            <span className="font-heading text-lg font-bold text-text-primary tabular-nums">
              {(() => {
                const paid = order.paidSubtotalHT ? Number(order.paidSubtotalHT) : Number(order.subtotalHT);
                const paidTTC = floorMoney((paid + Number(order.carrierPrice)) * (1 + order.tvaRate));
                return `${paidTTC.toFixed(2)} €`;
              })()}
            </span>
          </div>
        </div>

        {/* Facture — état + téléchargement */}
        <div className={`bg-bg-primary border rounded-2xl shadow-sm p-5 ${order.invoicePath ? "border-border" : "border-l-4 border-l-text-primary border-y-border border-r-border"}`}>
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
              {t("invoice")}
            </span>
          </div>
          {order.invoicePath ? (
            <>
              <p className="text-sm text-text-primary font-body font-semibold mb-1">{t("invoiceReady")}</p>
              <p className="text-xs text-text-secondary font-body mb-3">{t("invoiceReadyDesc")}</p>
              <a
                href={`/api/client/commandes/${order.id}/invoice`}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-bg-dark hover:bg-primary-hover text-text-inverse text-xs font-body font-medium rounded-lg transition-colors"
              >
                <DocIcon /> {t("downloadInvoice")}
              </a>
            </>
          ) : (
            <>
              <p className="text-sm text-text-primary font-body font-semibold mb-1">{t("invoiceSoon")}</p>
              <p className="text-xs text-text-secondary font-body leading-relaxed">{t("invoiceSoonDesc")}</p>
            </>
          )}
        </div>
      </div>

      {/* ───────── Documents (tuiles) ───────── */}
      <section className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
            {t("documentsLabel")}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {/* Bon de commande */}
          <div className="p-5 space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-bg-tertiary border border-border flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-heading font-semibold text-text-primary">{t("orderForm")}</p>
                <p className="text-xs text-text-muted mt-0.5">{t("orderFormDesc")}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <a
                href={`/api/client/commandes/${order.id}/pdf`}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-bg-dark hover:bg-primary-hover text-text-inverse text-sm font-body font-medium rounded-lg transition-colors"
              >
                <DocIcon /> {t("downloadOrderWithPrices")}
              </a>
              <a
                href={`/api/client/commandes/${order.id}/pdf?noPrices=1`}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-border text-text-primary text-sm font-body font-medium rounded-lg hover:bg-bg-secondary transition-colors"
              >
                <DocIcon /> {t("downloadOrderNoPrices")}
              </a>
            </div>
          </div>

          {/* Facture */}
          <div className="p-5 space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-bg-tertiary border border-border flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-heading font-semibold text-text-primary">{t("invoice")}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {order.invoicePath ? t("invoiceAvailable") : t("invoiceUnavailable")}
                </p>
              </div>
            </div>
            {order.invoicePath && (
              <a
                href={`/api/client/commandes/${order.id}/invoice`}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-bg-dark hover:bg-primary-hover text-text-inverse text-sm font-body font-medium rounded-lg transition-colors"
              >
                <DocIcon /> {t("downloadInvoice")}
              </a>
            )}
          </div>

          {/* Avoir */}
          <div className="p-5 space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-bg-tertiary border border-border flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 8h6m-6 4h6m-6 4h6m-9 5h12a2 2 0 002-2V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-heading font-semibold text-text-primary">{t("creditNote")}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {order.creditNotePath ? t("creditNoteAvailable") : t("noCreditNote")}
                </p>
              </div>
            </div>
            {order.creditNotePath && (
              <a
                href={`/api/client/commandes/${order.id}/credit-note`}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-bg-dark hover:bg-primary-hover text-text-inverse text-sm font-body font-medium rounded-lg transition-colors"
              >
                <DocIcon /> {t("downloadCreditNote")}
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ───────── Adresses (livraison + facturation) ───────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ClientAddressCard
          title={t("deliveryAddress")}
          company={order.shipCompany ?? undefined}
          firstName={order.shipFirstName}
          lastName={order.shipLastName}
          address1={order.shipAddress1}
          address2={order.shipAddress2 ?? undefined}
          zipCode={order.shipZipCode}
          city={order.shipCity}
          country={order.shipCountry}
          email={order.clientEmail}
          phone={order.clientPhone}
          vatNumber={order.clientVatNumber ?? undefined}
          vatLabel={t("vatNumberLabel")}
        />
        <ClientAddressCard
          title={t("billingInfo")}
          company={order.clientCompany}
          firstName={order.shipFirstName}
          lastName={order.shipLastName}
          address1={order.shipAddress1}
          address2={order.shipAddress2 ?? undefined}
          zipCode={order.shipZipCode}
          city={order.shipCity}
          country={order.shipCountry}
          email={order.clientEmail}
          phone={order.clientPhone}
          siret={order.clientSiret ?? undefined}
          siretLabel={t("siretLabel")}
          vatNumber={order.clientVatNumber ?? undefined}
          vatLabel={t("vatNumberLabel")}
        />
      </div>

      {/* ───────── Vue 3 colonnes + Résumé de la commande + Résumé financier ───────── */}
      {(() => {
        const currentSubtotalHT = Number(order.subtotalHT);
        const paidHT = order.paidSubtotalHT ? Number(order.paidSubtotalHT) : currentSubtotalHT;
        const carrierPriceNum = Number(order.carrierPrice);
        const tvaRateNum = order.tvaRate;
        const tvaProducts = floorMoney(currentSubtotalHT * tvaRateNum);
        const tvaShipping = floorMoney(carrierPriceNum * tvaRateNum);
        const paidTTC = floorMoney((paidHT + carrierPriceNum) * (1 + tvaRateNum));
        const finalTTC = floorMoney((currentSubtotalHT + carrierPriceNum) * (1 + tvaRateNum));
        return (
          <OrderColumnsView
            orderNumber={order.orderNumber}
            paidTTC={paidTTC}
            finalTTC={finalTTC}
            subtotalHT={currentSubtotalHT}
            tvaProducts={tvaProducts}
            carrierPrice={carrierPriceNum}
            tvaShipping={tvaShipping}
            carrierName={order.carrierName}
            tvaRate={tvaRateNum}
            clientNotifiedAt={order.clientNotifiedAt ? order.clientNotifiedAt.toISOString() : null}
            hasCreditNote={!!order.creditNotePath}
            creditNoteHref={`/api/client/commandes/${order.id}/credit-note`}
            items={order.items.map((item) => ({
              id: item.id,
              productName: item.productName,
              productRef: item.productRef,
              colorName: item.colorName,
              imagePath: item.imagePath,
              saleType: item.saleType,
              packQty: item.packQty,
              size: item.size,
              sizesJson: item.sizesJson,
              unitPrice: Number(item.unitPrice),
              quantity: item.quantity,
              lineTotal: Number(item.lineTotal),
              isCompensation: item.isCompensation,
            }))}
            modifications={order.itemModifications.map((mod) => {
              const item = order.items.find((i) => i.id === mod.orderItemId);
              return {
                orderItemId: mod.orderItemId,
                originalQuantity: mod.originalQuantity,
                newQuantity: mod.newQuantity,
                originalUnitPrice: mod.originalUnitPrice ? Number(mod.originalUnitPrice) : null,
                newUnitPrice: mod.newUnitPrice ? Number(mod.newUnitPrice) : null,
                reason: mod.reason as "OUT_OF_STOCK" | "CLIENT_REQUEST" | "COMMERCIAL_GESTURE",
                priceDifference: Number(mod.priceDifference),
                createdAt: mod.createdAt.toISOString(),
                productName: item?.productName ?? "",
                productRef: item?.productRef ?? "",
                colorName: item?.colorName ?? "",
                imagePath: item?.imagePath ?? null,
                unitPrice: Number(item?.unitPrice ?? 0),
              };
            })}
          />
        );
      })()}

      {/* ───────── Actions bas de page ───────── */}
      <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
        <Link
          href="/commandes"
          className="inline-flex items-center gap-1.5 text-sm font-body text-text-secondary hover:text-text-primary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          {t("backToOrders")}
        </Link>
        {justSucceeded && (
          <Link
            href="/produits"
            className="btn-primary text-sm"
          >
            {t("backToShop")}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        )}
      </div>
    </div>
  );
}

/* ─────────── Composants internes ─────────── */

function CarrierLogoBox({ name, size = "md" }: { name: string | null | undefined; size?: "md" | "sm" }) {
  const logo = getCarrierLogo(name);
  const dims = size === "sm" ? "w-12 h-8" : "w-14 h-9";
  if (!logo) {
    return (
      <div className={`${dims} rounded-lg bg-bg-tertiary border border-border flex items-center justify-center text-base shrink-0`} aria-hidden="true">
        📦
      </div>
    );
  }
  return (
    <div
      className={`${dims} rounded-lg border border-border p-1 shrink-0 flex items-center justify-center overflow-hidden`}
      style={{ background: logo.bg ?? "white" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.path} alt={name ?? ""} className="max-w-full max-h-full object-contain" />
    </div>
  );
}

function ClientAddressCard({
  title,
  company,
  firstName,
  lastName,
  address1,
  address2,
  zipCode,
  city,
  country,
  email,
  phone,
  siret,
  siretLabel,
  vatNumber,
  vatLabel,
}: {
  title: string;
  company?: string;
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  zipCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  siret?: string;
  siretLabel?: string;
  vatNumber?: string;
  vatLabel?: string;
}) {
  return (
    <div className="bg-bg-primary border border-border rounded-2xl shadow-sm p-5">
      <h2 className="text-[10px] uppercase tracking-widest text-text-muted font-heading font-semibold mb-3">{title}</h2>

      <div className="text-sm font-body space-y-0.5 text-text-primary leading-relaxed">
        {company && <p className="font-semibold">{company}</p>}
        <p>{firstName} {lastName}</p>
        <p>{address1}</p>
        {address2 && <p>{address2}</p>}
        <p>{zipCode} {city}</p>
        <p>{country}</p>
      </div>

      <div className="mt-3 pt-3 border-t border-border space-y-1.5 text-sm font-body">
        <p className="flex items-center gap-2 text-text-secondary">
          <MailIcon />
          <a href={`mailto:${email}`} className="text-text-primary hover:underline truncate">
            {email}
          </a>
        </p>
        <p className="flex items-center gap-2 text-text-secondary">
          <PhoneIcon />
          <a href={`tel:${phone}`} className="text-text-primary hover:underline">
            {phone}
          </a>
        </p>
      </div>

      {(siret || vatNumber) && (
        <div className="mt-3 pt-3 border-t border-border space-y-1.5 text-xs">
          {siret && (
            <div className="flex justify-between gap-2">
              <span className="text-text-muted font-semibold uppercase tracking-wider">{siretLabel ?? "SIRET"}</span>
              <span className="text-text-primary font-mono">{siret}</span>
            </div>
          )}
          {vatNumber && (
            <div className="flex justify-between gap-2">
              <span className="text-text-muted font-semibold uppercase tracking-wider">{vatLabel ?? "TVA"}</span>
              <span className="text-text-primary font-mono">{vatNumber}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
    </svg>
  );
}
