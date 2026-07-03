"use client";

import { createContext, useContext, useTransition, type ReactNode, type TransitionStartFunction } from "react";

/**
 * Partage un état "un filtre / onglet / recherche est en train de recharger la
 * liste produits" entre les barres de filtres (`ThemedProductFilters`,
 * `CompactFiltersHeader`, `ProductStatusTabs`) et le tableau
 * (`AdminProductsTable`). Objectif : afficher un petit cercle de chargement
 * dans le tableau tant que la nouvelle page arrive du serveur.
 *
 * Sans provider (autres pages, tests isolés), le hook `useFilterPending()`
 * retombe sur un `useTransition()` local pour préserver le comportement
 * historique — les composants restent utilisables ailleurs sans casse.
 */
interface FilterPendingValue {
  isFiltering: boolean;
  startFiltering: TransitionStartFunction;
}

const FilterPendingCtx = createContext<FilterPendingValue | null>(null);

export function FilterPendingProvider({ children }: { children: ReactNode }) {
  const [isFiltering, startFiltering] = useTransition();
  return (
    <FilterPendingCtx.Provider value={{ isFiltering, startFiltering }}>
      {children}
    </FilterPendingCtx.Provider>
  );
}

export function useFilterPending(): FilterPendingValue {
  // Hook local systématiquement appelé pour respecter les règles de React ;
  // on l'utilise seulement en fallback quand aucun provider n'entoure l'arbre.
  const [localPending, localStart] = useTransition();
  const ctx = useContext(FilterPendingCtx);
  return ctx ?? { isFiltering: localPending, startFiltering: localStart };
}
