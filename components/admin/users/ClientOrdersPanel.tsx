"use client";

import { useState } from "react";
import Link from "next/link";

interface OrderItem {
  id: string;
  productName: string;
  productRef: string;
  colorName: string | null;
  saleType: string;
  packQty: number | null;
  sizesJson: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  imagePath: string | null;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  itemCount: number;
  subtotalHT: number;
  tvaAmount: number;
  totalTTC: number;
  carrierName: string | null;
  carrierPrice: number;
  clientDiscountAmt: number;
  clientDiscountType: string | null;
  clientDiscountValue: number | null;
  clientFreeShipping: boolean;
  shipFirstName: string;
  shipLastName: string;
  shipCompany: string | null;
  shipAddress1: string;
  shipAddress2: string | null;
  shipZipCode: string;
  shipCity: string;
  shipCountry: string;
  items: OrderItem[];
}

const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  PENDING:   { label: "Nouveau",  badge: "badge badge-warning" },
  SHIPPED:   { label: "Expédiée", badge: "badge badge-success" },
  CANCELLED: { label: "Annulée",  badge: "badge badge-error"   },
};

export default function ClientOrdersPanel({ orders }: { orders: Order[] }) {
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const totalSpent = orders
    .filter((o) => o.status !== "CANCELLED")
    .reduce((s, o) => s + o.totalTTC, 0);

  return (
    <>
      <div className="card overflow-hidden">
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-border bg-bg-secondary flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-bg-tertiary flex items-center justify-center text-text-primary shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" strokeLinecap="round" />
              </svg>
            </span>
            <h3 className="font-heading text-sm font-semibold text-text-primary truncate">Historique des commandes</h3>
          </div>
          <span className="badge badge-neutral text-[11px] shrink-0">
            {orders.length} cmd{orders.length > 1 ? "s" : ""}
            {totalSpent > 0 && ` · ${totalSpent.toFixed(2)} €`}
          </span>
        </div>

        {orders.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-bg-tertiary flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
              </svg>
            </div>
            <p className="text-sm text-text-muted">Aucune commande</p>
          </div>
        ) : (
          <>
            <div>
              {orders.map((order) => {
                const sCfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.PENDING;
                const cancelled = order.status === "CANCELLED";
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setDetailOrder(order)}
                    className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border-light last:border-0 hover:bg-bg-secondary/60 transition-colors text-left"
                  >
                    <span className="w-9 h-9 rounded-lg bg-bg-tertiary flex items-center justify-center text-text-primary shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                      </svg>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-text-primary truncate">{order.orderNumber}</p>
                        <span className={`${sCfg.badge} text-[10px]`}>{sCfg.label}</span>
                      </div>
                      <p className="text-[11px] text-text-muted truncate">
                        {new Date(order.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" })}
                        {" · "}
                        {order.itemCount} article{order.itemCount > 1 ? "s" : ""}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold tabular-nums text-right whitespace-nowrap shrink-0 ${cancelled ? "text-text-muted line-through" : "text-text-primary"}`}>
                      {order.totalTTC.toFixed(2)} €
                    </span>
                    <svg className="w-4 h-4 text-text-muted shrink-0 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-border p-4 bg-bg-secondary flex items-center justify-between">
              <span className="text-sm text-text-secondary">Total dépensé (hors annulations)</span>
              <span className="font-heading text-lg font-bold text-text-primary tabular-nums">{totalSpent.toFixed(2)} €</span>
            </div>
          </>
        )}
      </div>

      {/* Modale de détail d'une commande */}
      {detailOrder && (
        <OrderDetailModal order={detailOrder} onClose={() => setDetailOrder(null)} />
      )}
    </>
  );
}

// ─── Modale de détail commande ────────────────────────────────────────────
function OrderDetailModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const sCfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.PENDING;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-bg-primary rounded-2xl shadow-lg max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-4 sm:px-6 py-4 border-b border-border flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-heading text-base sm:text-lg font-bold text-text-primary truncate">Commande {order.orderNumber}</h3>
              <span className={`${sCfg.badge} text-xs`}>{sCfg.label}</span>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              {new Date(order.createdAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-bg-secondary transition-colors shrink-0">
            <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-auto flex-1 p-4 sm:p-6 space-y-5">
          {/* Adresse de livraison */}
          <div>
            <h4 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Adresse de livraison</h4>
            <div className="bg-bg-secondary rounded-xl p-4 text-sm text-text-primary">
              <p className="font-medium">{order.shipFirstName} {order.shipLastName}</p>
              {order.shipCompany && <p>{order.shipCompany}</p>}
              <p>{order.shipAddress1}</p>
              {order.shipAddress2 && <p>{order.shipAddress2}</p>}
              <p>{order.shipZipCode} {order.shipCity}, {order.shipCountry}</p>
            </div>
          </div>

          {/* Articles */}
          <div>
            <h4 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Articles</h4>

            {/* Desktop : table */}
            <div className="hidden md:block border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-secondary">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-text-muted text-[10px] uppercase tracking-wider">Produit</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-text-muted text-[10px] uppercase tracking-wider">Couleur</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-text-muted text-[10px] uppercase tracking-wider">Tailles</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-text-muted text-[10px] uppercase tracking-wider">P.U.</th>
                    <th className="px-4 py-2.5 text-center font-semibold text-text-muted text-[10px] uppercase tracking-wider">Qté</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-text-muted text-[10px] uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {order.items.map((item) => {
                    const sizes: { name: string; quantity: number }[] = item.sizesJson ? JSON.parse(item.sizesJson) : [];
                    return (
                      <tr key={item.id}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-text-primary">{item.productName}</p>
                          <p className="text-[11px] text-text-muted">
                            {item.productRef}
                            {item.saleType === "PACK" && item.packQty && ` · Pack ×${item.packQty}`}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-text-secondary">{item.colorName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-text-secondary text-xs">
                          {sizes.length > 0 ? sizes.map((s) => `${s.name} ×${s.quantity}`).join(", ") : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-text-secondary tabular-nums">{item.unitPrice.toFixed(2)} €</td>
                        <td className="px-4 py-2.5 text-center text-text-secondary tabular-nums">{item.quantity}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-text-primary tabular-nums">{item.lineTotal.toFixed(2)} €</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile : liste de cartes */}
            <div className="md:hidden space-y-2">
              {order.items.map((item) => {
                const sizes: { name: string; quantity: number }[] = item.sizesJson ? JSON.parse(item.sizesJson) : [];
                return (
                  <div key={item.id} className="rounded-xl border border-border bg-bg-primary p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-medium text-text-primary">{item.productName}</p>
                      <span className="text-sm font-semibold text-text-primary tabular-nums shrink-0">{item.lineTotal.toFixed(2)} €</span>
                    </div>
                    <p className="text-[11px] text-text-muted">
                      {item.productRef}
                      {item.saleType === "PACK" && item.packQty && ` · Pack ×${item.packQty}`}
                      {item.colorName && ` · ${item.colorName}`}
                    </p>
                    <p className="text-[11px] text-text-muted mt-1">
                      {item.unitPrice.toFixed(2)} € × {item.quantity}
                      {sizes.length > 0 && ` · ${sizes.map((s) => `${s.name} ×${s.quantity}`).join(", ")}`}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Récap financier */}
          <div>
            <h4 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Récapitulatif</h4>
            <div className="bg-bg-secondary rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between text-text-secondary">
                <span>Sous-total HT</span>
                <span className="tabular-nums">{order.subtotalHT.toFixed(2)} €</span>
              </div>
              {order.clientDiscountAmt > 0 && (
                <div className="flex justify-between text-text-primary">
                  <span>
                    Remise client
                    {order.clientDiscountType === "PERCENT" && order.clientDiscountValue
                      ? ` (−${order.clientDiscountValue}%)`
                      : ""}
                  </span>
                  <span className="tabular-nums">−{order.clientDiscountAmt.toFixed(2)} €</span>
                </div>
              )}
              <div className="flex justify-between text-text-secondary">
                <span>TVA</span>
                <span className="tabular-nums">{order.tvaAmount.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>
                  Livraison
                  {order.carrierName && ` (${order.carrierName})`}
                  {order.clientFreeShipping && " — offerte"}
                </span>
                <span className="tabular-nums">{order.carrierPrice.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between font-heading font-bold text-text-primary text-base pt-2 border-t border-border">
                <span>Total TTC</span>
                <span className="tabular-nums">{order.totalTTC.toFixed(2)} €</span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-4 border-t border-border bg-bg-secondary flex items-center justify-end shrink-0">
          <Link
            href={`/admin/commandes/${order.id}`}
            className="btn-primary text-sm"
            onClick={onClose}
          >
            Ouvrir la commande complète
          </Link>
        </div>
      </div>
    </div>
  );
}
