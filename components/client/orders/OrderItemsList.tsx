"use client";

import { useTranslations } from "next-intl";
import OrderItemsSortable, { type SortableOrderItem } from "@/components/ui/OrderItemsSortable";
import OrderItemImage from "@/components/ui/OrderItemImage";

interface ModInfo {
  originalQuantity: number;
  newQuantity: number;
  reason: string;
}

interface ClientOrderItem extends SortableOrderItem {
  colorName: string;
  imagePath: string | null;
  saleType: string;
  packQty: number | null;
  size: string | null;
  sizesJson: string | null;
  lineTotal: number | { toNumber?: () => number };
  modification?: ModInfo | null;
}

export default function ClientOrderItemsList({ items }: { items: ClientOrderItem[] }) {
  const t = useTranslations("orders");

  const labels = {
    sortBy: t("sortBy"),
    default: t("sortDefault"),
    nameAsc: t("sortNameAsc"),
    nameDesc: t("sortNameDesc"),
    refAsc: t("sortRefAsc"),
    refDesc: t("sortRefDesc"),
    category: t("sortCategory"),
    priceAsc: t("sortPriceAsc"),
    priceDesc: t("sortPriceDesc"),
    qtyAsc: t("sortQtyAsc"),
    qtyDesc: t("sortQtyDesc"),
    uncategorized: t("sortUncategorized"),
  };

  return (
    <OrderItemsSortable
      items={items}
      labels={labels}
      renderItem={(item) => (
        <div key={item.id} className="px-5 py-5 flex items-center gap-5">
          <OrderItemImage src={item.imagePath} alt={item.productName} sizeClass="w-20 h-20 sm:w-28 sm:h-28" />

          <div className="flex-1 min-w-0">
            <p className="font-body font-semibold text-base text-text-primary truncate">{item.productName}</p>
            <p className="text-sm text-text-muted font-body mt-1 font-mono">{item.productRef}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="badge badge-neutral">
                {item.colorName}
              </span>
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
                    {t("sizeOption", { size: item.size })}
                  </span>
                );
                return null;
              })()}
              <span className={`badge ${item.saleType === "PACK" ? "badge-purple" : "badge-info"}`}>
                {item.saleType === "PACK" ? t("packOption", { qty: item.packQty ?? 0 }) : t("unitOption")}
              </span>
              {item.modification && (
                item.modification.newQuantity === 0
                  ? <span className="badge badge-error">{t("outOfStock")}</span>
                  : <span className="badge badge-warning">{t("stockModified")}</span>
              )}
            </div>
            {item.modification && (
              <p className="text-sm text-text-muted mt-1.5 italic">
                {t(`modificationReason_${item.modification.reason}`)}
              </p>
            )}
          </div>

          <div className="text-right shrink-0">
            <p className="text-sm text-text-muted font-body">x{item.quantity}</p>
            <p className="font-body font-semibold text-lg text-text-primary mt-1">
              {Number(item.lineTotal).toFixed(2)} {"\u20AC"}
            </p>
            {item.modification && (
              <p className="text-sm text-red-500 font-body mt-0.5 line-through">
                x{item.modification.originalQuantity}
              </p>
            )}
          </div>
        </div>
      )}
    />
  );
}
