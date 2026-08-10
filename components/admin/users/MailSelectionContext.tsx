"use client";

/**
 * Contexte de sélection multi-clients pour la Vue Mails.
 * Utilisé par les checkboxes de chaque ligne + la barre flottante Newsletter.
 */

import { createContext, useContext, useState, useCallback } from "react";

interface SelectionValue {
  selectedIds: string[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
}

const Ctx = createContext<SelectionValue | null>(null);

export function MailSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const isSelected = useCallback((id: string) => selectedIds.includes(id), [selectedIds]);
  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);
  const selectAll = useCallback((ids: string[]) => setSelectedIds(ids), []);
  const clear = useCallback(() => setSelectedIds([]), []);

  return (
    <Ctx.Provider value={{ selectedIds, isSelected, toggle, selectAll, clear }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMailSelection(): SelectionValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMailSelection must be used within <MailSelectionProvider>");
  return ctx;
}
