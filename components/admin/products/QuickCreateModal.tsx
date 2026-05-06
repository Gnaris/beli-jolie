"use client";

import { useState, useEffect, useMemo } from "react";
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
import { fetchPfsColorOptions } from "@/app/actions/admin/colors";
import { fetchPfsMappingOptions, type PfsMappingOptions } from "@/app/actions/admin/pfs-annexes";
import { VALID_LOCALES, LOCALE_FULL_NAMES } from "@/i18n/locales";
import TranslateButton from "@/components/admin/TranslateButton";
import { useAutoTranslateEnabled } from "@/components/admin/DeeplConfigContext";
import MarketplaceMappingSection from "@/components/admin/MarketplaceMappingSection";
import PfsSuggestions, { type PfsCategoryTriple, type PfsRefOption } from "@/components/admin/pfs/PfsSuggestions";
import {
  PFS_COLORS,
  PFS_COMPOSITIONS,
  PFS_COUNTRIES,
  PFS_FAMILIES_BY_GENDER,
  PFS_SUBCATEGORIES_BY_FAMILY,
  PFS_GENDER_LABELS,
} from "@/lib/marketplace-excel/pfs-taxonomy";
import { suggestIso2FromName } from "@/lib/marketplace-excel/country-iso";

export type QuickCreateType = "category" | "subcategory" | "composition" | "color" | "tag" | "country" | "season";

interface QuickCreateModalProps {
  type: QuickCreateType;
  open: boolean;
  onClose: () => void;
  onCreated: (item: { id: string; name: string; hex?: string | null; subCategories?: { id: string; name: string }[] }) => void;
  categoryId?: string;
  defaultName?: string;
  defaultPfsRef?: string;
  defaultPfsGender?: string;
  defaultPfsFamilyName?: string;
  defaultPfsCategoryName?: string;
  /** ID Salesforce PFS de la catégorie — utilisé pour que le re-scan la
   *  reconnaisse comme mappée. Seulement pertinent pour type="category". */
  defaultPfsCategoryId?: string;
  defaultHex?: string | null;
  pfsEnabled?: boolean;
  /** Quand vrai, les champs de correspondance PFS affichent la valeur choisie
   *  en lecture seule — typiquement lors de l'import PFS où la correspondance
   *  est imposée par le produit PFS à importer. */
  lockPfs?: boolean;
  /** Edit mode — if set, the modal edits instead of creating */
  editMode?: {
    id: string;
    name: string;
    translations: Record<string, string>;
    hex?: string | null;
    patternImage?: string | null;
    pfsRef?: string | null;
    pfsGender?: string | null;
    pfsFamilyName?: string | null;
    pfsCategoryName?: string | null;
    isoCode?: string | null;
    onSave: (
      name: string,
      translations: Record<string, string>,
      hex?: string,
      patternImage?: string | null,
      pfs?: { ref?: string; pfsGender?: string | null; pfsFamilyName?: string | null; pfsCategoryName?: string | null; isoCode?: string | null },
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
  defaultPfsGender, defaultPfsFamilyName, defaultPfsCategoryName, defaultPfsCategoryId,
  defaultHex, editMode, pfsEnabled = true, lockPfs = false,
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
  const [pfsRef, setPfsRef] = useState<string | null>(null);
  const [pfsGender, setPfsGender] = useState<string | null>(null);
  const [pfsFamilyName, setPfsFamilyName] = useState<string | null>(null);
  const [pfsCategoryName, setPfsCategoryName] = useState<string | null>(null);

  // ISO2 (country-only): code pays normalisé pour usage marketplace
  const [isoCode, setIsoCode] = useState<string>("");
  const [isoTouched, setIsoTouched] = useState(false);

  // Live PFS colors (referential), fetched once when the modal opens for a color.
  const [pfsColorOptions, setPfsColorOptions] = useState<
    { value: string; label: string; hex: string }[] | null
  >(null);

  // Live PFS annexes (compositions, countries, seasons, families, categories) —
  // fetched once when the modal opens to power the suggestion box and the
  // category cascade with up-to-date data from PFS.
  const [pfsAnnexes, setPfsAnnexes] = useState<PfsMappingOptions | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open || type !== "color" || pfsColorOptions) return;
    let cancelled = false;
    fetchPfsColorOptions()
      .then((rows) => {
        if (cancelled) return;
        setPfsColorOptions(rows.map((r) => ({ value: r.value, label: r.label, hex: r.hex })));
      })
      .catch(() => { /* fall back to static list */ });
    return () => { cancelled = true; };
  }, [open, type, pfsColorOptions]);

  useEffect(() => {
    if (!open || pfsAnnexes) return;
    if (type !== "category" && type !== "composition" && type !== "country" && type !== "season") return;
    let cancelled = false;
    fetchPfsMappingOptions()
      .then((res) => { if (!cancelled) setPfsAnnexes(res); })
      .catch(() => { /* fall back to static lists */ });
    return () => { cancelled = true; };
  }, [open, type, pfsAnnexes]);

  // Flatten the category taxonomy for suggestion matching. Prefer live PFS
  // data when available; fall back to the static taxonomy otherwise.
  const pfsCategoryTriples = useMemo<PfsCategoryTriple[]>(() => {
    if (pfsAnnexes && pfsAnnexes.categories.length > 0) {
      return pfsAnnexes.categories.map((c) => ({
        gender: PFS_GENDER_LABELS[c.gender] ?? c.gender,
        family: c.family,
        category: c.category,
      }));
    }
    const out: PfsCategoryTriple[] = [];
    for (const [gender, families] of Object.entries(PFS_FAMILIES_BY_GENDER)) {
      for (const family of families) {
        const cats = PFS_SUBCATEGORIES_BY_FAMILY[family] ?? [];
        for (const category of cats) {
          out.push({ gender, family, category });
        }
      }
    }
    return out;
  }, [pfsAnnexes]);

  function applyCategoryTriple(t: PfsCategoryTriple) {
    // Reverse the FR gender label → stored code (WOMAN/MAN/KID/SUPPLIES)
    const codeEntry = Object.entries(PFS_GENDER_LABELS).find(([, label]) => label === t.gender);
    const genderCode = codeEntry ? codeEntry[0] : null;
    setPfsGender(genderCode);
    setPfsFamilyName(t.family);
    setPfsCategoryName(t.category);
  }

  const currentCategoryTriple = useMemo<PfsCategoryTriple | null>(() => {
    if (type !== "category" || !pfsGender || !pfsFamilyName || !pfsCategoryName) return null;
    const genderLabel = PFS_GENDER_LABELS[pfsGender];
    if (!genderLabel) return null;
    return { gender: genderLabel, family: pfsFamilyName, category: pfsCategoryName };
  }, [type, pfsGender, pfsFamilyName, pfsCategoryName]);

  const suggestionOptions = useMemo<PfsRefOption[]>(() => {
    switch (type) {
      case "color":
        return pfsColorOptions
          ? pfsColorOptions.map((o) => ({ value: o.value, label: o.label }))
          : PFS_COLORS;
      case "composition":
        return pfsAnnexes && pfsAnnexes.compositions.length > 0
          ? pfsAnnexes.compositions
          : PFS_COMPOSITIONS;
      case "country":
        return pfsAnnexes && pfsAnnexes.countries.length > 0
          ? pfsAnnexes.countries
          : PFS_COUNTRIES;
      case "season":
        return pfsAnnexes ? pfsAnnexes.seasons : [];
      default: return [];
    }
  }, [type, pfsColorOptions, pfsAnnexes]);

  /** Apply a suggested PFS ref — also auto-fills the hex picker for colors. */
  function applySuggestedRef(ref: string) {
    setPfsRef(ref);
    if (type === "color" && colorMode === "hex") {
      const match = pfsColorOptions?.find((o) => o.value === ref);
      if (match?.hex) setHex(match.hex);
    }
    if (type === "country") {
      // PFS_COUNTRIES values are canonical French country names — pre-fill
      // the FR name, and fill the ISO2 code in the same click when it can
      // be resolved (empty otherwise, so a stale ISO from a previous name
      // does not linger).
      setNames((prev) => ({ ...prev, fr: ref }));
      setIsoCode(suggestIso2FromName(ref) ?? "");
      setIsoTouched(false);
    }
  }

  useEffect(() => {
    if (open) {
      if (editMode) {
        setNames({ fr: editMode.name, ...editMode.translations });
        setHex(editMode.hex ?? "#9CA3AF");
        setColorMode(editMode.patternImage ? "pattern" : "hex");
        setPatternFile(null);
        setPatternPreview(editMode.patternImage ?? null);
        setError("");
        setPfsRef(editMode.pfsRef ?? null);
        setPfsGender(editMode.pfsGender ?? null);
        setPfsFamilyName(editMode.pfsFamilyName ?? null);
        setPfsCategoryName(editMode.pfsCategoryName ?? null);
        setIsoCode(editMode.isoCode ?? "");
        setIsoTouched(!!editMode.isoCode);
      } else {
        setNames(defaultName ? { fr: defaultName } : {});
        setHex(defaultHex || "#9CA3AF");
        setColorMode("hex");
        setPatternFile(null);
        setPatternPreview(null);
        setError("");
        setPfsRef(defaultPfsRef ?? null);
        setPfsGender(defaultPfsGender ?? null);
        setPfsFamilyName(defaultPfsFamilyName ?? null);
        setPfsCategoryName(defaultPfsCategoryName ?? null);
        setIsoCode("");
        setIsoTouched(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-suggest ISO2 from FR name when the user hasn't typed it manually.
  useEffect(() => {
    if (type !== "country") return;
    if (isoTouched) return;
    const suggestion = suggestIso2FromName(names["fr"]);
    if (suggestion && suggestion !== isoCode) setIsoCode(suggestion);
  }, [type, names, isoTouched, isoCode]);

  /**
   * Import PFS : quand la couleur est verrouillée par l'import, on auto-remplit
   * l'aperçu hex à partir de la couleur PFS correspondante une fois que la
   * liste des couleurs live est chargée. Sinon l'admin voit juste le gris par
   * défaut et croit que la couleur n'a pas été reprise.
   */
  useEffect(() => {
    if (!open || type !== "color" || !lockPfs || !pfsRef) return;
    if (!pfsColorOptions || colorMode !== "hex") return;
    const match = pfsColorOptions.find((o) => o.value === pfsRef);
    if (match?.hex && hex === "#9CA3AF") setHex(match.hex);
  }, [open, type, lockPfs, pfsRef, pfsColorOptions, colorMode, hex]);

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

  // No longer needed — gender & family are set directly via MarketplaceMappingSection callbacks

  async function handleSubmit() {
    const frName = names["fr"]?.trim();
    if (!frName) { setError("Le nom en français est requis."); return; }
    const normalizedIso = isoCode.trim().toUpperCase();
    if (type === "country") {
      if (!normalizedIso) {
        setError("Le code ISO du pays (2 lettres) est obligatoire.");
        return;
      }
      if (!/^[A-Z]{2}$/.test(normalizedIso)) {
        setError("Le code ISO doit être composé de 2 lettres (ex: FR, CN, TR).");
        return;
      }
    }
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
            pfsGender,
            pfsFamilyName,
            pfsCategoryName,
            isoCode: type === "country" ? normalizedIso : undefined,
          },
        );
        onClose();
        return;
      }

      // Create mode — enforce PFS mapping for all mappable types (only when PFS is enabled)
      if (pfsEnabled && MAPPABLE_TYPES.has(type)) {
        if (type === "category") {
          if (!pfsGender || !pfsFamilyName) {
            setError("Le genre et la famille Paris Fashion Shop sont obligatoires.");
            setLoading(false);
            return;
          }
        } else if (!pfsRef) {
          setError("La correspondance Paris Fashion Shop est obligatoire.");
          setLoading(false);
          return;
        }
      }

      let result: { id: string; name: string; hex?: string | null; patternImage?: string | null; subCategories?: { id: string; name: string }[] };
      if (type === "category") {
        result = await createCategoryQuick(names, pfsGender, pfsFamilyName, pfsCategoryName, defaultPfsCategoryId ?? null);
      } else if (type === "subcategory") {
        if (!categoryId) throw new Error("Catégorie parente requise.");
        result = await createSubCategoryQuick(names, categoryId);
      } else if (type === "composition") {
        result = await createCompositionQuick(names, pfsRef || null);
      } else if (type === "tag") {
        result = await createTagQuick(names);
      } else if (type === "country") {
        result = await createManufacturingCountryQuick(names, normalizedIso, pfsRef || null);
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
  const normalizedIsoPreview = isoCode.trim().toUpperCase();
  const isoInvalid = type === "country" && !!normalizedIsoPreview && !/^[A-Z]{2}$/.test(normalizedIsoPreview);
  const isoMissing = type === "country" && !normalizedIsoPreview;
  const mappingMissing = (!isEdit && hasMappableType && (
    type === "category"
      ? (!pfsGender || !pfsFamilyName)
      : !pfsRef
  )) || isoMissing || isoInvalid;
  const suggestedIsoForName = type === "country" ? suggestIso2FromName(frName) : null;

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
                  {lockPfs ? "Correspondance Paris Fashion Shop" : "Correspondances Marketplaces"}
                </p>

                {lockPfs ? (
                  <LockedPfsMapping
                    type={type}
                    pfsRef={pfsRef}
                    pfsGender={pfsGender}
                    pfsFamilyName={pfsFamilyName}
                    pfsCategoryName={pfsCategoryName}
                  />
                ) : type === "category" ? (
                  <MarketplaceMappingSection
                    entityType="category"
                    pfsGender={pfsGender}
                    pfsFamilyName={pfsFamilyName}
                    pfsCategoryName={pfsCategoryName}
                    onPfsGenderChange={setPfsGender}
                    onPfsFamilyNameChange={setPfsFamilyName}
                    onPfsCategoryNameChange={setPfsCategoryName}
                  />
                ) : (
                  <MarketplaceMappingSection
                    entityType={type as "color" | "composition" | "country" | "season"}
                    pfsRef={pfsRef}
                    onPfsRefChange={setPfsRef}
                  />
                )}

                {type === "country" && (
                  <div className="mt-5 pt-5 border-t border-border space-y-2">
                    <label className="block text-xs font-medium text-text-secondary font-body">
                      Code pays (ISO 2 lettres) <span className="text-[#EF4444]">*</span>
                    </label>
                    <input
                      type="text"
                      value={isoCode}
                      onChange={(e) => {
                        setIsoTouched(true);
                        setIsoCode(e.target.value.toUpperCase().slice(0, 2));
                      }}
                      placeholder="Ex: FR, CN, TR"
                      maxLength={2}
                      className="field-input w-full font-mono uppercase tracking-widest text-center text-sm"
                    />
                    {isoInvalid && (
                      <p className="text-[11px] text-[#EF4444] font-body">Le code doit faire exactement 2 lettres.</p>
                    )}
                    {!isoTouched && suggestedIsoForName && isoCode === suggestedIsoForName && (
                      <p className="text-[11px] text-emerald-600 font-body">
                        Code détecté automatiquement d'après le nom.
                      </p>
                    )}
                    {isoTouched && suggestedIsoForName && suggestedIsoForName !== normalizedIsoPreview && (
                      <button
                        type="button"
                        onClick={() => { setIsoCode(suggestedIsoForName); }}
                        className="text-[11px] text-text-muted hover:text-text-primary underline font-body"
                      >
                        Utiliser la suggestion « {suggestedIsoForName} »
                      </button>
                    )}
                    <p className="text-[11px] text-text-muted font-body">
                      Code ISO 2 lettres du pays de fabrication.
                    </p>
                  </div>
                )}

                {/* PFS suggestions — cachées quand la correspondance est verrouillée. */}
                {!lockPfs && type !== "category" && suggestionOptions.length > 0 && (
                  <div className="mt-4">
                    <PfsSuggestions
                      mode="ref"
                      query={names["fr"] ?? ""}
                      options={suggestionOptions}
                      currentValue={pfsRef}
                      onPick={applySuggestedRef}
                      label="Correspondance détectée d'après le nom"
                    />
                  </div>
                )}
                {!lockPfs && type === "category" && (
                  <div className="mt-4">
                    <PfsSuggestions
                      mode="category"
                      query={names["fr"] ?? ""}
                      triples={pfsCategoryTriples}
                      currentValue={currentCategoryTriple}
                      onPickCategory={applyCategoryTriple}
                      label="Cascade détectée d'après le nom"
                    />
                  </div>
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
              disabled={loading || !frName || mappingMissing}
              title={
                isoMissing
                  ? "Le code ISO du pays est obligatoire."
                  : isoInvalid
                    ? "Le code ISO doit faire 2 lettres."
                    : mappingMissing
                      ? "Complétez la correspondance Paris Fashion Shop."
                      : undefined
              }
              className="px-5 py-2 bg-bg-dark hover:bg-black text-text-inverse text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-body"
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

/**
 * Affichage en lecture seule de la correspondance PFS déjà déterminée par
 * l'import — l'admin voit clairement ce qui sera enregistré sans pouvoir le
 * modifier. Le petit pictogramme cadenas renforce le message.
 */
function LockedPfsMapping({
  type,
  pfsRef,
  pfsGender,
  pfsFamilyName,
  pfsCategoryName,
}: {
  type: QuickCreateType;
  pfsRef: string | null;
  pfsGender: string | null;
  pfsFamilyName: string | null;
  pfsCategoryName: string | null;
}) {
  const rows: { label: string; value: string | null }[] = [];
  if (type === "category") {
    rows.push({ label: "Genre PFS", value: pfsGender ? (PFS_GENDER_LABELS[pfsGender] ?? pfsGender) : null });
    rows.push({ label: "Famille PFS", value: pfsFamilyName ? pfsFamilyName.replace(/_/g, " ") : null });
    rows.push({ label: "Catégorie PFS", value: pfsCategoryName });
  } else {
    const label =
      type === "color" ? "Couleur PFS" :
      type === "composition" ? "Matière PFS" :
      type === "country" ? "Pays PFS" :
      type === "season" ? "Saison PFS" : "Référence PFS";
    rows.push({ label, value: pfsRef });
  }
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <label className="block text-xs font-medium text-text-secondary mb-1.5 font-body">
            {r.label}
          </label>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-muted border border-border text-sm font-body text-text-primary">
            <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="truncate">{r.value ?? "—"}</span>
          </div>
        </div>
      ))}
      <p className="text-[11px] text-text-muted font-body leading-snug pt-1">
        Valeur reprise du produit Paris Fashion Shop — non modifiable depuis cet écran.
      </p>
    </div>
  );
}
