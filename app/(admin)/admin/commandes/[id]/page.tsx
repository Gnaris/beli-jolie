import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OrderStatusActions from "@/components/admin/orders/OrderStatusActions";
import InvoiceUpload from "@/components/admin/orders/InvoiceUpload";

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
    include: { items: { orderBy: { createdAt: "asc" } } },
    // invoicePath is a scalar field, included by default
  });

  if (!order) notFound();

  const st = STATUS_CFG[order.status] ?? STATUS_CFG.PENDING;

  const fmt = (n: number) => n.toFixed(2).replace(".", ",") + " €";

  return (
    <div className="space-y-6">

      {/* En-tête */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <Link href="/admin/commandes"
            className="text-xs text-text-muted hover:text-text-primary font-[family-name:var(--font-roboto)] flex items-center gap-1 mb-3 transition-colors">
            ← Toutes les commandes
          </Link>
          <h1 className="page-title">
            Commande {order.orderNumber}
          </h1>
          <p className="text-sm text-text-secondary font-[family-name:var(--font-roboto)] mt-0.5">
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
          Télécharger le bon de commande PDF
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

      {/* Facture client */}
      <section className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border table-header">
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary uppercase tracking-wide">
            Facture client
          </h2>
        </div>
        <div className="px-5 py-4">
          <InvoiceUpload orderId={order.id} hasInvoice={!!order.invoicePath} />
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* -- Colonne principale -- */}
        <div className="xl:col-span-2 space-y-5">

          {/* Articles */}
          <section className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border table-header">
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary uppercase tracking-wide">
                Articles commandés ({order.items.length})
              </h2>
            </div>
            <div className="divide-y divide-border-light">
              {order.items.map((item) => (
                <div key={item.id} className="flex gap-4 px-5 py-4">
                  {/* Image */}
                  <div className="w-12 h-12 sm:w-16 sm:h-16 shrink-0 bg-bg-tertiary border border-border rounded-lg overflow-hidden">
                    {item.imagePath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imagePath} alt={item.productName}
                        className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)]">
                      {item.productName}
                    </p>
                    <p className="text-xs font-mono text-text-muted mt-0.5">{item.productRef}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <span className="badge badge-neutral">
                        {item.colorName}
                      </span>
                      {item.saleType === "PACK" && (
                        <span className="badge badge-neutral">
                          Paquet ×{item.packQty}
                        </span>
                      )}
                      {item.size && (
                        <span className="badge badge-neutral">
                          Taille {item.size}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Prix */}
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-text-primary font-[family-name:var(--font-poppins)]">
                      {fmt(item.lineTotal)}
                    </p>
                    <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
                      {item.quantity} × {fmt(item.unitPrice)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Client */}
          <section className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border table-header">
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary uppercase tracking-wide">
                Client
              </h2>
            </div>
            <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
              <InfoRow label="Société"   value={order.clientCompany} />
              <InfoRow label="Email"     value={order.clientEmail} />
              <InfoRow label="Téléphone" value={order.clientPhone} />
              <InfoRow label="SIRET"     value={order.clientSiret} mono />
              {order.clientVatNumber && (
                <InfoRow label="N° TVA" value={order.clientVatNumber} mono />
              )}
            </div>
          </section>
        </div>

        {/* -- Colonne latérale -- */}
        <div className="space-y-5">

          {/* Récap financier */}
          <section className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border table-header">
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary uppercase tracking-wide">
                Récapitulatif
              </h2>
            </div>
            <div className="px-5 py-4 space-y-2 text-sm font-[family-name:var(--font-roboto)]">
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
                  {order.carrierPrice === 0 ? "Gratuit" : fmt(order.carrierPrice)}
                </span>
              </div>
              <div className="border-t border-border pt-3 flex justify-between items-center">
                <span className="font-semibold text-text-primary">Total TTC</span>
                <span className="font-[family-name:var(--font-poppins)] font-semibold text-lg text-text-primary">
                  {fmt(order.totalTTC)}
                </span>
              </div>
            </div>
          </section>

          {/* Livraison */}
          <section className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border table-header">
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary uppercase tracking-wide">
                Livraison
              </h2>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm font-[family-name:var(--font-roboto)]">
              <p className="font-medium text-text-primary">{order.carrierName}</p>
              {order.eeTrackingId && (
                <p className="text-xs font-mono text-text-secondary bg-bg-tertiary px-2 py-1 rounded inline-block">
                  Suivi : {order.eeTrackingId}
                </p>
              )}
              <div className="border-t border-border pt-3 text-text-secondary leading-relaxed">
                <p className="font-medium text-text-primary">{order.shipLabel}</p>
                <p>{order.shipFirstName} {order.shipLastName}{order.shipCompany ? ` — ${order.shipCompany}` : ""}</p>
                <p>{order.shipAddress1}</p>
                {order.shipAddress2 && <p>{order.shipAddress2}</p>}
                <p>{order.shipZipCode} {order.shipCity}</p>
                <p>{order.shipCountry}</p>
              </div>
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
      <p className={`mt-0.5 text-sm text-text-primary ${mono ? "font-mono" : "font-[family-name:var(--font-roboto)]"}`}>
        {value}
      </p>
    </div>
  );
}
