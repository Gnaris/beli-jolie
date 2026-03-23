"use client";

import { useState, useEffect, useCallback } from "react";
import type { StagedProductFull, StagedComposition } from "./PfsProductDetailModal";
import CustomSelect from "@/components/ui/CustomSelect";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────

interface PfsEditCompositionsModalProps {
  product: StagedProductFull;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: StagedProductFull) => void;
}

interface CompositionOption {
  id: string;
  name: string;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function PfsEditCompositionsModal({ product, open, onClose, onSaved }: PfsEditCompositionsModalProps) {
  const [compositions, setCompositions] = useState<StagedComposition[]>(
    product.compositions.map((c) => ({ ...c })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compositionOptions, setCompositionOptions] = useState<CompositionOption[]>([]);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickCreateTargetIdx, setQuickCreateTargetIdx] = useState<number | null>(null);

  // Fetch available compositions
  const fetchCompositions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/pfs-sync/entities");
      if (res.ok) {
        const data = await res.json();
        setCompositionOptions(data.compositions || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (open) {
      setCompositions(product.compositions.map((c) => ({ ...c })));
      fetchCompositions();
    }
  }, [open, product.id, product.compositions, fetchCompositions]);

  const updateCompositionName = (idx: number, compositionId: string) => {
    const opt = compositionOptions.find((c) => c.id === compositionId);
    if (!opt) return;
    setCompositions((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], compositionId: opt.id, name: opt.name };
      return updated;
    });
  };

  const updatePercentage = (idx: number, value: number) => {
    setCompositions((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], percentage: value };
      return updated;
    });
  };

  const removeComposition = (idx: number) => {
    setCompositions((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      // Auto-redistribute percentages if any remain
      if (next.length > 0) {
        const even = Math.round((100 / next.length) * 100) / 100;
        return next.map((c) => ({ ...c, percentage: even }));
      }
      return next;
    });
  };

  const addComposition = (presetId?: string, presetName?: string) => {
    setCompositions((prev) => {
      const newComp: StagedComposition = {
        compositionId: presetId ?? "",
        name: presetName ?? "",
        percentage: 0,
      };
      const next = [...prev, newComp];
      // Auto-distribute percentages evenly
      const count = next.length;
      const even = Math.round((100 / count) * 100) / 100;
      return next.map((c) => ({ ...c, percentage: even }));
    });
  };

  const totalPct = compositions.reduce((sum, c) => sum + (c.percentage || 0), 0);
  const pctError = compositions.length > 0 && Math.abs(totalPct - 100) > 0.5;

  const handleSave = async () => {
    if (pctError) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pfs-sync/staged/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compositions }),
      });
      if (res.ok) {
        const data = await res.json();
        const p = data.product;
        const parsed = {
          ...p,
          variants: typeof p.variants === "string" ? JSON.parse(p.variants) : p.variants,
          compositions: typeof p.compositions === "string" ? JSON.parse(p.compositions) : p.compositions,
          translations: typeof p.translations === "string" ? JSON.parse(p.translations) : p.translations,
          imagesByColor: typeof p.imagesByColor === "string" ? JSON.parse(p.imagesByColor) : p.imagesByColor,
        };
        onSaved(parsed);
        onClose();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Erreur ${res.status}`);
      }
    } catch {
      setError("Erreur réseau lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const selectOptions = compositionOptions.map((c) => ({ value: c.id, label: c.name }));

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4">
        <div className="bg-bg-primary rounded-2xl max-w-lg w-full my-8 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary text-lg">
              Compositions
            </h2>
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-bg-secondary transition-colors"
              aria-label="Fermer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {compositions.length === 0 && (
              <p className="text-text-secondary text-sm text-center py-4">Aucune composition</p>
            )}

            {compositions.map((comp, idx) => (
              <div key={idx} className="flex items-center gap-3 bg-bg-secondary rounded-xl p-3">
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1">
                      <CustomSelect
                        value={comp.compositionId}
                        onChange={(val) => updateCompositionName(idx, val)}
                        options={selectOptions}
                        placeholder="Choisir…"
                        size="sm"
                        aria-label="Matériau"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => { setQuickCreateTargetIdx(idx); setShowQuickCreate(true); }}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-primary text-text-secondary transition-colors hover:bg-border hover:text-text-primary"
                      aria-label="Créer un matériau"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="w-20">
                  <label className="field-label text-xs">%</label>
                  <input
                    type="number"
                    className="field-input text-sm mt-1"
                    min={0}
                    max={100}
                    value={comp.percentage}
                    onChange={(e) => updatePercentage(idx, Number(e.target.value))}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeComposition(idx)}
                  className="mt-5 w-9 h-9 flex items-center justify-center rounded-lg text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors"
                  aria-label="Supprimer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}

            {/* Total % indicator */}
            {compositions.length > 0 && (
              <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-medium ${
                pctError
                  ? "bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/30"
                  : "bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/30"
              }`}>
                <span>Total</span>
                <span>{totalPct.toFixed(1)}%{pctError ? " — doit totaliser 100%" : ""}</span>
              </div>
            )}

            {/* Add composition button */}
            <button
              type="button"
              onClick={() => addComposition()}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Ajouter une composition
            </button>

            {/* Error */}
            {error && (
              <p className="text-sm text-[#EF4444]">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
            <button onClick={onClose} className="btn-secondary min-w-[140px]">Annuler</button>
            <button onClick={handleSave} disabled={saving || pctError} className="btn-primary min-w-[140px]">
              {saving ? "Sauvegarde…" : "Sauvegarder"}
            </button>
          </div>
        </div>
      </div>

      {/* QuickCreate Modal for compositions */}
      {showQuickCreate && (
        <QuickCreateModal
          type="composition"
          open={showQuickCreate}
          onClose={() => setShowQuickCreate(false)}
          onCreated={(item) => {
            setCompositionOptions((prev) => [...prev, { id: item.id, name: item.name }]);
            // Update the target row instead of adding a new one
            if (quickCreateTargetIdx !== null) {
              setCompositions((prev) => {
                const updated = [...prev];
                updated[quickCreateTargetIdx] = { ...updated[quickCreateTargetIdx], compositionId: item.id, name: item.name };
                return updated;
              });
            }
            setShowQuickCreate(false);
            setQuickCreateTargetIdx(null);
          }}
        />
      )}
    </>
  );
}
