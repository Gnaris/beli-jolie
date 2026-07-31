"use client";

import Link from "next/link";
import type { EfashionOrderDetailFull } from "@/app/actions/admin/efashion-orders";
import MarketplaceBadge from "./MarketplaceBadge";
import { DrawerShell } from "@/components/admin/widgets-rail/DrawerShell";

const STATUS_META = {
  NEW: { label: "Nouveau", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  VALIDATED: { label: "Validé", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  SHIPPED: { label: "Expédié", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Annulé", cls: "bg-rose-50 text-rose-700 border-rose-200" },
} as const;

interface Props {
  order: EfashionOrderDetailFull;
  onClose: () => void;
}

export default function EfashionOrderDrawer({ order, onClose }: Props) {
  const meta = STATUS_META[order.status];
  const invoiceUrl = `/api/admin/efashion-invoice/${order.efashionOrderId}`;

  return (
    <DrawerShell
      open
      onClose={onClose}
      accent="rose"
      eyebrow="Commande eFashion Paris"
      title={<span className="font-mono">{order.orderNumber}</span>}
      size="fullscreen"
      icon={<MarketplaceBadge source="EFASHION" size="md" />}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
        {/* Bandeau statut + totaux */}
        <section className="rounded-2xl border border-border bg-bg-primary shadow-sm p-5 lg:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`inline-block rounded-full text-xs px-3 py-0.5 font-medium border ${meta.cls}`}>
                  {meta.label}
                </span>
                {order.isFirstOrder && (
                  <span className="rounded-full text-xs px-3 py-0.5 font-medium border bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700">
                    1ère commande
                  </span>
                )}
                <span className="text-xs text-text-muted" title={order.statusLabelFr}>
                  {order.statusLabelFr}
                </span>
                {order.trackingNumber && (
                  <span className="text-xs text-text-secondary">
                    Suivi <span className="font-mono">{order.trackingNumber}</span>
                  </span>
                )}
              </div>
              <div className="text-sm text-text-secondary mt-2">
                Reçue le{" "}
                {new Date(order.createdAt).toLocaleString("fr-FR", {
                  dateStyle: "long",
                  timeStyle: "short",
                })}
              </div>
            </div>
            <div className="lg:text-right">
              <div className="font-heading text-3xl font-bold text-text-primary tabular-nums">
                {order.totalHT.toFixed(2).replace(".", ",")} €
              </div>
              <div className="text-xs text-text-muted mt-1">
                HT · Après remise {order.totalAfterDiscount.toFixed(2).replace(".", ",")} €
              </div>
              {order.shippingCost != null && (
                <div className="text-xs text-text-muted">
                  Frais de port {order.shippingCost.toFixed(2).replace(".", ",")} €
                </div>
              )}
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
                extras={[order.customerContact, order.customerEmail]}
                address={order.deliveryAddress}
                carrier={order.carrier}
              />
              <AddressBlock
                title="Facturation"
                name={order.customerName}
                extras={[
                  order.customerVatIntra ? `TVA ${order.customerVatIntra}` : null,
                  order.customerEori ? `EORI ${order.customerEori}` : null,
                ]}
                address={order.billingAddress}
                payment={order.paymentMethod}
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

            {(order.trackingNumber || order.labelUrl) && (
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
                {order.labelUrl && (
                  <a
                    href={order.labelUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-text-primary hover:underline"
                  >
                    Télécharger l&apos;étiquette (PDF) ↗
                  </a>
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
                    {order.items.reduce((s, i) => s + i.qtyTotal, 0)} pièces ·{" "}
                    {order.items.length} lignes
                  </span>
                </span>
                <a
                  href={invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="normal-case tracking-normal text-text-primary hover:underline"
                >
                  Facture PDF ↗
                </a>
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
                        {missing ? (
                          "?"
                        ) : it.productImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={it.productImage}
                            alt={it.productName ?? it.referenceFull}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          "IMG"
                        )}
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
                            {it.productName || it.referenceFull}
                          </Link>
                        )}
                        <div className="text-xs text-text-muted mt-0.5">
                          {it.referenceFull}
                          {it.colorLabelFr ? ` · ${it.colorLabelFr}` : ""}
                          {it.category ? ` · ${it.category}` : ""}
                          {it.provenanceCode ? ` · ${it.provenanceCode}` : ""}
                        </div>
                        {it.sizes.length > 0 && (
                          <div className="mt-1.5 text-[11.5px] text-text-secondary">
                            {it.sizes
                              .map((s) => `${s.sizeLabelFr ?? "?"} × ${s.quantity}`)
                              .join(" · ")}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm text-text-secondary tabular-nums">
                          {it.qtyTotal} × {it.unitPriceHT.toFixed(2).replace(".", ",")} €
                        </div>
                        <div className="text-xs text-text-muted tabular-nums">
                          = {it.totalLineHT.toFixed(2).replace(".", ",")} € HT
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <div className="text-right text-xs text-text-muted">
              Lecture seule — commande gérée sur eFashion Paris.
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
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    contact: string | null;
    phone: string | null;
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
          {address.contact && <div>{address.contact}</div>}
          {address.street && <div>{address.street}</div>}
          <div>
            {address.postalCode ? address.postalCode + " " : ""}
            {address.city ?? ""}
            {address.country ? ` · ${address.country}` : ""}
          </div>
          {address.phone && <div className="text-xs text-text-muted mt-1">Tél. {address.phone}</div>}
        </div>
      )}
      {carrier && <div className="text-xs text-text-muted mt-2">Transporteur : {carrier}</div>}
      {payment && <div className="text-xs text-text-muted mt-2">Paiement : {payment}</div>}
    </div>
  );
}
