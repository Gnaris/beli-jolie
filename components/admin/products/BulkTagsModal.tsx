"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export interface BulkTagsOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  selectedCount: number;
  tags: BulkTagsOption[];
  onCancel: () => void;
  onApply: (mode: "add" | "remove", tagIds: string[]) => Promise<void> | void;
  isPending?: boolean;
}

export default function BulkTagsModal({
  open,
  selectedCount,
  tags,
  onCancel,
  onApply,
  isPending = false,
}: Props) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setMode("add");
      setPickedIds(new Set());
      setSearch("");
      setError(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, search]);

  const togglePick = (id: string) => {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async () => {
    setError(null);
    if (pickedIds.size === 0) {
      setError("Sélectionnez au moins un tag.");
      return;
    }
    await onApply(mode, [...pickedIds]);
  };

  if (!open || typeof window === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-8">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={isPending ? undefined : onCancel}
      />

      <div className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-heading font-bold text-text-primary">Tags en masse</h2>
            <p className="text-sm text-text-secondary font-body mt-0.5">
              {selectedCount} produit{selectedCount > 1 ? "s" : ""} sélectionné{selectedCount > 1 ? "s" : ""}.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Choix mode */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("add")}
              className={`px-3 py-2.5 text-sm font-body rounded-lg border transition-colors ${
                mode === "add"
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-bg-primary text-text-primary border-border hover:border-bg-dark/40"
              }`}
            >
              + Ajouter les tags cochés
            </button>
            <button
              type="button"
              onClick={() => setMode("remove")}
              className={`px-3 py-2.5 text-sm font-body rounded-lg border transition-colors ${
                mode === "remove"
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-bg-primary text-text-primary border-border hover:border-bg-dark/40"
              }`}
            >
              − Retirer les tags cochés
            </button>
          </div>

          {/* Recherche */}
          {tags.length > 8 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un tag…"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg-primary focus:outline-none focus:ring-1 focus:ring-bg-dark/30"
            />
          )}

          {/* Liste tags */}
          {tags.length === 0 ? (
            <div className="text-sm text-text-muted font-body text-center py-8">
              Aucun tag disponible. Créez-en dans l'onglet « Mots clés ».
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-text-muted font-body text-center py-4">
              Aucun tag ne correspond à « {search} ».
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-[280px] overflow-y-auto p-1">
              {filtered.map((t) => {
                const checked = pickedIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => togglePick(t.id)}
                    className={`px-3 py-1.5 text-sm rounded-md border transition-colors font-body ${
                      checked
                        ? "bg-bg-dark text-text-inverse border-bg-dark"
                        : "bg-bg-primary text-text-primary border-border hover:border-bg-dark/40"
                    }`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}

          {pickedIds.size > 0 && (
            <div className="text-[12px] text-text-muted font-body">
              {pickedIds.size} tag{pickedIds.size > 1 ? "s" : ""} sélectionné{pickedIds.size > 1 ? "s" : ""}.
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-body px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="btn-secondary"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isPending || pickedIds.size === 0}
            className="btn-primary flex items-center gap-2"
          >
            {isPending && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {mode === "add"
              ? `Ajouter à ${selectedCount} produit${selectedCount > 1 ? "s" : ""}`
              : `Retirer de ${selectedCount} produit${selectedCount > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
