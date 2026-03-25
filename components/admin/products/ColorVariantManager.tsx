"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import ImageDropzone from "./ImageDropzone";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";
import ColorSwatch from "@/components/ui/ColorSwatch";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { fetchPfsColorsForMapping, updateColorPfsRef } from "@/app/actions/admin/colors";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";

// ─────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────

export interface SubColorState {
  colorId: string;
  colorName: string;
  colorHex: string;
}

export interface SizeEntryState {
  tempId: string;
  sizeId: string;
  sizeName: string;
  quantity: string;     // string for form input
  pricePerUnit?: string; // kept for backward compat during migration — ignored in new UI
}

export interface PackColorLineState {
  tempId: string;
  colors: { colorId: string; colorName: string; colorHex: string }[];
}

export interface VariantState {
  tempId: string;
  dbId?: string;           // ProductColor.id when editing
  // UNIT: color composition (colorId = 1ère couleur, subColors = suivantes)
  colorId: string;         // "" for PACK (colors are in packColorLines)
  colorName: string;
  colorHex: string;
  subColors: SubColorState[];
  // PACK: multiple color lines (each = a color composition)
  packColorLines: PackColorLineState[];
  // Sizes with quantities (shared across all color lines for PACK)
  sizeEntries: SizeEntryState[];
  // Pricing & metadata
  unitPrice: string;       // Prix HT par unité
  weight: string;
  stock: string;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: string;    // Quantité par paquet (PACK only)
  discountType: "" | "PERCENT" | "AMOUNT";
  discountValue: string;
  // PFS color override for multi-color variants (single-color uses Color.pfsColorRef)
  pfsColorRef: string;
}

export interface ColorImageState {
  groupKey: string;
  colorId: string;
  colorName: string;
  colorHex: string;
  imagePreviews: string[];
  uploadedPaths: string[];
  orders: number[];
  uploading: boolean;
}

export interface AvailableColor {
  id: string;
  name: string;
  hex: string | null;
  patternImage?: string | null;
  pfsColorRef?: string | null;
}

export interface AvailableSize {
  id: string;
  name: string;
  categoryIds?: string[];
}

interface Props {
  variants: VariantState[];
  colorImages: ColorImageState[];
  availableColors: AvailableColor[];
  availableSizes: AvailableSize[];
  onChange: (variants: VariantState[]) => void;
  onChangeImages: (images: ColorImageState[]) => void;
  onQuickCreateColor?: (name: string, hex: string | null, patternImage: string | null) => Promise<AvailableColor>;
  categoryId?: string;
  allCategories?: { id: string; name: string }[];
  onQuickCreateSize?: (name: string, categoryIds: string[]) => Promise<AvailableSize>;
}

// ─────────────────────────────────────────────
// Price helpers (exported for reuse in ProductForm)
// ─────────────────────────────────────────────

/** Total price = unitPrice × total quantity across all sizes.
 *  For UNIT: if no sizes, total = unitPrice × 1.
 *  For PACK: total = unitPrice × sum(quantities). */
export function computeTotalPrice(v: VariantState): number | null {
  const unit = parseFloat(v.unitPrice);
  if (isNaN(unit) || unit <= 0) return null;
  if (v.sizeEntries.length === 0) return unit;
  let totalQty = 0;
  for (const se of v.sizeEntries) {
    const qty = parseInt(se.quantity);
    if (isNaN(qty) || qty <= 0) return null;
    totalQty += qty;
  }
  return totalQty > 0 ? Math.round(unit * totalQty * 100) / 100 : unit;
}

export function computeFinalPrice(v: VariantState): number | null {
  const total = computeTotalPrice(v);
  if (total === null) return null;
  if (!v.discountType || !v.discountValue) return total;
  const disc = parseFloat(v.discountValue);
  if (isNaN(disc) || disc <= 0) return total;
  if (v.discountType === "PERCENT") return Math.max(0, total * (1 - disc / 100));
  return Math.max(0, total - disc);
}

/**
 * Compute global price = unitPrice × total quantity (same as computeTotalPrice now).
 * Kept for backward compat.
 */
export function computeGlobalPrice(v: VariantState): number | null {
  return computeTotalPrice(v);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

export function uid() { return Math.random().toString(36).slice(2, 9); }

// ─────────────────────────────────────────────
// Duplicate detection (saleType + color composition + sizes/quantities)
// ─────────────────────────────────────────────
function buildVariantDuplicateKey(v: VariantState): string {
  const sizeKey = [...v.sizeEntries]
    .sort((a, b) => a.sizeId.localeCompare(b.sizeId))
    .map((s) => `${s.sizeId}:${s.quantity}`)
    .join(",");

  if (v.saleType === "UNIT") {
    const subColorKey = v.subColors.map((sc) => sc.colorName).join(",");
    return `UNIT::${v.colorId}::${subColorKey}::${sizeKey}`;
  }
  // PACK: single color line composition + packQuantity
  const lineKey = (v.packColorLines[0]?.colors ?? []).map((c) => c.colorId).sort().join("+");
  return `PACK::${v.packQuantity}::${lineKey}::${sizeKey}`;
}

function findDuplicateVariantTempIds(variants: VariantState[]): Set<string> {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const v of variants) {
    const key = buildVariantDuplicateKey(v);
    if (seen.has(key)) {
      duplicates.add(v.tempId);
      duplicates.add(seen.get(key)!);
    } else {
      seen.set(key, v.tempId);
    }
  }
  return duplicates;
}

/** Unique key for a color+sub-colors combination. */
export function variantGroupKeyFromState(v: { colorId: string; subColors: { colorName: string }[] }): string {
  if (v.subColors.length === 0) return v.colorId;
  return `${v.colorId}::${v.subColors.map(sc => sc.colorName).join(",")}`;
}

function defaultVariant(): VariantState {
  return {
    tempId:       uid(),
    colorId:      "",
    colorName:    "",
    colorHex:     "#9CA3AF",
    subColors:    [],
    packColorLines: [],
    sizeEntries:  [],
    unitPrice:    "",
    weight:       "",
    stock:        "",
    isPrimary:    false,
    saleType:     "UNIT",
    packQuantity: "",
    discountType: "",
    discountValue: "",
    pfsColorRef: "",
  };
}

// ─────────────────────────────────────────────
// Bulk edit state
// ─────────────────────────────────────────────
interface BulkEditState {
  unitPrice:    string;
  weight:       string;
  stock:        string;
  discountType: "" | "PERCENT" | "AMOUNT";
  discountValue: string;
}

function defaultBulkEdit(): BulkEditState {
  return { unitPrice: "", weight: "", stock: "", discountType: "", discountValue: "" };
}

// ─────────────────────────────────────────────
// PFS Color Mapping types & dropdown
// ─────────────────────────────────────────────
interface PfsColorOption {
  reference: string;
  value: string;       // hex
  image: string | null;
  label: string;       // French label
}

interface PfsMappingData {
  pfsColors: PfsColorOption[];
  existingMappings: Record<string, { colorId: string; colorName: string }>;
}

function PfsColorDropdown({
  colorId,
  currentPfsRef,
  pfsData,
  onMap,
}: {
  colorId: string;
  currentPfsRef: string | null;
  pfsData: PfsMappingData;
  onMap: (colorId: string, pfsRef: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const filtered = search.trim()
    ? pfsData.pfsColors.filter((c) =>
        c.label.toLowerCase().includes(search.trim().toLowerCase()) ||
        c.reference.toLowerCase().includes(search.trim().toLowerCase())
      )
    : pfsData.pfsColors;

  const currentPfs = currentPfsRef ? pfsData.pfsColors.find((c) => c.reference === currentPfsRef) : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-1.5 border px-2 py-1.5 text-xs text-left rounded-md transition-colors min-h-[28px] ${
          currentPfsRef
            ? "bg-[#F0FDF4] border-[#BBF7D0] text-[#1A1A1A]"
            : "bg-white border-[#E5E5E5] text-[#9CA3AF] hover:border-[#9CA3AF]"
        }`}
      >
        {currentPfs ? (
          <>
            <span
              className="w-3 h-3 rounded-full shrink-0 border border-black/10"
              style={{ backgroundColor: currentPfs.value || "#9CA3AF" }}
            />
            <span className="flex-1 truncate font-[family-name:var(--font-roboto)]">{currentPfs.label}</span>
          </>
        ) : (
          <span className="flex-1 italic font-[family-name:var(--font-roboto)]">Non mappé</span>
        )}
        <svg className="w-3 h-3 shrink-0 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && createPortal(
        <div
          className="fixed bg-white border border-[#E5E5E5] rounded-lg shadow-2xl z-[9999] max-h-[220px] flex flex-col"
          style={(() => {
            const rect = ref.current?.getBoundingClientRect();
            if (!rect) return {};
            return { top: rect.bottom + 4, left: rect.left, width: rect.width };
          })()}
        >
          <div className="px-2 py-1.5 border-b border-[#F0F0F0] shrink-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="w-full text-xs bg-transparent outline-none text-[#1A1A1A] placeholder-[#9CA3AF] font-[family-name:var(--font-roboto)]"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {/* Option to unmap */}
            {currentPfsRef && (
              <button
                type="button"
                onClick={() => { onMap(colorId, null); setOpen(false); setSearch(""); }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-[#FEF2F2] text-[#EF4444] font-[family-name:var(--font-roboto)] border-b border-[#F0F0F0]"
              >
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Retirer le mapping
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-2.5 py-3 text-xs text-[#9CA3AF] text-center font-[family-name:var(--font-roboto)]">Aucun résultat</div>
            ) : filtered.map((pfs) => {
              const mapping = pfsData.existingMappings[pfs.reference];
              const isUsedByOther = mapping && mapping.colorId !== colorId;
              const isCurrentMapping = currentPfsRef === pfs.reference;

              return (
                <button
                  key={pfs.reference}
                  type="button"
                  disabled={isUsedByOther}
                  onClick={() => {
                    if (!isUsedByOther) {
                      onMap(colorId, pfs.reference);
                      setOpen(false);
                      setSearch("");
                    }
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-colors font-[family-name:var(--font-roboto)] ${
                    isUsedByOther
                      ? "opacity-50 cursor-not-allowed bg-[#F7F7F8]"
                      : isCurrentMapping
                        ? "bg-[#F0FDF4]"
                        : "hover:bg-[#F7F7F8]"
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                    style={{ backgroundColor: pfs.value || "#9CA3AF" }}
                  />
                  <span className={`flex-1 truncate ${isUsedByOther ? "line-through text-[#9CA3AF]" : "text-[#1A1A1A]"}`}>
                    {pfs.label}
                  </span>
                  {isUsedByOther && (
                    <span className="text-[9px] text-[#9CA3AF] shrink-0 whitespace-nowrap">
                      Utilisé par {mapping.colorName}
                    </span>
                  )}
                  {isCurrentMapping && (
                    <svg className="w-3 h-3 text-[#22C55E] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MultiColorSelect — modal-based multi-select (first = main, rest = sub-colors)
// With drag & drop reordering + remove in the selection zone
// ─────────────────────────────────────────────
function MultiColorSelect({ selected, options, onChange, existingVariants, editingGroupKey, pfsColorRef, onPfsColorRefChange, usedPfsColorRefs, onCreateColor }: {
  selected: { colorId: string; colorName: string; colorHex: string }[];
  options: AvailableColor[];
  onChange: (colors: { colorId: string; colorName: string; colorHex: string }[]) => void;
  existingVariants?: VariantState[];
  /** GroupKey of the variant being edited — excluded from duplicate check */
  editingGroupKey?: string;
  /** Per-variant PFS color override (multi-color only) */
  pfsColorRef?: string;
  onPfsColorRefChange?: (ref: string) => void;
  /** PFS color refs already used by other variants in this product */
  usedPfsColorRefs?: Map<string, string>; // pfsRef → variantLabel
  onCreateColor?: (name: string, hex: string | null, patternImage: string | null) => Promise<AvailableColor>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Local draft so user can review before confirming
  const [draft, setDraft] = useState(selected);

  // Drag state for reordering
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Quick-create color modal
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  // Marketplace mapping state
  const [showMapping, setShowMapping] = useState(false);
  const [pfsData, setPfsData] = useState<PfsMappingData | null>(null);
  const [pfsLoading, setPfsLoading] = useState(false);
  const [pfsSaving, setPfsSaving] = useState<string | null>(null); // colorId being saved
  // Per-variant PFS color override for multi-color combos
  const [draftPfsColorRef, setDraftPfsColorRef] = useState(pfsColorRef ?? "");

  async function loadPfsData() {
    if (pfsData) { setShowMapping(true); return; }
    setPfsLoading(true);
    try {
      const data = await fetchPfsColorsForMapping();
      setPfsData(data);
      setShowMapping(true);
    } catch (err) {
      console.error("[PFS mapping] load error:", err);
    } finally {
      setPfsLoading(false);
    }
  }

  async function handlePfsMap(colorId: string, pfsRef: string | null) {
    setPfsSaving(colorId);
    try {
      await updateColorPfsRef(colorId, pfsRef);
      // Update local pfsData mappings
      setPfsData((prev) => {
        if (!prev) return prev;
        const next = { ...prev, existingMappings: { ...prev.existingMappings } };
        // Remove old mapping for this color
        for (const [ref, m] of Object.entries(next.existingMappings)) {
          if (m.colorId === colorId) delete next.existingMappings[ref];
        }
        // Add new mapping
        if (pfsRef) {
          const opt = options.find((o) => o.id === colorId);
          next.existingMappings[pfsRef] = { colorId, colorName: opt?.name || "" };
        }
        return next;
      });
    } catch (err) {
      console.error("[PFS mapping] save error:", err);
    } finally {
      setPfsSaving(null);
    }
  }

  const openModal = useCallback(() => {
    setDraft(selected);
    setSearch("");
    setShowQuickCreate(false);
    setDraftPfsColorRef(pfsColorRef ?? "");
    setOpen(true);
  }, [selected, pfsColorRef]);

  const confirm = useCallback(() => {
    onChange(draft);
    // Propagate PFS color override for multi-color combos
    if (draft.length > 1 && onPfsColorRefChange) {
      onPfsColorRefChange(draftPfsColorRef);
    }
    setOpen(false);
  }, [draft, draftPfsColorRef, onChange, onPfsColorRefChange]);

  const cancel = useCallback(() => {
    setOpen(false);
  }, []);
  const backdropColorPicker = useBackdropClose(cancel);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const filtered = search.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  const draftIds = new Set(draft.map((s) => s.colorId));

  // Build unique existing color combinations from variants
  const existingCombinations = (() => {
    if (!existingVariants || existingVariants.length === 0) return [];
    const seen = new Set<string>();
    const combos: { key: string; colors: { colorId: string; colorName: string; colorHex: string }[]; saleTypes: string[] }[] = [];
    for (const v of existingVariants) {
      if (!v.colorId) continue;
      const gk = variantGroupKeyFromState(v);
      if (seen.has(gk)) {
        const existing = combos.find((c) => c.key === gk);
        if (existing && !existing.saleTypes.includes(v.saleType)) {
          existing.saleTypes.push(v.saleType);
        }
        continue;
      }
      seen.add(gk);
      const colors = [
        { colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex },
        ...v.subColors.map((sc) => ({ colorId: sc.colorId, colorName: sc.colorName, colorHex: sc.colorHex })),
      ];
      combos.push({ key: gk, colors, saleTypes: [v.saleType] });
    }
    return combos;
  })();

  // Check if draft matches an existing combination
  const draftGroupKey = draft.length > 0
    ? (draft.length === 1 ? draft[0].colorId : `${draft[0].colorId}::${draft.slice(1).map((s) => s.colorName).join(",")}`)
    : "";
  const matchingCombo = existingCombinations.find((c) => c.key === draftGroupKey && c.key !== editingGroupKey);

  function selectCombination(combo: typeof existingCombinations[0]) {
    setDraft(combo.colors);
  }

  function toggle(opt: AvailableColor) {
    if (draftIds.has(opt.id)) {
      setDraft(draft.filter((s) => s.colorId !== opt.id));
    } else {
      setDraft([...draft, { colorId: opt.id, colorName: opt.name, colorHex: opt.hex ?? "#9CA3AF" }]);
    }
  }

  function removeFromDraft(colorId: string) {
    setDraft(draft.filter((s) => s.colorId !== colorId));
  }

  // Drag & drop handlers for reordering
  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }
  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    setDragOverIdx(idx);
  }
  function handleDragEnd() {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      const updated = [...draft];
      const [moved] = updated.splice(dragIdx, 1);
      updated.splice(dragOverIdx, 0, moved);
      setDraft(updated);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  }

  function handleQuickColorCreated(item: { id: string; name: string; hex?: string | null }) {
    setDraft((prev) => [...prev, { colorId: item.id, colorName: item.name, colorHex: item.hex ?? "#9CA3AF" }]);
    setShowQuickCreate(false);
  }

  // Build display for the trigger button
  const displayName = selected.map((s) => s.colorName).join(" / ");
  const selectedSegments = selected.map((s) => {
    const opt = options.find((o) => o.id === s.colorId);
    return { hex: s.colorHex, patternImage: opt?.patternImage ?? null };
  });

  return (
    <div style={{ minWidth: 140 }}>
      <button
        type="button"
        onClick={openModal}
        className="w-full flex items-center gap-1.5 bg-white border border-[#E5E5E5] px-2 py-1.5 text-xs font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] hover:border-[#9CA3AF] transition-colors text-left min-h-[32px] rounded-md"
      >
        {selected.length === 0 ? (
          <span className="text-[#9CA3AF] flex-1 italic">— Couleur</span>
        ) : (
          <>
            {selectedSegments.length === 1 ? (
              <ColorSwatch hex={selectedSegments[0].hex} patternImage={selectedSegments[0].patternImage} size={14} rounded="full" />
            ) : (
              <ColorSwatch hex={selectedSegments[0]?.hex} patternImage={selectedSegments[0]?.patternImage} subColors={selectedSegments.slice(1)} size={14} rounded="full" />
            )}
            <span className="flex-1 truncate text-[11px]">{displayName}</span>
          </>
        )}
        <svg className="w-3 h-3 text-[#9CA3AF] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Modal */}
      {open && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6" onMouseDown={backdropColorPicker.onMouseDown} onMouseUp={backdropColorPicker.onMouseUp}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col"
            style={{ maxHeight: "min(90vh, 720px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5] shrink-0">
              <h3 className="text-base font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">
                Couleurs de la variante
              </h3>
              <button type="button" onClick={cancel} className="p-1.5 hover:bg-[#F7F7F8] rounded-lg transition-colors" aria-label="Fermer">
                <svg className="w-5 h-5 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* ── Selected colors zone (top, always visible) ── */}
            <div className="px-6 py-4 bg-[#FAFAFA] border-b border-[#E5E5E5] shrink-0">
              {draft.length === 0 ? (
                <div className="flex items-center gap-3 text-[#9CA3AF]">
                  <div className="w-8 h-8 rounded-full border-2 border-dashed border-[#D1D5DB] flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <span className="text-sm font-[family-name:var(--font-roboto)]">
                    Sélectionnez une ou plusieurs couleurs ci-dessous
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Chips row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {draft.map((s, i) => {
                      const opt = options.find((o) => o.id === s.colorId);
                      return (
                        <div
                          key={s.colorId}
                          draggable
                          onDragStart={() => handleDragStart(i)}
                          onDragOver={(e) => handleDragOver(e, i)}
                          onDragEnd={handleDragEnd}
                          className={`group flex items-center gap-2 pl-1.5 pr-1 py-1 rounded-full border cursor-grab active:cursor-grabbing transition-all ${
                            i === 0
                              ? "bg-[#1A1A1A] border-[#1A1A1A] text-white"
                              : dragOverIdx === i ? "bg-[#F0F0F0] border-[#1A1A1A]" : "bg-white border-[#E5E5E5] hover:border-[#9CA3AF]"
                          }`}
                        >
                          <ColorSwatch hex={s.colorHex} patternImage={opt?.patternImage ?? null} size={20} rounded="full" border />
                          <span className={`text-xs font-medium font-[family-name:var(--font-roboto)] max-w-[100px] truncate ${i === 0 ? "text-white" : "text-[#1A1A1A]"}`}>
                            {s.colorName}
                          </span>
                          {i === 0 && (
                            <span className="text-[9px] bg-white/20 text-white px-1.5 py-0.5 rounded-full font-semibold">1re</span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeFromDraft(s.colorId); }}
                            className={`p-0.5 rounded-full transition-colors ${
                              i === 0 ? "text-white/60 hover:text-white hover:bg-white/20" : "text-[#9CA3AF] hover:text-[#EF4444] hover:bg-[#FEF2F2]"
                            }`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                    {draft.length > 1 && (
                      <button type="button" onClick={() => setDraft([])} className="text-[11px] text-[#9CA3AF] hover:text-[#EF4444] font-[family-name:var(--font-roboto)] transition-colors ml-1">
                        Vider
                      </button>
                    )}
                  </div>

                  {/* Reorder hint */}
                  {draft.length > 1 && (
                    <p className="text-[10px] text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                      Glissez pour réordonner. La 1re couleur = couleur principale.
                    </p>
                  )}

                  {/* PFS mapping — inline, only for multi-color */}
                  {draft.length > 1 && (
                    <div className="flex items-center gap-3 pt-1">
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
                        <span className="text-[11px] font-semibold text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Couleur PFS</span>
                      </div>
                      {!pfsData && !pfsLoading ? (
                        <button type="button" onClick={loadPfsData} className="text-[11px] text-[#6B6B6B] hover:text-[#1A1A1A] underline font-[family-name:var(--font-roboto)]">
                          Charger les options
                        </button>
                      ) : pfsLoading ? (
                        <div className="flex items-center gap-1.5 text-[#9CA3AF]">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          <span className="text-[11px] font-[family-name:var(--font-roboto)]">Chargement…</span>
                        </div>
                      ) : pfsData ? (
                        <div className="flex-1 min-w-0">
                          <PfsColorDropdown
                            colorId={"__variant__"}
                            currentPfsRef={draftPfsColorRef || null}
                            pfsData={{
                              ...pfsData,
                              existingMappings: (() => {
                                const map: Record<string, { colorId: string; colorName: string }> = { ...pfsData.existingMappings };
                                if (usedPfsColorRefs) {
                                  for (const [ref, label] of usedPfsColorRefs) {
                                    if (!map[ref]) map[ref] = { colorId: "__other__", colorName: label };
                                  }
                                }
                                return map;
                              })(),
                            }}
                            onMap={(_id, ref) => setDraftPfsColorRef(ref ?? "")}
                          />
                        </div>
                      ) : null}
                    </div>
                  )}
                  {/* PFS conflict warning */}
                  {draft.length > 1 && draftPfsColorRef && usedPfsColorRefs?.has(draftPfsColorRef) && (
                    <p className="text-[10px] text-[#EF4444] font-[family-name:var(--font-roboto)]">
                      Couleur PFS déjà utilisée par « {usedPfsColorRefs.get(draftPfsColorRef)} »
                    </p>
                  )}

                  {/* Single-color PFS status */}
                  {draft.length === 1 && (() => {
                    const mainOpt = options.find((o) => o.id === draft[0].colorId);
                    const autoRef = mainOpt?.pfsColorRef;
                    if (!autoRef) return null;
                    return (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
                        <span className="text-[10px] text-[#22C55E] font-[family-name:var(--font-roboto)]">
                          PFS : {autoRef}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* ── Existing combinations (quick-pick bar) ── */}
            {existingCombinations.length > 0 && (
              <div className="px-6 py-2.5 border-b border-[#E5E5E5] shrink-0 bg-white">
                <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                  <span className="text-[10px] text-[#9CA3AF] font-[family-name:var(--font-roboto)] uppercase tracking-wide shrink-0">Existantes</span>
                  {existingCombinations.map((combo) => {
                    const isMatch = combo.key === draftGroupKey;
                    return (
                      <button
                        key={combo.key}
                        type="button"
                        onClick={() => selectCombination(combo)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] whitespace-nowrap transition-colors shrink-0 font-[family-name:var(--font-roboto)] ${
                          isMatch ? "border-[#22C55E] bg-[#F0FDF4] text-[#1A1A1A]" : "border-[#E5E5E5] bg-white text-[#6B6B6B] hover:border-[#9CA3AF]"
                        }`}
                      >
                        <div className="flex -space-x-0.5">
                          {combo.colors.slice(0, 3).map((c, ci) => {
                            const optC = options.find((o) => o.id === c.colorId);
                            return <ColorSwatch key={ci} hex={c.colorHex} patternImage={optC?.patternImage ?? null} size={12} rounded="full" border />;
                          })}
                        </div>
                        <span className="max-w-[100px] truncate">{combo.colors.map((c) => c.colorName).join(" / ")}</span>
                        {isMatch && (
                          <svg className="w-3 h-3 text-[#22C55E] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Color catalogue (scrollable) ── */}
            <div className="flex-1 flex flex-col min-h-0">
              {/* Search */}
              <div className="px-6 py-3 shrink-0">
                <div className="flex items-center gap-2.5 bg-[#F7F7F8] border border-[#E5E5E5] px-3 py-2 rounded-xl">
                  <svg className="w-4 h-4 text-[#9CA3AF] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher une couleur…"
                    className="flex-1 bg-transparent text-sm text-[#1A1A1A] placeholder-[#9CA3AF] outline-none min-w-0 font-[family-name:var(--font-roboto)]"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch("")} className="p-0.5 text-[#9CA3AF] hover:text-[#1A1A1A]">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Color grid */}
              <div className="flex-1 overflow-y-auto px-6 pb-3">
                {filtered.length === 0 ? (
                  <div className="py-12 text-center text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">Aucun résultat</div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {filtered.map((opt) => {
                      const isChecked = draftIds.has(opt.id);
                      const position = draft.findIndex((s) => s.colorId === opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => toggle(opt)}
                          className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center ${
                            isChecked
                              ? "border-[#1A1A1A] bg-[#F7F7F8] shadow-sm"
                              : "border-transparent bg-white hover:bg-[#F7F7F8] hover:border-[#E5E5E5]"
                          }`}
                        >
                          <div className="relative">
                            <ColorSwatch hex={opt.hex} patternImage={opt.patternImage} size={36} rounded="lg" />
                            {isChecked && (
                              <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                position === 0 ? "bg-[#1A1A1A] text-white" : "bg-[#E5E5E5] text-[#1A1A1A]"
                              }`}>
                                {position + 1}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-[family-name:var(--font-roboto)] text-[#1A1A1A] truncate w-full leading-tight">
                            {opt.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Create new color — uses the same modal as /admin/couleurs */}
              <div className="border-t border-[#E5E5E5] px-6 py-3 shrink-0 bg-white">
                <button
                  type="button"
                  onClick={() => setShowQuickCreate(true)}
                  className="flex items-center gap-2 text-sm text-[#6B6B6B] hover:text-[#1A1A1A] font-[family-name:var(--font-roboto)] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Créer une couleur
                </button>
              </div>
              <QuickCreateModal
                type="color"
                open={showQuickCreate}
                onClose={() => setShowQuickCreate(false)}
                onCreated={handleQuickColorCreated}
              />
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#E5E5E5] bg-white rounded-b-2xl shrink-0">
              {matchingCombo ? (
                <span className="text-xs text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] px-3 py-1 rounded-lg font-[family-name:var(--font-roboto)]">
                  Combinaison déjà utilisée ({matchingCombo.saleTypes.join(" + ")})
                </span>
              ) : (
                <span className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                  {draft.length === 0 ? "Aucune couleur" : `${draft.length} couleur${draft.length > 1 ? "s" : ""}`}
                </span>
              )}
              <div className="flex items-center gap-2.5">
                <button type="button" onClick={cancel}
                  className="px-5 py-2 text-sm font-medium font-[family-name:var(--font-roboto)] text-[#6B6B6B] bg-white border border-[#E5E5E5] rounded-xl hover:bg-[#F7F7F8] transition-colors"
                >
                  Annuler
                </button>
                <button type="button" onClick={confirm}
                  className="px-5 py-2 text-sm font-medium font-[family-name:var(--font-roboto)] text-white bg-[#1A1A1A] rounded-xl hover:bg-[#333] transition-colors disabled:opacity-50"
                  disabled={draft.length === 0}
                >
                  Valider
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}


// ─────────────────────────────────────────────
// ImageGalleryModal — galerie plein écran par couleur
// ─────────────────────────────────────────────
interface ImageGalleryModalProps {
  open: boolean;
  onClose: () => void;
  images: string[];
  colorName: string;
  colorHex: string;
}

function ImageGalleryModal({ open, onClose, images, colorName, colorHex }: ImageGalleryModalProps) {
  const [idx, setIdx] = useState(0);
  const backdrop = useBackdropClose(onClose);

  const prev = useCallback(() => setIdx((i) => (i === 0 ? images.length - 1 : i - 1)), [images.length]);
  const next = useCallback(() => setIdx((i) => (i === images.length - 1 ? 0 : i + 1)), [images.length]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft")  prev();
      if (e.key === "ArrowRight") next();
      if (e.key === "Escape")     onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, prev, next, onClose]);

  if (!open || images.length === 0) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div className="relative bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ width: 560, maxWidth: "95vw" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E5E5] shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full border border-[#E5E5E5] shrink-0" style={{ backgroundColor: colorHex || "#9CA3AF" }} />
            <span className="text-sm font-semibold text-[#1A1A1A] font-[family-name:var(--font-poppins)]">{colorName}</span>
            <span className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">{idx + 1} / {images.length}</span>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#F7F7F8] text-[#9CA3AF] hover:text-[#1A1A1A] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Image principale */}
        <div className="relative bg-[#F7F7F8] flex items-center justify-center" style={{ height: 400 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[idx]}
            alt={`${colorName} ${idx + 1}`}
            className="w-full h-full object-contain select-none"
            draggable={false}
          />
          {images.length > 1 && (
            <>
              <button type="button" onClick={prev}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white shadow-md rounded-full flex items-center justify-center transition-all hover:scale-105"
              >
                <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button type="button" onClick={next}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white shadow-md rounded-full flex items-center justify-center transition-all hover:scale-105"
              >
                <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Pagination */}
        {images.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 py-3 bg-white shrink-0">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                className={`rounded-full transition-all duration-200 ${
                  i === idx ? "w-6 h-2 bg-[#1A1A1A]" : "w-2 h-2 bg-[#D1D5DB] hover:bg-[#9CA3AF]"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return typeof window !== "undefined" ? createPortal(modal, document.body) : null;
}

// ─────────────────────────────────────────────
// ImageManagerModal
// ─────────────────────────────────────────────
interface ImageManagerModalProps {
  open: boolean;
  onClose: () => void;
  colorImages: ColorImageState[];
  onChange: (updated: ColorImageState[]) => void;
  variants: VariantState[];
  availableColors: AvailableColor[];
  onSetPrimary: (variantTempId: string) => void;
}

function ImageManagerModal({ open, onClose, colorImages, onChange, variants, availableColors, onSetPrimary }: ImageManagerModalProps) {
  const { confirm: confirmDialog } = useConfirm();
  const backdrop = useBackdropClose(onClose);
  const colorImagesRef = useRef(colorImages);
  colorImagesRef.current = colorImages;

  function findVariantByGroupKey(groupKey: string): VariantState | undefined {
    return variants.find((v) => variantGroupKeyFromState(v) === groupKey);
  }

  function getSwatchSegments(groupKey: string): { main: { hex?: string | null; patternImage?: string | null }; subs: { hex?: string | null; patternImage?: string | null }[] } {
    const v = findVariantByGroupKey(groupKey);
    if (!v) return { main: { hex: "#9CA3AF" }, subs: [] };
    const mainOpt = availableColors.find((c) => c.id === v.colorId);
    const main = { hex: v.colorHex || mainOpt?.hex, patternImage: mainOpt?.patternImage ?? null };
    const subs = v.subColors.map((sc) => {
      const scOpt = availableColors.find((c) => c.id === sc.colorId);
      return { hex: sc.colorHex || scOpt?.hex, patternImage: scOpt?.patternImage ?? null };
    });
    return { main, subs };
  }

  const [uploadingSlots, setUploadingSlots] = useState<Record<string, number | null>>({});
  const [rotatingSlots, setRotatingSlots] = useState<Record<string, number | null>>({});

  async function handleAddImageAtPosition(groupKey: string, file: File, position: number) {
    const state = colorImagesRef.current.find((c) => c.groupKey === groupKey);
    if (!state) return;
    const existingIdx = state.orders.indexOf(position);
    const blob = URL.createObjectURL(file);
    setUploadingSlots((prev) => ({ ...prev, [groupKey]: position }));

    if (existingIdx !== -1) {
      onChange(colorImagesRef.current.map((c) => {
        if (c.groupKey !== groupKey) return c;
        const newPreviews = [...c.imagePreviews];
        newPreviews[existingIdx] = blob;
        return { ...c, imagePreviews: newPreviews, uploading: true };
      }));
    } else {
      onChange(colorImagesRef.current.map((c) => c.groupKey === groupKey
        ? { ...c, imagePreviews: [...c.imagePreviews, blob], orders: [...c.orders, position], uploading: true }
        : c
      ));
    }

    let path = "";
    const fd = new FormData(); fd.append("image", file);
    try {
      const res = await fetch("/api/admin/products/images", { method: "POST", body: fd });
      const json = await res.json();
      if (res.ok) path = json.path;
    } catch { console.error("Erreur upload"); }

    setUploadingSlots((prev) => ({ ...prev, [groupKey]: null }));

    if (!path) {
      onChange(colorImagesRef.current.map((c) => {
        if (c.groupKey !== groupKey) return c;
        if (existingIdx !== -1) {
          return { ...c, uploading: false };
        }
        return {
          ...c,
          imagePreviews: c.imagePreviews.filter((p) => p !== blob),
          orders: c.orders.filter((_, j) => c.imagePreviews[j] !== blob),
          uploading: false,
        };
      }));
      return;
    }

    onChange(colorImagesRef.current.map((c) => {
      if (c.groupKey !== groupKey) return c;
      if (existingIdx !== -1) {
        const newPaths = [...c.uploadedPaths];
        newPaths[existingIdx] = path;
        return { ...c, uploadedPaths: newPaths, uploading: false };
      }
      return { ...c, uploadedPaths: [...c.uploadedPaths, path], uploading: false };
    }));
  }

  async function handleRemoveImageAtPosition(groupKey: string, position: number) {
    const ok = await confirmDialog({
      type: "danger",
      title: "Supprimer cette image ?",
      message: "L'image sera retirée de la variante.",
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    onChange(colorImages.map((c) => {
      if (c.groupKey !== groupKey) return c;
      const idx = c.orders.indexOf(position);
      if (idx === -1) return c;
      return {
        ...c,
        imagePreviews: c.imagePreviews.filter((_, j) => j !== idx),
        uploadedPaths: c.uploadedPaths.filter((_, j) => j !== idx),
        orders: c.orders.filter((_, j) => j !== idx),
      };
    }));
  }

  function handleSwapPositions(groupKey: string, fromPos: number, toPos: number) {
    onChange(colorImages.map((c) => {
      if (c.groupKey !== groupKey) return c;
      const newOrders = c.orders.map((o) => {
        if (o === fromPos) return toPos;
        if (o === toPos) return fromPos;
        return o;
      });
      return { ...c, orders: newOrders };
    }));
  }

  async function handleRotateAtPosition(groupKey: string, position: number) {
    const state = colorImagesRef.current.find((c) => c.groupKey === groupKey);
    if (!state) return;
    const idx = state.orders.indexOf(position);
    if (idx === -1) return;

    const preview = state.imagePreviews[idx];
    const uploadedPath = state.uploadedPaths[idx];
    if (!preview && !uploadedPath) return;

    setRotatingSlots((prev) => ({ ...prev, [groupKey]: position }));

    try {
      if (preview?.startsWith("blob:")) {
        const rotatedBlob = await rotateImageClientSide(preview);
        const newBlobUrl = URL.createObjectURL(rotatedBlob);
        const fd = new FormData();
        fd.append("image", rotatedBlob, "rotated.webp");
        const res = await fetch("/api/admin/products/images", { method: "POST", body: fd });
        const json = await res.json();
        if (res.ok && json.path) {
          onChange(colorImagesRef.current.map((c) => {
            if (c.groupKey !== groupKey) return c;
            const newPreviews = [...c.imagePreviews];
            const newPaths = [...c.uploadedPaths];
            newPreviews[idx] = newBlobUrl;
            newPaths[idx] = json.path;
            return { ...c, imagePreviews: newPreviews, uploadedPaths: newPaths };
          }));
        }
      } else {
        const pathToRotate = uploadedPath || preview;
        const cleanPath = pathToRotate.split("?")[0];
        const res = await fetch("/api/admin/products/images/rotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imagePath: cleanPath }),
        });
        const json = await res.json();
        if (res.ok && json.cacheBuster) {
          onChange(colorImagesRef.current.map((c) => {
            if (c.groupKey !== groupKey) return c;
            const newPreviews = [...c.imagePreviews];
            newPreviews[idx] = `${cleanPath}?t=${json.cacheBuster}`;
            return { ...c, imagePreviews: newPreviews };
          }));
        }
      }
    } catch (err) {
      console.error("[handleRotateAtPosition] Error:", err);
    }

    setRotatingSlots((prev) => ({ ...prev, [groupKey]: null }));
  }

  async function rotateImageClientSide(blobUrl: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.height;
        canvas.height = img.width;
        const ctx = canvas.getContext("2d")!;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas toBlob failed"));
        }, "image/webp", 0.9);
      };
      img.onerror = reject;
      img.src = blobUrl;
    });
  }

  const totalPhotos = colorImages.reduce((s, c) => s + c.imagePreviews.length, 0);

  if (!open) return null;

  const modal = (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 overflow-y-auto" onMouseDown={backdrop.onMouseDown} onMouseUp={backdrop.onMouseUp}>
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl mt-8 mb-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5]">
          <div>
            <h3 className="text-base font-bold text-[#1A1A1A] font-[family-name:var(--font-poppins)]">
              Images par couleur
            </h3>
            <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
              {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""} — partagées entre toutes les variantes de la même couleur
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#F7F7F8] text-[#9CA3AF] hover:text-[#1A1A1A] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {colorImages.length > 0 && (
            <div className="border border-[#E5E5E5] rounded-xl p-4">
              <p className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wider font-[family-name:var(--font-roboto)] mb-3">
                Couleur principale
              </p>
              <div className="flex flex-wrap gap-2">
                {colorImages.map((cimg) => {
                  const variant = findVariantByGroupKey(cimg.groupKey);
                  const isPrimary = variant?.isPrimary ?? false;
                  const seg = getSwatchSegments(cimg.groupKey);
                  return (
                    <button
                      key={cimg.groupKey}
                      type="button"
                      onClick={() => { const v = findVariantByGroupKey(cimg.groupKey); if (v) onSetPrimary(v.tempId); }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all font-[family-name:var(--font-roboto)] ${
                        isPrimary
                          ? "border-[#1A1A1A] bg-[#F7F7F8] shadow-sm"
                          : "border-[#E5E5E5] hover:border-[#9CA3AF] bg-white"
                      }`}
                    >
                      <ColorSwatch
                        hex={seg.main.hex}
                        patternImage={seg.main.patternImage}
                        subColors={seg.subs.length > 0 ? seg.subs : undefined}
                        size={16}
                        rounded="full"
                      />
                      <span className={`text-xs font-medium ${isPrimary ? "text-[#1A1A1A]" : "text-[#6B6B6B]"}`}>
                        {cimg.colorName}
                      </span>
                      {isPrimary && (
                        <svg className="w-3 h-3 text-[#22C55E] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {colorImages.length === 0 ? (
            <p className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)] text-center py-8">
              Aucune couleur dans les variantes. Ajoutez d&apos;abord des variantes.
            </p>
          ) : colorImages.map((cimg, idx) => {
            const seg = getSwatchSegments(cimg.groupKey);
            return (
            <div key={cimg.groupKey} className="border border-[#E5E5E5] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <ColorSwatch
                  hex={seg.main.hex}
                  patternImage={seg.main.patternImage}
                  subColors={seg.subs.length > 0 ? seg.subs : undefined}
                  size={16}
                  rounded="full"
                />
                <span className="text-sm font-semibold text-[#1A1A1A] font-[family-name:var(--font-roboto)]">
                  {cimg.colorName}
                </span>
                <span className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                  ({cimg.imagePreviews.length}/5)
                </span>
              </div>
              <ImageDropzone
                colorIndex={idx}
                previews={cimg.imagePreviews}
                orders={cimg.orders}
                onAddAtPosition={(file, pos) => handleAddImageAtPosition(cimg.groupKey, file, pos)}
                onRemoveAtPosition={(pos) => handleRemoveImageAtPosition(cimg.groupKey, pos)}
                onSwapPositions={(from, to) => handleSwapPositions(cimg.groupKey, from, to)}
                onRotateAtPosition={(pos) => handleRotateAtPosition(cimg.groupKey, pos)}
                onConfirmReplace={(pos) => confirmDialog({
                  type: "warning",
                  title: "Remplacer l'image ?",
                  message: `La position ${pos + 1} contient déjà une image. Voulez-vous la remplacer ?`,
                  confirmLabel: "Remplacer",
                })}
                uploading={cimg.uploading}
                uploadingPosition={uploadingSlots[cimg.groupKey] ?? null}
                rotatingPosition={rotatingSlots[cimg.groupKey] ?? null}
              />
            </div>
          );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#E5E5E5] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-lg hover:bg-black transition-colors font-[family-name:var(--font-roboto)]"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );

  return typeof window !== "undefined" ? createPortal(modal, document.body) : null;
}

// ─────────────────────────────────────────────
// SizeModal — modal for editing sizes per variant
// ─────────────────────────────────────────────
interface SizeModalProps {
  open: boolean;
  onClose: () => void;
  variant: VariantState;
  availableSizes: AvailableSize[];
  categoryId?: string;
  allCategories?: { id: string; name: string }[];
  onSave: (entries: SizeEntryState[]) => void;
  onQuickCreateSize?: (name: string, categoryIds: string[]) => Promise<AvailableSize>;
}

function SizeModal({ open, onClose, variant, availableSizes, categoryId, allCategories, onSave, onQuickCreateSize }: SizeModalProps) {
  const backdrop = useBackdropClose(onClose);
  const [draft, setDraft] = useState<SizeEntryState[]>(variant.sizeEntries);
  const [showCreate, setShowCreate] = useState(false);
  const [newSizeName, setNewSizeName] = useState("");
  const [newSizeCatIds, setNewSizeCatIds] = useState<Set<string>>(categoryId ? new Set([categoryId]) : new Set());
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");

  // Reset draft when variant changes
  useEffect(() => {
    setDraft(variant.sizeEntries);
  }, [variant.sizeEntries]);

  // Lock body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const isUnit = variant.saleType === "UNIT";
  const usedSizeIds = new Set(draft.map((s) => s.sizeId));

  // Filter sizes by category
  const filteredSizes = categoryId
    ? availableSizes.filter((s) => !s.categoryIds || s.categoryIds.length === 0 || s.categoryIds.includes(categoryId))
    : availableSizes;
  const remainingSizes = filteredSizes.filter((s) => !usedSizeIds.has(s.id));

  function toggleSize(size: AvailableSize) {
    if (usedSizeIds.has(size.id)) {
      setDraft(draft.filter((s) => s.sizeId !== size.id));
    } else {
      if (isUnit && draft.length >= 1) {
        // UNIT: replace existing
        setDraft([{ tempId: uid(), sizeId: size.id, sizeName: size.name, quantity: "1" }]);
      } else {
        setDraft([...draft, { tempId: uid(), sizeId: size.id, sizeName: size.name, quantity: "1" }]);
      }
    }
  }

  function updateQty(sizeId: string, qty: string) {
    setDraft(draft.map((s) => s.sizeId === sizeId ? { ...s, quantity: qty } : s));
  }

  function handleSave() {
    onSave(draft);
    onClose();
  }

  async function handleCreateSize() {
    if (!newSizeName.trim() || !onQuickCreateSize) return;
    setCreateSaving(true);
    setCreateError("");
    try {
      const created = await onQuickCreateSize(newSizeName.trim(), Array.from(newSizeCatIds));
      // Auto-add to draft
      if (!(isUnit && draft.length >= 1)) {
        setDraft((prev) => [...prev, { tempId: uid(), sizeId: created.id, sizeName: created.name, quantity: "1" }]);
      }
      setNewSizeName("");
      setShowCreate(false);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setCreateSaving(false);
    }
  }

  if (!open) return null;

  const modal = (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6" onMouseDown={backdrop.onMouseDown} onMouseUp={backdrop.onMouseUp}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col"
        style={{ maxHeight: "min(85vh, 600px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5] shrink-0">
          <div>
            <h3 className="text-base font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">
              {isUnit ? "Taille" : "Tailles & quantités"}
            </h3>
            <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
              {isUnit ? "Sélectionnez une taille (max 1)" : "Sélectionnez les tailles et définissez les quantités"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-[#F7F7F8] rounded-xl transition-colors" aria-label="Fermer">
            <svg className="w-5 h-5 text-[#6B6B6B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Selected sizes with quantity */}
          {draft.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide font-[family-name:var(--font-roboto)]">
                Sélectionnées ({draft.length})
              </p>
              {draft.map((se) => (
                <div key={se.tempId} className="flex items-center gap-3 px-3 py-2.5 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg">
                  <svg className="w-4 h-4 text-[#22C55E] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="flex-1 text-sm font-medium text-[#1A1A1A] font-[family-name:var(--font-roboto)]">{se.sizeName}</span>
                  {!isUnit && (
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10px] text-[#6B6B6B] font-[family-name:var(--font-roboto)]">Qté</label>
                      <input
                        type="number" min="1" step="1"
                        value={se.quantity}
                        onChange={(e) => updateQty(se.sizeId, e.target.value)}
                        className="w-16 border border-[#E5E5E5] bg-white px-2 py-1 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]"
                      />
                    </div>
                  )}
                  <button type="button" onClick={() => toggleSize({ id: se.sizeId, name: se.sizeName })} className="p-1 text-[#9CA3AF] hover:text-[#EF4444] transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Available sizes */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide font-[family-name:var(--font-roboto)]">
              Tailles disponibles
            </p>
            {filteredSizes.length === 0 ? (
              <p className="text-xs text-amber-600 font-[family-name:var(--font-roboto)]">
                Aucune taille disponible pour cette catégorie. Créez-en une ci-dessous.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {filteredSizes.map((size) => {
                  const isSelected = usedSizeIds.has(size.id);
                  return (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => toggleSize(size)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors font-[family-name:var(--font-roboto)] ${
                        isSelected
                          ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                          : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#1A1A1A] hover:text-[#1A1A1A]"
                      }`}
                    >
                      {size.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick create size */}
          {onQuickCreateSize && (
            <div className="border-t border-[#E5E5E5] pt-4">
              {!showCreate ? (
                <button
                  type="button"
                  onClick={() => { setShowCreate(true); setNewSizeCatIds(categoryId ? new Set([categoryId]) : new Set()); }}
                  className="text-sm text-[#1A1A1A] font-medium hover:underline flex items-center gap-2 font-[family-name:var(--font-roboto)]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Créer une taille
                </button>
              ) : (
                <div className="space-y-3 bg-[#F7F7F8] p-4 rounded-xl">
                  <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide font-[family-name:var(--font-roboto)]">Nouvelle taille</p>
                  <input
                    className="field-input w-full text-sm"
                    placeholder="Nom (ex: 36, S, TU...)"
                    value={newSizeName}
                    onChange={(e) => setNewSizeName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateSize(); } }}
                  />
                  {/* Category checkboxes */}
                  {allCategories && allCategories.length > 0 && (
                    <div>
                      <p className="text-[11px] text-[#6B6B6B] font-[family-name:var(--font-roboto)] mb-1.5">Catégories associées</p>
                      <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                        {allCategories.map((cat) => (
                          <label key={cat.id} className="flex items-center gap-1.5 text-xs font-[family-name:var(--font-roboto)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={newSizeCatIds.has(cat.id)}
                              onChange={() => {
                                const next = new Set(newSizeCatIds);
                                if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
                                setNewSizeCatIds(next);
                              }}
                              className="accent-[#1A1A1A] w-3.5 h-3.5"
                            />
                            {cat.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {createError && <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)]">{createError}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={handleCreateSize} disabled={createSaving || !newSizeName.trim()}
                      className="btn-primary text-xs disabled:opacity-50">{createSaving ? "Création..." : "Créer"}</button>
                    <button type="button" onClick={() => { setShowCreate(false); setCreateError(""); }}
                      className="btn-secondary text-xs">Annuler</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#E5E5E5] bg-white rounded-b-2xl shrink-0">
          <span className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
            {draft.length === 0 ? "Aucune taille" : `${draft.length} taille${draft.length > 1 ? "s" : ""}`}
            {!isUnit && draft.length > 0 && (() => {
              const totalQty = draft.reduce((a, s) => a + (parseInt(s.quantity) || 0), 0);
              return ` — ${totalQty} pièce${totalQty > 1 ? "s" : ""}`;
            })()}
          </span>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onClose}
              className="px-5 py-2 text-sm font-medium font-[family-name:var(--font-roboto)] text-[#6B6B6B] bg-white border border-[#E5E5E5] rounded-xl hover:bg-[#F7F7F8] transition-colors"
            >Annuler</button>
            <button type="button" onClick={handleSave}
              className="px-5 py-2 text-sm font-medium font-[family-name:var(--font-roboto)] text-white bg-[#1A1A1A] rounded-xl hover:bg-[#333] transition-colors"
            >Valider</button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof window !== "undefined" ? createPortal(modal, document.body) : null;
}


// ─────────────────────────────────────────────
// QuickAddModal — create multiple variants at once
// ─────────────────────────────────────────────
interface QuickAddColorLine {
  id: string;
  colors: { colorId: string; colorName: string; colorHex: string }[];
}

interface QuickAddModalProps {
  open: boolean;
  onClose: () => void;
  existingVariants: VariantState[];
  availableColors: AvailableColor[];
  availableSizes: AvailableSize[];
  categoryId?: string;
  onCreateColor?: (name: string, hex: string | null, patternImage: string | null) => Promise<AvailableColor>;
  onQuickCreateSize?: (name: string, categoryIds: string[]) => Promise<AvailableSize>;
  allCategories?: { id: string; name: string }[];
  onConfirm: (variants: VariantState[]) => void;
}

function QuickAddModal({
  open, onClose, existingVariants, availableColors, availableSizes,
  categoryId, onCreateColor, onQuickCreateSize, allCategories, onConfirm,
}: QuickAddModalProps) {
  const backdrop = useBackdropClose(onClose);

  // Color lines — each line becomes one variant
  const [colorLines, setColorLines] = useState<QuickAddColorLine[]>([
    { id: uid(), colors: [] },
  ]);

  // Shared fields
  const [saleType, setSaleType] = useState<"UNIT" | "PACK">("UNIT");
  const [unitPrice, setUnitPrice] = useState("");
  const [stock, setStock] = useState("");
  const [weight, setWeight] = useState("");
  const [discountType, setDiscountType] = useState<"" | "PERCENT" | "AMOUNT">("");
  const [discountValue, setDiscountValue] = useState("");
  const [sizeEntries, setSizeEntries] = useState<SizeEntryState[]>([]);

  // Size picker inline
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [showSizeCreate, setShowSizeCreate] = useState(false);
  const [newSizeName, setNewSizeName] = useState("");
  const [newSizeCatIds, setNewSizeCatIds] = useState<Set<string>>(categoryId ? new Set([categoryId]) : new Set());
  const [sizeCreateSaving, setSizeCreateSaving] = useState(false);
  const [sizeCreateError, setSizeCreateError] = useState("");

  // Lock body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setColorLines([{ id: uid(), colors: [] }]);
      setSaleType("UNIT");
      setUnitPrice("");
      setStock("");
      setWeight("");
      setDiscountType("");
      setDiscountValue("");
      setSizeEntries([]);
      setShowSizePicker(false);
    }
  }, [open]);

  // Existing color combos for quick-select
  const existingCombos = useMemo(() => {
    const seen = new Set<string>();
    const combos: { key: string; colors: { colorId: string; colorName: string; colorHex: string }[] }[] = [];
    for (const v of existingVariants) {
      if (!v.colorId) continue;
      const gk = variantGroupKeyFromState(v);
      if (seen.has(gk)) continue;
      seen.add(gk);
      combos.push({
        key: gk,
        colors: [
          { colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex },
          ...v.subColors.map((sc) => ({ colorId: sc.colorId, colorName: sc.colorName, colorHex: sc.colorHex })),
        ],
      });
    }
    // Also add PACK color lines
    for (const v of existingVariants) {
      if (v.saleType !== "PACK") continue;
      const line = v.packColorLines[0];
      if (!line || line.colors.length === 0) continue;
      const gk = `pack::${line.colors.map((c) => c.colorId).sort().join("+")}`;
      if (seen.has(gk)) continue;
      seen.add(gk);
      combos.push({ key: gk, colors: line.colors });
    }
    return combos;
  }, [existingVariants]);

  // Filtered sizes by category
  const filteredSizes = categoryId
    ? availableSizes.filter((s) => !s.categoryIds || s.categoryIds.length === 0 || s.categoryIds.includes(categoryId))
    : availableSizes;
  const usedSizeIds = new Set(sizeEntries.map((s) => s.sizeId));

  function addColorLine() {
    setColorLines((prev) => [...prev, { id: uid(), colors: [] }]);
  }

  function removeColorLine(lineId: string) {
    setColorLines((prev) => prev.filter((l) => l.id !== lineId));
  }

  function updateColorLine(lineId: string, colors: { colorId: string; colorName: string; colorHex: string }[]) {
    setColorLines((prev) => prev.map((l) => l.id === lineId ? { ...l, colors } : l));
  }

  function addExistingCombo(combo: typeof existingCombos[0]) {
    setColorLines((prev) => [...prev, { id: uid(), colors: combo.colors }]);
  }

  function addAllExistingCombos() {
    const newLines = existingCombos.map((c) => ({ id: uid(), colors: c.colors }));
    setColorLines((prev) => [...prev, ...newLines]);
  }

  function toggleSize(size: AvailableSize) {
    if (usedSizeIds.has(size.id)) {
      setSizeEntries((prev) => prev.filter((s) => s.sizeId !== size.id));
    } else {
      if (saleType === "UNIT" && sizeEntries.length >= 1) {
        setSizeEntries([{ tempId: uid(), sizeId: size.id, sizeName: size.name, quantity: "1" }]);
      } else {
        setSizeEntries((prev) => [...prev, { tempId: uid(), sizeId: size.id, sizeName: size.name, quantity: "1" }]);
      }
    }
  }

  function updateSizeQty(sizeId: string, qty: string) {
    setSizeEntries((prev) => prev.map((s) => s.sizeId === sizeId ? { ...s, quantity: qty } : s));
  }

  async function handleCreateSize() {
    if (!newSizeName.trim() || !onQuickCreateSize) return;
    setSizeCreateSaving(true);
    setSizeCreateError("");
    try {
      const created = await onQuickCreateSize(newSizeName.trim(), Array.from(newSizeCatIds));
      if (!(saleType === "UNIT" && sizeEntries.length >= 1)) {
        setSizeEntries((prev) => [...prev, { tempId: uid(), sizeId: created.id, sizeName: created.name, quantity: "1" }]);
      }
      setNewSizeName("");
      setShowSizeCreate(false);
    } catch (e: unknown) {
      setSizeCreateError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSizeCreateSaving(false);
    }
  }

  const validLines = colorLines.filter((l) => l.colors.length > 0);
  const canConfirm = validLines.length > 0;

  function handleConfirm() {
    const newVariants: VariantState[] = validLines.map((line, i) => {
      const [main, ...rest] = line.colors;
      const isUnit = saleType === "UNIT";
      return {
        tempId: uid(),
        colorId: isUnit ? (main?.colorId ?? "") : "",
        colorName: isUnit ? (main?.colorName ?? "") : "",
        colorHex: isUnit ? (main?.colorHex ?? "#9CA3AF") : "#9CA3AF",
        subColors: isUnit ? rest.map((c) => ({ colorId: c.colorId, colorName: c.colorName, colorHex: c.colorHex })) : [],
        packColorLines: isUnit ? [] : [{ tempId: uid(), colors: line.colors }],
        sizeEntries: sizeEntries.map((se) => ({ ...se, tempId: uid() })),
        unitPrice,
        weight,
        stock,
        isPrimary: i === 0 && existingVariants.length === 0,
        saleType,
        packQuantity: saleType === "PACK" ? (sizeEntries.length > 1 ? String(sizeEntries.length) : "1") : "",
        discountType,
        discountValue,
        pfsColorRef: "",
      };
    });
    onConfirm(newVariants);
    onClose();
  }

  if (!open) return null;

  const modal = (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6" onMouseDown={backdrop.onMouseDown} onMouseUp={backdrop.onMouseUp}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col"
        style={{ maxHeight: "min(92vh, 750px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5] shrink-0">
          <div>
            <h3 className="text-base font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">
              Création rapide de variantes
            </h3>
            <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
              Chaque ligne de couleur = 1 variante. Les autres champs sont partagés.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-[#F7F7F8] rounded-xl transition-colors" aria-label="Fermer">
            <svg className="w-5 h-5 text-[#6B6B6B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

          {/* ── Color lines ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide font-[family-name:var(--font-roboto)]">
                Couleurs ({colorLines.length} variante{colorLines.length > 1 ? "s" : ""})
              </p>
              <button type="button" onClick={addColorLine}
                className="text-xs text-[#1A1A1A] font-medium hover:underline flex items-center gap-1 font-[family-name:var(--font-roboto)]">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Ligne
              </button>
            </div>

            {colorLines.map((line, idx) => (
              <div key={line.id} className="flex items-center gap-2">
                <span className="text-[10px] text-[#9CA3AF] font-semibold w-5 text-right shrink-0 font-[family-name:var(--font-roboto)]">{idx + 1}</span>
                <div className="flex-1">
                  <MultiColorSelect
                    selected={line.colors}
                    options={availableColors}
                    onChange={(colors) => updateColorLine(line.id, colors)}
                    existingVariants={existingVariants}
                    onCreateColor={onCreateColor}
                  />
                </div>
                {colorLines.length > 1 && (
                  <button type="button" onClick={() => removeColorLine(line.id)}
                    className="p-1 text-[#9CA3AF] hover:text-[#EF4444] transition-colors shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}

            {/* Quick-add existing combos */}
            {existingCombos.length > 0 && (
              <div className="pt-2 border-t border-[#F0F0F0]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-[#9CA3AF] font-semibold uppercase tracking-wide font-[family-name:var(--font-roboto)]">
                    Couleurs existantes
                  </p>
                  <button type="button" onClick={addAllExistingCombos}
                    className="text-[10px] text-[#6B6B6B] hover:text-[#1A1A1A] font-[family-name:var(--font-roboto)] hover:underline transition-colors">
                    Tout ajouter
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {existingCombos.map((combo) => (
                    <button
                      key={combo.key}
                      type="button"
                      onClick={() => addExistingCombo(combo)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E5E5E5] bg-white hover:border-[#9CA3AF] transition-colors text-left"
                    >
                      <div className="flex -space-x-1">
                        {combo.colors.slice(0, 4).map((c, ci) => {
                          const optC = availableColors.find((o) => o.id === c.colorId);
                          return (
                            <ColorSwatch key={ci} hex={c.colorHex} patternImage={optC?.patternImage ?? null} size={14} rounded="full" border />
                          );
                        })}
                      </div>
                      <span className="text-[11px] text-[#6B6B6B] font-[family-name:var(--font-roboto)] truncate max-w-[140px]">
                        {combo.colors.map((c) => c.colorName).join(" / ")}
                      </span>
                      <svg className="w-3 h-3 text-[#9CA3AF] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Shared fields ── */}
          <div className="space-y-3 border-t border-[#E5E5E5] pt-4">
            <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide font-[family-name:var(--font-roboto)]">
              Attributs partagés
            </p>

            {/* Type + Price row */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Type</label>
                <div className="flex gap-1.5 mt-1">
                  <button type="button"
                    onClick={() => { setSaleType("UNIT"); if (sizeEntries.length > 1) setSizeEntries(sizeEntries.slice(0, 1)); }}
                    className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors font-[family-name:var(--font-roboto)] ${
                      saleType === "UNIT" ? "bg-[#3B82F6] text-white" : "border border-[#D5D5D5] text-[#6B6B6B] hover:border-[#1A1A1A]"
                    }`}>Unité</button>
                  <button type="button"
                    onClick={() => setSaleType("PACK")}
                    className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors font-[family-name:var(--font-roboto)] ${
                      saleType === "PACK" ? "bg-[#7C3AED] text-white" : "border border-[#D5D5D5] text-[#6B6B6B] hover:border-[#1A1A1A]"
                    }`}>Pack</button>
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Prix/unité (€)</label>
                <input type="number" min="0" step="0.01" value={unitPrice} placeholder="0.00"
                  onChange={(e) => setUnitPrice(e.target.value)}
                  className="w-full mt-1 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Remise</label>
                <div className="flex gap-1 mt-1">
                  <CustomSelect value={discountType}
                    onChange={(val) => { setDiscountType(val as "" | "PERCENT" | "AMOUNT"); setDiscountValue(""); }}
                    options={[{ value: "", label: "—" }, { value: "PERCENT", label: "%" }, { value: "AMOUNT", label: "€" }]}
                    size="sm" className="w-[60px]" />
                  {discountType && (
                    <input type="number" min="0" step="0.01" value={discountValue} placeholder="0"
                      onChange={(e) => setDiscountValue(e.target.value)}
                      className="w-16 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
                  )}
                </div>
              </div>
            </div>

            {/* Stock + Weight row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Stock</label>
                <input type="number" min="0" step="1" value={stock} placeholder="0"
                  onChange={(e) => setStock(e.target.value)}
                  className="w-full mt-1 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Poids (kg)</label>
                <input type="number" min="0" step="0.001" value={weight} placeholder="0.000"
                  onChange={(e) => setWeight(e.target.value)}
                  className="w-full mt-1 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
              </div>
            </div>

            {/* Sizes */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">
                  Tailles {saleType === "UNIT" ? "(max 1)" : "& quantités"}
                </label>
                <button type="button" onClick={() => setShowSizePicker(!showSizePicker)}
                  className="text-[10px] text-[#6B6B6B] hover:text-[#1A1A1A] font-[family-name:var(--font-roboto)] hover:underline transition-colors">
                  {showSizePicker ? "Masquer" : "Modifier"}
                </button>
              </div>

              {/* Selected sizes summary */}
              {sizeEntries.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {sizeEntries.map((se) => (
                    <span key={se.tempId} className="inline-flex items-center gap-1 px-2 py-1 bg-[#F0FDF4] border border-[#BBF7D0] rounded-md text-xs font-[family-name:var(--font-roboto)]">
                      {se.sizeName}
                      {saleType === "PACK" && <span className="text-[#6B6B6B]">×{se.quantity}</span>}
                      <button type="button" onClick={() => setSizeEntries((prev) => prev.filter((s) => s.sizeId !== se.sizeId))}
                        className="text-[#9CA3AF] hover:text-[#EF4444] ml-0.5">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#9CA3AF] italic mt-1 font-[family-name:var(--font-roboto)]">Aucune taille</p>
              )}

              {/* Size picker dropdown */}
              {showSizePicker && (
                <div className="mt-2 p-3 bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl space-y-3">
                  {/* Available sizes as toggle buttons */}
                  <div className="flex flex-wrap gap-1.5">
                    {filteredSizes.map((size) => {
                      const isSelected = usedSizeIds.has(size.id);
                      return (
                        <button key={size.id} type="button" onClick={() => toggleSize(size)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors font-[family-name:var(--font-roboto)] ${
                            isSelected ? "bg-[#1A1A1A] text-white border-[#1A1A1A]" : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#1A1A1A]"
                          }`}>
                          {size.name}
                        </button>
                      );
                    })}
                    {filteredSizes.length === 0 && (
                      <p className="text-xs text-amber-600 font-[family-name:var(--font-roboto)]">Aucune taille pour cette catégorie.</p>
                    )}
                  </div>

                  {/* PACK: quantity per size */}
                  {saleType === "PACK" && sizeEntries.length > 0 && (
                    <div className="space-y-1.5">
                      {sizeEntries.map((se) => (
                        <div key={se.tempId} className="flex items-center gap-2">
                          <span className="text-xs text-[#1A1A1A] font-medium w-16 font-[family-name:var(--font-roboto)]">{se.sizeName}</span>
                          <input type="number" min="1" step="1" value={se.quantity}
                            onChange={(e) => updateSizeQty(se.sizeId, e.target.value)}
                            className="w-16 border border-[#E5E5E5] bg-white px-2 py-1 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]"
                          />
                          <span className="text-[10px] text-[#9CA3AF] font-[family-name:var(--font-roboto)]">pièces</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Quick create size */}
                  {onQuickCreateSize && (
                    !showSizeCreate ? (
                      <button type="button" onClick={() => { setShowSizeCreate(true); setNewSizeCatIds(categoryId ? new Set([categoryId]) : new Set()); }}
                        className="text-xs text-[#6B6B6B] hover:text-[#1A1A1A] flex items-center gap-1 font-[family-name:var(--font-roboto)] hover:underline transition-colors">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Créer une taille
                      </button>
                    ) : (
                      <div className="space-y-2 bg-white p-3 rounded-lg border border-[#E5E5E5]">
                        <input className="field-input w-full text-sm" placeholder="Nom (ex: 36, S, TU...)" value={newSizeName}
                          onChange={(e) => setNewSizeName(e.target.value)} autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateSize(); } }} />
                        {allCategories && allCategories.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {allCategories.map((cat) => (
                              <label key={cat.id} className="flex items-center gap-1 text-[11px] font-[family-name:var(--font-roboto)] cursor-pointer">
                                <input type="checkbox" checked={newSizeCatIds.has(cat.id)}
                                  onChange={() => { const n = new Set(newSizeCatIds); if (n.has(cat.id)) n.delete(cat.id); else n.add(cat.id); setNewSizeCatIds(n); }}
                                  className="accent-[#1A1A1A] w-3 h-3" />
                                {cat.name}
                              </label>
                            ))}
                          </div>
                        )}
                        {sizeCreateError && <p className="text-xs text-[#EF4444]">{sizeCreateError}</p>}
                        <div className="flex gap-2">
                          <button type="button" onClick={handleCreateSize} disabled={sizeCreateSaving || !newSizeName.trim()}
                            className="btn-primary text-xs disabled:opacity-50">{sizeCreateSaving ? "..." : "Créer"}</button>
                          <button type="button" onClick={() => { setShowSizeCreate(false); setSizeCreateError(""); }}
                            className="btn-secondary text-xs">Annuler</button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#E5E5E5] bg-white rounded-b-2xl shrink-0">
          <span className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
            {validLines.length === 0
              ? "Aucune couleur sélectionnée"
              : `${validLines.length} variante${validLines.length > 1 ? "s" : ""} à créer`
            }
          </span>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onClose}
              className="px-5 py-2 text-sm font-medium font-[family-name:var(--font-roboto)] text-[#6B6B6B] bg-white border border-[#E5E5E5] rounded-xl hover:bg-[#F7F7F8] transition-colors"
            >Annuler</button>
            <button type="button" onClick={handleConfirm} disabled={!canConfirm}
              className="px-5 py-2 text-sm font-medium font-[family-name:var(--font-roboto)] text-white bg-[#1A1A1A] rounded-xl hover:bg-[#333] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >Créer {validLines.length > 0 ? `${validLines.length} variante${validLines.length > 1 ? "s" : ""}` : ""}</button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof window !== "undefined" ? createPortal(modal, document.body) : null;
}


// ─────────────────────────────────────────────
// Main component — TABLE LAYOUT
// ─────────────────────────────────────────────

export default function ColorVariantManager({
  variants,
  colorImages,
  availableColors,
  availableSizes,
  onChange,
  onChangeImages,
  onQuickCreateColor,
  categoryId,
  allCategories,
  onQuickCreateSize,
}: Props) {
  const { confirm: confirmDialog } = useConfirm();
  const [showImageModal, setShowImageModal] = useState(false);
  const [galleryState, setGalleryState] = useState<{ images: string[]; colorName: string; colorHex: string } | null>(null);

  // ── Bulk edit state ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEdit, setBulkEdit]       = useState<BulkEditState>(defaultBulkEdit());
  const selectAllRef                  = useRef<HTMLInputElement>(null);

  // ── Size modal state ─────────────────────────────────────────────────────
  const [sizeModalVariantId, setSizeModalVariantId] = useState<string | null>(null);
  const sizeModalVariant = variants.find((v) => v.tempId === sizeModalVariantId);

  // ── Quick-add modal state ─────────────────────────────────────────────────
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  useEffect(() => {
    if (selectAllRef.current) {
      const allSelected  = selectedIds.size === variants.length && variants.length > 0;
      const someSelected = selectedIds.size > 0 && !allSelected;
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [selectedIds, variants.length]);

  const totalPhotos   = colorImages.reduce((s, c) => s + c.imagePreviews.length, 0);
  const showBulkRow   = selectedIds.size > 0;
  const duplicateTempIds = findDuplicateVariantTempIds(variants);

  // ── Mutations ─────────────────────────────────────────────────────────────
  function updateVariant(tempId: string, patch: Partial<VariantState>) {
    onChange(variants.map((v) => v.tempId === tempId ? { ...v, ...patch } : v));
  }

  function setPrimary(tempId: string) {
    onChange(variants.map((v) => ({ ...v, isPrimary: v.tempId === tempId })));
  }

  function addVariant() {
    const def = defaultVariant();
    const isPrimary = variants.length === 0;
    const newV = { ...def, isPrimary };
    onChange([...variants, newV]);
  }

  function handleQuickAddConfirm(newVariants: VariantState[]) {
    // If no existing variants, first new one is primary
    if (variants.length === 0 && newVariants.length > 0) {
      newVariants[0].isPrimary = true;
    }
    onChange([...variants, ...newVariants]);
  }

  async function removeVariant(tempId: string) {
    if (variants.length <= 1) return;
    const target = variants.find((v) => v.tempId === tempId);
    const label = target ? `${target.saleType === "PACK" ? "Pack" : "Unité"} ${target.colorName || ""}`.trim() : "cette variante";
    const ok = await confirmDialog({ title: "Supprimer la variante ?", message: `Voulez-vous supprimer « ${label} » ?`, confirmLabel: "Supprimer", type: "danger" });
    if (!ok) return;
    let newVariants = variants.filter((v) => v.tempId !== tempId);
    if (target?.isPrimary && newVariants.length > 0) {
      newVariants = newVariants.map((v, i) => ({ ...v, isPrimary: i === 0 }));
    }
    const next = new Set(selectedIds);
    next.delete(tempId);
    setSelectedIds(next);
    onChange(newVariants);
  }

  function handleMultiColorChange(tempIds: Set<string>, colors: { colorId: string; colorName: string; colorHex: string }[]) {
    if (colors.length === 0) {
      onChange(variants.map((v) => tempIds.has(v.tempId) ? { ...v, colorId: "", colorName: "", colorHex: "#9CA3AF", subColors: [], pfsColorRef: "" } : v));
      return;
    }
    const [main, ...rest] = colors;
    onChange(variants.map((v) => {
      if (!tempIds.has(v.tempId)) return v;
      // Check if color combination actually changed — if so, clear pfsColorRef override
      const oldKey = variantGroupKeyFromState(v);
      const newKey = rest.length === 0 ? main.colorId : `${main.colorId}::${rest.map((c) => c.colorName).join(",")}`;
      return {
        ...v,
        colorId: main.colorId, colorName: main.colorName, colorHex: main.colorHex,
        subColors: rest.map((c) => ({ colorId: c.colorId, colorName: c.colorName, colorHex: c.colorHex })),
        // Clear PFS override if combination changed
        pfsColorRef: oldKey === newKey ? v.pfsColorRef : "",
      };
    }));
  }

  // ── Pack color line management ─────────────────────────────────────────────
  function updatePackColorLine(variantTempId: string, colors: { colorId: string; colorName: string; colorHex: string }[]) {
    const v = variants.find((x) => x.tempId === variantTempId);
    if (!v) return;
    const line = v.packColorLines[0] ?? { tempId: uid(), colors: [] };
    updateVariant(variantTempId, {
      packColorLines: [{ ...line, colors }],
    });
  }

  // ── Size modal save ─────────────────────────────────────────────────────
  function handleSizeSave(variantTempId: string, entries: SizeEntryState[]) {
    const v = variants.find((x) => x.tempId === variantTempId);
    if (!v) return;
    const patch: Partial<VariantState> = { sizeEntries: entries };
    // PACK: auto-set packQuantity from size count
    if (v.saleType === "PACK") {
      if (entries.length > 1) {
        patch.packQuantity = String(entries.length);
      } else if (entries.length <= 1) {
        patch.packQuantity = v.packQuantity || "1";
      }
    }
    updateVariant(variantTempId, patch);
  }

  // ── Bulk apply ─────────────────────────────────────────────────────────────
  function applyBulk() {
    if (selectedIds.size === 0) return;
    onChange(variants.map((v) => {
      if (!selectedIds.has(v.tempId)) return v;
      const patch: Partial<VariantState> = {};
      if (bulkEdit.unitPrice  !== "") patch.unitPrice  = bulkEdit.unitPrice;
      if (bulkEdit.weight     !== "") patch.weight     = bulkEdit.weight;
      if (bulkEdit.stock      !== "") patch.stock      = bulkEdit.stock;
      if (bulkEdit.discountType !== "") {
        patch.discountType  = bulkEdit.discountType;
        patch.discountValue = bulkEdit.discountValue;
      }
      return { ...v, ...patch };
    }));
    setBulkEdit(defaultBulkEdit());
  }

  // ── Sorted variants ────────────────────────────────────────────────────────
  const sortedVariants = useMemo(() => {
    const firstSeenByKey = new Map<string, number>();
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (v.saleType !== "UNIT") continue;
      const gk = variantGroupKeyFromState(v);
      if (!firstSeenByKey.has(gk)) firstSeenByKey.set(gk, i);
    }
    // UNIT first (grouped by color), then PACK
    const unitVars = variants
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => v.saleType === "UNIT")
      .sort((a, b) => {
        const fsA = firstSeenByKey.get(variantGroupKeyFromState(a.v))!;
        const fsB = firstSeenByKey.get(variantGroupKeyFromState(b.v))!;
        return fsA !== fsB ? fsA - fsB : a.i - b.i;
      })
      .map(({ v }) => v);
    const packs = variants.filter((v) => v.saleType === "PACK");
    return [...unitVars, ...packs];
  }, [variants]);

  // ── Render helper: size summary cell ──────────────────────────────────────
  function renderSizeSummary(v: VariantState) {
    if (v.sizeEntries.length === 0) return <span className="text-[#9CA3AF] italic">—</span>;
    if (v.saleType === "UNIT") {
      return <span>{v.sizeEntries[0]?.sizeName}</span>;
    }
    // PACK
    return (
      <span className="truncate" title={v.sizeEntries.map((s) => `${s.sizeName}×${s.quantity}`).join(", ")}>
        {v.sizeEntries.map((s) => `${s.sizeName}×${s.quantity}`).join(", ")}
      </span>
    );
  }

  // ── Render helper: total price ────────────────────────────────────────────
  function renderTotalPrice(v: VariantState) {
    const total = computeTotalPrice(v);
    const final = computeFinalPrice(v);
    const hasDiscount = final !== null && total !== null && final !== total;
    if (total === null) return <span className="text-[#9CA3AF]">—</span>;
    return (
      <div className="text-right">
        {hasDiscount && final !== null ? (
          <>
            <span className="text-[#9CA3AF] line-through text-[10px]">{total.toFixed(2)}€</span>
            <br />
            <span className="text-emerald-600 font-semibold">{final.toFixed(2)}€</span>
          </>
        ) : (
          <span className="font-semibold">{total.toFixed(2)}€</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Variants area ── */}
      {variants.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-[#E5E5E5] text-[#9CA3AF] text-sm font-[family-name:var(--font-roboto)] rounded-lg">
          Cliquez sur &ldquo;Ajouter une variante&rdquo; pour commencer.
        </div>
      ) : (
        <div className="space-y-3">
          {/* ── Variants TABLE ── */}
          <div className="border border-[#E5E5E5] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-[family-name:var(--font-roboto)]">
                <thead>
                  {/* Column headers */}
                  <tr className="bg-[#F7F7F8] border-b border-[#E5E5E5]">
                    <th className="w-8 px-2 py-2 text-center">
                      <input type="checkbox"
                        checked={selectedIds.size === variants.length && variants.length > 0}
                        ref={selectAllRef}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds(new Set(variants.map((v) => v.tempId)));
                          else setSelectedIds(new Set());
                        }}
                        className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5"
                      />
                    </th>
                    <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">Type</th>
                    <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold min-w-[140px]">Couleur</th>
                    <th className="px-2 py-2 text-right text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold w-[90px]">Prix/unité</th>
                    <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold min-w-[120px]">Tailles</th>
                    <th className="px-2 py-2 text-right text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold w-[80px]">Total</th>
                    <th className="px-2 py-2 text-right text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold w-[70px]">Stock</th>
                    <th className="px-2 py-2 text-right text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold w-[80px]">Poids</th>
                    <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold w-[100px]">Remise</th>
                    <th className="w-10 px-2 py-2"></th>
                  </tr>
                  {/* Bulk edit row — inline in thead */}
                  <tr className={`border-b transition-colors ${showBulkRow ? "bg-[#F0FDF4] border-[#BBF7D0]" : "bg-[#FAFAFA] border-[#E5E5E5]"}`}>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`text-[9px] font-semibold ${showBulkRow ? "text-[#16A34A]" : "text-[#D1D5DB]"}`}>
                        {showBulkRow ? selectedIds.size : "—"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5" colSpan={2}>
                      <span className={`text-[10px] font-[family-name:var(--font-roboto)] ${showBulkRow ? "text-[#16A34A] font-semibold" : "text-[#D1D5DB]"}`}>
                        {showBulkRow
                          ? `${selectedIds.size} sélectionnée${selectedIds.size > 1 ? "s" : ""}`
                          : "Modification en masse"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.01" placeholder="Prix" value={bulkEdit.unitPrice} disabled={!showBulkRow}
                        onChange={(e) => setBulkEdit((b) => ({ ...b, unitPrice: e.target.value }))}
                        className={`w-full border px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-[family-name:var(--font-roboto)] ${
                          showBulkRow ? "border-[#86EFAC] bg-white" : "border-[#E5E5E5] bg-[#F7F7F8] text-[#D1D5DB] cursor-not-allowed"
                        }`} />
                    </td>
                    <td className="px-2 py-1.5">
                      {/* Tailles: not bulk-editable */}
                    </td>
                    <td className="px-2 py-1.5">
                      {/* Total: computed */}
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="1" placeholder="Stock" value={bulkEdit.stock} disabled={!showBulkRow}
                        onChange={(e) => setBulkEdit((b) => ({ ...b, stock: e.target.value }))}
                        className={`w-full border px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-[family-name:var(--font-roboto)] ${
                          showBulkRow ? "border-[#86EFAC] bg-white" : "border-[#E5E5E5] bg-[#F7F7F8] text-[#D1D5DB] cursor-not-allowed"
                        }`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.001" placeholder="Poids" value={bulkEdit.weight} disabled={!showBulkRow}
                        onChange={(e) => setBulkEdit((b) => ({ ...b, weight: e.target.value }))}
                        className={`w-full border px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-[family-name:var(--font-roboto)] ${
                          showBulkRow ? "border-[#86EFAC] bg-white" : "border-[#E5E5E5] bg-[#F7F7F8] text-[#D1D5DB] cursor-not-allowed"
                        }`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1 items-center">
                        <CustomSelect value={bulkEdit.discountType} disabled={!showBulkRow}
                          onChange={(val) => setBulkEdit((b) => ({ ...b, discountType: val as "" | "PERCENT" | "AMOUNT", discountValue: "" }))}
                          options={[{ value: "", label: "—" }, { value: "PERCENT", label: "%" }, { value: "AMOUNT", label: "€" }]}
                          size="sm" className="w-[50px]" />
                        {bulkEdit.discountType && (
                          <input type="number" min="0" step="0.01" placeholder="0" value={bulkEdit.discountValue} disabled={!showBulkRow}
                            onChange={(e) => setBulkEdit((b) => ({ ...b, discountValue: e.target.value }))}
                            className={`w-14 border px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-[family-name:var(--font-roboto)] ${
                              showBulkRow ? "border-[#86EFAC] bg-white" : "border-[#E5E5E5] bg-[#F7F7F8] text-[#D1D5DB] cursor-not-allowed"
                            }`} />
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button type="button" onClick={applyBulk} disabled={!showBulkRow}
                        title="Appliquer en masse"
                        className={`p-1 rounded transition-colors ${
                          showBulkRow ? "text-[#16A34A] hover:bg-[#DCFCE7]" : "text-[#D1D5DB] cursor-not-allowed"
                        }`}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                </thead>
                <tbody>
                  {sortedVariants.map((v) => {
                    const isSelected  = selectedIds.has(v.tempId);
                    const isDuplicate = duplicateTempIds.has(v.tempId);
                    const isUnit = v.saleType === "UNIT";
                    const colorDisplayName = isUnit
                      ? ([v.colorName, ...v.subColors.map((sc) => sc.colorName)].filter(Boolean).join(", ") || "Sans couleur")
                      : (v.packColorLines[0]?.colors?.map((c) => c.colorName).join(" + ") || "Aucune couleur");

                    return (
                      <tr
                        key={v.tempId}
                        className={`border-b border-[#F0F0F0] last:border-b-0 transition-colors ${
                          isDuplicate ? "bg-[#FEF2F2]" : isSelected ? "bg-[#F0FDF4]" : "hover:bg-[#FAFAFA]"
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="px-2 py-2 text-center">
                          <input type="checkbox" checked={isSelected}
                            onChange={(e) => {
                              const next = new Set(selectedIds);
                              if (e.target.checked) next.add(v.tempId); else next.delete(v.tempId);
                              setSelectedIds(next);
                            }}
                            className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5" />
                        </td>

                        {/* Type */}
                        <td className="px-2 py-2">
                          <CustomSelect
                            value={v.saleType}
                            onChange={(val) => {
                              if (val === "PACK" && v.saleType === "UNIT") {
                                updateVariant(v.tempId, {
                                  saleType: "PACK",
                                  colorId: "",
                                  colorName: "",
                                  colorHex: "#9CA3AF",
                                  subColors: [],
                                  packColorLines: [{ tempId: uid(), colors: [] }],
                                  packQuantity: "1",
                                });
                              } else if (val === "UNIT" && v.saleType === "PACK") {
                                updateVariant(v.tempId, {
                                  saleType: "UNIT",
                                  packColorLines: [],
                                  packQuantity: "",
                                  sizeEntries: v.sizeEntries.slice(0, 1),
                                });
                              }
                            }}
                            options={[
                              { value: "UNIT", label: "Unité" },
                              { value: "PACK", label: "Pack" },
                            ]}
                            size="sm"
                            className="w-[75px]"
                          />
                        </td>

                        {/* Color */}
                        <td className="px-2 py-2">
                          {isUnit ? (
                            <MultiColorSelect
                              selected={v.colorId ? [
                                { colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex },
                                ...v.subColors.map((sc) => ({ colorId: sc.colorId, colorName: sc.colorName, colorHex: sc.colorHex })),
                              ] : []}
                              options={availableColors}
                              onChange={(colors) => handleMultiColorChange(new Set([v.tempId]), colors)}
                              existingVariants={variants}
                              editingGroupKey={variantGroupKeyFromState(v)}
                              pfsColorRef={v.pfsColorRef}
                              onPfsColorRefChange={(ref) => updateVariant(v.tempId, { pfsColorRef: ref })}
                              usedPfsColorRefs={(() => {
                                const map = new Map<string, string>();
                                for (const ov of variants) {
                                  if (ov.tempId === v.tempId || !ov.colorId) continue;
                                  // For multi-color: use variant pfsColorRef override
                                  const ref = ov.subColors.length > 0
                                    ? ov.pfsColorRef
                                    : availableColors.find((c) => c.id === ov.colorId)?.pfsColorRef ?? "";
                                  if (ref) {
                                    const label = ov.subColors.length > 0
                                      ? [ov.colorName, ...ov.subColors.map((sc) => sc.colorName)].join(" / ")
                                      : ov.colorName;
                                    map.set(ref, label);
                                  }
                                }
                                return map;
                              })()}
                              onCreateColor={onQuickCreateColor}
                            />
                          ) : (
                            <MultiColorSelect
                              selected={v.packColorLines[0]?.colors ?? []}
                              options={availableColors}
                              onChange={(colors) => updatePackColorLine(v.tempId, colors)}
                              onCreateColor={onQuickCreateColor}
                            />
                          )}
                        </td>

                        {/* Unit Price */}
                        <td className="px-2 py-2">
                          <input
                            type="number" min="0" step="0.01"
                            value={v.unitPrice}
                            placeholder="0.00"
                            onChange={(e) => updateVariant(v.tempId, { unitPrice: e.target.value })}
                            className="w-full border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]"
                          />
                        </td>

                        {/* Sizes — click to open modal */}
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => setSizeModalVariantId(v.tempId)}
                            className="w-full flex items-center gap-1.5 bg-white border border-[#E5E5E5] px-2 py-1.5 text-xs text-left rounded-md hover:border-[#9CA3AF] transition-colors min-h-[30px] max-w-[200px]"
                            title={v.sizeEntries.length > 0 ? v.sizeEntries.map((s) => `${s.sizeName}×${s.quantity}`).join(", ") : "Ajouter des tailles"}
                          >
                            {renderSizeSummary(v)}
                            <svg className="w-3 h-3 text-[#9CA3AF] shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                        </td>

                        {/* Total price */}
                        <td className="px-2 py-2 text-right text-xs">
                          {renderTotalPrice(v)}
                        </td>

                        {/* Stock */}
                        <td className="px-2 py-2">
                          <input
                            type="number" min="0" step="1"
                            value={v.stock}
                            placeholder="0"
                            onChange={(e) => updateVariant(v.tempId, { stock: e.target.value })}
                            className="w-full border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]"
                          />
                        </td>

                        {/* Weight */}
                        <td className="px-2 py-2">
                          <input
                            type="number" min="0" step="0.001"
                            value={v.weight}
                            placeholder="0.000"
                            onChange={(e) => updateVariant(v.tempId, { weight: e.target.value })}
                            className="w-full border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]"
                          />
                        </td>

                        {/* Discount */}
                        <td className="px-2 py-2">
                          <div className="flex gap-1 items-center">
                            <CustomSelect
                              value={v.discountType}
                              onChange={(val) => updateVariant(v.tempId, { discountType: val as "" | "PERCENT" | "AMOUNT", discountValue: "" })}
                              options={[{ value: "", label: "—" }, { value: "PERCENT", label: "%" }, { value: "AMOUNT", label: "€" }]}
                              size="sm"
                              className="w-[50px]"
                            />
                            {v.discountType && (
                              <input type="number" min="0" step="0.01"
                                value={v.discountValue}
                                placeholder="0"
                                onChange={(e) => updateVariant(v.tempId, { discountValue: e.target.value })}
                                className="w-14 border border-[#E5E5E5] bg-white px-1.5 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]"
                              />
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-2 text-center">
                          {variants.length > 1 && (
                            <button type="button" onClick={() => removeVariant(v.tempId)}
                              title="Supprimer" className="p-1 text-[#9CA3AF] hover:text-[#EF4444] transition-colors">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Duplicate warning */}
          {duplicateTempIds.size > 0 && (
            <div className="px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg flex items-center gap-2">
              <svg className="w-4 h-4 text-[#EF4444] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)]">
                Doublon détecté : même type, même composition couleur et mêmes tailles/quantités.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addVariant}
            className="flex-1 border-2 border-dashed border-[#E5E5E5] py-3 text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:border-[#1A1A1A] hover:bg-[#F7F7F8] transition-colors flex items-center justify-center gap-2 rounded-lg"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Ajouter une variante
          </button>
          <button
            type="button"
            onClick={() => setShowQuickAdd(true)}
            className="flex-1 border-2 border-dashed border-[#E5E5E5] py-3 text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:border-[#1A1A1A] hover:bg-[#F7F7F8] transition-colors flex items-center justify-center gap-2 rounded-lg"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
            Création rapide
          </button>
        </div>

        {variants.length > 0 && (
          <button
            type="button"
            onClick={() => setShowImageModal(true)}
            className="w-full border-2 border-dashed border-[#E5E5E5] py-3 text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:border-[#1A1A1A] hover:bg-[#F7F7F8] transition-colors flex items-center justify-center gap-2 rounded-lg"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            Gérer les images ({totalPhotos} photo{totalPhotos !== 1 ? "s" : ""})
          </button>
        )}
      </div>

      {/* ── Image Gallery Modal ── */}
      <ImageGalleryModal
        key={galleryState?.colorName ?? ""}
        open={galleryState !== null}
        onClose={() => setGalleryState(null)}
        images={galleryState?.images ?? []}
        colorName={galleryState?.colorName ?? ""}
        colorHex={galleryState?.colorHex ?? "#9CA3AF"}
      />

      {/* ── Image Manager Modal ── */}
      <ImageManagerModal
        open={showImageModal}
        onClose={() => setShowImageModal(false)}
        colorImages={colorImages}
        onChange={onChangeImages}
        variants={variants}
        availableColors={availableColors}
        onSetPrimary={(variantTempId) => setPrimary(variantTempId)}
      />

      {/* ── Size Modal ── */}
      {sizeModalVariant && (
        <SizeModal
          open={!!sizeModalVariantId}
          onClose={() => setSizeModalVariantId(null)}
          variant={sizeModalVariant}
          availableSizes={availableSizes}
          categoryId={categoryId}
          allCategories={allCategories}
          onSave={(entries) => handleSizeSave(sizeModalVariant.tempId, entries)}
          onQuickCreateSize={onQuickCreateSize}
        />
      )}

      {/* ── Quick Add Modal ── */}
      <QuickAddModal
        open={showQuickAdd}
        onClose={() => setShowQuickAdd(false)}
        existingVariants={variants}
        availableColors={availableColors}
        availableSizes={availableSizes}
        categoryId={categoryId}
        onCreateColor={onQuickCreateColor}
        onQuickCreateSize={onQuickCreateSize}
        allCategories={allCategories}
        onConfirm={handleQuickAddConfirm}
      />
    </div>
  );
}
