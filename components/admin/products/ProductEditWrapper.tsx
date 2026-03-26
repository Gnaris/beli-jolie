"use client";
import { ProductFormHeaderProvider, ProductFormHeaderState, useProductFormHeader } from "./ProductFormHeaderContext";

function HeaderBadges() {
  const { productStatus, isIncomplete, stockState } = useProductFormHeader();

  return (
    <>
      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-[family-name:var(--font-roboto)] ${
        productStatus === "ONLINE"
          ? "bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
          : "bg-[#F7F7F8] text-[#6B6B6B] border border-[#E5E5E5]"
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${productStatus === "ONLINE" ? "bg-[#22C55E]" : "bg-[#9CA3AF]"}`} />
        {productStatus === "ONLINE" ? "En ligne" : "Hors ligne"}
      </span>
      {productStatus !== "ONLINE" && isIncomplete && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-[family-name:var(--font-roboto)] bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          Incomplet
        </span>
      )}
      {stockState === "all_out" && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-[family-name:var(--font-roboto)] bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
          Rupture de stock
        </span>
      )}
      {stockState === "partial_out" && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-[family-name:var(--font-roboto)] bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]">
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
        <div className="sticky top-0 z-20 bg-bg-secondary border-b border-border -mx-6 px-6 pt-2 pb-4">
          {staticHeader}
          <div className="flex items-center gap-3 flex-wrap mt-3 pt-3 border-t border-border">
            <h2 className="font-[family-name:var(--font-poppins)] text-xl font-bold text-text-primary">
              Informations du produit
            </h2>
            <HeaderBadges />
          </div>
        </div>
        {children}
      </div>
    </ProductFormHeaderProvider>
  );
}
