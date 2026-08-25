"use client";
import { useProductFormHeader } from "./ProductFormHeaderContext";

export function HeaderInlineBadges() {
  const { productStatus, isIncomplete, stockState } = useProductFormHeader();

  const statusBadge = (() => {
    if (productStatus === "ARCHIVED") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold font-body bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB]">
          Archivé
        </span>
      );
    }
    if (productStatus === "SYNCING") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold font-body bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#EA580C] animate-pulse" />
          Publication en cours
        </span>
      );
    }
    return null;
  })();

  return (
    <>
      {statusBadge}
      {productStatus !== "ONLINE" && isIncomplete && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold font-body bg-[#F3E8FF] text-[#7C3AED] border border-[#DDD6FE]">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
          </svg>
          Brouillon
        </span>
      )}
      {stockState === "all_out" && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold font-body bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
          Rupture de stock
        </span>
      )}
      {stockState === "partial_out" && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold font-body bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#EA580C]" />
          Rupture de variante
        </span>
      )}
    </>
  );
}
