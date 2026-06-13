"use client";

/**
 * SizeMappingModal — modal dédiée pour mapper une taille BJ à PFS.
 *
 * Sizes n'utilisent pas QuickCreateModal (édition inline historique) — on
 * recrée ici le même pattern visuel pour une expérience cohérente avec les
 * autres bibliothèques.
 *
 * Spécificités :
 * - PFS = single string (`pfsSizeRef`) via CustomSelect alimenté par
 *   `pfsSizes` reçus en props (annexes PFS pré-chargées dans la page).
 * - Suggestion automatique : match du nom de taille vs PFS refs.
 *
 * Note eFashion : aucune liaison à stocker côté taille. eFashion résout la
 * « déclinaison » dynamiquement au moment de publier (cf.
 * `lib/efashion-declinaison-matcher.ts`) — elle est réutilisée si elle existe
 * déjà, sinon créée automatiquement.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import CustomSelect from "@/components/ui/CustomSelect";
import { useToast } from "@/components/ui/Toast";

interface PfsSizeOption {
  reference: string;
  label: string;
}

interface Props {
  sizeId: string;
  sizeName: string;
  pfsRef: string | null;
  pfsOptions: PfsSizeOption[];
  pfsEnabled: boolean;
  /** Callback to save PFS ref (the existing inline flow). */
  onSavePfsRef: (sizeId: string, ref: string) => Promise<void>;
  onClose: () => void;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export default function SizeMappingModal({
  sizeId,
  sizeName,
  pfsRef,
  pfsOptions,
  pfsEnabled,
  onSavePfsRef,
  onClose,
}: Props) {
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const backdrop = useBackdropClose(onClose);

  const [pfsValue, setPfsValue] = useState(pfsRef ?? "");
  const [pfsSaving, startPfsSaving] = useTransition();

  useEffect(() => {
    setMounted(true);
  }, []);

  const pfsSuggestions = useMemo(() => {
    if (!sizeName) return [];
    const norm = normalize(sizeName);
    return pfsOptions
      .filter((o) => {
        const refNorm = normalize(o.reference);
        const labelNorm = normalize(o.label);
        return refNorm === norm || labelNorm === norm || refNorm.includes(norm) || labelNorm.includes(norm);
      })
      .slice(0, 3);
  }, [pfsOptions, sizeName]);

  function savePfs(ref: string) {
    setPfsValue(ref);
    startPfsSaving(async () => {
      try {
        await onSavePfsRef(sizeId, ref);
      } catch (err) {
        toast.error("Erreur PFS", err instanceof Error ? err.message : "Erreur");
        setPfsValue(pfsRef ?? "");
      }
    });
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className="bg-bg-primary rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] flex flex-col max-h-[90vh] w-full max-w-[640px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="font-heading text-base font-semibold text-text-primary">
              Correspondance Paris Fashion Shop
            </h3>
            <p className="text-xs text-text-secondary font-body mt-0.5">
              Taille « {sizeName} »
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {pfsEnabled && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex w-1.5 h-1.5 rounded-full bg-purple-500" />
                <p className="text-xs font-semibold text-text-primary font-body uppercase tracking-wider">
                  Paris Fashion Shop
                </p>
              </div>

              {pfsSuggestions.length > 0 && pfsValue === "" && (
                <div className="rounded-lg border border-purple-200 bg-purple-50/60 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider font-body font-semibold text-purple-700 mb-1.5">
                    Suggestions détectées
                  </p>
                  <div className="flex flex-col gap-1">
                    {pfsSuggestions.map((s) => (
                      <button
                        key={s.reference}
                        type="button"
                        onClick={() => savePfs(s.reference)}
                        disabled={pfsSaving}
                        className="text-left flex items-center justify-between gap-2 px-2 py-1 rounded text-xs font-body bg-bg-primary hover:bg-purple-100 border border-purple-200 transition-colors disabled:opacity-50"
                      >
                        <span className="truncate text-text-primary">{s.label}</span>
                        <span className="shrink-0 text-[10px] text-purple-700">{s.reference}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <CustomSelect
                value={pfsValue}
                onChange={(v) => savePfs(v)}
                options={pfsOptions.map((o) => ({ value: o.reference, label: o.label }))}
                searchable
                size="sm"
                placeholder="Choisir une référence PFS…"
                emptyMessage="Aucune référence"
                disabled={pfsSaving}
              />
            </div>
          )}

          <p className="text-[11px] text-text-muted font-body leading-relaxed">
            Pour eFashion, la « série de tailles » (déclinaison) est gérée
            automatiquement à la publication : aucune correspondance à saisir
            ici.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-bg-secondary/30 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-border text-sm font-body text-text-secondary hover:bg-bg-secondary"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
