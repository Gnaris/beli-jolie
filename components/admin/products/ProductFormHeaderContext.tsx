"use client";
import { createContext, useContext, useState, useCallback } from "react";

export type StockState = "ok" | "partial_out" | "all_out";

export interface ProductFormHeaderState {
  productStatus: "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  stockState: StockState;
}

/** Callbacks exposed by ProductForm to let the header toggle status */
export interface StatusToggleCallbacks {
  getCompletenessErrors: () => string[];
  isOutOfStock: () => boolean;
  setProductStatus: (s: "OFFLINE" | "ONLINE" | "ARCHIVED") => void;
  setOnlineErrors: (e: string[]) => void;
  setError: (e: string) => void;
}

type HeaderUpdater = Partial<ProductFormHeaderState> | ((prev: ProductFormHeaderState) => ProductFormHeaderState);

interface ContextValue extends ProductFormHeaderState {
  updateHeader: (s: HeaderUpdater) => void;
  statusToggle: StatusToggleCallbacks | null;
  registerStatusToggle: (cb: StatusToggleCallbacks) => void;
}

const ProductFormHeaderContext = createContext<ContextValue>({
  productStatus: "OFFLINE",
  isIncomplete: false,
  stockState: "ok",
  updateHeader: () => {},
  statusToggle: null,
  registerStatusToggle: () => {},
});

export function ProductFormHeaderProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial: ProductFormHeaderState;
}) {
  const [state, setState] = useState<ProductFormHeaderState>(initial);
  const [statusToggle, setStatusToggle] = useState<StatusToggleCallbacks | null>(null);
  const updateHeader = useCallback((s: HeaderUpdater) => {
    setState((prev) => typeof s === "function" ? s(prev) : { ...prev, ...s });
  }, []);
  const registerStatusToggle = useCallback((cb: StatusToggleCallbacks) => {
    setStatusToggle(cb);
  }, []);
  return (
    <ProductFormHeaderContext.Provider value={{ ...state, updateHeader, statusToggle, registerStatusToggle }}>
      {children}
    </ProductFormHeaderContext.Provider>
  );
}

export function useProductFormHeader() {
  return useContext(ProductFormHeaderContext);
}
