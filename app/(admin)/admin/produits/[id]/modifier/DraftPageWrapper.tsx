"use client";

import { ProductFormHeaderProvider } from "@/components/admin/products/ProductFormHeaderContext";

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
