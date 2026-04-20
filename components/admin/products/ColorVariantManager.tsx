"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import ImageDropzone from "./ImageDropzone";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";
import ColorSwatch from "@/components/ui/ColorSwatch";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { fetchPfsColorsForMapping, updateColorPfsRef, updateProductColorPfsRef } from "@/app/actions/admin/colors";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import QuickCreateSizeModal, { type QuickCreateSizeModalResult } from "@/components/admin/products/QuickCreateSizeModal";
import { usePfsAttributes } from "@/components/admin/MarketplaceMappingSection";

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

export interface VariantState {
  tempId: string;
  dbId?: string;           // ProductColor.id when editing
  // Color composition (colorId = 1ère couleur, subColors = suivantes) — UNIT and PACK
  colorId: string;
  colorName: string;
  colorHex: string;
  subColors: SubColorState[];
  // Sizes with quantities (UNIT ou PACK)
  sizeEntries: SizeEntryState[];
  // Pricing & metadata
  unitPrice: string;       // Prix HT par unité
  weight: string;
  stock: string;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: string;    // Quantité par paquet (PACK only)
  // PFS color override for multi-color variants — retained in the UI state but
  // no longer persisted. Populated for backwards compatibility with legacy UI.
  pfsColorRef?: string;
  // SKU auto-généré: {ref}_{couleurs}_{UNIT|PACK}_{index}
  sku: string;
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
}

interface Props {
  variants: VariantState[];
  colorImages: ColorImageState[];
  availableColors: AvailableColor[];
  availableSizes: AvailableSize[];
  /** PFS size references (from the Excel annexes) for the quick-create size modal. */
  pfsSizes?: { reference: string; label: string }[];
  onChange: (variants: VariantState[]) => void;
  onChangeImages: (images: ColorImageState[]) => void;
  onQuickCreateColor?: (name: string, hex: string | null, patternImage: string | null) => Promise<AvailableColor>;
  onColorAdded?: (color: AvailableColor) => void;
  /** Called after a size is created via the quick-create modal — parent should add to availableSizes */
  onSizeAdded?: (size: AvailableSize) => void;
  variantErrors?: Map<string, Set<string>>;
}

// ─────────────────────────────────────────────
// Price helpers (exported for reuse in ProductForm)
// ─────────────────────────────────────────────

/** Total price = unitPrice × total quantity across all sizes.
 *  For UNIT: if no sizes, total = unitPrice × 1.
 *  For PACK: total = unitPrice × sum(quantities across sizes). */
export function computeTotalPrice(v: VariantState): number | null {
  const unit = parseFloat(v.unitPrice);
  if (isNaN(unit) || unit <= 0) return null;
  if (v.sizeEntries.length === 0) return v.saleType === "PACK" ? null : unit;
  let totalQty = 0;
  for (const se of v.sizeEntries) {
    const qty = parseInt(se.quantity);
    if (isNaN(qty) || qty <= 0) return null;
    totalQty += qty;
  }
  return totalQty > 0 ? Math.round(unit * totalQty * 100) / 100 : unit;
}

/** Get total quantity across all size entries. */
export function computePackTotalQty(v: VariantState): number {
  let total = 0;
  for (const se of v.sizeEntries) {
    total += parseInt(se.quantity) || 0;
  }
  return total;
}

export function computeFinalPrice(v: VariantState, discountPercent?: number | null): number | null {
  const total = computeTotalPrice(v);
  if (total === null) return null;
  if (!discountPercent || discountPercent <= 0) return total;
  return Math.max(0, total * (1 - discountPercent / 100));
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
  const subColorKey = v.subColors.map((sc) => sc.colorId).join(",");
  return `${v.saleType}::${v.colorId}::${subColorKey}::${sizeKey}`;
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

/** Unique key for a color+sub-colors combination. Uses colorId (not name) to avoid collisions. */
export function variantGroupKeyFromState(v: { colorId: string; subColors: { colorId: string }[] }): string {
  if (v.subColors.length === 0) return v.colorId;
  return `${v.colorId}::${v.subColors.map(sc => sc.colorId).join(",")}`;
}

/** Image group key — based on color composition (UNIT and PACK use the same scheme). */
export function imageGroupKeyFromVariant(v: VariantState): string {
  return variantGroupKeyFromState(v);
}

/** Fingerprint of a variant's color state — changes when colors change. */
export function variantColorFingerprint(v: VariantState): string {
  if (!v.colorId) return "";
  return variantGroupKeyFromState(v);
}

/** Unique color combinations across a variant set — one entry per distinct
 *  color composition, regardless of UNIT vs PACK. */
export function computeExistingColorCombos(
  existingVariants: VariantState[],
): { key: string; colors: { colorId: string; colorName: string; colorHex: string }[]; pfsColorRef?: string }[] {
  const seen = new Set<string>();
  const combos: { key: string; colors: { colorId: string; colorName: string; colorHex: string }[]; pfsColorRef?: string }[] = [];
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
      pfsColorRef: v.pfsColorRef || undefined,
    });
  }
  return combos;
}

function defaultVariant(): VariantState {
  return {
    tempId:       uid(),
    colorId:      "",
    colorName:    "",
    colorHex:     "#9CA3AF",
    subColors:    [],
    sizeEntries:  [],
    unitPrice:    "",
    weight:       "",
    stock:        "",
    isPrimary:    false,
    saleType:     "UNIT",
    packQuantity: "",
    pfsColorRef: "",
    sku: "",
  };
}

// ─────────────────────────────────────────────
// Bulk edit state
// ─────────────────────────────────────────────
interface BulkEditState {
  unitPrice:    string;
  weight:       string;
  stock:        string;
}

function defaultBulkEdit(): BulkEditState {
  return { unitPrice: "", weight: "", stock: "" };
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // Ne pas fermer si le clic est dans le trigger OU dans le menu porté
      if (ref.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
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
            ? "bg-[#F0FDF4] border-[#BBF7D0] text-text-primary"
            : "bg-bg-primary border-border text-text-muted hover:border-[#9CA3AF]"
        }`}
      >
        {currentPfs ? (
          <>
            <span
              className="w-3 h-3 rounded-full shrink-0 border border-black/10"
              style={{ backgroundColor: currentPfs.value || "#9CA3AF" }}
            />
            <span className="flex-1 truncate font-body">{currentPfs.label}</span>
          </>
        ) : (
          <span className="flex-1 italic font-body">Aucune correspondance</span>
        )}
        <svg className="w-3 h-3 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed bg-bg-primary border border-border rounded-lg shadow-2xl z-[9999] max-h-[220px] flex flex-col"
          style={(() => {
            const rect = ref.current?.getBoundingClientRect();
            if (!rect) return {};
            return { top: rect.bottom + 4, left: rect.left, width: rect.width };
          })()}
        >
          <div className="px-2 py-1.5 border-b border-border-light shrink-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="w-full text-xs bg-transparent outline-none text-text-primary placeholder:text-text-muted font-body"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {/* Option to unmap */}
            {currentPfsRef && (
              <button
                type="button"
                onClick={() => { onMap(colorId, null); setOpen(false); setSearch(""); }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-[#FEF2F2] text-[#EF4444] font-body border-b border-border-light"
              >
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Retirer la correspondance
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-2.5 py-3 text-xs text-text-muted text-center font-body">Aucun résultat</div>
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
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-colors font-body ${
                    isUsedByOther
                      ? "opacity-50 cursor-not-allowed bg-bg-secondary"
                      : isCurrentMapping
                        ? "bg-[#F0FDF4]"
                        : "hover:bg-bg-secondary"
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                    style={{ backgroundColor: pfs.value || "#9CA3AF" }}
                  />
                  <span className={`flex-1 truncate ${isUsedByOther ? "line-through text-text-muted" : "text-text-primary"}`}>
                    {pfs.label}
                  </span>
                  {isUsedByOther && (
                    <span className="text-[9px] text-text-muted shrink-0 whitespace-nowrap">
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
function MultiColorSelect({ selected, options, onChange, existingVariants, editingGroupKey, pfsColorRef, pfsColorRefLabel, onPfsColorRefChange, usedPfsColorRefs, onCreateColor, onColorAdded, mappedCombos }: {
  selected: { colorId: string; colorName: string; colorHex: string }[];
  options: AvailableColor[];
  onChange: (colors: { colorId: string; colorName: string; colorHex: string }[], pfsColorRefOverride?: string) => void;
  existingVariants?: VariantState[];
  /** GroupKey of the variant being edited — excluded from duplicate check */
  editingGroupKey?: string;
  /** Per-variant PFS color override (multi-color only) */
  pfsColorRef?: string;
  /** French label for the PFS color reference (display only) */
  pfsColorRefLabel?: string;
  onPfsColorRefChange?: (ref: string) => void;
  /** PFS color refs already used by other variants in this product */
  usedPfsColorRefs?: Map<string, string>; // pfsRef → variantLabel
  onCreateColor?: (name: string, hex: string | null, patternImage: string | null) => Promise<AvailableColor>;
  /** Notify parent that a color was created inline (so it can update its own list) */
  onColorAdded?: (color: AvailableColor) => void;
  /** Mapped multi-color combinations from DB: sortedColorIds → pfsColorRef */
  mappedCombos?: Record<string, string>;
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

  // Colors created inline (not yet in parent options)
  const [localCreatedColors, setLocalCreatedColors] = useState<AvailableColor[]>([]);
  const allOptions = (() => {
    const ids = new Set(options.map((o) => o.id));
    return [...options, ...localCreatedColors.filter((c) => !ids.has(c.id))];
  })();

  // Marketplace mapping state
  const [showMapping, setShowMapping] = useState(false);
  const [pfsData, setPfsData] = useState<PfsMappingData | null>(null);
  const [pfsLoading, setPfsLoading] = useState(false);
  const [pfsSaving, setPfsSaving] = useState<string | null>(null); // colorId being saved
  // Per-variant PFS color override for multi-color combos
  const [draftPfsColorRef, setDraftPfsColorRef] = useState(pfsColorRef ?? "");

  // Auto-load PFS data when multi-color is selected (mapping becomes mandatory)
  useEffect(() => {
    if (draft.length > 1 && !pfsData && !pfsLoading) {
      loadPfsData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.length]);

  // Track the combo key to detect changes
  const draftComboKey = draft.length > 1 ? draft.map((c) => c.colorId).sort().join("+") : "";
  const prevComboKeyRef = useRef(draftComboKey);

  // Auto-resolve PFS color ref when draft multi-color combination changes
  useEffect(() => {
    if (draft.length <= 1) return;
    const comboChanged = prevComboKeyRef.current !== draftComboKey;
    prevComboKeyRef.current = draftComboKey;
    // Only auto-resolve on combo change, or initial load when no PFS ref
    if (!comboChanged && draftPfsColorRef) return;

    // Collect PFS refs already used by other variants in this product
    const usedRefs = new Set<string>();
    if (existingVariants) {
      for (const ov of existingVariants) {
        if (ov.pfsColorRef) usedRefs.add(ov.pfsColorRef);
      }
    }

    // 1. Check same-product variants for a matching combo
    if (existingVariants) {
      for (const ov of existingVariants) {
        if (!ov.pfsColorRef) continue;
        if (ov.colorId && ov.subColors.length > 0) {
          const vIds = [ov.colorId, ...ov.subColors.map((sc) => sc.colorId)].sort().join("+");
          if (vIds === draftComboKey) { setDraftPfsColorRef(ov.pfsColorRef); return; }
        }
      }
    }
    // 2. Check cross-product mapped combinations from DB
    const dbRef = mappedCombos?.[draftComboKey];
    if (dbRef && !usedRefs.has(dbRef)) {
      setDraftPfsColorRef(dbRef);
      return;
    }
    // 3. No match found — clear the PFS ref if combo changed
    if (comboChanged) {
      setDraftPfsColorRef("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftComboKey]);

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
          const opt = allOptions.find((o) => o.id === colorId);
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

  // Multi-color without PFS mapping — warn but don't block
  const multiColorMissingPfs = draft.length > 1 && !draftPfsColorRef;

  const confirm = useCallback(() => {
    onChange(draft, draft.length > 1 ? draftPfsColorRef || undefined : undefined);
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
    ? allOptions.filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase()))
    : allOptions;

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

  function handleQuickColorCreated(item: { id: string; name: string; hex?: string | null; patternImage?: string | null; pfsColorRef?: string | null }) {
    setDraft((prev) => [...prev, { colorId: item.id, colorName: item.name, colorHex: item.hex ?? "#9CA3AF" }]);
    const newColor: AvailableColor = { id: item.id, name: item.name, hex: item.hex ?? null, patternImage: item.patternImage ?? null, pfsColorRef: item.pfsColorRef ?? null };
    setLocalCreatedColors((prev) => [...prev, newColor]);
    onColorAdded?.(newColor);
    setShowQuickCreate(false);
  }

  // Build display for the trigger button
  const displayName = selected.map((s) => s.colorName).join(" / ");
  const selectedSegments = selected.map((s) => {
    const opt = allOptions.find((o) => o.id === s.colorId);
    return { hex: s.colorHex, patternImage: opt?.patternImage ?? null };
  });

  return (
    <div>
      <button
        type="button"
        onClick={openModal}
        className="w-full flex items-center gap-1.5 bg-bg-primary border border-border px-2 py-1.5 text-xs font-body text-text-primary focus:outline-none focus:border-[#1A1A1A] hover:border-[#9CA3AF] transition-colors text-left min-h-[32px] rounded-md"
      >
        {selected.length === 0 ? (
          <span className="text-text-muted flex-1 italic">— Couleur</span>
        ) : (
          <span className="flex items-center gap-1.5 flex-1 min-w-0">
            {selectedSegments.length === 1 ? (
              <ColorSwatch hex={selectedSegments[0].hex} patternImage={selectedSegments[0].patternImage} size={14} rounded="full" />
            ) : (
              <ColorSwatch hex={selectedSegments[0]?.hex} patternImage={selectedSegments[0]?.patternImage} subColors={selectedSegments.slice(1)} size={14} rounded="full" />
            )}
            <span className="truncate text-[11px]">{displayName}</span>
          </span>
        )}
        <svg className="w-3 h-3 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {/* PFS badge — below trigger */}
      {selected.length > 1 && pfsColorRef && (
        <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-white bg-purple-600 truncate max-w-full">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-300 animate-pulse shrink-0" />
          PFS : {pfsColorRefLabel || pfsColorRef}
        </span>
      )}

      {/* Modal */}
      {open && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6" onMouseDown={backdropColorPicker.onMouseDown} onMouseUp={backdropColorPicker.onMouseUp}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

          <div
            className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col"
            style={{ maxHeight: "min(90vh, 720px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h3 className="text-base font-semibold font-heading text-text-primary">
                Couleurs de la variante
              </h3>
              <button type="button" onClick={cancel} className="p-1.5 hover:bg-bg-secondary rounded-lg transition-colors" aria-label="Fermer">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* ── Selected colors zone (top, always visible) ── */}
            <div className="px-6 py-4 bg-[#FAFAFA] border-b border-border shrink-0">
              {draft.length === 0 ? (
                <div className="flex items-center gap-3 text-text-muted">
                  <div className="w-8 h-8 rounded-full border-2 border-dashed border-[#D1D5DB] flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <span className="text-sm font-body">
                    Sélectionnez une ou plusieurs couleurs ci-dessous
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Chips row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {draft.map((s, i) => {
                      const opt = allOptions.find((o) => o.id === s.colorId);
                      return (
                        <div
                          key={s.colorId}
                          draggable
                          onDragStart={() => handleDragStart(i)}
                          onDragOver={(e) => handleDragOver(e, i)}
                          onDragEnd={handleDragEnd}
                          className={`group flex items-center gap-2 pl-1.5 pr-1 py-1 rounded-full border cursor-grab active:cursor-grabbing transition-all ${
                            i === 0
                              ? "bg-bg-dark border-[#1A1A1A] text-text-inverse"
                              : dragOverIdx === i ? "bg-[#F0F0F0] border-[#1A1A1A]" : "bg-bg-primary border-border hover:border-[#9CA3AF]"
                          }`}
                        >
                          <ColorSwatch hex={s.colorHex} patternImage={opt?.patternImage ?? null} size={20} rounded="full" border />
                          <span className={`text-xs font-medium font-body max-w-[100px] truncate ${i === 0 ? "text-text-inverse" : "text-text-primary"}`}>
                            {s.colorName}
                          </span>
                          {i === 0 && (
                            <span className="text-[9px] bg-bg-primary/20 text-text-inverse px-1.5 py-0.5 rounded-full font-semibold">1re</span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeFromDraft(s.colorId); }}
                            className={`p-0.5 rounded-full transition-colors ${
                              i === 0 ? "text-text-inverse/60 hover:text-text-inverse hover:bg-bg-primary/20" : "text-text-muted hover:text-[#EF4444] hover:bg-[#FEF2F2]"
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
                      <button type="button" onClick={() => setDraft([])} className="text-[11px] text-text-muted hover:text-[#EF4444] font-body transition-colors ml-1">
                        Vider
                      </button>
                    )}
                  </div>

                  {/* Reorder hint */}
                  {draft.length > 1 && (
                    <p className="text-[10px] text-text-muted font-body">
                      Glissez pour réordonner. La 1re couleur = couleur principale.
                    </p>
                  )}

                  {/* PFS mapping — inline, only for multi-color */}
                  {draft.length > 1 && (
                    <div className="flex items-center gap-3 pt-1">
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
                        <span className="text-[11px] font-semibold text-text-secondary font-body">Couleur Paris Fashion Shop</span>
                      </div>
                      {!pfsData && !pfsLoading ? (
                        <button type="button" onClick={loadPfsData} className="text-[11px] text-text-secondary hover:text-text-primary underline font-body">
                          Charger les options
                        </button>
                      ) : pfsLoading ? (
                        <div className="flex items-center gap-1.5 text-text-muted">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          <span className="text-[11px] font-body">Chargement…</span>
                        </div>
                      ) : pfsData ? (
                        <div className="flex-1 min-w-0">
                          <PfsColorDropdown
                            colorId={"__variant__"}
                            currentPfsRef={draftPfsColorRef || null}
                            pfsData={{
                              ...pfsData,
                              // Pour le variant override, ne bloquer que les refs utilisées par
                              // d'autres variantes du même produit (pas les mappings Color-level)
                              existingMappings: (() => {
                                const map: Record<string, { colorId: string; colorName: string }> = {};
                                if (usedPfsColorRefs) {
                                  for (const [ref, label] of usedPfsColorRefs) {
                                    map[ref] = { colorId: "__other__", colorName: label };
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
                    <p className="text-[10px] text-[#EF4444] font-body">
                      Couleur Paris Fashion Shop déjà utilisée par « {usedPfsColorRefs.get(draftPfsColorRef)} »
                    </p>
                  )}

                  {/* Single-color PFS status */}
                  {draft.length === 1 && (() => {
                    const mainOpt = allOptions.find((o) => o.id === draft[0].colorId);
                    const autoRef = mainOpt?.pfsColorRef;
                    if (!autoRef) return null;
                    return (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
                        <span className="text-[10px] text-[#22C55E] font-body">
                          Paris Fashion Shop : {autoRef}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* ── Existing combinations (quick-pick bar) ── */}
            {existingCombinations.length > 0 && (
              <div className="px-6 py-2.5 border-b border-border shrink-0 bg-bg-primary">
                <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                  <span className="text-[10px] text-text-muted font-body uppercase tracking-wide shrink-0">Existantes</span>
                  {existingCombinations.map((combo) => {
                    const isMatch = combo.key === draftGroupKey;
                    return (
                      <button
                        key={combo.key}
                        type="button"
                        onClick={() => selectCombination(combo)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] whitespace-nowrap transition-colors shrink-0 font-body ${
                          isMatch ? "border-[#22C55E] bg-[#F0FDF4] text-text-primary" : "border-border bg-bg-primary text-text-secondary hover:border-[#9CA3AF]"
                        }`}
                      >
                        <div className="flex -space-x-0.5">
                          {combo.colors.slice(0, 3).map((c, ci) => {
                            const optC = allOptions.find((o) => o.id === c.colorId);
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
                <div className="flex items-center gap-2.5 bg-bg-secondary border border-border px-3 py-2 rounded-xl">
                  <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher une couleur…"
                    className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none min-w-0 font-body"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch("")} className="p-0.5 text-text-muted hover:text-text-primary">
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
                  <div className="py-12 text-center text-sm text-text-muted font-body">Aucun résultat</div>
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
                              ? "border-[#1A1A1A] bg-bg-secondary shadow-sm"
                              : "border-transparent bg-bg-primary hover:bg-bg-secondary hover:border-border"
                          }`}
                        >
                          <div className="relative">
                            <ColorSwatch hex={opt.hex} patternImage={opt.patternImage} size={36} rounded="lg" />
                            {isChecked && (
                              <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                position === 0 ? "bg-bg-dark text-text-inverse" : "bg-[#E5E5E5] text-text-primary"
                              }`}>
                                {position + 1}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-body text-text-primary truncate w-full leading-tight">
                            {opt.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Create new color — uses the same modal as /admin/couleurs */}
              <div className="border-t border-border px-6 py-3 shrink-0 bg-bg-primary">
                <button
                  type="button"
                  onClick={() => setShowQuickCreate(true)}
                  className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary font-body transition-colors"
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
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-border bg-bg-primary rounded-b-2xl shrink-0">
              {multiColorMissingPfs ? (
                <span className="text-xs text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] px-3 py-1 rounded-lg font-body">
                  Synchronisation Paris Fashion Shop impossible sans correspondance couleur
                </span>
              ) : matchingCombo ? (
                <span className="text-xs text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] px-3 py-1 rounded-lg font-body">
                  Combinaison déjà utilisée ({matchingCombo.saleTypes.join(" + ")})
                </span>
              ) : (
                <span className="text-sm text-text-muted font-body">
                  {draft.length === 0 ? "Aucune couleur" : `${draft.length} couleur${draft.length > 1 ? "s" : ""}`}
                </span>
              )}
              <div className="flex items-center gap-2.5">
                <button type="button" onClick={cancel}
                  className="px-5 py-2 text-sm font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-xl hover:bg-bg-secondary transition-colors"
                >
                  Annuler
                </button>
                <button type="button" onClick={confirm}
                  className="px-5 py-2 text-sm font-medium font-body text-text-inverse bg-bg-dark rounded-xl hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className="relative bg-bg-primary rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ width: 560, maxWidth: "95vw" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full border border-border shrink-0" style={{ backgroundColor: colorHex || "#9CA3AF" }} />
            <span className="text-sm font-semibold text-text-primary font-heading">{colorName}</span>
            <span className="text-xs text-text-muted font-body">{idx + 1} / {images.length}</span>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Image principale */}
        <div className="relative bg-bg-secondary flex items-center justify-center" style={{ height: 400 }}>
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
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-bg-primary/90 hover:bg-bg-primary shadow-md rounded-full flex items-center justify-center transition-all hover:scale-105"
              >
                <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button type="button" onClick={next}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-bg-primary/90 hover:bg-bg-primary shadow-md rounded-full flex items-center justify-center transition-all hover:scale-105"
              >
                <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Pagination */}
        {images.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 py-3 bg-bg-primary shrink-0">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                className={`rounded-full transition-all duration-200 ${
                  i === idx ? "w-6 h-2 bg-bg-dark" : "w-2 h-2 bg-[#D1D5DB] hover:bg-[#9CA3AF]"
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
  pfsColorLabels: Map<string, string>;
}

function ImageManagerModal({ open, onClose, colorImages, onChange, variants, availableColors, onSetPrimary, pfsColorLabels }: ImageManagerModalProps) {
  const { confirm: confirmDialog } = useConfirm();
  const backdrop = useBackdropClose(onClose);
  const colorImagesRef = useRef(colorImages);
  colorImagesRef.current = colorImages;

  function findVariantByGroupKey(groupKey: string): VariantState | undefined {
    return variants.find((v) => imageGroupKeyFromVariant(v) === groupKey);
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

  async function handleAddImageAtPosition(groupKey: string, file: File, _position: number) {
    const state = colorImagesRef.current.find((c) => c.groupKey === groupKey);
    if (!state) return;

    // Auto-assign to the smallest free position
    const usedPositions = new Set(state.orders);
    let position = 0;
    while (usedPositions.has(position)) position++;
    if (position >= 5) return; // Max 5 images reached

    const blob = URL.createObjectURL(file);
    setUploadingSlots((prev) => ({ ...prev, [groupKey]: position }));

    onChange(colorImagesRef.current.map((c) => c.groupKey === groupKey
      ? { ...c, imagePreviews: [...c.imagePreviews, blob], orders: [...c.orders, position], uploading: true }
      : c
    ));

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
        // Remove position and shift all higher positions down by 1 to keep them compact
        orders: c.orders
          .filter((_, j) => j !== idx)
          .map((o) => (o > position ? o - 1 : o)),
      };
    }));
  }

  function handleSwapPositions(groupKey: string, fromPos: number, toPos: number) {
    onChange(colorImages.map((c) => {
      if (c.groupKey !== groupKey) return c;
      // Only swap if both positions have images (no gap creation)
      if (!c.orders.includes(fromPos) || !c.orders.includes(toPos)) return c;
      const newOrders = c.orders.map((o) => {
        if (o === fromPos) return toPos;
        if (o === toPos) return fromPos;
        return o;
      });
      return { ...c, orders: newOrders };
    }));
  }

  function handleCrossColorDrop(sourceGroupKey: string, sourcePos: number, targetGroupKey: string, _targetPos: number) {
    const srcState = colorImagesRef.current.find((c) => c.groupKey === sourceGroupKey);
    if (!srcState) return;
    const srcIdx = srcState.orders.indexOf(sourcePos);
    if (srcIdx === -1 || !srcState.imagePreviews[srcIdx]) return;

    const srcPreview = srcState.imagePreviews[srcIdx];
    const srcPath = srcState.uploadedPaths[srcIdx];

    onChange(colorImagesRef.current.map((c) => {
      if (c.groupKey === sourceGroupKey) {
        // Remove from source and compact remaining positions
        const newPreviews = c.imagePreviews.filter((_, i) => i !== srcIdx);
        const newPaths = c.uploadedPaths.filter((_, i) => i !== srcIdx);
        const newOrders = c.orders
          .filter((_, i) => i !== srcIdx)
          .map((o) => (o > sourcePos ? o - 1 : o));
        return { ...c, imagePreviews: newPreviews, uploadedPaths: newPaths, orders: newOrders };
      }
      if (c.groupKey === targetGroupKey) {
        // Auto-assign to smallest free position
        const usedPositions = new Set(c.orders);
        let finalPos = 0;
        while (usedPositions.has(finalPos) && finalPos < 5) finalPos++;
        if (finalPos >= 5) return c; // Target is full
        return {
          ...c,
          imagePreviews: [...c.imagePreviews, srcPreview],
          uploadedPaths: [...c.uploadedPaths, srcPath],
          orders: [...c.orders, finalPos],
        };
      }
      return c;
    }));
  }

  const totalPhotos = colorImages.reduce((s, c) => s + c.imagePreviews.length, 0);

  if (!open) return null;

  const modal = (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 overflow-y-auto" onMouseDown={backdrop.onMouseDown} onMouseUp={backdrop.onMouseUp}>
      <div className="bg-bg-primary w-full max-w-3xl rounded-2xl shadow-2xl mt-8 mb-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-bold text-text-primary font-heading">
              Images par couleur
            </h3>
            <p className="text-xs text-text-muted font-body mt-0.5">
              {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""} — partagées entre toutes les variantes de la même couleur
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {colorImages.length > 0 && (
            <div className="border border-border rounded-xl p-4">
              <p className="text-xs font-semibold text-text-primary uppercase tracking-wider font-body mb-3">
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
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all font-body ${
                        isPrimary
                          ? "border-bg-dark bg-bg-secondary shadow-sm"
                          : "border-border hover:border-text-muted bg-bg-primary"
                      }`}
                    >
                      <ColorSwatch
                        hex={seg.main.hex}
                        patternImage={seg.main.patternImage}
                        subColors={seg.subs.length > 0 ? seg.subs : undefined}
                        size={16}
                        rounded="full"
                      />
                      <span className={`text-xs font-medium ${isPrimary ? "text-text-primary" : "text-text-secondary"}`}>
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
            <p className="text-sm text-text-muted font-body text-center py-8">
              Aucune couleur dans les variantes. Ajoutez d&apos;abord des variantes.
            </p>
          ) : colorImages.map((cimg, idx) => {
            const seg = getSwatchSegments(cimg.groupKey);
            const imgVariant = findVariantByGroupKey(cimg.groupKey);
            const hasMultiColors = imgVariant && (imgVariant.subColors.length > 0 || imgVariant.saleType === "PACK");
            const imgPfsRef = imgVariant?.pfsColorRef;
            const imgPfsLabel = imgPfsRef ? pfsColorLabels.get(imgPfsRef) : undefined;
            const missingImages = cimg.uploadedPaths.length === 0;
            return (
            <div key={cimg.groupKey} className={`border rounded-xl p-4 ${missingImages ? "border-[#EF4444] bg-red-50/30" : "border-border"}`}>
              <div className="flex items-center gap-2 mb-3">
                <ColorSwatch
                  hex={seg.main.hex}
                  patternImage={seg.main.patternImage}
                  subColors={seg.subs.length > 0 ? seg.subs : undefined}
                  size={16}
                  rounded="full"
                />
                <span className="text-sm font-semibold text-text-primary font-body">
                  {cimg.colorName}
                </span>
                <span className="text-xs text-text-muted font-body">
                  ({cimg.imagePreviews.length}/5)
                </span>
                {hasMultiColors && imgPfsRef && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-white bg-purple-600 whitespace-nowrap">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-300 animate-pulse shrink-0" />
                    PFS : {imgPfsLabel || imgPfsRef}
                  </span>
                )}
              </div>
              <ImageDropzone
                colorIndex={idx}
                groupKey={cimg.groupKey}
                previews={cimg.imagePreviews}
                orders={cimg.orders}
                onAddAtPosition={(file, pos) => handleAddImageAtPosition(cimg.groupKey, file, pos)}
                onRemoveAtPosition={(pos) => handleRemoveImageAtPosition(cimg.groupKey, pos)}
                onSwapPositions={(from, to) => handleSwapPositions(cimg.groupKey, from, to)}
                onCrossColorDrop={(srcGroupKey, srcPos, targetPos) => handleCrossColorDrop(srcGroupKey, srcPos, cimg.groupKey, targetPos)}
                uploading={cimg.uploading}
                uploadingPosition={uploadingSlots[cimg.groupKey] ?? null}
                hasError={missingImages}
              />
              {missingImages && (
                <p className="text-xs text-[#EF4444] mt-1.5 font-body">Aucune image — ajoutez au moins une image pour cette variante</p>
              )}
            </div>
          );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-bg-dark text-text-inverse text-sm font-medium rounded-lg hover:bg-black transition-colors font-body"
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
  pfsSizes: { reference: string; label: string }[];
  onSave: (entries: SizeEntryState[]) => void;
  /** Called after a size is created via the quick-create modal — parent should add to its availableSizes list */
  onSizeAdded?: (size: AvailableSize) => void;
}

function SizeModal({ open, onClose, variant, availableSizes, pfsSizes, onSave, onSizeAdded }: SizeModalProps) {
  const backdrop = useBackdropClose(onClose);
  const isUnit = variant.saleType === "UNIT";
  const isPack = variant.saleType === "PACK";

  const [draft, setDraft] = useState<SizeEntryState[]>(variant.sizeEntries);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  useEffect(() => {
    setDraft(variant.sizeEntries);
  }, [variant.sizeEntries]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const currentDraft = draft;
  const usedSizeIds = new Set(currentDraft.map((s) => s.sizeId));

  function setCurrentDraft(newDraft: SizeEntryState[]) {
    setDraft(newDraft);
  }

  function toggleSize(size: AvailableSize) {
    if (usedSizeIds.has(size.id)) {
      setCurrentDraft(currentDraft.filter((s) => s.sizeId !== size.id));
    } else {
      if (isUnit && currentDraft.length >= 1) {
        setCurrentDraft([{ tempId: uid(), sizeId: size.id, sizeName: size.name, quantity: "1" }]);
      } else {
        setCurrentDraft([...currentDraft, { tempId: uid(), sizeId: size.id, sizeName: size.name, quantity: "1" }]);
      }
    }
  }

  function updateQty(sizeId: string, qty: string) {
    setCurrentDraft(currentDraft.map((s) => s.sizeId === sizeId ? { ...s, quantity: qty } : s));
  }

  function handleSave() {
    onSave(draft);
    onClose();
  }

  function handleSizeCreated(result: QuickCreateSizeModalResult) {
    const newSize: AvailableSize = { id: result.id, name: result.name };
    onSizeAdded?.(newSize);
    if (isUnit) {
      setCurrentDraft([{ tempId: uid(), sizeId: newSize.id, sizeName: newSize.name, quantity: "1" }]);
    } else {
      setCurrentDraft([...currentDraft, { tempId: uid(), sizeId: newSize.id, sizeName: newSize.name, quantity: "1" }]);
    }
    setQuickCreateOpen(false);
  }

  const packTotalQty = isPack
    ? currentDraft.reduce((s, e) => s + (parseInt(e.quantity) || 0), 0)
    : 0;

  if (!open) return null;

  const modal = (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6" onMouseDown={backdrop.onMouseDown} onMouseUp={backdrop.onMouseUp}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-lg flex flex-col"
        style={{ maxHeight: "min(85vh, 600px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-base font-semibold font-heading text-text-primary">
              {isUnit ? "Taille" : "Tailles & quantités"}
            </h3>
            <p className="text-xs text-text-muted font-body mt-0.5">
              {isUnit ? "Sélectionnez une taille (max 1)" : "Configurez les tailles et quantités du paquet"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-bg-secondary rounded-xl transition-colors" aria-label="Fermer">
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Selected sizes with quantity */}
          {currentDraft.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide font-body">
                Sélectionnées ({currentDraft.length})
              </p>
              {currentDraft.map((se) => (
                <div key={se.tempId} className="flex items-center gap-3 px-3 py-2.5 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg">
                  <svg className="w-4 h-4 text-[#22C55E] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="flex-1 text-sm font-medium text-text-primary font-body">{se.sizeName}</span>
                  {!isUnit && (
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10px] text-text-secondary font-body">Qté</label>
                      <input
                        type="number" min="1" step="1"
                        value={se.quantity}
                        onChange={(e) => updateQty(se.sizeId, e.target.value)}
                        className="w-16 border border-border bg-bg-primary px-2 py-1 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body"
                      />
                    </div>
                  )}
                  <button type="button" onClick={() => toggleSize({ id: se.sizeId, name: se.sizeName })} className="p-1 text-text-muted hover:text-[#EF4444] transition-colors">
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
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide font-body">
              Tailles disponibles
            </p>
            {availableSizes.length === 0 ? (
              <p className="text-xs text-amber-600 font-body">
                Aucune taille dans la bibliothèque. Créez-en une ci-dessous.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableSizes.map((size) => {
                  const isSelected = usedSizeIds.has(size.id);
                  return (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => toggleSize(size)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors font-body ${
                        isSelected
                          ? "bg-bg-dark text-text-inverse border-[#1A1A1A]"
                          : "bg-bg-primary text-text-secondary border-border hover:border-bg-dark hover:text-text-primary"
                      }`}
                    >
                      {size.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick create size — opens dedicated modal */}
          {onSizeAdded && (
            <div className="border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setQuickCreateOpen(true)}
                className="text-sm text-text-primary font-medium hover:underline flex items-center gap-2 font-body"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Créer une taille
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-border bg-bg-primary rounded-b-2xl shrink-0">
          <span className="text-sm text-text-muted font-body">
            {isPack ? (
              packTotalQty > 0
                ? `${packTotalQty} pièce${packTotalQty > 1 ? "s" : ""} au total`
                : "Aucune taille configurée"
            ) : (
              <>
                {currentDraft.length === 0 ? "Aucune taille" : `${currentDraft.length} taille${currentDraft.length > 1 ? "s" : ""}`}
                {currentDraft.length > 0 && (() => {
                  const totalQty = currentDraft.reduce((a, s) => a + (parseInt(s.quantity) || 0), 0);
                  return ` — ${totalQty} pièce${totalQty > 1 ? "s" : ""}`;
                })()}
              </>
            )}
          </span>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onClose}
              className="px-5 py-2 text-sm font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-xl hover:bg-bg-secondary transition-colors"
            >Annuler</button>
            <button type="button" onClick={handleSave}
              className="px-5 py-2 text-sm font-medium font-body text-text-inverse bg-bg-dark rounded-xl hover:bg-primary-hover transition-colors"
            >Valider</button>
          </div>
        </div>
      </div>

      <QuickCreateSizeModal
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        pfsSizes={pfsSizes}
        onCreated={handleSizeCreated}
      />
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
  pfsColorRef?: string;
}

interface QuickAddModalProps {
  open: boolean;
  onClose: () => void;
  existingVariants: VariantState[];
  availableColors: AvailableColor[];
  availableSizes: AvailableSize[];
  pfsSizes: { reference: string; label: string }[];
  onCreateColor?: (name: string, hex: string | null, patternImage: string | null) => Promise<AvailableColor>;
  onColorAdded?: (color: AvailableColor) => void;
  onSizeAdded?: (size: AvailableSize) => void;
  onConfirm: (variants: VariantState[]) => void;
}

function QuickAddModal({
  open, onClose, existingVariants, availableColors, availableSizes, pfsSizes,
  onCreateColor, onColorAdded, onSizeAdded, onConfirm,
}: QuickAddModalProps) {
  const backdrop = useBackdropClose(onClose);

  // PFS color labels (cached globally — no extra network call)
  const { data: pfsAttrData } = usePfsAttributes();
  const pfsColorLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of pfsAttrData?.colors ?? []) {
      if (c.reference && c.labels?.fr) map.set(c.reference, c.labels.fr);
    }
    return map;
  }, [pfsAttrData]);

  // Color lines — each line becomes one variant
  const [colorLines, setColorLines] = useState<QuickAddColorLine[]>([
    { id: uid(), colors: [] },
  ]);

  // Shared fields
  const [saleType, setSaleType] = useState<"UNIT" | "PACK">("UNIT");
  const [unitPrice, setUnitPrice] = useState("");
  const [stock, setStock] = useState("");
  const [weight, setWeight] = useState("");
  const [sizeEntries, setSizeEntries] = useState<SizeEntryState[]>([]);

  // Size quick-create modal
  const [sizeQuickCreateOpen, setSizeQuickCreateOpen] = useState(false);

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
      setSizeEntries([]);
    }
  }, [open]);

  // Existing color combos for quick-select (with pfsColorRef if already mapped)
  const existingCombos = useMemo(() => computeExistingColorCombos(existingVariants), [existingVariants]);

  const usedSizeIds = new Set(sizeEntries.map((s) => s.sizeId));

  function addColorLine() {
    setColorLines((prev) => [...prev, { id: uid(), colors: [] }]);
  }

  function removeColorLine(lineId: string) {
    setColorLines((prev) => prev.filter((l) => l.id !== lineId));
  }

  function updateColorLine(lineId: string, colors: { colorId: string; colorName: string; colorHex: string }[], pfsColorRef?: string) {
    let resolvedRef = pfsColorRef;
    if (resolvedRef === undefined && colors.length > 0) {
      const sortedIds = colors.map((c) => c.colorId).sort().join("+");
      for (const v of existingVariants) {
        if (v.pfsColorRef && v.colorId && v.subColors.length > 0) {
          const vIds = [v.colorId, ...v.subColors.map((sc) => sc.colorId)].sort().join("+");
          if (vIds === sortedIds) { resolvedRef = v.pfsColorRef; break; }
        }
      }
    }
    setColorLines((prev) => prev.map((l) => l.id === lineId ? { ...l, colors, pfsColorRef: resolvedRef } : l));
  }

  function addExistingCombo(combo: typeof existingCombos[0]) {
    setColorLines((prev) => [...prev, { id: uid(), colors: combo.colors, pfsColorRef: combo.pfsColorRef }]);
  }

  function addAllExistingCombos() {
    const newLines = existingCombos.map((c) => ({ id: uid(), colors: c.colors, pfsColorRef: c.pfsColorRef }));
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

  function handleQuickAddSizeCreated(result: QuickCreateSizeModalResult) {
    const newSize: AvailableSize = { id: result.id, name: result.name };
    onSizeAdded?.(newSize);
    if (saleType === "UNIT" && sizeEntries.length >= 1) {
      setSizeEntries([{ tempId: uid(), sizeId: newSize.id, sizeName: newSize.name, quantity: "1" }]);
    } else {
      setSizeEntries((prev) => [...prev, { tempId: uid(), sizeId: newSize.id, sizeName: newSize.name, quantity: "1" }]);
    }
    setSizeQuickCreateOpen(false);
  }

  const validLines = colorLines.filter((l) => l.colors.length > 0);
  const canConfirm = validLines.length > 0;

  function handleConfirm() {
    const isUnitType = saleType === "UNIT";
    const totalQty = sizeEntries.reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);

    // One variant per color line — PACK and UNIT use the same structure
    const newVariants: VariantState[] = validLines.map((line, i) => {
      const [main, ...rest] = line.colors;
      return {
        tempId: uid(),
        colorId: main?.colorId ?? "",
        colorName: main?.colorName ?? "",
        colorHex: main?.colorHex ?? "#9CA3AF",
        subColors: rest.map((c) => ({ colorId: c.colorId, colorName: c.colorName, colorHex: c.colorHex })),
        sizeEntries: sizeEntries.map((se) => ({ ...se, tempId: uid() })),
        unitPrice,
        weight,
        stock,
        isPrimary: i === 0 && existingVariants.length === 0,
        saleType: isUnitType ? "UNIT" : "PACK",
        packQuantity: isUnitType ? "" : String(totalQty || 1),
        pfsColorRef: line.pfsColorRef || "",
        sku: "",
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
        className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col"
        style={{ maxHeight: "min(92vh, 750px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-lg font-semibold font-heading text-text-primary">
              Ajouter des couleurs
            </h3>
            <p className="text-xs text-text-muted font-body mt-1">
              Les paramètres de prix, stock et tailles s’appliqueront à chacune.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 -mr-1 hover:bg-bg-secondary rounded-xl transition-colors" aria-label="Fermer">
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* ── Section 1 : Couleurs ── */}
          <section className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-text-primary font-body">
                Quelles couleurs ?
              </h4>
              <p className="text-xs text-text-muted font-body mt-0.5">
                Une couleur peut combiner plusieurs teintes (ex. rouge + blanc).
              </p>
            </div>

            {/* Réutiliser des couleurs déjà créées sur ce produit */}
            {existingCombos.length > 0 && (
              <div className="rounded-xl bg-bg-secondary/60 border border-border-light p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-text-secondary font-body">
                    Déjà sur ce produit — cliquez pour réutiliser
                  </p>
                  <button type="button" onClick={addAllExistingCombos}
                    className="text-[11px] text-text-secondary hover:text-text-primary font-body hover:underline transition-colors">
                    Toutes les ajouter
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {existingCombos.map((combo) => (
                    <button
                      key={combo.key}
                      type="button"
                      onClick={() => addExistingCombo(combo)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-bg-primary hover:border-bg-dark hover:shadow-sm transition-all text-left"
                    >
                      <div className="flex -space-x-1">
                        {combo.colors.slice(0, 4).map((c, ci) => {
                          const optC = availableColors.find((o) => o.id === c.colorId);
                          return (
                            <ColorSwatch key={ci} hex={c.colorHex} patternImage={optC?.patternImage ?? null} size={14} rounded="full" border />
                          );
                        })}
                      </div>
                      <span className="text-[11px] text-text-secondary font-body truncate max-w-[140px]">
                        {combo.colors.map((c) => c.colorName).join(" / ")}
                      </span>
                      <svg className="w-3 h-3 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Liste éditable */}
            <div className="space-y-2">
              {colorLines.map((line) => (
                <div key={line.id} className="flex items-center gap-2">
                  <div className="flex-1">
                    <MultiColorSelect
                      selected={line.colors}
                      options={availableColors}
                      onChange={(colors, pfsRef) => updateColorLine(line.id, colors, pfsRef)}
                      existingVariants={existingVariants}
                      onCreateColor={onCreateColor}
                      onColorAdded={onColorAdded}
                      pfsColorRef={line.pfsColorRef}
                      pfsColorRefLabel={line.pfsColorRef ? (pfsColorLabels.get(line.pfsColorRef) ?? undefined) : undefined}
                      mappedCombos={pfsAttrData?.mappedCombos}
                    />
                  </div>
                  {colorLines.length > 1 && (
                    <button type="button" onClick={() => removeColorLine(line.id)}
                      aria-label="Retirer cette couleur"
                      className="p-1.5 text-text-muted hover:text-[#EF4444] hover:bg-red-50 rounded-lg transition-colors shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}

              <button type="button" onClick={addColorLine}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-text-secondary font-medium font-body border border-dashed border-border rounded-xl hover:border-bg-dark hover:text-text-primary transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Ajouter une autre couleur
              </button>
            </div>
          </section>

          {/* ── Section 2 : Mode de vente ── */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-text-primary font-body">
              Mode de vente
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <button type="button"
                onClick={() => { setSaleType("UNIT"); if (sizeEntries.length > 1) setSizeEntries(sizeEntries.slice(0, 1)); }}
                className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all font-body ${
                  saleType === "UNIT"
                    ? "border-[#1A1A1A] bg-bg-secondary ring-1 ring-[#1A1A1A]"
                    : "border-border bg-bg-primary hover:border-bg-dark"
                }`}>
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${saleType === "UNIT" ? "border-[#1A1A1A]" : "border-border"}`}>
                  {saleType === "UNIT" && <div className="w-2 h-2 rounded-full bg-[#1A1A1A]" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">À l’unité</p>
                  <p className="text-[11px] text-text-muted mt-0.5">Vente individuelle, une taille par couleur</p>
                </div>
              </button>
              <button type="button"
                onClick={() => setSaleType("PACK")}
                className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all font-body ${
                  saleType === "PACK"
                    ? "border-[#7C3AED] bg-[#FAF5FF] ring-1 ring-[#7C3AED]"
                    : "border-border bg-bg-primary hover:border-bg-dark"
                }`}>
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${saleType === "PACK" ? "border-[#7C3AED]" : "border-border"}`}>
                  {saleType === "PACK" && <div className="w-2 h-2 rounded-full bg-[#7C3AED]" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">En pack</p>
                  <p className="text-[11px] text-text-muted mt-0.5">Plusieurs pièces groupées, qté par taille</p>
                </div>
              </button>
            </div>
          </section>

          {/* ── Section 3 : Prix, stock, poids ── */}
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-text-primary font-body">
              Prix & stock
            </h4>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary font-body mb-1">Prix unitaire</label>
                <div className="relative">
                  <input type="number" min="0" step="0.01" value={unitPrice} placeholder="0,00"
                    onChange={(e) => setUnitPrice(e.target.value)}
                    className="field-input w-full text-sm pr-7" />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-text-muted font-body">€</span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary font-body mb-1">Stock</label>
                <input type="number" min="0" step="1" value={stock} placeholder="0"
                  onChange={(e) => setStock(e.target.value)}
                  className="field-input w-full text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary font-body mb-1">Poids</label>
                <div className="relative">
                  <input type="number" min="0" step="0.001" value={weight} placeholder="0,000"
                    onChange={(e) => setWeight(e.target.value)}
                    className="field-input w-full text-sm pr-8" />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-text-muted font-body">kg</span>
                </div>
              </div>
            </div>
          </section>

          {/* ── Section 4 : Tailles ── */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h4 className="text-sm font-semibold text-text-primary font-body">
                Tailles disponibles
              </h4>
              <p className="text-[11px] text-text-muted font-body">
                {saleType === "UNIT" ? "Une seule taille possible" : "Définissez la quantité par taille"}
              </p>
            </div>

            {/* Available sizes (toggle chips) */}
            {availableSizes.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {availableSizes.map((size) => {
                  const isSelected = usedSizeIds.has(size.id);
                  return (
                    <button key={size.id} type="button" onClick={() => toggleSize(size)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors font-body ${
                        isSelected
                          ? "bg-bg-dark text-text-inverse border-[#1A1A1A]"
                          : "bg-bg-primary text-text-secondary border-border hover:border-bg-dark"
                      }`}>
                      {size.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-body">
                Aucune taille dans la bibliothèque. Créez-en une ci-dessous.
              </p>
            )}

            {/* PACK : pièces par taille */}
            {saleType === "PACK" && sizeEntries.length > 0 && (
              <div className="rounded-xl bg-bg-secondary/60 border border-border-light p-3 space-y-1.5">
                <p className="text-[11px] text-text-muted font-body mb-1">
                  Pièces par taille dans un pack
                </p>
                {sizeEntries.map((se) => (
                  <div key={se.tempId} className="flex items-center gap-2">
                    <span className="text-xs text-text-primary font-medium flex-1 font-body">{se.sizeName}</span>
                    <input type="number" min="1" step="1" value={se.quantity}
                      onChange={(e) => updateSizeQty(se.sizeId, e.target.value)}
                      className="w-16 border border-border bg-bg-primary px-2 py-1 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body"
                    />
                    <span className="text-[10px] text-text-muted font-body w-10">pièces</span>
                  </div>
                ))}
              </div>
            )}

            {/* Créer une taille */}
            {onSizeAdded && (
              <button
                type="button"
                onClick={() => setSizeQuickCreateOpen(true)}
                className="text-xs text-text-secondary hover:text-text-primary flex items-center gap-1 font-body hover:underline transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Créer une nouvelle taille
              </button>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-border bg-bg-primary rounded-b-2xl shrink-0">
          <span className="text-sm text-text-secondary font-body">
            {validLines.length === 0
              ? "Choisissez au moins une couleur"
              : validLines.length === 1
                ? "Prêt à ajouter 1 couleur"
                : `Prêt à ajouter ${validLines.length} couleurs`
            }
          </span>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onClose}
              className="px-5 py-2 text-sm font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-xl hover:bg-bg-secondary transition-colors"
            >Annuler</button>
            <button type="button" onClick={handleConfirm} disabled={!canConfirm}
              className="px-5 py-2 text-sm font-medium font-body text-text-inverse bg-bg-dark rounded-xl hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >Ajouter</button>
          </div>
        </div>
      </div>

      <QuickCreateSizeModal
        open={sizeQuickCreateOpen}
        onClose={() => setSizeQuickCreateOpen(false)}
        pfsSizes={pfsSizes}
        onCreated={handleQuickAddSizeCreated}
      />
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
  pfsSizes = [],
  onChange,
  onChangeImages,
  onQuickCreateColor,
  onColorAdded,
  onSizeAdded,
  variantErrors,
}: Props) {
  const { confirm: confirmDialog } = useConfirm();

  // PFS color labels (reference → French label) for button display — cached globally
  const { data: pfsAttrData } = usePfsAttributes();
  const pfsColorLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of pfsAttrData?.colors ?? []) {
      if (c.reference && c.labels?.fr) map.set(c.reference, c.labels.fr);
    }
    return map;
  }, [pfsAttrData]);

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
  const hasAnyMissingImages = colorImages.some((c) => c.uploadedPaths.length === 0);
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

  function handleMultiColorChange(tempIds: Set<string>, colors: { colorId: string; colorName: string; colorHex: string }[], pfsColorRefOverride?: string) {
    if (colors.length === 0) {
      onChange(variants.map((v) => tempIds.has(v.tempId) ? { ...v, colorId: "", colorName: "", colorHex: "#9CA3AF", subColors: [], pfsColorRef: "" } : v));
      return;
    }
    const [main, ...rest] = colors;
    // Auto-resolve pfsColorRef from existing variant with same color combination
    let resolvedRef = pfsColorRefOverride;
    if (resolvedRef === undefined && colors.length > 1) {
      const sortedIds = colors.map((c) => c.colorId).sort().join("+");
      // 1. Check same-product variants first
      for (const ov of variants) {
        if (!tempIds.has(ov.tempId) && ov.pfsColorRef) {
          if (ov.colorId && ov.subColors.length > 0) {
            const vIds = [ov.colorId, ...ov.subColors.map((sc) => sc.colorId)].sort().join("+");
            if (vIds === sortedIds) { resolvedRef = ov.pfsColorRef; break; }
          }
        }
      }
      // 2. Check cross-product mapped combinations from DB (skip if already used by another variant)
      if (resolvedRef === undefined && pfsAttrData?.mappedCombos?.[sortedIds]) {
        const candidate = pfsAttrData.mappedCombos[sortedIds];
        const alreadyUsed = variants.some((ov) => !tempIds.has(ov.tempId) && ov.pfsColorRef === candidate);
        if (!alreadyUsed) resolvedRef = candidate;
      }
    }
    // Compute the final combo key for sibling detection
    const finalComboSortedIds = colors.map((c) => c.colorId).sort().join("+");
    const finalPfsRef = resolvedRef;

    onChange(variants.map((v) => {
      if (tempIds.has(v.tempId)) {
        // Check if color combination actually changed — if so, clear pfsColorRef override
        const oldKey = variantGroupKeyFromState(v);
        const newKey = rest.length === 0 ? main.colorId : `${main.colorId}::${rest.map((c) => c.colorName).join(",")}`;
        const combinationChanged = oldKey !== newKey;
        return {
          ...v,
          colorId: main.colorId, colorName: main.colorName, colorHex: main.colorHex,
          subColors: rest.map((c) => ({ colorId: c.colorId, colorName: c.colorName, colorHex: c.colorHex })),
          // Use explicit override if provided, auto-resolved, otherwise clear if combination changed
          pfsColorRef: finalPfsRef !== undefined ? finalPfsRef : (combinationChanged ? "" : v.pfsColorRef),
        };
      }
      // Auto-propagate to sibling variants with same color combination
      // When override is explicit (user chose), propagate to ALL siblings; when auto-resolved, only unmapped ones
      if (finalPfsRef && colors.length > 1 && (pfsColorRefOverride !== undefined || !v.pfsColorRef)) {
        if (v.colorId && v.subColors.length > 0) {
          const vIds = [v.colorId, ...v.subColors.map((sc) => sc.colorId)].sort().join("+");
          if (vIds === finalComboSortedIds) {
            // Also save to DB if the sibling has a dbId
            if (v.dbId) { updateProductColorPfsRef(v.dbId, finalPfsRef).catch(() => {}); }
            return { ...v, pfsColorRef: finalPfsRef };
          }
        }
      }
      return v;
    }));
  }

  // ── Size modal save ─────────────────────────────────────────────────────
  function handleSizeSave(variantTempId: string, entries: SizeEntryState[]) {
    const v = variants.find((x) => x.tempId === variantTempId);
    if (!v) return;
    const patch: Partial<VariantState> = { sizeEntries: entries };
    if (v.saleType === "PACK") {
      const totalQty = entries.reduce((sum, se) => sum + (parseInt(se.quantity) || 0), 0);
      patch.packQuantity = String(totalQty || 1);
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
    if (v.sizeEntries.length === 0) return <span className="text-text-muted italic">—</span>;
    if (v.saleType === "UNIT") {
      return <span className="text-text-primary font-medium">{v.sizeEntries[0]?.sizeName}</span>;
    }
    const summary = v.sizeEntries.map((s) => `${s.sizeName}×${s.quantity}`).join(", ");
    return (
      <span className="truncate text-text-primary font-medium" title={summary}>
        {summary}
      </span>
    );
  }

  // ── Render helper: total price ────────────────────────────────────────────
  function renderTotalPrice(v: VariantState) {
    const total = computeTotalPrice(v);
    const final = computeFinalPrice(v);
    const hasDiscount = final !== null && total !== null && final !== total;
    if (total === null) return <span className="text-text-muted">—</span>;
    return (
      <div className="text-right">
        {hasDiscount && final !== null ? (
          <>
            <span className="text-text-muted line-through text-[10px]">{total.toFixed(2)}€</span>
            <br />
            <span className="text-emerald-600 font-semibold">{final.toFixed(2)}€</span>
          </>
        ) : (
          <span className="font-semibold text-text-primary">{total.toFixed(2)}€</span>
        )}
      </div>
    );
  }

  // ── Render helper: used PFS color refs (for conflict display) ──────────
  // Save PFS color ref for a variant AND propagate DB saves to siblings with same color combination
  // Note: local state propagation is handled by handleMultiColorChange, this only handles DB persistence
  async function handlePfsRefChangeAndPropagate(variant: VariantState, ref: string) {
    const pfsRef = ref || null;
    // Save to DB for the target variant
    if (variant.dbId) {
      try { await updateProductColorPfsRef(variant.dbId, pfsRef); } catch (err) { console.error("[PFS] Failed to save pfsColorRef:", err); }
    }
    if (!pfsRef) return;
    // Compute the color combo key for this variant
    let targetIds = "";
    if (variant.colorId && variant.subColors.length > 0) {
      targetIds = [variant.colorId, ...variant.subColors.map((sc) => sc.colorId)].sort().join("+");
    }
    if (!targetIds) return;
    // Find siblings with same combo (propagate to ALL siblings)
    const siblings = variants.filter((v) => {
      if (v.tempId === variant.tempId) return false;
      if (v.colorId && v.subColors.length > 0) {
        return [v.colorId, ...v.subColors.map((sc) => sc.colorId)].sort().join("+") === targetIds;
      }
      return false;
    });
    // Save siblings to DB (local state is handled by handleMultiColorChange via confirm())
    if (siblings.length > 0) {
      await Promise.all(siblings.filter((s) => s.dbId).map((s) => updateProductColorPfsRef(s.dbId!, pfsRef).catch(() => {})));
    }
  }

  function getUsedPfsColorRefs(excludeTempId: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const ov of variants) {
      if (ov.tempId === excludeTempId) continue;
      if (!ov.colorId) continue;
      if (ov.subColors.length > 0 && ov.pfsColorRef) {
        map.set(ov.pfsColorRef, [ov.colorName, ...ov.subColors.map((sc) => sc.colorName)].join(" / "));
      } else if (ov.subColors.length === 0) {
        const colorOpt = availableColors.find((c) => c.id === ov.colorId);
        if (colorOpt?.pfsColorRef) map.set(colorOpt.pfsColorRef, ov.colorName);
      }
    }
    return map;
  }

  return (
    <div className="space-y-4">

      {/* ── Variants area ── */}
      {variants.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-border text-text-muted text-sm font-body rounded-lg">
          Cliquez sur &ldquo;Ajouter une variante&rdquo; pour commencer.
        </div>
      ) : (
        <div className="space-y-3">
          {/* ── Variants CARDS (mobile only) ── */}
          <div className="block md:hidden border border-border rounded-xl overflow-hidden divide-y divide-[#F0F0F0]">
            {/* Mobile bulk bar */}
            <div className={`px-3 py-2 flex items-center gap-2 ${showBulkRow ? "bg-[#F0FDF4]" : "bg-[#FAFAFA]"}`}>
              <input type="checkbox"
                checked={selectedIds.size === variants.length && variants.length > 0}
                onChange={(e) => {
                  if (e.target.checked) setSelectedIds(new Set(variants.map((v) => v.tempId)));
                  else setSelectedIds(new Set());
                }}
                className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5 shrink-0"
              />
              <span className={`text-[10px] font-body flex-1 ${showBulkRow ? "text-[#16A34A] font-semibold" : "text-[#D1D5DB]"}`}>
                {showBulkRow ? `${selectedIds.size} sélectionnée${selectedIds.size > 1 ? "s" : ""}` : "Tout sélectionner"}
              </span>
              {showBulkRow && (
                <div className="flex items-center gap-1.5">
                  <input type="number" min="0" step="0.01" placeholder="Prix" value={bulkEdit.unitPrice}
                    onChange={(e) => setBulkEdit((b) => ({ ...b, unitPrice: e.target.value }))}
                    className="w-16 border border-[#86EFAC] bg-bg-primary px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-body" />
                  <input type="number" min="0" step="1" placeholder="Stock" value={bulkEdit.stock}
                    onChange={(e) => setBulkEdit((b) => ({ ...b, stock: e.target.value }))}
                    className="w-14 border border-[#86EFAC] bg-bg-primary px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-body" />
                  <button type="button" onClick={applyBulk}
                    className="p-1 rounded text-[#16A34A] hover:bg-[#DCFCE7] transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Variant cards */}
            {sortedVariants.map((v) => {
              const isSelected  = selectedIds.has(v.tempId);
              const isDuplicate = duplicateTempIds.has(v.tempId);
              const isUnit = v.saleType === "UNIT";
              const vErrs = variantErrors?.get(v.tempId);
              const isMultiColor = v.subColors.length > 0;
              const pfsMissing = !!pfsAttrData && isMultiColor && !v.pfsColorRef;
              const imgGk = imageGroupKeyFromVariant(v);
              const imgEntry = colorImages.find((c) => c.groupKey === imgGk);
              const imgCount = imgEntry?.uploadedPaths.length ?? 0;

              return (
                <div key={v.tempId} className={`p-3 space-y-2.5 ${pfsMissing ? "ring-2 ring-[#EF4444]/50 rounded-lg bg-[#FEF2F2]/40" : isDuplicate ? "bg-[#FEF2F2]" : isSelected ? "bg-[#F0FDF4]" : ""}`}>
                  {/* Row 1: checkbox + type + image badge + delete */}
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={isSelected}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(v.tempId); else next.delete(v.tempId);
                        setSelectedIds(next);
                      }}
                      className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5 shrink-0" />
                    <CustomSelect
                      value={v.saleType}
                      onChange={(val) => {
                        if (val === "PACK" && v.saleType === "UNIT") {
                          const totalQty = v.sizeEntries.reduce((s, se) => s + (parseInt(se.quantity) || 0), 0);
                          updateVariant(v.tempId, { saleType: "PACK", packQuantity: String(totalQty || 1) });
                        } else if (val === "UNIT" && v.saleType === "PACK") {
                          const restoredSizes = v.sizeEntries.slice(0, 1);
                          updateVariant(v.tempId, { saleType: "UNIT", packQuantity: "", sizeEntries: restoredSizes });
                        }
                      }}
                      options={[{ value: "UNIT", label: "Unité" }, { value: "PACK", label: "Pack" }]}
                      size="sm" className="w-[75px]" />
                    <div className="flex-1" />
                    {/* Image count badge */}
                    <span
                      title={imgCount === 0 ? "Aucune image" : `${imgCount} image${imgCount > 1 ? "s" : ""}`}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold font-body ${
                        imgCount === 0
                          ? "bg-[#FEE2E2] text-[#DC2626]"
                          : "bg-bg-secondary text-text-muted"
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18a1.5 1.5 0 001.5-1.5V6A1.5 1.5 0 0021 4.5H3A1.5 1.5 0 001.5 6v13.5A1.5 1.5 0 003 21z" />
                      </svg>
                      {imgCount}/5
                    </span>
                                          <button type="button" onClick={() => removeVariant(v.tempId)} title="Supprimer"
                        className="p-1 text-text-muted hover:text-[#EF4444] transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                  </div>

                  {/* SKU */}
                  {v.sku && (
                    <div className="text-[10px] text-text-muted font-mono truncate" title={v.sku}>
                      SKU: {v.sku}
                    </div>
                  )}

                  {/* Row 2: color */}
                  <MultiColorSelect
                    selected={v.colorId ? [{ colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex }, ...v.subColors.map((sc) => ({ colorId: sc.colorId, colorName: sc.colorName, colorHex: sc.colorHex }))] : []}
                    options={availableColors}
                    onChange={(colors, pfsRef) => handleMultiColorChange(new Set([v.tempId]), colors, pfsRef)}
                    existingVariants={variants}
                    editingGroupKey={variantGroupKeyFromState(v)}
                    pfsColorRef={v.pfsColorRef}
                    pfsColorRefLabel={v.pfsColorRef ? (pfsColorLabels.get(v.pfsColorRef) ?? undefined) : undefined}
                    onPfsColorRefChange={(ref) => handlePfsRefChangeAndPropagate(v, ref)}
                    usedPfsColorRefs={getUsedPfsColorRefs(v.tempId)}
                    onCreateColor={onQuickCreateColor}
                    onColorAdded={onColorAdded}
                    mappedCombos={pfsAttrData?.mappedCombos}
                  />
                  {pfsMissing && (
                    <span className="flex items-center gap-1 text-[10px] text-[#DC2626] font-medium">
                      <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                      </svg>
                      Correspondance Paris Fashion Shop manquante
                    </span>
                  )}

                  {/* Row 3: prix / stock / poids */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-text-muted font-semibold mb-1 font-body">Prix/u</p>
                      <input type="number" min="0" step="0.01" value={v.unitPrice} placeholder="0.00"
                        onChange={(e) => updateVariant(v.tempId, { unitPrice: e.target.value })}
                        className={`w-full border ${vErrs?.has("price") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-2 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`} />
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-text-muted font-semibold mb-1 font-body">Stock</p>
                      <input type="number" min="0" step="1" value={v.stock} placeholder="0"
                        onChange={(e) => updateVariant(v.tempId, { stock: e.target.value })}
                        className={`w-full border ${vErrs?.has("stock") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-2 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`} />
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-text-muted font-semibold mb-1 font-body">Poids</p>
                      <input type="number" min="0" step="0.001" value={v.weight} placeholder="0.000"
                        onChange={(e) => updateVariant(v.tempId, { weight: e.target.value })}
                        className={`w-full border ${vErrs?.has("weight") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-2 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`} />
                    </div>
                  </div>

                  {/* Row 4: tailles + total + remise */}
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] uppercase tracking-wider text-text-muted font-semibold mb-1 font-body">Tailles</p>
                      <button type="button" onClick={() => setSizeModalVariantId(v.tempId)}
                        className={`w-full flex items-center gap-1.5 bg-bg-primary border ${vErrs?.has("sizes") ? "border-[#EF4444]" : "border-border"} px-2 py-1.5 text-xs text-left rounded-md hover:border-[#9CA3AF] transition-colors min-h-[30px]`}>
                        {renderSizeSummary(v)}
                        <svg className="w-3 h-3 text-text-muted shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                    <div className="shrink-0">
                      <p className="text-[9px] uppercase tracking-wider text-text-muted font-semibold mb-1 font-body">Total</p>
                      <div className="text-xs pt-1.5">{renderTotalPrice(v)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Variants TABLE (desktop only) ── */}
          <div className="hidden md:block border border-border rounded-xl overflow-hidden">
              <table className="w-full table-fixed text-xs font-body">
                <thead>
                  {/* Column headers */}
                  <tr className="bg-bg-secondary border-b border-border">
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
                    <th className="w-[68px] px-2 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted font-semibold">Type</th>
                    <th className="w-[22%] px-2 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted font-semibold">Couleur / SKU</th>
                    <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted font-semibold">Tailles</th>
                    <th className="px-2 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted font-semibold">Stock</th>
                    <th className="px-2 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted font-semibold">Poids</th>
                    <th className="px-2 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted font-semibold">Prix/unité</th>
                    <th className="w-[60px] px-2 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted font-semibold">Total</th>
                    <th className="w-[52px] px-2 py-2"></th>
                  </tr>
                  {/* Bulk edit row — inline in thead */}
                  <tr className={`border-b transition-colors ${showBulkRow ? "bg-[#F0FDF4] border-[#BBF7D0]" : "bg-[#FAFAFA] border-border"}`}>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`text-[9px] font-semibold ${showBulkRow ? "text-[#16A34A]" : "text-[#D1D5DB]"}`}>
                        {showBulkRow ? selectedIds.size : "—"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5" colSpan={2}>
                      <span className={`text-[10px] font-body ${showBulkRow ? "text-[#16A34A] font-semibold" : "text-[#D1D5DB]"}`}>
                        {showBulkRow
                          ? `${selectedIds.size} sélectionnée${selectedIds.size > 1 ? "s" : ""}`
                          : "Modification en masse"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      {/* Tailles: not bulk-editable */}
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="1" placeholder="Stock" value={bulkEdit.stock} disabled={!showBulkRow}
                        onChange={(e) => setBulkEdit((b) => ({ ...b, stock: e.target.value }))}
                        className={`w-full border px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-body ${
                          showBulkRow ? "border-[#86EFAC] bg-bg-primary" : "border-border bg-bg-secondary text-[#D1D5DB] cursor-not-allowed"
                        }`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.001" placeholder="Poids" value={bulkEdit.weight} disabled={!showBulkRow}
                        onChange={(e) => setBulkEdit((b) => ({ ...b, weight: e.target.value }))}
                        className={`w-full border px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-body ${
                          showBulkRow ? "border-[#86EFAC] bg-bg-primary" : "border-border bg-bg-secondary text-[#D1D5DB] cursor-not-allowed"
                        }`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.01" placeholder="Prix" value={bulkEdit.unitPrice} disabled={!showBulkRow}
                        onChange={(e) => setBulkEdit((b) => ({ ...b, unitPrice: e.target.value }))}
                        className={`w-full border px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-body ${
                          showBulkRow ? "border-[#86EFAC] bg-bg-primary" : "border-border bg-bg-secondary text-[#D1D5DB] cursor-not-allowed"
                        }`} />
                    </td>
                    <td className="px-2 py-1.5">
                      {/* Total: computed */}
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
                    const vErrs = variantErrors?.get(v.tempId);
                    const colorDisplayName = [v.colorName, ...v.subColors.map((sc) => sc.colorName)].filter(Boolean).join(", ") || "Sans couleur";
                    void colorDisplayName;
                    const isMultiColorD = v.subColors.length > 0;
                    const pfsMissingD = !!pfsAttrData && isMultiColorD && !v.pfsColorRef;
                    const imgGkD = imageGroupKeyFromVariant(v);
                    const imgEntryD = colorImages.find((c) => c.groupKey === imgGkD);
                    const imgCountD = imgEntryD?.uploadedPaths.length ?? 0;

                    return (
                      <tr
                        key={v.tempId}
                        className={`border-b border-border-light last:border-b-0 transition-colors ${
                          pfsMissingD ? "bg-[#FEF2F2]/60 outline outline-2 outline-[#EF4444]/40" : isDuplicate ? "bg-[#FEF2F2]" : isSelected ? "bg-[#F0FDF4]" : "hover:bg-[#FAFAFA]"
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
                                const totalQty = v.sizeEntries.reduce((s, se) => s + (parseInt(se.quantity) || 0), 0);
                                updateVariant(v.tempId, { saleType: "PACK", packQuantity: String(totalQty || 1) });
                              } else if (val === "UNIT" && v.saleType === "PACK") {
                                const restoredSizes = v.sizeEntries.slice(0, 1);
                                updateVariant(v.tempId, { saleType: "UNIT", packQuantity: "", sizeEntries: restoredSizes });
                              }
                            }}
                            options={[
                              { value: "UNIT", label: "Unité" },
                              { value: "PACK", label: "Pack" },
                            ]}
                            size="sm"
                            className="w-[65px]"
                          />
                        </td>

                        {/* Color + SKU */}
                        <td className="px-2 py-2">
                          <MultiColorSelect
                            selected={v.colorId ? [
                              { colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex },
                              ...v.subColors.map((sc) => ({ colorId: sc.colorId, colorName: sc.colorName, colorHex: sc.colorHex })),
                            ] : []}
                            options={availableColors}
                            onChange={(colors, pfsRef) => handleMultiColorChange(new Set([v.tempId]), colors, pfsRef)}
                            existingVariants={variants}
                            editingGroupKey={variantGroupKeyFromState(v)}
                            pfsColorRef={v.pfsColorRef}
                            pfsColorRefLabel={v.pfsColorRef ? (pfsColorLabels.get(v.pfsColorRef) ?? undefined) : undefined}
                            onPfsColorRefChange={(ref) => handlePfsRefChangeAndPropagate(v, ref)}
                            usedPfsColorRefs={getUsedPfsColorRefs(v.tempId)}
                            onCreateColor={onQuickCreateColor}
                            onColorAdded={onColorAdded}
                            mappedCombos={pfsAttrData?.mappedCombos}
                          />
                          {pfsMissingD && (
                            <span className="flex items-center gap-1 mt-1 text-[10px] text-[#DC2626] font-medium">
                              <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                              </svg>
                              Correspondance Paris Fashion Shop manquante
                            </span>
                          )}
                          <span className="text-[10px] text-text-muted font-mono truncate block mt-1" title={v.sku || "—"}>
                            {v.sku || "—"}
                          </span>
                        </td>

                        {/* Sizes — click to open modal */}
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => setSizeModalVariantId(v.tempId)}
                            className={`w-full flex items-center gap-1.5 bg-bg-primary border ${vErrs?.has("sizes") ? "border-[#EF4444]" : "border-border"} px-2 py-1.5 text-xs text-left rounded-md hover:border-[#9CA3AF] transition-colors min-h-[30px]`}
                            title={v.sizeEntries.length > 0 ? v.sizeEntries.map((s) => `${s.sizeName}×${s.quantity}`).join(", ") : "Ajouter des tailles"}
                          >
                            {renderSizeSummary(v)}
                            <svg className="w-3 h-3 text-text-muted shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                        </td>

                        {/* Stock */}
                        <td className="px-2 py-2">
                          <input
                            type="number" min="0" step="1"
                            value={v.stock}
                            placeholder="0"
                            onChange={(e) => updateVariant(v.tempId, { stock: e.target.value })}
                            className={`w-full border ${vErrs?.has("stock") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-2 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`}
                          />
                        </td>

                        {/* Weight */}
                        <td className="px-2 py-2">
                          <input
                            type="number" min="0" step="0.001"
                            value={v.weight}
                            placeholder="0.000"
                            onChange={(e) => updateVariant(v.tempId, { weight: e.target.value })}
                            className={`w-full border ${vErrs?.has("weight") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-2 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`}
                          />
                        </td>


                        {/* Unit Price */}
                        <td className="px-2 py-2">
                          <input
                            type="number" min="0" step="0.01"
                            value={v.unitPrice}
                            placeholder="0.00"
                            onChange={(e) => updateVariant(v.tempId, { unitPrice: e.target.value })}
                            className={`w-full border ${vErrs?.has("price") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-2 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`}
                          />
                        </td>

                        {/* Total price */}
                        <td className="px-2 py-2 text-right text-xs">
                          {renderTotalPrice(v)}
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <span
                              title={imgCountD === 0 ? "Aucune image" : `${imgCountD} image${imgCountD > 1 ? "s" : ""}`}
                              className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold font-body ${
                                imgCountD === 0
                                  ? "bg-[#FEE2E2] text-[#DC2626]"
                                  : "text-text-muted"
                              }`}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18a1.5 1.5 0 001.5-1.5V6A1.5 1.5 0 0021 4.5H3A1.5 1.5 0 001.5 6v13.5A1.5 1.5 0 003 21z" />
                              </svg>
                              {imgCountD}
                            </span>
                              <button type="button" onClick={() => removeVariant(v.tempId)}
                                title="Supprimer" className="p-1 text-text-muted hover:text-[#EF4444] transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
          </div>

          {/* Duplicate warning */}
          {duplicateTempIds.size > 0 && (
            <div className="px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg flex items-center gap-2">
              <svg className="w-4 h-4 text-[#EF4444] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs text-[#EF4444] font-body">
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
            className="flex-1 border-2 border-dashed border-border py-3 text-sm font-body text-text-secondary hover:border-bg-dark hover:bg-bg-secondary transition-colors flex items-center justify-center gap-2 rounded-lg"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Ajouter une variante
          </button>
          <button
            type="button"
            onClick={() => setShowQuickAdd(true)}
            className="flex-1 border-2 border-dashed border-border py-3 text-sm font-body text-text-secondary hover:border-bg-dark hover:bg-bg-secondary transition-colors flex items-center justify-center gap-2 rounded-lg"
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
            className={`w-full border-2 border-dashed py-3 text-sm font-body transition-colors flex items-center justify-center gap-2 rounded-lg ${
              hasAnyMissingImages
                ? "border-[#EF4444] text-[#EF4444] hover:border-red-400 hover:bg-red-50/50"
                : "border-border text-text-secondary hover:border-bg-dark hover:bg-bg-secondary"
            }`}
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
        pfsColorLabels={pfsColorLabels}
      />

      {/* ── Size Modal ── */}
      {sizeModalVariant && (
        <SizeModal
          open={!!sizeModalVariantId}
          onClose={() => setSizeModalVariantId(null)}
          variant={sizeModalVariant}
          availableSizes={availableSizes}
          pfsSizes={pfsSizes}
          onSave={(entries) => handleSizeSave(sizeModalVariant.tempId, entries)}
          onSizeAdded={onSizeAdded}
        />
      )}

      {/* ── Quick Add Modal ── */}
      <QuickAddModal
        open={showQuickAdd}
        onClose={() => setShowQuickAdd(false)}
        existingVariants={variants}
        availableColors={availableColors}
        availableSizes={availableSizes}
        pfsSizes={pfsSizes}
        onCreateColor={onQuickCreateColor}
        onColorAdded={onColorAdded}
        onSizeAdded={onSizeAdded}
        onConfirm={handleQuickAddConfirm}
      />
    </div>
  );
}
