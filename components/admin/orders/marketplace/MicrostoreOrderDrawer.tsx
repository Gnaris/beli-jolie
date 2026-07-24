"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { MicrostoreOrderDetailFull } from "@/app/actions/admin/microstore-orders";
import MarketplaceBadge from "./MarketplaceBadge";

const STATUS_META = {
  NEW: { label: "À préparer", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  SHIPPED: { label: "Expédiée", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Annulée", cls: "bg-rose-50 text-rose-700 border-rose-200" },
} as const;

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
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
  order: MicrostoreOrderDetailFull;
  onClose: () => void;
}

export default function MicrostoreOrderDrawer({ order, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const status = order.status as keyof typeof STATUS_META;
  const meta = STATUS_META[status] ?? {
    label: order.status,
    cls: "bg-slate-50 text-slate-700 border-slate-200",
  };

  const address = order.shipping;
  const hasAddress = Boolean(
    address.name || address.street || address.city || address.postalCode,
  );

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <aside
        className="relative ml-auto w-full max-w-2xl bg-bg-primary h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky */}
        <div className="sticky top-0 z-10 bg-bg-primary border-b border-border p-5 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <MarketplaceBadge source="MICROSTORE" size="md" />
              <h2 className="font-heading text-xl font-bold text-text-primary font-mono">
                {order.microstoreOrderId}
              </h2>
              <span
                className={`inline-block rounded-full text-xs px-3 py-0.5 font-medium border ${meta.cls}`}
              >
                {meta.label}
              </span>
              <span className="inline-block rounded-full text-xs px-3 py-0.5 font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">
                Déjà payée
              </span>
            </div>
            <p className="text-xs text-text-muted mt-2">
              Créée le{" "}
              <span className="text-text-primary font-medium">
                {formatDate(order.createdAtMicrostore)}
              </span>
              {order.shippedAt && (
                <>
                  {" · "}Expédiée le{" "}
                  <span className="text-text-primary font-medium">
                    {formatDate(order.shippedAt)}
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-secondary text-text-muted transition-colors"
            aria-label="Fermer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Client */}
          <section className="rounded-xl border border-border p-4">
            <h3 className="font-heading text-sm font-bold text-text-primary uppercase tracking-wider mb-3">
              Client
            </h3>
            <div className="space-y-1 text-sm font-body">
              <div className="font-semibold text-text-primary">
                {order.customer.name}
              </div>
              {order.customer.company && (
                <div className="text-text-secondary">{order.customer.company}</div>
              )}
              {order.customer.email && (
                <div className="text-text-secondary">
                  <a
                    href={`mailto:${order.customer.email}`}
                    className="hover:underline"
                  >
                    {order.customer.email}
                  </a>
                </div>
              )}
              {order.customer.phone && (
                <div className="text-text-secondary tabular-nums">
                  {order.customer.phone}
                </div>
              )}
              {order.customer.vatNumber && (
                <div className="text-text-muted text-xs mt-2">
                  TVA : <code>{order.customer.vatNumber}</code>
                </div>
              )}
            </div>
          </section>

          {/* Livraison */}
          {hasAddress && (
            <section className="rounded-xl border border-border p-4">
              <h3 className="font-heading text-sm font-bold text-text-primary uppercase tracking-wider mb-3">
                Adresse de livraison
              </h3>
              <div className="space-y-0.5 text-sm font-body text-text-secondary">
                {address.name && (
                  <div className="font-semibold text-text-primary">{address.name}</div>
                )}
                {address.company && <div>{address.company}</div>}
                {address.street && <div>{address.street}</div>}
                {(address.postalCode || address.city) && (
                  <div>
                    {address.postalCode} {address.city}
                  </div>
                )}
                {address.countryCode && (
                  <div className="text-text-muted text-xs mt-1">
                    {address.countryCode}
                  </div>
                )}
                {address.phone && (
                  <div className="text-text-muted text-xs tabular-nums mt-1">
                    ☎ {address.phone}
                  </div>
                )}
              </div>
              {order.shippingLabel && (
                <div className="mt-3 pt-3 border-t border-border text-xs text-text-muted font-body">
                  <b>Mode :</b> {order.shippingLabel}
                </div>
              )}
              {order.remark && (
                <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 font-body">
                  <b>Remarque client :</b> {order.remark}
                </div>
              )}
            </section>
          )}

          {/* Articles */}
          <section className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-bg-secondary/60">
              <h3 className="font-heading text-sm font-bold text-text-primary uppercase tracking-wider">
                Articles ({order.items.length})
              </h3>
            </div>
            <div className="divide-y divide-border">
              {order.items.map((it) => (
                <div key={it.id} className="p-3 flex gap-3 items-start">
                  {it.imageUrl ? (
                    // Microstore CDN — proxy image serveur pour éviter les référers cross-origin
                    // eslint-disable-next-line @next/next/no-img-element -- image externe, dimensions inconnues
                    <img
                      src={it.imageUrl}
                      alt={it.productSnapshotName ?? it.itemRef}
                      className="w-14 h-14 rounded-lg object-cover border border-border shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-bg-secondary border border-border shrink-0 flex items-center justify-center text-text-muted text-xs">
                      —
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-sm text-text-primary">
                        {it.itemRef}
                      </span>
                      {it.productId ? (
                        <Link
                          href={`/admin/produits/${it.productId}`}
                          className="text-xs text-emerald-700 hover:underline font-body"
                        >
                          ✓ lié à {it.matchedProductName ?? "un produit"}
                        </Link>
                      ) : (
                        <span className="text-xs text-amber-700 font-body">
                          ⚠ non lié au catalogue
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-text-secondary mt-0.5 line-clamp-1">
                      {it.productSnapshotName}
                    </div>
                    <div className="text-xs text-text-muted mt-1 font-body">
                      {it.colorNameSnapshot && (
                        <span className="mr-2">Couleur : {it.colorNameSnapshot}</span>
                      )}
                      {it.sizeNameSnapshot && (
                        <span className="mr-2">Taille : {it.sizeNameSnapshot}</span>
                      )}
                      {it.goodsSn && (
                        <span className="text-text-muted/70">EAN {it.goodsSn}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-text-muted tabular-nums">
                      {it.quantity} × {formatCurrency(it.unitPriceHT)}
                    </div>
                    <div className="font-heading font-bold text-sm text-text-primary tabular-nums mt-0.5">
                      {formatCurrency(it.totalPriceHT)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Total */}
          <section className="rounded-xl border border-border p-4 bg-bg-secondary/40">
            <div className="space-y-1.5 text-sm font-body">
              <div className="flex justify-between text-text-secondary">
                <span>Sous-total articles</span>
                <span className="tabular-nums">
                  {formatCurrency(order.totalHT - order.shippingPrice)}
                </span>
              </div>
              {order.shippingPrice > 0 && (
                <div className="flex justify-between text-text-secondary">
                  <span>Livraison</span>
                  <span className="tabular-nums">
                    {formatCurrency(order.shippingPrice)}
                  </span>
                </div>
              )}
              <div className="border-t border-border pt-2 mt-2 flex justify-between font-heading font-bold text-text-primary">
                <span>Total HT</span>
                <span className="tabular-nums">{formatCurrency(order.totalHT)}</span>
              </div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
