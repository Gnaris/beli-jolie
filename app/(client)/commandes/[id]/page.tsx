import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CancelOrderButton from "@/components/client/CancelOrderButton";
import SuccessToast from "@/components/client/SuccessToast";
import BankTransferDetails from "@/components/client/BankTransferDetails";
import { STATUS_CONFIG, getTrackingUrl } from "@/app/(client)/commandes/page";

export const metadata: Metadata = {
  title: "Detail commande — Beli & Jolie",
  robots: { index: false, follow: false },
};

export default async function CommandeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ awaiting_transfer?: string }>;
}) {
  const { id } = await params;
  const { awaiting_transfer } = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion?callbackUrl=/commandes");

  const order = await prisma.order.findFirst({
    where: { id, userId: session.user.id },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  if (!order) notFound();

  const cfg         = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.PENDING;
  const trackingUrl = order.eeTrackingId ? getTrackingUrl(order.carrierName, order.eeTrackingId) : null;
  const date        = new Date(order.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });

  // Etapes de suivi
  const steps: { status: string; label: string; done: boolean }[] = [
    { status: "PENDING",    label: "Commande recue",  done: true },
    { status: "PROCESSING", label: "En preparation",  done: ["PROCESSING", "SHIPPED", "DELIVERED"].includes(order.status) },
    { status: "SHIPPED",    label: "Expediee",        done: ["SHIPPED", "DELIVERED"].includes(order.status) },
    { status: "DELIVERED",  label: "Livree",          done: order.status === "DELIVERED" },
  ];
  const isCancelled = order.status === "CANCELLED";

  return (
    <div className="p-6 md:p-8 max-w-3xl space-y-6">
      <SuccessToast />

      {/* Fil d'Ariane */}
      <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#9CA3AF]">
        <Link href="/commandes" className="hover:text-[#1A1A1A] transition-colors">Mes commandes</Link>
        <span>/</span>
        <span className="text-[#1A1A1A] font-medium">{order.orderNumber}</span>
      </div>

      {/* En-tete */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#1A1A1A]">
            {order.orderNumber}
          </h1>
          <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)] mt-0.5">{date}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-[family-name:var(--font-roboto)] font-medium ${cfg.bgClass} ${cfg.textClass}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {cfg.label}
          </span>
          {order.status === "PENDING" && (
            <CancelOrderButton orderId={order.id} orderNumber={order.orderNumber} />
          )}
        </div>
      </div>

      {/* Bandeau virement en attente + coordonnées bancaires */}
      {(awaiting_transfer === "1" || order.paymentStatus === "awaiting_transfer") && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-[#FEF3C7] flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-[#D97706]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#92400E]">
                Virement bancaire en attente
              </h3>
              <p className="text-xs font-[family-name:var(--font-roboto)] text-[#92400E] mt-1">
                Veuillez effectuer le virement bancaire aux coordonnees ci-dessous.
                La commande sera automatiquement validee des reception du virement (generalement sous 1 jour ouvre).
              </p>
              <BankTransferDetails orderId={order.id} />
            </div>
          </div>
        </div>
      )}

      {/* -- Suivi -- */}
      {!isCancelled && (
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-5">
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A] mb-4">
            Suivi de la commande
          </h2>
          <div className="relative">
            {/* Barre de progression */}
            <div className="absolute top-3.5 left-3.5 right-3.5 h-0.5 bg-[#E5E5E5]" />
            <div
              className="absolute top-3.5 left-3.5 h-0.5 bg-[#1A1A1A] transition-all duration-500"
              style={{ width: `${(steps.filter((s) => s.done).length - 1) / (steps.length - 1) * 100}%` }}
            />
            <div className="relative flex justify-between">
              {steps.map((step) => (
                <div key={step.status} className="flex flex-col items-center gap-2">
                  <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center z-10 transition-colors ${
                    step.done
                      ? "bg-[#1A1A1A] border-[#1A1A1A] text-white"
                      : "bg-white border-[#E5E5E5] text-[#E5E5E5]"
                  }`}>
                    {step.done ? (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-[#E5E5E5]" />
                    )}
                  </div>
                  <span className={`text-[10px] font-[family-name:var(--font-roboto)] text-center max-w-16 ${
                    step.done ? "text-[#1A1A1A] font-medium" : "text-[#9CA3AF]"
                  }`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Numero de suivi */}
          {order.eeTrackingId && (
            <div className="mt-5 pt-4 border-t border-[#E5E5E5] flex flex-wrap items-center gap-3">
              <div>
                <p className="text-xs font-[family-name:var(--font-roboto)] text-[#9CA3AF]">Numero de suivi</p>
                <p className="font-mono text-sm font-medium text-[#1A1A1A] mt-0.5">{order.eeTrackingId}</p>
              </div>
              {trackingUrl && (
                <a
                  href={trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#1A1A1A] hover:bg-[#333] text-white text-xs font-[family-name:var(--font-roboto)] font-medium rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  Suivre sur {order.carrierName}
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* -- Facture -- */}
      {order.invoicePath && (
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
              Facture
            </h2>
            <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
              Votre facture est disponible en telechargement
            </p>
          </div>
          <a
            href={`/api/client/commandes/${order.id}/invoice`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] hover:bg-[#333] text-white text-sm font-[family-name:var(--font-roboto)] font-medium rounded-lg transition-colors shrink-0"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Telecharger la facture
          </a>
        </div>
      )}

      {/* -- Articles -- */}
      <div className="bg-white border border-[#E5E5E5] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E5E5E5]">
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
            Articles ({order.items.reduce((s, i) => s + i.quantity, 0)})
          </h2>
        </div>
        <div className="divide-y divide-[#F0F0F0]">
          {order.items.map((item) => (
            <div key={item.id} className="px-5 py-4 flex items-center gap-4">
              {/* Image */}
              <div className="w-14 h-14 bg-[#EFEFEF] rounded-lg overflow-hidden shrink-0">
                {item.imagePath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imagePath} alt={item.productName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                        d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Info produit */}
              <div className="flex-1 min-w-0">
                <p className="font-[family-name:var(--font-roboto)] font-medium text-sm text-[#1A1A1A] truncate">{item.productName}</p>
                <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5 font-mono">{item.productRef}</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  <span className="text-[10px] bg-[#F7F7F8] text-[#6B6B6B] px-2 py-0.5 rounded-full font-[family-name:var(--font-roboto)]">
                    {item.colorName}
                  </span>
                  {item.size && (
                    <span className="text-[10px] bg-[#F7F7F8] text-[#6B6B6B] px-2 py-0.5 rounded-full font-[family-name:var(--font-roboto)]">
                      T. {item.size}
                    </span>
                  )}
                  <span className="text-[10px] bg-[#F7F7F8] text-[#6B6B6B] px-2 py-0.5 rounded-full font-[family-name:var(--font-roboto)]">
                    {item.saleType === "PACK" ? `Lot x${item.packQty}` : "A l'unite"}
                  </span>
                </div>
              </div>

              {/* Qte + prix */}
              <div className="text-right shrink-0">
                <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">x{item.quantity}</p>
                <p className="font-[family-name:var(--font-roboto)] font-semibold text-sm text-[#1A1A1A] mt-0.5">
                  {item.lineTotal.toFixed(2)} €
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Totaux */}
        <div className="px-5 py-4 bg-[#F7F7F8] border-t border-[#E5E5E5] space-y-1.5">
          <div className="flex justify-between text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B]">
            <span>Sous-total HT</span>
            <span>{order.subtotalHT.toFixed(2)} €</span>
          </div>
          <div className="flex justify-between text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B]">
            <span>Livraison ({order.carrierName})</span>
            <span>{order.carrierPrice === 0 ? "Gratuit" : `${order.carrierPrice.toFixed(2)} €`}</span>
          </div>
          <div className="flex justify-between text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B]">
            <span>TVA ({(order.tvaRate * 100).toFixed(0)} %)</span>
            <span>{order.tvaAmount.toFixed(2)} €</span>
          </div>
          {order.tvaRate === 0 && (
            <p className="text-[10px] text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
              TVA exoneree — autoliquidation ou hors UE
            </p>
          )}
          <div className="flex justify-between font-[family-name:var(--font-poppins)] font-semibold text-base text-[#1A1A1A] pt-2 border-t border-[#E5E5E5]">
            <span>Total TTC</span>
            <span>{order.totalTTC.toFixed(2)} €</span>
          </div>
        </div>
      </div>

      {/* -- Adresse de livraison -- */}
      <div className="bg-white border border-[#E5E5E5] rounded-xl p-5">
        <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A] mb-3">
          Adresse de livraison
        </h2>
        <address className="not-italic text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B] leading-relaxed">
          <p className="font-medium text-[#1A1A1A]">{order.shipFirstName} {order.shipLastName}</p>
          {order.shipCompany && <p>{order.shipCompany}</p>}
          <p>{order.shipAddress1}</p>
          {order.shipAddress2 && <p>{order.shipAddress2}</p>}
          <p>{order.shipZipCode} {order.shipCity}</p>
          <p>{order.shipCountry}</p>
        </address>
      </div>

      {/* -- Infos client -- */}
      <div className="bg-white border border-[#E5E5E5] rounded-xl p-5">
        <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A] mb-3">
          Informations de facturation
        </h2>
        <div className="text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B] space-y-1">
          <p><span className="font-medium text-[#1A1A1A]">{order.clientCompany}</span></p>
          <p>{order.clientEmail}</p>
          <p>{order.clientPhone}</p>
          <p className="text-xs text-[#9CA3AF]">SIRET : {order.clientSiret}</p>
          {order.clientVatNumber && <p className="text-xs text-[#9CA3AF]">N\u00B0 TVA : {order.clientVatNumber}</p>}
        </div>
      </div>

      {/* Retour */}
      <Link href="/commandes" className="inline-flex items-center gap-1.5 text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        Retour a mes commandes
      </Link>
    </div>
  );
}
