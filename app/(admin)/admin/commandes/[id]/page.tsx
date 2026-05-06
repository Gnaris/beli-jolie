import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OrderStatusActions from "@/components/admin/orders/OrderStatusActions";
import InvoiceUpload from "@/components/admin/orders/InvoiceUpload";
import CreditNoteUpload from "@/components/admin/orders/CreditNoteUpload";
import OrderItemsEditor from "@/components/admin/orders/OrderItemsEditor";
import ShippingSection from "@/components/admin/orders/ShippingSection";
import { EU_COUNTRIES } from "@/lib/vat";

export const metadata: Metadata = { title: "Détail commande — Admin" };

const STATUS_CFG: Record<string, { label: string; badge: string }> = {
  PENDING:   { label: "Nouveau",  badge: "badge badge-warning" },
  SHIPPED:   { label: "Expédiée", badge: "badge badge-success" },
  CANCELLED: { label: "Annulée",  badge: "badge badge-error"   },
};

export default async function AdminCommandeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      itemModifications: true,
    },
  });

  if (!order) notFound();

  const st = STATUS_CFG[order.status] ?? STATUS_CFG.PENDING;

  // Toute livraison hors UE (DOM-TOM inclus) → saisie manuelle uniquement :
  // Easy-Express exige une facture proforma qu'on ne sait pas encore générer.
  const shipCountryCode = (order.shipCountry ?? "").toUpperCase();
  const isOutsideEu = !!shipCountryCode && !EU_COUNTRIES.has(shipCountryCode);

  const fmt = (n: number | { toNumber?: () => number }) =>
    Number(n).toFixed(2).replace(".", ",") + " €";

  const totalArticles = order.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="space-y-6">

      {/* ───────── En-tête ───────── */}
      <div className="space-y-3">
        <Link
          href="/admin/commandes"
          className="text-xs text-text-muted hover:text-text-primary font-body inline-flex items-center gap-1 transition-colors w-fit"
        >
          ← Toutes les commandes
        </Link>

        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="page-title">Commande {order.orderNumber}</h1>
              <span className={`${st.badge} px-3 py-1.5 text-sm`}>{st.label}</span>
            </div>
            <p className="text-sm text-text-secondary font-body mt-1">
              Passée le{" "}
              {new Date(order.createdAt).toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {" · "}
              {totalArticles} article{totalArticles > 1 ? "s" : ""}
            </p>
          </div>

          <OrderStatusActions orderId={order.id} currentStatus={order.status} />
        </div>
      </div>

      {/* ───────── Documents + Expédition (pleine largeur) ───────── */}
      <section className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border table-header">
          <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
            Documents & expédition
          </h2>
        </div>

        {/* Documents : Bon de commande, Facture, Avoir */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {/* Bon de commande */}
          <div className="px-5 py-4 space-y-2.5">
            <div>
              <p className="text-sm font-semibold text-text-primary">Bon de commande</p>
              <p className="text-xs text-text-muted mt-0.5">PDF généré à la volée</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/admin/commandes/${order.id}/pdf`}
                target="_blank"
                className="btn-primary inline-flex items-center gap-2 text-xs"
              >
                <DocIcon /> Avec prix
              </a>
              <a
                href={`/api/admin/commandes/${order.id}/pdf?noPrices=1`}
                target="_blank"
                className="btn-secondary inline-flex items-center gap-2 text-xs"
              >
                <DocIcon /> Sans prix
              </a>
            </div>
          </div>

          {/* Facture client */}
          <div className="px-5 py-4 space-y-2.5">
            <p className="text-sm font-semibold text-text-primary">Facture client</p>
            <InvoiceUpload orderId={order.id} hasInvoice={!!order.invoicePath} />
          </div>

          {/* Avoir */}
          <div className="px-5 py-4 space-y-2.5">
            <p className="text-sm font-semibold text-text-primary">Avoir</p>
            <CreditNoteUpload orderId={order.id} hasCreditNote={!!order.creditNotePath} />
          </div>
        </div>

        {/* Expédition (séparée, pleine largeur) */}
        <div className="border-t border-border bg-bg-secondary/30">
          <div className="px-5 py-3 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
              Expédition / bordereau
            </span>
          </div>
          <div className="border-t border-border bg-bg-primary">
            <ShippingSection
              orderId={order.id}
              initialCarrierName={order.carrierName}
              initialTrackingId={order.eeTrackingId}
              initialLabelUrl={order.eeLabelUrl}
              isOutsideEu={isOutsideEu}
            />
          </div>
        </div>
      </section>

      {/* ───────── Adresses (livraison + facturation) ───────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <AddressCard
          title="Adresse de livraison"
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
        />
        <AddressCard
          title="Adresse de facturation"
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
      </div>

      {/* ───────── Transporteur privé (si applicable) ───────── */}
      {order.carrierId === "private_carrier" && (
        <section className="card overflow-hidden border-warning/40">
          <div className="px-5 py-3.5 border-b border-border table-header bg-warning/5">
            <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide flex items-center gap-2">
              <svg className="w-4 h-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
              Transporteur privé du client
            </h2>
          </div>
          <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm font-body">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Email</p>
              {order.privateCarrierEmail ? (
                <a
                  href={`mailto:${order.privateCarrierEmail}`}
                  className="text-text-primary hover:underline break-all"
                >
                  {order.privateCarrierEmail}
                </a>
              ) : (
                <p className="text-text-muted italic text-xs">Non fourni</p>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Téléphone</p>
              {order.privateCarrierPhone ? (
                <a href={`tel:${order.privateCarrierPhone}`} className="text-text-primary hover:underline">
                  {order.privateCarrierPhone}
                </a>
              ) : (
                <p className="text-text-muted italic text-xs">Non fourni</p>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">Bordereau</p>
              {order.privateCarrierBordereau ? (
                <a
                  href={order.privateCarrierBordereau}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary inline-flex items-center gap-2 text-xs"
                >
                  <DocIcon /> Télécharger
                </a>
              ) : (
                <p className="text-text-muted italic text-xs">Non fourni</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ───────── Articles (pleine largeur) ───────── */}
      <OrderItemsEditor
        orderId={order.id}
        readOnly={order.status !== "PENDING"}
        items={order.items.map((item) => ({
          ...item,
          unitPrice: Number(item.unitPrice),
          lineTotal: Number(item.lineTotal),
        }))}
        existingModifications={order.itemModifications.map((mod) => {
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

      {/* ───────── Récapitulatif financier (pleine largeur, en bas) ───────── */}
      <section className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border table-header">
          <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
            Récapitulatif
          </h2>
        </div>
        <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-2 text-sm font-body">
          <div className="space-y-2">
            <div className="flex justify-between text-text-secondary">
              <span>Sous-total HT</span>
              <span className="font-medium text-text-primary">{fmt(order.subtotalHT)}</span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>
                TVA ({order.tvaRate === 0 ? "0% — exonéré" : `${(order.tvaRate * 100).toFixed(0)}%`})
              </span>
              <span className="font-medium text-text-primary">{fmt(order.tvaAmount)}</span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>Livraison ({order.carrierName})</span>
              <span className="font-medium text-text-primary">
                {Number(order.carrierPrice) === 0 ? "Gratuit" : fmt(order.carrierPrice)}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between md:border-l md:border-border md:pl-12 pt-3 md:pt-0 border-t md:border-t-0 border-border">
            <span className="font-heading font-semibold text-base text-text-primary">Total TTC</span>
            <span className="font-heading font-semibold text-2xl text-text-primary">
              {fmt(order.totalTTC)}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ─────────── Composants internes ─────────── */

function AddressCard({
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
    <section className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border table-header">
        <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
          {title}
        </h2>
      </div>
      <div className="px-5 py-4 text-sm font-body space-y-3">
        {/* Adresse postale (carte de visite) */}
        <div className="space-y-0.5 text-text-primary leading-relaxed">
          {company && <p className="font-semibold">{company}</p>}
          <p>{firstName} {lastName}</p>
          <p>{address1}</p>
          {address2 && <p>{address2}</p>}
          <p>{zipCode} {city}</p>
          <p>{country}</p>
        </div>

        {/* Contact */}
        <div className="pt-3 border-t border-border space-y-1.5">
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
          <div className="pt-3 border-t border-border space-y-1.5 text-xs">
            {siret && (
              <div className="flex justify-between gap-2">
                <span className="text-text-muted font-semibold uppercase tracking-wider">SIRET</span>
                <span className="text-text-primary font-mono">{siret}</span>
              </div>
            )}
            {vatNumber && (
              <div className="flex justify-between gap-2">
                <span className="text-text-muted font-semibold uppercase tracking-wider">N° TVA</span>
                <span className="text-text-primary font-mono">{vatNumber}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function DocIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
