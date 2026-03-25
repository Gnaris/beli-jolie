"use client";

import { useState, useEffect, useCallback } from "react";
import ColorSwatch from "@/components/ui/ColorSwatch";

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
  colorRef?: string;
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
}

interface ImageGroupData {
  colorId: string;
  colorName: string;
  colorRef?: string;
  colorHex?: string | null;
  colorPatternImage?: string | null;
  subColors?: SubColorData[];
  paths: string[];
}

interface CompositionData {
  compositionId: string;
  name: string;
  percentage: number;
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
  imagesByColor: ImageGroupData[];
  compositions: CompositionData[];
  tags?: string[];
  manufacturingCountryId?: string | null;
  manufacturingCountryName?: string | null;
  seasonId?: string | null;
  seasonName?: string | null;
}

// Image slot: 5 positions per color group, each can hold a path or null
// Key = colorGroupKey (colorId::subNames), value = array of 5 slots
type ImageSlots = Record<string, (string | null)[]>;

// What the user has selected for each field
interface CompareSelections {
  name: "bj" | "pfs";
  description: "bj" | "pfs";
  category: "bj" | "pfs";
  compositions: "bj" | "pfs";
  season: "bj" | "pfs";
  manufacturingCountry: "bj" | "pfs";
  // Per variant group key -> "bj" | "pfs" | "add" (new from PFS) | "remove" (only in BJ)
  variants: Record<string, "bj" | "pfs" | "add">;
  // Image slots per color group — 5 positions each
  imageSlots: ImageSlots;
}

interface PfsCompareModalProps {
  stagedProductId: string;
  open: boolean;
  onClose: () => void;
  onApprove: (id: string, selections: CompareSelections) => void;
  onReject: (id: string) => void;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function isExternal(path: string): boolean {
  return path.startsWith("http");
}

function getThumbSrc(path: string): string {
  if (!path) return "";
  if (isExternal(path)) return path; // PFS CDN URLs — don't add _thumb suffix
  if (path.endsWith(".webp")) return path.replace(/\.webp$/, "_thumb.webp");
  return path;
}

function variantGroupKey(v: VariantData): string {
  const subNames = (v.subColors ?? []).map((sc) => sc.colorName).join(",");
  return `${v.colorId}::${subNames}::${v.saleType}`;
}

function colorGroupKey(v: VariantData | ImageGroupData): string {
  const subNames = "subColors" in v && v.subColors
    ? v.subColors.map((sc) => sc.colorName).join(",")
    : "";
  const id = v.colorId || ("colorRef" in v ? v.colorRef : "") || v.colorName;
  return `${id}::${subNames}`;
}

function formatDiscount(type: "PERCENT" | "AMOUNT" | null, value: number | null): string {
  if (!type || value == null) return "—";
  return type === "PERCENT" ? `${value}%` : `${value.toFixed(2)}€`;
}

function fullColorName(v: VariantData | ImageGroupData): string {
  const parts = [v.colorName];
  if (v.subColors && v.subColors.length > 0) {
    parts.push(...v.subColors.map((sc) => sc.colorName));
  }
  return parts.join(", ");
}

function getSubSegs(v: VariantData | ImageGroupData) {
  if (!v.subColors || v.subColors.length === 0) return undefined;
  return v.subColors.map((sc) => ({
    hex: sc.hex ?? null,
    patternImage: sc.patternImage ?? null,
  }));
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

function PackageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Selection Button — "Prendre cette valeur"
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
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all ${
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
// Field Comparison Row — vertical divider layout
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
    <div className={`rounded-xl border overflow-hidden ${
      isDifferent ? "border-[#F59E0B]/40 bg-[#F59E0B]/5" : "border-border bg-bg-secondary/30"
    }`}>
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide font-[family-name:var(--font-poppins)]">
          {label}
        </h4>
        {isDifferent ? (
          <span className="badge badge-warning text-[10px]">Diff&eacute;rent</span>
        ) : (
          <span className="badge badge-success text-[10px]">Identique</span>
        )}
      </div>

      {/* Two-column grid with vertical divider */}
      <div className="grid grid-cols-1 md:grid-cols-2">
        {/* Boutique Side */}
        <div className={`p-4 md:border-r border-border transition-all ${
          selected === "bj" && isDifferent ? "bg-[#3B82F6]/5" : ""
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#3B82F6] bg-[#3B82F6]/10 rounded px-1.5 py-0.5">
              Boutique
            </span>
            {isDifferent && (
              <SelectButton selected={selected === "bj"} onClick={() => onSelect("bj")} side="bj" />
            )}
          </div>
          {render(bjValue, "bj")}
        </div>

        {/* PFS Side */}
        <div className={`p-4 border-t md:border-t-0 border-border transition-all ${
          selected === "pfs" && isDifferent ? "bg-[#F59E0B]/5" : ""
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#F59E0B] bg-[#F59E0B]/10 rounded px-1.5 py-0.5">
              PFS
            </span>
            {isDifferent && (
              <SelectButton selected={selected === "pfs"} onClick={() => onSelect("pfs")} side="pfs" />
            )}
          </div>
          {render(pfsValue, "pfs")}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Variant Comparison
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
  pfsDisabled: boolean; // PFS variant exists but is disabled (isActive=false)
}

function matchVariants(bjVariants: VariantData[], pfsVariants: VariantData[]): VariantMatch[] {
  const matches: VariantMatch[] = [];
  const bjByKey = new Map<string, VariantData[]>();
  const pfsByKey = new Map<string, VariantData[]>();

  for (const v of bjVariants) {
    const key = variantGroupKey(v);
    if (!bjByKey.has(key)) bjByKey.set(key, []);
    bjByKey.get(key)!.push(v);
  }
  for (const v of pfsVariants) {
    const key = variantGroupKey(v);
    if (!pfsByKey.has(key)) pfsByKey.set(key, []);
    pfsByKey.get(key)!.push(v);
  }

  // All keys
  const allKeys = new Set([...bjByKey.keys(), ...pfsByKey.keys()]);

  for (const key of allKeys) {
    const bj = bjByKey.get(key) ?? [];
    const pfs = pfsByKey.get(key) ?? [];
    const source = bj.length > 0 ? bj[0] : pfs[0];

    const isDiff = bj.length === 0 || pfs.length === 0 || bj.some((b, i) => {
      const p = pfs[i];
      if (!p) return true;
      return b.unitPrice !== p.unitPrice || b.stock !== p.stock || b.weight !== p.weight
        || b.discountType !== p.discountType || b.discountValue !== p.discountValue
        || b.size !== p.size;
    });

    // Check if PFS variants exist but are all disabled
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

export default function PfsCompareModal({
  stagedProductId,
  open,
  onClose,
  onApprove,
  onReject,
}: PfsCompareModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ProductData | null>(null);
  const [staged, setStaged] = useState<ProductData | null>(null);
  const [selections, setSelections] = useState<CompareSelections>({
    name: "bj",
    description: "bj",
    category: "bj",
    compositions: "bj",
    season: "bj",
    manufacturingCountry: "bj",
    variants: {},
    imageSlots: {},
  });
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [dragData, setDragData] = useState<{ path: string; pfsColorName: string } | null>(null);
  const [colorMap, setColorMap] = useState<Map<string, { hex: string | null; patternImage: string | null }>>(new Map());
  // Prepare-time differences from the API (matches card badge count)
  const [prepareDiffs, setPrepareDiffs] = useState<Array<{ field: string; stagedValue: unknown; existingValue: unknown }>>([]);

  // ── Fetch color map from DB ──
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch("/api/admin/pfs-sync/entities");
        if (res.ok) {
          const data = await res.json();
          const map = new Map<string, { hex: string | null; patternImage: string | null }>();
          for (const c of data.colors || []) {
            map.set(c.id, { hex: c.hex, patternImage: c.patternImage });
          }
          setColorMap(map);
        }
      } catch {
        // silently fail
      }
    })();
  }, [open]);

  // ── Fetch data ──
  const fetchCompareData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPrepareDiffs([]);
    try {
      const res = await fetch(`/api/admin/pfs-sync/staged/${stagedProductId}/compare`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }
      const data = await res.json();
      setExisting(data.existing);
      setStaged(data.staged);
      // Store prepare-time differences (matches card badge count)
      setPrepareDiffs(Array.isArray(data.staged.differences) ? data.staged.differences : []);

      // Initialize selections — default to "bj" for everything
      const variantMatches = matchVariants(data.existing.variants, data.staged.variants);

      const variantSels: Record<string, "bj" | "pfs" | "add"> = {};
      for (const m of variantMatches) {
        variantSels[m.key] = m.onlyIn === "pfs" ? "add" : "bj";
      }

      // Initialize image slots from existing BJ images (5 positions max per color)
      const initSlots: ImageSlots = {};
      const bjKeys = new Set<string>();
      for (const group of (data.existing.imagesByColor as ImageGroupData[])) {
        const key = colorGroupKey(group);
        bjKeys.add(key);
        const slots: (string | null)[] = [null, null, null, null, null];
        for (let i = 0; i < Math.min(group.paths.length, 5); i++) {
          slots[i] = group.paths[i];
        }
        initSlots[key] = slots;
      }
      // Also initialize slots for PFS-only colors (new colors) with their PFS images
      for (const group of (data.staged.imagesByColor as ImageGroupData[])) {
        const key = colorGroupKey(group);
        if (!bjKeys.has(key)) {
          const slots: (string | null)[] = [null, null, null, null, null];
          for (let i = 0; i < Math.min(group.paths.length, 5); i++) {
            slots[i] = group.paths[i];
          }
          initSlots[key] = slots;
        }
      }

      setSelections({
        name: "bj",
        description: "bj",
        category: "bj",
        compositions: "bj",
        season: "bj",
        manufacturingCountry: "bj",
        variants: variantSels,
        imageSlots: initSlots,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [stagedProductId]);

  useEffect(() => {
    if (open && stagedProductId) {
      fetchCompareData();
    }
  }, [open, stagedProductId, fetchCompareData]);

  // ── Handlers ──
  const updateSelection = useCallback(
    <K extends keyof CompareSelections>(key: K, value: CompareSelections[K]) => {
      setSelections((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const updateVariantSelection = useCallback((key: string, value: "bj" | "pfs" | "add") => {
    setSelections((prev) => ({
      ...prev,
      variants: { ...prev.variants, [key]: value },
    }));
  }, []);

  // Image slot drag & drop handlers
  const handleDropOnSlot = useCallback((colorKey: string, position: number, imagePath: string) => {
    setSelections((prev) => {
      const slots = [...(prev.imageSlots[colorKey] ?? [null, null, null, null, null])];
      slots[position] = imagePath;
      return {
        ...prev,
        imageSlots: { ...prev.imageSlots, [colorKey]: slots },
      };
    });
  }, []);

  const handleClearSlot = useCallback((colorKey: string, position: number) => {
    setSelections((prev) => {
      const slots = [...(prev.imageSlots[colorKey] ?? [null, null, null, null, null])];
      slots[position] = null;
      return {
        ...prev,
        imageSlots: { ...prev.imageSlots, [colorKey]: slots },
      };
    });
  }, []);

  const handleApprove = useCallback(() => {
    onApprove(stagedProductId, selections);
  }, [stagedProductId, selections, onApprove]);

  // ── Count changes ──
  const countChanges = useCallback(() => {
    if (!existing || !staged) return 0;
    let count = 0;
    if (selections.name === "pfs" && existing.name !== staged.name) count++;
    if (selections.description === "pfs" && existing.description !== staged.description) count++;
    if (selections.category === "pfs" && existing.categoryId !== staged.categoryId) count++;
    if (selections.compositions === "pfs") count++;
    if (selections.season === "pfs" && existing.seasonId !== staged.seasonId) count++;
    if (selections.manufacturingCountry === "pfs" && existing.manufacturingCountryId !== staged.manufacturingCountryId) count++;
    for (const [, val] of Object.entries(selections.variants)) {
      if (val === "pfs" || val === "add") count++;
    }
    // Images are NOT counted as differences — admin decides manually
    return count;
  }, [existing, staged, selections]);

  if (!open) return null;

  const variantMatches = existing && staged ? matchVariants(existing.variants, staged.variants) : [];
  const changesCount = countChanges();

  // Collect all BJ color groups for drop targets — sorted alphabetically
  const bjColorGroups = existing
    ? [...existing.imagesByColor].sort((a, b) => fullColorName(a).localeCompare(fullColorName(b), "fr"))
    : [];
  // Collect all PFS image groups as drag sources — sorted alphabetically
  const pfsImageGroups = staged
    ? [...staged.imagesByColor].sort((a, b) => fullColorName(a).localeCompare(fullColorName(b), "fr"))
    : [];

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
                <h2 className="text-lg font-semibold text-text-primary font-[family-name:var(--font-poppins)] truncate">
                  Comparaison produit
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
                  PFS (nouveau)
                </span>
                {prepareDiffs.length > 0 && (
                  <span className="badge badge-warning text-[10px]">
                    {prepareDiffs.length} diff&eacute;rence{prepareDiffs.length > 1 ? "s" : ""}
                  </span>
                )}
                {prepareDiffs.length === 0 && (
                  <span className="badge badge-success text-[10px]">
                    Aucune diff&eacute;rence
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

          {/* ── Loading / Error ── */}
          {loading && (
            <div className="flex items-center justify-center p-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-text-primary" />
            </div>
          )}

          {error && !loading && (
            <div className="p-8 text-center">
              <p className="text-sm text-[#EF4444]">{error}</p>
              <button onClick={fetchCompareData} className="btn-secondary mt-4">
                R&eacute;essayer
              </button>
            </div>
          )}

          {/* ── Content ── */}
          {existing && staged && !loading && (
            <div className="flex flex-col gap-4 p-5 sm:p-6 pb-0">

              {/* ─── Name ─── */}
              <CompareField
                label="Nom"
                bjValue={existing.name}
                pfsValue={staged.name}
                isDifferent={existing.name !== staged.name}
                selected={selections.name}
                onSelect={(s) => updateSelection("name", s)}
              />

              {/* ─── Description ─── */}
              <CompareField
                label="Description"
                bjValue={existing.description}
                pfsValue={staged.description}
                isDifferent={existing.description !== staged.description}
                selected={selections.description}
                onSelect={(s) => updateSelection("description", s)}
                renderValue={(val) => (
                  <p className="text-sm text-text-primary leading-relaxed line-clamp-5 whitespace-pre-wrap">
                    {val == null || val === "" ? <span className="text-text-secondary italic">Vide</span> : String(val)}
                  </p>
                )}
              />

              {/* ─── Category ─── */}
              <CompareField
                label="Cat&eacute;gorie"
                bjValue={existing.categoryName}
                pfsValue={staged.categoryName}
                isDifferent={existing.categoryId !== staged.categoryId}
                selected={selections.category}
                onSelect={(s) => updateSelection("category", s)}
                renderValue={(val) => (
                  <span className="badge badge-neutral text-xs">{String(val)}</span>
                )}
              />

              {/* ─── Compositions ─── */}
              <CompareField
                label="Compositions"
                bjValue={existing.compositions}
                pfsValue={staged.compositions}
                isDifferent={JSON.stringify(existing.compositions) !== JSON.stringify(staged.compositions)}
                selected={selections.compositions}
                onSelect={(s) => updateSelection("compositions", s)}
                renderValue={(val) => {
                  const comps = val as CompositionData[];
                  if (!comps || comps.length === 0) return <span className="text-text-secondary italic text-sm">Aucune</span>;
                  return (
                    <div className="flex flex-wrap gap-1.5">
                      {comps.map((c, i) => (
                        <span key={`${c.compositionId}-${i}`} className="badge badge-neutral text-xs">
                          {c.name} — {c.percentage}%
                        </span>
                      ))}
                    </div>
                  );
                }}
              />

              {/* ─── Season ─── */}
              <CompareField
                label="Saison"
                bjValue={existing.seasonName ?? "—"}
                pfsValue={staged.seasonName ?? "—"}
                isDifferent={existing.seasonId !== staged.seasonId}
                selected={selections.season}
                onSelect={(s) => updateSelection("season", s)}
                renderValue={(val) => (
                  <span className="badge badge-neutral text-xs">{String(val)}</span>
                )}
              />

              {/* ─── Manufacturing Country ─── */}
              <CompareField
                label="Pays de fabrication"
                bjValue={existing.manufacturingCountryName ?? "—"}
                pfsValue={staged.manufacturingCountryName ?? "—"}
                isDifferent={existing.manufacturingCountryId !== staged.manufacturingCountryId}
                selected={selections.manufacturingCountry}
                onSelect={(s) => updateSelection("manufacturingCountry", s)}
                renderValue={(val) => (
                  <span className="badge badge-neutral text-xs">{String(val)}</span>
                )}
              />

              {/* ─── Variants ─── */}
              <div className="rounded-xl border border-border p-4 bg-bg-secondary/30">
                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide font-[family-name:var(--font-poppins)] mb-3">
                  Variantes
                </h4>
                <div className="space-y-3">
                  {variantMatches.map((match) => {
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
                          <div className="flex items-center gap-2">
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
                            {match.onlyIn === "pfs" && (
                              <span className="badge badge-success text-[10px]">Nouveau (PFS)</span>
                            )}
                            {match.onlyIn === "bj" && (
                              <span className="badge badge-error text-[10px]">Absent de PFS</span>
                            )}
                            {match.onlyIn === "both" && match.pfsDisabled && (
                              <span className="badge badge-warning text-[10px]">Désactivé sur PFS</span>
                            )}
                            {match.onlyIn === "both" && !match.pfsDisabled && match.isDifferent && (
                              <span className="badge badge-warning text-[10px]">Différent</span>
                            )}
                            {match.onlyIn === "both" && !match.isDifferent && (
                              <span className="badge badge-success text-[10px]">Identique</span>
                            )}
                          </div>

                          {/* Action buttons for PFS-only variants */}
                          <div className="flex items-center gap-2 shrink-0">
                            {match.onlyIn === "pfs" && (
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => updateVariantSelection(match.key, "add")}
                                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border transition-all min-h-[36px] ${
                                    sel === "add"
                                      ? "bg-[#22C55E] text-white border-[#22C55E]"
                                      : "bg-bg-secondary text-text-secondary border-border hover:bg-border"
                                  }`}
                                >
                                  <PlusIcon className="h-3.5 w-3.5" />
                                  Ajouter
                                </button>
                                <button
                                  onClick={() => updateVariantSelection(match.key, "bj")}
                                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border transition-all min-h-[36px] ${
                                    sel === "bj"
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

                        {/* Values side by side with vertical divider */}
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
                              <VariantCard variant={bjV} side="bj" selected={sel === "bj"} bare />
                            </div>
                            {/* PFS side */}
                            <div className={`p-3 border-t md:border-t-0 border-border transition-all ${
                              sel === "pfs" ? "bg-[#F59E0B]/5" : "bg-bg-primary"
                            }`}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[#F59E0B] bg-[#F59E0B]/10 rounded px-1.5 py-0.5">
                                  PFS
                                </span>
                                <SelectButton
                                  selected={sel === "pfs"}
                                  onClick={() => updateVariantSelection(match.key, "pfs")}
                                  side="pfs"
                                />
                              </div>
                              <VariantCard variant={pfsV} side="pfs" selected={sel === "pfs"} bare />
                            </div>
                          </div>
                        )}
                        {match.onlyIn === "both" && !match.isDifferent && (
                          <VariantCard variant={bjV} side="bj" selected={true} compact />
                        )}
                        {match.onlyIn === "pfs" && (
                          <VariantCard variant={pfsV} side="pfs" selected={sel === "add"} />
                        )}
                        {match.onlyIn === "bj" && (
                          <VariantCard variant={bjV} side="bj" selected={true} />
                        )}
                      </div>
                    );
                  })}
                  {variantMatches.length === 0 && (
                    <p className="text-sm text-text-secondary py-2">Aucune variante</p>
                  )}
                </div>
              </div>

              {/* ─── Images — Two Columns ─── */}
              <div className="rounded-xl border border-border p-4 bg-bg-secondary/30">
                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide font-[family-name:var(--font-poppins)] mb-1">
                  Images
                </h4>
                <p className="text-[11px] text-text-secondary mb-4">
                  Glissez les images PFS vers les emplacements Application. Glissez entre les emplacements pour r&eacute;ordonner. Cliquez sur &times; pour retirer.
                </p>

                {/* ── Two-column layout ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* ── LEFT: Application (Boutique) ── */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#3B82F6] bg-[#3B82F6]/10 rounded px-2 py-1 mb-3 text-center">
                      Boutique
                    </div>
                    <div className="space-y-3">
                      {bjColorGroups.map((group) => {
                        const key = colorGroupKey(group);
                        const slots = selections.imageSlots[key] ?? [null, null, null, null, null];

                        return (
                          <div key={`bj-slots-${key}`} className="rounded-xl border border-[#3B82F6]/20 bg-[#3B82F6]/5 p-3">
                            <div className="flex items-center gap-1.5 mb-2">
                              <ColorSwatch
                                hex={group.colorHex}
                                patternImage={group.colorPatternImage}
                                subColors={getSubSegs(group)}
                                size={16}
                                rounded="full"
                                border
                              />
                              <span className="text-xs font-medium text-[#3B82F6]">
                                {fullColorName(group)}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                              {slots.map((slotPath, pos) => (
                                <ImageSlot
                                  key={`slot-${key}-${pos}`}
                                  position={pos}
                                  path={slotPath}
                                  isDragActive={!!dragData}
                                  onDrop={(path) => handleDropOnSlot(key, pos, path)}
                                  onClear={() => handleClearSlot(key, pos)}
                                  onZoom={(path) => setZoomSrc(path)}
                                  colorName={fullColorName(group)}
                                  colorKey={key}
                                  onReorder={(fromPos) => {
                                    // Swap slots within same color group
                                    setSelections((prev) => {
                                      const s = [...(prev.imageSlots[key] ?? [null, null, null, null, null])];
                                      const tmp = s[fromPos];
                                      s[fromPos] = s[pos];
                                      s[pos] = tmp;
                                      return { ...prev, imageSlots: { ...prev.imageSlots, [key]: s } };
                                    });
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}

                      {/* New color groups from PFS (not in BJ) */}
                      {staged && existing && (() => {
                        const bjKeys = new Set(bjColorGroups.map((g) => colorGroupKey(g)));
                        const newPfsGroups = pfsImageGroups.filter((g) => !bjKeys.has(colorGroupKey(g)));
                        if (newPfsGroups.length === 0) return null;
                        return newPfsGroups.map((group) => {
                          const key = colorGroupKey(group);
                          const slots = selections.imageSlots[key] ?? [null, null, null, null, null];
                          return (
                            <div key={`new-slots-${key}`} className="rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/5 p-3">
                              <div className="flex items-center gap-1.5 mb-2">
                                <ColorSwatch
                                  hex={group.colorHex}
                                  patternImage={group.colorPatternImage}
                                  subColors={getSubSegs(group)}
                                  size={16}
                                  rounded="full"
                                  border
                                />
                                <span className="text-xs font-medium text-[#22C55E]">
                                  {fullColorName(group)}
                                </span>
                                <span className="badge badge-success text-[10px]">Nouvelle couleur</span>
                              </div>
                              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                {slots.map((slotPath, pos) => (
                                  <ImageSlot
                                    key={`slot-new-${key}-${pos}`}
                                    position={pos}
                                    path={slotPath}
                                    isDragActive={!!dragData}
                                    onDrop={(path) => handleDropOnSlot(key, pos, path)}
                                    onClear={() => handleClearSlot(key, pos)}
                                    onZoom={(path) => setZoomSrc(path)}
                                    colorName={fullColorName(group)}
                                    colorKey={key}
                                    onReorder={(fromPos) => {
                                      setSelections((prev) => {
                                        const s = [...(prev.imageSlots[key] ?? [null, null, null, null, null])];
                                        const tmp = s[fromPos];
                                        s[fromPos] = s[pos];
                                        s[pos] = tmp;
                                        return { ...prev, imageSlots: { ...prev.imageSlots, [key]: s } };
                                      });
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        });
                      })()}

                      {bjColorGroups.length === 0 && (
                        <div className="flex items-center justify-center py-8 text-text-secondary">
                          <span className="text-sm">Aucune image Application</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── RIGHT: PFS ── */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#D97706] bg-[#F59E0B]/10 rounded px-2 py-1 mb-3 text-center">
                      PFS (source)
                    </div>
                    <div className="space-y-3">
                      {pfsImageGroups.length > 0 ? pfsImageGroups.map((group) => {
                        // Resolve color from DB colorMap if available
                        const dbColor = group.colorId ? colorMap.get(group.colorId) : null;
                        const pfsHex = dbColor?.hex ?? group.colorHex ?? null;
                        const pfsPattern = dbColor?.patternImage ?? group.colorPatternImage ?? null;
                        // Resolve sub-color swatches from DB
                        const pfsSubSegs = group.subColors?.map((sc) => {
                          const scDb = sc.colorId ? colorMap.get(sc.colorId) : null;
                          return {
                            hex: scDb?.hex ?? sc.hex ?? null,
                            patternImage: scDb?.patternImage ?? sc.patternImage ?? null,
                          };
                        });

                        return (
                        <div key={`pfs-src-${group.colorId || group.colorRef}-${fullColorName(group)}`} className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-3">
                          <div className="flex items-center gap-1.5 mb-2">
                            <ColorSwatch
                              hex={pfsHex}
                              patternImage={pfsPattern}
                              subColors={pfsSubSegs && pfsSubSegs.length > 0 ? pfsSubSegs : undefined}
                              size={16}
                              rounded="full"
                              border
                            />
                            <span className="text-xs font-medium text-[#D97706]">
                              {fullColorName(group)}
                            </span>
                            <span className="text-[10px] text-text-secondary">
                              ({group.paths.length} image{group.paths.length > 1 ? "s" : ""})
                            </span>
                          </div>
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                            {group.paths.map((path, i) => (
                              <div
                                key={`pfs-drag-${group.colorRef}-${i}`}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("text/plain", path);
                                  e.dataTransfer.setData("application/x-pfs-color", fullColorName(group));
                                  e.dataTransfer.setData("application/x-drag-type", "pfs");
                                  setDragData({ path, pfsColorName: fullColorName(group) });
                                }}
                                onDragEnd={() => setDragData(null)}
                                className="group relative aspect-square rounded-lg overflow-hidden border-2 border-[#F59E0B]/40 bg-bg-primary cursor-grab active:cursor-grabbing transition-all hover:border-[#F59E0B] hover:shadow-md"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={getThumbSrc(path)}
                                  alt={`PFS ${fullColorName(group)} ${i + 1}`}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                                <div className="absolute inset-0 flex items-end justify-center pb-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/40 to-transparent">
                                  <button
                                    onClick={() => setZoomSrc(path)}
                                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-black shadow-sm transition-transform hover:scale-110"
                                    aria-label={`Agrandir PFS ${fullColorName(group)} ${i + 1}`}
                                  >
                                    <ZoomIcon className="h-4 w-4" />
                                  </button>
                                </div>
                                {/* Position badge */}
                                <span className="absolute top-1 start-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-[#F59E0B] text-white text-[10px] font-bold">
                                  {i + 1}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                        );
                      }) : (
                        <div className="flex items-center justify-center py-8 text-text-secondary">
                          <PackageIcon className="h-8 w-8 mr-2" />
                          <span className="text-sm">Aucune image PFS</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ─── Footer (sticky) ─── */}
              <div className="sticky bottom-0 -mx-5 sm:-mx-6 mt-2 flex items-center justify-between gap-3 border-t border-border bg-bg-primary px-5 sm:px-6 py-4 rounded-b-2xl">
                <div className="text-sm text-text-secondary">
                  {changesCount > 0 ? (
                    <span>
                      <span className="font-medium text-[#F59E0B]">{changesCount}</span> modification{changesCount > 1 ? "s" : ""} s&eacute;lectionn&eacute;e{changesCount > 1 ? "s" : ""} depuis PFS
                    </span>
                  ) : (
                    <span>Aucune modification — le produit Boutique reste inchang&eacute;</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onReject(stagedProductId)}
                    className="btn-danger min-w-[120px]"
                  >
                    Refuser
                  </button>
                  <button
                    onClick={handleApprove}
                    className="btn-primary min-w-[160px] bg-[#22C55E] hover:bg-[#16A34A] border-[#22C55E]"
                  >
                    <CheckIcon className="h-4 w-4" />
                    {changesCount > 0 ? "Appliquer et approuver" : "Approuver sans changer"}
                  </button>
                  <button onClick={onClose} className="btn-secondary min-w-[100px]">
                    Fermer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Image Zoom ── */}
      {zoomSrc && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setZoomSrc(null)}
        >
          <button
            onClick={() => setZoomSrc(null)}
            className="absolute top-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Fermer le zoom"
          >
            <XIcon className="h-5 w-5" />
          </button>
          <img
            src={zoomSrc}
            alt="Zoom"
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// Icons for drag & drop
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Image Slot (drop target with position number)
// ─────────────────────────────────────────────

function ImageSlot({
  position,
  path,
  isDragActive,
  onDrop,
  onClear,
  onZoom,
  colorName,
  colorKey,
  onReorder,
}: {
  position: number;
  path: string | null;
  isDragActive: boolean;
  onDrop: (path: string) => void;
  onClear: () => void;
  onZoom: (path: string) => void;
  colorName: string;
  colorKey?: string;
  onReorder?: (fromPos: number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes("application/x-drag-type") ? "copy" : "move";
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    // Check if it's a PFS drag (external) or internal reorder
    const dragType = e.dataTransfer.getData("application/x-drag-type");
    if (dragType === "pfs") {
      // PFS → App drop
      const droppedPath = e.dataTransfer.getData("text/plain");
      if (droppedPath) onDrop(droppedPath);
    } else {
      // Internal reorder
      const fromColorKey = e.dataTransfer.getData("application/x-color-key");
      const fromPos = parseInt(e.dataTransfer.getData("application/x-slot-pos"), 10);
      if (fromColorKey === colorKey && !isNaN(fromPos) && fromPos !== position && onReorder) {
        onReorder(fromPos);
      } else if (!fromColorKey) {
        // Fallback: treat as PFS drop
        const droppedPath = e.dataTransfer.getData("text/plain");
        if (droppedPath) onDrop(droppedPath);
      }
    }
  };

  return (
    <div
      draggable={!!path}
      onDragStart={(e) => {
        if (path && colorKey) {
          e.dataTransfer.setData("application/x-color-key", colorKey);
          e.dataTransfer.setData("application/x-slot-pos", String(position));
          e.dataTransfer.setData("text/plain", path);
        }
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative aspect-square rounded-xl border-2 transition-all flex flex-col items-center justify-center
        ${path
          ? dragOver
            ? "border-text-primary ring-2 ring-text-primary/20 scale-[1.03] cursor-grab"
            : "border-[#3B82F6]/40 bg-bg-primary cursor-grab active:cursor-grabbing"
          : dragOver
            ? "border-[#F59E0B] bg-[#F59E0B]/10 scale-[1.03]"
            : isDragActive
              ? "border-dashed border-[#F59E0B]/60 bg-[#F59E0B]/5"
              : "border-dashed border-border bg-bg-secondary/50"
        }
      `}
    >
      {/* Position number badge */}
      <span className={`absolute top-1 start-1 z-10 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shadow-sm ${
        path ? "bg-[#3B82F6] text-white" : "bg-border text-text-secondary"
      }`}>
        {position + 1}
      </span>

      {path ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getThumbSrc(path)}
            alt={`${colorName} position ${position + 1}`}
            className="h-full w-full object-cover rounded-[10px]"
            loading="lazy"
            draggable={false}
          />
          {/* Clear button */}
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="absolute top-1 end-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#EF4444] text-white shadow-sm transition-transform hover:scale-110"
            aria-label={`Retirer l'image position ${position + 1}`}
          >
            <XIcon className="h-3 w-3" />
          </button>
          {/* Zoom button */}
          <button
            onClick={(e) => { e.stopPropagation(); onZoom(path); }}
            className="absolute bottom-1 right-1 h-6 w-6 rounded-md bg-black/50 text-white flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
            aria-label="Zoom"
          >
            <ZoomIcon className="h-3.5 w-3.5" />
          </button>
          {/* PFS indicator for external (PFS CDN) images */}
          {isExternal(path) && (
            <span className="absolute bottom-1 start-1 rounded bg-[#F59E0B] px-1 py-0.5 text-[8px] font-bold text-white leading-none">
              PFS
            </span>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-1 text-text-secondary pointer-events-none">
          <PlusIcon className="h-5 w-5 opacity-40" />
          <span className="text-[9px] font-medium opacity-60">Position {position + 1}</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Variant Card Sub-component
// ─────────────────────────────────────────────

function VariantCard({
  variant,
  side,
  selected,
  compact,
  bare,
}: {
  variant: VariantData;
  side: "bj" | "pfs";
  selected: boolean;
  compact?: boolean;
  bare?: boolean;
}) {
  const color = side === "bj" ? "#3B82F6" : "#F59E0B";
  const label = side === "bj" ? "Boutique" : "PFS";

  // bare mode: no wrapper styling (used inside the divider layout)
  if (bare) {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <span className="text-text-secondary">Prix unitaire</span>
          <p className="font-medium text-text-primary tabular-nums">{variant.unitPrice.toFixed(2)}&euro;</p>
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
          <p className="font-medium text-text-primary">
            {formatDiscount(variant.discountType, variant.discountValue)}
          </p>
        </div>
        <div>
          <span className="text-text-secondary">Taille</span>
          <p className="font-medium text-text-primary">{variant.sizeName ?? variant.size ?? "\u2014"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg p-3 border transition-all ${
      selected ? `border-[${color}] bg-[${color}]/5 ring-1 ring-[${color}]/20` : "border-border bg-bg-primary"
    }`} style={selected ? { borderColor: color, backgroundColor: `${color}0D`, boxShadow: `0 0 0 1px ${color}33` } : {}}>
      {!compact && (
        <span
          className="text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 mb-2 inline-block"
          style={{ color, backgroundColor: `${color}1A` }}
        >
          {label}
        </span>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <span className="text-text-secondary">Prix unitaire</span>
          <p className="font-medium text-text-primary tabular-nums">{variant.unitPrice.toFixed(2)}&euro;</p>
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
          <p className="font-medium text-text-primary">
            {formatDiscount(variant.discountType, variant.discountValue)}
          </p>
        </div>
        <div>
          <span className="text-text-secondary">Taille</span>
          <p className="font-medium text-text-primary">{variant.sizeName ?? variant.size ?? "\u2014"}</p>
        </div>
      </div>
    </div>
  );
}

export type { CompareSelections, ImageSlots, ProductData, VariantData, ImageGroupData, CompositionData };
