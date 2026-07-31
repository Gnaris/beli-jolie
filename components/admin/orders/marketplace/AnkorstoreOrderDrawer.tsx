"use client";

import Link from "next/link";
import type { AnkorstoreOrderDetailFull } from "@/app/actions/admin/ankorstore-orders";
import MarketplaceBadge from "./MarketplaceBadge";
import { DrawerShell } from "@/components/admin/widgets-rail/DrawerShell";

const STATUS_META = {
  NEW: { label: "Soumise", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  VALIDATED: { label: "Confirmée", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  SHIPPED: { label: "Expédiée", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Annulée", cls: "bg-rose-50 text-rose-700 border-rose-200" },
} as const;

const BILLING_ITEM_LABELS: Record<string, string> = {
  brand_payment_fees: "Frais de paiement Ankor",
  brand_flat_shipping_fees: "Frais de livraison forfaitaires",
  brand_shipping_fees: "Frais de livraison",
  brand_service_fees: "Frais de service",
};

function formatEur(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

interface Props {
  order: AnkorstoreOrderDetailFull;
  onClose: () => void;
}

export default function AnkorstoreOrderDrawer({ order, onClose }: Props) {
  const meta = STATUS_META[order.status];
  const canceledOrRejected =
    order.brandRejectReason ||
    order.retailerRejectReason ||
    order.retailerCancellationRequestReason;

  return (
    <DrawerShell
      open
      onClose={onClose}
      accent="sky"
      eyebrow="Commande Ankorstore"
      title={<span className="font-mono">#{order.reference}</span>}
      size="fullscreen"
      icon={<MarketplaceBadge source="ANKORSTORE" size="md" />}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
        {/* Bandeau statut + totaux */}
        <section className="rounded-2xl border border-border bg-bg-primary shadow-sm p-5 lg:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className={`inline-block rounded-full text-xs px-3 py-0.5 font-medium border ${meta.cls}`}
                >
                  {meta.label}
                </span>
                <span className="text-xs text-text-muted" title={order.statusRaw}>
                  {order.statusRaw.replaceAll("_", " ")}
                </span>
                {order.trackingNumber && (
                  <span className="text-xs text-text-secondary">
                    Suivi <span className="font-mono">{order.trackingNumber}</span>
                  </span>
                )}
              </div>
              <div className="text-sm text-text-secondary mt-2">
                Reçue le{" "}
                {new Date(order.createdAtAnkor).toLocaleString("fr-FR", {
                  dateStyle: "long",
                  timeStyle: "short",
                })}
              </div>
            </div>
            <div className="lg:text-right">
              <div className="font-heading text-3xl font-bold text-text-primary tabular-nums">
                {formatEur(order.brandTotalAmountWithVat)}
              </div>
              <div className="text-xs text-text-muted mt-1">
                TTC · HT {formatEur(order.brandTotalAmount)}
              </div>
              <div className="text-xs text-text-muted">
                Net (après frais) {formatEur(order.brandNetAmount)}
              </div>
            </div>
          </div>
        </section>

        {canceledOrRejected && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5 text-sm space-y-1">
            <div className="text-xs uppercase tracking-[0.18em] text-rose-700 font-semibold">
              Annulation / rejet
            </div>
            {order.brandRejectReason && (
              <div className="text-rose-900">
                <span className="text-rose-600">Rejetée par la marque : </span>
                {order.brandRejectReason}
              </div>
            )}
            {order.retailerRejectReason && (
              <div className="text-rose-900">
                <span className="text-rose-600">Rejetée par le retailer : </span>
                {order.retailerRejectReason}
              </div>
            )}
            {order.retailerCancellationRequestReason && (
              <div className="text-rose-900">
                <span className="text-rose-600">Demande d&apos;annulation : </span>
                {order.retailerCancellationRequestReason}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* Colonne gauche : adresses + suivi + fiche */}
          <div className="lg:col-span-5 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <AddressBlock
                title="Livraison"
                name={order.shippingAddress?.name ?? order.customerName}
                organisation={order.shippingAddress?.organisation ?? order.customerShop}
                extras={[order.customerPhone, order.customerEmail]}
                address={order.shippingAddress}
                carrier={
                  order.carrier
                    ? order.carrier[0].toUpperCase() + order.carrier.slice(1)
                    : order.shippingMethod
                }
              />
              <AddressBlock
                title="Facturation"
                name={order.billingAddress?.name ?? order.customerName}
                organisation={order.billingAddress?.organisation ?? order.customerShop}
                extras={[
                  order.customerSiret ? `SIRET ${order.customerSiret}` : null,
                  order.customerVatNumber ? `TVA ${order.customerVatNumber}` : null,
                ]}
                address={order.billingAddress}
              />
            </div>

            {order.adminClientCardId && (
              <div className="rounded-2xl border border-border bg-bg-secondary p-4 text-sm flex items-center justify-between">
                <span className="text-text-secondary">Fiche client rattachée</span>
                <Link
                  href={`/admin/utilisateurs?tab=fiches&card=${order.adminClientCardId}`}
                  className="text-text-primary font-medium hover:underline"
                >
                  Ouvrir la fiche →
                </Link>
              </div>
            )}

            {(order.trackingNumber || order.trackingStatus) && (
              <div className="rounded-2xl border border-border bg-bg-secondary p-4 text-sm space-y-2">
                <div className="text-xs uppercase tracking-[0.18em] text-text-muted font-semibold">
                  Suivi
                </div>
                {order.trackingNumber && (
                  <div>
                    <span className="text-text-muted">Numéro : </span>
                    <span className="font-mono font-semibold text-text-primary">
                      {order.trackingNumber}
                    </span>
                  </div>
                )}
                {order.trackingStatus && (
                  <div>
                    <span className="text-text-muted">Statut : </span>
                    <span className="font-medium text-text-primary">
                      {order.trackingStatusDetails || order.trackingStatus}
                    </span>
                    {order.trackingUpdatedAt && (
                      <span className="text-text-muted text-xs ml-1.5">
                        · {new Date(order.trackingUpdatedAt).toLocaleString("fr-FR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    )}
                  </div>
                )}
                {order.trackingLink && (
                  <a
                    href={order.trackingLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-text-primary hover:underline"
                  >
                    Ouvrir le suivi transporteur ↗
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Colonne droite : articles + frais */}
          <div className="lg:col-span-7 space-y-5">
            <section className="rounded-2xl border border-border bg-bg-primary shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between text-xs uppercase tracking-[0.2em] text-text-muted">
                <span>Articles</span>
                <span className="normal-case tracking-normal text-text-secondary">
                  {order.items.reduce((s, i) => s + i.multipliedQuantity, 0)} pièces ·{" "}
                  {order.items.length} lignes
                </span>
              </div>
              <ul className="divide-y divide-border">
                {order.items.map((it) => {
                  const missing = !it.productId;
                  return (
                    <li
                      key={it.id}
                      className={`flex items-start gap-4 px-5 py-4 ${missing ? "bg-amber-50/40" : ""}`}
                    >
                      <div
                        className={`w-14 h-14 rounded-lg border flex items-center justify-center text-xs shrink-0 overflow-hidden ${
                          missing
                            ? "bg-amber-100 border-amber-200 text-amber-600"
                            : "bg-bg-secondary border-border text-text-muted"
                        }`}
                      >
                        {missing ? "?" : "IMG"}
                      </div>
                      <div className="flex-1 min-w-0">
                        {missing ? (
                          <div className="font-semibold italic text-text-muted">
                            Produit non présent sur notre site
                          </div>
                        ) : (
                          <Link
                            href={`/admin/produits/${it.productId}`}
                            className="font-semibold text-text-primary hover:underline"
                          >
                            {it.productName || it.sku}
                          </Link>
                        )}
                        <div className="text-xs text-text-muted mt-0.5">
                          {it.sku}
                          {it.variantOptionLabel ? ` · ${it.variantOptionLabel}` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm text-text-secondary tabular-nums">
                          {it.multipliedQuantity} × {formatEur(it.unitPriceHT)}
                        </div>
                        <div className="text-xs text-text-muted tabular-nums">
                          = {formatEur(it.totalPriceHT)} HT
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {order.billingItems.length > 0 && (
              <section className="rounded-2xl border border-border bg-bg-secondary/40 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-border text-xs uppercase tracking-[0.2em] text-text-muted">
                  Frais Ankorstore
                </div>
                <ul className="divide-y divide-border">
                  {order.billingItems.map((bi, i) => (
                    <li key={i} className="flex items-center justify-between px-5 py-3">
                      <span className="text-sm text-text-secondary">
                        {BILLING_ITEM_LABELS[bi.type] ?? bi.type.replaceAll("_", " ")}
                      </span>
                      <span
                        className={`text-sm tabular-nums ${
                          bi.amountHT < 0 ? "text-rose-600" : "text-text-primary"
                        }`}
                      >
                        {formatEur(bi.amountHT)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="text-right text-xs text-text-muted">
              Lecture seule — commande gérée sur Ankorstore.
            </div>
          </div>
        </div>
      </div>
    </DrawerShell>
  );
}

function AddressBlock({
  title,
  name,
  organisation,
  extras,
  address,
  carrier,
}: {
  title: string;
  name: string | null;
  organisation?: string | null;
  extras?: (string | null)[];
  address: {
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null;
  carrier?: string | null;
}) {
  return (
    <div className="rounded-2xl bg-bg-secondary border border-border p-4">
      <div className="text-xs uppercase tracking-wider text-text-muted mb-2">{title}</div>
      <div className="font-semibold text-text-primary">{name ?? "—"}</div>
      {organisation && organisation !== name && (
        <div className="text-sm text-text-secondary">{organisation}</div>
      )}
      {extras?.filter(Boolean).map((line, i) => (
        <div key={i} className="text-sm text-text-secondary">
          {line}
        </div>
      ))}
      {address && (
        <div className="text-sm text-text-secondary mt-1">
          {address.street && <div>{address.street}</div>}
          <div>
            {address.postalCode ? address.postalCode + " " : ""}
            {address.city ?? ""}
            {address.country ? ` · ${address.country}` : ""}
          </div>
        </div>
      )}
      {carrier && <div className="text-xs text-text-muted mt-2">Transporteur : {carrier}</div>}
    </div>
  );
}
