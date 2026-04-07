"use client";

import { useTranslations } from "next-intl";
import OrderItemImage from "@/components/ui/OrderItemImage";

interface ModificationView {
  orderItemId: string;
  originalQuantity: number;
  newQuantity: number;
  reason: "OUT_OF_STOCK" | "CLIENT_REQUEST";
  priceDifference: number;
  productName: string;
  productRef: string;
  colorName: string;
  imagePath: string | null;
  unitPrice: number;
}

interface Props {
  modifications: ModificationView[];
}

const fmt = (n: number) => n.toFixed(2).replace(".", ",") + " €";

export default function OrderModifications({ modifications }: Props) {
  const t = useTranslations("orders");

  if (modifications.length === 0) return null;

  const totalCredit = modifications.reduce((sum, m) => sum + m.priceDifference, 0);

  return (
    <div className="bg-bg-primary border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border">
        <h2 className="font-heading text-sm font-semibold text-text-primary">
          {t("modifiedArticles")} ({modifications.length})
        </h2>
      </div>

      <div className="divide-y divide-border-light">
        {modifications.map((mod) => (
          <div key={mod.orderItemId} className="px-5 py-4 space-y-2">
            <div className="flex gap-3 items-start">
              <OrderItemImage src={mod.imagePath} alt={mod.productName} sizeClass="w-10 h-10" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary font-body">{mod.productName}</p>
                <p className="text-xs font-mono text-text-muted">{mod.productRef}</p>
              </div>
              {mod.newQuantity === 0 ? (
                <span className="badge badge-error text-xs">{t("outOfStock")}</span>
              ) : (
                <span className="badge badge-warning text-xs">{t("stockModified")}</span>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-text-muted">{t("before")} :</span>
                <span className="font-semibold text-text-primary">{mod.originalQuantity}</span>
              </div>
              <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
              <div className="flex items-center gap-1.5">
                <span className="text-text-muted">{t("after")} :</span>
                <span className={`font-semibold ${mod.newQuantity === 0 ? "text-red-600" : "text-amber-600"}`}>
                  {mod.newQuantity}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted italic">
                {t(`modificationReason_${mod.reason}`)}
              </span>
              <span className="text-red-600 font-semibold">
                -{fmt(mod.priceDifference)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-border bg-amber-50">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-amber-700">{t("creditTotal")}</span>
          <span className="text-sm font-heading font-semibold text-amber-700">{fmt(totalCredit)}</span>
        </div>
      </div>
    </div>
  );
}
