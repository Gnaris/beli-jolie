"use client";

/**
 * CategoryEditorModal — modale légère dédiée à la création/renommage d'une
 * catégorie. Depuis 2026-08-25, les mappings marketplace ont été extraits
 * dans des mini-modals dédiés ouverts depuis la fiche catégorie (une carte
 * marketplace = un mini-modal). Cette modale ne gère plus que :
 *   - le nom en français (obligatoire)
 *   - la traduction anglaise (auto ou manuelle)
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { useAutoTranslateEnabled } from "@/components/admin/DeeplConfigContext";
import { createCategoryQuick } from "@/app/actions/admin/quick-create";
import TranslateButton from "@/components/admin/TranslateButton";
import TranslatingInput from "@/components/admin/TranslatingInput";
import { useAutoTranslateOnBlur } from "@/hooks/useAutoTranslateOnBlur";

export interface CategoryEditorEditMode {
  id: string;
  name: string;
  translations: Record<string, string>;
  onSave: (name: string, translations: Record<string, string>) => Promise<void>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (item: { id: string; name: string; subCategories?: { id: string; name: string }[] }) => void;
  editMode?: CategoryEditorEditMode;
}

export default function CategoryEditorModal({
  open,
  onClose,
  onCreated,
  editMode,
}: Props) {
  const isEdit = !!editMode;
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const backdrop = useBackdropClose(onClose);

  const [mounted, setMounted] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { handleFrBlur, isTranslating } = useAutoTranslateOnBlur({ names, setNames });

  useEffect(() => { setMounted(true); }, []);

  // Reset le state à chaque ouverture — évite les résidus d'une édition
  // précédente. Volontairement dépendant du seul flag `open`.
  useEffect(() => {
    if (!open) return;
    if (editMode) {
      setNames({ fr: editMode.name, ...editMode.translations });
    } else {
      setNames({});
    }
    setError("");
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const frName = (names["fr"] ?? "").trim();

  async function handleSubmit() {
    if (!frName) { setError("Le nom en français est obligatoire."); return; }
    setLoading(true);
    setError("");
    try {
      if (editMode) {
        const translations: Record<string, string> = {};
        for (const [locale, val] of Object.entries(names)) {
          if (locale !== "fr" && val?.trim()) translations[locale] = val.trim();
        }
        await editMode.onSave(frName, translations);
        onClose();
        return;
      }
      const result = await createCategoryQuick(names);
      onCreated?.(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'enregistrement.");
    } finally {
      setLoading(false);
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className="w-full max-w-lg bg-bg-primary rounded-t-[24px] sm:rounded-[28px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)] flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle-bar mobile (glisser pour fermer) */}
        <div className="sm:hidden pt-2 pb-1 flex justify-center shrink-0">
          <span aria-hidden className="w-10 h-1 rounded-full bg-bg-tertiary"></span>
        </div>
        {/* ── Header aurora ────────────────────────────────────────────── */}
        <div className="relative overflow-hidden border-b border-border shrink-0">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(60% 80% at 10% 0%, rgba(16,185,129,0.10), transparent 60%)," +
                "radial-gradient(50% 70% at 90% 10%, rgba(148,163,184,0.10), transparent 60%)",
            }}
          />
          <div className="relative px-5 sm:px-7 pt-4 sm:pt-6 pb-4 sm:pb-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <span className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-bg-primary border border-border shadow-sm text-emerald-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-[10.5px] font-bold uppercase tracking-[0.14em]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Catalogue · Catégorie
                  </span>
                  <h3 className="font-heading text-[20px] font-bold text-text-primary leading-tight mt-2 truncate">
                    {isEdit ? `Renommer « ${editMode.name} »` : "Créer une catégorie"}
                  </h3>
                  <p className="text-[12.5px] text-text-secondary mt-1 leading-relaxed">
                    {isEdit
                      ? "Modifie le nom. Les mappings marketplaces se règlent depuis la fiche."
                      : "Donne juste un nom. Les mappings marketplaces se règlent après-coup."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-4 sm:space-y-5">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">
              <span aria-hidden className="w-[3px] h-[14px] rounded-full bg-emerald-500" />
              Identité
            </span>
            {autoTranslateEnabled && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Traduction auto activée
              </span>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">
              Nom en français <span className="text-[#EF4444] normal-case font-bold">*</span>
            </label>
            <input
              type="text"
              value={names["fr"] ?? ""}
              onChange={(e) => setNames((prev) => ({ ...prev, fr: e.target.value }))}
              onBlur={handleFrBlur}
              autoFocus
              placeholder="Ex : Bague, Collier, Boucles d'oreilles…"
              className="field-input w-full text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
              }}
            />
            <p className="text-[11px] text-text-muted mt-1.5">Ce nom apparaît sur ton site et sert aux recherches.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Anglais</p>
              {!autoTranslateEnabled && (
                <TranslateButton
                  text={frName}
                  onTranslated={(t) => setNames((prev) => ({ ...prev, ...t }))}
                  disabled={!frName}
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-bg-tertiary text-text-secondary text-[10.5px] font-semibold">
                🇬🇧 EN
              </span>
              <TranslatingInput
                translating={isTranslating("en")}
                type="text"
                value={names["en"] ?? ""}
                onChange={(e) => setNames((prev) => ({ ...prev, en: e.target.value }))}
                placeholder="Ex : Ring, Necklace, Earrings…"
                className="field-input w-full text-sm"
              />
            </div>
            <p className="text-[11px] text-text-muted mt-1.5">
              {autoTranslateEnabled
                ? "Traduite automatiquement quand tu quittes le champ français — tu peux la corriger à la main."
                : "Utilisée pour les visiteurs anglophones du site."}
            </p>
          </div>

          <div className="rounded-2xl bg-bg-secondary border border-border p-4 flex gap-3">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-bg-primary border border-border shrink-0 text-text-secondary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18h.008v-.008H12V18z" />
              </svg>
            </span>
            <p className="text-[12px] text-text-secondary leading-relaxed">
              <strong className="text-text-primary">Prochaine étape</strong> — {isEdit
                ? "les correspondances marketplaces se règlent depuis la fiche (une carte = un mini-modal)."
                : "après création, clique sur la nouvelle catégorie puis sur chaque carte marketplace pour la relier."}
            </p>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        {/* Sur mobile : hint sur une ligne au-dessus, boutons pleine largeur en dessous.
            Sur desktop : hint à gauche, boutons à droite comme avant. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 px-5 sm:px-7 py-3 sm:py-4 border-t border-border shrink-0 bg-bg-primary">
          <div className="flex-1 min-w-0">
            {error ? (
              <p className="inline-flex items-center gap-1.5 text-xs text-[#DC2626] font-medium">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                {error}
              </p>
            ) : !frName ? (
              <p className="text-[11.5px] text-text-muted">Commence par le nom en français.</p>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-[11.5px] text-emerald-700">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Prêt à {isEdit ? "enregistrer" : "créer"}.
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none inline-flex items-center justify-center h-11 sm:h-10 px-4 border border-border text-text-secondary hover:border-ink hover:text-text-primary text-sm font-medium rounded-lg transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !frName}
              className="flex-[2] sm:flex-none inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-5 bg-bg-dark hover:bg-black text-text-inverse text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                    <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  {isEdit ? "Enregistrement…" : "Création…"}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {isEdit ? "Enregistrer" : "Créer la catégorie"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
