"use client";

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
          {items.length} {items.length > 1 ? "art." : "art."} · {cartTotal.toFixed(2)} €
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
          <div className="p-4 space-y-3">
            {items.map((item) => {
              const isPack = item.saleType === "PACK";
              const linePrice = item.unitPrice * item.quantity;
              return (
                <div key={item.id} className="flex gap-3 p-3 rounded-xl border border-border bg-bg-primary">
                  <div className="w-14 h-14 rounded-lg bg-bg-tertiary overflow-hidden shrink-0">
                    {item.imagePath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imagePath} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{item.productName}</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-0.5">
                      <span>{item.productRef}</span>
                      {item.colorName && (
                        <>
                          <span>·</span>
                          <span className="w-2.5 h-2.5 rounded-full border border-border inline-block shrink-0" style={{ backgroundColor: item.colorHex ?? "#9CA3AF" }} />
                          <span>{item.colorName}</span>
                        </>
                      )}
                      {isPack && item.packQuantity && (
                        <>
                          <span>·</span>
                          <span>Pack ×{item.packQuantity}</span>
                        </>
                      )}
                    </div>
                    {item.sizes.length > 0 && (
                      <p className="text-[11px] text-text-muted mt-1 truncate">
                        {item.sizes.map((s) => `${s.name} ×${s.quantity}`).join(", ")}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs text-text-secondary">× {item.quantity}</span>
                      <span className="text-sm font-semibold text-text-primary tabular-nums">{linePrice.toFixed(2)} €</span>
                    </div>
                  </div>
                </div>
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
