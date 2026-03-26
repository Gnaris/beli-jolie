"use client";
import { createContext, useContext, useState, useCallback } from "react";

export type StockState = "ok" | "partial_out" | "all_out";

export interface ProductFormHeaderState {
  productStatus: "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  stockState: StockState;
}

interface ContextValue extends ProductFormHeaderState {
  updateHeader: (s: Partial<ProductFormHeaderState>) => void;
}

const ProductFormHeaderContext = createContext<ContextValue>({
  productStatus: "OFFLINE",
  isIncomplete: false,
  stockState: "ok",
  updateHeader: () => {},
});

export function ProductFormHeaderProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial: ProductFormHeaderState;
}) {
  const [state, setState] = useState<ProductFormHeaderState>(initial);
  const updateHeader = useCallback((s: Partial<ProductFormHeaderState>) => {
    setState((prev) => ({ ...prev, ...s }));
  }, []);
  return (
    <ProductFormHeaderContext.Provider value={{ ...state, updateHeader }}>
      {children}
    </ProductFormHeaderContext.Provider>
  );
}

export function useProductFormHeader() {
  return useContext(ProductFormHeaderContext);
}
