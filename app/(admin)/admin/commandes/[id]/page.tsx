import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OrderStatusActions from "@/components/admin/orders/OrderStatusActions";
import OrderContent from "@/components/admin/orders/OrderContent";
import OrderQuickActions from "@/components/admin/orders/OrderQuickActions";
import BankTransferConfirmButton from "@/components/admin/orders/BankTransferConfirmButton";
import { EU_COUNTRIES } from "@/lib/vat";
import { roundCent } from "@/lib/money";
import { syncStripeCheckoutSessionStatus } from "@/app/actions/client/payment-link-order";

export const metadata: Metadata = { title: "Détail commande — Admin" };

const STATUS_CFG: Record<string, { label: string; pillClass: string; dotClass: string }> = {
  PENDING:   { label: "Nouveau",  pillClass: "bg-amber-100 text-amber-800",     dotClass: "bg-amber-500"   },
  VALIDATED: { label: "Validée",  pillClass: "bg-sky-100 text-sky-800",         dotClass: "bg-sky-500"     },
  SHIPPED:   { label: "Expédiée", pillClass: "bg-emerald-100 text-emerald-800", dotClass: "bg-emerald-500" },
  CANCELLED: { label: "Annulée",  pillClass: "bg-rose-100 text-rose-800",       dotClass: "bg-rose-500"    },
};

export default async function AdminCommandeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;

  // Filet de sécurité : synchronise le statut de paiement avec Stripe si
  // c'est une commande STRIPE_LINK encore en attente. Couvre les webhooks
  // manqués (dev local sans Stripe CLI, panne réseau, retry en cours…).
  // Idempotent — no-op instantané si déjà payé ou paymentMode ≠ STRIPE_LINK.
  await syncStripeCheckoutSessionStatus(id);

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      itemModifications: true,
    },
  });

  if (!order) notFound();

  // Récup des pastilles couleur (hex + patternImage) pour la colonne « Couleur »
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

  const status = STATUS_CFG[order.status] ?? STATUS_CFG.PENDING;

  // Virement bancaire : afficher un bloc dédié + bouton « Marquer virement reçu »
  // uniquement si la commande est un virement encore en attente.
  const isBankTransferPending =
    order.paymentMode === "BANK_TRANSFER" && order.paymentStatus !== "paid" && order.status !== "CANCELLED";
  const isBankTransferPaid =
    order.paymentMode === "BANK_TRANSFER" && order.paymentStatus === "paid";

  // Lien de paiement Stripe (fallback iframe bloquée) : badge dédié + encart
  // rappelant l'URL, l'échéance et l'état. Le passage à "paid" est
  // automatique (webhook Stripe), pas de bouton manuel côté admin.
  const isPaymentLinkPending =
    order.paymentMode === "STRIPE_LINK" && order.paymentStatus !== "paid" && order.status !== "CANCELLED";
  const isPaymentLinkPaid =
    order.paymentMode === "STRIPE_LINK" && order.paymentStatus === "paid";
  const paymentLinkExpired =
    isPaymentLinkPending &&
    !!order.stripeCheckoutSessionExpiresAt &&
    order.stripeCheckoutSessionExpiresAt.getTime() <= Date.now();

  const shipCountryCode = (order.shipCountry ?? "").toUpperCase();
  const isOutsideEu = !!shipCountryCode && !EU_COUNTRIES.has(shipCountryCode);

  const totalArticles = order.items.reduce((s, i) => s + i.quantity, 0);

  // Reconstruction du TTC payé — arrondi Sage (roundCent). Cf. lib/money.ts.
  const paidHT = Number(order.paidSubtotalHT ?? order.subtotalHT);
  const carrier = Number(order.carrierPrice);
  const paidTvaAmount = roundCent((paidHT + carrier) * order.tvaRate);
  const paidTotalTTC = roundCent(paidHT + carrier + paidTvaAmount);

  // Mapping ref → route admin. `/admin/produits/ref/{ref}` fait le lookup et
  // redirige vers la fiche produit si elle existe, sinon affiche un layout
  // « produit supprimé » avec les infos snapshot. On garde ainsi une URL
  // unique côté commande, indépendamment de la présence du produit en base.
  const productLinks: Record<string, string> = {};
  for (const it of order.items) {
    if (it.productRef && !productLinks[it.productRef]) {
      productLinks[it.productRef] = `/admin/produits/ref/${encodeURIComponent(it.productRef)}`;
    }
  }

  return (
    <div className="space-y-6">
      {/* Retour */}
      <Link
        href="/admin/commandes"
        className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 transition-colors w-fit"
      >
        ← Toutes les commandes
      </Link>

      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-white px-6 sm:px-8 py-6">
        <div className="pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full bg-sky-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 w-64 h-64 rounded-full bg-indigo-200/20 blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700 inline-flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${status.dotClass}`} />
              Commande
            </p>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
              {order.orderNumber}
            </h1>
            <p className="text-sm text-slate-600 mt-1 font-body">
              Passée le{" "}
              <span className="font-medium text-slate-900">
                {new Date(order.createdAt).toLocaleDateString("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>{" "}
              · {totalArticles} article{totalArticles > 1 ? "s" : ""}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${status.pillClass}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
                {status.label}
              </span>
              {isBankTransferPending ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Virement en attente
                </span>
              ) : isBankTransferPaid ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Virement reçu
                </span>
              ) : isPaymentLinkPending ? (
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${paymentLinkExpired ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${paymentLinkExpired ? "bg-rose-500" : "bg-amber-500 animate-pulse"}`} />
                  {paymentLinkExpired ? "Lien de paiement expiré" : "Lien de paiement en attente"}
                </span>
              ) : isPaymentLinkPaid ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Payé par lien Stripe
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                  Stripe · {order.paymentStatus === "paid" ? "encaissé" : order.paymentStatus}
                </span>
              )}
              {order.carrierName && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                  🚚 {order.carrierName}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {isBankTransferPending && (
              <BankTransferConfirmButton
                orderId={order.id}
                totalTTC={Number(order.totalTTC)}
              />
            )}
            <OrderStatusActions
              orderId={order.id}
              currentStatus={order.status}
            />
          </div>
        </div>
      </section>

      {/* Encart virement en attente (rappel des infos à vérifier sur la banque) */}
      {isBankTransferPending && (
        <section className="bg-white border border-amber-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
            <span className="w-1 h-6 bg-amber-500 rounded-full" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              À vérifier sur votre banque
            </p>
          </div>
          <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Montant attendu</p>
              <p className="text-lg font-semibold text-slate-900">{Number(order.totalTTC).toFixed(2)} €</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Libellé à repérer</p>
              <p className="text-slate-900 font-mono font-semibold">{order.orderNumber}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Émetteur probable</p>
              <p className="text-slate-900 font-medium">{order.shipFirstName} {order.shipLastName}</p>
              {order.clientCompany && <p className="text-xs text-slate-500">{order.clientCompany}</p>}
            </div>
          </div>
          <div className="px-5 py-3 border-t border-amber-100 bg-white">
            <p className="text-xs text-slate-500">
              💡 Ouvrez votre banque, vérifiez que le virement est bien crédité, puis cliquez sur « Marquer virement reçu » en haut.
            </p>
          </div>
        </section>
      )}

      {/* Encart lien de paiement Stripe — état + URL. Le passage à "payé"
          est automatique dès que la cliente clique sur le lien et paie
          (webhook Stripe). Aucune action manuelle admin nécessaire. */}
      {isPaymentLinkPending && (
        <section className={`bg-white rounded-2xl overflow-hidden ${paymentLinkExpired ? "border border-rose-200" : "border border-amber-200"}`}>
          <div className={`px-5 py-3 border-b flex items-center gap-2 ${paymentLinkExpired ? "border-rose-100 bg-rose-50" : "border-amber-100 bg-amber-50"}`}>
            <span className={`w-1 h-6 rounded-full ${paymentLinkExpired ? "bg-rose-500" : "bg-amber-500"}`} />
            <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${paymentLinkExpired ? "text-rose-700" : "text-amber-700"}`}>
              {paymentLinkExpired ? "Lien de paiement expiré" : "Lien de paiement envoyé — en attente"}
            </p>
          </div>
          <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Montant attendu</p>
              <p className="text-lg font-semibold text-slate-900">{Number(order.totalTTC).toFixed(2)} €</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Client</p>
              <p className="text-slate-900 font-medium">{order.shipFirstName} {order.shipLastName}</p>
              {order.clientCompany && <p className="text-xs text-slate-500">{order.clientCompany}</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                {paymentLinkExpired ? "A expiré le" : "Valable jusqu'au"}
              </p>
              <p className="text-slate-900 font-medium">
                {order.stripeCheckoutSessionExpiresAt
                  ? order.stripeCheckoutSessionExpiresAt.toLocaleString("fr-FR", {
                      day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
                    })
                  : "—"}
              </p>
            </div>
          </div>
          {order.stripeCheckoutSessionUrl && !paymentLinkExpired && (
            <div className="px-5 py-3 border-t border-amber-100 bg-white space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Lien envoyé au client
              </p>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-xs text-slate-600 truncate flex-1 font-mono" title={order.stripeCheckoutSessionUrl}>
                  {order.stripeCheckoutSessionUrl}
                </span>
                <a
                  href={order.stripeCheckoutSessionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-slate-700 hover:text-slate-900 whitespace-nowrap"
                >
                  Ouvrir ↗
                </a>
              </div>
            </div>
          )}
          <div className={`px-5 py-3 border-t bg-white ${paymentLinkExpired ? "border-rose-100" : "border-amber-100"}`}>
            <p className="text-xs text-slate-500">
              {paymentLinkExpired
                ? "💡 Le client peut régénérer un nouveau lien depuis sa fiche commande. Le paiement se marquera automatiquement dès qu'il aura payé."
                : "💡 Aucune action de votre côté : dès que la cliente clique sur le lien et paie, la commande passe automatiquement en « payée » ici."}
            </p>
          </div>
        </section>
      )}

      {/* Consentement remplacement en cas de rupture de stock (case cochée au panier) */}
      {order.acceptReplacementContact ? (
        <section className="bg-white border border-emerald-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-emerald-100 bg-emerald-50 flex items-center gap-2">
            <span className="w-1 h-6 bg-emerald-500 rounded-full" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Remplacement en cas de rupture
            </p>
          </div>
          <div className="px-5 py-3 text-sm text-emerald-900">
            ✅ Le client <span className="font-semibold">accepte</span> d'être contacté pour se voir proposer un produit de remplacement si un article de sa commande est en rupture de stock.
          </div>
        </section>
      ) : (
        <section className="bg-white border border-rose-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-rose-100 bg-rose-50 flex items-center gap-2">
            <span className="w-1 h-6 bg-rose-500 rounded-full" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-700">
              Remplacement en cas de rupture
            </p>
          </div>
          <div className="px-5 py-3 text-sm text-rose-900">
            ⛔ Le client <span className="font-semibold">refuse</span> d'être contacté pour un produit de remplacement en cas de rupture de stock.
          </div>
        </section>
      )}

      {/* ─────────── INFORMATIONS DE LA COMMANDE (bloc unique : Facturation + Livraison) ─────────── */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="w-1 h-8 bg-slate-900 rounded-full" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Coordonnées
            </p>
            <h2 className="font-heading text-lg font-semibold text-slate-900">Informations de la commande</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
          <InfoColumn
            title="Facturation"
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
          />
          <InfoColumn
            title="Livraison"
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

      {/* ─────────── BARRE BOUTONS (hors du bloc, juste en dessous) ─────────── */}
      <OrderQuickActions
        orderId={order.id}
        hasInvoice={!!order.invoicePath}
        hasCreditNote={!!order.creditNotePath}
        carrierName={order.carrierName}
        carrierId={order.carrierId}
        eeTrackingId={order.smartyTrackingId ?? order.eeTrackingId}
        eeLabelUrl={order.smartyLabelUrl ?? order.eeLabelUrl}
        isOutsideEu={isOutsideEu}
      />

      {/* Transporteur privé (si applicable) */}
      {order.carrierId === "private_carrier" && (
        <section className="bg-white border border-amber-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
            <span className="w-1 h-6 bg-amber-500 rounded-full" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              Transporteur privé du client
            </p>
          </div>
          <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Email</p>
              {order.privateCarrierEmail ? (
                <a href={`mailto:${order.privateCarrierEmail}`} className="text-slate-900 hover:underline break-all">
                  {order.privateCarrierEmail}
                </a>
              ) : (
                <p className="text-slate-400 italic text-xs">Non fourni</p>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Téléphone</p>
              {order.privateCarrierPhone ? (
                <a href={`tel:${order.privateCarrierPhone}`} className="text-slate-900 hover:underline">
                  {order.privateCarrierPhone}
                </a>
              ) : (
                <p className="text-slate-400 italic text-xs">Non fourni</p>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Bordereau</p>
              {order.privateCarrierBordereau ? (
                <a
                  href={order.privateCarrierBordereau}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sky-700 hover:underline text-xs font-medium"
                >
                  📄 Télécharger
                </a>
              ) : (
                <p className="text-slate-400 italic text-xs">Non fourni</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Contenu commande + résumé */}
      <OrderContent
        orderId={order.id}
        readOnly={order.status !== "PENDING"}
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
          currentSubtotalHT: Number(order.subtotalHT), // HT DÉJÀ après remise commerciale + promo
          paidSubtotalHT: order.paidSubtotalHT ? Number(order.paidSubtotalHT) : Number(order.subtotalHT),
          clientDiscountAmt: Number(order.clientDiscountAmt),
          promoDiscount: Number(order.promoDiscount),
          promoCode: order.promoCode,
          // Snapshot brut (nullable pour commandes historiques → fallback = subtotalHT + clientDiscountAmt + promoDiscount)
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
          currentTotalTTC: Number(order.totalTTC), // Source de vérité BDD (mis à jour à chaque modif)
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
}) {
  return (
    <div className="p-5 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>

      <div className="space-y-0.5 text-sm text-slate-900 leading-relaxed">
        {company && <p className="font-semibold">{company}</p>}
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

      <div className="pt-3 border-t border-slate-100 space-y-1 text-xs text-slate-500">
        <p className="flex items-center gap-2">
          <span aria-hidden>✉️</span>
          <a href={`mailto:${email}`} className="text-slate-700 hover:underline truncate">
            {email}
          </a>
        </p>
        <p className="flex items-center gap-2">
          <span aria-hidden>📞</span>
          <a href={`tel:${phone}`} className="text-slate-700 hover:underline">
            {phone}
          </a>
        </p>
      </div>

      {(siret || vatNumber) && (
        <div className="pt-3 border-t border-slate-100 space-y-1 text-xs">
          {siret && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 font-semibold uppercase tracking-wider">SIRET</span>
              <span className="text-slate-900 font-mono">{siret}</span>
            </div>
          )}
          {vatNumber && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 font-semibold uppercase tracking-wider">N° TVA</span>
              <span className="text-slate-900 font-mono">{vatNumber}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
