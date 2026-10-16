"use client";

import Link from "next/link";
import OrderItemImage from "@/components/ui/OrderItemImage";

interface CartItem {
  id: string;
  productId: string;
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

function slugForFile(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "photo"
  );
}

export default function ClientCartPanel({ items, cartTotal }: Props) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-border bg-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-bg-tertiary flex items-center justify-center text-text-primary shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
          </span>
          <h3 className="font-heading text-sm font-semibold text-text-primary truncate">Panier en cours</h3>
        </div>
        <span className="badge badge-neutral text-[11px] shrink-0">
          {items.length} art. · {cartTotal.toFixed(2)} €
        </span>
      </div>

      {items.length === 0 ? (
        <div className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-bg-tertiary flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272" />
            </svg>
          </div>
          <p className="text-sm text-text-muted">Panier vide</p>
        </div>
      ) : (
        <>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
            {items.map((item) => {
              const isPack = item.saleType === "PACK";
              const linePrice = item.unitPrice * item.quantity;
              const downloadBaseName = `${slugForFile(item.productRef || item.productName)}-${slugForFile(item.colorName || "")}`;
              return (
                <article
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-bg-primary p-3"
                >
                  {/* Image carrée cliquable (lightbox + télécharger) */}
                  <OrderItemImage
                    src={item.imagePath}
                    alt={`${item.productName}${item.colorName ? " — " + item.colorName : ""}`}
                    sizeClass="w-full aspect-square"
                    allowDownload
                    priceEuros={item.unitPrice}
                    reference={item.productRef || null}
                    downloadBaseName={downloadBaseName}
                  />

                  {/* Corps carte */}
                  <div className="flex-1 flex flex-col gap-2">
                    <p className="text-sm font-semibold text-text-primary line-clamp-2 leading-snug">
                      {item.productName}
                    </p>

                    {/* Référence cliquable → fiche produit admin */}
                    <Link
                      href={`/admin/produits/${item.productId}/modifier`}
                      className="inline-flex items-center gap-1 self-start text-[11px] font-mono text-text-secondary hover:text-text-primary underline underline-offset-2 decoration-dotted transition-colors"
                      title={`Ouvrir la fiche produit ${item.productRef}`}
                    >
                      {item.productRef}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14 3h7m0 0v7m0-7L10 14m-4 7h11a2 2 0 002-2v-6" />
                      </svg>
                    </Link>

                    {/* Couleur + pack */}
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-text-muted">
                      {item.colorName && (
                        <span className="inline-flex items-center gap-1">
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-border inline-block shrink-0"
                            style={{ backgroundColor: item.colorHex ?? "#9CA3AF" }}
                          />
                          <span>{item.colorName}</span>
                        </span>
                      )}
                      {isPack && item.packQuantity && (
                        <span className="badge badge-neutral text-[10px]">Pack ×{item.packQuantity}</span>
                      )}
                    </div>

                    {/* Tailles */}
                    {item.sizes.length > 0 && (
                      <p className="text-[11px] text-text-muted leading-snug">
                        {item.sizes.map((s) => `${s.name} ×${s.quantity}`).join(", ")}
                      </p>
                    )}

                    {/* Prix : qté + unitaire + total */}
                    <div className="mt-auto pt-2 border-t border-border-light grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <p className="text-text-muted uppercase tracking-wider text-[9px] font-semibold">Qté</p>
                        <p className="text-sm font-semibold text-text-primary tabular-nums">{item.quantity}</p>
                      </div>
                      <div>
                        <p className="text-text-muted uppercase tracking-wider text-[9px] font-semibold">Unitaire</p>
                        <p className="text-sm font-semibold text-text-primary tabular-nums">
                          {item.unitPrice.toFixed(2)} €
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-text-muted uppercase tracking-wider text-[9px] font-semibold">Total</p>
                        <p className="text-sm font-bold text-text-primary tabular-nums">
                          {linePrice.toFixed(2)} €
                        </p>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="border-t border-border p-4 bg-bg-secondary flex items-center justify-between">
            <span className="text-sm text-text-secondary">Valeur totale du panier</span>
            <span className="font-heading text-lg font-bold text-text-primary tabular-nums">{cartTotal.toFixed(2)} €</span>
          </div>
        </>
      )}
    </div>
  );
}
