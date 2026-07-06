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

export default async function CommandeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id, locale } = await params;
  void searchParams;
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

  // Étapes de suivi
  const steps: { status: string; label: string; done: boolean }[] = [
    { status: "PENDING",   label: t("statusReceived"),     done: true },
    { status: "VALIDATED", label: t("statuses.VALIDATED"), done: order.status === "VALIDATED" || order.status === "SHIPPED" },
    { status: "SHIPPED",   label: t("statuses.SHIPPED"),   done: order.status === "SHIPPED" },
  ];
  const isCancelled = order.status === "CANCELLED";
  const totalArticles = order.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="p-4 md:p-6 lg:p-10 w-full space-y-6 relative overflow-hidden">
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

      {/* ───────── En-tête ───────── */}
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
              {t("createClaim")}
            </Link>
          )}
        </div>
      </div>

      {/* ───────── Suivi ───────── */}
      {!isCancelled && (
        <div className="bg-bg-primary border border-border rounded-xl p-5">
          <h2 className="font-heading text-sm font-semibold text-text-primary mb-4">{t("orderProgress")}</h2>
          <div className="relative">
            <div className="absolute top-3.5 left-3.5 right-3.5 h-0.5 bg-[#E5E5E5]" />
            <div
              className="absolute top-3.5 left-3.5 h-0.5 bg-bg-dark transition-all duration-500"
              style={{ width: `${((steps.filter((s) => s.done).length - 1) / (steps.length - 1)) * 100}%` }}
            />
            <div className="relative flex justify-between">
              {steps.map((step) => (
                <div key={step.status} className="flex flex-col items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full border-2 flex items-center justify-center z-10 transition-colors ${
                      step.done
                        ? "bg-bg-dark border-bg-dark text-text-inverse"
                        : "bg-bg-primary border-border text-[#E5E5E5]"
                    }`}
                  >
                    {step.done ? (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-[#E5E5E5]" />
                    )}
                  </div>
                  <span
                    className={`text-[10px] font-body text-center max-w-16 ${
                      step.done ? "text-text-primary font-medium" : "text-text-muted"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Numéro de suivi */}
          {order.eeTrackingId && (
            <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-center gap-3">
              <div>
                <p className="text-xs font-body text-text-muted">
                  {t("trackingNumber")} · <span className="font-medium text-text-secondary">{order.carrierName}</span>
                </p>
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
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                  {t("trackOn", { carrier: order.carrierName })}
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* ───────── Documents (pleine largeur) ───────── */}
      <section className="bg-bg-primary border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border">
          <h2 className="font-heading text-sm font-semibold text-text-primary">{t("orderForm")}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {/* Bon de commande */}
          <div className="px-5 py-4 space-y-2.5">
            <div>
              <p className="text-sm font-semibold text-text-primary">{t("orderForm")}</p>
              <p className="text-xs text-text-muted mt-0.5">{t("orderFormDesc")}</p>
            </div>
            <div className="flex flex-col gap-2">
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
          <div className="px-5 py-4 space-y-2.5">
            <div>
              <p className="text-sm font-semibold text-text-primary">{t("invoice")}</p>
              <p className="text-xs text-text-muted mt-0.5">
                {order.invoicePath ? t("invoiceAvailable") : t("invoiceUnavailable")}
              </p>
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
          <div className="px-5 py-4 space-y-2.5">
            <div>
              <p className="text-sm font-semibold text-text-primary">{t("creditNote")}</p>
              <p className="text-xs text-text-muted mt-0.5">
                {order.creditNotePath ? t("creditNoteAvailable") : t("noCreditNote")}
              </p>
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
        const round2 = (n: number) => Math.round(n * 100) / 100;
        const tvaProducts = round2(currentSubtotalHT * tvaRateNum);
        const tvaShipping = round2(carrierPriceNum * tvaRateNum);
        // Payé par le client : recalcul avec arrondi composant par composant
        // pour rester cohérent avec le montant réellement facturé à Stripe.
        const paidTTC = round2(
          paidHT + carrierPriceNum + round2(paidHT * tvaRateNum) + round2(carrierPriceNum * tvaRateNum),
        );
        const finalTTC = Number(order.totalTTC);
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

      {/* ───────── Retour ───────── */}
      <Link
        href="/commandes"
        className="inline-flex items-center gap-1.5 text-sm font-body text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        {t("backToOrders")}
      </Link>
    </div>
  );
}

/* ─────────── Composants internes ─────────── */

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
    <div className="bg-bg-primary border border-border rounded-xl p-5">
      <h2 className="font-heading text-sm font-semibold text-text-primary mb-3">{title}</h2>

      {/* Carte de visite */}
      <div className="text-sm font-body space-y-0.5 text-text-primary leading-relaxed">
        {company && <p className="font-semibold">{company}</p>}
        <p>{firstName} {lastName}</p>
        <p>{address1}</p>
        {address2 && <p>{address2}</p>}
        <p>{zipCode} {city}</p>
        <p>{country}</p>
      </div>

      {/* Contact */}
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

      {/* Identifiants entreprise */}
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
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
      />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
      />
    </svg>
  );
}
