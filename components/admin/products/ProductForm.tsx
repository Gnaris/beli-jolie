"use client";

import { useState, useTransition, useRef, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import ColorVariantManager, { VariantState, ColorImageState, AvailableColor, AvailableSize, uid as genUid, variantGroupKeyFromState, imageGroupKeyFromVariant, variantColorFingerprint, computeTotalPrice, isMultiColorPack, packLinesColorList, buildVariantDuplicateKey } from "./ColorVariantManager";
import CompletenessChecklist, { computeChecklist } from "./CompletenessChecklist";
import ProductFormNav from "./ProductFormNav";
import { createProduct, updateProduct, saveProductTranslations, toggleBestSeller, fetchProductFormAttributes } from "@/app/actions/admin/products";

import { VALID_LOCALES, LOCALE_LABELS } from "@/i18n/locales";
import LocaleTabs from "./LocaleTabs";
import QuickCreateModal, { QuickCreateType } from "./QuickCreateModal";
import CustomSelect from "@/components/ui/CustomSelect";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { usePfsRefreshQueue } from "./PfsRefreshContext";
import { LOCALE_FULL_NAMES } from "@/i18n/locales";
import { useProductFormHeader } from "./ProductFormHeaderContext";
import { getImageSrc } from "@/lib/image-utils";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

const DESCRIPTION_MIN_CHARS = 30;
import type { MarketplaceId } from "@/lib/product-events";
import { subscribeSSE } from "@/lib/shared-sse";

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
  availableCountries?: { id: string; name: string; isoCode: string | null }[];
  availableSeasons?: { id: string; name: string }[];
  availableTags?: { id: string; name: string }[];
  mode?: "create" | "edit";
  productId?: string;
  hasPfsConfig?: boolean;
  /** True when a marketplace sync is already in progress (from DB status on page load) */
  initialSyncing?: boolean;
  initialData?: {
    reference: string;
    name: string;
    description: string;
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
    manufacturingCountryId?: string;
    seasonId?: string;
    translations?: { locale: string; name: string; description: string }[];
    status?: "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING";
    discountPercent?: string;
    sizeDetailsTu?: string;
    /** ID marketplace — présent = déjà publié sur cette marketplace */
    pfsProductId?: string | null;
    /** Couleur principale du produit (refonte : ne dépend plus de la variante isPrimary) */
    primaryColorId?: string | null;
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
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary font-heading">Mots clés & Tags</p>
        <button type="button" onClick={onCreateClick}
          className="text-xs text-text-primary hover:text-[#000000] font-medium font-body transition-colors"
        >+ Créer</button>
      </div>

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

      {/* Best Seller */}
      <div className="pt-3 border-t border-border-light">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input type="checkbox" checked={isBestSeller} onChange={async (e) => {
            const val = e.target.checked;
            setIsBestSeller(val);
            if (mode === "edit" && productId) {
              toggleBestSeller(productId, val).catch(() => setIsBestSeller(!val));
            }
          }}
            className="w-4 h-4 border-border accent-[#1A1A1A]" />
          <div>
            <span className="text-sm font-body font-semibold text-text-secondary">Best Seller</span>
            <p className="text-xs text-text-muted font-body mt-0.5">Mettre en avant dans les filtres</p>
          </div>
        </label>
      </div>

      {/* Remise produit */}
      <div className="pt-3 border-t border-border-light">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-text-primary font-heading">Remise produit</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="—"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              className="field-input w-24 text-right"
            />
            <span className="text-sm font-semibold text-text-secondary">%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProductForm({
  categories: _initialCategories,
  availableColors: _initialColors,
  availableSizes: _initialSizes,
  availableCompositions: _initialCompositions,
  availableCountries: _initialCountries,
  availableSeasons: _initialSeasons,
  availableTags: _initialTags,
  mode = "create",
  productId,
  hasPfsConfig = false,
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
  const [localCountries,    setLocalCountries]    = useState<{ id: string; name: string; isoCode: string | null }[]>(_initialCountries ?? []);
  const [localSeasons,      setLocalSeasons]      = useState<{ id: string; name: string }[]>(_initialSeasons ?? []);
  const [pfsSizes,          setPfsSizes]          = useState<{ reference: string; label: string }[]>([]);
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
      setLocalCountries(data.manufacturingCountries);
      setLocalSeasons(data.seasons);
      setPfsSizes(data.pfsSizes ?? []);
      setAttributesLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Form fields ──────────────────────────────────────────────────────
  const [reference,       setReference]       = useState(initialData?.reference       ?? "");
  const [name,            setName]            = useState(initialData?.name            ?? "");
  const [description,     setDescription]     = useState(initialData?.description     ?? "");
  const [categoryId,      setCategoryId]      = useState(initialData?.categoryId      ?? "");
  const [subCategoryIds,  setSubCategoryIds]  = useState<string[]>(initialData?.subCategoryIds ?? []);
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
  const [discountPercent,   setDiscountPercent]   = useState(initialData?.discountPercent ?? "");
  const [sizeDetailsTu, setSizeDetailsTu] = useState(initialData?.sizeDetailsTu ?? "");
  const [manufacturingCountryId, setManufacturingCountryId] = useState(initialData?.manufacturingCountryId ?? "");
  const [seasonId, setSeasonId] = useState(initialData?.seasonId ?? "");

  // ── Dimensions ───────────────────────────────────────────────────────
  const [dimLength,        setDimLength]        = useState(initialData?.dimLength        ?? "");
  const [dimWidth,         setDimWidth]         = useState(initialData?.dimWidth         ?? "");
  const [dimHeight,        setDimHeight]        = useState(initialData?.dimHeight        ?? "");
  const [dimDiameter,      setDimDiameter]      = useState(initialData?.dimDiameter      ?? "");
  const [dimCircumference, setDimCircumference] = useState(initialData?.dimCircumference ?? "");

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

  // ── Sync header badges via context ────────────────────────────────────
  const { updateHeader, registerStatusToggle } = useProductFormHeader();
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
  useEffect(() => {
    // Completeness depends on many fields — separate effect.
    // Imported products are never shown as drafts.
    updateHeader({ isIncomplete: wasImported ? false : getCompletenessErrors().length > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference, name, description, categoryId, compositions, variants, colorImages]);

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
  const { enqueue: enqueuePublish } = usePfsRefreshQueue();
  const initialSnapshot = useRef<string | null>(null);
  const isDirty = useRef(false);
  const snapshotReady = useRef(false);

  const buildSnapshot = useCallback(() => JSON.stringify({
    reference, name, description, categoryId, subCategoryIds,
    variants: variants.map((v) => ({ colorId: v.colorId, unitPrice: v.unitPrice, weight: v.weight, stock: v.stock, saleType: v.saleType, packQuantity: v.packQuantity, sizeEntries: v.sizeEntries, disabled: v.disabled ?? false })),
    colorImages: colorImages.map((ci) => ({ groupKey: ci.groupKey, uploadedPaths: ci.uploadedPaths, orders: ci.orders })),
    compositions, similarProductIds, bundleChildIds, tagNames, isBestSeller, discountPercent,
    dimLength, dimWidth, dimHeight, dimDiameter, dimCircumference, productStatus,
    manufacturingCountryId, seasonId, sizeDetailsTu, primaryColorId,
  }), [reference, name, description, categoryId, subCategoryIds, variants, colorImages, compositions, similarProductIds, bundleChildIds, tagNames, isBestSeller, discountPercent, dimLength, dimWidth, dimHeight, dimDiameter, dimCircumference, productStatus, manufacturingCountryId, seasonId, sizeDetailsTu, primaryColorId]);

  // Détecte si au moins une variante utilise "Taille Unique" / "TU"
  const hasTailleUnique = useMemo(() => {
    const tuNames = ["tu", "taille unique"];
    return variants.some((v) =>
      v.sizeEntries.some((se) => tuNames.includes(se.sizeName?.toLowerCase?.() ?? ""))
      || v.packLines?.some((pl) => pl.sizeEntries.some((se) => tuNames.includes(se.sizeName?.toLowerCase?.() ?? "")))
    );
  }, [variants]);

  // Capture snapshot after first effects have settled (colorImages sync etc.)
  useEffect(() => {
    if (!snapshotReady.current) {
      const timer = setTimeout(() => {
        initialSnapshot.current = buildSnapshot();
        snapshotReady.current = true;
      }, 500);
      return () => clearTimeout(timer);
    }
    isDirty.current = buildSnapshot() !== initialSnapshot.current;
  }, [buildSnapshot]);

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
      }
      // false = cancel, stay on page
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
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, confirmDialog, mode]);

  // Intercept ALL client-side link clicks inside the page
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!isDirty.current) return;
      const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript")) return;
      // Only intercept internal navigation
      if (href.startsWith("http") && !href.startsWith(window.location.origin)) return;
      e.preventDefault();
      e.stopPropagation();
      navigateWithGuard(href);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navigateWithGuard]);

  // Reactive dirty state for conditional UI (e.g. cancel button visibility)
  const hasUnsavedChanges = snapshotReady.current && initialSnapshot.current !== null && buildSnapshot() !== initialSnapshot.current;

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
      // Keep only entries whose variant still exists
      const filtered = prev.filter((ci) => groupMap.has(ci.groupKey));
      // Update existing entries with latest display name/hex/colorId
      const updated = filtered.map((ci) => {
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

  // ── Composition picker state ─────────────────────────────────────────
  const [newCompId, setNewCompId] = useState("");

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

    // Fetch quota
    let remaining: number;
    let resetDate: string;
    try {
      const res = await fetch("/api/admin/translate");
      const data = await res.json();
      remaining = data.remaining;
      resetDate = data.resetDate;
    } catch {
      setTranslateError("Impossible de vérifier le quota.");
      return;
    }

    const texts = [name.trim(), description.trim()].filter(Boolean);
    const totalChars = texts.reduce((sum, t) => sum + t.length, 0) * 6;

    if (remaining < totalChars) {
      const formatted = new Date(resetDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
      setTranslateError(`Quota insuffisant. Réinitialisation le ${formatted}.`);
      return;
    }

    const confirmed = await confirm({
      type: "info",
      title: "Tout traduire (nom + description)",
      message: `Traduire le nom et la description vers ${localeListStr}.\n\nCaractères nécessaires : ${totalChars.toLocaleString("fr-FR")} (× 6 langues)\nCaractères restants : ${remaining.toLocaleString("fr-FR")} / 500 000`,
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
      for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
        newTranslations[locale] = {
          name: nameIdx >= 0 ? (results[nameIdx]?.[locale] ?? "") : "",
          description: descIdx >= 0 ? (results[descIdx]?.[locale] ?? "") : "",
        };
      }

      setTranslations((prev) => {
        const next = { ...prev };
        for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
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

  function addComposition() {
    if (!newCompId) return;
    if (compositions.some((c) => c.compositionId === newCompId)) return;
    const evenPct = (100 / (compositions.length + 1)).toFixed(1);
    const updated = compositions.map((c) => ({ ...c, percentage: evenPct }));
    setCompositions([...updated, { compositionId: newCompId, percentage: evenPct }]);
    setNewCompId("");
  }

  function updateCompositionPct(compositionId: string, pct: string) {
    setCompositions(compositions.map((c) =>
      c.compositionId === compositionId ? { ...c, percentage: pct } : c
    ));
  }

  function removeComposition(compositionId: string) {
    const remaining = compositions.filter((c) => c.compositionId !== compositionId);
    if (remaining.length === 0) { setCompositions([]); return; }
    const evenPct = (100 / remaining.length).toFixed(1);
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
  function handleModalCreated(item: { id: string; name: string; hex?: string | null; subCategories?: { id: string; name: string }[] }) {
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
      setLocalColors((prev) => [...prev, { id: item.id, name: item.name, hex: item.hex ?? null }]);
    } else if (modalType === "tag") {
      setLocalTags((prev) => [...prev, { id: item.id, name: item.name }]);
      setTagNames((prev) => (prev.includes(item.name) ? prev : [...prev, item.name]));
    } else if (modalType === "country") {
      setLocalCountries((prev) => [...prev, { id: item.id, name: item.name, isoCode: null }]);
      setManufacturingCountryId(item.id);
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
    else if (description.trim().length < DESCRIPTION_MIN_CHARS) errors.push("Description trop courte (30 caractères minimum)");
    if (!categoryId)          errors.push("Catégorie non sélectionnée");
    if (compositions.length === 0) {
      errors.push("Au moins une composition est requise");
    } else if (Math.abs(totalPct - 100) > 0.5) {
      errors.push(`La composition doit totaliser 100% (actuel : ${totalPct.toFixed(1)}%)`);
    }
    if (variants.length === 0) {
      errors.push("Au moins une variante de couleur est requise");
    } else {
      // Every variant must have at least one image (deduplicate by groupKey)
      const checkedGroupKeys = new Set<string>();
      for (const v of variants) {
        const gk = imageGroupKeyFromVariant(v);
        if (checkedGroupKeys.has(gk)) continue;
        checkedGroupKeys.add(gk);
        const ci = colorImages.find((c) => c.groupKey === gk);
        if (!ci || ci.uploadedPaths.length === 0) {
          const label = v.colorName || "variante pack";
          errors.push(`Variante "${label}" : aucune image`);
        }
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
  useEffect(() => {
    registerStatusToggle({
      getCompletenessErrors,
      isOutOfStock,
      setProductStatus,
      setOnlineErrors,
      setError,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerStatusToggle, reference, name, description, categoryId, compositions, variants, colorImages]);

  // Erreurs dures qui doivent bloquer l'enregistrement (même en brouillon)
  function getBlockingErrors(): string[] {
    const errors: string[] = [];
    // En mode création : pays de fabrication, saison et au moins une variante
    // sont obligatoires pour pouvoir enregistrer (même en brouillon).
    if (mode === "create") {
      if (!manufacturingCountryId) errors.push("Le pays de fabrication est obligatoire");
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

  // ── Save as draft (minimal validation) ───────────────────────────────
  async function handleSaveDraft(navigateTo?: string) {
    if (isSyncLocked) return;
    setError("");
    setOnlineErrors([]);

    // Hard-block: invalid state that DB/server-side also rejects
    const blocking = getBlockingErrors();
    if (blocking.length > 0) return setError(blocking.join(" · "));

    // Images still uploading — block
    if (colorImages.some((ci) => ci.uploading))
      return setError("Des images sont encore en cours d'upload. Veuillez patienter.");

    // Auto-generate reference if empty
    const draftRef = reference.trim()
      ? reference.trim().toUpperCase()
      : `BRN-${Date.now().toString(36).toUpperCase()}`;
    const draftName = name.trim() || "Brouillon sans nom";

    // Category is required by DB — if not set, ask user
    if (!categoryId) {
      return setError("Veuillez sélectionner une catégorie avant d'enregistrer en brouillon.");
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
      imagePaths: colorImages.flatMap((ci) => {
        if (ci.uploadedPaths.length === 0) return [];
        if (!ci.colorId || !validColorIds.has(ci.colorId)) return [];
        return [{
          colorId: ci.colorId,
          paths: ci.uploadedPaths,
          orders: ci.orders,
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
      manufacturingCountryId: manufacturingCountryId || null,
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
    const outOfStock = isOutOfStock();

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

    // Warn: saving an ONLINE product with no stock → auto downgrade to OFFLINE
    if (!downgradeConfirmed && productStatus === "ONLINE" && outOfStock) {
      const okDowngrade = await confirmDialog({
        type: "warning",
        title: "Rupture de stock",
        message: "Toutes les variantes de ce produit sont en rupture de stock. Le produit sera automatiquement mis hors ligne.",
        confirmLabel: "Enregistrer et mettre hors ligne",
        cancelLabel: "Annuler",
      });
      if (!okDowngrade) return;
      downgradeConfirmed = true;
    }

    const finalStatus = downgradeConfirmed ? "OFFLINE" : productStatus;

    // Minimal validation: DB non-nullable constraints
    if (!reference.trim()) return setError("La référence est requise.");
    if (!name.trim()) return setError("Le nom est requis.");
    if (!categoryId) return setError("Veuillez choisir une catégorie.");
    if (hasTailleUnique && !sizeDetailsTu.trim()) {
      return setError(
        "Le champ « Détail taille unique » est obligatoire quand une variante utilise la taille unique."
      );
    }

    // Images still uploading — always block
    if (colorImages.some((ci) => ci.uploading))
      return setError("Des images sont encore en cours d'upload. Veuillez patienter.");

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
      if (!allVariantsRemoved && initialData.variants.length > 0 && variants.every((v) => !v.dbId)) {
        issues.push("Les IDs de variantes existantes ont été perdus");
      }
      if (issues.length > 0) {
        return setError(
          `Erreur d'intégrité détectée (${issues.join(", ")}). Rechargez la page et réessayez.`
        );
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

    const payload = {
      reference:     reference.trim().toUpperCase(),
      name:          name.trim(),
      description:   description.trim(),
      categoryId,
      subCategoryIds,
      colors: variants.map((v) => {
        const isMultiPack = v.saleType === "PACK" && v.packLines.length > 0;
        const packLinesPayload = isMultiPack
          ? v.packLines
              .filter((line) => line.colorId)
              .map((line) => ({
                colorId: line.colorId,
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
        };
      }),
      discountPercent: discountPercent ? parseFloat(String(discountPercent)) : null,
      // Refonte : 1 entrée d'images par couleur du produit (productId × colorId).
      // Fini la duplication par variante.
      imagePaths: colorImages.flatMap((ci) => {
        if (ci.uploadedPaths.length === 0) return [];
        if (!ci.colorId) return [];
        return [{
          colorId: ci.colorId,
          paths: ci.uploadedPaths,
          orders: ci.orders,
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
      manufacturingCountryId: manufacturingCountryId || null,
      seasonId: seasonId || null,
      sizeDetailsTu: sizeDetailsTu.trim() || null,
      translations: Object.entries(translations)
        .filter(([, t]) => t.name.trim() || t.description.trim())
        .map(([locale, t]) => ({ locale, name: t.name, description: t.description })),
    };

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
          initialSnapshot.current = buildSnapshot();
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
      const isUpdate = alreadyOnPfs;
      const willBeDraftOnPfs = !alreadyOnPfs && finalStatus === "OFFLINE";

      const canPublish =
        savedProductId &&
        finalStatus !== "ARCHIVED" &&
        !isIncomplete &&
        hasPfsConfig;

      if (canPublish && savedProductId) {
        const checked = { pfs: false };
        const ok = await confirmDialog({
          type: "info",
          title: isUpdate
            ? "Mettre à jour sur Paris Fashion Shop ?"
            : willBeDraftOnPfs
              ? "Publier en brouillon sur Paris Fashion Shop ?"
              : "Publier sur Paris Fashion Shop ?",
          message: isUpdate
            ? "Souhaitez-vous mettre à jour ce produit sur Paris Fashion Shop ? Les modifications seront appliquées directement."
            : willBeDraftOnPfs
              ? "Ce produit est hors ligne sur votre boutique. Il sera envoyé sur Paris Fashion Shop en brouillon (non visible aux acheteurs). Pour le mettre en ligne plus tard, repassez-le en ligne ici puis enregistrez."
              : "Souhaitez-vous publier ce produit en direct sur Paris Fashion Shop ? Vous pourrez aussi le faire plus tard.",
          checkboxes: [
            {
              id: "pfs",
              label: "Paris Fashion Shop",
              defaultChecked: false,
              onChange: (v: boolean) => {
                checked.pfs = v;
              },
            },
          ],
          checkboxesLabel: "Marketplace",
          confirmLabel: isUpdate ? "Mettre à jour" : "Publier",
          cancelLabel: "Plus tard",
        });

        if (ok === true && checked.pfs) {
          const firstImagePath = colorImages[0]?.uploadedPaths[0] ?? null;
          enqueuePublish([
            {
              productId: savedProductId,
              reference: payload.reference,
              productName: payload.name,
              firstImage: firstImagePath,
              options: {
                local: false,
                pfs: true,
              },
              mode: "publish",
            },
          ]);
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
        />
      <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-8 min-w-0">

        {/* ── Indicateur de complétude ── */}
        <div id="section-overview" className="scroll-mt-24">
          <CompletenessChecklist input={checklistInput} />
        </div>

        {/* ── Informations du produit ── */}
        <div className="space-y-4">

          {/* Row 1 : Bloc principal (left) + Bloc mots clés (right) */}
          <div id="section-info" className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 scroll-mt-24">

            {/* ── BLOC PRINCIPAL ── */}
            <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">

              {/* Header: titre + langue tabs + bouton IA */}
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-semibold text-text-primary font-heading shrink-0">
                  Fiche produit
                </p>
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
                <input type="text" value={reference}
                  onChange={(e) => setReference(e.target.value.replace(/\s/g, "").toUpperCase())}
                  onBlur={() => markTouched("reference")}
                  placeholder="BJ-COL-001" className={`field-input${touchedFields.has("reference") && !reference.trim() ? " field-error" : ""}`} required />
                {touchedFields.has("reference") && !reference.trim() && (
                  <p className="text-[11px] text-[#EF4444] mt-1 font-body">La référence est requise.</p>
                )}
              </Field>

              {/* Non-FR hint + missing translation warning */}
              {activeLocale !== "fr" && (
                <div className="space-y-2">
                  <div className="bg-bg-secondary border border-border rounded-lg px-3 py-2 text-xs text-text-secondary font-body">
                    Langue active : <strong>{LOCALE_LABELS[activeLocale]}</strong> — le nom et la description seront sauvegardés en tant que traduction.
                    Les champs Catégorie, Sous-catégories, Tags, Composition et Couleurs restent en français.
                  </div>
                  {missingDbLocales?.has(activeLocale) && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 font-body">
                      <span className="text-base leading-none mt-0.5">⚠️</span>
                      <span>
                        <strong>Traduction manquante</strong> — Aucune traduction enregistrée en <strong>{LOCALE_LABELS[activeLocale]}</strong>.
                        Le produit s&apos;affichera en français par défaut pour les visiteurs dans cette langue.
                        Utilisez le bouton &laquo;&nbsp;Générer avec l&apos;IA&nbsp;&raquo; ou remplissez manuellement les champs.
                      </span>
                    </div>
                  )}
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
                  <div className={!categoryId ? "rounded-lg ring-1 ring-[#EF4444]" : ""}>
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
                    />
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
                    <div className="flex flex-wrap gap-2 min-h-[38px] items-start">
                      {subCategories.map((sub) => {
                        const selected = subCategoryIds.includes(sub.id);
                        return (
                          <button key={sub.id} type="button" onClick={() => toggleSubCategory(sub.id)}
                            className={`px-3 py-1.5 text-sm border rounded-lg transition-colors font-body ${
                              selected ? "bg-bg-dark text-text-inverse border-[#1A1A1A]" : "bg-bg-primary text-text-secondary border-border hover:border-bg-dark"
                            }`}
                          >{sub.name}</button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Pays de fabrication + Saison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Pays de fabrication */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-body font-semibold text-text-secondary">
                      Pays de fabrication{mode === "create" ? " *" : ""}
                    </label>
                    <button type="button"
                      onClick={() => setModalType("country")}
                      className="text-xs text-text-primary hover:text-[#000000] font-medium font-body transition-colors"
                    >+ Créer</button>
                  </div>
                  <CustomSelect
                    value={manufacturingCountryId}
                    onChange={(v) => setManufacturingCountryId(v)}
                    options={[
                      { value: "", label: "— Aucun —" },
                      ...localCountries.map((c) => ({ value: c.id, label: c.isoCode ? `${c.name} (${c.isoCode})` : c.name })),
                    ]}
                    placeholder="— Aucun —"
                    loading={!attributesLoaded}
                    emptyMessage="Aucun pays n'est créé"
                    className={mode === "create" && !manufacturingCountryId ? "field-error" : ""}
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
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-body font-semibold text-text-secondary">
                    Description *{activeLocale !== "fr" ? ` (${LOCALE_LABELS[activeLocale]})` : ""}
                  </label>
                  {activeLocale === "fr" && (() => {
                    const len = description.trim().length;
                    const tooShort = len < DESCRIPTION_MIN_CHARS;
                    return (
                      <span
                        className={`text-[11px] font-body ${tooShort ? "text-[#EF4444]" : "text-text-tertiary"}`}
                      >
                        {len} / {DESCRIPTION_MIN_CHARS} min
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
                  className={`field-input resize-none${activeLocale === "fr" && (!description.trim() || description.trim().length < DESCRIPTION_MIN_CHARS) ? " field-error" : ""}`}
                  required={activeLocale === "fr"}
                />
                {activeLocale === "fr" && touchedFields.has("description") && !description.trim() && (
                  <p className="text-[11px] text-[#EF4444] mt-1 font-body">La description est requise pour la mise en ligne.</p>
                )}
                {activeLocale === "fr" && touchedFields.has("description") && description.trim() && description.trim().length < DESCRIPTION_MIN_CHARS && (
                  <p className="text-[11px] text-[#EF4444] mt-1 font-body">Minimum {DESCRIPTION_MIN_CHARS} caractères requis. Actuellement : {description.trim().length}.</p>
                )}
              </div>
            </div>

            {/* ── BLOC MOTS CLÉS & REMISE ── */}
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
            />
          </div>

          {/* Row 2 : Bloc dimensions (left) + Bloc composition (right) */}
          <div id="section-details" className="grid grid-cols-1 lg:grid-cols-2 gap-4 scroll-mt-24">

            {/* ── BLOC DIMENSIONS ── */}
            <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div>
                <p className="text-sm font-semibold text-text-primary font-heading">Dimensions</p>
                <p className="text-xs text-text-muted font-body mt-0.5">
                  En millimètres (mm) — laisser vide si non applicable.
                </p>
              </div>
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
              {hasTailleUnique && (
                <div className="pt-2 border-t border-border">
                  <Field label="Détail taille unique *">
                    <input type="text" value={sizeDetailsTu} placeholder="ex : 52-56"
                      onChange={(e) => setSizeDetailsTu(e.target.value)}
                      className={`field-input${!sizeDetailsTu.trim() ? " field-error" : ""}`} required />
                    <p className="text-xs text-text-muted mt-1">Indication taille minimum – maximum, exemple : 36-42. Obligatoire quand une variante utilise la taille unique.</p>
                  </Field>
                </div>
              )}
            </div>

            {/* ── BLOC COMPOSITION ── */}
            <div className={`bg-bg-primary border rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] ${
              compositions.length === 0 || Math.abs(totalPct - 100) > 0.5 ? "border-[#EF4444]" : "border-border"
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-text-primary font-heading">Composition</p>
                  <p className="text-xs text-text-muted font-body mt-0.5">
                    Matériaux et pourcentages.
                  </p>
                </div>
                <button type="button"
                  onClick={() => setModalType("composition")}
                  className="text-xs text-text-primary hover:text-[#000000] font-medium font-body transition-colors"
                >+ Créer un matériau</button>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                <div className="flex-1">
                  <CustomSelect
                    value={newCompId}
                    onChange={(v) => setNewCompId(v)}
                    options={[
                      { value: "", label: "— Choisir un matériau —" },
                      ...localCompositions
                        .filter((c) => !compositions.some((x) => x.compositionId === c.id))
                        .map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    placeholder="— Choisir un matériau —"
                    loading={!attributesLoaded}
                    emptyMessage="Aucune composition n'est créée"
                  />
                </div>
                <button type="button" onClick={addComposition} disabled={!newCompId}
                  className="px-4 py-2.5 bg-bg-dark text-text-inverse text-sm font-medium rounded-lg hover:bg-[#000000] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 font-body"
                >Ajouter</button>
              </div>

              {attributesLoaded && localCompositions.length === 0 && (
                <p className="text-xs text-text-muted font-body">
                  Aucune composition n&apos;est créée.
                </p>
              )}

              {compositions.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary font-body">
                      {compositions.length} matériau{compositions.length > 1 ? "x" : ""}
                    </span>
                    <span className={`text-sm font-semibold px-3 py-1 rounded-full font-body ${
                      Math.abs(totalPct - 100) <= 0.5
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA]"
                    }`}>
                      Total : {totalPct.toFixed(1)} %{Math.abs(totalPct - 100) <= 0.5 ? " ✓" : " ≠ 100%"}
                    </span>
                  </div>
                  <ul className="divide-y divide-[#E5E5E5] border border-border rounded-xl overflow-hidden">
                    {compositions.map((item) => {
                      const comp = localCompositions.find((c) => c.id === item.compositionId);
                      return (
                        <li key={item.compositionId} className="flex items-center justify-between px-4 py-2.5 gap-3">
                          <span className="text-sm font-medium text-text-primary font-body flex-1 min-w-0 truncate">
                            {comp?.name ?? item.compositionId}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input type="number" min="0" max="100" step="0.1" value={item.percentage}
                              onChange={(e) => updateCompositionPct(item.compositionId, e.target.value)}
                              className="w-20 field-input px-2 py-1.5 text-sm text-right" />
                            <span className="text-sm text-text-secondary">%</span>
                          </div>
                          <button type="button" onClick={() => removeComposition(item.compositionId)}
                            className="text-text-primary hover:text-[#DC2626] transition-colors text-sm shrink-0"
                          >Retirer</button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Variantes couleur ── */}
        <section id="section-variants" className={`bg-bg-primary border ${mode === "create" && variants.length === 0 ? "border-[#EF4444]" : "border-border"} rounded-2xl p-8 space-y-5 shadow-card scroll-mt-24`}>
          <div className="flex items-center justify-between border-b border-border pb-4">
            <h2 className="font-heading text-xl font-bold text-text-primary">
              Variantes{mode === "create" ? " *" : ""}
            </h2>
            <span className={`text-sm font-body ${mode === "create" && variants.length === 0 ? "text-[#EF4444] font-semibold" : "text-text-muted"}`}>
              {variants.length} variante{variants.length > 1 ? "s" : ""}
            </span>
          </div>
          {mode === "create" && variants.length === 0 && (
            <p className="text-[12px] text-[#EF4444] font-body">
              Au moins une variante de couleur est obligatoire pour créer le produit.
            </p>
          )}

          {/* Aide rapide : différence entre vente à l'unité et vente en paquet */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-start gap-3 bg-[#F0F9FF] border border-[#BAE6FD] rounded-xl p-3">
              <svg className="w-5 h-5 text-[#0369A1] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              <div>
                <p className="text-xs font-semibold text-[#0C4A6E] font-heading">Vente à l&apos;unité</p>
                <p className="text-[11px] text-[#075985] font-body mt-0.5">
                  Le client achète <strong>1 article à la fois</strong>. Une couleur, des tailles disponibles, un prix par pièce.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 bg-[#FAF5FF] border border-[#E9D5FF] rounded-xl p-3">
              <svg className="w-5 h-5 text-[#6B21A8] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7L12 3 4 7m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <div>
                <p className="text-xs font-semibold text-[#581C87] font-heading">Vente en paquet</p>
                <p className="text-[11px] text-[#6B21A8] font-body mt-0.5">
                  Le client achète <strong>un lot complet</strong>. Vous indiquez combien de pièces composent le paquet et le prix du lot. Pour un <em>paquet multicolore</em>, sélectionnez plusieurs couleurs : chacune aura ses propres tailles.
                </p>
              </div>
            </div>
          </div>

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
          />
        </section>

        <div id="section-links" className="space-y-8 scroll-mt-24">
        {/* ── Produits similaires ── */}
        <section className="bg-bg-primary border border-border rounded-2xl p-8 space-y-5 shadow-card">
          <div className="border-b border-border pb-4">
            <h2 className="font-heading text-xl font-bold text-text-primary">
              Produits similaires
            </h2>
            <p className="text-sm text-text-muted font-body mt-1">
              Ces produits seront affichés dans la section &quot;Vous aimerez aussi&quot; sur la fiche client.
            </p>
          </div>
          <SimilarProductPicker
            productId={productId}
            selected={similarProductIds}
            initialProducts={initialData?.similarProducts}
            onAdd={(id) => setSimilarProductIds((prev) => [...prev, id])}
            onRemove={(id) => setSimilarProductIds((prev) => prev.filter((x) => x !== id))}
          />
        </section>

        {/* ── Composition (ensemble → sous-produits) ── */}
        <section className="bg-bg-primary border border-border rounded-2xl p-8 space-y-5 shadow-card">
          <div className="border-b border-border pb-4">
            <h2 className="font-heading text-xl font-bold text-text-primary">
              Contenu de l&apos;ensemble
            </h2>
            <p className="text-sm text-text-muted font-body mt-1">
              Si ce produit est un ensemble (ex : parure, coffret), sélectionnez les produits qu&apos;il contient.
            </p>
          </div>
          <SimilarProductPicker
            productId={productId}
            selected={bundleChildIds}
            initialProducts={initialData?.bundleChildren}
            onAdd={(id) => setBundleChildIds((prev) => [...prev, id])}
            onRemove={(id) => setBundleChildIds((prev) => prev.filter((x) => x !== id))}
          />
        </section>

        {/* ── Ce produit se trouve aussi dans (lecture seule) ── */}
        {initialData?.bundleParents && initialData.bundleParents.length > 0 && (
          <BundleParentsReadonly products={initialData.bundleParents} />
        )}
        </div>

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
                const mainLabel = isPending
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
                if (!isPending) {
                  if (!isProductComplete) {
                    hintLabel = "Sera enregistré en brouillon";
                  } else if (productStatus === "ONLINE") {
                    hintLabel = "Visible par les clients";
                  } else if (productStatus === "OFFLINE") {
                    hintLabel = "Reste hors ligne";
                  } else if (productStatus === "ARCHIVED") {
                    hintLabel = "Reste archivé";
                  }
                }

                return (
                  <button
                    type="submit"
                    disabled={isPending || isSyncLocked}
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
                  disabled={isPending || isSyncLocked}
                  onClick={() => handleSaveDraft()}
                  className="flex items-center justify-center gap-2 h-14 min-w-[260px] px-6 py-0 bg-bg-secondary hover:bg-[#F0F0F0] text-text-secondary text-sm font-semibold rounded-xl border border-border transition-colors disabled:opacity-60 disabled:cursor-not-allowed font-body"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Enregistrer en brouillon
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
      </form>
      </div>

      {/* ── Quick-create modal ── */}
      <QuickCreateModal
        type={modalType ?? "category"}
        open={modalType !== null}
        onClose={() => setModalType(null)}
        onCreated={handleModalCreated}
        categoryId={categoryId}
        pfsEnabled={hasPfsConfig}
      />

    </>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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
