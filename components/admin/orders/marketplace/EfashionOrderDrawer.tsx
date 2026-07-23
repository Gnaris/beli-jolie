"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { EfashionOrderDetailFull } from "@/app/actions/admin/efashion-orders";
import MarketplaceBadge from "./MarketplaceBadge";

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = STATUS_META[order.status];
  const invoiceUrl = `/api/admin/efashion-invoice/${order.efashionOrderId}`;

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <aside
        className="relative ml-auto w-full max-w-2xl bg-bg-primary h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-bg-primary border-b border-border p-5 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <MarketplaceBadge source="EFASHION" size="md" />
              <h2 className="font-heading text-xl font-bold text-text-primary font-mono">
                {order.orderNumber}
              </h2>
              <span className={`inline-block rounded-full text-xs px-3 py-0.5 font-medium border ${meta.cls}`}>
                {meta.label}
              </span>
              {order.isFirstOrder && (
                <span className="rounded-full text-xs px-3 py-0.5 font-medium border bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700">
                  1ère commande
                </span>
              )}
            </div>
            <div className="text-sm text-text-secondary mt-1">
              {new Date(order.createdAt).toLocaleString("fr-FR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
              {" · "}
              <span title={order.statusLabelFr}>{order.statusLabelFr}</span>
              {order.trackingNumber && (
                <> · Suivi {order.trackingNumber}</>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="font-heading text-2xl font-bold text-text-primary">
              {order.totalHT.toFixed(2).replace(".", ",")} €
            </div>
            <div className="text-xs text-text-muted">
              HT · Après remise {order.totalAfterDiscount.toFixed(2).replace(".", ",")} €
            </div>
            {order.shippingCost != null && (
              <div className="text-xs text-text-muted">
                Frais de port {order.shippingCost.toFixed(2).replace(".", ",")} €
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-2 text-xs text-text-muted hover:text-text-primary underline"
            >
              Fermer
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid md:grid-cols-2 gap-4">
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
            <div className="rounded-xl border border-border bg-bg-secondary p-4 text-sm flex items-center justify-between">
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
            <div className="rounded-xl border border-border bg-bg-secondary p-4 text-sm space-y-2">
              {order.trackingNumber && (
                <div>
                  <span className="text-text-muted">Numéro de suivi : </span>
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
                  Télécharger l'étiquette (PDF) ↗
                </a>
              )}
            </div>
          )}

          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-text-muted mb-2 flex items-center justify-between">
              <span>
                Articles ({order.items.reduce((s, i) => s + i.qtyTotal, 0)} pièces ·{" "}
                {order.items.length} lignes)
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
            <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
              {order.items.map((it) => {
                const missing = !it.productId;
                return (
                  <li
                    key={it.id}
                    className={`flex items-start gap-3 px-4 py-3 ${missing ? "bg-amber-50/40" : ""}`}
                  >
                    <div
                      className={`w-11 h-11 rounded-md border flex items-center justify-center text-xs shrink-0 overflow-hidden ${
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
                      <div className="text-xs text-text-muted">
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
                    <div className="text-right">
                      <div className="text-sm text-text-secondary">
                        {it.qtyTotal} × {it.unitPriceHT.toFixed(2).replace(".", ",")} €
                      </div>
                      <div className="text-xs text-text-muted">
                        = {it.totalLineHT.toFixed(2).replace(".", ",")} € HT
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="text-right text-xs text-text-muted">
            Lecture seule — commande gérée sur eFashion Paris.
          </div>
        </div>
      </aside>
    </div>
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
    <div className="rounded-xl bg-bg-secondary border border-border p-4">
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
