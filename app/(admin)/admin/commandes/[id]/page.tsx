import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OrderStatusActions from "@/components/admin/orders/OrderStatusActions";

export const metadata: Metadata = { title: "Détail commande — Admin" };

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  PENDING:    { label: "En attente",     bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200" },
  PROCESSING: { label: "En préparation", bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200" },
  SHIPPED:    { label: "Expédiée",       bg: "bg-[#EEF5F1]",  text: "text-[#5E8470]",  border: "border-[#A8C5B0]" },
  DELIVERED:  { label: "Livrée",         bg: "bg-[#EEF5F1]",  text: "text-[#5E8470]",  border: "border-[#A8C5B0]" },
  CANCELLED:  { label: "Annulée",        bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200" },
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
            className="text-xs text-[#0F3460] hover:underline font-[family-name:var(--font-roboto)] flex items-center gap-1 mb-3">
            ← Toutes les commandes
          </Link>
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#0F172A]">
            Commande {order.orderNumber}
          </h1>
          <p className="text-sm text-[#475569] font-[family-name:var(--font-roboto)] mt-0.5">
            {new Date(order.createdAt).toLocaleDateString("fr-FR", {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
            })}
          </p>
        </div>

        {/* Statut + actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full border font-[family-name:var(--font-roboto)] ${st.bg} ${st.text} ${st.border}`}>
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
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#0F3460] text-white text-sm font-[family-name:var(--font-roboto)] font-medium hover:bg-[#0A2540] transition-colors"
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
            className="inline-flex items-center gap-2 px-4 py-2 border border-[#0F3460] text-[#0F3460] text-sm font-[family-name:var(--font-roboto)] font-medium hover:bg-[#0F3460] hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
            </svg>
            Bordereau d&apos;expédition Easy-Express
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ── Colonne principale ── */}
        <div className="xl:col-span-2 space-y-5">

          {/* Articles */}
          <section className="bg-white border border-[#E2E8F0]">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F1F5F9]">
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#0F172A] uppercase tracking-wide">
                Articles commandés ({order.items.length})
              </h2>
            </div>
            <div className="divide-y divide-[#F1F5F9]">
              {order.items.map((item) => (
                <div key={item.id} className="flex gap-4 px-5 py-4">
                  {/* Image */}
                  <div className="w-16 h-16 shrink-0 bg-[#F1F5F9] border border-[#E2E8F0] overflow-hidden">
                    {item.imagePath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imagePath} alt={item.productName}
                        className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-[#CBD5E1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0F172A] font-[family-name:var(--font-roboto)]">
                      {item.productName}
                    </p>
                    <p className="text-xs font-mono text-[#94A3B8] mt-0.5">{item.productRef}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <span className="text-xs bg-[#F1F5F9] text-[#475569] px-2 py-0.5 border border-[#E2E8F0]">
                        {item.colorName}
                      </span>
                      {item.saleType === "PACK" && (
                        <span className="text-xs bg-[#F1F5F9] text-[#475569] px-2 py-0.5 border border-[#E2E8F0]">
                          Paquet ×{item.packQty}
                        </span>
                      )}
                      {item.size && (
                        <span className="text-xs bg-[#F1F5F9] text-[#475569] px-2 py-0.5 border border-[#E2E8F0]">
                          Taille {item.size}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Prix */}
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-[#0F172A] font-[family-name:var(--font-poppins)]">
                      {fmt(item.lineTotal)}
                    </p>
                    <p className="text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] mt-0.5">
                      {item.quantity} × {fmt(item.unitPrice)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Client */}
          <section className="bg-white border border-[#E2E8F0]">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F1F5F9]">
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#0F172A] uppercase tracking-wide">
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

        {/* ── Colonne latérale ── */}
        <div className="space-y-5">

          {/* Récap financier */}
          <section className="bg-white border border-[#E2E8F0]">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F1F5F9]">
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#0F172A] uppercase tracking-wide">
                Récapitulatif
              </h2>
            </div>
            <div className="px-5 py-4 space-y-2 text-sm font-[family-name:var(--font-roboto)]">
              <div className="flex justify-between text-[#475569]">
                <span>Sous-total HT</span>
                <span className="font-medium text-[#0F172A]">{fmt(order.subtotalHT)}</span>
              </div>
              <div className="flex justify-between text-[#475569]">
                <span>TVA ({order.tvaRate === 0 ? "0% — exonéré" : `${(order.tvaRate * 100).toFixed(0)}%`})</span>
                <span className="font-medium text-[#0F172A]">{fmt(order.tvaAmount)}</span>
              </div>
              <div className="flex justify-between text-[#475569]">
                <span>Livraison</span>
                <span className="font-medium text-[#0F172A]">
                  {order.carrierPrice === 0 ? "Gratuit" : fmt(order.carrierPrice)}
                </span>
              </div>
              <div className="border-t border-[#E2E8F0] pt-3 flex justify-between items-center">
                <span className="font-semibold text-[#0F172A]">Total TTC</span>
                <span className="font-[family-name:var(--font-poppins)] font-semibold text-lg text-[#0F3460]">
                  {fmt(order.totalTTC)}
                </span>
              </div>
            </div>
          </section>

          {/* Livraison */}
          <section className="bg-white border border-[#E2E8F0]">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F1F5F9]">
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#0F172A] uppercase tracking-wide">
                Livraison
              </h2>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm font-[family-name:var(--font-roboto)]">
              <p className="font-medium text-[#0F172A]">{order.carrierName}</p>
              {order.eeTrackingId && (
                <p className="text-xs font-mono text-[#0F3460] bg-[#F1F5F9] px-2 py-1 inline-block">
                  Suivi : {order.eeTrackingId}
                </p>
              )}
              <div className="border-t border-[#F1F5F9] pt-3 text-[#475569] leading-relaxed">
                <p className="font-medium text-[#0F172A]">{order.shipLabel}</p>
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
      <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">{label}</p>
      <p className={`mt-0.5 text-sm text-[#0F172A] ${mono ? "font-mono" : "font-[family-name:var(--font-roboto)]"}`}>
        {value}
      </p>
    </div>
  );
}
