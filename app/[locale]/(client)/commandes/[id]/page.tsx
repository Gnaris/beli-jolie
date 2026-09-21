import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { getTranslations } from "next-intl/server";
import { roundCent } from "@/lib/money";
import { getOrderStatusVisual } from "@/lib/order-status-visual";
import OrderContent from "@/components/admin/orders/OrderContent";
import CancelOrderButton from "@/components/client/CancelOrderButton";
import ReorderButton from "@/components/client/orders/ReorderButton";
import PayOrderByCardButton from "@/components/client/orders/PayOrderByCardButton";
import PaymentLinkPendingCard from "@/components/client/orders/PaymentLinkPendingCard";
import { syncStripeCheckoutSessionStatus } from "@/app/actions/client/payment-link-order";
import { getTrackingUrl } from "@/app/[locale]/(client)/commandes/page";
import { getCachedBankTransferConfig, formatIbanForDisplay } from "@/lib/bank-transfer-config";
import { getStripePublishableKey, isStripeConfigured } from "@/lib/stripe";
import { buildProductHandle } from "@/lib/product-url";

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
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return redirect({ href: { pathname: "/connexion", query: { callbackUrl: "/commandes" } }, locale });

  const t = await getTranslations("orders");

  // Synchro préalable avec Stripe si la commande est un lien de paiement
  // encore en attente : filet de sécurité contre les webhooks manqués
  // (dev local sans Stripe CLI, panne réseau, retry Stripe en cours…).
  // Idempotent — si déjà payé ou pas STRIPE_LINK, no-op instantané.
  await syncStripeCheckoutSessionStatus(id);

  const order = await prisma.order.findFirst({
    where: { id, userId: session.user.id },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      itemModifications: true,
    },
  });

  if (!order) notFound();

  // Pastilles couleur pour la colonne « Couleur » du tableau
  const distinctColorNames = Array.from(
    new Set(order.items.map((i) => i.colorName).filter((n): n is string => !!n)),
  );
  const colorRows = distinctColorNames.length
    ? await prisma.color.findMany({
        where: { name: { in: distinctColorNames } },
        select: { name: true, hex: true, patternImage: true },
      })
    : [];
  const colorMap: Record<string, { hex: string | null; patternImage: string | null }> = {};
  for (const c of colorRows) {
    if (!colorMap[c.name]) colorMap[c.name] = { hex: c.hex, patternImage: c.patternImage };
  }

  // Mapping ref → URL fiche produit publique. On construit un handle à partir
  // du nom snapshot (buildProductHandle est tolérant : la page produit
  // recherche par référence, pas par nom). Si le produit a été supprimé, la
  // page produit détecte la ref dans l'historique et affiche un layout dédié.
  const productLinks: Record<string, string> = {};
  const seenRefs = new Set<string>();
  for (const it of order.items) {
    if (!it.productRef || seenRefs.has(it.productRef)) continue;
    seenRefs.add(it.productRef);
    const handle = buildProductHandle(it.productName, it.productRef);
    if (handle) productLinks[it.productRef] = `/${locale}/produits/${handle}`;
  }

  const totalArticles = order.items.reduce((s, i) => s + i.quantity, 0);
  const trackingUrl = order.eeTrackingId ? getTrackingUrl(order.carrierName ?? "", order.eeTrackingId) : null;
  const statusVisual = getOrderStatusVisual(order.status);

  // Virement bancaire en attente : on affiche un bandeau + les coordonnées.
  const isBankTransferPending =
    order.paymentMode === "BANK_TRANSFER" &&
    order.paymentStatus !== "paid" &&
    order.status !== "CANCELLED";

  // Lien de paiement Stripe en attente — fallback quand le client n'a pas
  // pu payer via l'iframe embarquée. Affichage similaire au virement.
  const isPaymentLinkPending =
    order.paymentMode === "STRIPE_LINK" &&
    order.paymentStatus !== "paid" &&
    order.status !== "CANCELLED";
  const [bankTransferConfig, stripeReady, stripePublishableKey] = isBankTransferPending
    ? await Promise.all([
        getCachedBankTransferConfig(),
        isStripeConfigured(),
        getStripePublishableKey(),
      ])
    : [null, false, null];

  // Reconstruction du TTC payé — arrondi Sage (roundCent). Cf. lib/money.ts.
  const paidHT = Number(order.paidSubtotalHT ?? order.subtotalHT);
  const carrier = Number(order.carrierPrice);
  const paidTvaAmount = roundCent((paidHT + carrier) * order.tvaRate);
  const paidTotalTTC = roundCent(paidHT + carrier + paidTvaAmount);

  const dateFmt = new Date(order.createdAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8 w-full space-y-8">
      {/* Retour */}
      <Link
        href="/commandes"
        className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 transition-colors w-fit"
      >
        ← {t("backToOrders")}
      </Link>

      {/* HERO aurora sky (identique admin, dimensions élargies) */}
      <section className="relative overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-white px-8 sm:px-12 py-10">
        <div className="pointer-events-none absolute -top-16 -right-16 w-64 h-64 rounded-full bg-sky-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 w-80 h-80 rounded-full bg-indigo-200/20 blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 inline-flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${statusVisual.dot}`} />
              {t("orderNumber")}
            </p>
            <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 mt-2">
              {order.orderNumber}
            </h1>
            <p className="text-base text-slate-600 mt-2 font-body">
              {t("placedOn", { date: dateFmt })} · {totalArticles} {totalArticles > 1 ? t("items_plural") : t("items")}
            </p>
            <div className="flex flex-wrap gap-2.5 mt-4">
              {isBankTransferPending ? (
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold bg-amber-100 text-amber-800">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  {t("bankTransferPending")}
                </span>
              ) : (
                <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold ${statusVisual.pill}`}>
                  <span className={`w-2 h-2 rounded-full ${statusVisual.dot}`} />
                  {t(`statuses.${order.status}`)}
                </span>
              )}
              {order.carrierName && (
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">
                  🚚 {order.carrierName}
                </span>
              )}
            </div>
          </div>

          {/* Actions client (à droite du hero, comme OrderStatusActions admin) */}
          <div className="flex flex-wrap gap-2">
            {order.status === "PENDING" && (
              <CancelOrderButton orderId={order.id} orderNumber={order.orderNumber} size="md" />
            )}
            <ReorderButton orderId={order.id} size="md" />
            {order.status !== "CANCELLED" && (
              <Link
                href={`/espace-pro/reclamations/nouveau?order=${order.id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                {t("createClaim")}
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Encart lien de paiement en attente — même mécanique que le virement,
          mais paiement Stripe hors iframe (fallback si le formulaire embarqué
          est bloqué par un antivirus ou une extension côté client). */}
      {isPaymentLinkPending && (
        <PaymentLinkPendingCard
          orderId={order.id}
          orderNumber={order.orderNumber}
          totalTTC={Number(order.totalTTC)}
          initialUrl={order.stripeCheckoutSessionUrl}
          initialExpiresAt={order.stripeCheckoutSessionExpiresAt?.toISOString() ?? null}
        />
      )}

      {/* Encart virement en attente — placé juste après le hero pour être vu immédiatement */}
      {isBankTransferPending && bankTransferConfig && bankTransferConfig.enabled && (
        <section className="bg-white border border-amber-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-7 sm:px-8 py-5 border-b border-amber-100 bg-amber-50 flex items-center gap-4">
            <div className="w-1.5 h-10 bg-amber-500 rounded-full" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
                {t("bankTransferPending")}
              </p>
              <h2 className="font-heading text-xl sm:text-2xl font-semibold text-slate-900 mt-1">
                {t("bankTransferPendingDesc")}
              </h2>
            </div>
          </div>
          <div className="p-7 sm:p-8 space-y-5">
            <div className="rounded-2xl bg-slate-900 text-white p-6">
              <p className="text-[10px] uppercase tracking-widest opacity-60 font-semibold mb-4">
                {t("bankTransferTitle")}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="opacity-60 text-xs mb-1">{t("bankTransferHolder")}</p>
                  <p className="font-semibold">{bankTransferConfig.holder}</p>
                </div>
                <div>
                  <p className="opacity-60 text-xs mb-1">{t("bankTransferAmount")}</p>
                  <p className="font-heading text-xl font-bold">{Number(order.totalTTC).toFixed(2)} €</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="opacity-60 text-xs mb-1">IBAN</p>
                  <p className="font-mono tracking-widest text-sm">{formatIbanForDisplay(bankTransferConfig.iban)}</p>
                </div>
                <div className="sm:col-span-2 pt-3 border-t border-white/10">
                  <p className="opacity-60 text-xs mb-1">{t("bankTransferReferenceLabel")}</p>
                  <p className="font-mono font-semibold">{order.orderNumber}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-3 text-sm text-amber-900">
              {t("bankTransferReferenceHint")}
            </div>

            {/* Alternative : payer par carte immédiatement plutôt que d'attendre
                de faire le virement. Bascule paymentMode → CARD après paiement. */}
            {stripeReady && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {t("bankTransferSwitchToCardTitle")}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {t("bankTransferSwitchToCardDesc")}
                  </p>
                </div>
                <PayOrderByCardButton
                  orderId={order.id}
                  totalTTC={Number(order.totalTTC)}
                  publishableKey={stripePublishableKey}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Informations de la commande (identique admin, agrandi) */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-7 sm:px-8 py-6 border-b border-slate-100 flex items-center gap-4">
          <div className="w-1.5 h-10 bg-slate-900 rounded-full" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t("coordinatesEyebrow")}
            </p>
            <h2 className="font-heading text-xl sm:text-2xl font-semibold text-slate-900 mt-1">{t("orderInfoTitle")}</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
          <InfoColumn
            title={t("billing")}
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
            vatNumber={order.clientVatNumber ?? undefined}
            siretLabel={t("siretLabel")}
            vatLabel={t("vatNumberLabel")}
          />
          <InfoColumn
            title={t("delivery")}
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
          />
        </div>
      </section>

      {/* Barre actions client (identique layout admin OrderQuickActions, mais téléchargement seulement) */}
      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/client/commandes/${order.id}/pdf`}
          target="_blank"
          className="inline-flex items-center gap-2 bg-slate-900 text-white text-base font-medium px-5 py-3 rounded-xl hover:bg-slate-800"
        >
          <DocIcon /> {t("goodsWithPrices")}
        </a>
        <a
          href={`/api/client/commandes/${order.id}/pdf?noPrices=1`}
          target="_blank"
          className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-800 text-base font-medium px-5 py-3 rounded-xl hover:bg-slate-50"
        >
          <DocIcon /> {t("goodsWithoutPrices")}
        </a>

        {order.invoicePath ? (
          <a
            href={`/api/client/commandes/${order.id}/invoice`}
            target="_blank"
            className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-base font-medium px-5 py-3 rounded-xl hover:bg-emerald-100"
          >
            <CheckIcon /> {t("invoice")}
          </a>
        ) : (
          <span
            className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-400 text-base font-medium px-5 py-3 rounded-xl cursor-not-allowed"
            title={t("invoiceUnavailable")}
          >
            <DocIcon /> {t("invoice")}
          </span>
        )}

        {order.creditNotePath ? (
          <a
            href={`/api/client/commandes/${order.id}/credit-note`}
            target="_blank"
            className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-base font-medium px-5 py-3 rounded-xl hover:bg-emerald-100"
          >
            <CheckIcon /> {t("creditNote")}
          </a>
        ) : (
          <span
            className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-400 text-base font-medium px-5 py-3 rounded-xl cursor-not-allowed"
            title={t("noCreditNote")}
          >
            <DocIcon /> {t("creditNote")}
          </span>
        )}

        {trackingUrl && order.eeTrackingId && (
          <a
            href={trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-800 text-base font-medium px-5 py-3 rounded-xl hover:bg-slate-50"
          >
            <PackageIcon /> {t("trackParcel")}
            <span className="text-[11px] font-mono text-slate-500 ml-1">{order.eeTrackingId}</span>
          </a>
        )}
      </div>

      {/* Contenu de la commande + Résumé (composant admin en mode lecture seule) */}
      <OrderContent
        orderId={order.id}
        readOnly={true}
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
          lineDiscountType: (item.lineDiscountType as "percent" | "fixed" | null) ?? null,
          lineDiscountValue: item.lineDiscountValue ? Number(item.lineDiscountValue) : null,
          lineDiscountAmt: item.lineDiscountAmt ? Number(item.lineDiscountAmt) : null,
        }))}
        modifications={order.itemModifications.map((mod) => ({
          orderItemId: mod.orderItemId,
          originalQuantity: mod.originalQuantity,
          newQuantity: mod.newQuantity,
          originalUnitPrice: mod.originalUnitPrice ? Number(mod.originalUnitPrice) : null,
          newUnitPrice: mod.newUnitPrice ? Number(mod.newUnitPrice) : null,
          reason: mod.reason as "OUT_OF_STOCK" | "CLIENT_REQUEST" | "COMMERCIAL_GESTURE",
          priceDifference: Number(mod.priceDifference),
          createdAt: mod.createdAt.toISOString(),
        }))}
        colorMap={colorMap}
        totals={{
          currentSubtotalHT: Number(order.subtotalHT),
          paidSubtotalHT: order.paidSubtotalHT ? Number(order.paidSubtotalHT) : Number(order.subtotalHT),
          clientDiscountAmt: Number(order.clientDiscountAmt),
          promoDiscount: Number(order.promoDiscount),
          promoCode: order.promoCode,
          subtotalBrutHT: order.subtotalBrutHT
            ? Number(order.subtotalBrutHT)
            : Number(order.subtotalHT) + Number(order.clientDiscountAmt) + Number(order.promoDiscount),
          promoAutoDiscount: Number(order.promoAutoDiscount),
          appliedPromotions: Array.isArray(order.appliedPromotions)
            ? (order.appliedPromotions as Array<{
                id: string;
                name: string;
                kind: "AUTO" | "CODE";
                scope: string;
                discountKind: string;
                discountValue: number;
                amountSaved: number;
              }>)
            : [],
          carrierName: order.carrierName ?? "",
          carrierPrice: Number(order.carrierPrice),
          carrierBasePrice: order.carrierBasePrice ? Number(order.carrierBasePrice) : Number(order.carrierPrice),
          carrierPromoDiscount: Number(order.carrierPromoDiscount),
          carrierClientDiscount: Number(order.carrierClientDiscount),
          tvaRate: order.tvaRate,
          currentTotalTTC: Number(order.totalTTC),
          paidTotalTTC,
          paymentStatus: order.paymentStatus,
        }}
        productLinks={productLinks}
      />
    </div>
  );
}

/* ─────────────────────── Composants internes ─────────────────────── */

function InfoColumn({
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
  vatNumber,
  siretLabel,
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
  vatNumber?: string;
  siretLabel?: string;
  vatLabel?: string;
}) {
  return (
    <div className="p-7 sm:p-8 space-y-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{title}</p>

      <div className="space-y-1 text-base text-slate-900 leading-relaxed">
        {company && <p className="font-semibold text-lg">{company}</p>}
        <p>
          {firstName} {lastName}
        </p>
        <p>{address1}</p>
        {address2 && <p>{address2}</p>}
        <p>
          {zipCode} {city}
        </p>
        <p>{country}</p>
      </div>

      <div className="pt-4 border-t border-slate-100 space-y-2 text-sm text-slate-500">
        <p className="flex items-center gap-2.5">
          <span aria-hidden className="text-base">✉️</span>
          <a href={`mailto:${email}`} className="text-slate-700 hover:underline truncate">
            {email}
          </a>
        </p>
        <p className="flex items-center gap-2.5">
          <span aria-hidden className="text-base">📞</span>
          <a href={`tel:${phone}`} className="text-slate-700 hover:underline">
            {phone}
          </a>
        </p>
      </div>

      {(siret || vatNumber) && (
        <div className="pt-4 border-t border-slate-100 space-y-2 text-sm">
          {siret && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 font-semibold uppercase tracking-wider text-xs">{siretLabel ?? "SIRET"}</span>
              <span className="text-slate-900 font-mono">{siret}</span>
            </div>
          )}
          {vatNumber && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 font-semibold uppercase tracking-wider text-xs">{vatLabel ?? "TVA"}</span>
              <span className="text-slate-900 font-mono">{vatNumber}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function PackageIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25l-9-4.5-9 4.5m18 0l-9 4.5m9-4.5v9l-9 4.5M3 8.25l9 4.5m-9-4.5v9l9 4.5m0-13.5v13.5" />
    </svg>
  );
}
