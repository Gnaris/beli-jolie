"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import {
  createCategoryQuick,
  createSubCategoryQuick,
  createCompositionQuick,
  createColorQuick,
  createTagQuick,
  createManufacturingCountryQuick,
  createSeasonQuick,
} from "@/app/actions/admin/quick-create";
import { VALID_LOCALES, LOCALE_FULL_NAMES } from "@/i18n/locales";
import TranslateButton from "@/components/admin/TranslateButton";
import { useAutoTranslateEnabled } from "@/components/admin/DeeplConfigContext";
import MarketplaceMappingSection, { type MappableEntityType } from "@/components/admin/MarketplaceMappingSection";

export type QuickCreateType = "category" | "subcategory" | "composition" | "color" | "tag" | "country" | "season";

interface QuickCreateModalProps {
  type: QuickCreateType;
  open: boolean;
  onClose: () => void;
  onCreated: (item: { id: string; name: string; hex?: string | null; subCategories?: { id: string; name: string }[] }) => void;
  categoryId?: string;
  defaultName?: string;
  defaultPfsRef?: string;
  defaultPfsCategoryId?: string;
  defaultPfsCategoryGender?: string;
  defaultPfsCategoryFamilyId?: string;
  defaultHex?: string | null;
  pfsEnabled?: boolean;
  /** Edit mode — if set, the modal edits instead of creating */
  editMode?: {
    id: string;
    name: string;
    translations: Record<string, string>;
    hex?: string | null;
    patternImage?: string | null;
    pfsRef?: string | null;
    pfsCategoryId?: string | null;
    pfsCategoryGender?: string | null;
    pfsCategoryFamilyId?: string | null;
    onSave: (
      name: string,
      translations: Record<string, string>,
      hex?: string,
      patternImage?: string | null,
      pfs?: { ref?: string; categoryId?: string; categoryGender?: string | null; categoryFamilyId?: string | null },
    ) => Promise<void>;
  };
}

const TITLES: Record<QuickCreateType, string> = {
  category:    "Créer une catégorie",
  subcategory: "Créer une sous-catégorie",
  composition: "Créer un matériau",
  color:       "Créer une couleur",
  tag:         "Créer un mot-clé",
  country:     "Créer un pays de fabrication",
  season:      "Créer une saison",
};

const EDIT_TITLES: Record<QuickCreateType, string> = {
  category:    "Modifier la catégorie",
  subcategory: "Modifier la sous-catégorie",
  composition: "Modifier le matériau",
  color:       "Modifier la couleur",
  tag:         "Modifier le mot-clé",
  country:     "Modifier le pays de fabrication",
  season:      "Modifier la saison",
};

const PLACEHOLDERS: Record<QuickCreateType, string> = {
  category:    "Ex: Accessoires, Textiles…",
  subcategory: "Ex: T-shirts, Sacs…",
  composition: "Ex: Coton, Polyester…",
  color:       "Ex: Or rose, Argent…",
  tag:         "Ex: tendance, été…",
  country:     "Ex: Chine, Turquie, France…",
  season:      "Ex: Printemps/Été 2026…",
};

const MAPPABLE_TYPES: Set<string> = new Set(["category", "color", "composition", "country", "season"]);
const RTL = ["ar"];

export default function QuickCreateModal({
  type, open, onClose, onCreated, categoryId, defaultName, defaultPfsRef,
  defaultPfsCategoryId, defaultPfsCategoryGender, defaultPfsCategoryFamilyId,
  defaultHex, editMode, pfsEnabled = true,
}: QuickCreateModalProps) {
  const isEdit = !!editMode;
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const [mounted, setMounted] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [hex, setHex] = useState("#9CA3AF");
  const [colorMode, setColorMode] = useState<"hex" | "pattern">("hex");
  const [patternFile, setPatternFile] = useState<File | null>(null);
  const [patternPreview, setPatternPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const backdrop = useBackdropClose(onClose);

  // Marketplace mapping state
  const [pfsRef, setPfsRef] = useState("");
  const [pfsCategoryId, setPfsCategoryId] = useState("");
  const [pfsCategoryGender, setPfsCategoryGender] = useState<string | null>(null);
  const [pfsCategoryFamilyId, setPfsCategoryFamilyId] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open) {
      if (editMode) {
        setNames({ fr: editMode.name, ...editMode.translations });
        setHex(editMode.hex ?? "#9CA3AF");
        setColorMode(editMode.patternImage ? "pattern" : "hex");
        setPatternFile(null);
        setPatternPreview(editMode.patternImage ?? null);
        setError("");
        setPfsRef(editMode.pfsRef ?? "");
        setPfsCategoryId(editMode.pfsCategoryId ?? "");
        setPfsCategoryGender(editMode.pfsCategoryGender ?? null);
        setPfsCategoryFamilyId(editMode.pfsCategoryFamilyId ?? null);
      } else {
        setNames(defaultName ? { fr: defaultName } : {});
        setHex(defaultHex || "#9CA3AF");
        setColorMode("hex");
        setPatternFile(null);
        setPatternPreview(null);
        setError("");
        setPfsRef(defaultPfsRef ?? "");
        setPfsCategoryId(defaultPfsCategoryId ?? "");
        setPfsCategoryGender(defaultPfsCategoryGender ?? null);
        setPfsCategoryFamilyId(defaultPfsCategoryFamilyId ?? null);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function setName(locale: string, value: string) {
    setNames((prev) => ({ ...prev, [locale]: value }));
  }

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

  function handlePfsCategoryChange(catId: string, gender: string | null, familyId: string | null) {
    setPfsCategoryId(catId);
    setPfsCategoryGender(gender);
    setPfsCategoryFamilyId(familyId);
  }

  async function handleSubmit() {
    const frName = names["fr"]?.trim();
    if (!frName) { setError("Le nom en français est requis."); return; }
    setLoading(true);
    setError("");
    try {
      // Edit mode — delegate to onSave callback
      if (editMode) {
        const translations: Record<string, string> = {};
        for (const [locale, val] of Object.entries(names)) {
          if (locale !== "fr" && val?.trim()) translations[locale] = val.trim();
        }
        let finalPatternImage: string | null | undefined = undefined;
        if (type === "color") {
          if (colorMode === "pattern") {
            if (patternFile) {
              const fd = new FormData();
              fd.append("file", patternFile);
              const res = await fetch("/api/admin/colors/upload-pattern", { method: "POST", body: fd });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Erreur upload motif.");
              finalPatternImage = data.path;
            } else {
              finalPatternImage = editMode.patternImage ?? null;
            }
          } else {
            finalPatternImage = null;
          }
        }
        await editMode.onSave(
          frName,
          translations,
          type === "color" && colorMode === "hex" ? hex : undefined,
          finalPatternImage,
          {
            ref: pfsRef || undefined,
            categoryId: pfsCategoryId || undefined,
            categoryGender: pfsCategoryGender,
            categoryFamilyId: pfsCategoryFamilyId,
          },
        );
        onClose();
        return;
      }

      // Create mode — enforce PFS mapping for mappable types (only when PFS is enabled)
      if (pfsEnabled && MAPPABLE_TYPES.has(type)) {
        if (type === "category" && !pfsCategoryId) {
          setError("La correspondance PFS est requise."); setLoading(false); return;
        }
        if (type !== "category" && !pfsRef) {
          setError("La correspondance PFS est requise."); setLoading(false); return;
        }
      }

      let result: { id: string; name: string; hex?: string | null; patternImage?: string | null; subCategories?: { id: string; name: string }[] };
      if (type === "category") {
        result = await createCategoryQuick(names, pfsCategoryId || null, pfsCategoryGender, pfsCategoryFamilyId);
      } else if (type === "subcategory") {
        if (!categoryId) throw new Error("Catégorie parente requise.");
        result = await createSubCategoryQuick(names, categoryId);
      } else if (type === "composition") {
        result = await createCompositionQuick(names, pfsRef || null);
      } else if (type === "tag") {
        result = await createTagQuick(names);
      } else if (type === "country") {
        result = await createManufacturingCountryQuick(names, undefined, pfsRef || null);
      } else if (type === "season") {
        result = await createSeasonQuick(names, pfsRef || null);
      } else {
        let patternPath: string | null = null;
        if (colorMode === "pattern") {
          if (!patternFile) { setError("Veuillez uploader une image motif."); setLoading(false); return; }
          const fd = new FormData();
          fd.append("file", patternFile);
          const res = await fetch("/api/admin/colors/upload-pattern", { method: "POST", body: fd });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Erreur upload motif.");
          patternPath = data.path;
        }
        result = await createColorQuick(names, colorMode === "hex" ? hex : null, colorMode === "pattern" ? patternPath : null, pfsRef || null);
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
  const hasMappableType = pfsEnabled && MAPPABLE_TYPES.has(type);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className={`bg-bg-primary rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] flex flex-col max-h-[90vh] ${hasMappableType ? "w-full max-w-[780px]" : "w-full max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="font-heading text-base font-semibold text-text-primary">
            {isEdit ? EDIT_TITLES[type] : TITLES[type]}
          </h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Body: two columns if mappable ── */}
        <div className={`flex-1 overflow-y-auto ${hasMappableType ? "flex min-h-0" : ""}`}>

          {/* ── LEFT: Création ── */}
          <div className={`p-6 space-y-5 ${hasMappableType ? "flex-1 min-w-0 overflow-y-auto" : ""}`}>

            {/* Traductions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-text-muted font-body uppercase tracking-wide">
                  Nom & traductions
                </p>
                {autoTranslateEnabled && !isEdit ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium font-body text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Traduction auto activée
                  </span>
                ) : (
                  <TranslateButton
                    text={frName}
                    onTranslated={(t) => setNames((prev) => ({ ...prev, ...t }))}
                    disabled={!frName}
                  />
                )}
              </div>

              {/* FR field — prominent */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary font-body mb-1">
                  Français <span className="text-[#EF4444]">*</span>
                </label>
                <input
                  type="text"
                  value={names["fr"] ?? ""}
                  onChange={(e) => setName("fr", e.target.value)}
                  autoFocus
                  placeholder={PLACEHOLDERS[type]}
                  className="field-input w-full"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
                  }}
                />
              </div>

              {/* Other locales — compact grid */}
              <div className="grid grid-cols-2 gap-2.5">
                {VALID_LOCALES.filter((l) => l !== "fr").map((locale) => (
                  <div key={locale}>
                    <label className="block text-[10px] font-semibold text-text-muted font-body mb-0.5 uppercase">
                      {LOCALE_FULL_NAMES[locale]}
                    </label>
                    <input
                      type="text"
                      value={names[locale] ?? ""}
                      onChange={(e) => setName(locale, e.target.value)}
                      dir={RTL.includes(locale) ? "rtl" : "ltr"}
                      className="field-input w-full text-sm"
                      placeholder={LOCALE_FULL_NAMES[locale]}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Color-specific: type toggle + picker */}
            {type === "color" && (
              <div className="space-y-3">
                <p className="text-[11px] text-text-muted font-body uppercase tracking-wide">
                  Apparence
                </p>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setColorMode("hex")}
                    className={`flex-1 py-2 text-sm font-medium transition-colors font-body ${
                      colorMode === "hex" ? "bg-bg-dark text-text-inverse" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                    }`}
                  >
                    Couleur unie
                  </button>
                  <button
                    type="button"
                    onClick={() => setColorMode("pattern")}
                    className={`flex-1 py-2 text-sm font-medium transition-colors font-body ${
                      colorMode === "pattern" ? "bg-bg-dark text-text-inverse" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                    }`}
                  >
                    Motif / Image
                  </button>
                </div>

                {colorMode === "hex" ? (
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={hex}
                      onChange={(e) => setHex(e.target.value)}
                      className="w-10 h-10 rounded-lg border border-border cursor-pointer p-0.5 shrink-0"
                    />
                    <input
                      type="text"
                      value={hex}
                      onChange={(e) => setHex(e.target.value)}
                      placeholder="#9CA3AF"
                      className="field-input w-28 font-mono text-sm"
                    />
                    <div className="flex-1 h-10 rounded-lg border border-border" style={{ backgroundColor: hex }} />
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center h-28 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-bg-dark transition-colors overflow-hidden relative">
                    {patternPreview ? (
                      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${patternPreview})` }}>
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <span className="text-text-inverse text-xs font-medium font-body">Changer</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <svg className="w-7 h-7 text-text-muted mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                        </svg>
                        <span className="text-xs text-text-muted font-body">PNG, JPG, WebP · max 500 KB</span>
                      </>
                    )}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePatternFileChange} className="sr-only" />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* ── Separator + RIGHT: Mapping ── */}
          {hasMappableType && (
            <>
              <div className="w-px bg-border shrink-0" />

              <div className="w-[300px] shrink-0 p-6 overflow-y-auto">
                <p className="text-[11px] text-text-muted font-body uppercase tracking-wide mb-4">
                  Correspondances Marketplaces
                </p>

                {type === "category" ? (
                  <MarketplaceMappingSection
                    entityType="category"
                    pfsCategoryId={pfsCategoryId}
                    onPfsCategoryChange={handlePfsCategoryChange}
                  />
                ) : (
                  <MarketplaceMappingSection
                    entityType={type as "color" | "composition" | "country" | "season"}
                    pfsRef={pfsRef}
                    onPfsRefChange={setPfsRef}
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
          {error ? (
            <p className="text-xs text-[#DC2626] font-body flex-1 mr-4">{error}</p>
          ) : (
            <div />
          )}
          <div className="flex gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border border-border text-text-secondary hover:border-bg-dark hover:text-text-primary text-sm font-medium rounded-lg transition-colors font-body"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !frName}
              className="px-5 py-2 bg-bg-dark hover:bg-black text-text-inverse text-sm font-medium rounded-lg transition-colors disabled:opacity-50 font-body"
            >
              {loading ? (isEdit ? "Enregistrement…" : "Création…") : (isEdit ? "Enregistrer" : "Créer")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
