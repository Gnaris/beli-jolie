"use client";
import { ProductFormHeaderProvider, ProductFormHeaderState, useProductFormHeader } from "./ProductFormHeaderContext";

function HeaderBadges() {
  const { productStatus, isIncomplete, stockState } = useProductFormHeader();

  return (
    <>
      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-body ${
        productStatus === "ONLINE"
          ? "bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
          : "bg-bg-secondary text-text-secondary border border-border"
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${productStatus === "ONLINE" ? "bg-[#22C55E]" : "bg-[#9CA3AF]"}`} />
        {productStatus === "ONLINE" ? "En ligne" : isIncomplete ? "Brouillon" : "Hors ligne"}
      </span>
      {productStatus !== "ONLINE" && isIncomplete && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-body bg-[#F3E8FF] text-[#7C3AED] border border-[#DDD6FE]">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
          </svg>
          Brouillon
        </span>
      )}
      {stockState === "all_out" && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-body bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
          Rupture de stock
        </span>
      )}
      {stockState === "partial_out" && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-body bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#EA580C]" />
          Rupture de variant
        </span>
      )}
    </>
  );
}

export function ProductEditWrapper({
  staticHeader,
  initial,
  children,
}: {
  staticHeader: React.ReactNode;
  initial: ProductFormHeaderState;
  children: React.ReactNode;
}) {
  return (
    <ProductFormHeaderProvider initial={initial}>
      <div className="max-w-[1600px] mx-auto space-y-8">
        <div className="sticky top-0 z-20 bg-bg-secondary/95 backdrop-blur-sm border-b border-border -mx-6 px-6 pt-3 pb-4">
          {staticHeader}
          <div className="flex items-center gap-3 flex-wrap mt-4 pt-4 border-t border-border">
            <h2 className="font-heading text-lg font-bold text-text-primary">
              Informations du produit
            </h2>
            <div className="flex items-center gap-2">
              <HeaderBadges />
            </div>
          </div>
        </div>
        {children}
      </div>
    </ProductFormHeaderProvider>
  );
}
