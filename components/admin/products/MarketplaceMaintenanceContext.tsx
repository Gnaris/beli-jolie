"use client";

/**
 * Contexte simple qui expose les 4 flags de maintenance marketplace (contrôlés
 * depuis /admin/plateforme par la boutique maîtresse). Utilisé partout où on
 * affiche un badge marketplace pour le hachurer + désactiver les actions.
 *
 * Monté au layout admin avec la valeur récupérée côté serveur, il évite de
 * propager 4 nouvelles props dans les composants marketplace profondément
 * imbriqués (AdminProductsTable, MarketplaceStatusButtons, etc.).
 */
import { createContext, useContext, type ReactNode } from "react";

export interface MarketplaceMaintenanceState {
  pfs: boolean;
  ankorstore: boolean;
  efashion: boolean;
  faire: boolean;
}

const DEFAULT_STATE: MarketplaceMaintenanceState = {
  pfs: false,
  ankorstore: false,
  efashion: false,
  faire: false,
};

const MarketplaceMaintenanceContext = createContext<MarketplaceMaintenanceState>(DEFAULT_STATE);

export function MarketplaceMaintenanceProvider({
  value,
  children,
}: {
  value: MarketplaceMaintenanceState;
  children: ReactNode;
}) {
  return (
    <MarketplaceMaintenanceContext.Provider value={value}>
      {children}
    </MarketplaceMaintenanceContext.Provider>
  );
}

export function useMarketplaceMaintenance(): MarketplaceMaintenanceState {
  return useContext(MarketplaceMaintenanceContext);
}
