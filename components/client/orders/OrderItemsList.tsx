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
        <div key={item.id} className="px-5 py-4 flex items-center gap-4">
          <OrderItemImage src={item.imagePath} alt={item.productName} />

          <div className="flex-1 min-w-0">
            <p className="font-body font-medium text-sm text-text-primary truncate">{item.productName}</p>
            <p className="text-xs text-text-muted font-body mt-0.5 font-mono">{item.productRef}</p>
            <div className="flex flex-wrap gap-2 mt-1">
              <span className="badge badge-neutral text-[10px]">
                {item.colorName}
              </span>
              {(() => {
                if (item.sizesJson) {
                  try {
                    const sizes: { name: string; quantity: number }[] = JSON.parse(item.sizesJson);
                    if (sizes.length > 0) return (
                      <span className="badge badge-neutral text-[10px]">
                        {sizes.map(s => `${s.name}×${s.quantity}`).join(", ")}
                      </span>
                    );
                  } catch { /* ignore */ }
                }
                if (item.size) return (
                  <span className="badge badge-neutral text-[10px]">
                    {t("sizeOption", { size: item.size })}
                  </span>
                );
                return null;
              })()}
              <span className={`badge text-[10px] ${item.saleType === "PACK" ? "badge-purple" : "badge-info"}`}>
                {item.saleType === "PACK" ? t("packOption", { qty: item.packQty ?? 0 }) : t("unitOption")}
              </span>
              {item.modification && (
                item.modification.newQuantity === 0
                  ? <span className="badge badge-error text-[10px]">{t("outOfStock")}</span>
                  : <span className="badge badge-warning text-[10px]">{t("stockModified")}</span>
              )}
            </div>
            {item.modification && (
              <p className="text-xs text-text-muted mt-1 italic">
                {t(`modificationReason_${item.modification.reason}`)}
              </p>
            )}
          </div>

          <div className="text-right shrink-0">
            <p className="text-xs text-text-muted font-body">x{item.quantity}</p>
            <p className="font-body font-semibold text-sm text-text-primary mt-0.5">
              {Number(item.lineTotal).toFixed(2)} {"\u20AC"}
            </p>
            {item.modification && (
              <p className="text-xs text-red-500 font-body mt-0.5 line-through">
                x{item.modification.originalQuantity}
              </p>
            )}
          </div>
        </div>
      )}
    />
  );
}
