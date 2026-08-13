"use client";

/**
 * Provider global admin : quand une server action de mapping renvoie un
 * `impact` non-null (voir `lib/mapping-impact.ts`), le caller passe l'objet
 * à `showMappingImpact(summary)`. La modale `MappingChangeImpactModal`
 * s'ouvre. La file `queue` permet d'empiler plusieurs impacts (ex : on
 * change en même temps le mapping PFS et le mapping eFashion d'une catégorie
 * — deux modales successives).
 *
 * Placé dans `app/(admin)/layout.tsx` sous `MarketplaceRefreshProvider` car
 * la modale « Synchroniser maintenant » consomme `useMarketplaceRefreshQueue`.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { MappingChangeSummary } from "@/lib/mapping-impact-types";
import MappingChangeImpactModal from "./MappingChangeImpactModal";

interface Ctx {
  showMappingImpact: (summary: MappingChangeSummary) => void;
}

const MappingImpactContext = createContext<Ctx | null>(null);

export function MappingImpactProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<MappingChangeSummary[]>([]);

  const showMappingImpact = useCallback((summary: MappingChangeSummary) => {
    setQueue((prev) => [...prev, summary]);
  }, []);

  const handleClose = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  const current = queue[0] ?? null;

  const value = useMemo<Ctx>(() => ({ showMappingImpact }), [showMappingImpact]);

  return (
    <MappingImpactContext.Provider value={value}>
      {children}
      {current && (
        <MappingChangeImpactModal summary={current} onClose={handleClose} />
      )}
    </MappingImpactContext.Provider>
  );
}

export function useMappingImpact(): Ctx {
  const ctx = useContext(MappingImpactContext);
  if (!ctx) {
    // Fallback silencieux : si un composant est utilisé hors admin ou hors
    // provider (tests unitaires par ex.), on ne casse pas, on ignore.
    return { showMappingImpact: () => {} };
  }
  return ctx;
}
