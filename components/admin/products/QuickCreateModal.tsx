"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
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
import { updateCategoryFaireTaxonomy } from "@/app/actions/admin/categories";
import { useToast } from "@/components/ui/Toast";
import { fetchPfsColorOptions } from "@/app/actions/admin/colors";
import { fetchPfsMappingOptions, type PfsMappingOptions } from "@/app/actions/admin/pfs-annexes";
import { VALID_LOCALES, LOCALE_FULL_NAMES } from "@/i18n/locales";
import TranslateButton from "@/components/admin/TranslateButton";
import { useAutoTranslateEnabled } from "@/components/admin/DeeplConfigContext";
import MarketplaceMappingSection from "@/components/admin/MarketplaceMappingSection";
import EfashionMappingPicker, { type EmbeddedPickerKind } from "@/components/admin/EfashionMappingPicker";
import FaireTaxonomySelect from "@/components/admin/FaireTaxonomySelect";
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
import { alpha2ToAlpha3 } from "@/lib/faire-country";

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
  /** Scroll smoothly to the given marketplace card when the modal opens
   *  (uniquement pour type="category"). Utilisé par la liste catégories pour
   *  ouvrir la modale directement sur la carte concernée. */
  focusMarketplace?: "pfs" | "efashion" | "faire";
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
    /** ID eFashion actuellement lié (Int ou null). Active la section eFashion dans la sidebar. */
    efashionCurrentId?: number | null;
    /** taxonomy_type.id Faire actuellement lié — uniquement pour type="category". */
    faireCurrentTaxonomyId?: string | null;
    /** Code pays Faire (alpha-3, ex "CHN") — uniquement pour type="country". */
    faireCurrentCountryCode?: string | null;
    /**
     * Callback déclenché juste après l'auto-save du `faireTaxonomyId` côté serveur
     * (uniquement pour type="category"). Permet au parent (liste catégories) de
     * mettre à jour l'affichage du badge sans dépendre de router.refresh().
     */
    onFaireTaxonomySaved?: (next: string | null, nextLabel: string | null) => void;
    onSave: (
      name: string,
      translations: Record<string, string>,
      hex?: string,
      patternImage?: string | null,
      pfs?: { ref?: string; pfsGender?: string | null; pfsFamilyName?: string | null; pfsCategoryName?: string | null; isoCode?: string | null },
      faire?: { taxonomyId?: string | null; countryCode?: string | null },
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

const SUBTITLES: Record<QuickCreateType, string> = {
  category:    "Le nom, ses traductions et la correspondance avec les marketplaces.",
  subcategory: "Le nom et ses traductions dans les langues du site.",
  composition: "Le matériau, ses traductions et la correspondance marketplaces.",
  color:       "L'apparence visuelle, les traductions et la correspondance marketplaces.",
  tag:         "Un mot-clé réutilisable sur vos produits.",
  country:     "Le pays, son code ISO et la correspondance marketplaces.",
  season:      "La saison/collection et la correspondance marketplaces.",
};

/** Icône stylisée affichée dans l'en-tête, propre à chaque type d'entité. */
function TypeIcon({ type }: { type: QuickCreateType }) {
  const path = (() => {
    switch (type) {
      case "category":
      case "subcategory":
        return "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z";
      case "color":
        return "M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z";
      case "composition":
        return "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z";
      case "country":
        return "M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418";
      case "season":
        return "M3 11.25a6.75 6.75 0 0113.5 0v3.86c.6 1.85 1.5 3.6 1.5 4.39 0 1.105-.895 2-2 2H4c-1.105 0-2-.895-2-2 0-.79.9-2.54 1.5-4.39v-3.86z";
      case "tag":
      default:
        return "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z";
    }
  })();

  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

const MAPPABLE_TYPES: Set<string> = new Set(["category", "color", "composition", "country", "season"]);
const RTL: string[] = [];

export default function QuickCreateModal({
  type, open, onClose, onCreated, categoryId, defaultName, defaultPfsRef,
  defaultPfsGender, defaultPfsFamilyName, defaultPfsCategoryName, defaultPfsCategoryId,
  defaultHex, editMode, pfsEnabled = true, lockPfs = false, focusMarketplace,
}: QuickCreateModalProps) {
  const isEdit = !!editMode;
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const router = useRouter();
  const toast = useToast();
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
  const [faireTaxonomyId, setFaireTaxonomyId] = useState<string | null>(null);
  const [faireCountryCode, setFaireCountryCode] = useState<string>("");
  // eFashion mapping state (utilisé uniquement en mode création — en édition,
  // le picker auto-save directement via les server actions update).
  const [efashionCreateId, setEfashionCreateId] = useState<number | null>(null);

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

  // Scroll en douceur vers la carte marketplace ciblée à l'ouverture de la
  // modale (utilisé par la liste catégories pour ouvrir directement sur la
  // bonne carte). Uniquement pertinent pour type="category".
  useEffect(() => {
    if (open && focusMarketplace && type === "category") {
      const timer = setTimeout(() => {
        document
          .querySelector<HTMLElement>(`[data-marketplace-card="${focusMarketplace}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open, focusMarketplace, type]);

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
        setFaireTaxonomyId(editMode.faireCurrentTaxonomyId ?? null);
        setFaireCountryCode(editMode.faireCurrentCountryCode ?? "");
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
          type === "category"
            ? { taxonomyId: faireTaxonomyId }
            : type === "country"
              ? { countryCode: faireCountryCode.trim().toUpperCase() || null }
              : undefined,
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
        result = await createCategoryQuick(names, pfsGender, pfsFamilyName, pfsCategoryName, defaultPfsCategoryId ?? null, efashionCreateId);
      } else if (type === "subcategory") {
        if (!categoryId) throw new Error("Catégorie parente requise.");
        result = await createSubCategoryQuick(names, categoryId);
      } else if (type === "composition") {
        result = await createCompositionQuick(names, pfsRef || null, efashionCreateId);
      } else if (type === "tag") {
        result = await createTagQuick(names);
      } else if (type === "country") {
        result = await createManufacturingCountryQuick(names, normalizedIso, pfsRef || null, efashionCreateId);
      } else if (type === "season") {
        result = await createSeasonQuick(names, pfsRef || null, efashionCreateId);
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
        const colorRes = await createColorQuick(names, colorMode === "hex" ? hex : null, colorMode === "pattern" ? patternPath : null, pfsRef || null, efashionCreateId);
        if (!colorRes.ok) {
          setError(colorRes.error);
          setLoading(false);
          return;
        }
        result = { id: colorRes.id, name: colorRes.name, hex: colorRes.hex, patternImage: colorRes.patternImage };
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
  // Suggère un code alpha-3 Faire à partir de l'ISO 2-lettres saisi (priorité)
  // puis à partir du nom (fallback). Null si aucun match dans la table embarquée.
  const faireSuggestionFromIso =
    type === "country"
      ? alpha2ToAlpha3(normalizedIsoPreview || suggestedIsoForName)
      : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className={`bg-bg-primary rounded-2xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)] flex flex-col max-h-[92vh] overflow-hidden ${
          hasMappableType
            ? (type === "category" || type === "country" || type === "composition"
                ? "w-full max-w-[1500px]"
                : "w-full max-w-[1240px]")
            : "w-full max-w-xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="relative px-7 py-5 border-b border-border shrink-0 bg-gradient-to-br from-bg-primary to-bg-secondary/30">
          <div className="flex items-start gap-4">
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-bg-dark text-text-inverse shrink-0 shadow-sm">
              <TypeIcon type={type} />
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="font-heading text-lg font-semibold text-text-primary leading-tight">
                {isEdit ? EDIT_TITLES[type] : TITLES[type]}
              </h3>
              <p className="text-xs text-text-muted font-body mt-1 leading-relaxed">
                {SUBTITLES[type]}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 -mt-1 -mr-2 inline-flex items-center justify-center w-9 h-9 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
              title="Fermer"
              aria-label="Fermer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Body: two columns if mappable ── */}
        <div className={`flex-1 overflow-y-auto ${hasMappableType ? "flex min-h-0" : ""}`}>

          {/* ── LEFT: Création ── */}
          <div className={`p-7 space-y-6 ${hasMappableType ? "flex-1 min-w-0 overflow-y-auto" : ""}`}>

            {/* ── Carte « Identité » ── */}
            <section className="rounded-2xl border border-border bg-bg-primary shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
              <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border bg-bg-secondary/40">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-bg-dark text-text-inverse text-[11px] font-bold font-body">1</span>
                  <div>
                    <p className="text-sm font-semibold text-text-primary font-heading leading-none">Identité</p>
                    <p className="text-[11px] text-text-muted font-body mt-1">Nom en français et traductions.</p>
                  </div>
                </div>
                {autoTranslateEnabled && !isEdit ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium font-body text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Traduction auto
                  </span>
                ) : (
                  <TranslateButton
                    text={frName}
                    onTranslated={(t) => setNames((prev) => ({ ...prev, ...t }))}
                    disabled={!frName}
                  />
                )}
              </header>

              <div className="p-5 space-y-4">
                {/* FR field — prominent */}
                <div>
                  <label className="block text-xs font-semibold text-text-secondary font-body mb-1.5">
                    Français <span className="text-[#EF4444]">*</span>
                  </label>
                  <input
                    type="text"
                    value={names["fr"] ?? ""}
                    onChange={(e) => setName("fr", e.target.value)}
                    autoFocus
                    placeholder={PLACEHOLDERS[type]}
                    className="field-input w-full text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
                    }}
                  />
                </div>

                {/* Other locales — compact grid */}
                <div>
                  <p className="text-[10px] font-semibold text-text-muted font-body uppercase tracking-wider mb-2">
                    Autres langues
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
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
              </div>
            </section>

            {/* ── Carte « Apparence » (couleur uniquement) ── */}
            {type === "color" && (
              <section className="rounded-2xl border border-border bg-bg-primary shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
                <header className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-bg-secondary/40">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-bg-dark text-text-inverse text-[11px] font-bold font-body">2</span>
                  <div>
                    <p className="text-sm font-semibold text-text-primary font-heading leading-none">Apparence</p>
                    <p className="text-[11px] text-text-muted font-body mt-1">Couleur unie ou motif personnalisé.</p>
                  </div>
                </header>

                <div className="p-5 space-y-4">
                  <div className="inline-flex rounded-lg border border-border overflow-hidden p-0.5 bg-bg-secondary/40">
                    <button
                      type="button"
                      onClick={() => setColorMode("hex")}
                      className={`px-4 py-1.5 text-xs font-medium font-body rounded-md transition-colors ${
                        colorMode === "hex" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      Couleur unie
                    </button>
                    <button
                      type="button"
                      onClick={() => setColorMode("pattern")}
                      className={`px-4 py-1.5 text-xs font-medium font-body rounded-md transition-colors ${
                        colorMode === "pattern" ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      Motif / Image
                    </button>
                  </div>

                  {colorMode === "hex" ? (
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <input
                          type="color"
                          value={hex}
                          onChange={(e) => setHex(e.target.value)}
                          className="w-12 h-12 rounded-xl border border-border cursor-pointer p-0.5 shrink-0"
                        />
                      </div>
                      <input
                        type="text"
                        value={hex}
                        onChange={(e) => setHex(e.target.value)}
                        placeholder="#9CA3AF"
                        className="field-input w-32 font-mono text-sm uppercase"
                      />
                      <div className="flex-1 h-12 rounded-xl border border-border shadow-inner" style={{ backgroundColor: hex }} />
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-text-secondary transition-colors overflow-hidden relative bg-bg-secondary/30">
                      {patternPreview ? (
                        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${patternPreview})` }}>
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                            <span className="text-text-inverse text-xs font-medium font-body">Changer l'image</span>
                          </div>
                        </div>
                      ) : (
                        <>
                          <svg className="w-7 h-7 text-text-muted mb-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                          </svg>
                          <span className="text-xs font-medium text-text-secondary font-body">Glissez une image ou cliquez ici</span>
                          <span className="text-[11px] text-text-muted font-body mt-0.5">PNG, JPG, WebP · max 500 KB</span>
                        </>
                      )}
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePatternFileChange} className="sr-only" />
                    </label>
                  )}
                </div>
              </section>
            )}
          </div>

          {/* ── Separator + RIGHT: Mapping ── */}
          {hasMappableType && (
            <>
              <div className="w-px bg-border shrink-0" />

              <aside className={`${
                type === "category" || type === "country" || type === "composition"
                  ? "w-[940px]"
                  : "w-[640px]"
              } shrink-0 p-7 overflow-y-auto bg-bg-secondary/30 space-y-5`}>
                <header>
                  <p className="text-[10px] uppercase tracking-wider font-body font-semibold text-text-muted">
                    Étape {type === "color" ? 3 : 2}
                  </p>
                  <h4 className="font-heading text-sm font-semibold text-text-primary mt-0.5">
                    {lockPfs ? "Correspondance Paris Fashion Shop" : "Correspondances marketplaces"}
                  </h4>
                  <p className="text-[11px] text-text-muted font-body mt-1 leading-relaxed">
                    {lockPfs
                      ? "Valeur reprise du produit Paris Fashion Shop importé."
                      : "Reliez cet élément aux marketplaces pour pouvoir le publier."}
                  </p>
                </header>

                {/* ── Marketplaces : grille horizontale (selon type) ──
                    - category, composition : 3 cartes côte à côte
                    - country                : 2x2 (PFS+eFashion / ISO+Faire)
                    - color, season          : 2 cartes côte à côte */}
                <div className={`grid grid-cols-1 gap-4 items-stretch ${
                  type === "category" || type === "composition"
                    ? "lg:grid-cols-3"
                    : "lg:grid-cols-2"
                }`}>

                {/* ── Carte PFS ───────────────────────────────────────── */}
                <section
                  data-marketplace-card="pfs"
                  className="relative rounded-2xl border border-border bg-bg-primary shadow-[var(--shadow-sm)] overflow-hidden h-full flex flex-col"
                >
                  <span
                    aria-hidden
                    className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-slate-300 to-slate-500"
                  />
                  <header className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-secondary">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-ink/8 text-text-primary">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2L3 6v7l7 4 7-4V6l-7-4zm0 2.18L15.82 7 10 10.18 4.18 7 10 4.18zM4 9l5 2.86v5L4 14V9zm12 0v5l-5 2.86v-5L16 9z" />
                      </svg>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-text-primary font-heading leading-none">Paris Fashion Shop</p>
                      <p className="text-[10px] text-text-muted font-body mt-1">Marketplace officielle PFS</p>
                    </div>
                  </header>
                  <div className="p-4 flex-1">
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

                    {/* PFS suggestions */}
                    {!lockPfs && type !== "category" && suggestionOptions.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <PfsSuggestions
                          mode="ref"
                          query={names["fr"] ?? ""}
                          options={suggestionOptions}
                          currentValue={pfsRef}
                          onPick={applySuggestedRef}
                          label="Correspondance PFS suggérée"
                        />
                      </div>
                    )}
                    {!lockPfs && type === "category" && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <PfsSuggestions
                          mode="category"
                          query={names["fr"] ?? ""}
                          triples={pfsCategoryTriples}
                          currentValue={currentCategoryTriple}
                          onPickCategory={applyCategoryTriple}
                          label="Correspondance PFS suggérée"
                        />
                      </div>
                    )}
                  </div>
                </section>

                {/* ── Carte eFashion ──────────────────────────────────── */}
                {(type === "category" || type === "country" || type === "season" || type === "composition" || type === "color") && !lockPfs && (
                  <section
                    data-marketplace-card="efashion"
                    className="relative rounded-2xl border border-border bg-bg-primary shadow-[var(--shadow-sm)] overflow-hidden h-full flex flex-col"
                  >
                    <span
                      aria-hidden
                      className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-slate-300 to-slate-500"
                    />
                    <header className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-secondary">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-ink/8 text-text-primary">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm3.7 6.3l-4.5 4.5a1 1 0 01-1.4 0L6 11a1 1 0 011.4-1.4l1.8 1.8 3.8-3.8a1 1 0 011.4 1.4z" />
                        </svg>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-text-primary font-heading leading-none">eFashion Paris</p>
                        <p className="text-[10px] text-text-muted font-body mt-1">{isEdit ? "Enregistré automatiquement" : "Optionnel — peut être complété plus tard"}</p>
                      </div>
                    </header>
                    <div className="p-4 flex-1">
                      {isEdit && editMode ? (
                        <EfashionMappingPicker
                          entityId={editMode.id}
                          kind={type as EmbeddedPickerKind}
                          initialValue={editMode.efashionCurrentId ?? null}
                          entityName={names["fr"] ?? editMode.name}
                        />
                      ) : (
                        <EfashionMappingPicker
                          kind={type as EmbeddedPickerKind}
                          initialValue={efashionCreateId}
                          entityName={names["fr"]}
                          onChange={setEfashionCreateId}
                        />
                      )}
                    </div>
                  </section>
                )}

                {/* Carte Faire (matériau) supprimée : Faire n'expose pas de
                    champ structuré pour la composition. L'info part désormais
                    automatiquement dans la description du produit, construite
                    par lib/faire-description.ts. */}

                {/* ── Carte Faire (catégorie uniquement) ──────────────── */}
                {type === "category" && !lockPfs && (
                  <section
                    data-marketplace-card="faire"
                    className="relative rounded-2xl border border-border bg-bg-primary shadow-[var(--shadow-sm)] overflow-hidden h-full flex flex-col"
                  >
                    <span
                      aria-hidden
                      className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-slate-300 to-slate-500"
                    />
                    <header className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-secondary">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-ink/8 text-text-primary">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM6 8a2 2 0 114 0 2 2 0 01-4 0zm6 0a2 2 0 114 0 2 2 0 01-4 0zM6.5 13a3.5 3.5 0 007 0H6.5z" />
                        </svg>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-text-primary font-heading leading-none">Faire</p>
                        <p className="text-[10px] text-text-muted font-body mt-1">{isEdit ? "Enregistré automatiquement" : "Optionnel — peut être complété plus tard"}</p>
                      </div>
                    </header>
                    <div className="p-4 flex-1">
                      <FaireTaxonomySelect
                        label="Type de produit Faire"
                        value={faireTaxonomyId}
                        helpText="Recherchez par nom (« bracelet », « bague »…). Le breadcrumb aide à distinguer les doublons."
                        suggestionQuery={names["fr"] ?? ""}
                        onSave={async (next, nextLabel) => {
                          // En édition : on persiste tout de suite côté serveur
                          // pour aligner le comportement sur eFashion (la carte
                          // affiche déjà "Enregistré automatiquement"). En création,
                          // on garde uniquement le state local — la valeur sera
                          // posée lors de la création de la catégorie.
                          if (editMode) {
                            try {
                              await updateCategoryFaireTaxonomy(editMode.id, next);
                              editMode.onFaireTaxonomySaved?.(next, nextLabel);
                              router.refresh();
                              toast.success(next ? "Catégorie Faire liée" : "Lien Faire retiré");
                            } catch (err) {
                              const message = err instanceof Error ? err.message : "Erreur d'enregistrement.";
                              toast.error("Faire", message);
                              throw err;
                            }
                          }
                          setFaireTaxonomyId(next);
                        }}
                      />
                    </div>
                  </section>
                )}

                {/* ── Carte ISO (pays uniquement — désormais dans la grille) ──── */}
                {type === "country" && (
                  <section className="rounded-2xl border border-border bg-bg-primary shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden h-full flex flex-col">
                    <header className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-gradient-to-r from-purple-50/70 to-transparent">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-purple-100 text-purple-700">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                        </svg>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-text-primary font-heading leading-none">Code ISO</p>
                        <p className="text-[10px] text-text-muted font-body mt-1">Code 2 lettres du pays</p>
                      </div>
                      <span className="text-[#EF4444] text-xs font-body">obligatoire</span>
                    </header>
                    <div className="p-4 space-y-2 flex-1">
                      <input
                        type="text"
                        value={isoCode}
                        onChange={(e) => {
                          setIsoTouched(true);
                          setIsoCode(e.target.value.toUpperCase().slice(0, 2));
                        }}
                        placeholder="FR"
                        maxLength={2}
                        className="field-input w-full font-mono uppercase tracking-[0.5em] text-center text-base font-semibold"
                      />
                      {isoInvalid && (
                        <p className="text-[11px] text-[#EF4444] font-body">Le code doit faire exactement 2 lettres.</p>
                      )}
                      {!isoTouched && suggestedIsoForName && isoCode === suggestedIsoForName && (
                        <p className="text-[11px] text-emerald-600 font-body flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Détecté automatiquement
                        </p>
                      )}
                      {isoTouched && suggestedIsoForName && suggestedIsoForName !== normalizedIsoPreview && (
                        <button
                          type="button"
                          onClick={() => { setIsoCode(suggestedIsoForName); }}
                          className="text-[11px] text-text-muted hover:text-text-primary underline font-body"
                        >
                          Utiliser « {suggestedIsoForName} »
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {/* ── Carte Faire (pays — code alpha-3) ────────────────────── */}
                {type === "country" && !lockPfs && (
                  <section className="rounded-2xl border border-border bg-bg-primary shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden h-full flex flex-col">
                    <header className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-gradient-to-r from-purple-50/70 to-transparent">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-purple-100 text-purple-700">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM6 8a2 2 0 114 0 2 2 0 01-4 0zm6 0a2 2 0 114 0 2 2 0 01-4 0zM6.5 13a3.5 3.5 0 007 0H6.5z" />
                        </svg>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-text-primary font-heading leading-none">Faire</p>
                        <p className="text-[10px] text-text-muted font-body mt-1">Code à 3 lettres (ex : CHN, FRA, PRT)</p>
                      </div>
                    </header>
                    <div className="p-4 flex-1 space-y-2">
                      <p className="font-body text-[10px] uppercase tracking-wider text-text-muted">Code pays Faire</p>
                      <input
                        type="text"
                        value={faireCountryCode}
                        onChange={(e) => setFaireCountryCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
                        placeholder={faireSuggestionFromIso || "CHN"}
                        maxLength={3}
                        className="w-full h-9 px-3 rounded-md border border-border bg-bg-primary text-text-primary text-sm font-body font-mono uppercase tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                      />
                      {faireCountryCode.length > 0 && faireCountryCode.length < 3 && (
                        <p className="text-[11px] text-[#EF4444] font-body">Le code doit faire exactement 3 lettres.</p>
                      )}
                      {!faireCountryCode && faireSuggestionFromIso && (
                        <button
                          type="button"
                          onClick={() => setFaireCountryCode(faireSuggestionFromIso)}
                          className="text-[11px] text-text-muted hover:text-text-primary underline font-body"
                        >
                          Utiliser « {faireSuggestionFromIso} » (détecté d'après le code ISO)
                        </button>
                      )}
                    </div>
                  </section>
                )}

                </div>
              </aside>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-4 px-7 py-4 border-t border-border shrink-0 bg-bg-secondary/30">
          <div className="flex-1 min-w-0">
            {error ? (
              <p className="inline-flex items-center gap-1.5 text-xs text-[#DC2626] font-body font-medium">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                {error}
              </p>
            ) : !frName ? (
              <p className="text-[11px] text-text-muted font-body">Saisissez d'abord le nom en français.</p>
            ) : mappingMissing ? (
              <p className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 font-body">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {isoMissing
                  ? "Code ISO obligatoire."
                  : isoInvalid
                    ? "Code ISO invalide (2 lettres)."
                    : "Complétez la correspondance Paris Fashion Shop."}
              </p>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 font-body">
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
              className="px-4 py-2 border border-border text-text-secondary hover:border-bg-dark hover:text-text-primary text-sm font-medium rounded-lg transition-colors font-body"
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
              className="inline-flex items-center gap-2 px-5 py-2 bg-bg-dark hover:bg-black text-text-inverse text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-body"
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
                  {isEdit ? "Enregistrer" : "Créer"}
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
