"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export interface BulkCollectionOption {
  id: string;
  name: string;
  productCount: number;
}

interface Props {
  open: boolean;
  selectedCount: number;
  onlineCount: number;
  collections: BulkCollectionOption[];
  onCancel: () => void;
  onApply: (collectionId: string) => Promise<void> | void;
  isPending?: boolean;
}

export default function BulkAddToCollectionModal({
  open,
  selectedCount,
  onlineCount,
  collections,
  onCancel,
  onApply,
  isPending = false,
}: Props) {
  const [pickedId, setPickedId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPickedId("");
      setSearch("");
      setError(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [collections, search]);

  const skipped = selectedCount - onlineCount;

  const handleApply = async () => {
    setError(null);
    if (!pickedId) {
      setError("Choisissez une collection.");
      return;
    }
    if (onlineCount === 0) {
      setError("Aucun produit en ligne : impossible d'ajouter à une collection.");
      return;
    }
    await onApply(pickedId);
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
            <h2 className="text-lg font-heading font-bold text-text-primary">
              Ajouter à une collection
            </h2>
            <p className="text-sm text-text-secondary font-body mt-0.5">
              {onlineCount} produit{onlineCount > 1 ? "s" : ""} en ligne
              {skipped > 0 && (
                <>
                  {" "}
                  <span className="text-amber-700">
                    · {skipped} ignoré{skipped > 1 ? "s" : ""} (brouillon/archivé)
                  </span>
                </>
              )}
              .
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
          {collections.length === 0 ? (
            <div className="text-sm text-text-muted font-body text-center py-8">
              Aucune collection disponible. Créez-en une dans la section « Collections ».
            </div>
          ) : (
            <>
              {collections.length > 6 && (
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher une collection…"
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg-primary focus:outline-none focus:ring-1 focus:ring-bg-dark/30"
                />
              )}

              <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                {filtered.map((c) => {
                  const active = pickedId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setPickedId(c.id)}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                        active
                          ? "bg-bg-dark text-text-inverse border-bg-dark"
                          : "bg-bg-primary text-text-primary border-border hover:border-bg-dark/40"
                      }`}
                    >
                      <span className="text-sm font-body truncate">{c.name}</span>
                      <span
                        className={`text-[11px] tabular-nums shrink-0 ${
                          active ? "text-white/70" : "text-text-muted"
                        }`}
                      >
                        {c.productCount} produit{c.productCount > 1 ? "s" : ""}
                      </span>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="text-sm text-text-muted font-body text-center py-4">
                    Aucune collection ne correspond à « {search} ».
                  </div>
                )}
              </div>
            </>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-body px-3 py-2">
              {error}
            </div>
          )}

          {onlineCount === 0 && collections.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm font-body px-3 py-2">
              Seuls les produits en ligne peuvent être ajoutés à une collection.
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
            disabled={isPending || !pickedId || onlineCount === 0}
            className="btn-primary flex items-center gap-2"
          >
            {isPending && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            Ajouter {onlineCount > 0 ? onlineCount : ""} produit{onlineCount > 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
