"use client";

import { useState } from "react";

interface CartItem {
  id: string;
  productName: string;
  productRef: string;
  colorName: string | null;
  colorHex: string | null;
  saleType: string;
  packQuantity: number | null;
  unitPrice: number;
  quantity: number;
  sizes: { name: string; quantity: number }[];
  imagePath: string | null;
}

interface Props {
  items: CartItem[];
  cartTotal: number;
}

export default function CartModal({ items, cartTotal }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Summary card */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>
            <h2 className="font-heading text-base font-semibold text-text-primary">Panier</h2>
          </div>
          {items.length > 0 && (
            <span className="badge badge-neutral text-xs">{items.length}</span>
          )}
        </div>
        <div className="p-5">
          {items.length === 0 ? (
            <p className="text-sm text-text-muted font-body text-center py-2">Panier vide</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-body text-text-secondary">
                  {items.length} article{items.length > 1 ? "s" : ""}
                </span>
                <span className="text-base font-heading font-bold text-text-primary">
                  {cartTotal.toFixed(2)} €
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="btn-secondary text-sm w-full"
              >
                Voir le détail du panier
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative bg-bg-primary rounded-2xl shadow-lg max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
              <h3 className="font-heading text-lg font-bold text-text-primary">
                Panier du client
              </h3>
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-bg-secondary transition-colors">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Table */}
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-bg-secondary sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Produit</th>
                    <th className="px-4 py-3 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Couleur</th>
                    <th className="px-4 py-3 text-left font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Tailles</th>
                    <th className="px-4 py-3 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Prix unit.</th>
                    <th className="px-4 py-3 text-center font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Qté</th>
                    <th className="px-4 py-3 text-right font-body font-semibold text-text-muted text-xs uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {items.map((item) => {
                    const isPack = item.saleType === "PACK";
                    const linePrice = isPack
                      ? item.unitPrice * (item.packQuantity ?? 1) * item.quantity
                      : item.unitPrice * item.quantity;

                    return (
                      <tr key={item.id} className="hover:bg-bg-secondary/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-bg-tertiary rounded-lg overflow-hidden shrink-0">
                              {item.imagePath ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.imagePath} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                                  </svg>
                                </div>
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-text-primary font-body">{item.productName}</p>
                              <p className="text-xs text-text-muted font-body">
                                {item.productRef}
                                {isPack && ` · Pack x${item.packQuantity}`}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {item.colorName ? (
                            <div className="flex items-center gap-1.5">
                              <span className="w-3 h-3 rounded-full border border-border-dark inline-block shrink-0" style={{ backgroundColor: item.colorHex ?? "#9CA3AF" }} />
                              <span className="text-text-secondary font-body">{item.colorName}</span>
                            </div>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-text-secondary font-body">
                          {item.sizes.length > 0
                            ? item.sizes.map((s) => `${s.name} x${s.quantity}`).join(", ")
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-body text-text-secondary">
                          {item.unitPrice.toFixed(2)} €
                        </td>
                        <td className="px-4 py-3 text-center font-body text-text-secondary">
                          {item.quantity}
                        </td>
                        <td className="px-4 py-3 text-right font-heading font-semibold text-text-primary">
                          {linePrice.toFixed(2)} €
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer total */}
            <div className="px-6 py-4 border-t border-border bg-bg-secondary flex items-center justify-between shrink-0">
              <span className="text-sm font-medium text-text-secondary font-body">Total panier HT</span>
              <span className="text-lg font-bold text-text-primary font-heading">{cartTotal.toFixed(2)} €</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
