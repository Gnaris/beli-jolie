"use client";
import { createContext, useContext, useState, useCallback } from "react";

export type StockState = "ok" | "partial_out" | "all_out";

export interface ProductFormKpi {
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  totalStock: number;
  linkedMarketplaces: number;
  totalMarketplaces: number;
  completeness: number;
}

export interface ProductFormHeaderState {
  productStatus: "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  stockState: StockState;
  isBestSeller: boolean;
  kpi: ProductFormKpi;
}

/** Callbacks exposed by ProductForm to let the header toggle status */
export interface StatusToggleCallbacks {
  getCompletenessErrors: () => string[];
  isOutOfStock: () => boolean;
  setProductStatus: (s: "OFFLINE" | "ONLINE" | "ARCHIVED") => void;
  setOnlineErrors: (e: string[]) => void;
  setError: (e: string) => void;
}

/** Callback exposed by ProductForm to let the header toggle best-seller */
export interface BestSellerToggleCallbacks {
  toggle: () => void;
}

type HeaderUpdater = Partial<ProductFormHeaderState> | ((prev: ProductFormHeaderState) => ProductFormHeaderState);

interface ContextValue extends ProductFormHeaderState {
  updateHeader: (s: HeaderUpdater) => void;
  statusToggle: StatusToggleCallbacks | null;
  registerStatusToggle: (cb: StatusToggleCallbacks) => void;
  bestSellerToggle: BestSellerToggleCallbacks | null;
  registerBestSellerToggle: (cb: BestSellerToggleCallbacks) => void;
}

const defaultKpi: ProductFormKpi = {
  avgPrice: null,
  minPrice: null,
  maxPrice: null,
  totalStock: 0,
  linkedMarketplaces: 0,
  totalMarketplaces: 0,
  completeness: 0,
};

const ProductFormHeaderContext = createContext<ContextValue>({
  productStatus: "OFFLINE",
  isIncomplete: false,
  stockState: "ok",
  isBestSeller: false,
  kpi: defaultKpi,
  updateHeader: () => {},
  statusToggle: null,
  registerStatusToggle: () => {},
  bestSellerToggle: null,
  registerBestSellerToggle: () => {},
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
  const [bestSellerToggle, setBestSellerToggle] = useState<BestSellerToggleCallbacks | null>(null);
  const updateHeader = useCallback((s: HeaderUpdater) => {
    setState((prev) => typeof s === "function" ? s(prev) : { ...prev, ...s });
  }, []);
  const registerStatusToggle = useCallback((cb: StatusToggleCallbacks) => {
    setStatusToggle(cb);
  }, []);
  const registerBestSellerToggle = useCallback((cb: BestSellerToggleCallbacks) => {
    setBestSellerToggle(cb);
  }, []);
  return (
    <ProductFormHeaderContext.Provider
      value={{
        ...state,
        updateHeader,
        statusToggle,
        registerStatusToggle,
        bestSellerToggle,
        registerBestSellerToggle,
      }}
    >
      {children}
    </ProductFormHeaderContext.Provider>
  );
}

export function useProductFormHeader() {
  return useContext(ProductFormHeaderContext);
}
