"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import ColorSwatch from "@/components/ui/ColorSwatch";
import { applyPfsLiveSync } from "@/app/actions/admin/pfs-live-sync";

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
  isPrimary: boolean;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
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
  imagesByColor: Array<{
    colorId: string;
    colorName: string;
    colorHex: string | null;
    colorPatternImage: string | null;
    subColors: SubColorData[];
    paths: string[];
  }>;
  compositions: CompositionData[];
}

interface CompareSelections {
  name: "bj" | "pfs";
  description: "bj" | "pfs";
  category: "bj" | "pfs";
  compositions: "bj" | "pfs";
  variants: Record<string, "bj" | "pfs" | "add">;
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
  const subNames = (v.subColors ?? []).map((sc) => sc.colorName).join(",");
  return `${v.colorId}::${subNames}::${v.saleType}`;
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

function SyncIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
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
      {label ?? (side === "bj" ? "Garder" : "Remplacer par PFS")}
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
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide font-[family-name:var(--font-poppins)]">
            {label}
          </h4>
          {isDifferent ? (
            <span className="badge badge-warning text-[10px]">Différent</span>
          ) : (
            <span className="badge badge-success text-[10px]">Identique</span>
          )}
        </div>
        {isDifferent && (
          <div className="flex items-center gap-2">
            <SelectButton selected={selected === "bj"} onClick={() => onSelect("bj")} side="bj" />
            <SelectButton selected={selected === "pfs"} onClick={() => onSelect("pfs")} side="pfs" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={`rounded-lg p-3 border transition-all ${
          selected === "bj" ? "border-[#3B82F6] bg-[#3B82F6]/5 ring-1 ring-[#3B82F6]/20" : "border-border bg-bg-primary"
        }`}>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#3B82F6] bg-[#3B82F6]/10 rounded px-1.5 py-0.5">
              Beli Jolie
            </span>
          </div>
          {render(bjValue, "bj")}
        </div>

        <div className={`rounded-lg p-3 border transition-all ${
          selected === "pfs" ? "border-[#F59E0B] bg-[#F59E0B]/5 ring-1 ring-[#F59E0B]/20" : "border-border bg-bg-primary"
        }`}>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#F59E0B] bg-[#F59E0B]/10 rounded px-1.5 py-0.5">
              PFS (actuel)
            </span>
          </div>
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
  const label = side === "bj" ? "Beli Jolie" : "PFS";

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
          <p className="font-medium text-text-primary tabular-nums">{variant.unitPrice.toFixed(2)}€</p>
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

  const allKeys = new Set([...bjByKey.keys(), ...pfsByKey.keys()]);

  for (const key of allKeys) {
    const bj = bjByKey.get(key) ?? [];
    const pfs = pfsByKey.get(key) ?? [];
    const source = bj.length > 0 ? bj[0] : pfs[0];

    const isDiff = bj.length === 0 || pfs.length === 0 || bj.some((b, i) => {
      const p = pfs[i];
      if (!p) return true;
      return b.unitPrice !== p.unitPrice || b.stock !== p.stock || b.weight !== p.weight
        || b.discountType !== p.discountType || b.discountValue !== p.discountValue;
    });

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
    variants: {},
  });

  // ── Initialize selections from data ──
  const initSelectionsFromData = useCallback((data: { existing: ProductData; pfs: ProductData }) => {
    setExisting(data.existing);
    setPfs(data.pfs);

    const variantMatches = matchVariants(data.existing.variants, data.pfs.variants);
    const variantSels: Record<string, "bj" | "pfs" | "add"> = {};
    for (const m of variantMatches) {
      variantSels[m.key] = m.onlyIn === "pfs" ? "add" : "bj";
    }

    setSelections({
      name: "bj",
      description: "bj",
      category: "bj",
      compositions: "bj",
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

  const updateVariantSelection = useCallback((key: string, value: "bj" | "pfs" | "add") => {
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
      const result = await applyPfsLiveSync(productId, selections, {
        name: pfs.name,
        description: pfs.description,
        categoryId: pfs.categoryId,
        variants: pfs.variants,
        compositions: pfs.compositions,
      });

      if (result.success) {
        setSuccess(`${result.changesApplied} modification${result.changesApplied > 1 ? "s" : ""} appliquée${result.changesApplied > 1 ? "s" : ""} avec succès`);
        // Refresh the page after a short delay
        setTimeout(() => {
          router.refresh();
          onClose();
        }, 1500);
      } else {
        setError(result.error ?? "Erreur inconnue");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [productId, selections, existing, pfs, router, onClose]);

  // ── Count changes ──
  const countChanges = useCallback(() => {
    if (!existing || !pfs) return 0;
    let count = 0;
    if (selections.name === "pfs" && existing.name !== pfs.name) count++;
    if (selections.description === "pfs" && existing.description !== pfs.description) count++;
    if (selections.category === "pfs" && existing.categoryId !== pfs.categoryId) count++;
    if (selections.compositions === "pfs") count++;
    for (const [, val] of Object.entries(selections.variants)) {
      if (val === "pfs" || val === "add") count++;
    }
    return count;
  }, [existing, pfs, selections]);

  if (!open) return null;

  const variantMatches = existing && pfs ? matchVariants(existing.variants, pfs.variants) : [];
  const totalDiffs = variantMatches.filter((m) => m.isDifferent).length
    + (existing && pfs && existing.name !== pfs.name ? 1 : 0)
    + (existing && pfs && existing.description !== pfs.description ? 1 : 0)
    + (existing && pfs && existing.categoryId !== pfs.categoryId ? 1 : 0)
    + (existing && pfs && JSON.stringify(existing.compositions) !== JSON.stringify(pfs.compositions) ? 1 : 0);
  const changesCount = countChanges();

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
                <h2 className="text-lg font-semibold text-text-primary font-[family-name:var(--font-poppins)] truncate">
                  Synchronisation PFS en direct
                </h2>
                {existing && (
                  <span className="badge badge-neutral text-xs shrink-0">{existing.reference}</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#3B82F6]" />
                  Beli Jolie (actuel)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" />
                  PFS (en direct)
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
              <p className="text-sm text-text-secondary">Connexion à PFS en cours...</p>
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

              {/* ─── Name ─── */}
              <CompareField
                label="Nom"
                bjValue={existing.name}
                pfsValue={pfs.name}
                isDifferent={existing.name !== pfs.name}
                selected={selections.name}
                onSelect={(s) => updateSelection("name", s)}
              />

              {/* ─── Description ─── */}
              <CompareField
                label="Description"
                bjValue={existing.description}
                pfsValue={pfs.description}
                isDifferent={existing.description !== pfs.description}
                selected={selections.description}
                onSelect={(s) => updateSelection("description", s)}
                renderValue={(val) => (
                  <p className="text-sm text-text-primary leading-relaxed line-clamp-5 whitespace-pre-wrap">
                    {val == null || val === "" ? <span className="text-text-secondary italic">Vide</span> : String(val)}
                  </p>
                )}
              />

              {/* ─── Category ─── */}
              {pfs.categoryName && (
                <CompareField
                  label="Catégorie"
                  bjValue={existing.categoryName}
                  pfsValue={pfs.categoryName}
                  isDifferent={existing.categoryId !== pfs.categoryId}
                  selected={selections.category}
                  onSelect={(s) => updateSelection("category", s)}
                  renderValue={(val) => (
                    <span className="badge badge-neutral text-xs">{String(val)}</span>
                  )}
                />
              )}

              {/* ─── Compositions ─── */}
              {pfs.compositions.length > 0 && (
                <CompareField
                  label="Compositions"
                  bjValue={existing.compositions}
                  pfsValue={pfs.compositions}
                  isDifferent={JSON.stringify(existing.compositions) !== JSON.stringify(pfs.compositions)}
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
              )}

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
                            {match.onlyIn === "pfs" && (
                              <span className="badge badge-success text-[10px]">Nouveau (PFS)</span>
                            )}
                            {match.onlyIn === "bj" && (
                              <span className="badge badge-error text-[10px]">Absent de PFS</span>
                            )}
                            {match.onlyIn === "both" && match.isDifferent && (
                              <span className="badge badge-warning text-[10px]">Différent</span>
                            )}
                            {match.onlyIn === "both" && !match.isDifferent && (
                              <span className="badge badge-success text-[10px]">Identique</span>
                            )}
                          </div>

                          {/* Action buttons */}
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
                            {match.onlyIn === "both" && match.isDifferent && (
                              <>
                                <SelectButton
                                  selected={sel === "bj"}
                                  onClick={() => updateVariantSelection(match.key, "bj")}
                                  side="bj"
                                />
                                <SelectButton
                                  selected={sel === "pfs"}
                                  onClick={() => updateVariantSelection(match.key, "pfs")}
                                  side="pfs"
                                />
                              </>
                            )}
                          </div>
                        </div>

                        {/* Values side by side */}
                        {match.onlyIn === "both" && match.isDifferent && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                            <VariantCard variant={bjV} side="bj" selected={sel === "bj"} />
                            <VariantCard variant={pfsV} side="pfs" selected={sel === "pfs"} />
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

              {/* ─── Footer (sticky) ─── */}
              <div className="sticky bottom-0 -mx-5 sm:-mx-6 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-border bg-bg-primary px-5 sm:px-6 py-4 rounded-b-2xl">
                <div className="text-sm text-text-secondary">
                  {changesCount > 0 ? (
                    <span>
                      <span className="font-medium text-[#F59E0B]">{changesCount}</span> modification{changesCount > 1 ? "s" : ""} sélectionnée{changesCount > 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span>Aucune modification sélectionnée</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={onClose} className="btn-secondary min-w-[100px]">
                    Fermer
                  </button>
                  {changesCount > 0 && (
                    <button
                      onClick={handleApply}
                      disabled={applying}
                      className="btn-primary min-w-0 sm:min-w-[180px] bg-[#22C55E] hover:bg-[#16A34A] border-[#22C55E] disabled:opacity-50"
                    >
                      {applying ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                      ) : (
                        <CheckIcon className="h-4 w-4" />
                      )}
                      {applying ? "Application..." : `Appliquer ${changesCount} modification${changesCount > 1 ? "s" : ""}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
