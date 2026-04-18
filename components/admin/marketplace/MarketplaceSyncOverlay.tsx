/**
 * Stub — the live marketplace sync overlay was removed. Marketplaces are now
 * populated via manual Excel upload. These no-op exports keep legacy imports
 * compiling until the remaining references are cleaned up.
 */
"use client";

import { createContext, useContext } from "react";

interface MarketplaceSyncContextValue {
  startSync: (productIds: string[], marketplaces: string[]) => void;
  syncingProductIds: Set<string>;
}

const MarketplaceSyncContext = createContext<MarketplaceSyncContextValue>({
  startSync: () => {},
  syncingProductIds: new Set(),
});

export function useMarketplaceSync() {
  return useContext(MarketplaceSyncContext);
}

export function MarketplaceSyncProvider({ children }: { children: React.ReactNode }) {
  return (
    <MarketplaceSyncContext.Provider value={{ startSync: () => {}, syncingProductIds: new Set() }}>
      {children}
    </MarketplaceSyncContext.Provider>
  );
}
