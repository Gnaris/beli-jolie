"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  createCategoryQuick,
  createSubCategoryQuick,
  createCompositionQuick,
  createColorQuick,
  createTagQuick,
} from "@/app/actions/admin/quick-create";
import { VALID_LOCALES, LOCALE_FULL_NAMES } from "@/i18n/locales";

export type QuickCreateType = "category" | "subcategory" | "composition" | "color" | "tag";

interface QuickCreateModalProps {
  type: QuickCreateType;
  open: boolean;
  onClose: () => void;
  onCreated: (item: { id: string; name: string; hex?: string | null; subCategories?: { id: string; name: string }[] }) => void;
  /** Required when type === "subcategory" */
  categoryId?: string;
}

const TITLES: Record<QuickCreateType, string> = {
  category:    "Créer une catégorie",
  subcategory: "Créer une sous-catégorie",
  composition: "Créer un matériau",
  color:       "Créer une couleur",
  tag:         "Créer un mot-clé",
};

const PLACEHOLDERS: Record<QuickCreateType, string> = {
  category:    "Ex: Bijoux, Maroquinerie…",
  subcategory: "Ex: Bagues, Bracelets…",
  composition: "Ex: Acier inoxydable, Or 18k…",
  color:       "Ex: Or rose, Argent…",
  tag:         "Ex: tendance, été…",
};

const RTL = ["ar"];

export default function QuickCreateModal({
  type, open, onClose, onCreated, categoryId,
}: QuickCreateModalProps) {
  const [mounted, setMounted] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [hex, setHex] = useState("#9CA3AF");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open) {
      setNames({});
      setHex("#9CA3AF");
      setError("");
    }
  }, [open]);

  function setName(locale: string, value: string) {
    setNames((prev) => ({ ...prev, [locale]: value }));
  }

  async function handleCreate() {
    const frName = names["fr"]?.trim();
    if (!frName) { setError("Le nom en français est requis."); return; }
    setLoading(true);
    setError("");
    try {
      let result: { id: string; name: string; hex?: string | null; subCategories?: { id: string; name: string }[] };
      if (type === "category") {
        result = await createCategoryQuick(names);
      } else if (type === "subcategory") {
        if (!categoryId) throw new Error("Catégorie parente requise.");
        result = await createSubCategoryQuick(names, categoryId);
      } else if (type === "composition") {
        result = await createCompositionQuick(names);
      } else if (type === "tag") {
        result = await createTagQuick(names);
      } else {
        result = await createColorQuick(names, hex);
      }
      onCreated(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de la création.");
    } finally {
      setLoading(false);
    }
  }

  if (!mounted || !open) return null;

  const frName = names["fr"]?.trim() ?? "";

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-[0_20px_60px_rgba(0,0,0,0.4)] space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A]">
            {TITLES[type]}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-[#1A1A1A] transition-colors rounded-lg p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Locale name fields */}
        <div className="space-y-3">
          <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
            Le nom en français est obligatoire. Les autres langues sont optionnelles.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {VALID_LOCALES.map((locale) => {
              const isRtl = RTL.includes(locale);
              const isFr = locale === "fr";
              return (
                <div key={locale}>
                  <label className="block text-xs font-semibold text-[#6B6B6B] font-[family-name:var(--font-roboto)] mb-1">
                    {LOCALE_FULL_NAMES[locale]}{isFr && <span className="text-[#EF4444] ml-0.5">*</span>}
                  </label>
                  <input
                    type="text"
                    value={names[locale] ?? ""}
                    onChange={(e) => setName(locale, e.target.value)}
                    autoFocus={isFr}
                    placeholder={isFr ? PLACEHOLDERS[type] : ""}
                    dir={isRtl ? "rtl" : "ltr"}
                    className="field-input w-full text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && isFr) { e.preventDefault(); handleCreate(); }
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Color hex picker */}
        {type === "color" && (
          <div>
            <label className="block text-sm font-semibold text-[#6B6B6B] font-[family-name:var(--font-roboto)] mb-1.5">
              Couleur hex
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={hex}
                onChange={(e) => setHex(e.target.value)}
                className="w-10 h-10 rounded-lg border border-[#E5E5E5] cursor-pointer p-0.5 shrink-0"
              />
              <input
                type="text"
                value={hex}
                onChange={(e) => setHex(e.target.value)}
                placeholder="#9CA3AF"
                className="field-input flex-1"
              />
            </div>
            <div
              className="mt-2 h-8 rounded-lg border border-[#E5E5E5]"
              style={{ backgroundColor: hex }}
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-[#DC2626] font-[family-name:var(--font-roboto)]">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={handleCreate}
            disabled={loading || !frName}
            className="flex-1 bg-[#1A1A1A] hover:bg-black text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50 font-[family-name:var(--font-roboto)]"
          >
            {loading ? "Création…" : "Créer"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-[#E5E5E5] text-[#6B6B6B] hover:border-[#1A1A1A] hover:text-[#1A1A1A] text-sm font-medium py-2.5 px-4 rounded-lg transition-colors font-[family-name:var(--font-roboto)]"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
