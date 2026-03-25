"use client";

import { useEffect, useRef, useState } from "react";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { VALID_LOCALES, LOCALE_FULL_NAMES } from "@/i18n/locales";
import TranslateButton from "@/components/admin/TranslateButton";

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
  /** Image motif existante (prioritaire sur hex) */
  initialPatternImage?: string | null;
  onSave: (
    name: string,
    translations: Record<string, string>,
    hex?: string,
    patternImage?: string | null
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
  initialPatternImage,
  onSave,
}: Props) {
  const [name, setName] = useState(initialName);
  const [hex, setHex] = useState(initialHex ?? "#9CA3AF");
  const [colorMode, setColorMode] = useState<"hex" | "pattern">(initialPatternImage ? "pattern" : "hex");
  const [patternFile, setPatternFile] = useState<File | null>(null);
  const [patternPreview, setPatternPreview] = useState<string | null>(initialPatternImage ?? null);
  const [existingPatternImage, setExistingPatternImage] = useState<string | null>(initialPatternImage ?? null);
  const [translations, setTranslations] = useState<Record<string, string>>(
    () => ({ ...initialTranslations })
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const firstInputRef = useRef<HTMLInputElement>(null);
  const backdrop = useBackdropClose(onClose);

  // Reset form when modal opens with new data
  useEffect(() => {
    if (open) {
      setName(initialName);
      setHex(initialHex ?? "#9CA3AF");
      setColorMode(initialPatternImage ? "pattern" : "hex");
      setPatternFile(null);
      setPatternPreview(initialPatternImage ?? null);
      setExistingPatternImage(initialPatternImage ?? null);
      setTranslations({ ...initialTranslations });
      setError("");
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [open, initialName, initialHex, initialPatternImage, initialTranslations]);

  function handlePatternFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Format non supporté. Utilisez PNG, JPG ou WebP.");
      return;
    }
    if (file.size > 512 * 1024) {
      setError("Image trop lourde (max 500 KB).");
      return;
    }
    setError("");
    setPatternFile(file);
    setPatternPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Le nom en français est requis."); return; }
    setSaving(true);
    setError("");
    try {
      let finalPatternImage: string | null | undefined = undefined;
      if (withHex) {
        if (colorMode === "pattern") {
          if (patternFile) {
            // Upload new pattern image
            const fd = new FormData();
            fd.append("file", patternFile);
            const res = await fetch("/api/admin/colors/upload-pattern", { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erreur upload motif.");
            finalPatternImage = data.path;
          } else {
            // Keep existing pattern image
            finalPatternImage = existingPatternImage;
          }
        } else {
          // hex mode — clear pattern
          finalPatternImage = null;
        }
      }
      await onSave(
        name.trim(),
        translations,
        withHex && colorMode === "hex" ? hex : undefined,
        finalPatternImage,
      );
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
        onMouseDown={backdrop.onMouseDown}
        onMouseUp={backdrop.onMouseUp}
      />

      {/* Panel */}
      <div className="relative bg-bg-primary rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fadeIn">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold font-[family-name:var(--font-poppins)] text-text-primary">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Color: hex or pattern */}
          {withHex && (
            <div className="space-y-4">
              {/* Toggle */}
              <div>
                <label className="field-label uppercase tracking-wider text-xs font-semibold mb-2 block">
                  Type de couleur
                </label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setColorMode("hex")}
                    className={`flex-1 py-2 text-sm font-medium transition-colors font-[family-name:var(--font-roboto)] ${
                      colorMode === "hex"
                        ? "bg-text-primary text-bg-primary"
                        : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                    }`}
                  >
                    Couleur unie
                  </button>
                  <button
                    type="button"
                    onClick={() => setColorMode("pattern")}
                    className={`flex-1 py-2 text-sm font-medium transition-colors font-[family-name:var(--font-roboto)] ${
                      colorMode === "pattern"
                        ? "bg-text-primary text-bg-primary"
                        : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                    }`}
                  >
                    Motif / Image
                  </button>
                </div>
              </div>

              {colorMode === "hex" ? (
                <div>
                  <label className="field-label uppercase tracking-wider text-xs font-semibold">
                    Couleur hex
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={hex}
                      onChange={(e) => setHex(e.target.value)}
                      className="h-10 w-16 border border-border rounded-lg p-0.5 cursor-pointer"
                    />
                    <span className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">{hex}</span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="field-label uppercase tracking-wider text-xs font-semibold mb-1 block">
                    Image du motif
                  </label>
                  <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mb-2">
                    PNG, JPG ou WebP · max 500 KB
                  </p>
                  <label
                    className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-text-primary transition-colors overflow-hidden relative"
                  >
                    {patternPreview ? (
                      <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${patternPreview})` }}
                      >
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <span className="text-white text-xs font-medium font-[family-name:var(--font-roboto)]">
                            Changer l&apos;image
                          </span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <svg className="w-8 h-8 text-[#9CA3AF] mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                        </svg>
                        <span className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                          Cliquez pour uploader
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handlePatternFileChange}
                      className="sr-only"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* FR — requis */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="field-label uppercase tracking-wider text-xs font-semibold mb-0">
                Français <span className="text-[#EF4444]">*</span>
              </label>
              <TranslateButton
                text={name}
                onTranslated={(t) => setTranslations((prev) => ({ ...prev, ...t }))}
                disabled={!name.trim()}
              />
            </div>
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
