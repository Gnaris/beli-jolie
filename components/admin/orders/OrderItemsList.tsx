"use client";

import OrderItemsSortable, { type SortableOrderItem } from "@/components/ui/OrderItemsSortable";
import OrderItemImage from "@/components/ui/OrderItemImage";

interface AdminOrderItem extends SortableOrderItem {
  colorName: string;
  imagePath: string | null;
  saleType: string;
  packQty: number | null;
  size: string | null;
  sizesJson: string | null;
  lineTotal: number | { toNumber?: () => number };
}

const fmt = (n: number | { toNumber?: () => number }) =>
  Number(n).toFixed(2).replace(".", ",") + " €";

const LABELS = {
  sortBy: "Trier par :",
  default: "Ordre par défaut",
  nameAsc: "Nom A → Z",
  nameDesc: "Nom Z → A",
  refAsc: "Référence A → Z",
  refDesc: "Référence Z → A",
  category: "Catégorie",
  priceAsc: "Prix croissant",
  priceDesc: "Prix décroissant",
  qtyAsc: "Quantité croissante",
  qtyDesc: "Quantité décroissante",
  uncategorized: "Sans catégorie",
};

export default function OrderItemsList({ items }: { items: AdminOrderItem[] }) {
  return (
    <OrderItemsSortable
      items={items}
      labels={LABELS}
      renderItem={(item) => (
        <div key={item.id} className="flex gap-4 px-5 py-4">
          <OrderItemImage src={item.imagePath} alt={item.productName} sizeClass="w-12 h-12 sm:w-16 sm:h-16" />

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary font-body">
              {item.productName}
            </p>
            <p className="text-xs font-mono text-text-muted mt-0.5">{item.productRef}</p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              <span className="badge badge-neutral">
                {item.colorName}
              </span>
              {item.saleType === "PACK" && (
                <span className="badge badge-neutral">
                  Paquet ×{item.packQty}
                </span>
              )}
              {(() => {
                if (item.sizesJson) {
                  try {
                    const sizes: { name: string; quantity: number }[] = JSON.parse(item.sizesJson);
                    if (sizes.length > 0) return (
                      <span className="badge badge-neutral">
                        {sizes.map(s => `${s.name}×${s.quantity}`).join(", ")}
                      </span>
                    );
                  } catch { /* ignore */ }
                }
                if (item.size) return (
                  <span className="badge badge-neutral">
                    Taille {item.size}
                  </span>
                );
                return null;
              })()}
            </div>
          </div>

          <div className="text-right shrink-0">
            <p className="text-sm font-semibold text-text-primary font-heading">
              {fmt(item.lineTotal)}
            </p>
            <p className="text-xs text-text-muted font-body mt-0.5">
              {item.quantity} × {fmt(item.unitPrice)}
            </p>
          </div>
        </div>
      )}
    />
  );
}
