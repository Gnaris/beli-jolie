"use client";

import Link from "next/link";
import type { FaireOrderDetailFull } from "@/app/actions/admin/faire-orders";
import MarketplaceBadge from "./MarketplaceBadge";
import { DrawerShell } from "@/components/admin/widgets-rail/DrawerShell";

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
  const meta = STATUS_META[order.status];
  const currency = order.currency || "EUR";
  const displayNumber = order.displayId ?? order.faireOrderId;
  const rawLabel = STATUS_RAW_LABEL[order.statusRaw] ?? order.statusRaw;

  return (
    <DrawerShell
      open
      onClose={onClose}
      accent="amber"
      eyebrow="Commande Faire"
      title={<span className="font-mono">{displayNumber}</span>}
      size="fullscreen"
      icon={<MarketplaceBadge source="FAIRE" size="md" />}
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
                {order.faireSource === "FAIRE_DIRECT" && (
                  <span className="inline-block rounded-full text-[10px] px-2 py-0.5 font-semibold border bg-violet-50 text-violet-700 border-violet-200 uppercase tracking-wider">
                    Faire Direct
                  </span>
                )}
                <span className="text-xs text-text-muted" title={order.statusRaw}>
                  {rawLabel}
                </span>
                {order.trackingCode && (
                  <span className="text-xs text-text-secondary">
                    Suivi <span className="font-mono">{order.trackingCode}</span>
                  </span>
                )}
              </div>
              <div className="text-sm text-text-secondary mt-2">
                Reçue le {formatDate(order.createdAtFaire)}
              </div>
            </div>
            <div className="lg:text-right">
              <div className="font-heading text-3xl font-bold text-text-primary tabular-nums">
                {formatCurrency(order.totalHT, currency)}
              </div>
              <div className="text-xs text-text-muted mt-1">HT total commande</div>
              <div className="text-xs text-text-muted">
                Net (après frais) {formatCurrency(order.netAmount, currency)}
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* Colonne gauche : client + adresse + suivi + finances */}
          <div className="lg:col-span-5 space-y-5">
            {/* Client */}
            <section className="rounded-2xl border border-border bg-bg-primary shadow-sm p-5">
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
              <section className="rounded-2xl border border-border bg-bg-primary shadow-sm p-5">
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
              <section className="rounded-2xl border border-border bg-bg-primary shadow-sm p-5">
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
            <section className="rounded-2xl border border-border bg-bg-secondary/40 shadow-sm p-5">
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
          </div>

          {/* Colonne droite : articles + dates clés */}
          <div className="lg:col-span-7 space-y-5">
            <section className="rounded-2xl border border-border bg-bg-primary shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-border text-xs uppercase tracking-[0.2em] text-text-muted">
                Articles ({order.items.length})
              </div>
              <ul className="divide-y divide-border">
                {order.items.map((it) => (
                  <li key={it.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
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
            <section className="rounded-2xl border border-border bg-bg-primary shadow-sm p-5 text-xs text-text-muted space-y-1">
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
        </div>
      </div>
    </DrawerShell>
  );
}
