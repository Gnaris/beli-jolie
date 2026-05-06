"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import ColorSwatch from "@/components/ui/ColorSwatch";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import type {
  PackLineState,
  AvailableSize,
} from "./ColorVariantManager";

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialLines: PackLineState[];
  availableSizes: AvailableSize[];
  onSave: (lines: PackLineState[]) => void;
}

/**
 * Édition des tailles & quantités d'un paquet multi-couleurs.
 * Les couleurs sont passées en lecture seule depuis la cellule Couleur de la variante.
 * Règle PFS : toutes les couleurs d'un paquet partagent EXACTEMENT les mêmes tailles
 * (ajouter/retirer une taille s'applique à toutes les couleurs). Seules les quantités
 * par couleur×taille sont indépendantes.
 */
export default function PackCompositionModal({
  open,
  onClose,
  initialLines,
  availableSizes,
  onSave,
}: Props) {
  const backdrop = useBackdropClose(onClose);
  const [lines, setLines] = useState<PackLineState[]>([]);
  const [bulkQty, setBulkQty] = useState("");

  useEffect(() => {
    if (open) {
      // Harmoniser les tailles entre couleurs : on prend l'union des tailles présentes
      // dans la composition initiale, puis on garantit que chaque couleur a une entrée
      // pour chacune de ces tailles. Les quantités existantes sont préservées,
      // les nouvelles tailles ajoutées prennent la valeur 1 par défaut.
      const unionMap = new Map<string, { sizeId: string; sizeName: string }>();
      for (const l of initialLines) {
        for (const s of l.sizeEntries) {
          if (!unionMap.has(s.sizeId)) unionMap.set(s.sizeId, { sizeId: s.sizeId, sizeName: s.sizeName });
        }
      }
      const union = [...unionMap.values()];

      setLines(
        initialLines.map((l) => {
          const byId = new Map(l.sizeEntries.map((s) => [s.sizeId, s]));
          return {
            ...l,
            tempId: l.tempId || uid(),
            sizeEntries: union.map((u) => {
              const existing = byId.get(u.sizeId);
              return existing
                ? { ...existing, tempId: existing.tempId || uid() }
                : { tempId: uid(), sizeId: u.sizeId, sizeName: u.sizeName, quantity: "1" };
            }),
          };
        }),
      );
    }
  }, [open, initialLines]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const totalQty = useMemo(() => {
    let total = 0;
    for (const line of lines) {
      for (const se of line.sizeEntries) total += parseInt(se.quantity) || 0;
    }
    return total;
  }, [lines]);

  /** Active/désactive une taille pour TOUTES les couleurs du paquet. */
  function toggleCommonSize(size: AvailableSize) {
    setLines((prev) => {
      const present = prev.some((l) => l.sizeEntries.some((s) => s.sizeId === size.id));
      if (present) {
        // Retirer la taille de toutes les couleurs
        return prev.map((l) => ({
          ...l,
          sizeEntries: l.sizeEntries.filter((s) => s.sizeId !== size.id),
        }));
      }
      // Ajouter la taille à toutes les couleurs avec qty=1 par défaut
      return prev.map((l) => ({
        ...l,
        sizeEntries: [
          ...l.sizeEntries,
          { tempId: uid(), sizeId: size.id, sizeName: size.name, quantity: "1" },
        ],
      }));
    });
  }

  function updateLineSizeQty(lineTempId: string, sizeId: string, qty: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.tempId !== lineTempId) return l;
        return {
          ...l,
          sizeEntries: l.sizeEntries.map((s) => (s.sizeId === sizeId ? { ...s, quantity: qty } : s)),
        };
      }),
    );
  }

  function applyBulkQty() {
    const qty = parseInt(bulkQty);
    if (!qty || qty < 1) return;
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        sizeEntries: l.sizeEntries.map((s) => ({ ...s, quantity: String(qty) })),
      })),
    );
  }

  function handleConfirm() {
    onSave(lines);
    onClose();
  }

  const canConfirm = lines.length > 0 && lines.every(
    (l) => l.sizeEntries.length > 0 && l.sizeEntries.every((s) => parseInt(s.quantity) > 0),
  );

  if (!open) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col"
        style={{ maxHeight: "min(90vh, 760px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-base font-semibold font-heading text-text-primary">
              Tailles &amp; quantités du paquet
            </h3>
            <p className="text-xs text-text-muted font-body mt-0.5">
              Pour chaque couleur du paquet, choisissez les tailles et leurs quantités.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-bg-secondary rounded-xl transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {lines.length === 0 && (
            <div className="text-center py-10 text-sm text-text-muted font-body">
              Aucune couleur sélectionnée. Choisissez d&rsquo;abord les couleurs du paquet
              dans la colonne <span className="font-semibold text-text-secondary">Couleur</span>.
            </div>
          )}

          {lines.length > 0 && (
            <div className="border border-border rounded-2xl bg-bg-secondary/40 p-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-text-muted font-semibold font-body">
                Tailles du paquet
              </p>
              <p className="text-xs text-text-muted font-body">
                Chaque taille choisie est ajoutée pour toutes les couleurs du paquet.
              </p>
              {availableSizes.length === 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-body">
                  Aucune taille dans la bibliothèque. Créez-en une dans les variantes.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {availableSizes.map((size) => {
                    const isSelected = lines.some((l) => l.sizeEntries.some((s) => s.sizeId === size.id));
                    return (
                      <button
                        key={size.id}
                        type="button"
                        onClick={() => toggleCommonSize(size)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors font-body ${
                          isSelected
                            ? "bg-bg-dark text-text-inverse border-[#1A1A1A]"
                            : "bg-bg-primary text-text-secondary border-border hover:border-bg-dark"
                        }`}
                      >
                        {size.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {lines.length > 0 && lines.some((l) => l.sizeEntries.length > 0) && (
            <div className="border border-border rounded-2xl bg-bg-secondary/40 p-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-text-muted font-semibold font-body">
                Raccourci — appliquer à tout
              </p>
              <p className="text-xs text-text-muted font-body">
                Remplir la même quantité dans toutes les tailles de toutes les couleurs.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={bulkQty}
                  onChange={(e) => setBulkQty(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyBulkQty(); } }}
                  placeholder="Ex : 3"
                  className="w-20 border border-border bg-bg-primary px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-body"
                />
                <button
                  type="button"
                  onClick={applyBulkQty}
                  disabled={!bulkQty || parseInt(bulkQty) < 1}
                  className="px-3 py-1.5 text-xs font-medium font-body text-text-inverse bg-bg-dark rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Appliquer
                </button>
              </div>
            </div>
          )}

          {lines.map((line) => (
            <div
              key={line.tempId}
              className="border border-border rounded-2xl bg-bg-secondary/40 p-4 space-y-3"
            >
              <div className="flex items-center gap-2.5">
                <ColorSwatch hex={line.colorHex} size={22} rounded="full" border />
                <span className="text-sm font-semibold text-text-primary font-body">
                  {line.colorName || "Couleur sans nom"}
                </span>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-2 font-body">
                  Quantités par taille
                </p>
                {line.sizeEntries.length === 0 ? (
                  <p className="text-xs text-text-muted italic font-body">
                    Choisissez d&rsquo;abord les tailles du paquet ci-dessus.
                  </p>
                ) : (
                  <div className="rounded-xl bg-bg-primary border border-border p-3 space-y-1.5">
                    {line.sizeEntries.map((se) => (
                      <div key={se.tempId} className="flex items-center gap-2">
                        <span className="text-xs text-text-primary font-medium flex-1 font-body">
                          {se.sizeName}
                        </span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={se.quantity}
                          onChange={(e) => updateLineSizeQty(line.tempId, se.sizeId, e.target.value)}
                          className="w-16 border border-border bg-bg-primary px-2 py-1 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body"
                        />
                        <span className="text-[10px] text-text-muted font-body w-10">pièces</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-6 py-3.5 border-t border-border bg-bg-primary rounded-b-2xl shrink-0">
          <span className="text-sm text-text-secondary font-body">
            {totalQty > 0
              ? `Total : ${totalQty} pièce${totalQty > 1 ? "s" : ""} dans ${lines.length} couleur${lines.length > 1 ? "s" : ""}`
              : "Composition vide"}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-sm font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-xl hover:bg-bg-secondary transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="px-5 py-2 text-sm font-medium font-body text-text-inverse bg-bg-dark rounded-xl hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Valider
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof window !== "undefined" ? createPortal(modal, document.body) : null;
}
