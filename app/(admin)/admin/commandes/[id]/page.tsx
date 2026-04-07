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

export const metadata: Metadata = { title: "Détail commande — Admin" };

const STATUS_CFG: Record<string, { label: string; badge: string }> = {
  PENDING:    { label: "En attente",     badge: "badge badge-warning" },
  PROCESSING: { label: "En préparation", badge: "badge badge-info" },
  SHIPPED:    { label: "Expédiée",       badge: "badge badge-success" },
  DELIVERED:  { label: "Livrée",         badge: "badge badge-success" },
  CANCELLED:  { label: "Annulée",        badge: "badge badge-error" },
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

  const fmt = (n: number | { toNumber?: () => number }) => Number(n).toFixed(2).replace(".", ",") + " €";

  return (
    <div className="space-y-6">

      {/* En-tête */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <Link href="/admin/commandes"
            className="text-xs text-text-muted hover:text-text-primary font-body flex items-center gap-1 mb-3 transition-colors">
            ← Toutes les commandes
          </Link>
          <h1 className="page-title">
            Commande {order.orderNumber}
          </h1>
          <p className="text-sm text-text-secondary font-body mt-0.5">
            {new Date(order.createdAt).toLocaleDateString("fr-FR", {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
            })}
          </p>
        </div>

        {/* Statut + actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`${st.badge} px-3 py-1.5 text-sm`}>
            {st.label}
          </span>
          <OrderStatusActions orderId={order.id} currentStatus={order.status} />
        </div>
      </div>

      {/* Téléchargements */}
      <div className="flex flex-wrap gap-3">
        <a
          href={`/api/admin/commandes/${order.id}/pdf`}
          target="_blank"
          className="btn-primary inline-flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Bon de commande PDF
        </a>
        <a
          href={`/api/admin/commandes/${order.id}/pdf?noPrices=1`}
          target="_blank"
          className="btn-secondary inline-flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Bon de commande sans prix
        </a>

        {order.eeLabelUrl && (
          <a
            href={`/api/admin/commandes/${order.id}/label`}
            target="_blank"
            className="btn-secondary inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
            </svg>
            Bordereau d&apos;expédition Easy-Express
          </a>
        )}
      </div>

      {/* Livraison + Facturation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border table-header">
            <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
              Adresse de livraison
            </h2>
          </div>
          <div className="px-5 py-4 text-sm font-body space-y-2">
            {order.shipCompany && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Société</p>
                <p className="text-text-primary">{order.shipCompany}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Prénom</p>
                <p className="text-text-primary">{order.shipFirstName}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Nom</p>
                <p className="text-text-primary">{order.shipLastName}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Adresse</p>
              <p className="text-text-primary">{order.shipAddress1}</p>
              {order.shipAddress2 && <p className="text-text-primary">{order.shipAddress2}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Code postal</p>
                <p className="text-text-primary">{order.shipZipCode}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Ville</p>
                <p className="text-text-primary">{order.shipCity}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Pays</p>
              <p className="text-text-primary">{order.shipCountry}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Email</p>
                <p className="text-text-primary">{order.clientEmail}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Téléphone</p>
                <p className="text-text-primary">{order.clientPhone}</p>
              </div>
            </div>
            {order.clientVatNumber && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">N° TVA</p>
                <p className="text-text-primary font-mono text-xs">{order.clientVatNumber}</p>
              </div>
            )}
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border table-header">
            <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
              Facturation
            </h2>
          </div>
          <div className="px-5 py-4 text-sm font-body space-y-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Société</p>
              <p className="text-text-primary">{order.clientCompany}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Prénom</p>
                <p className="text-text-primary">{order.shipFirstName}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Nom</p>
                <p className="text-text-primary">{order.shipLastName}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Adresse</p>
              <p className="text-text-primary">{order.shipAddress1}</p>
              {order.shipAddress2 && <p className="text-text-primary">{order.shipAddress2}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Code postal</p>
                <p className="text-text-primary">{order.shipZipCode}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Ville</p>
                <p className="text-text-primary">{order.shipCity}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Pays</p>
              <p className="text-text-primary">{order.shipCountry}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Email</p>
                <p className="text-text-primary">{order.clientEmail}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Téléphone</p>
                <p className="text-text-primary">{order.clientPhone}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">SIRET</p>
              <p className="text-text-primary font-mono text-xs">{order.clientSiret}</p>
            </div>
            {order.clientVatNumber && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">N° TVA</p>
                <p className="text-text-primary font-mono text-xs">{order.clientVatNumber}</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Facture + Avoir */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border table-header">
            <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
              Facture client
            </h2>
          </div>
          <div className="px-5 py-4">
            <InvoiceUpload orderId={order.id} hasInvoice={!!order.invoicePath} />
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border table-header">
            <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
              Avoir
            </h2>
          </div>
          <div className="px-5 py-4">
            <CreditNoteUpload orderId={order.id} hasCreditNote={!!order.creditNotePath} />
          </div>
        </section>
      </div>

      {/* Articles (editor + modifications) */}
      <OrderItemsEditor
        orderId={order.id}
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

      {/* Récap + Transporteur */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2" />
        <div className="space-y-5">
          {/* Récap financier */}
          <section className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border table-header">
              <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
                Récapitulatif
              </h2>
            </div>
            <div className="px-5 py-4 space-y-2 text-sm font-body">
              <div className="flex justify-between text-text-secondary">
                <span>Sous-total HT</span>
                <span className="font-medium text-text-primary">{fmt(order.subtotalHT)}</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>TVA ({order.tvaRate === 0 ? "0% — exonéré" : `${(order.tvaRate * 100).toFixed(0)}%`})</span>
                <span className="font-medium text-text-primary">{fmt(order.tvaAmount)}</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>Livraison</span>
                <span className="font-medium text-text-primary">
                  {Number(order.carrierPrice) === 0 ? "Gratuit" : fmt(order.carrierPrice)}
                </span>
              </div>
              <div className="border-t border-border pt-3 flex justify-between items-center">
                <span className="font-semibold text-text-primary">Total TTC</span>
                <span className="font-heading font-semibold text-lg text-text-primary">
                  {fmt(order.totalTTC)}
                </span>
              </div>
            </div>
          </section>

          {/* Transporteur */}
          <section className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border table-header">
              <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
                Transporteur
              </h2>
            </div>
            <div className="px-5 py-4 space-y-2 text-sm font-body">
              <p className="font-medium text-text-primary">{order.carrierName}</p>
              {order.eeTrackingId && (
                <p className="text-xs font-mono text-text-secondary bg-bg-tertiary px-2 py-1 rounded inline-block">
                  Suivi : {order.eeTrackingId}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">{label}</p>
      <p className={`mt-0.5 text-sm text-text-primary ${mono ? "font-mono" : "font-body"}`}>
        {value}
      </p>
    </div>
  );
}
