"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { FaireOrderDetailFull } from "@/app/actions/admin/faire-orders";
import MarketplaceBadge from "./MarketplaceBadge";

const STATUS_META = {
  NEW: { label: "À traiter", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  SHIPPED: { label: "Expédiée", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Annulée", cls: "bg-rose-50 text-rose-700 border-rose-200" },
} as const;

const STATUS_RAW_LABEL: Record<string, string> = {
  NEW: "Nouvelle",
  PROCESSING: "En traitement",
  BACKORDERED: "En rupture partielle",
  SHIPPED: "Expédiée",
  PRE_TRANSIT: "Étiquette générée",
  IN_TRANSIT: "En cours de livraison",
  DELIVERED: "Livrée",
  CANCELLED: "Annulée",
  CANCELED: "Annulée",
};

function formatCurrency(n: number, currency: string): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

interface Props {
  order: FaireOrderDetailFull;
  onClose: () => void;
}

export default function FaireOrderDrawer({ order, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = STATUS_META[order.status];
  const currency = order.currency || "EUR";
  const displayNumber = order.displayId ?? order.faireOrderId;
  const rawLabel = STATUS_RAW_LABEL[order.statusRaw] ?? order.statusRaw;

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
              <MarketplaceBadge source="FAIRE" size="md" />
              <h2 className="font-heading text-xl font-bold text-text-primary font-mono">
                {displayNumber}
              </h2>
              <span
                className={`inline-block rounded-full text-xs px-3 py-0.5 font-medium border ${meta.cls}`}
              >
                {meta.label}
              </span>
              {order.faireSource === "FAIRE_DIRECT" && (
                <span className="inline-block rounded-full text-[10px] px-2 py-0.5 font-semibold border bg-violet-50 text-violet-700 border-violet-200 uppercase tracking-wider">
                  Faire Direct
                </span>
              )}
            </div>
            <div className="text-sm text-text-secondary mt-1">
              {formatDate(order.createdAtFaire)} · <span title={order.statusRaw}>{rawLabel}</span>
              {order.trackingCode && <> · Suivi {order.trackingCode}</>}
            </div>
          </div>
          <div className="text-right">
            <div className="font-heading text-2xl font-bold text-text-primary">
              {formatCurrency(order.totalHT, currency)}
            </div>
            <div className="text-xs text-text-muted">HT total commande</div>
            <div className="text-xs text-text-muted">
              Net (après frais) {formatCurrency(order.netAmount, currency)}
            </div>
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
          {/* Client */}
          <section className="rounded-2xl border border-border bg-bg-primary p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-text-muted font-semibold mb-2">
              Client
            </div>
            <div className="font-semibold text-text-primary">
              {order.customerShop || order.customerName}
            </div>
            {order.customerShop && (
              <div className="text-sm text-text-secondary">{order.customerName}</div>
            )}
            <div className="text-xs text-text-muted mt-1 space-x-2">
              {order.customerEmail && <span>{order.customerEmail}</span>}
              {order.customerPhone && <span>· {order.customerPhone}</span>}
              {order.customerCountry && <span>· {order.customerCountry}</span>}
            </div>
            {order.adminClientCardId && (
              <Link
                href={`/admin/utilisateurs?tab=fiches&card=${order.adminClientCardId}`}
                className="inline-block mt-2 text-xs text-text-secondary hover:text-text-primary underline"
              >
                Voir la fiche client
              </Link>
            )}
          </section>

          {/* Adresse de livraison */}
          {order.shippingAddress && (
            <section className="rounded-2xl border border-border bg-bg-primary p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-text-muted font-semibold mb-2">
                Adresse de livraison
              </div>
              <div className="text-sm text-text-primary">
                {order.shippingAddress.name && (
                  <div className="font-medium">{order.shippingAddress.name}</div>
                )}
                {order.shippingAddress.company && (
                  <div>{order.shippingAddress.company}</div>
                )}
                {order.shippingAddress.street && <div>{order.shippingAddress.street}</div>}
                {order.shippingAddress.street2 && <div>{order.shippingAddress.street2}</div>}
                <div>
                  {[
                    order.shippingAddress.postalCode,
                    order.shippingAddress.city,
                    order.shippingAddress.stateCode,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </div>
                <div>{order.shippingAddress.country}</div>
                {order.shippingAddress.phone && (
                  <div className="text-xs text-text-muted mt-1">
                    Téléphone : {order.shippingAddress.phone}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Suivi */}
          {(order.carrier || order.trackingCode) && (
            <section className="rounded-2xl border border-border bg-bg-primary p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-text-muted font-semibold mb-2">
                Expédition
              </div>
              <div className="text-sm text-text-primary">
                {order.carrier && <div>Transporteur : {order.carrier}</div>}
                {order.trackingCode && (
                  <div>
                    Numéro de suivi :{" "}
                    {order.trackingUrl ? (
                      <a
                        href={order.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {order.trackingCode}
                      </a>
                    ) : (
                      order.trackingCode
                    )}
                  </div>
                )}
                {order.shippedAt && (
                  <div className="text-xs text-text-muted mt-1">
                    Expédiée le {formatDate(order.shippedAt)}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Frais Faire */}
          <section className="rounded-2xl border border-border bg-bg-secondary/40 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-text-muted font-semibold mb-2">
              Répartition financière
            </div>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between">
                <dt className="text-text-secondary">Total HT</dt>
                <dd className="font-medium text-text-primary tabular-nums">
                  {formatCurrency(order.totalHT, currency)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">Commission Faire</dt>
                <dd className="text-text-primary tabular-nums">
                  − {formatCurrency(order.commissionAmount, currency)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">Frais de paiement</dt>
                <dd className="text-text-primary tabular-nums">
                  − {formatCurrency(order.payoutFeeAmount, currency)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-border pt-1 mt-1">
                <dt className="font-semibold">Net reçu</dt>
                <dd className="font-heading font-bold tabular-nums">
                  {formatCurrency(order.netAmount, currency)}
                </dd>
              </div>
            </dl>
          </section>

          {/* Articles */}
          <section className="rounded-2xl border border-border bg-bg-primary p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-text-muted font-semibold mb-2">
              Articles ({order.items.length})
            </div>
            <ul className="divide-y divide-border">
              {order.items.map((it) => (
                <li key={it.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {it.productId ? (
                        <Link
                          href={`/admin/produits/${it.productId}/modifier`}
                          className="font-medium text-text-primary hover:underline truncate block"
                        >
                          {it.productName ?? "(sans nom)"}
                        </Link>
                      ) : (
                        <div className="font-medium italic text-text-muted truncate">
                          {it.productName ?? "Produit non rattaché"}
                        </div>
                      )}
                      <div className="text-xs text-text-muted mt-0.5 space-x-1">
                        {it.sku && <span className="font-mono">{it.sku}</span>}
                        {it.variantOptionLabel && <span>· {it.variantOptionLabel}</span>}
                        {it.includesTester && (
                          <span className="ml-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 px-1.5 text-[10px]">
                            + testeur
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm text-text-primary tabular-nums">
                        {it.quantity} × {formatCurrency(it.unitPriceHT, currency)}
                      </div>
                      <div className="text-sm font-semibold text-text-primary tabular-nums">
                        {formatCurrency(it.totalPriceHT, currency)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Dates clés */}
          <section className="rounded-2xl border border-border bg-bg-primary p-4 text-xs text-text-muted space-y-1">
            <div>
              Créée le <span className="text-text-primary">{formatDate(order.createdAtFaire)}</span>
            </div>
            {order.updatedAtFaire && (
              <div>
                Dernière mise à jour Faire :{" "}
                <span className="text-text-primary">{formatDate(order.updatedAtFaire)}</span>
              </div>
            )}
            {order.shipAfter && (
              <div>
                À expédier à partir du{" "}
                <span className="text-text-primary">{formatDate(order.shipAfter)}</span>
              </div>
            )}
            {order.canceledAt && (
              <div>
                Annulée le <span className="text-text-primary">{formatDate(order.canceledAt)}</span>
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
