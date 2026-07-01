"use client";

import { ProductFormHeaderProvider } from "@/components/admin/products/ProductFormHeaderContext";
import { StatusToggle } from "@/components/admin/products/ProductEditWrapper";
import { BestSellerToggle } from "@/components/admin/products/BestSellerToggle";
import { KpiRow } from "@/components/admin/products/KpiRow";

export function DraftPageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ProductFormHeaderProvider
      initial={{
        productStatus: "OFFLINE",
        isIncomplete: true,
        stockState: "ok",
        isBestSeller: false,
        kpi: {
          avgPrice: null,
          minPrice: null,
          maxPrice: null,
          totalStock: 0,
          linkedMarketplaces: 0,
          totalMarketplaces: 0,
          completeness: 0,
        },
      }}
    >
      {children}
    </ProductFormHeaderProvider>
  );
}

export function DraftPageToggle() {
  return <StatusToggle mode="create" />;
}

/** Rangée KPI + toggle Best-seller — à afficher en haut de la page brouillon */
export function DraftPageChrome() {
  return (
    <>
      <KpiRow />
      <div className="flex items-center justify-end gap-3 flex-wrap mt-4 pt-4 border-t border-border">
        <BestSellerToggle />
        <StatusToggle mode="create" />
      </div>
    </>
  );
}
