"use client";

import { useEffect, useRef, useState } from "react";
import { VALID_LOCALES, LOCALE_FULL_NAMES } from "@/i18n/locales";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Nom actuel en français */
  initialName: string;
  /** Traductions existantes par locale */
  initialTranslations?: Record<string, string>;
  /** Si vrai, affiche un champ hex color */
  withHex?: boolean;
  initialHex?: string;
  onSave: (
    name: string,
    translations: Record<string, string>,
    hex?: string
  ) => Promise<void>;
}

export default function EntityEditModal({
  open,
  onClose,
  title,
  initialName,
  initialTranslations = {},
  withHex = false,
  initialHex,
  onSave,
}: Props) {
  const [name, setName] = useState(initialName);
  const [hex, setHex] = useState(initialHex ?? "#9CA3AF");
  const [translations, setTranslations] = useState<Record<string, string>>(
    () => ({ ...initialTranslations })
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens with new data
  useEffect(() => {
    if (open) {
      setName(initialName);
      setHex(initialHex ?? "#9CA3AF");
      setTranslations({ ...initialTranslations });
      setError("");
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [open, initialName, initialHex, initialTranslations]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Le nom en français est requis."); return; }
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim(), translations, withHex ? hex : undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la sauvegarde.");
    } finally {
      setSaving(false);
    }
  }

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fadeIn">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5]">
          <h2 className="text-base font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#1A1A1A] hover:bg-[#F7F7F8] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Hex (optionnel) */}
          {withHex && (
            <div>
              <label className="field-label uppercase tracking-wider text-xs font-semibold">
                Couleur hex
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => setHex(e.target.value)}
                  className="h-10 w-16 border border-[#E5E5E5] rounded-lg p-0.5 cursor-pointer"
                />
                <span className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">{hex}</span>
              </div>
            </div>
          )}

          {/* FR — requis */}
          <div>
            <label className="field-label uppercase tracking-wider text-xs font-semibold">
              Français <span className="text-[#EF4444]">*</span>
            </label>
            <input
              ref={firstInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="field-input"
              placeholder="Nom en français"
            />
          </div>

          {/* Autres langues */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#9CA3AF] font-[family-name:var(--font-roboto)] mb-3">
              Autres langues (optionnel)
            </p>
            <div className="grid grid-cols-2 gap-3">
              {VALID_LOCALES.filter((l) => l !== "fr").map((locale) => (
                <div key={locale}>
                  <label className="field-label uppercase tracking-wider text-xs font-semibold">
                    {LOCALE_FULL_NAMES[locale]}
                  </label>
                  <input
                    type="text"
                    value={translations[locale] ?? ""}
                    onChange={(e) =>
                      setTranslations((prev) => ({ ...prev, [locale]: e.target.value }))
                    }
                    className="field-input text-sm"
                    placeholder={LOCALE_FULL_NAMES[locale]}
                    dir={locale === "ar" ? "rtl" : undefined}
                  />
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)]">{error}</p>
          )}

          {/* Footer */}
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
