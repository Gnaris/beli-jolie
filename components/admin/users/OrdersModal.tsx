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
  PENDING:    { label: "En attente",     badge: "badge badge-warning" },
  PROCESSING: { label: "En préparation", badge: "badge badge-info" },
  SHIPPED:    { label: "Expédiée",       badge: "badge badge-success" },
  DELIVERED:  { label: "Livrée",         badge: "badge badge-success" },
  CANCELLED:  { label: "Annulée",        badge: "badge badge-error" },
};

export default function OrdersModal({ orders }: { orders: Order[] }) {
  const [listOpen, setListOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);

  const totalSpent = orders.reduce((s, o) => s + o.totalTTC, 0);

  function openDetail(order: Order) {
    setDetailOrder(order);
  }

  function backToList() {
    setDetailOrder(null);
  }

  function closeAll() {
    setListOpen(false);
    setDetailOrder(null);
  }

  return (
    <>
      {/* Summary card */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" /></svg>
            <h2 className="font-heading text-base font-semibold text-text-primary">Commandes</h2>
          </div>
          {orders.length > 0 && (
            <span className="badge badge-neutral text-xs">{orders.length}</span>
          )}
        </div>
        <div className="p-5">
          {orders.length === 0 ? (
            <p className="text-sm text-text-muted font-body text-center py-2">Aucune commande</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-body text-text-secondary">
                  {orders.length} commande{orders.length > 1 ? "s" : ""}
                </span>
                <span className="text-base font-heading font-bold text-text-primary">
                  {totalSpent.toFixed(2)} € TTC
                </span>
              </div>
              <button
                type="button"
                onClick={() => setListOpen(true)}
                className="btn-secondary text-sm w-full"
              >
                Voir les commandes
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal — Liste des commandes */}
      {listOpen && !detailOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={closeAll} />
          <div className="relative bg-bg-primary rounded-2xl shadow-lg max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
              <h3 className="font-heading text-lg font-bold text-text-primary">
                Commandes ({orders.length})
              </h3>
              <button onClick={closeAll} className="p-1 rounded-lg hover:bg-bg-secondary transition-colors">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-bg-secondary sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">N°</th>
                    <th className="px-4 py-3 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-center font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Articles</th>
                    <th className="px-4 py-3 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Total TTC</th>
                    <th className="px-4 py-3 text-center font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Statut</th>
                    <th className="px-4 py-3 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {orders.map((order) => {
                    const sCfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.PENDING;
                    return (
                      <tr key={order.id} className="hover:bg-bg-secondary/50">
                        <td className="px-4 py-3 font-medium text-text-primary font-body">{order.orderNumber}</td>
                        <td className="px-4 py-3 text-text-secondary font-body">
                          {new Date(order.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-4 py-3 text-center text-text-secondary font-body">{order.itemCount}</td>
                        <td className="px-4 py-3 text-right font-heading font-semibold text-text-primary">{order.totalTTC.toFixed(2)} €</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`${sCfg.badge} text-xs`}>{sCfg.label}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openDetail(order)}
                            className="text-xs font-body font-medium text-accent hover:text-accent-dark transition-colors"
                          >
                            Détail
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal — Détail d'une commande */}
      {detailOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={closeAll} />
          <div className="relative bg-bg-primary rounded-2xl shadow-lg max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <button onClick={backToList} className="p-1 rounded-lg hover:bg-bg-secondary transition-colors">
                  <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div>
                  <h3 className="font-heading text-lg font-bold text-text-primary">
                    Commande {detailOrder.orderNumber}
                  </h3>
                  <p className="text-xs font-body text-text-muted">
                    {new Date(detailOrder.createdAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`${(STATUS_CONFIG[detailOrder.status] ?? STATUS_CONFIG.PENDING).badge} text-xs`}>
                  {(STATUS_CONFIG[detailOrder.status] ?? STATUS_CONFIG.PENDING).label}
                </span>
                <button onClick={closeAll} className="p-1 rounded-lg hover:bg-bg-secondary transition-colors">
                  <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="overflow-auto flex-1 p-6 space-y-5">
              {/* Adresse de livraison */}
              <div>
                <h4 className="text-xs font-body font-semibold text-text-muted uppercase tracking-wider mb-2">Adresse de livraison</h4>
                <div className="bg-bg-secondary rounded-xl p-4 text-sm font-body text-text-primary">
                  <p className="font-medium">{detailOrder.shipFirstName} {detailOrder.shipLastName}</p>
                  {detailOrder.shipCompany && <p>{detailOrder.shipCompany}</p>}
                  <p>{detailOrder.shipAddress1}</p>
                  {detailOrder.shipAddress2 && <p>{detailOrder.shipAddress2}</p>}
                  <p>{detailOrder.shipZipCode} {detailOrder.shipCity}, {detailOrder.shipCountry}</p>
                </div>
              </div>

              {/* Articles */}
              <div>
                <h4 className="text-xs font-body font-semibold text-text-muted uppercase tracking-wider mb-2">Articles</h4>
                <div className="border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-secondary">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Produit</th>
                        <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Couleur</th>
                        <th className="px-4 py-2.5 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Tailles</th>
                        <th className="px-4 py-2.5 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider">P.U.</th>
                        <th className="px-4 py-2.5 text-center font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Qté</th>
                        <th className="px-4 py-2.5 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-light">
                      {detailOrder.items.map((item) => {
                        const sizes: { name: string; quantity: number }[] = item.sizesJson
                          ? JSON.parse(item.sizesJson)
                          : [];
                        return (
                          <tr key={item.id}>
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-text-primary font-body">{item.productName}</p>
                              <p className="text-xs text-text-muted font-body">
                                {item.productRef}
                                {item.saleType === "PACK" && item.packQty && ` · Pack x${item.packQty}`}
                              </p>
                            </td>
                            <td className="px-4 py-2.5 text-text-secondary font-body">{item.colorName ?? "—"}</td>
                            <td className="px-4 py-2.5 text-text-secondary font-body text-xs">
                              {sizes.length > 0
                                ? sizes.map((s) => `${s.name} x${s.quantity}`).join(", ")
                                : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right text-text-secondary font-body">{item.unitPrice.toFixed(2)} €</td>
                            <td className="px-4 py-2.5 text-center text-text-secondary font-body">{item.quantity}</td>
                            <td className="px-4 py-2.5 text-right font-heading font-semibold text-text-primary">{item.lineTotal.toFixed(2)} €</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Récap financier */}
              <div>
                <h4 className="text-xs font-body font-semibold text-text-muted uppercase tracking-wider mb-2">Récapitulatif</h4>
                <div className="bg-bg-secondary rounded-xl p-4 space-y-2 text-sm font-body">
                  <div className="flex justify-between text-text-secondary">
                    <span>Sous-total HT</span>
                    <span>{detailOrder.subtotalHT.toFixed(2)} €</span>
                  </div>
                  {detailOrder.clientDiscountAmt > 0 && (
                    <div className="flex justify-between text-accent">
                      <span>
                        Remise client
                        {detailOrder.clientDiscountType === "PERCENT" && detailOrder.clientDiscountValue
                          ? ` (-${detailOrder.clientDiscountValue}%)`
                          : ""}
                      </span>
                      <span>-{detailOrder.clientDiscountAmt.toFixed(2)} €</span>
                    </div>
                  )}
                  <div className="flex justify-between text-text-secondary">
                    <span>TVA</span>
                    <span>{detailOrder.tvaAmount.toFixed(2)} €</span>
                  </div>
                  <div className="flex justify-between text-text-secondary">
                    <span>
                      Livraison
                      {detailOrder.carrierName && ` (${detailOrder.carrierName})`}
                      {detailOrder.clientFreeShipping && " — offerte"}
                    </span>
                    <span>{detailOrder.carrierPrice.toFixed(2)} €</span>
                  </div>
                  <div className="flex justify-between font-heading font-bold text-text-primary text-base pt-2 border-t border-border">
                    <span>Total TTC</span>
                    <span>{detailOrder.totalTTC.toFixed(2)} €</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border bg-bg-secondary flex items-center justify-between shrink-0">
              <Link
                href={`/admin/commandes/${detailOrder.id}`}
                className="btn-primary text-sm"
                onClick={closeAll}
              >
                Ouvrir la commande complète
              </Link>
              <button onClick={backToList} className="btn-ghost text-sm">
                Retour à la liste
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
