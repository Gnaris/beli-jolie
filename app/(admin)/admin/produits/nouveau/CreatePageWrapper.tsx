"use client";

import { ProductFormHeaderProvider } from "@/components/admin/products/ProductFormHeaderContext";
import { StatusToggle } from "@/components/admin/products/ProductEditWrapper";

export function CreatePageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ProductFormHeaderProvider
      initial={{
        productStatus: "OFFLINE",
        isIncomplete: true,
        stockState: "ok",
      }}
    >
      {children}
    </ProductFormHeaderProvider>
  );
}

export function CreatePageToggle() {
  return <StatusToggle mode="create" />;
}
