"use client";

/**
 * SizeMappingModal — modal dédiée pour mapper une taille BJ aux marketplaces.
 *
 * Sizes n'utilisent pas QuickCreateModal (édition inline historique) — on
 * recrée ici le même pattern visuel (sidebar 2 blocs : PFS + eFashion) pour
 * une expérience cohérente avec les autres bibliothèques.
 *
 * Spécificités :
 * - PFS = single string (`pfsSizeRef`) via CustomSelect alimenté par
 *   `pfsSizes` reçus en props (annexes PFS pré-chargées dans la page).
 * - eFashion = 2 dropdowns dépendants : déclinaison (groupe de tailles) puis
 *   champ (`d1_FR`..`d12_FR`).
 * - Suggestions automatiques : match du nom de taille vs valeurs eFashion
 *   et vs PFS refs.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import CustomSelect from "@/components/ui/CustomSelect";
import { useToast } from "@/components/ui/Toast";
import {
  loadEfashionAnnexes,
  updateSizeEfashionMapping,
} from "@/app/actions/admin/efashion-mappings";
import type { EfashionAnnexes } from "@/lib/efashion-annexes";

interface PfsSizeOption {
  reference: string;
  label: string;
}

interface Props {
  sizeId: string;
  sizeName: string;
  pfsRef: string | null;
  efashionDeclinaisonId: number | null;
  efashionDeclinaisonField: string | null;
  pfsOptions: PfsSizeOption[];
  pfsEnabled: boolean;
  /** Callback to save PFS ref (the existing inline flow). */
  onSavePfsRef: (sizeId: string, ref: string) => Promise<void>;
  onClose: () => void;
}

let annexesCache: EfashionAnnexes | null = null;
let annexesPromise: Promise<EfashionAnnexes | null> | null = null;
async function ensureAnnexes(): Promise<EfashionAnnexes | null> {
  if (annexesCache) return annexesCache;
  if (annexesPromise) return annexesPromise;
  annexesPromise = loadEfashionAnnexes().then((res) =>
    res.success ? (annexesCache = res.data) : null,
  );
  return annexesPromise;
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
  efashionDeclinaisonId,
  efashionDeclinaisonField,
  pfsOptions,
  pfsEnabled,
  onSavePfsRef,
  onClose,
}: Props) {
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const backdrop = useBackdropClose(onClose);

  // PFS state
  const [pfsValue, setPfsValue] = useState(pfsRef ?? "");
  const [pfsSaving, startPfsSaving] = useTransition();

  // eFashion state
  const [annexes, setAnnexes] = useState<EfashionAnnexes | null>(null);
  const [loadingAnnexes, setLoadingAnnexes] = useState(true);
  const [annexesError, setAnnexesError] = useState<string | null>(null);
  const [efDeclId, setEfDeclId] = useState<number | null>(efashionDeclinaisonId);
  const [efField, setEfField] = useState<string | null>(efashionDeclinaisonField);
  const [efSaving, startEfSaving] = useTransition();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    ensureAnnexes().then((data) => {
      if (cancelled) return;
      if (data) setAnnexes(data);
      else setAnnexesError("Listes eFashion indisponibles.");
      setLoadingAnnexes(false);
    });
    return () => { cancelled = true; };
  }, []);

  // ─── Suggestions automatiques eFashion ────────────────────────────────
  const efashionSuggestions = useMemo(() => {
    if (!annexes || !sizeName) return [];
    const norm = normalize(sizeName);
    const matches: Array<{ declinaisonId: number; declinaisonTitle: string; field: string; value: string; score: number }> = [];
    for (const decl of annexes.declinaisons) {
      for (const size of decl.sizes) {
        const sizeNorm = normalize(size.value);
        let score = 0;
        if (sizeNorm === norm) score = 100;
        else if (sizeNorm.includes(norm)) score = 60;
        else if (norm.includes(sizeNorm)) score = 40;
        if (score > 0) {
          matches.push({
            declinaisonId: decl.id,
            declinaisonTitle: decl.titre,
            field: size.field,
            value: size.value,
            score,
          });
        }
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 4);
  }, [annexes, sizeName]);

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

  // ─── Save handlers ─────────────────────────────────────────────────────
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

  function saveEf(declId: number | null, field: string | null) {
    setEfDeclId(declId);
    setEfField(field);
    startEfSaving(async () => {
      const res = await updateSizeEfashionMapping(sizeId, declId, field);
      if (!res.success) {
        toast.error("Erreur eFashion", res.error ?? "Erreur");
        setEfDeclId(efashionDeclinaisonId);
        setEfField(efashionDeclinaisonField);
      }
    });
  }

  if (!mounted) return null;

  // Trouve la déclinaison sélectionnée pour la 2ᵉ dropdown
  const selectedDecl = annexes?.declinaisons.find((d) => d.id === efDeclId);

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
              Correspondances Marketplaces
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
          {/* ── Bloc PFS ───────────────────────────────────────────────── */}
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

          {/* ── Bloc eFashion ──────────────────────────────────────────── */}
          <div className={`space-y-3 ${pfsEnabled ? "pt-4 border-t border-border" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="inline-flex w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <p className="text-xs font-semibold text-text-primary font-body uppercase tracking-wider">
                eFashion Paris
              </p>
            </div>

            {loadingAnnexes && (
              <p className="text-xs text-text-muted font-body">Chargement des déclinaisons…</p>
            )}
            {annexesError && (
              <p className="text-xs text-[#EF4444] font-body">{annexesError}</p>
            )}

            {!loadingAnnexes && annexes && (
              <>
                {efashionSuggestions.length > 0 && efDeclId === null && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wider font-body font-semibold text-emerald-700 mb-1.5">
                      Suggestions détectées
                    </p>
                    <div className="flex flex-col gap-1">
                      {efashionSuggestions.map((s) => (
                        <button
                          key={`${s.declinaisonId}-${s.field}`}
                          type="button"
                          onClick={() => saveEf(s.declinaisonId, s.field)}
                          disabled={efSaving}
                          className="text-left flex items-center justify-between gap-2 px-2 py-1 rounded text-xs font-body bg-bg-primary hover:bg-emerald-100 border border-emerald-200 transition-colors disabled:opacity-50"
                        >
                          <span className="truncate text-text-primary">
                            <strong>{s.value}</strong>
                            <span className="text-text-muted ml-1">(décl. {s.declinaisonTitle})</span>
                          </span>
                          <span className="shrink-0 text-[10px] text-emerald-700">{s.field}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] text-text-muted mb-1 font-body">
                      Déclinaison (groupe de tailles)
                    </label>
                    <CustomSelect
                      value={efDeclId !== null ? String(efDeclId) : ""}
                      onChange={(v) => {
                        const newId = v ? Number(v) : null;
                        // Reset le champ si on change de déclinaison
                        saveEf(newId, null);
                      }}
                      options={annexes.declinaisons.map((d) => ({
                        value: String(d.id),
                        label: `${d.titre} (${d.sizes.length} taille${d.sizes.length > 1 ? "s" : ""})`,
                      }))}
                      searchable
                      size="sm"
                      placeholder="Choisir une déclinaison…"
                      emptyMessage="Aucune déclinaison"
                      disabled={efSaving}
                    />
                  </div>

                  {selectedDecl && (
                    <div>
                      <label className="block text-[11px] text-text-muted mb-1 font-body">
                        Taille dans cette déclinaison
                      </label>
                      <CustomSelect
                        value={efField ?? ""}
                        onChange={(v) => saveEf(efDeclId, v || null)}
                        options={selectedDecl.sizes.map((s) => ({
                          value: s.field,
                          label: `${s.value} (${s.field})`,
                        }))}
                        searchable
                        size="sm"
                        placeholder="Choisir une taille…"
                        emptyMessage="Aucune taille"
                        disabled={efSaving}
                      />
                    </div>
                  )}

                  {(efDeclId !== null || efField !== null) && (
                    <button
                      type="button"
                      onClick={() => saveEf(null, null)}
                      disabled={efSaving}
                      className="text-xs text-[#DC2626] hover:underline font-body"
                    >
                      Effacer la liaison eFashion
                    </button>
                  )}
                </div>
              </>
            )}

            <p className="text-[11px] text-text-muted font-body leading-relaxed">
              Enregistré automatiquement à chaque changement.
            </p>
          </div>
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
