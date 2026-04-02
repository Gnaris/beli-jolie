"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import ColorSwatch from "@/components/ui/ColorSwatch";
import { applyPfsLiveSync } from "@/app/actions/admin/pfs-live-sync";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import type { QuickCreateType } from "@/components/admin/products/QuickCreateModal";
import { updateColorPfsRef, getColorsForLinking } from "@/app/actions/admin/colors";
import CustomSelect from "@/components/ui/CustomSelect";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface SubColorData {
  colorId: string;
  colorName: string;
  hex: string | null;
  patternImage: string | null;
}

interface VariantData {
  id?: string;
  colorId: string;
  colorName: string;
  colorHex?: string | null;
  colorPatternImage?: string | null;
  subColors?: SubColorData[];
  unitPrice: number;
  weight: number;
  stock: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
  sizeName?: string | null;
  isPrimary: boolean;
  isActive?: boolean;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
  pfsSizeRef?: string | null;
  pfsColorRef?: string | null;
  pfsColorRefLabel?: string | null;
  pfsVariantId?: string | null;
}

interface CompositionData {
  compositionId: string;
  name: string;
  percentage: number;
  pfsRef?: string;
}

interface ProductData {
  id: string;
  reference: string;
  pfsReference?: string;
  name: string;
  description: string;
  categoryId: string;
  categoryName: string;
  isBestSeller: boolean;
  status: string;
  variants: VariantData[];
  imagesByColor: Array<{
    colorId: string;
    colorName: string;
    colorHex: string | null;
    colorPatternImage: string | null;
    subColors: SubColorData[];
    paths: string[];
    images?: Array<{ id: string; path: string; order: number }>;
  }>;
  compositions: CompositionData[];
  manufacturingCountryId?: string | null;
  manufacturingCountryName?: string | null;
  seasonId?: string | null;
  seasonName?: string | null;
  pfsSeasonRef?: string | null;
  pfsCountryRef?: string | null;
  pfsCategoryPfsId?: string | null;
  pfsCategoryGender?: string | null;
  pfsCategoryFamilyId?: string | null;
}

interface CompareSelections {
  name: "bj" | "pfs";
  description: "bj" | "pfs";
  category: "bj" | "pfs";
  compositions: "bj" | "pfs";
  season: "bj" | "pfs";
  manufacturingCountry: "bj" | "pfs";
  variants: Record<string, "bj" | "pfs" | "add" | "delete_pfs">;
}

interface PfsLiveCompareModalProps {
  productId: string;
  // Pre-fetched data from the banner to avoid double API call
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData?: any;
  open: boolean;
  onClose: () => void;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function variantGroupKey(v: VariantData): string {
  const subIds = (v.subColors ?? []).map((sc) => sc.colorId).join(",");
  return `${v.colorId}::${subIds}::${v.saleType}`;
}

function formatDiscount(type: "PERCENT" | "AMOUNT" | null, value: number | null): string {
  if (!type || value == null) return "—";
  return type === "PERCENT" ? `${value}%` : `${value.toFixed(2)}€`;
}

function fullColorName(v: VariantData): string {
  const parts = [v.colorName];
  if (v.subColors && v.subColors.length > 0) {
    parts.push(...v.subColors.map((sc) => sc.colorName));
  }
  return parts.join(", ");
}

function getSubSegs(v: VariantData) {
  if (!v.subColors || v.subColors.length === 0) return undefined;
  return v.subColors.map((sc) => ({
    hex: sc.hex ?? null,
    patternImage: sc.patternImage ?? null,
  }));
}

/** Check if season/country actually differ — fall back to name comparison when IDs can't be resolved */
function isSeasonDiff(existing: ProductData, pfs: ProductData): boolean {
  if (!pfs.seasonName) return false;
  if (existing.seasonId && pfs.seasonId) return existing.seasonId !== pfs.seasonId;
  // ID-based comparison failed (PFS season not resolved) → compare by name
  if (existing.seasonName && pfs.seasonName) {
    return existing.seasonName.trim().toLowerCase() !== pfs.seasonName.trim().toLowerCase();
  }
  // One side has no season at all
  return !!existing.seasonId !== !!pfs.seasonName;
}

function isCountryDiff(existing: ProductData, pfs: ProductData): boolean {
  if (!pfs.manufacturingCountryName) return false;
  if (existing.manufacturingCountryId && pfs.manufacturingCountryId) return existing.manufacturingCountryId !== pfs.manufacturingCountryId;
  // ID-based comparison failed → compare by name
  if (existing.manufacturingCountryName && pfs.manufacturingCountryName) {
    return existing.manufacturingCountryName.trim().toLowerCase() !== pfs.manufacturingCountryName.trim().toLowerCase();
  }
  return !!existing.manufacturingCountryId !== !!pfs.manufacturingCountryName;
}

/** Normalize compositions for comparison: strip pfsRef which only exists on PFS side */
function normalizeComps(comps: CompositionData[]): string {
  return JSON.stringify(
    [...comps]
      .map(c => ({ name: c.name.trim().toLowerCase(), percentage: c.percentage }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.percentage - b.percentage)
  );
}

// ─────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function XMarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function SyncIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>
  );
}

function ZoomIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Selection Button
// ─────────────────────────────────────────────

function SelectButton({
  selected,
  onClick,
  side,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  side: "bj" | "pfs";
  label?: string;
}) {
  const bgSelected = side === "bj"
    ? "bg-[#3B82F6] text-white border-[#3B82F6]"
    : "bg-[#F59E0B] text-white border-[#F59E0B]";
  const bgDefault = "bg-bg-secondary text-text-secondary border-border hover:bg-border hover:text-text-primary";

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border transition-all min-h-[36px] ${
        selected ? bgSelected : bgDefault
      }`}
      aria-pressed={selected}
    >
      {selected && <CheckIcon className="h-3.5 w-3.5" />}
      {label ?? "Prendre cette valeur"}
    </button>
  );
}

// ─────────────────────────────────────────────
// Field Comparison Row
// ─────────────────────────────────────────────

function CompareField({
  label,
  bjValue,
  pfsValue,
  isDifferent,
  selected,
  onSelect,
  renderValue,
}: {
  label: string;
  bjValue: unknown;
  pfsValue: unknown;
  isDifferent: boolean;
  selected: "bj" | "pfs";
  onSelect: (side: "bj" | "pfs") => void;
  renderValue?: (val: unknown, side: "bj" | "pfs") => React.ReactNode;
}) {
  const render = renderValue ?? ((val: unknown) => (
    <p className="text-sm text-text-primary break-words whitespace-pre-wrap">
      {val == null || val === "" ? <span className="text-text-secondary italic">Vide</span> : String(val)}
    </p>
  ));

  return (
    <div className={`rounded-xl border p-4 ${
      isDifferent ? "border-[#F59E0B]/40 bg-[#F59E0B]/5" : "border-border bg-bg-secondary/30"
    }`}>
      {/* Section header with label + badge */}
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide font-heading">
          {label}
        </h4>
        {isDifferent ? (
          <span className="badge badge-warning text-[10px]">Différent</span>
        ) : (
          <span className="badge badge-success text-[10px]">Identique</span>
        )}
      </div>

      {/* Two-column grid with vertical divider */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-border">
        {/* Boutique column */}
        <div className={`pr-3 rounded-l-lg p-3 transition-all ${
          selected === "bj" ? "bg-[#3B82F6]/5" : "bg-bg-primary"
        }`}>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#3B82F6] bg-[#3B82F6]/10 rounded px-1.5 py-0.5">
              Boutique
            </span>
          </div>
          {isDifferent && (
            <div className="mb-2">
              <SelectButton selected={selected === "bj"} onClick={() => onSelect("bj")} side="bj" />
            </div>
          )}
          {render(bjValue, "bj")}
        </div>

        {/* PFS column */}
        <div className={`pl-3 rounded-r-lg p-3 transition-all ${
          selected === "pfs" ? "bg-[#F59E0B]/5" : "bg-bg-primary"
        }`}>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#F59E0B] bg-[#F59E0B]/10 rounded px-1.5 py-0.5">
              Paris Fashion Shop (actuel)
            </span>
          </div>
          {isDifferent && (
            <div className="mb-2">
              <SelectButton selected={selected === "pfs"} onClick={() => onSelect("pfs")} side="pfs" />
            </div>
          )}
          {render(pfsValue, "pfs")}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Variant Card
// ─────────────────────────────────────────────

function VariantCard({
  variant,
  side,
  selected,
  compact,
}: {
  variant: VariantData;
  side: "bj" | "pfs";
  selected: boolean;
  compact?: boolean;
}) {
  const color = side === "bj" ? "#3B82F6" : "#F59E0B";
  const label = side === "bj" ? "Boutique" : "Paris Fashion Shop";

  return (
    <div
      className={`rounded-lg p-3 border transition-all ${
        selected ? `border-[${color}] bg-[${color}]/5 ring-1 ring-[${color}]/20` : "border-border bg-bg-primary"
      }`}
      style={selected ? { borderColor: color, backgroundColor: `${color}0D`, boxShadow: `0 0 0 1px ${color}33` } : {}}
    >
      {!compact && (
        <span
          className="text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 mb-2 inline-block"
          style={{ color, backgroundColor: `${color}1A` }}
        >
          {label}
        </span>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <span className="text-text-secondary">Prix unitaire</span>
          <p className="font-medium text-text-primary tabular-nums">{Number(variant.unitPrice).toFixed(2)}€</p>
        </div>
        <div>
          <span className="text-text-secondary">Stock</span>
          <p className="font-medium text-text-primary tabular-nums">{variant.stock}</p>
        </div>
        <div>
          <span className="text-text-secondary">Poids</span>
          <p className="font-medium text-text-primary tabular-nums">{variant.weight.toFixed(2)} kg</p>
        </div>
        <div>
          <span className="text-text-secondary">Remise</span>
          <p className="font-medium text-text-primary tabular-nums">{formatDiscount(variant.discountType, variant.discountValue)}</p>
        </div>
        <div>
          <span className="text-text-secondary">Taille</span>
          <p className="font-medium text-text-primary">{variant.sizeName ?? variant.size ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Variant Matching
// ─────────────────────────────────────────────

interface VariantMatch {
  key: string;
  bjVariants: VariantData[];
  pfsVariants: VariantData[];
  colorName: string;
  colorHex: string | null;
  colorPatternImage: string | null;
  subColors?: SubColorData[];
  onlyIn: "both" | "bj" | "pfs";
  isDifferent: boolean;
  pfsDisabled: boolean;
}

function variantIsDiff(bj: VariantData, pfs: VariantData): boolean {
  // Size comparison: use PFS size ref mapping when available for accurate matching
  const bjSizeEffective = bj.pfsSizeRef ?? bj.sizeName ?? bj.size;
  const pfsSizeEffective = pfs.sizeName ?? pfs.size;
  const sizeDiff = bjSizeEffective !== pfsSizeEffective;

  return Math.abs(bj.unitPrice - pfs.unitPrice) > 0.01
    || bj.stock !== pfs.stock
    || Math.abs(bj.weight - pfs.weight) > 0.01
    || bj.discountType !== pfs.discountType
    || bj.discountValue !== pfs.discountValue
    || sizeDiff;
}

function matchVariants(bjVariants: VariantData[], pfsVariants: VariantData[]): VariantMatch[] {
  const matches: VariantMatch[] = [];
  const usedBj = new Set<number>();
  const usedPfs = new Set<number>();

  // ── Step 1: match BJ variants that have an explicit pfsColorRef override ──
  // This covers: multi-color UNIT (subColors + pfsColorRef) AND PACK (packColorLines with pfsColorRef)
  for (let bi = 0; bi < bjVariants.length; bi++) {
    const bj = bjVariants[bi];
    // Only process variants with an explicit per-variant PFS color override
    if (!bj.pfsColorRef) continue;

    const pi = pfsVariants.findIndex((pfs, idx) =>
      !usedPfs.has(idx) && pfs.pfsColorRef === bj.pfsColorRef && pfs.saleType === bj.saleType
    );

    usedBj.add(bi);
    const pfsArr = pi >= 0 ? [pfsVariants[pi]] : [];
    if (pi >= 0) usedPfs.add(pi);

    const pfsV = pfsArr[0];
    const isDiff = pfsArr.length === 0 || (pfsV ? variantIsDiff(bj, pfsV) : true);
    const pfsDisabled = pfsArr.length > 0 && pfsArr.every((v) => v.isActive === false);

    matches.push({
      key: variantGroupKey(bj),
      bjVariants: [bj],
      pfsVariants: pfsArr,
      colorName: bj.colorName,
      colorHex: bj.colorHex ?? null,
      colorPatternImage: bj.colorPatternImage ?? null,
      subColors: bj.subColors,
      onlyIn: pfsArr.length > 0 ? "both" : "bj",
      isDifferent: isDiff,
      pfsDisabled,
    });
  }

  // ── Step 2: match remaining variants by colorId (existing logic) ──
  const bjByKey = new Map<string, VariantData[]>();
  const pfsByKey = new Map<string, VariantData[]>();

  for (let bi = 0; bi < bjVariants.length; bi++) {
    if (usedBj.has(bi)) continue;
    const v = bjVariants[bi];
    const key = variantGroupKey(v);
    if (!bjByKey.has(key)) bjByKey.set(key, []);
    bjByKey.get(key)!.push(v);
  }
  for (let pi = 0; pi < pfsVariants.length; pi++) {
    if (usedPfs.has(pi)) continue;
    const v = pfsVariants[pi];
    const key = variantGroupKey(v);
    if (!pfsByKey.has(key)) pfsByKey.set(key, []);
    pfsByKey.get(key)!.push(v);
  }

  const allKeys = new Set([...bjByKey.keys(), ...pfsByKey.keys()]);

  for (const key of allKeys) {
    const bj = bjByKey.get(key) ?? [];
    const pfs = pfsByKey.get(key) ?? [];
    const source = bj.length > 0 ? bj[0] : pfs[0];

    const isDiff = bj.length === 0 || pfs.length === 0 || bj.some((b, i) => {
      const p = pfs[i];
      if (!p) return true;
      return variantIsDiff(b, p);
    });

    const pfsDisabled = pfs.length > 0 && pfs.every((v) => v.isActive === false);

    matches.push({
      key,
      bjVariants: bj,
      pfsVariants: pfs,
      colorName: source.colorName,
      colorHex: source.colorHex ?? null,
      colorPatternImage: source.colorPatternImage ?? null,
      subColors: source.subColors,
      onlyIn: bj.length > 0 && pfs.length > 0 ? "both" : bj.length > 0 ? "bj" : "pfs",
      isDifferent: isDiff,
      pfsDisabled,
    });
  }

  return matches;
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function PfsLiveCompareModal({
  productId,
  initialData,
  open,
  onClose,
}: PfsLiveCompareModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [existing, setExisting] = useState<ProductData | null>(null);
  const [pfs, setPfs] = useState<ProductData | null>(null);
  const [selections, setSelections] = useState<CompareSelections>({
    name: "bj",
    description: "bj",
    category: "bj",
    compositions: "bj",
    season: "bj",
    manufacturingCountry: "bj",
    variants: {},
  });
  // ── Link existing color state ──
  const [linkColorKey, setLinkColorKey] = useState<string | null>(null); // variant key being linked
  const [linkColorPfsRef, setLinkColorPfsRef] = useState<string | null>(null);
  const [linkBjColors, setLinkBjColors] = useState<{ id: string; name: string; hex: string | null; patternImage: string | null; pfsColorRef: string | null }[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);

  const openLinkColor = useCallback(async (variantKey: string, pfsColorRef: string | null) => {
    setLinkColorKey(variantKey);
    setLinkColorPfsRef(pfsColorRef);
    setLinkLoading(true);
    try {
      const colors = await getColorsForLinking();
      setLinkBjColors(colors);
    } catch {
      setLinkBjColors([]);
    }
    setLinkLoading(false);
  }, []);

  const handleLinkColor = useCallback(async (colorId: string) => {
    if (!linkColorPfsRef) return;
    setLinkSaving(true);
    try {
      await updateColorPfsRef(colorId, linkColorPfsRef);
      setLinkColorKey(null);
      // Re-fetch data to pick up the mapping
      const res = await fetch(`/api/admin/pfs-sync/live-check/${productId}`);
      if (res.ok) {
        const data = await res.json();
        setExisting(data.existing);
        setPfs(data.pfs);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
    setLinkSaving(false);
  }, [linkColorPfsRef, productId]);

  // ── Quick Create modal state ──
  const [quickCreate, setQuickCreate] = useState<{
    type: QuickCreateType;
    defaultName: string;
    defaultPfsRef?: string;
    defaultPfsCategoryId?: string;
    defaultPfsCategoryGender?: string;
    defaultPfsCategoryFamilyId?: string;
  } | null>(null);

  const openQuickCreate = useCallback((
    type: QuickCreateType,
    name: string,
    opts?: { pfsRef?: string; pfsCategoryId?: string; pfsCategoryGender?: string; pfsCategoryFamilyId?: string },
  ) => {
    setQuickCreate({
      type,
      defaultName: name,
      defaultPfsRef: opts?.pfsRef || undefined,
      defaultPfsCategoryId: opts?.pfsCategoryId || undefined,
      defaultPfsCategoryGender: opts?.pfsCategoryGender || undefined,
      defaultPfsCategoryFamilyId: opts?.pfsCategoryFamilyId || undefined,
    });
  }, []);

  const handleQuickCreated = useCallback(async () => {
    setQuickCreate(null);
    // Re-fetch data to pick up newly created entity
    try {
      const res = await fetch(`/api/admin/pfs-sync/live-check/${productId}`);
      if (!res.ok) return;
      const data = await res.json();
      setExisting(data.existing);
      setPfs(data.pfs);
    } catch { /* ignore */ }
  }, [productId]);

  // ── Initialize selections from data ──
  const initSelectionsFromData = useCallback((data: { existing: ProductData; pfs: ProductData }) => {
    // Deduplicate PFS image groups by colorId+colorName (defensive against stale cache)
    if (data.pfs.imagesByColor && data.pfs.imagesByColor.length > 0) {
      const seen = new Map<string, typeof data.pfs.imagesByColor[0]>();
      for (const g of data.pfs.imagesByColor) {
        const dedupKey = `${g.colorId}::${g.colorName}`;
        if (seen.has(dedupKey)) {
          // Merge paths into existing group
          const existing = seen.get(dedupKey)!;
          for (const p of g.paths) {
            if (!existing.paths.includes(p)) existing.paths.push(p);
          }
        } else {
          seen.set(dedupKey, { ...g, paths: [...g.paths] });
        }
      }
      data = { ...data, pfs: { ...data.pfs, imagesByColor: Array.from(seen.values()) } };
    }
    setExisting(data.existing);
    setPfs(data.pfs);

    const variantMatches = matchVariants(data.existing.variants, data.pfs.variants);
    const variantSels: Record<string, "bj" | "pfs" | "add" | "delete_pfs"> = {};
    for (const m of variantMatches) {
      variantSels[m.key] = m.onlyIn === "pfs" ? "add" : "bj";
    }

    setSelections({
      name: "bj",
      description: "bj",
      category: "bj",
      compositions: "bj",
      season: "bj",
      manufacturingCountry: "bj",
      variants: variantSels,
    });

  }, []);

  // ── Fetch data (only if no initialData) ──
  const fetchCompareData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/admin/pfs-sync/live-check/${productId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }
      const data = await res.json();
      initSelectionsFromData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [productId, initSelectionsFromData]);

  useEffect(() => {
    if (open && productId) {
      // Reset stale state from previous session
      setSuccess(null);
      setError(null);
      setApplying(false);
      // Use cached data from banner if available, otherwise fetch
      if (initialData?.existing && initialData?.pfs) {
        initSelectionsFromData(initialData);
      } else {
        fetchCompareData();
      }
    }
  }, [open, productId, initialData, fetchCompareData, initSelectionsFromData]);

  // ── Escape key ──
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // ── Handlers ──
  const updateSelection = useCallback(
    <K extends keyof CompareSelections>(key: K, value: CompareSelections[K]) => {
      setSelections((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const updateVariantSelection = useCallback((key: string, value: "bj" | "pfs" | "add" | "delete_pfs") => {
    setSelections((prev) => ({
      ...prev,
      variants: { ...prev.variants, [key]: value },
    }));
  }, []);

  // ── Apply changes ──
  const handleApply = useCallback(async () => {
    if (!existing || !pfs) return;

    setApplying(true);
    setError(null);

    try {
      // 1. Apply field & variant selections
      const result = await applyPfsLiveSync(productId, selections, {
        name: pfs.name,
        description: pfs.description,
        categoryId: pfs.categoryId,
        categoryName: pfs.categoryName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variants: pfs.variants as any,
        compositions: pfs.compositions,
        seasonId: pfs.seasonId,
        seasonName: pfs.seasonName,
        manufacturingCountryId: pfs.manufacturingCountryId,
        manufacturingCountryName: pfs.manufacturingCountryName,
      }, {
        name: existing.name,
        description: existing.description,
        categoryId: existing.categoryId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variants: existing.variants as any,
        compositions: existing.compositions,
        seasonId: existing.seasonId,
        manufacturingCountryId: existing.manufacturingCountryId,
      });

      if (result.success) {
        const msg = result.changesApplied > 0
          ? `${result.changesApplied} modification${result.changesApplied > 1 ? "s" : ""} — synchronisé avec succès`
          : "Aucune modification à appliquer";
        setSuccess(msg);
        setTimeout(() => {
          onClose();
          window.location.reload();
        }, 1500);
      } else {
        setError(result.error ?? "Erreur inconnue");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [productId, selections, existing, pfs, onClose]);

  // ── Count changes ──
  const changesCount = useMemo(() => {
    if (!existing || !pfs) return 0;
    let count = 0;
    if (existing.name !== pfs.name) count++;
    if (existing.description !== pfs.description) count++;
    if (existing.categoryId !== pfs.categoryId) count++;
    if (normalizeComps(existing.compositions) !== normalizeComps(pfs.compositions)) count++;
    if (isSeasonDiff(existing, pfs)) count++;
    if (isCountryDiff(existing, pfs)) count++;
    for (const [, val] of Object.entries(selections.variants)) {
      if (val === "pfs" || val === "add") count++;
    }
    const varMatches = matchVariants(existing.variants, pfs.variants);
    for (const m of varMatches) {
      if (m.isDifferent && m.onlyIn === "both" && (selections.variants[m.key] === "bj" || !selections.variants[m.key])) {
        count++;
      }
    }
    for (const m of varMatches) {
      if (m.onlyIn === "bj" && selections.variants[m.key] === "bj") {
        count++;
      }
    }
    return count;
  }, [existing, pfs, selections]);

  // ── Detect unmapped PFS attributes selected for sync ──
  const unmappedPfsIssues = useMemo(() => {
    if (!pfs) return [];
    const issues: string[] = [];
    if (selections.category === "pfs" && pfs.categoryName && !pfs.categoryId) {
      issues.push(`Catégorie "${pfs.categoryName}"`);
    }
    if (selections.compositions === "pfs") {
      for (const c of pfs.compositions) {
        if (!c.compositionId) issues.push(`Composition "${c.name}"`);
      }
    }
    if (selections.season === "pfs" && pfs.seasonName && !pfs.seasonId) {
      issues.push(`Saison "${pfs.seasonName}"`);
    }
    if (selections.manufacturingCountry === "pfs" && pfs.manufacturingCountryName && !pfs.manufacturingCountryId) {
      issues.push(`Pays "${pfs.manufacturingCountryName}"`);
    }
    return issues;
  }, [selections, pfs]);

  if (!open) return null;

  const variantMatches = existing && pfs ? matchVariants(existing.variants, pfs.variants) : [];
  const totalDiffs = variantMatches.filter((m) => m.isDifferent).length
    + (existing && pfs && existing.name !== pfs.name ? 1 : 0)
    + (existing && pfs && existing.description !== pfs.description ? 1 : 0)
    + (existing && pfs && existing.categoryId !== pfs.categoryId ? 1 : 0)
    + (existing && pfs && normalizeComps(existing.compositions) !== normalizeComps(pfs.compositions) ? 1 : 0)
    + (existing && pfs && isSeasonDiff(existing, pfs) ? 1 : 0)
    + (existing && pfs && isCountryDiff(existing, pfs) ? 1 : 0);
  return (
    <>
      {/* ── Main overlay ── */}
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-6xl my-4 mx-4 sm:my-8 rounded-2xl bg-bg-primary shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 rounded-t-2xl border-b border-border bg-bg-primary/95 backdrop-blur-sm px-5 sm:px-6 py-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <SyncIcon className="h-5 w-5 text-[#F59E0B]" />
                <h2 className="text-lg font-semibold text-text-primary font-heading truncate">
                  Synchronisation Paris Fashion Shop en direct
                </h2>
                {existing && (
                  <span className="badge badge-neutral text-xs shrink-0">{existing.reference}</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#3B82F6]" />
                  Boutique (actuel)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" />
                  Paris Fashion Shop (en direct)
                </span>
                {totalDiffs > 0 && (
                  <span className="badge badge-warning text-[10px]">
                    {totalDiffs} différence{totalDiffs > 1 ? "s" : ""}
                  </span>
                )}
                {totalDiffs === 0 && existing && pfs && (
                  <span className="badge badge-success text-[10px]">
                    Aucune différence
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-bg-secondary text-text-secondary transition-colors hover:bg-border hover:text-text-primary"
              aria-label="Fermer"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          {/* ── Loading ── */}
          {loading && (
            <div className="flex flex-col items-center justify-center p-16 gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-[#F59E0B]" />
              <p className="text-sm text-text-secondary">Connexion à Paris Fashion Shop en cours...</p>
            </div>
          )}

          {/* ── Error ── */}
          {error && !loading && !success && (
            <div className="p-8 text-center">
              <p className="text-sm text-[#EF4444] mb-4">{error}</p>
              <button onClick={fetchCompareData} className="btn-secondary">
                Réessayer
              </button>
            </div>
          )}

          {/* ── Success ── */}
          {success && (
            <div className="flex flex-col items-center justify-center p-16 gap-3">
              <div className="h-12 w-12 rounded-full bg-[#22C55E]/10 flex items-center justify-center">
                <CheckIcon className="h-6 w-6 text-[#22C55E]" />
              </div>
              <p className="text-sm font-medium text-[#22C55E]">{success}</p>
            </div>
          )}

          {/* ── Content ── */}
          {existing && pfs && !loading && !success && (
            <div className="flex flex-col gap-4 p-5 sm:p-6 pb-0">

              {/* ─── Name (only if different) ─── */}
              {existing.name !== pfs.name && (
                <CompareField
                  label="Nom"
                  bjValue={existing.name}
                  pfsValue={pfs.name}
                  isDifferent={true}
                  selected={selections.name}
                  onSelect={(s) => updateSelection("name", s)}
                />
              )}

              {/* ─── Description (only if different) ─── */}
              {existing.description !== pfs.description && (
                <CompareField
                  label="Description"
                  bjValue={existing.description}
                  pfsValue={pfs.description}
                  isDifferent={true}
                  selected={selections.description}
                  onSelect={(s) => updateSelection("description", s)}
                  renderValue={(val) => (
                    <p className="text-sm text-text-primary leading-relaxed line-clamp-5 whitespace-pre-wrap">
                      {val == null || val === "" ? <span className="text-text-secondary italic">Vide</span> : String(val)}
                    </p>
                  )}
                />
              )}

              {/* ─── Category (only if different) ─── */}
              {pfs.categoryName && existing.categoryId !== pfs.categoryId && (
                <CompareField
                  label="Catégorie"
                  bjValue={existing.categoryName}
                  pfsValue={pfs.categoryName}
                  isDifferent={true}
                  selected={selections.category}
                  onSelect={(s) => updateSelection("category", s)}
                  renderValue={(val, side) => (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="badge badge-neutral text-xs">{String(val)}</span>
                      {side === "pfs" && !pfs.categoryId && (
                        <>
                          <span className="badge badge-warning text-[10px]">Non créé</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openQuickCreate("category", pfs.categoryName, {
                                pfsCategoryId: pfs.pfsCategoryPfsId ?? undefined,
                                pfsCategoryGender: pfs.pfsCategoryGender ?? undefined,
                                pfsCategoryFamilyId: pfs.pfsCategoryFamilyId ?? undefined,
                              });
                            }}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium bg-[#F59E0B]/10 text-[#D97706] hover:bg-[#F59E0B]/20 transition-colors border border-[#F59E0B]/30"
                          >
                            <PlusIcon className="h-3 w-3" />
                            Créer cette catégorie
                          </button>
                        </>
                      )}
                    </div>
                  )}
                />
              )}

              {/* ─── Compositions (only if different) ─── */}
              {pfs.compositions.length > 0 && normalizeComps(existing.compositions) !== normalizeComps(pfs.compositions) && (
                <CompareField
                  label="Compositions"
                  bjValue={existing.compositions}
                  pfsValue={pfs.compositions}
                  isDifferent={true}
                  selected={selections.compositions}
                  onSelect={(s) => updateSelection("compositions", s)}
                  renderValue={(val, side) => {
                    const comps = val as CompositionData[];
                    if (!comps || comps.length === 0) return <span className="text-text-secondary italic text-sm">Aucune</span>;
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {comps.map((c, i) => (
                          <span key={`${c.compositionId}-${i}`} className="inline-flex items-center gap-1.5 flex-wrap">
                            <span className="badge badge-neutral text-xs">
                              {c.name} — {c.percentage}%
                            </span>
                            {side === "pfs" && !c.compositionId && (
                              <>
                                <span className="badge badge-warning text-[10px]">Non créé</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); openQuickCreate("composition", c.name, { pfsRef: c.pfsRef }); }}
                                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium bg-[#F59E0B]/10 text-[#D97706] hover:bg-[#F59E0B]/20 transition-colors border border-[#F59E0B]/30"
                                >
                                  <PlusIcon className="h-3 w-3" />
                                  Créer
                                </button>
                              </>
                            )}
                          </span>
                        ))}
                      </div>
                    );
                  }}
                />
              )}

              {/* ─── Saison (only if different) ─── */}
              {isSeasonDiff(existing, pfs) && (
              <CompareField
                label="Saison"
                bjValue={existing.seasonName}
                pfsValue={pfs.seasonName}
                isDifferent={true}
                selected={selections.season}
                onSelect={(s) => updateSelection("season", s)}
                renderValue={(val, side) => (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="badge badge-neutral text-xs">{val ? String(val) : "Non défini"}</span>
                    {side === "pfs" && pfs.seasonName && !pfs.seasonId && (
                      <>
                        <span className="badge badge-warning text-[10px]">Non créé</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); openQuickCreate("season", pfs.seasonName!, { pfsRef: pfs.pfsSeasonRef ?? undefined }); }}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium bg-[#F59E0B]/10 text-[#D97706] hover:bg-[#F59E0B]/20 transition-colors border border-[#F59E0B]/30"
                        >
                          <PlusIcon className="h-3 w-3" />
                          Créer cette saison
                        </button>
                      </>
                    )}
                  </div>
                )}
              />
              )}

              {/* ─── Pays de fabrication (only if different) ─── */}
              {isCountryDiff(existing, pfs) && (
              <CompareField
                label="Pays de fabrication"
                bjValue={existing.manufacturingCountryName}
                pfsValue={pfs.manufacturingCountryName}
                isDifferent={true}
                selected={selections.manufacturingCountry}
                onSelect={(s) => updateSelection("manufacturingCountry", s)}
                renderValue={(val, side) => (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="badge badge-neutral text-xs">{val ? String(val) : "Non défini"}</span>
                    {side === "pfs" && pfs.manufacturingCountryName && !pfs.manufacturingCountryId && (
                      <>
                        <span className="badge badge-warning text-[10px]">Non créé</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); openQuickCreate("country", pfs.manufacturingCountryName!, { pfsRef: pfs.pfsCountryRef ?? undefined }); }}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium bg-[#F59E0B]/10 text-[#D97706] hover:bg-[#F59E0B]/20 transition-colors border border-[#F59E0B]/30"
                        >
                          <PlusIcon className="h-3 w-3" />
                          Créer ce pays
                        </button>
                      </>
                    )}
                  </div>
                )}
              />
              )}

              {/* ─── "All identical" message ─── */}
              {totalDiffs === 0 && (
                <div className="rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/5 p-4 text-center">
                  <CheckIcon className="h-6 w-6 text-[#22C55E] mx-auto mb-2" />
                  <p className="text-sm font-medium text-[#22C55E]">Tous les champs sont identiques</p>
                  <p className="text-xs text-text-secondary mt-1">Les images sont affichées ci-dessous pour comparaison.</p>
                </div>
              )}

              {/* ─── Variants (only non-identical) ─── */}
              {variantMatches.filter(m => m.isDifferent || m.onlyIn !== "both").length > 0 && (
              <div className="rounded-xl border border-border p-4 bg-bg-secondary/30">
                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide font-heading mb-3">
                  Variantes
                </h4>
                <div className="space-y-3">
                  {variantMatches.filter(m => m.isDifferent || m.onlyIn !== "both").map((match) => {
                    const sel = selections.variants[match.key] ?? "bj";
                    const bjV = match.bjVariants[0];
                    const pfsV = match.pfsVariants[0];
                    const source = bjV ?? pfsV;

                    return (
                      <div
                        key={match.key}
                        className={`rounded-xl border p-3 transition-all ${
                          match.onlyIn === "pfs"
                            ? "border-[#22C55E]/40 bg-[#22C55E]/5"
                            : match.onlyIn === "bj"
                              ? "border-[#EF4444]/20 bg-[#EF4444]/5"
                              : match.isDifferent
                                ? "border-[#F59E0B]/40 bg-[#F59E0B]/5"
                                : "border-border bg-bg-primary"
                        }`}
                      >
                        {/* Variant header */}
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <ColorSwatch
                              hex={source.colorHex}
                              patternImage={source.colorPatternImage}
                              subColors={getSubSegs(source)}
                              size={20}
                              rounded="full"
                              border
                            />
                            <span className="text-sm font-medium text-text-primary">
                              {fullColorName(source)}
                            </span>
                            <span className={`badge text-[10px] ${source.saleType === "PACK" ? "badge-purple" : "badge-neutral"}`}>
                              {source.saleType}{source.saleType === "PACK" && source.packQuantity ? ` ×${source.packQuantity}` : ""}
                            </span>
                            {bjV?.pfsColorRef && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-white bg-purple-600 animate-pulse">
                                Paris Fashion Shop : {bjV.pfsColorRefLabel ?? bjV.pfsColorRef}
                              </span>
                            )}
                            {match.onlyIn === "pfs" && (
                              <span className="badge badge-success text-[10px]">Nouveau (Paris Fashion Shop)</span>
                            )}
                            {match.onlyIn === "bj" && (
                              <span className="badge badge-error text-[10px]">Absent de Paris Fashion Shop</span>
                            )}
                            {match.onlyIn === "both" && match.pfsDisabled && (
                              <span className="badge badge-warning text-[10px]">Désactivé sur Paris Fashion Shop</span>
                            )}
                            {match.onlyIn === "both" && !match.pfsDisabled && match.isDifferent && (
                              <span className="badge badge-warning text-[10px]">Différent</span>
                            )}
                            {match.onlyIn === "both" && !match.isDifferent && (
                              <span className="badge badge-success text-[10px]">Identique</span>
                            )}
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center gap-2 shrink-0">
                            {match.onlyIn === "pfs" && (() => {
                              const unmappedColor = !pfsV?.colorId;
                              return (
                              <div className="flex flex-col gap-1.5">
                                {unmappedColor && (
                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-[11px] text-amber-600 dark:text-amber-400">
                                        Couleur « {pfsV?.colorName} » non mappée
                                      </span>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); openQuickCreate("color", pfsV?.colorName ?? "", { pfsRef: pfsV?.pfsColorRef ?? undefined }); }}
                                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium bg-[#F59E0B]/10 text-[#D97706] hover:bg-[#F59E0B]/20 transition-colors border border-[#F59E0B]/30"
                                      >
                                        <PlusIcon className="h-3 w-3" />
                                        Créer
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); openLinkColor(match.key, pfsV?.pfsColorRef ?? null); }}
                                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 transition-colors border border-blue-500/30"
                                      >
                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                        Lier
                                      </button>
                                    </div>
                                    {linkColorKey === match.key && (
                                      <div className="flex items-center gap-2 p-2 rounded-lg bg-bg-primary border border-border" onClick={(e) => e.stopPropagation()}>
                                        {linkLoading ? (
                                          <span className="text-[11px] text-text-secondary">Chargement...</span>
                                        ) : (
                                          <>
                                            <CustomSelect
                                              value=""
                                              onChange={(val) => { if (val) handleLinkColor(val); }}
                                              disabled={linkSaving}
                                              size="sm"
                                              searchable
                                              className="flex-1 min-w-[180px]"
                                              aria-label="Choisir une couleur existante"
                                              options={[
                                                { value: "", label: "— Choisir une couleur —" },
                                                ...linkBjColors
                                                  .filter((c) => !c.pfsColorRef)
                                                  .map((c) => ({
                                                    value: c.id,
                                                    label: c.name,
                                                  })),
                                              ]}
                                            />
                                            <button
                                              onClick={() => setLinkColorKey(null)}
                                              className="text-text-secondary hover:text-text-primary p-1"
                                            >
                                              <XMarkIcon className="h-3.5 w-3.5" />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => updateVariantSelection(match.key, "add")}
                                  disabled={unmappedColor}
                                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border transition-all min-h-[36px] ${
                                    unmappedColor
                                      ? "opacity-50 cursor-not-allowed bg-bg-secondary text-text-secondary border-border"
                                      : sel === "add"
                                        ? "bg-[#22C55E] text-white border-[#22C55E]"
                                        : "bg-bg-secondary text-text-secondary border-border hover:bg-border"
                                  }`}
                                >
                                  <PlusIcon className="h-3.5 w-3.5" />
                                  Ajouter
                                </button>
                                <button
                                  onClick={() => updateVariantSelection(match.key, "delete_pfs")}
                                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border transition-all min-h-[36px] ${
                                    sel === "delete_pfs"
                                      ? "bg-red-500 text-white border-red-500"
                                      : "bg-bg-secondary text-text-secondary border-border hover:bg-border"
                                  }`}
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                  Supprimer de Paris Fashion Shop
                                </button>
                                </div>
                              </div>
                              );
                            })()}
                            {match.onlyIn === "bj" && (
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => updateVariantSelection(match.key, "bj")}
                                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border transition-all min-h-[36px] ${
                                    sel === "bj"
                                      ? "bg-[#F59E0B] text-white border-[#F59E0B]"
                                      : "bg-bg-secondary text-text-secondary border-border hover:bg-border"
                                  }`}
                                >
                                  <SyncIcon className="h-3.5 w-3.5" />
                                  Envoyer vers Paris Fashion Shop
                                </button>
                                <button
                                  onClick={() => updateVariantSelection(match.key, "pfs")}
                                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border transition-all min-h-[36px] ${
                                    sel === "pfs"
                                      ? "bg-red-500 text-white border-red-500"
                                      : "bg-bg-secondary text-text-secondary border-border hover:bg-border"
                                  }`}
                                >
                                  <XMarkIcon className="h-3.5 w-3.5" />
                                  Ignorer
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Values side by side with select buttons inside each column */}
                        {match.onlyIn === "both" && match.isDifferent && (
                          <div className="grid grid-cols-1 md:grid-cols-2 mt-2 rounded-lg border border-border overflow-hidden">
                            {/* Boutique side */}
                            <div className={`p-3 md:border-r border-border transition-all ${
                              sel === "bj" ? "bg-[#3B82F6]/5" : "bg-bg-primary"
                            }`}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[#3B82F6] bg-[#3B82F6]/10 rounded px-1.5 py-0.5">
                                  Boutique
                                </span>
                                <SelectButton
                                  selected={sel === "bj"}
                                  onClick={() => updateVariantSelection(match.key, "bj")}
                                  side="bj"
                                />
                              </div>
                              <VariantCard variant={bjV} side="bj" selected={sel === "bj"} compact />
                            </div>
                            {/* PFS side */}
                            <div className={`p-3 border-t md:border-t-0 border-border transition-all ${
                              sel === "pfs" ? "bg-[#F59E0B]/5" : "bg-bg-primary"
                            }`}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[#F59E0B] bg-[#F59E0B]/10 rounded px-1.5 py-0.5">
                                  Paris Fashion Shop
                                </span>
                                <SelectButton
                                  selected={sel === "pfs"}
                                  onClick={() => updateVariantSelection(match.key, "pfs")}
                                  side="pfs"
                                />
                              </div>
                              <VariantCard variant={pfsV} side="pfs" selected={sel === "pfs"} compact />
                            </div>
                          </div>
                        )}
                        {match.onlyIn === "both" && !match.isDifferent && (
                          <VariantCard variant={bjV} side="bj" selected={true} compact />
                        )}
                        {match.onlyIn === "pfs" && (
                          <div className={sel === "delete_pfs" ? "opacity-40 line-through" : ""}>
                            <VariantCard variant={pfsV} side="pfs" selected={sel === "add"} />
                          </div>
                        )}
                        {match.onlyIn === "bj" && (
                          <VariantCard variant={bjV} side="bj" selected={true} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              )}


              {/* ─── Footer (sticky) ─── */}
              <div className="sticky bottom-0 -mx-5 sm:-mx-6 mt-2 flex flex-col gap-3 border-t border-border bg-bg-primary px-5 sm:px-6 py-4 rounded-b-2xl">
                {unmappedPfsIssues.length > 0 && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/5 p-3">
                    <WarningIcon className="h-4 w-4 text-[#F59E0B] shrink-0 mt-0.5" />
                    <div className="text-xs text-text-secondary">
                      <p className="font-medium text-[#D97706] mb-1">Synchronisation impossible — attribut(s) non créé(s) dans la boutique :</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {unmappedPfsIssues.map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                      <p className="mt-1.5 text-text-muted">Utilisez les boutons «&nbsp;Créer&nbsp;» ci-dessus pour créer les attributs manquants.</p>
                    </div>
                  </div>
                )}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-sm text-text-secondary">
                    {changesCount > 0 ? (
                      <span>
                        <span className="font-medium text-[#F59E0B]">{changesCount}</span> modification{changesCount > 1 ? "s" : ""} — les choix Boutique seront poussés vers Paris Fashion Shop
                      </span>
                    ) : (
                      <span>Aucune modification sélectionnée</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={onClose} className="btn-secondary min-w-[100px]">
                      Fermer
                    </button>
                    <button
                      onClick={handleApply}
                      disabled={applying || unmappedPfsIssues.length > 0}
                      className="btn-primary min-w-0 sm:min-w-[180px] bg-[#22C55E] hover:bg-[#16A34A] border-[#22C55E] disabled:opacity-50"
                      title={unmappedPfsIssues.length > 0 ? "Créez d'abord les attributs manquants" : undefined}
                    >
                      {applying ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                      ) : (
                        <CheckIcon className="h-4 w-4" />
                      )}
                      {applying ? "Synchronisation..." : changesCount > 0 ? `Synchroniser ${changesCount} modification${changesCount > 1 ? "s" : ""}` : "Synchroniser"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Quick Create Modal (for unmapped PFS attributes) ── */}
      {quickCreate && (
        <QuickCreateModal
          type={quickCreate.type}
          open={true}
          onClose={() => setQuickCreate(null)}
          onCreated={handleQuickCreated}
          defaultName={quickCreate.defaultName}
          defaultPfsRef={quickCreate.defaultPfsRef}
          defaultPfsCategoryId={quickCreate.defaultPfsCategoryId}
          defaultPfsCategoryGender={quickCreate.defaultPfsCategoryGender}
          defaultPfsCategoryFamilyId={quickCreate.defaultPfsCategoryFamilyId}
        />
      )}
    </>
  );
}

