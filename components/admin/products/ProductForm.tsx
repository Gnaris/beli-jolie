"use client";

import { useState, useTransition, useRef, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import ColorVariantManager, { VariantState, ColorImageState, AvailableColor, AvailableSize, PackLineState, PfsColorOption, uid as genUid, variantGroupKeyFromState, imageGroupKeyFromVariant, variantColorFingerprint, computeTotalPrice, isMultiColorPack, packLinesColorList, buildVariantDuplicateKey } from "./ColorVariantManager";
import PhotosPanel from "./PhotosPanel";
import MarketplacesMappingSection, { type EfashionColorOption, type LiveMarketplaceColorLabels } from "./MarketplacesMappingSection";
import { ProductMarketplaceToggles } from "./ProductMarketplaceToggles";
import { detectPfsColorConflicts, formatConflictsMessage, type VariantColorRefInput } from "@/lib/pfs-color-conflicts";
import { detectEfashionColorConflicts, formatEfashionConflictsMessage, type EfashionVariantColorRefInput } from "@/lib/efashion-color-conflicts";
import CompletenessChecklist, { computeChecklist } from "./CompletenessChecklist";
import ProductFormNav, { ProductFormSectionKey } from "./ProductFormNav";
import ProductFormSectionPicker from "./ProductFormSectionPicker";
import { SectionNavFooter } from "./SectionNavFooter";
import { SectionEyebrow } from "./SectionEyebrow";
import { PanelHeader } from "./PanelHeader";
import { createProduct, updateProduct, saveProductTranslations, fetchProductFormAttributes, checkProductReferenceAvailable, updateProductNoteOnly } from "@/app/actions/admin/products";

import { VALID_LOCALES, LOCALE_LABELS, NON_DEFAULT_LOCALES } from "@/i18n/locales";
import LocaleTabs from "./LocaleTabs";
import QuickCreateModal, { QuickCreateType } from "./QuickCreateModal";
import CategoryEditorModal from "@/components/admin/categories/CategoryEditorModal";
import ColorEditorModal from "@/components/admin/couleurs/ColorEditorModal";
import CompositionEditorModal from "@/components/admin/compositions/CompositionEditorModal";
import SeasonEditorModal from "@/components/admin/seasons/SeasonEditorModal";
import { listManufacturingCountries, countryFlagUrl } from "@/lib/countries";
import CustomSelect from "@/components/ui/CustomSelect";
import HsCodeModal from "@/components/admin/codes-sh/HsCodeModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useMarketplaceRefreshQueue } from "./MarketplaceRefreshContext";
import { useRightRail } from "@/components/admin/widgets-rail";
import { useRefreshMarketplacePrompt } from "./RefreshMarketplaceDialog";
import { LOCALE_FULL_NAMES } from "@/i18n/locales";
import { useProductFormHeader } from "./ProductFormHeaderContext";
import { getImageSrc } from "@/lib/image-utils";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { getAnkorstoreReferenceSuffixLength } from "@/lib/ankorstore-description";
import { buildProductMarketplaceSnapshot, buildProductMarketplaceSnapshotExcludingMicrostore } from "@/lib/product-marketplace-snapshot";
import { resolvePrimaryColorId } from "@/lib/product-primary-color";

const DESCRIPTION_MIN_CHARS = 30;
import type { MarketplaceId } from "@/lib/product-events";
import { subscribeSSE } from "@/lib/shared-sse";

type PfsRefStatus = "idle" | "checking" | "ok" | "exists" | "not_configured" | "error";

interface Category {
  id: string;
  name: string;
  subCategories: { id: string; name: string }[];
}

export interface AvailableComposition {
  id: string;
  name: string;
}

export interface AvailableProduct {
  id: string;
  name: string;
  reference: string;
}

interface CompositionItem {
  compositionId: string;
  percentage: string;
}

/**
 * Vrai si la variante n'a aucune taille renseignée. Pour un PACK
 * multi-couleurs, les tailles vivent dans `packLines` (1 ligne par couleur du
 * paquet, chacune avec ses tailles) — on considère la variante valide si
 * chaque ligne a au moins 1 taille.
 */
/**
 * Applique un override marketplace en cascade sur toutes les variantes/lignes
 * de pack ciblées, en UN SEUL setVariants (évite les problèmes de batching
 * React quand plusieurs variantes partagent la même couleur).
 */
function applyOverrideToTargets(
  setVariants: React.Dispatch<React.SetStateAction<VariantState[]>>,
  targets: { variantTempId: string; packLineTempId?: string }[],
  mutateVariant: (v: VariantState) => VariantState,
  mutatePackLine: (pl: VariantState["packLines"][number]) => VariantState["packLines"][number],
) {
  const variantTempIds = new Set<string>();
  const packLineTempIds = new Set<string>();
  for (const t of targets) {
    if (t.packLineTempId) packLineTempIds.add(t.packLineTempId);
    else variantTempIds.add(t.variantTempId);
  }
  setVariants((prev) =>
    prev.map((v) => {
      let next: VariantState = v;
      if (variantTempIds.has(v.tempId)) next = mutateVariant(next);
      if (next.packLines.length > 0) {
        let packChanged = false;
        const newPackLines = next.packLines.map((pl) => {
          if (packLineTempIds.has(pl.tempId)) {
            packChanged = true;
            return mutatePackLine(pl);
          }
          return pl;
        });
        if (packChanged) next = { ...next, packLines: newPackLines };
      }
      return next;
    }),
  );
}

function variantHasNoSizes(v: VariantState): boolean {
  if (isMultiColorPack(v)) {
    return (
      v.packLines.length === 0 ||
      v.packLines.some((line) => line.sizeEntries.length === 0)
    );
  }
  return v.sizeEntries.length === 0;
}

interface TranslationState {
  name: string;
  description: string;
}

interface ProductFormProps {
  categories?: Category[];
  availableColors?: AvailableColor[];
  availableSizes?: AvailableSize[];
  availableCompositions?: AvailableComposition[];
  availableSeasons?: { id: string; name: string }[];
  availableTags?: { id: string; name: string }[];
  mode?: "create" | "edit";
  productId?: string;
  hasPfsConfig?: boolean;
  hasAnkorstoreConfig?: boolean;
  ankorstoreEnabled?: boolean;
  hasEfashionConfig?: boolean;
  efashionEnabled?: boolean;
  hasFaireConfig?: boolean;
  faireEnabled?: boolean;
  hasMicrostoreConfig?: boolean;
  /** Toggle SiteConfig « branded_reference_badge_enabled ». Active la vignette
   *  « photo marquée » (aperçu du badge « Réf ») avec un cadenas sur la 1ère
   *  position de la couleur principale dans l'onglet Photos. */
  brandedBadgeEnabled?: boolean;
  /** Liste des couleurs PFS disponibles (pour le sélecteur de mapping secondaire). */
  pfsColorOptions?: PfsColorOption[];
  /** Liste des couleurs eFashion disponibles (pour le sélecteur de mapping secondaire). */
  efashionColorOptions?: EfashionColorOption[];
  /** Libellés couleur "réels côté marketplace" par variante liée, extraits des
   *  snapshots de sync. Alimente la colonne « Variante marketplace » du bloc
   *  Mapping pour refléter la valeur actuellement en base marketplace plutôt
   *  que le mapping local (utile quand un override a été changé sans resync). */
  liveMarketplaceColorLabels?: LiveMarketplaceColorLabels;
  /** True when a marketplace sync is already in progress (from DB status on page load) */
  initialSyncing?: boolean;
  initialData?: {
    reference: string;
    name: string;
    description: string;
    note?: string | null;
    categoryId: string;
    subCategoryIds: string[];
    variants: VariantState[];
    colorImages: ColorImageState[];
    compositions: CompositionItem[];
    similarProductIds: string[];
    similarProducts?: { id: string; name: string; reference: string; category: string; image: string | null; maxPrice?: number }[];
    bundleChildIds: string[];
    bundleChildren?: { id: string; name: string; reference: string; category: string; image: string | null; maxPrice?: number }[];
    bundleParents?: { id: string; name: string; reference: string; category: string; image: string | null; maxPrice?: number }[];
    tagNames: string[];
    isBestSeller: boolean;
    dimLength: string;
    dimWidth: string;
    dimHeight: string;
    dimDiameter: string;
    dimCircumference: string;
    hsCodeId?: string | null;
    countryIsoCode?: string;
    seasonId?: string;
    translations?: { locale: string; name: string; description: string }[];
    status?: "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING";
    discountPercent?: string;
    sizeDetailsTu?: string;
    /** ID marketplace — présent = déjà publié sur cette marketplace */
    pfsProductId?: string | null;
    ankorsProductId?: string | null;
    /** eFashion : on a une `referenceBase` plutôt qu'un id unique (1 couleur = 1 ligne) */
    efashionReferenceBase?: string | null;
    /** Faire : id `p_xxx` du produit créé chez Faire (null = jamais publié) */
    faireProductId?: string | null;
    /** Microstore : date du dernier push réussi (null = jamais publié). */
    microstoreLastPushedAt?: Date | string | null;
    /** Marketplace activée pour ce produit (Product.*Enabled). Défaut true. */
    pfsEnabledForProduct?: boolean;
    ankorsEnabledForProduct?: boolean;
    efashionEnabledForProduct?: boolean;
    faireEnabledForProduct?: boolean;
    microstoreEnabledForProduct?: boolean;
    /** Couleur principale du produit (refonte : ne dépend plus de la variante isPrimary) */
    primaryColorId?: string | null;
    /** Sous-catégorie choisie comme étiquette d'export Microstore (null = catégorie principale). */
    microstoreSubCategoryId?: string | null;
  };
}

function defaultVariant(availableColors: AvailableColor[]): VariantState {
  const first = availableColors[0];
  return {
    tempId:       genUid(),
    colorId:      first?.id   ?? "",
    colorName:    first?.name ?? "",
    colorHex:     first?.hex  ?? "#9CA3AF",
    sizeEntries:  [],
    unitPrice:    "",
    weight:       "",
    stock:        "",
    isPrimary:    true,
    saleType:     "UNIT",
    packQuantity: "",
    packLines:    [],
    sku: "",
    disabled: false,
  };
}

// ─────────────────────────────────────────────
// Tags multi-select dropdown
// ─────────────────────────────────────────────
function TagsDropdown({
  localTags,
  tagNames,
  setTagNames,
  onCreateClick,
  isBestSeller,
  setIsBestSeller,
  productId,
  mode,
  loading = false,
  discountPercent,
  setDiscountPercent,
  hsCodeId,
  setHsCodeId,
  hsCodeOptions,
  onCreateHsCodeClick,
}: {
  localTags: { id: string; name: string }[];
  tagNames: string[];
  setTagNames: React.Dispatch<React.SetStateAction<string[]>>;
  onCreateClick: () => void;
  isBestSeller: boolean;
  setIsBestSeller: (v: boolean) => void;
  productId?: string;
  mode?: "create" | "edit";
  loading?: boolean;
  discountPercent: string;
  setDiscountPercent: (v: string) => void;
  hsCodeId: string;
  setHsCodeId: (v: string) => void;
  hsCodeOptions: { id: string; code: string; label: string }[];
  onCreateHsCodeClick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Accent-insensitive normalize
  function normalize(s: string) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return localTags;
    const q = normalize(search);
    return localTags.filter((t) => normalize(t.name).includes(q));
  }, [localTags, search]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setSearch("");
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function toggleTag(name: string) {
    setTagNames((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
    );
  }

  function removeTag(name: string) {
    setTagNames((prev) => prev.filter((x) => x !== name));
  }

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <SectionEyebrow
        label="Mots-clés"
        hint="Tags de recherche + code SH douanier."
        action={
          <button type="button" onClick={onCreateClick}
            className="text-xs text-text-primary hover:text-[#000000] font-medium font-body transition-colors"
          >+ Créer</button>
        }
      />

      {/* Selected tags as removable chips */}
      {tagNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tagNames.map((name) => (
            <span key={name}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-bg-dark text-text-inverse font-body"
            >
              {name}
              <button type="button" onClick={() => removeTag(name)}
                className="ml-0.5 p-0.5 min-w-[20px] min-h-[20px] flex items-center justify-center hover:text-red-300 transition-colors" aria-label={`Retirer ${name}`}
              >×</button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown trigger & menu */}
      <div ref={containerRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => { setOpen((v) => !v); setTimeout(() => inputRef.current?.focus(), 50); }}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Sélectionner des mots-clés"
          className={`w-full flex items-center justify-between px-3 py-2.5 border rounded-lg text-sm font-body transition-colors ${
            open ? "border-[#1A1A1A] ring-1 ring-[#1A1A1A]" : "border-border hover:border-[#CBCBCB]"
          }`}
        >
          <span className={tagNames.length > 0 ? "text-text-primary" : "text-text-muted"}>
            {tagNames.length > 0
              ? `${tagNames.length} mot${tagNames.length > 1 ? "s" : ""}-clé${tagNames.length > 1 ? "s" : ""} sélectionné${tagNames.length > 1 ? "s" : ""}`
              : "Sélectionner des mots-clés…"}
          </span>
          <svg className={`w-4 h-4 text-text-secondary transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full bg-bg-primary border border-border rounded-xl shadow-lg overflow-hidden">
            {/* Search input */}
            <div className="p-2 border-b border-border-light">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un mot-clé…"
                className="w-full px-2.5 py-2 text-sm border border-border rounded-md font-body focus:outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A]"
              />
            </div>

            {/* Options list */}
            <div className="max-h-48 overflow-y-auto" role="listbox" aria-label="Mots-clés disponibles">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-4">
                  <svg className="w-4 h-4 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-xs text-text-muted font-body">Chargement…</span>
                </div>
              ) : filtered.length > 0 ? filtered.map((t) => {
                const selected = tagNames.includes(t.name);
                return (
                  <button key={t.id} type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => toggleTag(t.name)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left font-body transition-colors hover:bg-bg-secondary ${
                      selected ? "text-text-primary font-medium" : "text-text-secondary"
                    }`}
                  >
                    <span className={`flex items-center justify-center w-4 h-4 rounded border text-[10px] ${
                      selected
                        ? "bg-bg-dark border-[#1A1A1A] text-text-inverse"
                        : "border-[#D1D5DB] bg-bg-primary"
                    }`}>
                      {selected && "✓"}
                    </span>
                    {t.name}
                  </button>
                );
              }) : localTags.length === 0 ? (
                <p className="px-3 py-3 text-xs text-text-secondary font-body">
                  Aucun mot-clé n&apos;est créé.
                </p>
              ) : (
                <p className="px-3 py-3 text-xs text-text-secondary font-body">
                  Aucun mot-clé trouvé.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Best-seller, Remise et Code SH sont maintenant respectivement dans l'en-tête, Variantes et Général */}
    </div>
  );
}

export default function ProductForm({
  categories: _initialCategories,
  availableColors: _initialColors,
  availableSizes: _initialSizes,
  availableCompositions: _initialCompositions,
  availableSeasons: _initialSeasons,
  availableTags: _initialTags,
  mode = "create",
  productId,
  hasPfsConfig = false,
  hasAnkorstoreConfig = false,
  hasEfashionConfig = false,
  efashionEnabled = false,
  ankorstoreEnabled = false,
  hasFaireConfig = false,
  faireEnabled = false,
  hasMicrostoreConfig = false,
  brandedBadgeEnabled = false,
  pfsColorOptions,
  efashionColorOptions,
  liveMarketplaceColorLabels,
  initialSyncing = false,
  initialData,
}: ProductFormProps) {
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();

  // ── Marketplace sync lock ──────────────────────────────────────────────
  // Starts from DB status (survives refresh), unlocks when SSE reports completion
  const [dbSyncing, setDbSyncing] = useState(initialSyncing);

  const isSyncLocked = dbSyncing;

  // ── Local lists — fetched from DB on mount (no cache) ────────────────
  const [localCategories,   setLocalCategories]   = useState<Category[]>(_initialCategories ?? []);
  const [localCompositions, setLocalCompositions] = useState<AvailableComposition[]>(_initialCompositions ?? []);
  const [localColors,       setLocalColors]       = useState<AvailableColor[]>(_initialColors ?? []);
  const [localSizes,        setLocalSizes]        = useState<AvailableSize[]>(_initialSizes ?? []);
  const [localTags,         setLocalTags]         = useState<{ id: string; name: string }[]>(_initialTags ?? []);
  // Pays de fabrication : liste figée dans lib/countries.ts, plus de state (readonly)
  const localCountries = listManufacturingCountries().map((c) => ({ id: c.code, name: c.name, isoCode: c.code }));
  const [localSeasons,      setLocalSeasons]      = useState<{ id: string; name: string }[]>(_initialSeasons ?? []);
  const [pfsSizes,          setPfsSizes]          = useState<{ reference: string; label: string }[]>([]);
  const [localHsCodes,      setLocalHsCodes]      = useState<{ id: string; code: string; label: string }[]>([]);
  const [hsCodeQuickCreateOpen, setHsCodeQuickCreateOpen] = useState(false);
  const [attributesLoaded,  setAttributesLoaded]  = useState(false);

  // Fetch all attributes from DB on mount (background, no cache)
  useEffect(() => {
    let cancelled = false;
    fetchProductFormAttributes().then((data) => {
      if (cancelled) return;
      setLocalCategories(data.categories);
      setLocalColors(data.colors);
      setLocalSizes(data.sizes);
      setLocalCompositions(data.compositions);
      setLocalTags(data.tags);
      setLocalSeasons(data.seasons);
      setPfsSizes(data.pfsSizes ?? []);
      setLocalHsCodes(data.hsCodes ?? []);
      setAttributesLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Form fields ──────────────────────────────────────────────────────
  const [reference,       setReference]       = useState(initialData?.reference       ?? "");
  const [pfsRefStatus, setPfsRefStatus] = useState<PfsRefStatus>("idle");
  const [pfsRefMessage, setPfsRefMessage] = useState<string | null>(null);
  const pfsRefCheckedValueRef = useRef<string | null>(null);
  const pfsRefRequestIdRef = useRef(0);
  const pfsRefAbortRef = useRef<AbortController | null>(null);
  const [name,            setName]            = useState(initialData?.name            ?? "");
  const [description,     setDescription]     = useState(initialData?.description     ?? "");
  const [categoryId,      setCategoryId]      = useState(initialData?.categoryId      ?? "");
  const [subCategoryIds,  setSubCategoryIds]  = useState<string[]>(initialData?.subCategoryIds ?? []);
  // Étiquette envoyée à Microstore : null = catégorie principale (défaut),
  // sinon id d'une des sous-catégories attribuées au produit.
  const [microstoreSubCategoryId, setMicrostoreSubCategoryId] = useState<string | null>(
    initialData?.microstoreSubCategoryId ?? null,
  );
  const [variants, setVariants] = useState<VariantState[]>(
    initialData?.variants ?? []
  );
  const [colorImages, setColorImages] = useState<ColorImageState[]>(
    initialData?.colorImages ?? []
  );
  // Couleur principale du produit (refonte : portée par Product, plus par la variante).
  // Auto-assignée au 1er ajout de couleur, et auto-réassignée si la couleur courante
  // disparaît de l'union (variantes + pack-lines).
  const [primaryColorId, setPrimaryColorId] = useState<string | null>(initialData?.primaryColorId ?? null);
  const [compositions, setCompositions] = useState<CompositionItem[]>(initialData?.compositions ?? []);
  const [similarProductIds, setSimilarProductIds] = useState<string[]>(initialData?.similarProductIds ?? []);
  const [bundleChildIds, setBundleChildIds] = useState<string[]>(initialData?.bundleChildIds ?? []);
  const [tagNames,          setTagNames]          = useState<string[]>(initialData?.tagNames ?? []);
  const [isBestSeller,      setIsBestSeller]      = useState(initialData?.isBestSeller ?? false);
  const [activeSection,     setActiveSection]     = useState<ProductFormSectionKey>("general");
  const [discountPercent,   setDiscountPercent]   = useState(initialData?.discountPercent ?? "");
  const [sizeDetailsTu, setSizeDetailsTu] = useState(initialData?.sizeDetailsTu ?? "");
  const [countryIsoCode, setCountryIsoCode] = useState(initialData?.countryIsoCode ?? "");
  const [seasonId, setSeasonId] = useState(initialData?.seasonId ?? "");

  // ── Dimensions ───────────────────────────────────────────────────────
  const [dimLength,        setDimLength]        = useState(initialData?.dimLength        ?? "");
  const [dimWidth,         setDimWidth]         = useState(initialData?.dimWidth         ?? "");
  const [dimHeight,        setDimHeight]        = useState(initialData?.dimHeight        ?? "");
  const [dimDiameter,      setDimDiameter]      = useState(initialData?.dimDiameter      ?? "");
  const [dimCircumference, setDimCircumference] = useState(initialData?.dimCircumference ?? "");
  const [hsCodeId,         setHsCodeId]         = useState<string>(initialData?.hsCodeId    ?? "");

  // ── Note interne (édition inline dans la section "note") ─────────────
  const [note, setNote] = useState<string>(initialData?.note ?? "");
  const [savedNote, setSavedNote] = useState<string>(initialData?.note ?? "");
  const [noteSaving, setNoteSaving] = useState(false);
  const noteDirty = note !== savedNote;

  const [error, setError] = useState("");
  const [onlineErrors, setOnlineErrors] = useState<string[]>([]);
  const [productStatus, setProductStatus] = useState<"OFFLINE" | "ONLINE" | "ARCHIVED">(() => {
    const s = initialData?.status;
    if (s === "ONLINE" || s === "OFFLINE" || s === "ARCHIVED") return s;
    return "OFFLINE"; // SYNCING / undefined → OFFLINE par défaut
  });

  // ── Touched fields for real-time validation ──────────────────────────
  const [touchedFields, setTouchedFields] = useState<Set<string>>(
    initialData ? new Set(["reference", "name", "description", "category"]) : new Set()
  );
  const markTouched = useCallback((field: string) => {
    setTouchedFields((prev) => {
      if (prev.has(field)) return prev;
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }, []);

  const runPfsRefCheck = useCallback(async (
    rawValue: string,
    options: { force?: boolean } = {},
  ): Promise<PfsRefStatus> => {
    const value = rawValue.trim().replace(/\s/g, "").toUpperCase();
    if (!value) {
      setPfsRefStatus("idle");
      setPfsRefMessage(null);
      return "idle";
    }
    // Édition d'un produit existant et la référence n'a pas bougé : pas la
    // peine d'aller voir PFS, on ne va pas se rejeter soi-même.
    const initialRef = initialData?.reference?.trim().replace(/\s/g, "").toUpperCase() ?? "";
    if (initialRef && initialRef === value) {
      setPfsRefStatus("idle");
      setPfsRefMessage(null);
      return "idle";
    }
    if (!options.force && pfsRefCheckedValueRef.current === value) {
      return "idle";
    }

    // Abort la requête en vol précédente (ex: blur rapide enchaîné)
    pfsRefAbortRef.current?.abort();
    const controller = new AbortController();
    pfsRefAbortRef.current = controller;

    const requestId = ++pfsRefRequestIdRef.current;
    setPfsRefStatus("checking");
    setPfsRefMessage(null);

    try {
      const res = await fetch("/api/admin/products/check-reference-pfs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reference: value,
          currentProductId: productId ?? undefined,
        }),
        signal: controller.signal,
      });
      if (requestId !== pfsRefRequestIdRef.current) return "idle";
      const json = (await res.json()) as
        | { status: "ok" }
        | { status: "exists"; message: string }
        | { status: "not_configured" }
        | { status: "error"; message: string };

      pfsRefCheckedValueRef.current = value;
      setPfsRefStatus(json.status);
      setPfsRefMessage("message" in json ? json.message : null);
      return json.status;
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return "idle";
      if (requestId !== pfsRefRequestIdRef.current) return "idle";
      setPfsRefStatus("error");
      setPfsRefMessage("Vérification PFS impossible pour le moment.");
      return "error";
    }
  }, [productId]);

  // Cleanup : annule toute requête PFS en vol au démontage du composant
  useEffect(() => {
    return () => {
      pfsRefAbortRef.current?.abort();
    };
  }, []);

  // ── Sync header badges via context ────────────────────────────────────
  const { updateHeader, registerStatusToggle, registerBestSellerToggle } = useProductFormHeader();
  const headerStockState = useMemo((): "ok" | "partial_out" | "all_out" => {
    const withStock = variants.filter(v => v.stock !== "" && v.stock !== undefined);
    const outOfStock = withStock.filter(v => parseInt(v.stock) === 0);
    if (withStock.length > 0 && outOfStock.length === withStock.length) return "all_out";
    if (outOfStock.length > 0) return "partial_out";
    return "ok";
  }, [variants]);
  useEffect(() => {
    updateHeader({ productStatus, stockState: headerStockState });
  }, [productStatus, headerStockState, updateHeader]);
  const wasImported = !!initialData?.pfsProductId;
  /** Brouillon non lié : produit Hors ligne sans aucun ID marketplace côté Product
   *  ni côté ProductColor. Tant qu'aucune marketplace n'a vu le produit, on peut
   *  encore corriger la couleur d'une variante UNIT existante sans devoir la
   *  supprimer/recréer. Pack et multi-couleurs restent verrouillés (composition
   *  liée aux tailles). */
  const allowColorEditExistingVariants = useMemo(() => {
    const status = initialData?.status ?? "OFFLINE";
    if (status !== "OFFLINE") return false;
    if (initialData?.pfsProductId) return false;
    if (initialData?.ankorsProductId) return false;
    if (initialData?.efashionReferenceBase) return false;
    if (initialData?.faireProductId) return false;
    return true;
  }, [
    initialData?.status,
    initialData?.pfsProductId,
    initialData?.ankorsProductId,
    initialData?.efashionReferenceBase,
    initialData?.faireProductId,
  ]);
  useEffect(() => {
    // Completeness depends on many fields — separate effect.
    // Imported products are never shown as drafts.
    updateHeader({ isIncomplete: wasImported ? false : getCompletenessErrors().length > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference, name, description, categoryId, compositions, variants, colorImages]);

  // ── Sync Best-seller au header (nouveau header enrichi) ────────────
  useEffect(() => {
    updateHeader({ isBestSeller });
  }, [isBestSeller, updateHeader]);
  useEffect(() => {
    registerBestSellerToggle({
      toggle: () => setIsBestSeller((v) => !v),
    });
  }, [registerBestSellerToggle]);

  // ── Sync KPIs au header (prix, stock, marketplaces, complétude) ────
  const headerKpi = useMemo(() => {
    const prices: number[] = [];
    let totalStock = 0;
    for (const v of variants) {
      const p = parseFloat(v.unitPrice);
      if (!isNaN(p) && p > 0) prices.push(p);
      const s = parseInt(v.stock);
      if (!isNaN(s) && s >= 0) totalStock += s;
    }
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    const minPrice = prices.length > 0 ? Math.min(...prices) : null;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : null;

    let linked = 0;
    let total = 0;
    if (hasPfsConfig) { total++; if (initialData?.pfsProductId) linked++; }
    if (hasAnkorstoreConfig && ankorstoreEnabled) { total++; if (initialData?.ankorsProductId) linked++; }
    if (hasEfashionConfig && efashionEnabled) { total++; if (initialData?.efashionReferenceBase) linked++; }
    if (hasFaireConfig && faireEnabled) { total++; if (initialData?.faireProductId) linked++; }

    const checks = [
      reference.trim().length > 0,
      name.trim().length > 0,
      description.trim().length >= 30,
      !!categoryId,
      compositions.length > 0,
      variants.length > 0,
      colorImages.some((c) => Array.isArray(c.imagePreviews) && c.imagePreviews.length > 0),
      !!countryIsoCode,
      !!seasonId,
      !!(dimLength || dimWidth || dimHeight || dimDiameter || dimCircumference),
    ];
    const done = checks.filter(Boolean).length;
    const completeness = (done / checks.length) * 100;

    return {
      avgPrice, minPrice, maxPrice, totalStock,
      linkedMarketplaces: linked, totalMarketplaces: total,
      completeness,
    };
  }, [
    variants, reference, name, description, categoryId, compositions, colorImages,
    countryIsoCode, seasonId,
    dimLength, dimWidth, dimHeight, dimDiameter, dimCircumference,
    hasPfsConfig, hasAnkorstoreConfig, ankorstoreEnabled,
    hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled,
    hasMicrostoreConfig,
    initialData?.pfsProductId, initialData?.ankorsProductId,
    initialData?.efashionReferenceBase, initialData?.faireProductId,
    initialData?.microstoreLastPushedAt,
  ]);
  useEffect(() => {
    updateHeader({ kpi: headerKpi });
  }, [headerKpi, updateHeader]);

  // Listen for SSE marketplace sync events to:
  // 1. Unlock the form when sync completes (even if page was loaded mid-sync)
  // 2. Update the header badge in real-time
  useEffect(() => {
    if (!productId) return;
    const unsub = subscribeSSE((data) => {
      const event = data as {
        type?: string;
        productId?: string;
        marketplaceSync?: { marketplace: string; status: string; error?: string };
      };
      if (event.type !== "MARKETPLACE_SYNC" || event.productId !== productId) return;
      const mp = event.marketplaceSync;
      if (!mp) return;

      // Legacy marketplace sync tracking removed — marketplaces are populated
      // via manual Excel upload now.
      if (mp.status === "success" || mp.status === "error") {
        setDbSyncing(false);
      }
    });
    return unsub;
  }, [productId, updateHeader]);

  // ── Unsaved changes guard ─────────────────────────────────────────────
  const router = useRouter();
  const { confirm: confirmDialog } = useConfirm();
  const toast = useToast();
  const { enqueue: enqueuePublish } = useMarketplaceRefreshQueue();
  const { ask: askMarketplaceOptions } = useRefreshMarketplacePrompt();
  const { nudgeWidget } = useRightRail();

  const handleSaveNote = async () => {
    if (!productId || noteSaving) return;
    setNoteSaving(true);
    try {
      const res = await updateProductNoteOnly(productId, note);
      if (res.success) {
        setSavedNote(note);
        toast.success("Note enregistrée");
      } else {
        toast.error("Impossible d'enregistrer la note", res.error ?? "Erreur inconnue.");
      }
    } finally {
      setNoteSaving(false);
    }
  };
  const initialSnapshot = useRef<string | null>(null);
  // Snapshot parallèle qui ne capture QUE les champs marketplace-pertinents
  // (exclut mots-clés, sous-catégories, produits similaires, contenu de
  // l'ensemble). Sert à décider si la modale "Pousser aux marketplaces" doit
  // s'afficher au save : si seuls des champs locaux ont changé, la modale est
  // bypassée silencieusement.
  const initialMarketplaceSnapshot = useRef<string | null>(null);
  // Snapshot marketplace initial SANS microstoreSubCategoryId — permet de
  // détecter si seul ce champ a bougé au save et de proposer uniquement
  // Microstore dans la modale de propagation (les autres marketplaces
  // ignorent la sous-catégorie Microstore).
  const initialMarketplaceSnapshotExcludingMicrostore = useRef<string | null>(null);
  const isDirty = useRef(false);
  const snapshotReady = useRef(false);
  // ⚠️ Reset post-save : on ne peut pas appeler `initialSnapshot.current =
  // buildSnapshot()` directement dans le handler de save parce que les
  // setVariants/setColorImages/setProductStatus qui viennent d'être appelés
  // ne sont pas encore appliqués au moment où on construit le snapshot —
  // buildSnapshot reste sur ses anciennes closures et capture l'ancien état.
  // Résultat : au prochain render, le snapshot stocké est l'ancien, l'état
  // réel est le nouveau, la détection « modifications non enregistrées »
  // se trompe et le bouton Enregistrer reste actif. Le fix : poser ce ref à
  // true à la fin du save, et laisser un useEffect dédié re-prendre le
  // snapshot une fois React re-rendu avec les nouvelles valeurs.
  const pendingSnapshotResetRef = useRef(false);

  const buildSnapshot = useCallback(() => JSON.stringify({
    reference, name, description, categoryId, subCategoryIds,
    variants: variants.map((v) => ({
      colorId: v.colorId,
      unitPrice: v.unitPrice,
      weight: v.weight,
      stock: v.stock,
      saleType: v.saleType,
      packQuantity: v.packQuantity,
      sizeEntries: v.sizeEntries,
      disabled: v.disabled ?? false,
      pfsColorRefOverride: v.pfsColorRefOverride ?? null,
      efashionColorIdOverride: v.efashionColorIdOverride ?? null,
      ankorsColorNameOverride: (v.ankorsColorNameOverride ?? "").trim() || null,
      faireColorNameOverride: (v.faireColorNameOverride ?? "").trim() || null,
      packLines: v.packLines.map((pl) => ({
        colorId: pl.colorId,
        sizeEntries: pl.sizeEntries,
        pfsColorRefOverride: pl.pfsColorRefOverride ?? null,
        efashionColorIdOverride: pl.efashionColorIdOverride ?? null,
        ankorsColorNameOverride: (pl.ankorsColorNameOverride ?? "").trim() || null,
        faireColorNameOverride: (pl.faireColorNameOverride ?? "").trim() || null,
      })),
    })),
    colorImages: colorImages.map((ci) => ({ groupKey: ci.groupKey, uploadedPaths: ci.uploadedPaths, orders: ci.orders })),
    compositions, similarProductIds, bundleChildIds, tagNames, isBestSeller, discountPercent,
    dimLength, dimWidth, dimHeight, dimDiameter, dimCircumference, hsCodeId, productStatus,
    countryIsoCode, seasonId, sizeDetailsTu, primaryColorId, microstoreSubCategoryId,
  }), [reference, name, description, categoryId, subCategoryIds, variants, colorImages, compositions, similarProductIds, bundleChildIds, tagNames, isBestSeller, discountPercent, dimLength, dimWidth, dimHeight, dimDiameter, dimCircumference, hsCodeId, productStatus, countryIsoCode, seasonId, sizeDetailsTu, primaryColorId, microstoreSubCategoryId]);

  // Mirror de buildSnapshot SANS les 4 champs locaux qui ne sont jamais poussés
  // aux marketplaces (mots-clés, sous-catégories, produits similaires, contenu
  // de l'ensemble). Si ce snapshot est identique entre l'ouverture et le save,
  // on saute la modale "Pousser aux marketplaces" puisque rien de marketplace-
  // pertinent n'a bougé. Logique extraite dans lib/product-marketplace-snapshot
  // pour tests unitaires + cohérence cross-fichier.
  const buildMarketplaceSnapshot = useCallback(() => buildProductMarketplaceSnapshot({
    reference, name, description, categoryId,
    variants, colorImages, compositions, isBestSeller, discountPercent,
    dimLength, dimWidth, dimHeight, dimDiameter, dimCircumference, hsCodeId, productStatus,
    countryIsoCode, seasonId, sizeDetailsTu, primaryColorId, microstoreSubCategoryId,
  }), [reference, name, description, categoryId, variants, colorImages, compositions, isBestSeller, discountPercent, dimLength, dimWidth, dimHeight, dimDiameter, dimCircumference, hsCodeId, productStatus, countryIsoCode, seasonId, sizeDetailsTu, primaryColorId, microstoreSubCategoryId]);

  // Snapshot sans microstoreSubCategoryId — sert à détecter si SEULE la
  // sous-catégorie Microstore a changé (dans ce cas la modale ne proposera
  // que Microstore, pas les autres marketplaces qui ignorent ce champ).
  const buildMarketplaceSnapshotExcludingMicrostore = useCallback(() => buildProductMarketplaceSnapshotExcludingMicrostore({
    reference, name, description, categoryId,
    variants, colorImages, compositions, isBestSeller, discountPercent,
    dimLength, dimWidth, dimHeight, dimDiameter, dimCircumference, hsCodeId, productStatus,
    countryIsoCode, seasonId, sizeDetailsTu, primaryColorId, microstoreSubCategoryId,
  }), [reference, name, description, categoryId, variants, colorImages, compositions, isBestSeller, discountPercent, dimLength, dimWidth, dimHeight, dimDiameter, dimCircumference, hsCodeId, productStatus, countryIsoCode, seasonId, sizeDetailsTu, primaryColorId, microstoreSubCategoryId]);

  // Détecte si au moins une variante utilise "Taille Unique" / "TU"
  const hasTailleUnique = useMemo(() => {
    const tuNames = ["tu", "taille unique"];
    return variants.some((v) =>
      v.sizeEntries.some((se) => tuNames.includes(se.sizeName?.toLowerCase?.() ?? ""))
      || v.packLines?.some((pl) => pl.sizeEntries.some((se) => tuNames.includes(se.sizeName?.toLowerCase?.() ?? "")))
    );
  }, [variants]);

  // ⚠️ État réactif pour `hasUnsavedChanges` — il faut un useState (pas une
  // simple computation) parce que le reset post-save mute `initialSnapshot.current`
  // dans un useEffect, sans déclencher de re-render. Sans cet état, le bouton
  // « Enregistrer les modifications » restait actif après save jusqu'à la
  // prochaine frappe au clavier.
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Capture snapshot after first effects have settled (colorImages sync etc.)
  useEffect(() => {
    if (!snapshotReady.current) {
      const timer = setTimeout(() => {
        initialSnapshot.current = buildSnapshot();
        initialMarketplaceSnapshot.current = buildMarketplaceSnapshot();
        initialMarketplaceSnapshotExcludingMicrostore.current = buildMarketplaceSnapshotExcludingMicrostore();
        snapshotReady.current = true;
        setHasUnsavedChanges(false);
      }, 500);
      return () => clearTimeout(timer);
    }
    // Reset post-save : on a marqué le besoin de reset à la fin du handler
    // de save. C'est ici, au render qui suit, qu'on peut prendre le snapshot
    // avec les nouvelles closures (variantes avec leur dbId, paths d'images
    // résolus, status final).
    if (pendingSnapshotResetRef.current) {
      pendingSnapshotResetRef.current = false;
      initialSnapshot.current = buildSnapshot();
      initialMarketplaceSnapshot.current = buildMarketplaceSnapshot();
      initialMarketplaceSnapshotExcludingMicrostore.current = buildMarketplaceSnapshotExcludingMicrostore();
      isDirty.current = false;
      setHasUnsavedChanges(false);
      return;
    }
    const dirty = buildSnapshot() !== initialSnapshot.current;
    isDirty.current = dirty;
    setHasUnsavedChanges(dirty);
  }, [buildSnapshot, buildMarketplaceSnapshot, buildMarketplaceSnapshotExcludingMicrostore]);

  // Browser close / refresh / hard navigation
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty.current) {
        e.preventDefault();
        e.returnValue = "unsaved";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const navigateWithGuard = useCallback(async (href: string) => {
    if (!isDirty.current) { router.push(href); return; }

    if (mode === "create") {
      const result = await confirmDialog({
        title: "Modifications non enregistrées",
        message: "Vous avez des modifications non enregistrées. Voulez-vous enregistrer en brouillon avant de quitter ?",
        confirmLabel: "Enregistrer en brouillon",
        cancelLabel: "Annuler",
        type: "warning" as const,
        secondaryAction: { label: "Quitter sans enregistrer", style: "danger" },
      });
      if (result === true) {
        // Save as draft then navigate
        handleSaveDraft(href);
      } else if (result === "secondary") {
        // Discard and navigate
        isDirty.current = false;
        router.push(href);
      } else {
        // false = cancel, stay on page — clear any overlay that NavigationLoader
        // may have shown if its microtask ran before our preventDefault landed.
        hideLoading();
      }
    } else {
      const ok = await confirmDialog({
        title: "Modifications non enregistrées",
        message: "Vous avez des modifications non enregistrées. Voulez-vous vraiment quitter cette page ? Vos changements seront perdus.",
        confirmLabel: "Quitter",
        type: "danger" as const,
      });
      if (ok) {
        isDirty.current = false;
        router.push(href);
      } else {
        hideLoading();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, confirmDialog, mode, hideLoading]);

  // Intercept ALL client-side link clicks inside the page
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!isDirty.current) return;
      const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      // Un lien de téléchargement (attribut `download`) déclenche un download,
      // pas une navigation — ne pas afficher la garde "modifications non enregistrées".
      if (anchor.hasAttribute("download")) return;
      // Idem pour un lien qui s'ouvre dans un nouvel onglet : la page courante reste.
      if (anchor.target === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript")) return;
      // Only intercept internal navigation
      if (href.startsWith("http") && !href.startsWith(window.location.origin)) return;
      e.preventDefault();
      e.stopPropagation();
      // stopImmediatePropagation : empêche d'autres listeners en capture
      // sur `document` (notamment NavigationLoader) de programmer leur
      // overlay alors qu'on est en train de bloquer la navigation.
      e.stopImmediatePropagation();
      navigateWithGuard(href);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navigateWithGuard]);

  // `hasUnsavedChanges` est désormais un useState alimenté par le useEffect
  // au-dessus, plus une simple computation. Voir le commentaire dans la
  // déclaration de `pendingSnapshotResetRef`.

  // ── Sync colorImages when variant colors change ───────────────────────
  // One ColorImageState per color group (colorId + sub-colors) — UNIT and PACK share the same scheme
  const variantColorKey = variants
    .map((v) => {
      const base = variantColorFingerprint(v);
      if (isMultiColorPack(v)) {
        const plColors = v.packLines.map((l) => l.colorId).filter(Boolean).sort().join(",");
        return base + ":" + plColors;
      }
      return base;
    })
    .filter(Boolean)
    .sort()
    .join("|");
  useEffect(() => {
    const groupMap = new Map<string, { colorId: string; name: string; hex: string }>();
    for (const v of variants) {
      if (isMultiColorPack(v)) {
        // Multi-color pack: add each pack line color as its own image tab
        for (const color of packLinesColorList(v.packLines)) {
          if (!groupMap.has(color.colorId)) {
            groupMap.set(color.colorId, { colorId: color.colorId, name: color.colorName, hex: color.colorHex });
          }
        }
      } else {
        if (!v.colorId) continue;
        const gk = variantGroupKeyFromState(v);
        if (!groupMap.has(gk)) {
          groupMap.set(gk, { colorId: v.colorId, name: v.colorName, hex: v.colorHex });
        }
      }
    }
    setColorImages((prev) => {
      // ⚠️ On NE supprime PAS les entrées dont la variante a disparu — c'est la
      // clé du comportement « tant qu'on n'a pas enregistré, la variante est
      // toujours là » demandé par l'admin. Si elle supprime puis ré-ajoute la
      // même couleur avant Save, l'entrée colorImages (et ses images) est
      // toujours en mémoire et se retrouve automatiquement réutilisée par la
      // recherche `colorImages.find((c) => c.groupKey === imgGk)`.
      //
      // Les éventuelles entrées orphelines (couleurs plus dans les variantes)
      // sont filtrées à l'affichage côté `ImageManagerModal` via la prop
      // `activeGroupKeys`, et nettoyées par la sérialisation au moment du save.
      const updated = prev.map((ci) => {
        const info = groupMap.get(ci.groupKey);
        if (info && (ci.colorName !== info.name || ci.colorHex !== info.hex || ci.colorId !== info.colorId)) {
          return { ...ci, colorId: info.colorId, colorName: info.name, colorHex: info.hex };
        }
        return ci;
      });
      const existingKeys = new Set(updated.map((ci) => ci.groupKey));
      const toAdd: ColorImageState[] = [];
      for (const [gk, info] of groupMap) {
        if (!existingKeys.has(gk)) {
          toAdd.push({
            groupKey: gk,
            colorId: info.colorId,
            colorName: info.name,
            colorHex: info.hex,
            imagePreviews: [],
            uploadedPaths: [],
            orders: [],
            pendingFiles: [],
            uploading: false,
          });
        }
      }
      const result = [...updated, ...toAdd];
      if (result.length === prev.length && result.every((r, i) => r === prev[i])) return prev;
      return result;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantColorKey]);

  // ── Couleur principale : auto-assignation et réassignation ───────────
  // - À la 1ʳᵉ couleur disponible si rien n'est encore défini (création)
  // - Réassignation auto à la 1ʳᵉ couleur restante si la couleur principale
  //   actuelle n'est plus dans l'union des couleurs (variantes + pack-lines)
  useEffect(() => {
    const availableColorIds = colorImages.map((ci) => ci.colorId).filter((id): id is string => !!id);
    if (primaryColorId === null) {
      if (availableColorIds.length > 0) {
        setPrimaryColorId(availableColorIds[0]);
      }
      return;
    }
    if (!availableColorIds.includes(primaryColorId)) {
      setPrimaryColorId(availableColorIds[0] ?? null);
    }
  }, [colorImages, primaryColorId]);

  // ── Locale tabs ──────────────────────────────────────────────────────
  const [activeLocale, setActiveLocale] = useState("fr");
  const [translations, setTranslations] = useState<Record<string, TranslationState>>(() => {
    const map: Record<string, TranslationState> = {};
    for (const t of initialData?.translations ?? []) {
      if (t.locale !== "fr") map[t.locale] = { name: t.name, description: t.description };
    }
    return map;
  });

  // ── Quick-create modal ───────────────────────────────────────────────
  const [modalType, setModalType] = useState<QuickCreateType | null>(null);

  // ── Translate all (name + description) ─────────────────────────────
  const [translateLoading, setTranslateLoading] = useState(false);
  const [translateError, setTranslateError] = useState("");
  const [translateSuccess, setTranslateSuccess] = useState("");
  const { confirm } = useConfirm();

  const localeListStr = Object.entries(LOCALE_FULL_NAMES)
    .filter(([k]) => k !== "fr")
    .map(([, v]) => v)
    .join(", ");

  async function handleTranslateAll() {
    if (!name.trim() && !description.trim()) return;
    setTranslateError("");
    setTranslateSuccess("");

    const texts = [name.trim(), description.trim()].filter(Boolean);

    const confirmed = await confirm({
      type: "info",
      title: "Tout traduire (nom + description)",
      message: `Traduire le nom et la description en ${localeListStr} via l'API Paris Fashion Shop.`,
      confirmLabel: "Traduire",
      cancelLabel: "Annuler",
    });
    if (!confirmed) return;

    setTranslateLoading(true);
    try {
      const res = await fetch("/api/admin/translate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setTranslateError(data.message);
        return;
      }
      if (!res.ok) throw new Error("Erreur traduction");

      const data = await res.json();
      const results: Record<string, string>[] = data.results;

      // results[0] = name translations, results[1] = description translations (if both provided)
      const nameIdx = name.trim() ? 0 : -1;
      const descIdx = name.trim() && description.trim() ? 1 : description.trim() ? 0 : -1;

      const newTranslations: Record<string, { name: string; description: string }> = {};
      for (const locale of NON_DEFAULT_LOCALES) {
        newTranslations[locale] = {
          name: nameIdx >= 0 ? (results[nameIdx]?.[locale] ?? "") : "",
          description: descIdx >= 0 ? (results[descIdx]?.[locale] ?? "") : "",
        };
      }

      setTranslations((prev) => {
        const next = { ...prev };
        for (const locale of NON_DEFAULT_LOCALES) {
          next[locale] = {
            name: newTranslations[locale].name || (next[locale]?.name ?? ""),
            description: newTranslations[locale].description || (next[locale]?.description ?? ""),
          };
        }
        return next;
      });

      // Auto-save translations in edit mode
      if (mode === "edit" && productId) {
        try {
          const toSave = Object.entries(newTranslations)
            .filter(([, t]) => t.name.trim() || t.description.trim())
            .map(([locale, t]) => ({ locale, name: t.name, description: t.description }));
          await saveProductTranslations(productId, toSave);
          setTranslateSuccess("Traductions générées et enregistrées !");
        } catch {
          setTranslateSuccess("Traductions générées (erreur lors de la sauvegarde automatique).");
        }
      } else {
        setTranslateSuccess("Traductions générées avec succès !");
      }
      setTimeout(() => setTranslateSuccess(""), 4000);
    } catch {
      setTranslateError("Erreur lors de la traduction.");
    } finally {
      setTranslateLoading(false);
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────
  const selectedCategory = localCategories.find((c) => c.id === categoryId);
  const subCategories    = selectedCategory?.subCategories ?? [];

  // Étiquette Microstore : si l'utilisatrice décoche la sous-catégorie choisie,
  // on retombe automatiquement sur la catégorie principale (null).
  useEffect(() => {
    if (microstoreSubCategoryId && !subCategoryIds.includes(microstoreSubCategoryId)) {
      setMicrostoreSubCategoryId(null);
    }
  }, [subCategoryIds, microstoreSubCategoryId]);

  // Per-variant field errors for red highlighting (price/weight/stock/sizes)
  const variantErrors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const v of variants) {
      const errs = new Set<string>();
      const price = parseFloat(v.unitPrice);
      if (isNaN(price) || price <= 0) errs.add("price");
      const w = parseFloat(v.weight);
      if (isNaN(w) || w <= 0) errs.add("weight");
      if (v.stock === "" || v.stock === undefined || v.stock === null) errs.add("stock");
      if (variantHasNoSizes(v)) errs.add("sizes");
      if (errs.size > 0) map.set(v.tempId, errs);
    }
    return map;
  }, [variants]);

  // ── Completeness checklist input ───────────────────────────────────────
  const checklistInput = useMemo(() => ({
    reference,
    name,
    description,
    categoryId,
    compositions,
    variants,
    colorImages,
  }), [reference, name, description, categoryId, compositions, variants, colorImages]);

  // Locales that have at least a name filled (green dot)
  const filledLocales = new Set<string>(
    VALID_LOCALES.filter((l) =>
      l === "fr" ? name.trim().length > 0 : (translations[l]?.name?.trim().length ?? 0) > 0
    )
  );

  // Locales that have NO saved DB translation — only relevant in edit mode
  const missingDbLocales = initialData?.translations
    ? new Set<string>(
        VALID_LOCALES.filter((l) => {
          if (l === "fr") return false; // FR is always in product.name
          const saved = initialData?.translations?.find((t) => t.locale === l);
          return !saved; // missing if not in DB at all
        })
      )
    : undefined;

  function toggleSubCategory(id: string) {
    setSubCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // ── Composition helpers ──────────────────────────────────────────────
  const totalPct = compositions.reduce((sum, c) => sum + parseFloat(c.percentage || "0"), 0);

  function addComposition(compId: string) {
    if (!compId) return;
    if (compositions.some((c) => c.compositionId === compId)) return;
    const evenPct = String(Math.round(100 / (compositions.length + 1)));
    const updated = compositions.map((c) => ({ ...c, percentage: evenPct }));
    setCompositions([...updated, { compositionId: compId, percentage: evenPct }]);
  }

  function updateCompositionPct(compositionId: string, pct: string) {
    const cleaned = pct === "" ? "" : String(Math.max(0, Math.min(100, Math.round(Number(pct) || 0))));
    setCompositions(compositions.map((c) =>
      c.compositionId === compositionId ? { ...c, percentage: cleaned } : c
    ));
  }

  function removeComposition(compositionId: string) {
    const remaining = compositions.filter((c) => c.compositionId !== compositionId);
    if (remaining.length === 0) { setCompositions([]); return; }
    const evenPct = String(Math.round(100 / remaining.length));
    setCompositions(remaining.map((c) => ({ ...c, percentage: evenPct })));
  }

  // ── Color quick-create handler ────────────────────────────────────────
  async function handleQuickCreateColor(_colorName: string, _hex: string | null, _patternImage: string | null): Promise<AvailableColor> {
    throw new Error("La création rapide de couleur a été désactivée. Créer la couleur depuis /admin/produits > Couleurs.");
  }

  // ── Size added handler (invoked by QuickCreateSizeModal) ────────────
  function handleSizeAdded(newSize: AvailableSize) {
    setLocalSizes((prev) => (prev.some((s) => s.id === newSize.id) ? prev : [...prev, newSize]));
  }

  // ── Quick-create modal handlers ──────────────────────────────────────
  function handleModalCreated(item: {
    id: string;
    name: string;
    hex?: string | null;
    patternImage?: string | null;
    subCategories?: { id: string; name: string }[];
  }) {
    if (modalType === "category") {
      const cat = { id: item.id, name: item.name, subCategories: item.subCategories ?? [] };
      setLocalCategories((prev) => [...prev, cat]);
      setCategoryId(item.id);
      setSubCategoryIds([]);
    } else if (modalType === "subcategory") {
      setLocalCategories((prev) =>
        prev.map((cat) =>
          cat.id === categoryId
            ? { ...cat, subCategories: [...cat.subCategories, { id: item.id, name: item.name }] }
            : cat
        )
      );
      setSubCategoryIds((prev) => [...prev, item.id]);
    } else if (modalType === "composition") {
      setLocalCompositions((prev) => [...prev, { id: item.id, name: item.name }]);
      // Auto-apply: add composition to product with evenly distributed percentages
      setCompositions((prev) => {
        if (prev.some((c) => c.compositionId === item.id)) return prev;
        const evenPct = (100 / (prev.length + 1)).toFixed(1);
        const updated = prev.map((c) => ({ ...c, percentage: evenPct }));
        return [...updated, { compositionId: item.id, percentage: evenPct }];
      });
    } else if (modalType === "color") {
      setLocalColors((prev) => [
        ...prev,
        { id: item.id, name: item.name, hex: item.hex ?? null, patternImage: item.patternImage ?? null },
      ]);
    } else if (modalType === "tag") {
      setLocalTags((prev) => [...prev, { id: item.id, name: item.name }]);
      setTagNames((prev) => (prev.includes(item.name) ? prev : [...prev, item.name]));
    } else if (modalType === "season") {
      setLocalSeasons((prev) => [...prev, { id: item.id, name: item.name }]);
      setSeasonId(item.id);
    }
    setModalType(null);
  }

  // ── Locale field helpers ─────────────────────────────────────────────
  const activeName        = activeLocale === "fr" ? name        : (translations[activeLocale]?.name        ?? "");
  const activeDescription = activeLocale === "fr" ? description : (translations[activeLocale]?.description ?? "");

  function setActiveName(val: string) {
    if (activeLocale === "fr") {
      setName(val);
    } else {
      setTranslations((prev) => ({
        ...prev,
        [activeLocale]: { name: val, description: prev[activeLocale]?.description ?? "" },
      }));
    }
  }

  function setActiveDescription(val: string) {
    if (activeLocale === "fr") {
      setDescription(val);
    } else {
      setTranslations((prev) => ({
        ...prev,
        [activeLocale]: { name: prev[activeLocale]?.name ?? "", description: val },
      }));
    }
  }


  // ── Completeness check (all requirements for a "ready" product) ─────
  function getCompletenessErrors(): string[] {
    const errors: string[] = [];
    if (!reference.trim())    errors.push("Référence produit manquante");
    if (!name.trim())         errors.push("Nom du produit manquant");
    if (!description.trim())  errors.push("Description manquante");
    else if (description.trim().length + getAnkorstoreReferenceSuffixLength(reference) < DESCRIPTION_MIN_CHARS) errors.push("Description trop courte (30 caractères minimum)");
    if (!categoryId)          errors.push("Catégorie non sélectionnée");
    if (compositions.length === 0) {
      errors.push("Au moins une composition est requise");
    } else if (Math.abs(totalPct - 100) > 0.5) {
      errors.push(`La composition doit totaliser 100% (actuel : ${totalPct.toFixed(1)}%)`);
    }
    if (variants.length === 0) {
      errors.push("Au moins une variante de couleur est requise");
    } else {
      // Le produit est publiable dès qu'au moins une couleur a une image.
      // Les couleurs sans image seront masquées côté public et ignorées sur
      // les marketplaces (bandeau d'alerte rappelé dans le form).
      const checkedGroupKeys = new Set<string>();
      let anyColorHasImage = false;
      for (const v of variants) {
        const gk = imageGroupKeyFromVariant(v);
        if (checkedGroupKeys.has(gk)) continue;
        checkedGroupKeys.add(gk);
        const ci = colorImages.find((c) => c.groupKey === gk);
        if (ci && ci.imagePreviews.length > 0) anyColorHasImage = true;
      }
      if (!anyColorHasImage && checkedGroupKeys.size > 0) {
        errors.push("Aucune couleur n'a d'image — il en faut au moins une");
      }
      // Variant-level completeness
      for (const v of variants) {
        const label = v.colorName || "variante pack";
        if (!v.colorId)
          errors.push(`Variante "${label}" : couleur non sélectionnée`);
        const w = parseFloat(v.weight);
        if (isNaN(w) || w <= 0)
          errors.push(`Variante "${label}" : poids invalide`);
        const price = parseFloat(v.unitPrice);
        if (isNaN(price) || price <= 0)
          errors.push(`Variante "${label}" : prix/unité invalide`);
        if (v.stock === "" || v.stock === undefined || v.stock === null)
          errors.push(`Variante "${label}" : stock non renseigné`);
        if (variantHasNoSizes(v))
          errors.push(`Variante "${label}" : aucune taille`);
        if (v.saleType === "PACK") {
          const qty = parseInt(v.packQuantity);
          if (isNaN(qty) || qty < 1)
            errors.push(`Variante "${label}" : quantité paquet invalide`);
          for (const se of v.sizeEntries) {
            const seQty = parseInt(se.quantity);
            if (isNaN(seQty) || seQty <= 0)
              errors.push(`Variante "${label}" : quantité invalide pour taille "${se.sizeName}"`);
          }
        }
      }
      // Duplicate check: same color composition + same sale type + same sizes
      const byGroup = new Map<string, boolean>();
      for (const v of variants) {
        const sizeKey = v.sizeEntries.map((se) => se.sizeId).sort().join(",");
        const gk = `${v.saleType}::${variantGroupKeyFromState(v)}::${sizeKey}`;
        if (byGroup.has(gk))
          errors.push(`Variante "${v.colorName}" : doublon (même couleur, type et taille)`);
        byGroup.set(gk, true);
      }
    }
    return errors;
  }

  function isOutOfStock(): boolean {
    const withStock = variants.filter(v => v.stock !== "" && v.stock !== undefined);
    return withStock.length > 0 && withStock.every(v => parseInt(v.stock) === 0);
  }

  // ── Register toggle callbacks for header toggle ──────────────────────
  // Toute action sur le toggle (header) doit marquer un override manuel pour
  // que l'auto-passage en ligne (mode "create") cesse de prendre la main.
  const userManuallyToggledRef = useRef(false);
  const hasAutoSetOnlineRef = useRef(false);
  useEffect(() => {
    registerStatusToggle({
      getCompletenessErrors,
      isOutOfStock,
      setProductStatus: (s) => {
        userManuallyToggledRef.current = true;
        setProductStatus(s);
      },
      setOnlineErrors,
      setError,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerStatusToggle, reference, name, description, categoryId, compositions, variants, colorImages]);

  // ── Auto-passage en ligne en mode création ──────────────────────────
  // Dès que la fiche devient complète (premier passage incomplet → complet),
  // on bascule le toggle sur "ONLINE" automatiquement. On ne le fait qu'une
  // seule fois et on respecte une interaction manuelle de l'utilisatrice
  // (si elle a cliqué le toggle, on lui laisse la main).
  useEffect(() => {
    if (mode !== "create") return;
    if (userManuallyToggledRef.current) return;
    if (hasAutoSetOnlineRef.current) return;
    if (productStatus !== "OFFLINE") return;
    if (getCompletenessErrors().length > 0) return;
    if (isOutOfStock()) return;
    hasAutoSetOnlineRef.current = true;
    setProductStatus("ONLINE");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, productStatus, reference, name, description, categoryId, compositions, variants, colorImages]);

  // Erreurs dures qui doivent bloquer l'enregistrement (même en brouillon)
  function getBlockingErrors(): string[] {
    const errors: string[] = [];
    // En mode création : pays de fabrication, saison et au moins une variante
    // sont obligatoires pour pouvoir enregistrer (même en brouillon).
    if (mode === "create") {
      if (!countryIsoCode) errors.push("Le pays de fabrication est obligatoire");
      if (!seasonId) errors.push("La saison est obligatoire");
      if (variants.length === 0) errors.push("Au moins une variante de couleur est obligatoire");
    }
    // Variantes vides (aucune couleur sélectionnée)
    const emptyCount = variants.filter((v) => !v.colorId).length;
    if (emptyCount > 0) {
      errors.push(
        emptyCount === 1
          ? "Une variante n'a pas de couleur sélectionnée. Veuillez la compléter ou la supprimer."
          : `${emptyCount} variantes n'ont pas de couleur sélectionnée. Veuillez les compléter ou les supprimer.`
      );
    }
    const seen = new Set<string>();
    for (const v of variants) {
      if (!v.colorId) continue;
      const key = buildVariantDuplicateKey(v);
      if (seen.has(key)) {
        const label = isMultiColorPack(v)
          ? `pack multi-couleurs`
          : `${v.saleType} (${v.colorName})`;
        errors.push(`Doublon : deux variantes ${label} ont la même composition`);
      }
      seen.add(key);
    }

    // Blocage inter-couleurs sur mapping PFS/eFashion : deux couleurs
    // différentes du même produit ne peuvent pas partager le même mapping
    // effectif (que ce soit via le mapping principal de la biblio ou via
    // l'override secondaire). Sinon la marketplace recevrait deux fois la
    // même couleur et rejetterait la fiche. Le serveur bloque aussi (filet
    // de sécurité), mais on préfère intercepter côté UI pour éviter
    // l'aller-retour et donner un message précis.
    const pfsMappingItems: VariantColorRefInput[] = [];
    const efaMappingItems: EfashionVariantColorRefInput[] = [];
    for (const v of variants) {
      if (v.saleType === "PACK" && v.packLines.length > 0) {
        for (const pl of v.packLines) {
          const ac = localColors.find((c) => c.id === pl.colorId);
          pfsMappingItems.push({
            key: `v${v.tempId}-pl${pl.tempId}`,
            colorId: pl.colorId || null,
            label: pl.colorName || ac?.name || "Couleur",
            principalRef: ac?.pfsColorRef ?? null,
            overrideRef: pl.pfsColorRefOverride ?? null,
          });
          efaMappingItems.push({
            key: `v${v.tempId}-pl${pl.tempId}`,
            colorId: pl.colorId || null,
            label: pl.colorName || ac?.name || "Couleur",
            principalId: ac?.efashionColorId ?? null,
            overrideId: pl.efashionColorIdOverride ?? null,
          });
        }
      } else if (v.colorId) {
        const ac = localColors.find((c) => c.id === v.colorId);
        pfsMappingItems.push({
          key: `v${v.tempId}`,
          colorId: v.colorId,
          label: v.colorName || ac?.name || "Couleur",
          principalRef: ac?.pfsColorRef ?? null,
          overrideRef: v.pfsColorRefOverride ?? null,
        });
        efaMappingItems.push({
          key: `v${v.tempId}`,
          colorId: v.colorId,
          label: v.colorName || ac?.name || "Couleur",
          principalId: ac?.efashionColorId ?? null,
          overrideId: v.efashionColorIdOverride ?? null,
        });
      }
    }
    if (hasPfsConfig) {
      const pfsBlocking = detectPfsColorConflicts(pfsMappingItems);
      if (pfsBlocking.length > 0) {
        errors.push(
          formatConflictsMessage(pfsBlocking) +
            " Modifiez le mapping secondaire depuis la section « Mapping Marketplaces ».",
        );
      }
    }
    if (hasEfashionConfig && efashionEnabled) {
      const efaBlocking = detectEfashionColorConflicts(efaMappingItems);
      if (efaBlocking.length > 0) {
        errors.push(
          formatEfashionConflictsMessage(efaBlocking) +
            " Modifiez le mapping secondaire depuis la section « Mapping Marketplaces ».",
        );
      }
    }

    return errors;
  }

  // Variante avec prix, poids ou stock manquant → bloque la synchro PFS
  function hasVariantsWithMissingPriceWeightOrStock(): boolean {
    return variants.some(v => {
      const price = parseFloat(v.unitPrice);
      const w = parseFloat(v.weight);
      const stockNotSet = v.stock === "" || v.stock === undefined || v.stock === null;
      const noSizes = variantHasNoSizes(v);
      return (isNaN(price) || price <= 0) || (isNaN(w) || w <= 0) || stockNotSet || noSizes;
    });
  }

  // ── Upload différé des photos en attente ─────────────────────────────
  // Les photos joinies au formulaire restent dans le navigateur (mémoire)
  // tant que l'admin ne clique pas « Enregistrer ». Cette fonction est
  // appelée au moment du save : elle uploade les fichiers pending via
  // l'API existante, met à jour `uploadedPaths` dans le state, et retourne
  // le nouveau ColorImageState[] à utiliser pour bâtir le payload.
  // Lève en cas d'erreur ; le caller affiche le message et bloque le save.
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  async function flushPendingUploads(refForUpload: string): Promise<ColorImageState[]> {
    const totalPending = colorImages.reduce(
      (s, ci) => s + ci.pendingFiles.filter((f) => f !== null).length,
      0,
    );
    if (totalPending === 0) return colorImages;

    // Construit une copie modifiable pour écrire les chemins en place.
    // Important : chaque task connaît son (colorIndex, fileIndex) — on
    // restaure l'ordre quoi qu'il arrive même avec exécution parallèle.
    const next: ColorImageState[] = colorImages.map((ci) => ({
      ...ci,
      uploadedPaths: [...ci.uploadedPaths],
      pendingFiles: [...ci.pendingFiles],
    }));

    type Task = { colorIndex: number; fileIndex: number };
    const tasks: Task[] = [];
    next.forEach((ci, colorIndex) => {
      ci.pendingFiles.forEach((f, fileIndex) => {
        if (f !== null) tasks.push({ colorIndex, fileIndex });
      });
    });

    setUploadProgress({ current: 0, total: totalPending });
    let done = 0;
    const errors: string[] = [];

    // Le serveur ne fait plus la conversion sharp en synchrone : chaque POST
    // retourne en ~100 ms (juste écriture du brut + insert ImageProcessingJob).
    // On peut donc paralléliser sans étouffer la machine. 4 simultanés = bon
    // équilibre : 92 photos en ~3 s côté navigateur, le worker serveur
    // continue tranquillement en arrière-plan ensuite.
    const CONCURRENCY = 4;
    let cursor = 0;
    async function worker() {
      while (cursor < tasks.length && errors.length === 0) {
        const myIndex = cursor++;
        const t = tasks[myIndex];
        const ci = next[t.colorIndex];
        const file = ci.pendingFiles[t.fileIndex];
        if (!file) continue;
        const fd = new FormData();
        fd.append("image", file);
        if (refForUpload) fd.append("reference", refForUpload);
        if (ci.colorName) fd.append("color", ci.colorName);
        if (productId) fd.append("productId", productId);
        fd.append("position", String((ci.orders[t.fileIndex] ?? t.fileIndex) + 1));
        try {
          const res = await fetch("/api/admin/products/images", { method: "POST", body: fd });
          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            errors.push(errJson.error || `Erreur sur une photo de la couleur ${ci.colorName}.`);
            return;
          }
          const json = await res.json();
          ci.uploadedPaths[t.fileIndex] = json.path;
          ci.pendingFiles[t.fileIndex] = null;
          done++;
          setUploadProgress({ current: done, total: totalPending });
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
          return;
        }
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker()),
      );
      if (errors.length > 0) throw new Error(errors[0]);
      setColorImages(next);
      return next;
    } finally {
      setUploadProgress(null);
    }
  }

  // ── Save as draft (minimal validation) ───────────────────────────────
  async function handleSaveDraft(navigateTo?: string) {
    if (isSyncLocked) return;
    setError("");
    setOnlineErrors([]);

    // Hard-block: invalid state that DB/server-side also rejects
    const blocking = getBlockingErrors();
    if (blocking.length > 0) return setError(blocking.join(" · "));

    // Auto-generate reference if empty
    const draftRef = reference.trim()
      ? reference.trim().toUpperCase()
      : `BRN-${Date.now().toString(36).toUpperCase()}`;
    const draftName = name.trim() || "Brouillon sans nom";

    // Category is required by DB — if not set, ask user
    if (!categoryId) {
      return setError("Veuillez sélectionner une catégorie avant d'enregistrer en brouillon.");
    }

    // Pré-check unicité de la référence (Next.js prod masque le message des
    // throw remontés depuis la server action, donc on vérifie ici pour pouvoir
    // afficher un message clair).
    try {
      const refCheck = await checkProductReferenceAvailable(draftRef, productId ?? undefined);
      if (!refCheck.available) {
        return setError("Cette référence est déjà utilisée par un autre produit. Choisissez-en une autre.");
      }
    } catch {
      // En cas d'erreur de la vérification elle-même, on laisse passer : le
      // throw côté createProduct/updateProduct fera office de filet.
    }

    // ── Téléversement des photos en attente (avant le save) ───────────
    // Les photos joinies au formulaire sont uploadées maintenant, en une
    // seule passe. En cas d'erreur, on bloque le save (les photos déjà
    // uploadées sont conservées dans le state pour un éventuel retry).
    let resolvedColorImages: ColorImageState[];
    try {
      resolvedColorImages = await flushPendingUploads(draftRef);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur lors du téléversement des photos.";
      return setError(msg);
    }

    // Build set of known valid color/size IDs to validate FK references
    const validColorIds = new Set(localColors.map((c) => c.id));
    const validSizeIds = new Set(localSizes.map((s) => s.id));

    // Filter variants: only include those with valid FK references
    const draftVariants = variants.filter((v) => !!v.colorId && validColorIds.has(v.colorId));

    const payload = {
      reference:     draftRef,
      name:          draftName,
      description:   description.trim(),
      categoryId,
      subCategoryIds,
      microstoreSubCategoryId,
      colors: draftVariants.map((v) => {
          const isMultiPack = v.saleType === "PACK" && v.packLines.length > 0;
          const packLinesPayload = isMultiPack
            ? v.packLines
                .filter((line) => line.colorId && validColorIds.has(line.colorId))
                .map((line) => ({
                  colorId: line.colorId,
                  sizeEntries: line.sizeEntries
                    .filter((se) => se.sizeId && validSizeIds.has(se.sizeId))
                    .map((se) => ({ sizeId: se.sizeId, quantity: parseInt(se.quantity) || 1 })),
                }))
            : undefined;
          const totalPackQty = isMultiPack
            ? (packLinesPayload ?? []).reduce((s, l) => s + l.sizeEntries.reduce((a, e) => a + e.quantity, 0), 0)
            : v.sizeEntries.reduce((s, se) => s + (parseInt(se.quantity) || 1), 0);
          return {
            dbId:          v.dbId,
            colorId:       v.colorId || null,
            unitPrice:     v.saleType === "PACK" ? (computeTotalPrice(v) ?? 0) : (parseFloat(v.unitPrice) || 0),
            weight:        parseFloat(v.weight) || 0,
            stock:         parseInt(v.stock) || 0,
            isPrimary:     v.isPrimary,
            saleType:      v.saleType,
            packQuantity:  v.saleType === "PACK" ? (totalPackQty || 1) : null,
            sizeEntries:   isMultiPack
              ? []
              : v.sizeEntries
                  .filter((se) => se.sizeId && validSizeIds.has(se.sizeId))
                  .map((se) => ({ sizeId: se.sizeId, quantity: parseInt(se.quantity) || 1 })),
            packLines:     packLinesPayload,
            disabled:      v.disabled ?? false,
          };
        }),
      discountPercent: discountPercent ? parseFloat(String(discountPercent)) : null,
      // Refonte : 1 entrée d'images par couleur du produit (productId × colorId).
      // Fini la duplication par variante.
      imagePaths: resolvedColorImages.flatMap((ci) => {
        const realPaths = ci.uploadedPaths.filter((p) => p && p.length > 0);
        if (realPaths.length === 0) return [];
        if (!ci.colorId || !validColorIds.has(ci.colorId)) return [];
        return [{
          colorId: ci.colorId,
          paths: realPaths,
          orders: ci.orders.filter((_, i) => ci.uploadedPaths[i] && ci.uploadedPaths[i].length > 0),
        }];
      }),
      primaryColorId,
      compositions: compositions.map((c) => ({
        compositionId: c.compositionId,
        percentage:    parseFloat(c.percentage) || 0,
      })),
      similarProductIds,
      bundleChildIds,
      tagNames,
      isBestSeller,
      status: "OFFLINE" as const,
      isIncomplete: true,
      dimensionLength:        dimLength        ? parseFloat(dimLength)        : null,
      dimensionWidth:         dimWidth         ? parseFloat(dimWidth)         : null,
      dimensionHeight:        dimHeight        ? parseFloat(dimHeight)        : null,
      dimensionDiameter:      dimDiameter      ? parseFloat(dimDiameter)      : null,
      dimensionCircumference: dimCircumference ? parseFloat(dimCircumference) : null,
      hsCodeId: hsCodeId || null,
      countryIsoCode: countryIsoCode || null,
      seasonId: seasonId || null,
      sizeDetailsTu: sizeDetailsTu.trim() || null,
      translations: Object.entries(translations)
        .filter(([, t]) => t.name.trim() || t.description.trim())
        .map(([locale, t]) => ({ locale, name: t.name, description: t.description })),
    };

    showLoading();
    startTransition(async () => {
      try {
        if (productId) {
          await updateProduct(productId, payload);
        } else {
          await createProduct(payload);
        }
        isDirty.current = false;
        if (navigateTo) {
          router.push(navigateTo);
        } else {
          router.push("/admin/produits");
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Une erreur est survenue lors de l'enregistrement du brouillon.");
      } finally {
        hideLoading();
      }
    });
  }

  // ── Submit ───────────────────────────────────────────────────────────
  async function handleSave() {
    if (isSyncLocked) return;
    setError("");
    setOnlineErrors([]);

    // Hard-block: invalid state that DB/server-side also rejects
    const blocking = getBlockingErrors();
    if (blocking.length > 0) return setError(blocking.join(" · "));

    // Compute completeness
    const completenessErrors = getCompletenessErrors();
    // In edit mode, never downgrade to draft — only block going ONLINE.
    // Draft mode (mode="create") uses isIncomplete to track true draft state.
    const isIncomplete = mode === "create" ? completenessErrors.length > 0 : false;

    let downgradeConfirmed = false;
    if (productStatus === "ONLINE" && completenessErrors.length > 0) {
      const okDowngrade = await confirmDialog({
        type: "warning",
        title: "Mise hors ligne",
        message: "Ce produit est actuellement en ligne mais certaines informations sont manquantes. Si vous confirmez, le produit sera mis hors ligne.",
        confirmLabel: "Enregistrer et mettre hors ligne",
        cancelLabel: "Annuler",
      });
      if (!okDowngrade) return;
      downgradeConfirmed = true;
    }

    // Depuis 2026-08-07 : plus d'avertissement rupture totale ni de bascule
    // auto OFFLINE. Le statut choisi par l'admin est appliqué tel quel — un
    // produit peut rester ONLINE avec toutes ses variantes à 0.

    const finalStatus = downgradeConfirmed ? "OFFLINE" : productStatus;

    // Minimal validation: DB non-nullable constraints
    if (!reference.trim()) return setError("La référence est requise.");

    // Re-check PFS avant de soumettre, uniquement si la référence a changé
    // (création OU renommage). Pour une simple mise à jour du produit existant
    // — par exemple passer en hors ligne — pas la peine de vérifier l'unicité
    // sur PFS, ça bloquait à tort dès que le mapping pfsProductId local n'était
    // pas connu (BDD locale dé-sync de la prod).
    const initialRef = initialData?.reference?.trim().replace(/\s/g, "").toUpperCase() ?? "";
    const submittedRef = reference.trim().replace(/\s/g, "").toUpperCase();
    const referenceChanged = !initialRef || initialRef !== submittedRef;
    if (referenceChanged) {
      // Pré-check unicité locale (Next.js prod masque le message des throw
      // remontés depuis la server action, donc on vérifie ici).
      try {
        const refCheck = await checkProductReferenceAvailable(submittedRef, productId ?? undefined);
        if (!refCheck.available) {
          setError("Cette référence est déjà utilisée par un autre produit. Choisissez-en une autre.");
          return;
        }
      } catch {
        // Filet : le throw côté createProduct/updateProduct reste actif.
      }

      const pfsCheck = await runPfsRefCheck(reference, { force: true });
      if (pfsCheck === "exists") {
        setError("Cette référence est déjà utilisée sur Paris Fashion Shop. Choisissez-en une autre.");
        return;
      }
    }

    if (!name.trim()) return setError("Le nom est requis.");
    if (!categoryId) return setError("Veuillez choisir une catégorie.");
    if (hasTailleUnique && !sizeDetailsTu.trim()) {
      return setError(
        "Le champ « Détail taille unique » est obligatoire quand une variante utilise la taille unique."
      );
    }

    // ── Integrity check (edit mode): detect corrupted state before sending ──
    // Removing all variants is allowed when saving as OFFLINE (product without variants).
    if (productId && initialData) {
      const issues: string[] = [];
      const allVariantsRemoved = initialData.variants.length > 0 && variants.length === 0;
      if (allVariantsRemoved && finalStatus !== "OFFLINE") {
        issues.push("Toutes les variantes ont disparu");
      }
      if (initialData.categoryId && !categoryId) {
        issues.push("La catégorie a disparu");
      }
      if (issues.length > 0) {
        return setError(
          `Erreur d'intégrité détectée (${issues.join(", ")}). Rechargez la page et réessayez.`
        );
      }

      // Remplacement complet des variantes : l'utilisatrice a supprimé toutes
      // les anciennes et ajouté de nouvelles (cas légitime, ex : passer de
      // packs à variantes à l'unité). On demande confirmation au lieu de
      // bloquer, car ça peut aussi être un bug silencieux d'état React.
      const fullVariantReplacement =
        initialData.variants.length > 0 &&
        variants.length > 0 &&
        variants.every((v) => !v.dbId);
      if (fullVariantReplacement) {
        const okReplace = await confirmDialog({
          type: "warning",
          title: "Remplacement complet des variantes",
          message:
            "Toutes les variantes d'origine vont être supprimées et remplacées par les nouvelles. Cette action est irréversible. Voulez-vous continuer ?",
          confirmLabel: "Remplacer les variantes",
          cancelLabel: "Annuler",
        });
        if (!okReplace) return;
      }
    }

    // ── Confirmation dialog: save? (skip if downgrade was already confirmed) ──
    if (!downgradeConfirmed) {
      // Build confirmation message for draft finalization
      let confirmMessage: string;
      let confirmType: "info" | "warning" = "info";
      let confirmTitle = "Enregistrer les modifications";
      let confirmLabel = "Enregistrer";

      if (isIncomplete) {
        confirmMessage = "Des informations sont manquantes. Le produit sera enregistré en tant que brouillon. Voulez-vous continuer ?";
      } else if (mode === "create" && productId) {
        confirmTitle = "Finaliser le produit";
        confirmLabel = "Finaliser";
        confirmMessage = "Voulez-vous finaliser ce produit ?";
      } else {
        confirmMessage = "Voulez-vous enregistrer toutes les modifications ?";
      }

      const okSave = await confirmDialog({
        type: confirmType,
        title: confirmTitle,
        message: confirmMessage,
        confirmLabel,
        cancelLabel: "Annuler",
      });
      if (!okSave) return;
    }

    // ── Téléversement des photos en attente (avant le save) ───────────
    // Les photos joinies au formulaire sont uploadées maintenant, en une
    // seule passe. En cas d'erreur, on bloque le save (les photos déjà
    // uploadées sont conservées dans le state pour un éventuel retry).
    let resolvedColorImages: ColorImageState[];
    try {
      resolvedColorImages = await flushPendingUploads(reference.trim().toUpperCase());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur lors du téléversement des photos.";
      return setError(msg);
    }

    const payload = {
      reference:     reference.trim().toUpperCase(),
      name:          name.trim(),
      description:   description.trim(),
      categoryId,
      subCategoryIds,
      microstoreSubCategoryId,
      colors: variants.map((v) => {
        const isMultiPack = v.saleType === "PACK" && v.packLines.length > 0;
        const packLinesPayload = isMultiPack
          ? v.packLines
              .filter((line) => line.colorId)
              .map((line) => ({
                colorId: line.colorId,
                pfsColorRefOverride: line.pfsColorRefOverride ?? null,
                efashionColorIdOverride: line.efashionColorIdOverride ?? null,
                ankorsColorNameOverride: line.ankorsColorNameOverride ?? null,
                faireColorNameOverride: line.faireColorNameOverride ?? null,
                sizeEntries: line.sizeEntries
                  .filter((se) => se.sizeId)
                  .map((se) => ({ sizeId: se.sizeId, quantity: parseInt(se.quantity) || 1 })),
              }))
          : undefined;
        const totalPackQty = isMultiPack
          ? (packLinesPayload ?? []).reduce((s, l) => s + l.sizeEntries.reduce((a, e) => a + e.quantity, 0), 0)
          : v.sizeEntries.reduce((s, se) => s + (parseInt(se.quantity) || 1), 0);
        return {
          dbId:          v.dbId,
          colorId:       v.colorId || null,
          unitPrice:     v.saleType === "PACK" ? (computeTotalPrice(v) ?? 0) : (parseFloat(v.unitPrice) || 0),
          weight:        parseFloat(v.weight) || 0,
          stock:         parseInt(v.stock) || 0,
          isPrimary:     v.isPrimary,
          saleType:      v.saleType,
          packQuantity:  v.saleType === "PACK" ? (totalPackQty || 1) : null,
          sizeEntries:   isMultiPack
            ? []
            : v.sizeEntries
                .filter((se) => se.sizeId)
                .map((se) => ({
                  sizeId:       se.sizeId,
                  quantity:     parseInt(se.quantity) || 1,
                })),
          packLines:     packLinesPayload,
          disabled:      v.disabled ?? false,
          pfsColorRefOverride: v.pfsColorRefOverride ?? null,
          efashionColorIdOverride: v.efashionColorIdOverride ?? null,
          ankorsColorNameOverride: v.ankorsColorNameOverride ?? null,
          faireColorNameOverride: v.faireColorNameOverride ?? null,
        };
      }),
      discountPercent: discountPercent ? parseFloat(String(discountPercent)) : null,
      // Refonte : 1 entrée d'images par couleur du produit (productId × colorId).
      // Fini la duplication par variante.
      imagePaths: resolvedColorImages.flatMap((ci) => {
        const realPaths = ci.uploadedPaths.filter((p) => p && p.length > 0);
        if (realPaths.length === 0) return [];
        if (!ci.colorId) return [];
        return [{
          colorId: ci.colorId,
          paths: realPaths,
          orders: ci.orders.filter((_, i) => ci.uploadedPaths[i] && ci.uploadedPaths[i].length > 0),
        }];
      }),
      primaryColorId,
      compositions: compositions.map((c) => ({
        compositionId: c.compositionId,
        percentage:    parseFloat(c.percentage) || 0,
      })),
      similarProductIds,
      bundleChildIds,
      tagNames,
      isBestSeller,
      status: finalStatus,
      isIncomplete,
      dimensionLength:        dimLength        ? parseFloat(dimLength)        : null,
      dimensionWidth:         dimWidth         ? parseFloat(dimWidth)         : null,
      dimensionHeight:        dimHeight        ? parseFloat(dimHeight)        : null,
      dimensionDiameter:      dimDiameter      ? parseFloat(dimDiameter)      : null,
      dimensionCircumference: dimCircumference ? parseFloat(dimCircumference) : null,
      hsCodeId: hsCodeId || null,
      countryIsoCode: countryIsoCode || null,
      seasonId: seasonId || null,
      sizeDetailsTu: sizeDetailsTu.trim() || null,
      translations: Object.entries(translations)
        .filter(([, t]) => t.name.trim() || t.description.trim())
        .map(([locale, t]) => ({ locale, name: t.name, description: t.description })),
    };

    // Snapshot AVANT save : si les seuls champs touchés depuis l'ouverture sont
    // locaux (mots-clés, sous-catégories, produits similaires, contenu de
    // l'ensemble), on saute la modale "Pousser aux marketplaces" car aucun
    // champ pertinent pour PFS/Ankorstore/eFashion n'a bougé. Cf. demande
    // utilisatrice : on ne dérange plus pour ces 4 champs locaux.
    const marketplaceFieldsChanged =
      initialMarketplaceSnapshot.current === null
      || buildMarketplaceSnapshot() !== initialMarketplaceSnapshot.current;

    // Détection « seule la sous-catégorie Microstore a changé » :
    // - le snapshot marketplace complet a bougé (marketplaceFieldsChanged),
    // - mais le snapshot marketplace SANS microstoreSubCategoryId est resté
    //   identique → aucun autre champ marketplace n'a bougé, donc PFS/Ankor/
    //   eFa/Faire n'ont rien à recevoir. On ne proposera que Microstore.
    const nonMicrostoreFieldsChanged =
      initialMarketplaceSnapshotExcludingMicrostore.current === null
      || buildMarketplaceSnapshotExcludingMicrostore()
        !== initialMarketplaceSnapshotExcludingMicrostore.current;
    const onlyMicrostoreFieldChanged =
      marketplaceFieldsChanged && !nonMicrostoreFieldsChanged;

    showLoading();
    startTransition(async () => {
      let savedProductId: string | null = null;
      let shouldRedirectAfterSave: string | null = null;
      try {
        if (productId) {
          const result = await updateProduct(productId, payload);
          savedProductId = productId;
          if (mode === "create") {
            isDirty.current = false;
            shouldRedirectAfterSave = `/admin/produits/${productId}/modifier`;
          } else {
            // Update local variant state with DB IDs so newly created
            // variants become locked immediately (no page reload needed).
            const dbIds = result.variantDbIds;
            if (dbIds.length === variants.length) {
              setVariants((prev) =>
                prev.map((v, i) => v.dbId ? v : { ...v, dbId: dbIds[i] })
              );
            }
          }
        } else {
          const result = await createProduct(payload);
          if (result?.id) {
            savedProductId = result.id;
            shouldRedirectAfterSave = `/admin/produits/${result.id}/modifier`;
          }
        }
        if (!shouldRedirectAfterSave) {
          setProductStatus(finalStatus);
          // Save réussi : on nettoie les images des couleurs orphelines (couleurs
          // supprimées avant Save et non ré-ajoutées) — la BDD les a déjà purgées,
          // on aligne l'état local pour qu'il ne traîne pas ces orphelines en
          // mémoire (sinon une suppression + ré-ajout d'une couleur dans une
          // session future pourrait restaurer par erreur ces images).
          const validColorIdsAfterSave = new Set<string>();
          for (const v of variants) {
            if (isMultiColorPack(v)) {
              for (const c of packLinesColorList(v.packLines)) validColorIdsAfterSave.add(c.colorId);
            } else if (v.colorId) {
              validColorIdsAfterSave.add(v.colorId);
            }
          }
          const filteredColorImages = colorImages.filter(
            (ci) => !ci.colorId || validColorIdsAfterSave.has(ci.colorId),
          );
          setColorImages(filteredColorImages);
          // Si la couleur principale pointait vers une entrée orpheline qui
          // vient d'être filtrée, on la réaligne DANS LA MÊME PASSE. Sinon
          // l'effet `[colorImages, primaryColorId]` la réassigne au render
          // suivant, ce qui casse le snapshot post-save (déjà pris) et
          // réactive le bouton « Enregistrer les modifications ».
          const availableColorIdsAfterFilter = filteredColorImages
            .map((ci) => ci.colorId)
            .filter((id): id is string => !!id);
          const resolvedPrimary = resolvePrimaryColorId(primaryColorId, availableColorIdsAfterFilter);
          if (resolvedPrimary !== primaryColorId) {
            setPrimaryColorId(resolvedPrimary);
          }
          // ⚠️ Ne PAS prendre le snapshot ici : les setVariants /
          // setColorImages / setProductStatus qu'on vient d'appeler ne sont
          // pas encore appliqués au render, donc buildSnapshot capturerait
          // l'ancien état. On délègue au useEffect dédié qui voit le render
          // suivant (cf. pendingSnapshotResetRef).
          pendingSnapshotResetRef.current = true;
          isDirty.current = false;
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Une erreur est survenue.");
        hideLoading();
        return;
      } finally {
        hideLoading();
      }

      // ── Proposer la publication / mise à jour sur Paris Fashion Shop ──
      // - Déjà publié sur PFS → proposer "Mettre à jour"
      // - Pas encore publié + ONLINE + complet → proposer "Publier (en ligne sur PFS)"
      // - Pas encore publié + OFFLINE + complet → proposer "Publier (en brouillon sur PFS)"
      const alreadyOnPfs = !!initialData?.pfsProductId;
      const alreadyOnAnkorstore = !!initialData?.ankorsProductId;
      const alreadyOnEfashion = !!initialData?.efashionReferenceBase;
      const alreadyOnFaire = !!initialData?.faireProductId;
      const showAnkorstore = hasAnkorstoreConfig && ankorstoreEnabled;
      const showEfashion = hasEfashionConfig && efashionEnabled;
      const showFaire = hasFaireConfig && faireEnabled;
      // Microstore : contrairement aux 4 autres marketplaces, il n'y a pas de
      // notion « déjà lié » (upsert par référence + pas d'upload photo). La
      // case doit apparaître dès qu'on modifie une info clé si Microstore est
      // configuré et activé pour le produit, même sur un tout premier push.
      const showMicrostore =
        hasMicrostoreConfig && (initialData?.microstoreEnabledForProduct ?? true);

      // La popup marketplace s'affiche aussi pour le passage en ARCHIVED
      // (Ankorstore : on envoie stock 0 → produit non commandable, équivalent
      //  "hors ligne" — leur API n'a pas de vraie archive côté produit).
      //
      // ⚠️ Demande cliente : ne PAS proposer la modale tant qu'aucune
      // marketplace n'est liée. La 1ʳᵉ publication PFS/Ankor/eFa/Faire doit
      // être déclenchée explicitement depuis le badge marketplace de la fiche.
      // Exception Microstore : upsert direct, on ouvre la modale même sur un
      // premier push tant que Microstore est configuré.
      const anyMarketplaceLinked =
        alreadyOnPfs ||
        alreadyOnAnkorstore ||
        alreadyOnEfashion ||
        alreadyOnFaire ||
        showMicrostore;
      const canPublish =
        savedProductId &&
        !isIncomplete &&
        (hasPfsConfig || showAnkorstore || showEfashion || showFaire || showMicrostore) &&
        anyMarketplaceLinked &&
        // Garde-fou ergonomique : si seuls des champs locaux ont changé (mots-
        // clés, sous-catégories, produits similaires, contenu de l'ensemble),
        // on n'affiche pas la modale — rien à pousser aux marketplaces.
        marketplaceFieldsChanged;

      if (canPublish && savedProductId) {
        // ── Détection des conflits de mapping PFS sur les variantes saisies ──
        // Si conflit, la case PFS est filtrée (impossible de publier tant que ce
        // n'est pas résolu) et un toast explicatif est affiché à la place.
        const pfsConflictItems: { key: string; colorId: string | null; label: string; principalRef: string | null; overrideRef: string | null }[] = [];
        for (const v of variants) {
          if (v.saleType === "PACK" && v.packLines.length > 0) {
            for (const pl of v.packLines) {
              const ac = localColors.find((c) => c.id === pl.colorId);
              pfsConflictItems.push({
                key: `v${v.tempId}-pl${pl.tempId}`,
                colorId: pl.colorId || null,
                label: pl.colorName || ac?.name || "Couleur",
                principalRef: ac?.pfsColorRef ?? null,
                overrideRef: pl.pfsColorRefOverride ?? null,
              });
            }
          } else {
            const ac = localColors.find((c) => c.id === v.colorId);
            pfsConflictItems.push({
              key: `v${v.tempId}`,
              colorId: v.colorId || null,
              label: v.colorName || ac?.name || "Couleur",
              principalRef: ac?.pfsColorRef ?? null,
              overrideRef: v.pfsColorRefOverride ?? null,
            });
          }
        }
        const pfsConflicts = detectPfsColorConflicts(pfsConflictItems);
        const hasPfsConflict = pfsConflicts.length > 0;

        // Miroir eFashion : même logique de collision entre couleurs différentes
        // qui partagent le même mapping eFashion effectif.
        const efashionConflictItems: { key: string; colorId: string | null; label: string; principalId: number | null; overrideId: number | null }[] = [];
        for (const v of variants) {
          if (v.saleType === "PACK" && v.packLines.length > 0) {
            for (const pl of v.packLines) {
              const ac = localColors.find((c) => c.id === pl.colorId);
              efashionConflictItems.push({
                key: `v${v.tempId}-pl${pl.tempId}`,
                colorId: pl.colorId || null,
                label: pl.colorName || ac?.name || "Couleur",
                principalId: ac?.efashionColorId ?? null,
                overrideId: pl.efashionColorIdOverride ?? null,
              });
            }
          } else {
            const ac = localColors.find((c) => c.id === v.colorId);
            efashionConflictItems.push({
              key: `v${v.tempId}`,
              colorId: v.colorId || null,
              label: v.colorName || ac?.name || "Couleur",
              principalId: ac?.efashionColorId ?? null,
              overrideId: v.efashionColorIdOverride ?? null,
            });
          }
        }
        const efashionConflicts = detectEfashionColorConflicts(efashionConflictItems);
        const hasEfashionConflict = efashionConflicts.length > 0;

        const isArchivingNow = finalStatus === "ARCHIVED";

        // Signale les conflits mapping via setError : la case correspondante
        // n'apparaîtra pas dans la modale, mais la cliente doit savoir qu'un
        // mapping bloque une future publication.
        if (hasPfsConfig && hasPfsConflict) {
          setError(
            "Publication PFS bloquée — " +
              formatConflictsMessage(pfsConflicts) +
              " Définissez un mapping secondaire différent dans la section « Mapping Paris Fashion Shop ».",
          );
        }
        if (showEfashion && hasEfashionConflict) {
          setError(
            "Publication eFashion bloquée — " +
              formatEfashionConflictsMessage(efashionConflicts) +
              " Définissez un mapping secondaire différent dans la section « Mapping eFashion ».",
          );
        }

        // On ne propose que les marketplaces déjà liées — la 1ʳᵉ publication
        // passe par le badge de la fiche, jamais par la modale de save.
        // Cas particulier : si SEULE la sous-catégorie Microstore a changé
        // (onlyMicrostoreFieldChanged), on masque PFS/Ankor/eFa/Faire — ces
        // marketplaces ignorent ce champ, aucune raison de les proposer.
        const showPfsCase = !onlyMicrostoreFieldChanged && hasPfsConfig && !hasPfsConflict && alreadyOnPfs;
        const showAnkorstoreCase = !onlyMicrostoreFieldChanged && showAnkorstore && alreadyOnAnkorstore;
        const showEfashionCase =
          !onlyMicrostoreFieldChanged && showEfashion && !hasEfashionConflict && alreadyOnEfashion;
        const showFaireCase = !onlyMicrostoreFieldChanged && showFaire && alreadyOnFaire;
        // Microstore : pas de contrainte « déjà lié », voir showMicrostore.
        // En brouillon (produit OFFLINE), on ne propose pas le push Microstore —
        // un produit encore hors ligne n'a rien à faire sur le point de vente.
        const showMicrostoreCase = showMicrostore && finalStatus !== "OFFLINE";

        if (
          showPfsCase ||
          showAnkorstoreCase ||
          showEfashionCase ||
          showFaireCase ||
          showMicrostoreCase
        ) {
          // Boucle : les flags syncRequired sont déjà posés par updateProduct.
          // Si la cliente annule, on lui confirme que le badge orange va
          // s'afficher et lui laisse la porte pour revenir au choix.
          let options: Awaited<ReturnType<typeof askMarketplaceOptions>> = null;
          while (true) {
            options = await askMarketplaceOptions({
              count: 1,
              firstProductName: payload.name,
              productIds: [savedProductId],
              showPfs: showPfsCase,
              showAnkorstore: showAnkorstoreCase,
              showEfashion: showEfashionCase,
              showFaire: showFaireCase,
              showMicrostore: showMicrostoreCase,
              showBoutique: false,
              defaultAllChecked: true,
              title: isArchivingNow
                ? "Propager l'archivage aux marketplaces ?"
                : "Publier sur les marketplaces ?",
              subtitle: isArchivingNow
                ? "Cochez les marketplaces où mettre le produit hors ligne."
                : "Cochez les marketplaces où renvoyer les modifications.",
              eyebrow: isArchivingNow ? "Archivage" : "Publier",
              confirmLabel: isArchivingNow ? "Propager" : "Publier",
              actionLabel: isArchivingNow ? "archiver" : "publier",
              actionMode: isArchivingNow ? "archive" : "update",
            });
            if (options) break;
            const keepPending = await confirmDialog({
              type: "info",
              title: "Ne pas propager pour l'instant ?",
              message:
                "Vos modifications restent enregistrées côté boutique. Les marketplaces liées " +
                "afficheront un badge orange « Synchronisation nécessaire » pour que vous puissiez " +
                "pousser plus tard en cliquant sur ce badge.",
              confirmLabel: "Oui, je pousserai plus tard",
              cancelLabel: "Revenir au choix",
            });
            if (keepPending) break;
          }

          if (options) {
            // Utilise les paths résolus après upload (le state setColorImages
            // n'est peut-être pas encore rejoué) et ignore les slots restés vides.
            const firstImagePath =
              resolvedColorImages[0]?.uploadedPaths.find(
                (p) => p && p.length > 0,
              ) ?? null;
            const inputs: Parameters<typeof enqueuePublish>[0] = [];
            if (options.pfs) {
              inputs.push({
                productId: savedProductId,
                reference: payload.reference,
                productName: payload.name,
                firstImage: firstImagePath,
                options: { local: false, pfs: true },
                mode: "publish",
                marketplace: "pfs",
              });
            }
            if (options.ankorstore) {
              inputs.push({
                productId: savedProductId,
                reference: payload.reference,
                productName: payload.name,
                firstImage: firstImagePath,
                options: { local: false, pfs: false, ankorstore: true },
                mode: "publish",
                marketplace: "ankorstore",
              });
            }
            if (options.efashion) {
              // alreadyOnEfashion garanti par showEfashionCase → update direct
              // (pas de ticket de shooting côté eFashion sur une fiche déjà liée).
              inputs.push({
                productId: savedProductId,
                reference: payload.reference,
                productName: payload.name,
                firstImage: firstImagePath,
                options: { local: false, pfs: false, ankorstore: false, efashion: true },
                mode: "publish",
                marketplace: "efashion",
              });
            }
            if (options.faire) {
              inputs.push({
                productId: savedProductId,
                reference: payload.reference,
                productName: payload.name,
                firstImage: firstImagePath,
                options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
                mode: "publish",
                marketplace: "faire",
              });
            }
            if (inputs.length > 0) enqueuePublish(inputs);

            // Microstore : hors queue (sync direct sur l'API upsert). Fire
            // and forget avec toast — l'API prend ~500 ms et la modale reste
            // fermée pendant ce temps.
            if (options.microstore) {
              // Nudge le widget « Photos Microstore » : le push produit
              // synchrone (~500 ms) enchaîne un fire-and-forget photos qui
              // dure ~5 s. Sans nudge, le poll idle 60 s rate la fenêtre.
              nudgeWidget("microstore-upload");
              const { pushProductToMicrostore } = await import(
                "@/app/actions/admin/microstore-products"
              );
              void pushProductToMicrostore(savedProductId).then((res) => {
                if (res.success) {
                  toast.success("Fiche mise à jour sur Microstore");
                } else {
                  toast.error(
                    "Envoi Microstore échoué",
                    res.error ?? "Erreur inconnue.",
                  );
                }
              });
            }
          }
        }
      }

      if (shouldRedirectAfterSave) {
        // Draft finalization: we're already on /admin/produits/{id}/modifier
        // and need the server to re-render (isDraft recalculated from DB).
        // router.push to the same URL may serve stale cached data, so use refresh.
        if (productId && mode === "create") {
          router.refresh();
        } else {
          router.push(shouldRedirectAfterSave);
        }
      }
    });
  }

  const isProductComplete = useMemo(
    () => computeChecklist(checklistInput).every((it) => it.done),
    [checklistInput]
  );

  return (
    <>
      <div className="xl:grid xl:grid-cols-[240px_minmax(0,1fr)] xl:gap-6 xl:items-start">
        <ProductFormNav
          checklistInput={checklistInput}
          productStatus={productStatus}
          hasUnsavedChanges={hasUnsavedChanges}
          mode={mode}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
      <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="min-w-0 space-y-4">
      <ProductFormSectionPicker
        checklistInput={checklistInput}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />
      {/*
        Verrou pendant l'upload des photos : le `<fieldset disabled>` propage
        l'état à TOUS les champs internes (HTML natif), pas seulement au
        bouton « Enregistrer ». Sans ça, l'admin pouvait modifier le stock /
        prix / etc. pendant que le téléversement tournait — les modifs étaient
        ensuite écrasées par l'état pris au clic du bouton et donc perdues.
        `min-w-0` évite la largeur minimale intrinsèque du fieldset.
      */}
      <fieldset
        disabled={uploadProgress !== null}
        className={`space-y-8 min-w-0 border-0 p-0 m-0 ${uploadProgress !== null ? "opacity-60" : ""}`}
      >

        {/* ── Informations du produit ── */}
        <div className="space-y-4">

          {/* Row 1 : chaque bloc (Général / Catégorie / Mots-clés) est un panel dédié */}
          <div id="section-info" hidden={!(["general","cat","tags"] as const).some((k) => k === activeSection)} className="space-y-4">

            {/* ── BLOC GÉNÉRAL ── */}
            <div hidden={activeSection !== "general"} className="bg-bg-primary border border-border rounded-2xl p-6 space-y-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <PanelHeader
                title="Général"
                subtitle="Nom, référence et description qui apparaissent partout."
              />
              {/* Header: langue tabs + bouton IA */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 flex flex-wrap items-center gap-2">
                  <LocaleTabs
                    locales={VALID_LOCALES}
                    activeLocale={activeLocale}
                    localeLabels={LOCALE_LABELS}
                    onChange={setActiveLocale}
                    filledLocales={filledLocales}
                    missingDbLocales={missingDbLocales}
                  />
                  <span className="text-[11px] text-text-muted font-body whitespace-nowrap">
                    {filledLocales.size} / {VALID_LOCALES.length} langue{filledLocales.size > 1 ? "s" : ""} remplie{filledLocales.size > 1 ? "s" : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleTranslateAll}
                  disabled={translateLoading || (!name.trim() && !description.trim())}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary hover:bg-[#E5E5E5] text-text-primary border border-border text-xs font-medium rounded-lg transition-colors disabled:opacity-50 font-body shrink-0"
                >
                  {translateLoading ? (
                    <span className="w-3.5 h-3.5 border-2 border-[#1A1A1A]/30 border-t-[#1A1A1A] rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802" />
                    </svg>
                  )}
                  Tout traduire
                </button>
              </div>

              {translateError && (
                <p className="text-xs text-[#DC2626] font-body bg-[#FEF2F2] px-3 py-2 rounded-lg">
                  {translateError}
                </p>
              )}
              {translateSuccess && (
                <p className="text-xs text-[#15803D] font-body bg-[#F0FDF4] px-3 py-2 rounded-lg">
                  {translateSuccess}
                </p>
              )}

              {/* Mini légende : ce qui se traduit ou non — toujours visible */}
              <p className="text-[11px] text-text-muted font-body bg-bg-secondary/60 border border-border-light rounded-md px-2.5 py-1.5">
                Seuls le <strong>nom</strong> et la <strong>description</strong> changent selon la langue.
                Les autres champs (catégorie, mots-clés, composition, couleurs…) restent en français.
              </p>

              {/* Référence (always FR, not locale-dependent) */}
              <Field label="Référence produit *" hint="Ex: BJ-COL-001">
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => {
                    const next = e.target.value.replace(/\s/g, "").toUpperCase();
                    setReference(next);
                    if (pfsRefCheckedValueRef.current !== next) {
                      setPfsRefStatus("idle");
                      setPfsRefMessage(null);
                    }
                  }}
                  onBlur={() => {
                    markTouched("reference");
                    void runPfsRefCheck(reference);
                  }}
                  placeholder="BJ-COL-001"
                  className={`field-input${
                    (touchedFields.has("reference") && !reference.trim()) || pfsRefStatus === "exists"
                      ? " field-error"
                      : ""
                  }`}
                  required
                />
                {touchedFields.has("reference") && !reference.trim() && (
                  <p className="text-[11px] text-[#EF4444] mt-1 font-body">La référence est requise.</p>
                )}
                {pfsRefStatus === "checking" && (
                  <p className="text-[11px] text-text-muted mt-1 font-body">Vérification sur Paris Fashion Shop…</p>
                )}
                {pfsRefStatus === "exists" && pfsRefMessage && (
                  <p className="text-[11px] text-[#EF4444] mt-1 font-body">{pfsRefMessage}</p>
                )}
                {pfsRefStatus === "ok" && reference.trim() && (
                  <p className="text-[11px] text-[#15803D] mt-1 font-body">✓ Référence disponible sur Paris Fashion Shop</p>
                )}
                {pfsRefStatus === "error" && pfsRefMessage && (
                  <p className="text-[11px] text-text-muted mt-1 font-body">{pfsRefMessage}</p>
                )}
              </Field>

              {/* Avertissement "traduction manquante" — uniquement quand pertinent */}
              {activeLocale !== "fr" && missingDbLocales?.has(activeLocale) && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 font-body">
                  <span className="text-base leading-none mt-0.5">⚠️</span>
                  <span>
                    <strong>Traduction manquante</strong> — Aucune traduction enregistrée en <strong>{LOCALE_LABELS[activeLocale]}</strong>.
                    Le produit s&apos;affichera en français par défaut pour les visiteurs dans cette langue.
                    Utilisez le bouton &laquo;&nbsp;Générer avec l&apos;IA&nbsp;&raquo; ou remplissez manuellement les champs.
                  </span>
                </div>
              )}

              {/* Nom */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-body font-semibold text-text-secondary">
                    Nom du produit *{activeLocale !== "fr" ? ` (${LOCALE_LABELS[activeLocale]})` : ""}
                  </label>
                </div>
                <input
                  type="text"
                  value={activeName}
                  onChange={(e) => setActiveName(e.target.value)}
                  onBlur={() => { if (activeLocale === "fr") markTouched("name"); }}
                  placeholder={activeLocale === "fr" ? "Collier sautoir doré" : `Nom en ${LOCALE_LABELS[activeLocale]}…`}
                  className={`field-input${activeLocale === "fr" && touchedFields.has("name") && !name.trim() ? " field-error" : ""}`}
                  required={activeLocale === "fr"}
                />
                {activeLocale === "fr" && touchedFields.has("name") && !name.trim() && (
                  <p className="text-[11px] text-[#EF4444] mt-1 font-body">Le nom du produit est requis.</p>
                )}
              </div>

              {/* Code SH douanier — pleine largeur */}
              <div>
                <label className="block text-sm font-body font-semibold text-text-secondary mb-1.5">
                  Code SH douanier
                </label>
                <CustomSelect
                  value={hsCodeId}
                  onChange={(v) => setHsCodeId(v)}
                  options={[
                    { value: "", label: "Aucun" },
                    ...localHsCodes.map((c) => ({
                      value: c.id,
                      label: `${c.code} — ${c.label}`,
                    })),
                  ]}
                  size="md"
                  searchable
                  placeholder="Aucun"
                />
                <button
                  type="button"
                  onClick={() => setHsCodeQuickCreateOpen(true)}
                  className="mt-1 text-xs text-text-primary hover:text-[#000000] font-medium font-body transition-colors cursor-pointer"
                >
                  + Créer un nouveau code SH
                </button>
              </div>

              {/* Description (déplacée ici pour rester dans la card Général) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-body font-semibold text-text-secondary">
                    Description *{activeLocale !== "fr" ? ` (${LOCALE_LABELS[activeLocale]})` : ""}
                  </label>
                  {activeLocale === "fr" && (() => {
                    const refSuffixLen = getAnkorstoreReferenceSuffixLength(reference);
                    const effectiveLen = description.trim().length + refSuffixLen;
                    const tooShort = effectiveLen < DESCRIPTION_MIN_CHARS;
                    return (
                      <span
                        className={`text-[11px] font-body ${tooShort ? "text-[#EF4444]" : "text-text-tertiary"}`}
                        title={refSuffixLen > 0 ? `Inclut ${refSuffixLen} caractères de la ligne « Référence produit : ${reference.trim()} » ajoutée automatiquement.` : undefined}
                      >
                        {effectiveLen} / {DESCRIPTION_MIN_CHARS} min
                      </span>
                    );
                  })()}
                </div>
                <textarea
                  value={activeDescription}
                  onChange={(e) => setActiveDescription(e.target.value)}
                  onBlur={() => { if (activeLocale === "fr") markTouched("description"); }}
                  rows={4}
                  placeholder={activeLocale === "fr" ? "Description commerciale du produit (30 caractères minimum)…" : `Description en ${LOCALE_LABELS[activeLocale]}…`}
                  className={`field-input resize-none${activeLocale === "fr" && (!description.trim() || description.trim().length + getAnkorstoreReferenceSuffixLength(reference) < DESCRIPTION_MIN_CHARS) ? " field-error" : ""}`}
                  required={activeLocale === "fr"}
                />
                {activeLocale === "fr" && touchedFields.has("description") && !description.trim() && (
                  <p className="text-[11px] text-[#EF4444] mt-1 font-body">La description est requise pour la mise en ligne.</p>
                )}
                {activeLocale === "fr" && touchedFields.has("description") && description.trim() && description.trim().length + getAnkorstoreReferenceSuffixLength(reference) < DESCRIPTION_MIN_CHARS && (
                  <p className="text-[11px] text-[#EF4444] mt-1 font-body">Minimum {DESCRIPTION_MIN_CHARS} caractères requis (ligne référence comprise). Actuellement : {description.trim().length + getAnkorstoreReferenceSuffixLength(reference)}.</p>
                )}
              </div>
            </div>

            {/* ── BLOC CATÉGORIE ── */}
            <div hidden={activeSection !== "cat"} className="bg-bg-primary border border-border rounded-2xl p-6 space-y-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <PanelHeader
                title="Catégorie & classement"
                subtitle="Où votre produit apparaîtra sur le site et les marketplaces."
              />

              {/* Catégorie + sous-catégories (always FR) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Catégorie */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-body font-semibold text-text-secondary">Catégorie *</label>
                    <button type="button"
                      onClick={() => setModalType("category")}
                      className="text-xs text-text-primary hover:text-[#000000] font-medium font-body transition-colors"
                    >+ Créer</button>
                  </div>
                  <div className={`relative ${!categoryId ? "rounded-lg ring-1 ring-[#EF4444]" : ""}`}>
                    <CustomSelect
                      value={categoryId}
                      onChange={(v) => { setCategoryId(v); setSubCategoryIds([]); }}
                      options={[
                        { value: "", label: "— Sélectionner —" },
                        ...localCategories.map((cat) => ({ value: cat.id, label: cat.name })),
                      ]}
                      placeholder="— Sélectionner —"
                      loading={!attributesLoaded}
                      emptyMessage="Aucune catégorie n'est créée"
                      searchable
                    />
                    {/* Badge M cyan indiquant que la catégorie principale sert
                        d'étiquette Microstore. Visible dès qu'il existe au moins
                        une sous-catégorie (sinon il n'y a rien à choisir).
                        - Actif (microstoreSubCategoryId === null) → badge cyan plein.
                        - Inactif → badge cyan grisé cliquable pour reset. */}
                    {selectedCategory && subCategories.length > 0 && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setMicrostoreSubCategoryId(null); }}
                        title={
                          microstoreSubCategoryId === null
                            ? "Étiquette Microstore : catégorie principale"
                            : "Cliquer pour utiliser la catégorie principale comme étiquette Microstore"
                        }
                        aria-label="Utiliser la catégorie dans la colonne Microstore"
                        aria-pressed={microstoreSubCategoryId === null}
                        className={`absolute top-1/2 -translate-y-1/2 right-9 z-10 inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[9px] font-extrabold transition-opacity ${
                          microstoreSubCategoryId === null ? "opacity-100" : "opacity-40 hover:opacity-100"
                        }`}
                        style={{
                          background: "linear-gradient(135deg,#0891b2,#22d3ee)",
                        }}
                      >
                        M
                      </button>
                    )}
                  </div>
                </div>

                {/* Sous-catégories */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-body font-semibold text-text-secondary">
                      Sous-catégories
                      {subCategoryIds.length > 0 && (
                        <span className="ml-2 font-normal text-text-muted">({subCategoryIds.length})</span>
                      )}
                    </label>
                    {categoryId && (
                      <button type="button"
                        onClick={() => setModalType("subcategory")}
                        className="text-xs text-text-primary hover:text-[#000000] font-medium font-body transition-colors"
                      >+ Créer</button>
                    )}
                  </div>
                  {!categoryId ? (
                    <p className="text-xs text-text-muted font-body py-2">Sélectionnez d&apos;abord une catégorie.</p>
                  ) : subCategories.length === 0 ? (
                    <p className="text-xs text-text-muted font-body py-2">Aucune sous-catégorie — créez-en une.</p>
                  ) : (
                    <>
                      {/* Menu déroulant : liste UNIQUEMENT les sous-catégories
                          non encore attribuées. Cliquer une option l'ajoute au
                          produit. Aucune n'est attribuée par défaut. */}
                      <CustomSelect
                        value=""
                        onChange={(v) => {
                          if (!v) return;
                          setSubCategoryIds((prev) => (prev.includes(v) ? prev : [...prev, v]));
                        }}
                        options={[
                          { value: "", label: "— Ajouter une sous-catégorie —" },
                          ...subCategories
                            .filter((sub) => !subCategoryIds.includes(sub.id))
                            .map((sub) => ({ value: sub.id, label: sub.name })),
                        ]}
                        placeholder="— Ajouter une sous-catégorie —"
                        emptyMessage="Toutes les sous-catégories sont attribuées"
                        searchable
                      />

                      {/* Sous-catégories attribuées au produit — chips cliquables
                          pour choisir l'étiquette Microstore, avec × pour retirer.
                          Cliquer une chip = définir comme étiquette Microstore
                          (ou la retirer si elle l'était déjà). */}
                      {subCategoryIds.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3 items-start">
                          {subCategories
                            .filter((sub) => subCategoryIds.includes(sub.id))
                            .map((sub) => {
                              const isMicrostoreChoice = microstoreSubCategoryId === sub.id;
                              return (
                                <div key={sub.id} className="relative inline-flex">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setMicrostoreSubCategoryId(isMicrostoreChoice ? null : sub.id)
                                    }
                                    title={
                                      isMicrostoreChoice
                                        ? "Étiquette Microstore active — cliquer pour retomber sur la catégorie principale"
                                        : "Cliquer pour utiliser cette sous-catégorie comme étiquette Microstore"
                                    }
                                    aria-pressed={isMicrostoreChoice}
                                    className={`inline-flex items-center gap-2 pl-3 pr-8 py-1.5 text-sm border rounded-lg transition-colors font-body ${
                                      isMicrostoreChoice
                                        ? "bg-bg-dark text-text-inverse border-[#1A1A1A] ring-2 ring-[#22d3ee] ring-offset-1"
                                        : "bg-bg-dark text-text-inverse border-[#1A1A1A]"
                                    }`}
                                  >
                                    <span>{sub.name}</span>
                                    {isMicrostoreChoice && (
                                      <span
                                        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-extrabold leading-none flex-shrink-0"
                                        style={{
                                          background: "linear-gradient(135deg,#0891b2,#22d3ee)",
                                        }}
                                        aria-hidden
                                      >
                                        M
                                      </span>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleSubCategory(sub.id);
                                    }}
                                    title="Retirer cette sous-catégorie du produit"
                                    aria-label={`Retirer ${sub.name}`}
                                    className="absolute top-1/2 -translate-y-1/2 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/15 hover:bg-white/30 text-white transition-colors"
                                  >
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.8}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </>
                  )}
                  {subCategoryIds.length > 0 && (
                    <p className="text-[11px] text-text-muted font-body mt-2 leading-snug">
                      Cliquez sur une sous-catégorie attribuée pour la choisir comme étiquette envoyée dans la colonne « Catégorie » de Microstore. Le badge <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white text-[7px] font-extrabold align-middle" style={{ background: "linear-gradient(135deg,#0891b2,#22d3ee)" }}>M</span> indique la sous-catégorie active. Sans choix, la catégorie principale est utilisée.
                    </p>
                  )}
                </div>
              </div>

              {/* Pays de fabrication + Saison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Pays de fabrication — figé dans lib/countries.ts (pas d'ajout via UI) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-body font-semibold text-text-secondary">
                      Pays de fabrication{mode === "create" ? " *" : ""}
                    </label>
                  </div>
                  <CustomSelect
                    value={countryIsoCode}
                    onChange={(v) => setCountryIsoCode(v)}
                    options={[
                      { value: "", label: "— Aucun —" },
                      ...localCountries.map((c) => ({
                        value: c.isoCode ?? c.id,
                        label: c.isoCode ? `${c.name} (${c.isoCode})` : c.name,
                        iconUrl: c.isoCode ? countryFlagUrl(c.isoCode) : undefined,
                      })),
                    ]}
                    placeholder="— Aucun —"
                    loading={!attributesLoaded}
                    emptyMessage="Aucun pays configuré"
                    className={mode === "create" && !countryIsoCode ? "field-error" : ""}
                    searchable
                  />
                </div>

                {/* Saison */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-body font-semibold text-text-secondary">
                      Saison{mode === "create" ? " *" : ""}
                    </label>
                    <button type="button"
                      onClick={() => setModalType("season")}
                      className="text-xs text-text-primary hover:text-[#000000] font-medium font-body transition-colors"
                    >+ Créer</button>
                  </div>
                  <CustomSelect
                    value={seasonId}
                    onChange={(v) => setSeasonId(v)}
                    options={[
                      { value: "", label: "— Aucune —" },
                      ...localSeasons.map((s) => ({ value: s.id, label: s.name })),
                    ]}
                    placeholder="— Aucune —"
                    loading={!attributesLoaded}
                    emptyMessage="Aucune saison n'est créée"
                    className={mode === "create" && !seasonId ? "field-error" : ""}
                    searchable
                  />
                </div>
              </div>

            </div>

            {/* ── BLOC MOTS CLÉS ── */}
            <div hidden={activeSection !== "tags"}>
            <TagsDropdown
              localTags={localTags}
              tagNames={tagNames}
              setTagNames={setTagNames}
              onCreateClick={() => setModalType("tag")}
              isBestSeller={isBestSeller}
              setIsBestSeller={setIsBestSeller}
              productId={productId}
              mode={mode}
              loading={!attributesLoaded}
              discountPercent={discountPercent}
              setDiscountPercent={setDiscountPercent}
              hsCodeId={hsCodeId}
              setHsCodeId={setHsCodeId}
              hsCodeOptions={localHsCodes}
              onCreateHsCodeClick={() => setHsCodeQuickCreateOpen(true)}
            />
            </div>
          </div>

          {/* Row 2 : Bloc dimensions (left) + Bloc composition (right) */}
          <div id="section-details" hidden={!(["dim","comp"] as const).some((k) => k === activeSection)} className="space-y-4">

            {/* ── BLOC DIMENSIONS ── */}
            <div hidden={activeSection !== "dim"} className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <PanelHeader
                title="Dimensions & poids"
                subtitle="Facultatif — en millimètres. Le poids par pièce se règle sur chaque variante couleur."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Field label="Longueur">
                  <input type="number" min="0" step="0.1" value={dimLength} placeholder="—"
                    onChange={(e) => setDimLength(e.target.value)} className="field-input text-right" />
                </Field>
                <Field label="Largeur">
                  <input type="number" min="0" step="0.1" value={dimWidth} placeholder="—"
                    onChange={(e) => setDimWidth(e.target.value)} className="field-input text-right" />
                </Field>
                <Field label="Hauteur">
                  <input type="number" min="0" step="0.1" value={dimHeight} placeholder="—"
                    onChange={(e) => setDimHeight(e.target.value)} className="field-input text-right" />
                </Field>
                <Field label="Diamètre">
                  <input type="number" min="0" step="0.1" value={dimDiameter} placeholder="—"
                    onChange={(e) => setDimDiameter(e.target.value)} className="field-input text-right" />
                </Field>
                <Field label="Circonférence">
                  <input type="number" min="0" step="0.1" value={dimCircumference} placeholder="—"
                    onChange={(e) => setDimCircumference(e.target.value)} className="field-input text-right" />
                </Field>
              </div>
            </div>

            {/* ── BLOC COMPOSITION ── */}
            <div hidden={activeSection !== "comp"} className={`bg-bg-primary border rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] ${
              compositions.length === 0 || Math.abs(totalPct - 100) > 0.5 ? "border-[#EF4444]" : "border-border"
            }`}>
              <SectionEyebrow
                label="Composition"
                hint="Matériaux et pourcentages — total 100 %."
                action={
                  <button
                    type="button"
                    onClick={() => setModalType("composition")}
                    className="text-xs text-text-primary hover:text-[#000000] font-medium font-body transition-colors"
                  >
                    + Créer un matériau
                  </button>
                }
              />

              <div>
                <CustomSelect
                  value=""
                  onChange={(v) => { if (v) addComposition(v); }}
                  options={[
                    { value: "", label: "— Choisir un matériau —" },
                    ...localCompositions
                      .filter((c) => !compositions.some((x) => x.compositionId === c.id))
                      .map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  placeholder="— Choisir un matériau —"
                  loading={!attributesLoaded}
                  emptyMessage="Aucune composition n'est créée"
                  searchable
                />
              </div>

              {attributesLoaded && localCompositions.length === 0 && (
                <p className="text-xs text-text-muted font-body">
                  Aucune composition n&apos;est créée.
                </p>
              )}

              {compositions.length > 0 && (
                <>
                  <div className="space-y-2.5">
                    {compositions.map((item) => {
                      const comp = localCompositions.find((c) => c.id === item.compositionId);
                      const pct = Math.max(0, Math.min(100, parseFloat(item.percentage) || 0));
                      return (
                        <div
                          key={item.compositionId}
                          className="grid grid-cols-[36px_1fr_auto] sm:grid-cols-[36px_1.3fr_1fr_auto_36px] gap-3 items-center bg-bg-primary border border-border rounded-xl p-3"
                        >
                          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-bg-tertiary to-bg-secondary inline-flex items-center justify-center text-text-secondary shrink-0">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-text-primary font-body truncate">
                              {comp?.name ?? item.compositionId}
                            </div>
                            <div className="text-[11px] text-text-muted font-body sm:hidden">
                              {Math.round(pct)} %
                            </div>
                          </div>
                          <div className="hidden sm:flex items-center min-w-0">
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={pct}
                              onChange={(e) => updateCompositionPct(item.compositionId, e.target.value)}
                              className="w-full h-2 rounded-full appearance-none bg-bg-tertiary accent-bg-dark cursor-pointer"
                              aria-label={`Pourcentage ${comp?.name ?? "matériau"}`}
                            />
                          </div>
                          <div className="inline-flex items-center gap-1 bg-bg-secondary border border-border rounded-lg px-2 py-1.5">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={item.percentage}
                              onChange={(e) => updateCompositionPct(item.compositionId, e.target.value)}
                              className="w-12 text-right bg-transparent border-0 outline-none font-heading font-bold text-base text-text-primary p-0"
                            />
                            <span className="text-sm font-bold text-text-muted">%</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeComposition(item.compositionId)}
                            className="hidden sm:inline-flex w-8 h-8 items-center justify-center rounded-lg border border-border bg-bg-primary text-text-muted hover:border-[#EF4444] hover:text-[#EF4444] hover:bg-[#FEE2E2] transition-colors"
                            title="Retirer"
                            aria-label={`Retirer ${comp?.name ?? "matériau"}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeComposition(item.compositionId)}
                            className="sm:hidden text-[11px] text-text-muted hover:text-[#EF4444] transition-colors justify-self-end"
                          >Retirer</button>
                        </div>
                      );
                    })}
                  </div>
                  <div
                    className={`flex items-center justify-between rounded-xl px-4 py-3 border ${
                      Math.abs(totalPct - 100) <= 0.5
                        ? "bg-emerald-50 border-emerald-200"
                        : totalPct > 100
                          ? "bg-[#FEE2E2] border-[#FECACA]"
                          : "bg-[#FEF3C7] border-[#FDE68A]"
                    }`}
                  >
                    <span className="text-[11px] font-heading font-bold uppercase tracking-[0.1em] text-text-muted">
                      Total composition
                    </span>
                    <span
                      className={`font-heading font-extrabold text-xl ${
                        Math.abs(totalPct - 100) <= 0.5
                          ? "text-emerald-700"
                          : totalPct > 100
                            ? "text-[#B91C1C]"
                            : "text-[#B45309]"
                      }`}
                    >
                      {Math.round(totalPct)} %
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Variantes couleur ── */}
        <section id="section-variants" hidden={!(["var","img","map"] as const).some((k) => k === activeSection)} className={`bg-bg-primary border ${mode === "create" && variants.length === 0 ? "border-[#EF4444]" : "border-border"} rounded-2xl p-8 space-y-5 shadow-card`}>
          <div className="flex items-center justify-between gap-4 border-b border-border pb-4 flex-wrap">
            <div className="flex items-center gap-3">
              <h2 className="font-heading text-xl font-bold text-text-primary">
                Variantes{mode === "create" ? " *" : ""}
              </h2>
              <span className={`text-sm font-body ${mode === "create" && variants.length === 0 ? "text-[#EF4444] font-semibold" : "text-text-muted"}`}>
                {variants.length} variante{variants.length > 1 ? "s" : ""}
              </span>
            </div>
            {hasTailleUnique && activeSection === "var" && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="size-details-tu"
                  className="text-xs font-body font-semibold text-text-secondary whitespace-nowrap"
                  title="Indication taille minimum – maximum, ex : 36-42. Obligatoire quand une variante utilise la taille unique."
                >
                  Détail taille unique <span className="text-[#EF4444]">*</span>
                </label>
                <input
                  id="size-details-tu"
                  type="text"
                  value={sizeDetailsTu}
                  placeholder="ex : 52-56"
                  onChange={(e) => setSizeDetailsTu(e.target.value)}
                  className={`field-input w-32 text-right${!sizeDetailsTu.trim() ? " field-error" : ""}`}
                  required
                />
              </div>
            )}
          </div>
          {mode === "create" && variants.length === 0 && (
            <p className="text-[12px] text-[#EF4444] font-body">
              Au moins une variante de couleur est obligatoire pour créer le produit.
            </p>
          )}

          {activeSection === "img" && (
            <PhotosPanel
              variants={variants}
              colorImages={colorImages}
              availableColors={localColors}
              onChangeImages={setColorImages}
              primaryColorId={primaryColorId}
              onChangePrimaryColorId={setPrimaryColorId}
              productReference={reference}
              brandedBadgeEnabled={brandedBadgeEnabled}
            />
          )}

          {/* ── Bloc Remise (s'applique à toutes les variantes du produit) ── */}
          <div hidden={activeSection !== "var"} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end bg-gradient-to-br from-bg-primary to-bg-secondary border border-border rounded-xl p-4">
            <div>
              <label htmlFor="product-discount" className="block text-xs font-body font-semibold text-text-primary mb-1">
                Remise appliquée (%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="product-discount"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="Aucune remise"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                  className="field-input w-32 text-right"
                />
                <span className="text-sm font-semibold text-text-secondary">%</span>
              </div>
              <p className="text-[11px] text-text-muted font-body mt-1">
                S'applique à toutes les variantes du produit.
              </p>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-body font-semibold uppercase tracking-[0.08em] text-text-muted">
                Prix client
              </div>
              {(() => {
                const disc = discountPercent ? parseFloat(discountPercent) : 0;
                const avg = (() => {
                  const prices = variants
                    .map((v) => parseFloat(v.unitPrice))
                    .filter((n) => !isNaN(n) && n > 0);
                  if (prices.length === 0) return null;
                  return prices.reduce((a, b) => a + b, 0) / prices.length;
                })();
                if (avg === null) {
                  return <div className="font-heading font-extrabold text-lg text-text-muted mt-1">—</div>;
                }
                const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
                if (disc > 0 && disc <= 100) {
                  return (
                    <div className="flex items-baseline justify-end gap-2 mt-1">
                      <span className="font-heading font-extrabold text-lg text-[#B91C1C]">{fmt(avg * (1 - disc / 100))}</span>
                      <span className="text-xs text-text-muted line-through">{fmt(avg)}</span>
                    </div>
                  );
                }
                return <div className="font-heading font-extrabold text-lg text-text-primary mt-1">{fmt(avg)}</div>;
              })()}
            </div>
          </div>

          {(() => {
            // Bandeau d'alerte : liste les couleurs sans aucune image. Elles
            // restent autorisées mais seront masquées côté public et ignorées
            // sur les marketplaces tant qu'une image n'y sera pas ajoutée.
            // (Si AUCUNE couleur n'a d'image, la checklist signale déjà
            // l'erreur bloquante — on n'affiche pas le bandeau dans ce cas.)
            const seen = new Set<string>();
            const missingLabels: string[] = [];
            let anyHasImage = false;
            for (const v of variants) {
              if (isMultiColorPack(v)) {
                for (const line of v.packLines) {
                  if (!line.colorId || seen.has(line.colorId)) continue;
                  seen.add(line.colorId);
                  const ci = colorImages.find((c) => c.groupKey === line.colorId);
                  if (ci && ci.imagePreviews.length > 0) {
                    anyHasImage = true;
                  } else {
                    missingLabels.push(line.colorName || "couleur sans nom");
                  }
                }
              } else {
                const gk = imageGroupKeyFromVariant(v);
                if (seen.has(gk)) continue;
                seen.add(gk);
                const ci = colorImages.find((c) => c.groupKey === gk);
                if (ci && ci.imagePreviews.length > 0) {
                  anyHasImage = true;
                } else {
                  missingLabels.push(v.colorName || "couleur sans nom");
                }
              }
            }
            if (!anyHasImage || missingLabels.length === 0) return null;
            const plural = missingLabels.length > 1;
            return (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3 items-start">
                <svg
                  className="w-5 h-5 text-amber-600 shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z"
                  />
                </svg>
                <div className="text-[13px] font-body text-amber-900 leading-relaxed">
                  <p className="font-semibold mb-0.5">
                    {missingLabels.length} couleur{plural ? "s" : ""} sans image
                  </p>
                  <p>
                    {plural ? "Les couleurs " : "La couleur "}
                    <span className="font-semibold">
                      {missingLabels.join(", ")}
                    </span>{" "}
                    {plural ? "seront masquées" : "sera masquée"} sur le site et{" "}
                    {plural ? "ignorées" : "ignorée"} lors des envois aux marketplaces
                    (PFS, Ankorstore, eFashion) tant qu'aucune image n'y sera ajoutée.
                  </p>
                </div>
              </div>
            );
          })()}

          <div hidden={activeSection !== "var"}>
          <ColorVariantManager
            variants={variants}
            colorImages={colorImages}
            availableColors={localColors}
            availableSizes={localSizes}
            pfsSizes={pfsSizes}
            onChange={setVariants}
            onChangeImages={setColorImages}
            onQuickCreateColor={handleQuickCreateColor}
            onColorAdded={(color) => setLocalColors((prev) => prev.some((c) => c.id === color.id) ? prev : [...prev, color])}
            onSizeAdded={handleSizeAdded}
            variantErrors={variantErrors}
            productReference={reference}
            sizeDetailsTu={sizeDetailsTu}
            primaryColorId={primaryColorId}
            onChangePrimaryColorId={setPrimaryColorId}
            allowColorEdit={allowColorEditExistingVariants}
          />
          </div>

          {/* ── Mapping Marketplaces (bloc unifié : PFS / Ankor / eFa / Faire) ── */}
          {variants.length > 0 && activeSection === "map" && (
            <MarketplacesMappingSection
              variants={variants}
              availableColors={localColors}
              hasPfsConfig={!!hasPfsConfig}
              hasAnkorstoreConfig={!!hasAnkorstoreConfig && !!ankorstoreEnabled}
              hasEfashionConfig={!!hasEfashionConfig && !!efashionEnabled}
              hasFaireConfig={!!hasFaireConfig && !!faireEnabled}
              pfsColorOptions={pfsColorOptions ?? []}
              efashionColorOptions={efashionColorOptions ?? []}
              liveMarketplaceColorLabels={liveMarketplaceColorLabels}
              onChangePfsOverride={(targets, override) => {
                applyOverrideToTargets(setVariants, targets, (v) => ({ ...v, pfsColorRefOverride: override }), (pl) => ({ ...pl, pfsColorRefOverride: override }));
              }}
              onChangeEfashionOverride={(targets, override) => {
                applyOverrideToTargets(setVariants, targets, (v) => ({ ...v, efashionColorIdOverride: override }), (pl) => ({ ...pl, efashionColorIdOverride: override }));
              }}
              onChangeAnkorsOverride={(targets, override) => {
                applyOverrideToTargets(setVariants, targets, (v) => ({ ...v, ankorsColorNameOverride: override }), (pl) => ({ ...pl, ankorsColorNameOverride: override }));
              }}
              onChangeFaireOverride={(targets, override) => {
                applyOverrideToTargets(setVariants, targets, (v) => ({ ...v, faireColorNameOverride: override }), (pl) => ({ ...pl, faireColorNameOverride: override }));
              }}
            />
          )}

        </section>

        {/* ── Configuration Marketplace (activer / désactiver par marketplace) ── */}
        <div id="section-mp-config" hidden={activeSection !== "mp-config"}>
          {productId ? (
            <ProductMarketplaceToggles
              productId={productId}
              pfsEnabled={initialData?.pfsEnabledForProduct ?? true}
              ankorsEnabled={initialData?.ankorsEnabledForProduct ?? true}
              efashionEnabled={initialData?.efashionEnabledForProduct ?? true}
              faireEnabled={initialData?.faireEnabledForProduct ?? true}
              isPfsLinked={!!initialData?.pfsProductId}
              isAnkorsLinked={!!initialData?.ankorsProductId}
              isEfashionLinked={!!initialData?.efashionReferenceBase}
              isFaireLinked={!!initialData?.faireProductId}
              hasPfsConfig={!!hasPfsConfig}
              hasAnkorstoreConfig={!!hasAnkorstoreConfig && !!ankorstoreEnabled}
              hasEfashionConfig={!!hasEfashionConfig && !!efashionEnabled}
              hasFaireConfig={!!hasFaireConfig && !!faireEnabled}
            />
          ) : (
            <div className="bg-bg-primary border border-border rounded-2xl p-8 shadow-sm">
              <div
                className="text-[10.5px] font-bold uppercase text-text-muted mb-2"
                style={{ letterSpacing: "0.2em" }}
              >
                Publication marketplaces
              </div>
              <h3 className="font-heading text-lg font-bold text-text-primary mb-2">
                Enregistrez d'abord ce produit
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                La configuration marketplace n'est disponible qu'après l'enregistrement
                initial du produit. Créez d'abord la fiche puis revenez ici pour
                activer/désactiver chaque marketplace.
              </p>
            </div>
          )}
        </div>

        <div id="section-links" hidden={activeSection !== "assoc"} className="space-y-8">
          <section className="bg-bg-primary border border-border rounded-2xl p-8 space-y-8 shadow-card">
            <div className="border-b border-border pb-4">
              <h2 className="font-heading text-xl font-bold text-text-primary">
                Produits associés
              </h2>
              <p className="text-sm text-text-muted font-body mt-1">
                Suggestions affichées sur la fiche client et contenu d&apos;un éventuel ensemble.
              </p>
            </div>

            {/* ── Sous-bloc 1 : Suggestions similaires ── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1 h-3.5 rounded-sm bg-bg-dark" />
                <span className="text-[11px] font-heading font-bold uppercase tracking-[0.1em] text-text-muted">
                  Suggestions similaires
                </span>
              </div>
              <p className="text-sm text-text-muted font-body mb-4">
                Ces produits seront affichés dans la section &quot;Vous aimerez aussi&quot; sur la fiche client.
              </p>
              <SimilarProductPicker
                productId={productId}
                selected={similarProductIds}
                initialProducts={initialData?.similarProducts}
                onAdd={(id) => setSimilarProductIds((prev) => [...prev, id])}
                onRemove={(id) => setSimilarProductIds((prev) => prev.filter((x) => x !== id))}
              />
            </div>

            {/* ── Sous-bloc 2 : Contenu de l'ensemble ── */}
            <div className="pt-6 border-t border-border">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1 h-3.5 rounded-sm bg-bg-dark" />
                <span className="text-[11px] font-heading font-bold uppercase tracking-[0.1em] text-text-muted">
                  Contenu de l&apos;ensemble
                </span>
              </div>
              <p className="text-sm text-text-muted font-body mb-4">
                Si ce produit est un ensemble (ex&nbsp;: parure, coffret), sélectionnez les produits qu&apos;il contient.
              </p>
              <SimilarProductPicker
                productId={productId}
                selected={bundleChildIds}
                initialProducts={initialData?.bundleChildren}
                onAdd={(id) => setBundleChildIds((prev) => [...prev, id])}
                onRemove={(id) => setBundleChildIds((prev) => prev.filter((x) => x !== id))}
              />
            </div>

            {/* ── Sous-bloc 3 : Ensembles qui contiennent ce produit ── */}
            {initialData?.bundleParents && initialData.bundleParents.length > 0 && (
              <div className="pt-6 border-t border-border">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-1 h-3.5 rounded-sm bg-bg-dark" />
                  <span className="text-[11px] font-heading font-bold uppercase tracking-[0.1em] text-text-muted">
                    Contenu d&apos;un ensemble parent
                  </span>
                </div>
                <BundleParentsReadonly products={initialData.bundleParents} />
              </div>
            )}
          </section>
        </div>

        {/* ── Marketplaces (placeholder — détail des cards à venir) ── */}
        {/* ── Note interne ── */}
        <div id="section-note" hidden={activeSection !== "note"} className="space-y-4">
          <section className="bg-bg-primary border border-border rounded-2xl p-8 space-y-4 shadow-card">
            <PanelHeader
              title="Note interne"
              subtitle="Visible uniquement dans l'admin — mémo (recommande fournisseur, retour client, etc.)."
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={6}
              placeholder="Ex : « Stock rose gold à recommander mi-juillet » ou tout autre rappel interne."
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-300 font-body"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-text-muted font-body">
                {note.length} / 2000 caractères
              </span>
              {noteDirty && (
                <span className="text-[11px] text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5 font-body">
                  Modifications non enregistrées
                </span>
              )}
              <button
                type="button"
                onClick={handleSaveNote}
                disabled={noteSaving || !noteDirty}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-body font-semibold bg-bg-dark text-text-inverse hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {noteSaving ? "Enregistrement…" : "Enregistrer la note"}
              </button>
            </div>
          </section>
        </div>

        {/* Nav Précédent/Suivant entre onglets (bas de section) */}
        <SectionNavFooter
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />

        {(error || onlineErrors.length > 0 || isSyncLocked || mode !== "edit" || hasUnsavedChanges) && (
        <div className="sticky bottom-0 z-10 flex justify-center py-4">
          <div className="bg-bg-primary rounded-2xl px-6 py-4 shadow-[0_0_12px_rgba(0,0,0,0.08)] border border-border space-y-3 w-fit max-w-full">
            {/* ── Erreurs ── */}
            {error && (
              <div className="bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] px-4 py-3 text-sm font-body rounded-xl">
                {error}
              </div>
            )}

            {onlineErrors.length > 0 && (
              <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626] px-4 py-3 text-sm font-body rounded-xl space-y-2">
                <p className="font-semibold font-heading">
                  Ce produit ne peut pas être mis en ligne :
                </p>
                <ul className="space-y-1 list-none">
                  {onlineErrors.map((e, i) => (
                    <li key={`${e}-${i}`} className="flex items-start gap-2">
                      <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Sync lock indicator ── */}
            {isSyncLocked && (
              <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#FFF7ED] border border-[#FED7AA] rounded-xl text-[#C2410C] text-sm font-medium font-body">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Publication marketplace en cours — modifications désactivées
              </div>
            )}

            {/* ── Boutons d'action ── */}
            <div className="flex items-center justify-center flex-wrap gap-3">
              {/* Enregistrer (en edit: uniquement si modifications) */}
              {(mode !== "edit" || hasUnsavedChanges) && (() => {
                const isUploading = uploadProgress !== null;
                const mainLabel = isUploading
                  ? `Téléversement des photos… ${uploadProgress.current}/${uploadProgress.total}`
                  : isPending
                    ? mode === "edit"
                      ? "Enregistrement…"
                      : productId
                        ? "Enregistrement…"
                        : "Création en cours…"
                    : mode === "edit"
                      ? "Enregistrer les modifications"
                      : productId
                        ? "Finaliser le produit"
                        : "Créer le produit";

                let hintLabel = "";
                if (!isPending && !isUploading && !isProductComplete) {
                  hintLabel = "Fiche produit incomplète";
                }

                // En mode brouillon (create + productId existant), "Finaliser le produit"
                // fait doublon avec "Enregistrer en brouillon" — on grise le bouton
                // pour éviter la confusion, la sauvegarde passe par le bouton secondaire.
                const isDraftFinalize = mode === "create" && !!productId;
                return (
                  <button
                    type="submit"
                    disabled={isPending || isSyncLocked || isUploading || isDraftFinalize}
                    title={isDraftFinalize ? "Utilisez « Enregistrer en brouillon » — ce bouton est désactivé dans ce mode." : undefined}
                    className="btn-primary h-14 min-w-[260px] px-6 py-0 text-base disabled:opacity-60 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-0.5 leading-tight"
                  >
                    <span>{mainLabel}</span>
                    {hintLabel && (
                      <span className="text-[11px] opacity-80 font-normal font-body">
                        {hintLabel}
                      </span>
                    )}
                  </button>
                );
              })()}

              {/* Enregistrer en brouillon (create mode only) */}
              {mode === "create" && (
                <button
                  type="button"
                  disabled={isPending || isSyncLocked || uploadProgress !== null}
                  onClick={() => handleSaveDraft()}
                  className="flex items-center justify-center gap-2 h-14 min-w-[260px] px-6 py-0 bg-bg-secondary hover:bg-[#F0F0F0] text-text-secondary text-sm font-semibold rounded-xl border border-border transition-colors disabled:opacity-60 disabled:cursor-not-allowed font-body"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  {uploadProgress !== null
                    ? `Téléversement… ${uploadProgress.current}/${uploadProgress.total}`
                    : "Enregistrer en brouillon"}
                </button>
              )}

              {mode === "edit" && hasUnsavedChanges && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      type: "danger",
                      title: "Annuler les modifications",
                      message: "Voulez-vous vraiment annuler toutes les modifications ? Vos changements seront perdus.",
                      confirmLabel: "Annuler les modifications",
                      cancelLabel: "Continuer l\u2019édition",
                    });
                    if (ok) {
                      isDirty.current = false;
                      window.location.reload();
                    }
                  }}
                  className="btn-secondary h-14 px-7 py-0 text-sm"
                >
                  Annuler les modifications
                </button>
              )}
            </div>
          </div>
        </div>
        )}
      </fieldset>
      </form>
      </div>

      {/* ── Modales canoniques (mêmes que hors fiche produit) ── */}
      <CategoryEditorModal
        open={modalType === "category"}
        onClose={() => setModalType(null)}
        onCreated={handleModalCreated}
      />
      <ColorEditorModal
        open={modalType === "color"}
        onClose={() => setModalType(null)}
        onCreated={handleModalCreated}
      />
      <CompositionEditorModal
        open={modalType === "composition"}
        onClose={() => setModalType(null)}
        onCreated={handleModalCreated}
      />
      <SeasonEditorModal
        open={modalType === "season"}
        onClose={() => setModalType(null)}
        onCreated={handleModalCreated}
      />
      {/* Pays : plus de modale de création — liste figée dans lib/countries.ts */}

      {/* ── Sous-catégorie & mot-clé : pas d'équivalent canonique — mini-modale historique ── */}
      <QuickCreateModal
        type={modalType === "subcategory" || modalType === "tag" ? modalType : "subcategory"}
        open={modalType === "subcategory" || modalType === "tag"}
        onClose={() => setModalType(null)}
        onCreated={handleModalCreated}
        categoryId={categoryId}
        pfsEnabled={hasPfsConfig}
      />

      {/* ── Quick-create code SH ── */}
      <HsCodeModal
        open={hsCodeQuickCreateOpen}
        onClose={() => setHsCodeQuickCreateOpen(false)}
        onSaved={(saved) => {
          setLocalHsCodes((prev) => {
            const filtered = prev.filter((h) => h.id !== saved.id);
            return [...filtered, { id: saved.id, code: saved.code, label: saved.label }].sort(
              (a, b) => a.code.localeCompare(b.code),
            );
          });
          setHsCodeId(saved.id);
          setHsCodeQuickCreateOpen(false);
        }}
      />

    </>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-body font-semibold text-text-secondary mb-1.5">
        {label}
        {hint && <span className="ml-2 font-normal text-text-muted">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ── SimilarProductPicker (search-based with carousel) ──────────────────────
interface SearchProduct {
  id: string;
  name: string;
  reference: string;
  category: string;
  image: string | null;
  maxPrice?: number;
}

function SimilarProductPicker({
  productId,
  selected,
  initialProducts,
  onAdd,
  onRemove,
}: {
  productId?: string;
  selected: string[];
  initialProducts?: SearchProduct[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<SearchProduct[]>(initialProducts ?? []);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const carouselRef = useRef<HTMLDivElement>(null);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/products/search?q=${encodeURIComponent(value.trim())}${productId ? `&exclude=${productId}` : ""}`);
        const data = await res.json();
        setResults(data.products ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function handleSelect(product: SearchProduct) {
    if (selected.includes(product.id)) return;
    onAdd(product.id);
    setSelectedProducts((prev) => [...prev, product]);
  }

  function handleRemove(id: string) {
    onRemove(id);
    setSelectedProducts((prev) => prev.filter((p) => p.id !== id));
  }

  function scrollCarousel(dir: "left" | "right") {
    if (!carouselRef.current) return;
    const amount = 260;
    carouselRef.current.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  }

  const filteredResults = results.filter((r) => !selected.includes(r.id));

  return (
    <div className="space-y-4">
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Rechercher un produit par nom ou référence..."
          className="field-input !pl-10"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-border border-t-[#1A1A1A] rounded-full animate-spin" />
          </div>
        )}
      </div>

      {search.trim().length >= 1 && (
        <div className="border border-border rounded-xl overflow-hidden max-h-80 overflow-y-auto">
          {filteredResults.length === 0 ? (
            <p className="px-4 py-3 text-sm text-text-muted font-body">
              {loading ? "Recherche…" : "Aucun résultat."}
            </p>
          ) : (
            filteredResults.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => handleSelect(product)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-secondary transition-colors border-b border-border-light last:border-b-0"
              >
                {product.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={getImageSrc(product.image, "thumb")} alt="" className="w-10 h-10 object-cover rounded-lg border border-border" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-[#F0F0F0] flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                  </div>
                )}
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium text-text-primary font-body truncate">{product.name}</p>
                  <p className="text-xs text-text-muted font-body">
                    {product.reference} · {product.category}
                    {product.maxPrice != null && product.maxPrice > 0 && ` · ${product.maxPrice.toFixed(2)} €`}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {selectedProducts.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide font-body">
            Sélectionnés ({selectedProducts.length})
          </p>
          <div className="relative group/carousel">
            {selectedProducts.length > 3 && (
              <>
                <button
                  type="button"
                  onClick={() => scrollCarousel("left")}
                  className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-bg-primary border border-border shadow-md flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:border-bg-dark"
                >
                  <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => scrollCarousel("right")}
                  className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-bg-primary border border-border shadow-md flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:border-bg-dark"
                >
                  <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}
            <div
              ref={carouselRef}
              className="flex gap-3 overflow-x-auto scrollbar-hide scroll-smooth pb-1"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {selectedProducts.map((p) => (
                <div
                  key={p.id}
                  className="relative flex-shrink-0 w-48 bg-bg-secondary border border-border rounded-xl overflow-hidden group/card hover:border-bg-dark transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => handleRemove(p.id)}
                    className="absolute top-2 right-2 z-20 w-6 h-6 rounded-full bg-bg-primary/90 border border-border flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity text-text-muted hover:text-[#DC2626] hover:border-[#DC2626]"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <a
                    href={`/admin/produits/${p.id}/modifier`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative block cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="relative">
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={getImageSrc(p.image, "thumb")}
                          alt={p.name}
                          className="w-full h-32 object-cover"
                        />
                      ) : (
                        <div className="w-full h-32 bg-[#F0F0F0] flex items-center justify-center">
                          <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                          </svg>
                        </div>
                      )}
                      {/* Overlay au hover avec icone oeil */}
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                    </div>
                    <div className="p-3 space-y-1">
                      <p className="text-sm font-medium text-text-primary font-body truncate">{p.name}</p>
                      <p className="text-xs text-text-muted font-mono">{p.reference}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-muted font-body truncate">{p.category}</span>
                        {p.maxPrice != null && p.maxPrice > 0 && (
                          <span className="text-xs font-semibold text-text-primary font-body">{p.maxPrice.toFixed(2)} €</span>
                        )}
                      </div>
                    </div>
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BundleParentsReadonly (lecture seule, carousel) ──────────────────────
function BundleParentsReadonly({ products }: { products: SearchProduct[] }) {
  const carouselRef = useRef<HTMLDivElement>(null);

  function scrollCarousel(dir: "left" | "right") {
    if (!carouselRef.current) return;
    carouselRef.current.scrollBy({ left: dir === "left" ? -260 : 260, behavior: "smooth" });
  }

  return (
    <section className="bg-bg-primary border border-border rounded-2xl p-8 space-y-5 shadow-card">
      <div className="border-b border-border pb-4">
        <h2 className="font-heading text-xl font-bold text-text-primary">
          Ce produit se trouve aussi dans
        </h2>
        <p className="text-sm text-text-muted font-body mt-1">
          Ce produit fait partie des ensembles suivants. Pour modifier cette relation, allez sur la fiche de l&apos;ensemble.
        </p>
      </div>
      <div className="relative group/carousel">
        {products.length > 3 && (
          <>
            <button
              type="button"
              onClick={() => scrollCarousel("left")}
              className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-bg-primary border border-border shadow-md flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:border-bg-dark"
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => scrollCarousel("right")}
              className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-bg-primary border border-border shadow-md flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:border-bg-dark"
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}
        <div
          ref={carouselRef}
          className="flex gap-3 overflow-x-auto scrollbar-hide scroll-smooth pb-1"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {products.map((p) => (
            <a
              key={p.id}
              href={`/admin/produits/${p.id}/modifier`}
              target="_blank"
              rel="noopener noreferrer"
              className="relative flex-shrink-0 w-48 bg-bg-secondary border border-border rounded-xl overflow-hidden group/card hover:border-bg-dark transition-colors"
            >
              <div className="relative">
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getImageSrc(p.image, "thumb")}
                    alt={p.name}
                    className="w-full h-32 object-cover"
                  />
                ) : (
                  <div className="w-full h-32 bg-[#F0F0F0] flex items-center justify-center">
                    <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
              </div>
              <div className="p-3 space-y-1">
                <p className="text-sm font-medium text-text-primary font-body truncate">{p.name}</p>
                <p className="text-xs text-text-muted font-mono">{p.reference}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted font-body truncate">{p.category}</span>
                  {p.maxPrice != null && p.maxPrice > 0 && (
                    <span className="text-xs font-semibold text-text-primary font-body">{p.maxPrice.toFixed(2)} €</span>
                  )}
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
