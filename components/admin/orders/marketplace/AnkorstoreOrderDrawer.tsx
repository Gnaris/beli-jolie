"use client";

import Link from "next/link";
import type { AnkorstoreOrderDetailFull } from "@/app/actions/admin/ankorstore-orders";
import MarketplaceBadge from "./MarketplaceBadge";
import { DrawerShell } from "@/components/admin/widgets-rail/DrawerShell";

const STATUS_META = {
  NEW: { label: "Nouvelle", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  VALIDATED: { label: "Confirmée", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  SHIPPED: { label: "Expédiée", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Annulée", cls: "bg-rose-50 text-rose-700 border-rose-200" },
} as const;

interface Props {
  order: AnkorstoreOrderDetailFull;
  onClose: () => void;
}

function formatMoney(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

export default function AnkorstoreOrderDrawer({ order, onClose }: Props) {
  const meta = STATUS_META[order.status];

  return (
    <DrawerShell
      open
      onClose={onClose}
      accent="sky"
      eyebrow="Commande Ankorstore"
      title={<span className="font-mono">{order.reference}</span>}
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
                <span className="text-xs text-text-muted">
                  {order.statusRaw}
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
              {order.brandRejectReason && (
                <div className="text-sm text-rose-700 mt-2">
                  Motif refus : {order.brandRejectReason}
                </div>
              )}
            </div>
            <div className="lg:text-right">
              <div className="font-heading text-3xl font-bold text-text-primary tabular-nums">
                {formatMoney(order.brandTotalAmountWithVat)}
              </div>
              <div className="text-xs text-text-muted mt-1">
                TTC · HT {formatMoney(order.brandTotalAmount)}
              </div>
              <div className="text-xs text-text-muted">
                Reçu net {formatMoney(order.brandNetAmount)} (après frais Ankor)
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* Colonne gauche : adresses + suivi + fiche */}
          <div className="lg:col-span-5 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <AddressBlock
                title="Livraison"
                name={order.customerName}
                extras={[order.customerShop, order.customerEmail]}
                address={order.shippingAddress}
                carrier={order.carrier}
              />
              <AddressBlock
                title="Facturation"
                name={order.customerName}
                extras={[
                  order.customerVatNumber ? `TVA ${order.customerVatNumber}` : null,
                  order.customerSiret ? `SIRET ${order.customerSiret}` : null,
                ]}
                address={order.billingAddress}
                payment={order.shippingMethod}
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

            {(order.trackingNumber || order.trackingLink) && (
              <div className="rounded-2xl border border-border bg-bg-secondary p-4 text-sm space-y-2">
                <div className="text-xs uppercase tracking-[0.18em] text-text-muted font-semibold">
                  Suivi
                </div>
                {order.carrier && (
                  <div>
                    <span className="text-text-muted">Transporteur : </span>
                    <span className="text-text-primary">{order.carrier}</span>
                  </div>
                )}
                {order.trackingNumber && (
                  <div>
                    <span className="text-text-muted">Numéro : </span>
                    <span className="font-mono font-semibold text-text-primary">
                      {order.trackingNumber}
                    </span>
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
                {order.trackingStatus && (
                  <div className="text-xs text-text-muted">
                    État : {order.trackingStatus}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Colonne droite : articles */}
          <div className="lg:col-span-7 space-y-5">
            <section className="rounded-2xl border border-border bg-bg-primary shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between text-xs uppercase tracking-[0.2em] text-text-muted">
                <span>
                  Articles ·{" "}
                  <span className="normal-case tracking-normal text-text-secondary">
                    {order.items.reduce((s, i) => s + i.multipliedQuantity, 0)} pièces ·{" "}
                    {order.items.length} lignes
                  </span>
                </span>
              </div>
              <ul className="divide-y divide-border">
                {order.items.map((it) => {
                  const missing = !it.productId;
                  return (
                    <li
                      key={it.id}
                      className={`flex items-start gap-4 px-5 py-4 ${
                        missing ? "bg-amber-50/40" : ""
                      }`}
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
                        {it.quantity !== it.multipliedQuantity && (
                          <div className="mt-1 text-[11.5px] text-text-secondary">
                            {it.quantity} lot(s) × unité = {it.multipliedQuantity} pièces
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm text-text-secondary tabular-nums">
                          {it.multipliedQuantity} × {formatMoney(it.unitPriceHT)}
                        </div>
                        <div className="text-xs text-text-muted tabular-nums">
                          = {formatMoney(it.totalPriceHT)} HT
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <div className="text-right text-xs text-text-muted">
              Lecture seule — commande gérée sur fr.ankorstore.com.
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
  extras,
  address,
  carrier,
  payment,
}: {
  title: string;
  name: string;
  extras?: (string | null)[];
  address: {
    name: string | null;
    company: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null;
  carrier?: string | null;
  payment?: string | null;
}) {
  return (
    <div className="rounded-2xl bg-bg-secondary border border-border p-4">
      <div className="text-xs uppercase tracking-wider text-text-muted mb-2">{title}</div>
      <div className="font-semibold text-text-primary">{name}</div>
      {extras?.filter(Boolean).map((line, i) => (
        <div key={i} className="text-sm text-text-secondary">
          {line}
        </div>
      ))}
      {address && (
        <div className="text-sm text-text-secondary mt-1">
          {address.company && <div>{address.company}</div>}
          {address.name && address.name !== name && <div>{address.name}</div>}
          {address.street && <div>{address.street}</div>}
          <div>
            {address.postalCode ? address.postalCode + " " : ""}
            {address.city ?? ""}
            {address.country ? ` · ${address.country}` : ""}
          </div>
        </div>
      )}
      {carrier && <div className="text-xs text-text-muted mt-2">Transporteur : {carrier}</div>}
      {payment && <div className="text-xs text-text-muted mt-2">Livraison : {payment}</div>}
    </div>
  );
}
