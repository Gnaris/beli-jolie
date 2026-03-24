"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import ImageDropzone from "./ImageDropzone";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";
import ColorSwatch from "@/components/ui/ColorSwatch";

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
  pricePerUnit?: string; // PACK only — prix par unité pour cette taille
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
  unitPrice: string;       // Prix HT (pour l'unité ou pour le paquet entier)
  weight: string;
  stock: string;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: string;    // Quantité par paquet (PACK only)
  discountType: "" | "PERCENT" | "AMOUNT";
  discountValue: string;
}

export interface ColorImageState {
  groupKey: string;       // colorId + ordered sub-color names — shared by variants with same color selection (order matters)
  colorId: string;
  colorName: string;      // Full display name including sub-colors (e.g. "Doré / Argenté / Or Rose")
  colorHex: string;
  imagePreviews: string[];
  uploadedPaths: string[];
  orders: number[];       // 0-based order values (parallel to uploadedPaths), preserved from DB
  uploading: boolean;
}

export interface AvailableColor {
  id: string;
  name: string;
  hex: string | null;
  patternImage?: string | null;
}

export interface AvailableSize {
  id: string;
  name: string;
  categoryIds?: string[]; // sizes linked to specific categories
}

interface Props {
  variants: VariantState[];
  colorImages: ColorImageState[];
  availableColors: AvailableColor[];
  availableSizes: AvailableSize[];
  onChange: (variants: VariantState[]) => void;
  onChangeImages: (images: ColorImageState[]) => void;
  onQuickCreateColor?: (name: string, hex: string | null, patternImage: string | null) => Promise<AvailableColor>;
}

// ─────────────────────────────────────────────
// Price helpers (exported for reuse in ProductForm)
// ─────────────────────────────────────────────

export function computeTotalPrice(v: VariantState): number | null {
  if (v.saleType === "UNIT") {
    const unit = parseFloat(v.unitPrice);
    return (isNaN(unit) || unit <= 0) ? null : unit;
  }
  // PACK: Σ(qty_i × pricePerUnit_i) × packQuantity
  const packQty = parseInt(v.packQuantity);
  if (isNaN(packQty) || packQty <= 0) return null;
  if (v.sizeEntries.length === 0) return null;
  let sum = 0;
  for (const se of v.sizeEntries) {
    const qty = parseInt(se.quantity);
    const ppu = parseFloat(se.pricePerUnit ?? "");
    if (isNaN(qty) || qty <= 0 || isNaN(ppu) || ppu <= 0) return null;
    sum += qty * ppu;
  }
  return sum > 0 ? sum * packQty : null;
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
  // PACK: sort each line's colors, then sort lines — also include packQuantity
  const linesKey = v.packColorLines
    .map((line) => line.colors.map((c) => c.colorId).sort().join("+"))
    .sort()
    .join("|");
  return `PACK::${v.packQuantity}::${linesKey}::${sizeKey}`;
}

function findDuplicateVariantTempIds(variants: VariantState[]): Set<string> {
  const seen = new Map<string, string>(); // key → first tempId
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

/** Unique key for a color+sub-colors combination. Variants sharing this key share images.
 *  Order matters: "Doré/Rouge" ≠ "Rouge/Doré". The first color is the main color (colorId),
 *  the rest are sub-colors in selection order. */
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
// MultiColorSelect — modal-based multi-select (first = main, rest = sub-colors)
// With drag & drop reordering + remove in the selection zone
// ─────────────────────────────────────────────
function MultiColorSelect({ selected, options, onChange, existingVariants, onCreateColor }: {
  selected: { colorId: string; colorName: string; colorHex: string }[];
  options: AvailableColor[];
  onChange: (colors: { colorId: string; colorName: string; colorHex: string }[]) => void;
  existingVariants?: VariantState[];
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

  // Create color form state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createHex, setCreateHex] = useState("#9CA3AF");
  const [createMode, setCreateMode] = useState<"hex" | "pattern">("hex");
  const [, setCreatePatternFile] = useState<File | null>(null);
  const [createPatternPreview, setCreatePatternPreview] = useState<string | null>(null);
  const [createPatternPath, setCreatePatternPath] = useState<string | null>(null);
  const [createSaving, setCreateSaving] = useState(false);
  const [createUploading, setCreateUploading] = useState(false);
  const [createError, setCreateError] = useState("");

  const openModal = useCallback(() => {
    setDraft(selected);
    setSearch("");
    setShowCreate(false);
    setCreateName("");
    setCreateHex("#9CA3AF");
    setCreateMode("hex");
    setCreatePatternFile(null);
    setCreatePatternPreview(null);
    setCreatePatternPath(null);
    setCreateError("");
    setOpen(true);
  }, [selected]);

  const confirm = useCallback(() => {
    onChange(draft);
    setOpen(false);
  }, [draft, onChange]);

  const cancel = useCallback(() => {
    setOpen(false);
  }, []);

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
        // Add saleType to existing entry
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
  const matchingCombo = existingCombinations.find((c) => c.key === draftGroupKey);

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

  // ── Create color helpers ──
  async function handleCreatePatternUpload(file: File) {
    const validTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!validTypes.includes(file.type)) { setCreateError("Format non supporté (PNG, JPG, WebP)."); return; }
    if (file.size > 512 * 1024) { setCreateError("Image trop lourde (max 500 Ko)."); return; }
    setCreateUploading(true);
    setCreateError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/colors/upload-pattern", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.path) {
        setCreatePatternPath(data.path);
        setCreatePatternPreview(URL.createObjectURL(file));
        setCreatePatternFile(file);
      } else {
        setCreateError(data.error || "Erreur upload motif.");
      }
    } catch {
      setCreateError("Erreur réseau upload motif.");
    } finally {
      setCreateUploading(false);
    }
  }

  async function handleCreateColorSave() {
    if (!createName.trim() || !onCreateColor) return;
    setCreateSaving(true);
    setCreateError("");
    try {
      const hex = createMode === "hex" ? createHex : null;
      const pattern = createMode === "pattern" ? createPatternPath : null;
      const created = await onCreateColor(createName.trim(), hex, pattern);
      // Auto-select the new color
      setDraft((prev) => [...prev, { colorId: created.id, colorName: created.name, colorHex: created.hex ?? "#9CA3AF" }]);
      // Reset form
      setShowCreate(false);
      setCreateName("");
      setCreateHex("#9CA3AF");
      setCreateMode("hex");
      setCreatePatternFile(null);
      setCreatePatternPreview(null);
      setCreatePatternPath(null);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Erreur création couleur.");
    } finally {
      setCreateSaving(false);
    }
  }

  // Build display for the trigger button
  const displayName = selected.map((s) => s.colorName).join(" / ");
  const selectedSegments = selected.map((s) => {
    const opt = options.find((o) => o.id === s.colorId);
    return { hex: s.colorHex, patternImage: opt?.patternImage ?? null };
  });

  return (
    <div style={{ minWidth: 180 }}>
      <button
        type="button"
        onClick={openModal}
        className="w-full flex items-center gap-1.5 bg-white border border-[#E5E5E5] px-2.5 py-2 text-xs font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] hover:border-[#9CA3AF] transition-colors text-left min-h-[34px]"
      >
        {selected.length === 0 ? (
          <span className="text-[#9CA3AF] flex-1 italic">— Sans couleur</span>
        ) : (
          <>
            {selectedSegments.length === 1 ? (
              <ColorSwatch hex={selectedSegments[0].hex} patternImage={selectedSegments[0].patternImage} size={16} rounded="full" />
            ) : (
              <ColorSwatch hex={selectedSegments[0]?.hex} patternImage={selectedSegments[0]?.patternImage} subColors={selectedSegments.slice(1)} size={16} rounded="full" />
            )}
            <span className="flex-1 truncate">{displayName}</span>
          </>
        )}
        <svg className="w-3 h-3 text-[#9CA3AF] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Modal */}
      {open && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6" onClick={cancel}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          {/* Panel — wide two-column layout */}
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col"
            style={{ maxHeight: "min(92vh, 700px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5] shrink-0">
              <div>
                <h3 className="text-base font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">
                  Sélectionner les couleurs
                </h3>
                <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
                  La 1re couleur sélectionnée sera la principale. Glissez pour réordonner.
                </p>
              </div>
              <button type="button" onClick={cancel} className="p-2 hover:bg-[#F7F7F8] rounded-xl transition-colors" aria-label="Fermer">
                <svg className="w-5 h-5 text-[#6B6B6B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Two-column body */}
            <div className="flex flex-1 min-h-0">

              {/* ── LEFT COLUMN: Catalogue couleurs ── */}
              <div className="flex-1 flex flex-col border-r border-[#E5E5E5] min-w-0">
                {/* Search */}
                <div className="px-5 py-3 border-b border-[#E5E5E5] shrink-0">
                  <div className="flex items-center gap-2.5 bg-[#F7F7F8] border border-[#E5E5E5] px-3.5 py-2.5 rounded-xl">
                    <svg className="w-4.5 h-4.5 text-[#9CA3AF] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                    </svg>
                    <input
                      ref={searchRef}
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Rechercher une couleur..."
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

                {/* Color list */}
                <div className="flex-1 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <div className="px-5 py-12 text-center text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">Aucun résultat</div>
                  ) : filtered.map((opt) => {
                    const isChecked = draftIds.has(opt.id);
                    const position = draft.findIndex((s) => s.colorId === opt.id);
                    return (
                      <button key={opt.id} type="button"
                        onClick={() => toggle(opt)}
                        className={`w-full flex items-center gap-3.5 px-5 py-3 text-left hover:bg-[#F7F7F8] transition-colors border-b border-[#F0F0F0] last:border-b-0 ${isChecked ? "bg-[#F0FDF4]" : ""}`}
                      >
                        <input type="checkbox" checked={isChecked} readOnly className="accent-[#22C55E] w-4 h-4 pointer-events-none shrink-0" />
                        <ColorSwatch hex={opt.hex} patternImage={opt.patternImage} size={24} rounded="full" />
                        <span className="flex-1 font-[family-name:var(--font-roboto)] text-[#1A1A1A] text-sm truncate">{opt.name}</span>
                        {isChecked && (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${position === 0 ? "bg-[#1A1A1A] text-white" : "bg-[#E5E5E5] text-[#6B6B6B]"}`}>
                            {position === 0 ? "1re" : `+${position + 1}`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Create new color */}
                {onCreateColor && (
                  <div className="border-t border-[#E5E5E5] px-5 py-3 bg-[#FAFAFA] shrink-0">
                    {!showCreate ? (
                      <button
                        type="button"
                        onClick={() => setShowCreate(true)}
                        className="text-sm text-[#1A1A1A] font-medium hover:underline flex items-center gap-2 font-[family-name:var(--font-roboto)]"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Créer une couleur
                      </button>
                    ) : (
                      <div className="space-y-2.5">
                        <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide font-[family-name:var(--font-roboto)]">Nouvelle couleur</p>
                        <input
                          className="field-input w-full text-sm"
                          placeholder="Nom de la couleur"
                          value={createName}
                          onChange={(e) => setCreateName(e.target.value)}
                          autoFocus
                        />
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => setCreateMode("hex")}
                            className={`flex-1 text-xs px-3 py-1.5 rounded-lg border transition-colors ${createMode === "hex" ? "bg-[#1A1A1A] text-white border-[#1A1A1A]" : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#9CA3AF]"}`}
                          >Couleur unie</button>
                          <button type="button" onClick={() => setCreateMode("pattern")}
                            className={`flex-1 text-xs px-3 py-1.5 rounded-lg border transition-colors ${createMode === "pattern" ? "bg-[#1A1A1A] text-white border-[#1A1A1A]" : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#9CA3AF]"}`}
                          >Motif / Image</button>
                        </div>
                        {createMode === "hex" ? (
                          <div className="flex items-center gap-2">
                            <input type="color" value={createHex} onChange={(e) => setCreateHex(e.target.value)} className="w-9 h-9 rounded-lg cursor-pointer border border-[#E5E5E5]" />
                            <input className="field-input w-28 font-mono text-sm" value={createHex} onChange={(e) => setCreateHex(e.target.value)} />
                          </div>
                        ) : (
                          <div>
                            {createPatternPreview ? (
                              <div className="flex items-center gap-3">
                                <div className="w-14 h-14 rounded-lg border border-[#E5E5E5]" style={{ backgroundImage: `url(${createPatternPreview})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                                <button type="button" onClick={() => { setCreatePatternFile(null); setCreatePatternPreview(null); setCreatePatternPath(null); }} className="text-xs text-red-500 hover:underline font-[family-name:var(--font-roboto)]">Supprimer</button>
                              </div>
                            ) : (
                              <label className={`flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-[#E5E5E5] rounded-lg cursor-pointer hover:border-[#9CA3AF] transition-colors ${createUploading ? "opacity-50 pointer-events-none" : ""}`}>
                                <svg className="w-4 h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                <span className="text-xs text-[#9CA3AF]">{createUploading ? "Upload..." : "PNG, JPG, WebP — max 500 Ko"}</span>
                                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleCreatePatternUpload(file); e.target.value = ""; }} />
                              </label>
                            )}
                          </div>
                        )}
                        {createError && <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)]">{createError}</p>}
                        <div className="flex gap-2">
                          <button type="button" onClick={handleCreateColorSave} disabled={createSaving || createUploading || !createName.trim() || (createMode === "pattern" && !createPatternPath)} className="btn-primary text-xs disabled:opacity-50">{createSaving ? "Création..." : "Créer"}</button>
                          <button type="button" onClick={() => { setShowCreate(false); setCreateName(""); setCreatePatternFile(null); setCreatePatternPreview(null); setCreatePatternPath(null); setCreateError(""); }} className="btn-secondary text-xs">Annuler</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── RIGHT COLUMN: Sélection + combinaisons ── */}
              <div className="w-[320px] shrink-0 flex flex-col bg-[#FAFAFA]">

                {/* Selected colors — drag & drop */}
                <div className="px-5 pt-4 pb-3 shrink-0">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[#6B6B6B] font-[family-name:var(--font-roboto)] uppercase tracking-wide">
                      Sélection {draft.length > 0 && <span className="text-[#1A1A1A]">({draft.length})</span>}
                    </span>
                    {draft.length > 1 && (
                      <span className="text-[11px] text-[#9CA3AF] font-[family-name:var(--font-roboto)] italic">
                        Glissez pour réordonner
                      </span>
                    )}
                  </div>

                  {draft.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <div className="w-12 h-12 rounded-full bg-[#F0F0F0] flex items-center justify-center mb-3">
                        <svg className="w-5 h-5 text-[#C0C0C0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                        </svg>
                      </div>
                      <p className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">Aucune couleur</p>
                      <p className="text-xs text-[#C0C0C0] font-[family-name:var(--font-roboto)] mt-0.5">Cliquez sur une couleur à gauche</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                      {draft.map((s, i) => {
                        const opt = options.find((o) => o.id === s.colorId);
                        const isDragging = dragIdx === i;
                        const isDragOver = dragOverIdx === i && dragIdx !== i;
                        return (
                          <div
                            key={s.colorId}
                            draggable
                            onDragStart={() => handleDragStart(i)}
                            onDragOver={(e) => handleDragOver(e, i)}
                            onDragEnd={handleDragEnd}
                            className={`flex items-center gap-2.5 bg-white border rounded-xl px-3 py-2.5 cursor-grab active:cursor-grabbing transition-all
                              ${isDragging ? "opacity-40 scale-95" : ""}
                              ${isDragOver ? "border-[#1A1A1A] shadow-sm" : "border-[#E5E5E5]"}
                            `}
                          >
                            <svg className="w-3.5 h-3.5 text-[#C0C0C0] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                              <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                              <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                            </svg>
                            <span className={`text-[11px] font-bold w-5 h-5 flex items-center justify-center rounded-full shrink-0
                              ${i === 0 ? "bg-[#1A1A1A] text-white" : "bg-[#E5E5E5] text-[#6B6B6B]"}
                            `}>{i + 1}</span>
                            <ColorSwatch hex={s.colorHex} patternImage={opt?.patternImage ?? null} size={20} rounded="full" />
                            <span className="flex-1 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] truncate">{s.colorName}</span>
                            {i === 0 && (
                              <span className="text-[10px] font-semibold bg-[#22C55E] text-white px-1.5 py-0.5 rounded shrink-0">1re</span>
                            )}
                            <button type="button" onClick={(e) => { e.stopPropagation(); removeFromDraft(s.colorId); }}
                              className="p-1 hover:bg-red-50 rounded-lg transition-colors shrink-0" aria-label={`Retirer ${s.colorName}`}>
                              <svg className="w-3.5 h-3.5 text-[#C0C0C0] hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Matching variant message */}
                {matchingCombo && draft.length > 0 && (
                  <div className="mx-5 mb-3 px-3 py-2 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg flex items-center gap-2 shrink-0">
                    <svg className="w-4 h-4 text-[#22C55E] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs text-[#166534] font-[family-name:var(--font-roboto)]">
                      Variante existante ({matchingCombo.saleTypes.join(" + ")})
                    </span>
                  </div>
                )}

                {/* Existing combinations */}
                {existingCombinations.length > 0 && (
                  <div className="px-5 pb-4 shrink-0 border-t border-[#E5E5E5] pt-3 mt-auto">
                    <span className="text-xs font-semibold text-[#6B6B6B] font-[family-name:var(--font-roboto)] uppercase tracking-wide">
                      Raccourcis
                    </span>
                    <p className="text-[11px] text-[#9CA3AF] font-[family-name:var(--font-roboto)] mb-2">
                      Reprendre une combinaison existante
                    </p>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      {existingCombinations.map((combo) => {
                        const isActive = combo.key === draftGroupKey;
                        return (
                          <button
                            key={combo.key}
                            type="button"
                            onClick={() => selectCombination(combo)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-[family-name:var(--font-roboto)] rounded-lg border transition-colors
                              ${isActive
                                ? "bg-[#F0FDF4] border-[#22C55E] text-[#166534]"
                                : "bg-white border-[#E5E5E5] text-[#1A1A1A] hover:border-[#9CA3AF] hover:bg-white"
                              }`}
                          >
                            {combo.colors.length === 1 ? (
                              <ColorSwatch hex={combo.colors[0].colorHex} patternImage={options.find((o) => o.id === combo.colors[0].colorId)?.patternImage ?? null} size={16} rounded="full" />
                            ) : (
                              <ColorSwatch
                                hex={combo.colors[0].colorHex}
                                patternImage={options.find((o) => o.id === combo.colors[0].colorId)?.patternImage ?? null}
                                subColors={combo.colors.slice(1).map((c) => ({ hex: c.colorHex, patternImage: options.find((o) => o.id === c.colorId)?.patternImage ?? null }))}
                                size={16}
                                rounded="full"
                              />
                            )}
                            <span className="truncate max-w-[140px]">{combo.colors.map((c) => c.colorName).join(" / ")}</span>
                            <span className="text-[10px] text-[#9CA3AF]">({combo.saleTypes.join("+")})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#E5E5E5] bg-white rounded-b-2xl shrink-0">
              <span className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                {draft.length === 0 ? "Aucune couleur sélectionnée" : `${draft.length} couleur${draft.length > 1 ? "s" : ""} sélectionnée${draft.length > 1 ? "s" : ""}`}
              </span>
              <div className="flex items-center gap-2.5">
                <button type="button" onClick={cancel}
                  className="px-5 py-2 text-sm font-medium font-[family-name:var(--font-roboto)] text-[#6B6B6B] bg-white border border-[#E5E5E5] rounded-xl hover:bg-[#F7F7F8] transition-colors"
                >
                  Annuler
                </button>
                <button type="button" onClick={confirm}
                  className="px-5 py-2 text-sm font-medium font-[family-name:var(--font-roboto)] text-white bg-[#1A1A1A] rounded-xl hover:bg-[#333] transition-colors"
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
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
  const colorImagesRef = useRef(colorImages);
  colorImagesRef.current = colorImages;

  // Find a representative variant for a given groupKey
  function findVariantByGroupKey(groupKey: string): VariantState | undefined {
    return variants.find((v) => variantGroupKeyFromState(v) === groupKey);
  }

  // Build color segments per group key for camembert display (supports patterns)
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

    // If there's already an image at this position, replace it
    const existingIdx = state.orders.indexOf(position);

    const blob = URL.createObjectURL(file);
    setUploadingSlots((prev) => ({ ...prev, [groupKey]: position }));

    if (existingIdx !== -1) {
      // Replace: update preview immediately
      onChange(colorImagesRef.current.map((c) => {
        if (c.groupKey !== groupKey) return c;
        const newPreviews = [...c.imagePreviews];
        newPreviews[existingIdx] = blob;
        return { ...c, imagePreviews: newPreviews, uploading: true };
      }));
    } else {
      // Add new
      onChange(colorImagesRef.current.map((c) => c.groupKey === groupKey
        ? { ...c, imagePreviews: [...c.imagePreviews, blob], orders: [...c.orders, position], uploading: true }
        : c
      ));
    }

    // Upload
    let path = "";
    const fd = new FormData(); fd.append("image", file);
    try {
      const res = await fetch("/api/admin/products/images", { method: "POST", body: fd });
      const json = await res.json();
      if (res.ok) path = json.path;
    } catch { console.error("Erreur upload"); }

    setUploadingSlots((prev) => ({ ...prev, [groupKey]: null }));

    if (!path) {
      // Upload failed — revert
      onChange(colorImagesRef.current.map((c) => {
        if (c.groupKey !== groupKey) return c;
        if (existingIdx !== -1) {
          // Revert replaced preview
          return { ...c, uploading: false };
        }
        // Remove the added preview
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
        // Replace uploaded path
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
      // Blob preview (freshly uploaded, not yet saved) — rotate client-side via canvas
      if (preview?.startsWith("blob:")) {
        const rotatedBlob = await rotateImageClientSide(preview);
        const newBlobUrl = URL.createObjectURL(rotatedBlob);
        // Re-upload rotated file
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
        // Server path (from DB or after upload) — rotate server-side with sharp
        const pathToRotate = uploadedPath || preview;
        // Strip any existing cache buster query param
        const cleanPath = pathToRotate.split("?")[0];
        const res = await fetch("/api/admin/products/images/rotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imagePath: cleanPath }),
        });
        const json = await res.json();
        if (res.ok && json.cacheBuster) {
          // Update preview URL with cache buster to force browser re-render
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
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
          {/* Couleur principale */}
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
// Main component
// ─────────────────────────────────────────────
export default function ColorVariantManager({
  variants,
  colorImages,
  availableColors,
  availableSizes,
  onChange,
  onChangeImages,
  onQuickCreateColor,
}: Props) {
  const { confirm: confirmDialog } = useConfirm();
  const [showImageModal, setShowImageModal] = useState(false);
  const [galleryState, setGalleryState] = useState<{ images: string[]; colorName: string; colorHex: string } | null>(null);
  const [quickCreateErr, setQuickCreateErr] = useState("");
  const [quickSaving, setQuickSaving]       = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [newColorName, setNewColorName]     = useState("");
  const [newColorHex, setNewColorHex]       = useState("#9CA3AF");
  const [newColorPattern, setNewColorPattern] = useState<string | null>(null);
  const [patternUploading, setPatternUploading] = useState(false);
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());

  // ── Bulk edit state ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEdit, setBulkEdit]       = useState<BulkEditState>(defaultBulkEdit());

  // ── Quick-fill state (PACK size columns) ───────────────────────────────────
  const [bulkFillValues, setBulkFillValues] = useState<Record<string, { qty: string; price: string }>>({});
  const selectAllRef                  = useRef<HTMLInputElement>(null);

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

  // ── Quick create color ─────────────────────────────────────────────────────
  async function handlePatternUpload(file: File) {
    setPatternUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/admin/colors/pattern", { method: "POST", body: fd });
      const json = await res.json();
      if (res.ok) setNewColorPattern(json.path);
      else setQuickCreateErr(json.error || "Erreur upload motif");
    } catch { setQuickCreateErr("Erreur upload motif"); }
    finally { setPatternUploading(false); }
  }

  async function handleQuickSave() {
    if (!newColorName.trim() || !onQuickCreateColor) return;
    setQuickSaving(true);
    try {
      await onQuickCreateColor(newColorName.trim(), newColorHex, newColorPattern);
      setNewColorName(""); setNewColorHex("#9CA3AF"); setNewColorPattern(null);
      setShowQuickCreate(false); setQuickCreateErr("");
    } catch (e: unknown) { setQuickCreateErr(e instanceof Error ? e.message : "Erreur"); }
    finally { setQuickSaving(false); }
  }

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
    setExpandedVariants((prev) => new Set(prev).add(newV.tempId));
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
      onChange(variants.map((v) => tempIds.has(v.tempId) ? { ...v, colorId: "", colorName: "", colorHex: "#9CA3AF", subColors: [] } : v));
      return;
    }
    const [main, ...rest] = colors;
    const patch = {
      colorId: main.colorId, colorName: main.colorName, colorHex: main.colorHex,
      subColors: rest.map((c) => ({ colorId: c.colorId, colorName: c.colorName, colorHex: c.colorHex })),
    };
    onChange(variants.map((v) => tempIds.has(v.tempId) ? { ...v, ...patch } : v));
  }

  // ── Size management ───────────────────────────────────────────────────────
  function addSizeEntry(tempId: string) {
    const v = variants.find((x) => x.tempId === tempId);
    if (!v) return;
    // UNIT: max 1 size
    if (v.saleType === "UNIT" && v.sizeEntries.length >= 1) return;
    const usedIds = new Set(v.sizeEntries.map((s) => s.sizeId));
    const available = availableSizes.filter((s) => !usedIds.has(s.id));
    if (available.length === 0) return;
    const next = available[0];
    updateVariant(tempId, {
      sizeEntries: [...v.sizeEntries, { tempId: uid(), sizeId: next.id, sizeName: next.name, quantity: "1" }],
    });
  }

  function updateSizeEntry(variantTempId: string, sizeTempId: string, patch: Partial<SizeEntryState>) {
    const v = variants.find((x) => x.tempId === variantTempId);
    if (!v) return;
    updateVariant(variantTempId, {
      sizeEntries: v.sizeEntries.map((s) => s.tempId === sizeTempId ? { ...s, ...patch } : s),
    });
  }

  function removeSizeEntry(variantTempId: string, sizeTempId: string) {
    const v = variants.find((x) => x.tempId === variantTempId);
    if (!v) return;
    updateVariant(variantTempId, {
      sizeEntries: v.sizeEntries.filter((s) => s.tempId !== sizeTempId),
    });
  }

  function bulkFillQty(variantTempId: string, qty: string) {
    const v = variants.find((x) => x.tempId === variantTempId);
    if (!v || !qty.trim()) return;
    updateVariant(variantTempId, { sizeEntries: v.sizeEntries.map((s) => ({ ...s, quantity: qty })) });
  }

  function bulkFillPrice(variantTempId: string, price: string) {
    const v = variants.find((x) => x.tempId === variantTempId);
    if (!v || !price.trim()) return;
    updateVariant(variantTempId, { sizeEntries: v.sizeEntries.map((s) => ({ ...s, pricePerUnit: price })) });
  }

  // ── Pack color line management ────────────────────────────────────────────
  function addPackColorLine(tempId: string) {
    const v = variants.find((x) => x.tempId === tempId);
    if (!v) return;
    updateVariant(tempId, {
      packColorLines: [...v.packColorLines, { tempId: uid(), colors: [] }],
    });
  }

  function updatePackColorLine(variantTempId: string, lineTempId: string, colors: { colorId: string; colorName: string; colorHex: string }[]) {
    const v = variants.find((x) => x.tempId === variantTempId);
    if (!v) return;
    updateVariant(variantTempId, {
      packColorLines: v.packColorLines.map((l) => l.tempId === lineTempId ? { ...l, colors } : l),
    });
  }

  function removePackColorLine(variantTempId: string, lineTempId: string) {
    const v = variants.find((x) => x.tempId === variantTempId);
    if (!v) return;
    updateVariant(variantTempId, {
      packColorLines: v.packColorLines.filter((l) => l.tempId !== lineTempId),
    });
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

  // ── Sort UNIT variants so same-color compositions appear adjacent ──────────
  // Stable sort: variants with same groupKey are grouped together, preserving
  // their relative creation order. PACK variants are kept at the end.
  const { sortedUnitVariants, packVariants } = useMemo(() => {
    const firstSeenByKey = new Map<string, number>();
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (v.saleType !== "UNIT") continue;
      const gk = variantGroupKeyFromState(v);
      if (!firstSeenByKey.has(gk)) firstSeenByKey.set(gk, i);
    }
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
    return { sortedUnitVariants: unitVars, packVariants: packs };
  }, [variants]);

  function toggleExpanded(tempId: string) {
    setExpandedVariants((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId); else next.add(tempId);
      return next;
    });
  }

  // ── Render helper: size entries section ────────────────────────────────────
  function renderSizeEntries(v: VariantState) {
    const isUnit = v.saleType === "UNIT";
    const usedSizeIds = new Set(v.sizeEntries.map((s) => s.sizeId));
    const remainingSizes = availableSizes.filter((s) => !usedSizeIds.has(s.id));
    const canAddMore = isUnit ? v.sizeEntries.length === 0 && remainingSizes.length > 0 : remainingSizes.length > 0;

    return (
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">
          {isUnit ? "Taille" : "Tailles & quantités"}
        </p>
        {v.sizeEntries.length === 0 ? (
          <p className="text-xs text-[#9CA3AF] italic font-[family-name:var(--font-roboto)]">Aucune taille sélectionnée</p>
        ) : isUnit ? (
          // UNIT: single size, no quantity input
          <div>
            {v.sizeEntries.slice(0, 1).map((se) => {
              const sizeOptions = [
                { value: se.sizeId, label: se.sizeName },
                ...remainingSizes.map((s) => ({ value: s.id, label: s.name })),
              ];
              return (
                <div key={se.tempId} className="flex items-center gap-2">
                  <CustomSelect
                    options={sizeOptions}
                    value={se.sizeId}
                    onChange={(val) => {
                      const sz = availableSizes.find((s) => s.id === val);
                      if (sz) updateSizeEntry(v.tempId, se.tempId, { sizeId: sz.id, sizeName: sz.name });
                    }}
                    size="sm"
                    className="flex-1"
                  />
                  <button type="button" onClick={() => removeSizeEntry(v.tempId, se.tempId)}
                    className="p-1 text-[#9CA3AF] hover:text-[#EF4444] transition-colors" title="Retirer">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          // PACK: size + quantity + pricePerUnit
          <div className="space-y-1.5">
            {/* Column headers — Qté & Prix/u are quick-fill inputs: type a value + Enter to fill the whole column */}
            <div className="grid grid-cols-[1fr_60px_72px_28px] gap-1.5 items-center">
              <span className="text-[9px] text-[#9CA3AF] font-[family-name:var(--font-roboto)] uppercase tracking-wide">Taille</span>
              <input
                type="number" min="1" step="1"
                value={bulkFillValues[v.tempId]?.qty ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setBulkFillValues((prev) => ({ ...prev, [v.tempId]: { qty: val, price: prev[v.tempId]?.price ?? "" } }));
                  bulkFillQty(v.tempId, val);
                }}
                placeholder="Qté ↓"
                title="Rempli automatiquement toutes les lignes"
                className="border border-dashed border-[#D1D5DB] bg-[#F7F7F8] px-1.5 py-0.5 text-[10px] text-right rounded focus:outline-none focus:border-[#9CA3AF] w-full font-[family-name:var(--font-roboto)]"
              />
              <input
                type="number" min="0" step="0.01"
                value={bulkFillValues[v.tempId]?.price ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setBulkFillValues((prev) => ({ ...prev, [v.tempId]: { qty: prev[v.tempId]?.qty ?? "", price: val } }));
                  bulkFillPrice(v.tempId, val);
                }}
                placeholder="Prix ↓"
                title="Rempli automatiquement toutes les lignes"
                className="border border-dashed border-[#D1D5DB] bg-[#F7F7F8] px-1.5 py-0.5 text-[10px] text-right rounded focus:outline-none focus:border-[#9CA3AF] w-full font-[family-name:var(--font-roboto)]"
              />
              <span />
            </div>
            {v.sizeEntries.map((se) => {
              const sizeOptions = [
                { value: se.sizeId, label: se.sizeName },
                ...remainingSizes.map((s) => ({ value: s.id, label: s.name })),
              ];
              return (
                <div key={se.tempId} className="grid grid-cols-[1fr_60px_72px_28px] gap-1.5 items-center">
                  <CustomSelect
                    options={sizeOptions}
                    value={se.sizeId}
                    onChange={(val) => {
                      const sz = availableSizes.find((s) => s.id === val);
                      if (sz) updateSizeEntry(v.tempId, se.tempId, { sizeId: sz.id, sizeName: sz.name });
                    }}
                    size="sm"
                  />
                  <input
                    type="number" min="1" step="1" value={se.quantity} placeholder="1"
                    onChange={(e) => updateSizeEntry(v.tempId, se.tempId, { quantity: e.target.value })}
                    className="border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)] w-full"
                  />
                  <input
                    type="number" min="0" step="0.01" value={se.pricePerUnit ?? ""} placeholder="0.00"
                    onChange={(e) => updateSizeEntry(v.tempId, se.tempId, { pricePerUnit: e.target.value })}
                    className="border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)] w-full"
                  />
                  <button type="button" onClick={() => removeSizeEntry(v.tempId, se.tempId)}
                    className="p-1 text-[#9CA3AF] hover:text-[#EF4444] transition-colors flex items-center justify-center" title="Retirer">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {canAddMore && (
          <button type="button" onClick={() => addSizeEntry(v.tempId)}
            className="text-xs text-[#6B6B6B] hover:text-[#1A1A1A] font-[family-name:var(--font-roboto)] flex items-center gap-1 transition-colors">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {isUnit ? "Ajouter une taille" : "Ajouter une taille"}
          </button>
        )}
        {availableSizes.length === 0 && (
          <p className="text-xs text-amber-600 font-[family-name:var(--font-roboto)]">
            Aucune taille disponible. Créez des tailles dans Attributs &gt; Tailles et associez-les à la catégorie du produit.
          </p>
        )}
      </div>
    );
  }

  // ── Render helper: UNIT variant card (standalone, one card per variant) ────
  function renderUnitVariantRow(v: VariantState) {
    const isExpanded  = expandedVariants.has(v.tempId);
    const isSelected  = selectedIds.has(v.tempId);
    const isDuplicate = duplicateTempIds.has(v.tempId);
    const totalPrice = computeTotalPrice(v);
    const finalPrice = computeFinalPrice(v);
    const hasDiscount = finalPrice !== null && totalPrice !== null && finalPrice !== totalPrice;
    const sizeSummary = v.sizeEntries.length > 0
      ? v.sizeEntries.map((s) => `${s.sizeName}×${s.quantity}`).join(", ")
      : "—";
    const colorDisplayName = [v.colorName, ...v.subColors.map((sc) => sc.colorName)].filter(Boolean).join(", ") || "Sans couleur";

    return (
      <div key={v.tempId} className={`rounded-xl border-2 overflow-hidden bg-white ${isDuplicate ? "border-[#EF4444]" : isSelected ? "border-[#22C55E]" : "border-[#D5D5D5]"}`}>
        {/* Main row */}
        <div
          className={`flex flex-wrap items-center gap-2 px-4 py-3 cursor-pointer transition-colors ${
            isDuplicate ? "bg-[#FEF2F2]" : isSelected ? "bg-[#F0FDF4]" : "hover:bg-[#F7F7F8]"
          }`}
          onClick={() => toggleExpanded(v.tempId)}
        >
          <input type="checkbox" checked={isSelected}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const next = new Set(selectedIds);
              if (e.target.checked) next.add(v.tempId); else next.delete(v.tempId);
              setSelectedIds(next);
            }}
            className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5 shrink-0" />

          <span className="badge badge-info text-[10px]">Unité</span>

          {/* Color swatch + name */}
          <ColorSwatch
            hex={v.colorHex}
            patternImage={availableColors.find((c) => c.id === v.colorId)?.patternImage ?? null}
            subColors={v.subColors.length > 0
              ? [{ hex: v.colorHex, patternImage: null }, ...v.subColors.map((sc) => ({ hex: sc.colorHex, patternImage: null }))]
              : undefined}
            size={22} rounded="full" border
          />
          <span className="text-xs font-medium text-[#1A1A1A] font-[family-name:var(--font-poppins)] truncate max-w-[140px]" title={colorDisplayName}>
            {colorDisplayName}
          </span>

          {/* Size summary */}
          <span className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)] truncate max-w-[180px]" title={sizeSummary}>
            {sizeSummary}
          </span>

          {/* Price + stock */}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
              {v.unitPrice ? `${v.unitPrice}€` : "—"}
            </span>
            {finalPrice !== null && hasDiscount && (
              <span className="text-xs font-semibold text-emerald-600 font-[family-name:var(--font-poppins)]">
                {finalPrice.toFixed(2)}€
              </span>
            )}
            <span className="text-[10px] text-[#9CA3AF]">stock: {v.stock || "0"}</span>

            <svg className={`w-4 h-4 text-[#9CA3AF] transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>

            {variants.length > 1 && (
              <button type="button" onClick={(e) => { e.stopPropagation(); removeVariant(v.tempId); }}
                title="Supprimer" className="p-1 text-[#9CA3AF] hover:text-[#EF4444] transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div className="px-4 py-3 border-t border-[#F0F0F0] bg-[#FAFAFA] space-y-4" onClick={(e) => e.stopPropagation()}>
            {/* Type switcher */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)] mb-2">Type de vente</p>
              <div className="flex gap-2">
                <button type="button"
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-[#3B82F6] text-white font-[family-name:var(--font-roboto)]">
                  Unité
                </button>
                <button type="button"
                  onClick={() => updateVariant(v.tempId, {
                    saleType: "PACK",
                    colorId: "",
                    colorName: "",
                    colorHex: "#9CA3AF",
                    subColors: [],
                    packColorLines: [{ tempId: uid(), colors: [] }],
                  })}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md border border-[#D5D5D5] text-[#6B6B6B] hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-colors font-[family-name:var(--font-roboto)]">
                  Pack
                </button>
              </div>
            </div>

            {/* Color selector */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)] mb-2">Couleur</p>
              <MultiColorSelect
                selected={v.colorId ? [
                  { colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex },
                  ...v.subColors.map((sc) => ({ colorId: sc.colorId, colorName: sc.colorName, colorHex: sc.colorHex })),
                ] : []}
                options={availableColors}
                onChange={(colors) => handleMultiColorChange(new Set([v.tempId]), colors)}
                existingVariants={variants}
                onCreateColor={onQuickCreateColor}
              />
            </div>

            {/* Pricing row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Prix (€ HT)</label>
                <input type="number" min="0" step="0.01" value={v.unitPrice} placeholder="0.00"
                  onChange={(e) => updateVariant(v.tempId, { unitPrice: e.target.value })}
                  className="w-full mt-1 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Stock</label>
                <input type="number" min="0" step="1" value={v.stock} placeholder="0"
                  onChange={(e) => updateVariant(v.tempId, { stock: e.target.value })}
                  className="w-full mt-1 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Poids (kg)</label>
                <input type="number" min="0" step="0.001" value={v.weight} placeholder="0.008"
                  onChange={(e) => updateVariant(v.tempId, { weight: e.target.value })}
                  className="w-full mt-1 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Remise</label>
                <div className="flex gap-1 mt-1">
                  <CustomSelect value={v.discountType}
                    onChange={(val) => updateVariant(v.tempId, { discountType: val as "" | "PERCENT" | "AMOUNT", discountValue: "" })}
                    options={[{ value: "", label: "—" }, { value: "PERCENT", label: "%" }, { value: "AMOUNT", label: "€" }]}
                    size="sm" className="w-[65px]" />
                  {v.discountType && (
                    <input type="number" min="0" step="0.01" value={v.discountValue} placeholder="0"
                      onChange={(e) => updateVariant(v.tempId, { discountValue: e.target.value })}
                      className="w-16 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
                  )}
                </div>
              </div>
            </div>

            {/* Sizes */}
            {renderSizeEntries(v)}
          </div>
        )}
      </div>
    );
  }

  // ── Render helper: PACK variant card ──────────────────────────────────────
  function renderPackVariant(v: VariantState) {
    const isExpanded  = expandedVariants.has(v.tempId);
    const isSelected  = selectedIds.has(v.tempId);
    const isDuplicate = duplicateTempIds.has(v.tempId);
    const totalPrice = computeTotalPrice(v);
    const finalPrice = computeFinalPrice(v);
    const hasDiscount = finalPrice !== null && totalPrice !== null && finalPrice !== totalPrice;
    const colorLinesSummary = v.packColorLines.length > 0
      ? v.packColorLines.map((l) => l.colors.map((c) => c.colorName).join("+")).join(" | ")
      : "Aucune couleur";
    const sizeSummary = v.sizeEntries.length > 0
      ? v.sizeEntries.map((s) => `${s.sizeName}×${s.quantity}`).join(", ")
      : "—";
    // Detect duplicate pack color lines (same colors in same order)
    const packColorLineKeys = v.packColorLines.map((l) => l.colors.map((c) => c.colorId).join(","));
    const duplicateLineKeys = new Set<string>();
    const seenLineKeys = new Set<string>();
    for (const k of packColorLineKeys) {
      if (k && seenLineKeys.has(k)) duplicateLineKeys.add(k);
      if (k) seenLineKeys.add(k);
    }

    return (
      <div key={v.tempId} className={`rounded-xl border-2 overflow-hidden bg-white ${isDuplicate ? "border-[#EF4444]" : isSelected ? "border-[#22C55E]" : "border-[#D5D5D5]"}`}>
        {/* Header */}
        <div
          className={`flex flex-wrap items-center gap-2 px-4 py-3 cursor-pointer transition-colors ${
            isDuplicate ? "bg-[#FEF2F2]" : isSelected ? "bg-[#F0FDF4]" : "bg-[#F7F7F8] hover:bg-[#EFEFEF]"
          }`}
          onClick={() => toggleExpanded(v.tempId)}
        >
          <input type="checkbox" checked={isSelected}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const next = new Set(selectedIds);
              if (e.target.checked) next.add(v.tempId); else next.delete(v.tempId);
              setSelectedIds(next);
            }}
            className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5 shrink-0" />

          <span className="badge badge-purple text-[10px]">Pack ×{v.packQuantity || "?"}</span>

          {/* Color lines summary */}
          <span className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)] truncate max-w-[300px]" title={colorLinesSummary}>
            {colorLinesSummary}
          </span>

          <span className="text-[10px] text-[#9CA3AF] font-[family-name:var(--font-roboto)]" title={sizeSummary}>
            [{sizeSummary}]
          </span>

          <div className="ml-auto flex items-center gap-3">
            {totalPrice !== null ? (
              <div className="text-right">
                {hasDiscount && finalPrice !== null ? (
                  <>
                    <span className="text-xs text-[#9CA3AF] line-through font-[family-name:var(--font-roboto)]">{totalPrice.toFixed(2)}€</span>
                    <span className="ml-1.5 text-xs font-semibold text-emerald-600 font-[family-name:var(--font-poppins)]">{finalPrice.toFixed(2)}€</span>
                  </>
                ) : (
                  <span className="text-xs font-semibold text-[#1A1A1A] font-[family-name:var(--font-poppins)]">{totalPrice.toFixed(2)}€</span>
                )}
              </div>
            ) : (
              <span className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">—</span>
            )}
            <span className="text-[10px] text-[#9CA3AF]">stock: {v.stock || "0"}</span>

            <svg className={`w-4 h-4 text-[#9CA3AF] transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>

            {variants.length > 1 && (
              <button type="button" onClick={(e) => { e.stopPropagation(); removeVariant(v.tempId); }}
                title="Supprimer" className="p-1 text-[#9CA3AF] hover:text-[#EF4444] transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Expanded body */}
        {isExpanded && (
          <div className="px-4 py-4 border-t border-[#E5E5E5] space-y-4" onClick={(e) => e.stopPropagation()}>
            {/* Type switcher */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)] mb-2">Type de vente</p>
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => updateVariant(v.tempId, {
                    saleType: "UNIT",
                    packColorLines: [],
                    packQuantity: "",
                  })}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md border border-[#D5D5D5] text-[#6B6B6B] hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-colors font-[family-name:var(--font-roboto)]">
                  Unité
                </button>
                <button type="button"
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-[#7C3AED] text-white font-[family-name:var(--font-roboto)]">
                  Pack
                </button>
              </div>
            </div>

            {/* Color lines */}
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">
                Lignes de couleur
              </p>
              {v.packColorLines.map((line, lineIdx) => {
                const lineKey = line.colors.map((c) => c.colorId).join(",");
                const isDupLine = lineKey !== "" && duplicateLineKeys.has(lineKey);
                return (
                  <div key={line.tempId} className={`flex items-center gap-2 p-2 rounded-lg border ${isDupLine ? "border-[#EF4444] bg-[#FEF2F2]" : "border-[#E5E5E5] bg-[#FAFAFA]"}`}>
                    <span className="text-[10px] text-[#9CA3AF] font-[family-name:var(--font-roboto)] shrink-0 w-5">
                      {lineIdx + 1}.
                    </span>
                    <div className="flex-1">
                      <MultiColorSelect
                        selected={line.colors}
                        options={availableColors}
                        onChange={(colors) => updatePackColorLine(v.tempId, line.tempId, colors)}
                        onCreateColor={onQuickCreateColor}
                      />
                    </div>
                    {isDupLine && (
                      <span className="text-[10px] text-[#EF4444] font-semibold font-[family-name:var(--font-roboto)] shrink-0">Doublon</span>
                    )}
                    {v.packColorLines.length > 1 && (
                      <button type="button" onClick={() => removePackColorLine(v.tempId, line.tempId)}
                        className="p-1 text-[#9CA3AF] hover:text-[#EF4444] transition-colors" title="Retirer">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
              {duplicateLineKeys.size > 0 && (
                <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)] flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Doublon : deux lignes ont la même composition de couleurs dans le même ordre.
                </p>
              )}
              <button type="button" onClick={() => addPackColorLine(v.tempId)}
                className="text-xs text-[#6B6B6B] hover:text-[#1A1A1A] font-[family-name:var(--font-roboto)] flex items-center gap-1 transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Ajouter une ligne de couleur
              </button>
            </div>

            {/* Shared sizes with per-size pricing */}
            {renderSizeEntries(v)}

            {/* Computed total display */}
            {totalPrice !== null && (
              <div className="flex items-center gap-2 px-3 py-2 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg">
                <svg className="w-3.5 h-3.5 text-[#22C55E] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-[family-name:var(--font-roboto)] text-[#166534]">
                  Prix total paquet calculé : <strong>{totalPrice.toFixed(2)} €</strong>
                  {v.packQuantity && <span className="text-[11px] text-[#22C55E] ml-1">(× {v.packQuantity} paquets = {totalPrice.toFixed(2)} € / paquet)</span>}
                </span>
              </div>
            )}

            {/* Pricing: packQuantity, stock, weight, discount — no global price input */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Qté/paquet</label>
                <input type="number" min="1" step="1" value={v.packQuantity} placeholder="1"
                  onChange={(e) => updateVariant(v.tempId, { packQuantity: e.target.value })}
                  className="w-full mt-1 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Stock</label>
                <input type="number" min="0" step="1" value={v.stock} placeholder="0"
                  onChange={(e) => updateVariant(v.tempId, { stock: e.target.value })}
                  className="w-full mt-1 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Poids (kg)</label>
                <input type="number" min="0" step="0.001" value={v.weight} placeholder="0.008"
                  onChange={(e) => updateVariant(v.tempId, { weight: e.target.value })}
                  className="w-full mt-1 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Remise</label>
                <div className="flex gap-1 mt-1">
                  <CustomSelect value={v.discountType}
                    onChange={(val) => updateVariant(v.tempId, { discountType: val as "" | "PERCENT" | "AMOUNT", discountValue: "" })}
                    options={[{ value: "", label: "—" }, { value: "PERCENT", label: "%" }, { value: "AMOUNT", label: "€" }]}
                    size="sm" className="w-[65px]" />
                  {v.discountType && (
                    <input type="number" min="0" step="0.01" value={v.discountValue} placeholder="0"
                      onChange={(e) => updateVariant(v.tempId, { discountValue: e.target.value })}
                      className="w-16 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]" />
                  )}
                </div>
              </div>
            </div>
          </div>
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
        <div className="space-y-4">
          {/* ── Bulk edit bar ── */}
          <div className={`rounded-xl p-4 space-y-3 border-2 transition-colors ${
            showBulkRow ? "bg-[#F0FDF4] border-[#22C55E]" : "bg-[#F7F7F8] border-[#E5E5E5]"
          }`}>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox"
                  checked={selectedIds.size === variants.length && variants.length > 0}
                  ref={selectAllRef}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedIds(new Set(variants.map((v) => v.tempId)));
                    else setSelectedIds(new Set());
                  }}
                  className="accent-[#22C55E] cursor-pointer w-4 h-4"
                />
                <span className={`text-xs font-semibold font-[family-name:var(--font-roboto)] ${showBulkRow ? "text-[#16A34A]" : "text-[#9CA3AF]"}`}>
                  {showBulkRow
                    ? `${selectedIds.size} variante${selectedIds.size > 1 ? "s" : ""} sélectionnée${selectedIds.size > 1 ? "s" : ""}`
                    : "Tout sélectionner pour modifier en masse"}
                </span>
              </label>
              <button type="button" onClick={applyBulk} disabled={!showBulkRow}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors font-[family-name:var(--font-roboto)] ${
                  showBulkRow ? "bg-[#22C55E] text-white hover:bg-[#16A34A]" : "bg-[#E5E5E5] text-[#9CA3AF] cursor-not-allowed"
                }`}>Appliquer</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className={`text-[10px] uppercase tracking-wider font-semibold font-[family-name:var(--font-roboto)] ${showBulkRow ? "text-[#16A34A]" : "text-[#9CA3AF]"}`}>Prix</label>
                <input type="number" min="0" step="0.01" placeholder="—" value={bulkEdit.unitPrice} disabled={!showBulkRow}
                  onChange={(e) => setBulkEdit((b) => ({ ...b, unitPrice: e.target.value }))}
                  className={`w-full mt-1 border px-2 py-1.5 text-xs rounded-md focus:outline-none font-[family-name:var(--font-roboto)] ${
                    showBulkRow ? "border-[#22C55E] bg-white" : "border-[#E5E5E5] bg-[#EFEFEF] text-[#9CA3AF] cursor-not-allowed"
                  }`} />
              </div>
              <div>
                <label className={`text-[10px] uppercase tracking-wider font-semibold font-[family-name:var(--font-roboto)] ${showBulkRow ? "text-[#16A34A]" : "text-[#9CA3AF]"}`}>Stock</label>
                <input type="number" min="0" step="1" placeholder="—" value={bulkEdit.stock} disabled={!showBulkRow}
                  onChange={(e) => setBulkEdit((b) => ({ ...b, stock: e.target.value }))}
                  className={`w-full mt-1 border px-2 py-1.5 text-xs rounded-md focus:outline-none font-[family-name:var(--font-roboto)] ${
                    showBulkRow ? "border-[#22C55E] bg-white" : "border-[#E5E5E5] bg-[#EFEFEF] text-[#9CA3AF] cursor-not-allowed"
                  }`} />
              </div>
              <div>
                <label className={`text-[10px] uppercase tracking-wider font-semibold font-[family-name:var(--font-roboto)] ${showBulkRow ? "text-[#16A34A]" : "text-[#9CA3AF]"}`}>Poids</label>
                <input type="number" min="0" step="0.001" placeholder="—" value={bulkEdit.weight} disabled={!showBulkRow}
                  onChange={(e) => setBulkEdit((b) => ({ ...b, weight: e.target.value }))}
                  className={`w-full mt-1 border px-2 py-1.5 text-xs rounded-md focus:outline-none font-[family-name:var(--font-roboto)] ${
                    showBulkRow ? "border-[#22C55E] bg-white" : "border-[#E5E5E5] bg-[#EFEFEF] text-[#9CA3AF] cursor-not-allowed"
                  }`} />
              </div>
              <div>
                <label className={`text-[10px] uppercase tracking-wider font-semibold font-[family-name:var(--font-roboto)] ${showBulkRow ? "text-[#16A34A]" : "text-[#9CA3AF]"}`}>Remise</label>
                <div className="flex gap-1 mt-1">
                  <CustomSelect value={bulkEdit.discountType} disabled={!showBulkRow}
                    onChange={(val) => setBulkEdit((b) => ({ ...b, discountType: val as "" | "PERCENT" | "AMOUNT", discountValue: "" }))}
                    options={[{ value: "", label: "—" }, { value: "PERCENT", label: "%" }, { value: "AMOUNT", label: "€" }]}
                    size="sm" className="w-[70px]" />
                  {bulkEdit.discountType && (
                    <input type="number" min="0" step="0.01" placeholder="0" value={bulkEdit.discountValue} disabled={!showBulkRow}
                      onChange={(e) => setBulkEdit((b) => ({ ...b, discountValue: e.target.value }))}
                      className={`w-16 border px-2 py-1.5 text-xs rounded-md focus:outline-none font-[family-name:var(--font-roboto)] ${
                        showBulkRow ? "border-[#22C55E] bg-white" : "border-[#E5E5E5] bg-[#EFEFEF] text-[#9CA3AF] cursor-not-allowed"
                      }`} />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── UNIT variants (1 card per variant, grouped by color adjacency) ── */}
          {sortedUnitVariants.map((v) => renderUnitVariantRow(v))}

          {/* ── PACK variants ── */}
          {packVariants.length > 0 && (
            <>
              {sortedUnitVariants.length > 0 && (
                <div className="flex items-center gap-3 pt-2">
                  <div className="flex-1 border-t border-[#E5E5E5]" />
                  <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold font-[family-name:var(--font-roboto)]">Paquets</span>
                  <div className="flex-1 border-t border-[#E5E5E5]" />
                </div>
              )}
              {packVariants.map((v) => renderPackVariant(v))}
            </>
          )}

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
        <button
          type="button"
          onClick={addVariant}
          className="w-full border-2 border-dashed border-[#E5E5E5] py-3 text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:border-[#1A1A1A] hover:bg-[#F7F7F8] transition-colors flex items-center justify-center gap-2 rounded-lg"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Ajouter une variante
        </button>

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

        {onQuickCreateColor && (
          !showQuickCreate ? (
            <button type="button" onClick={() => setShowQuickCreate(true)}
              className="w-full border-2 border-dashed border-[#E5E5E5] py-3 text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:border-[#1A1A1A] hover:bg-[#F7F7F8] transition-colors flex items-center justify-center gap-2 rounded-lg">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
              </svg>
              Créer une couleur
            </button>
          ) : (
            <div className="border-2 border-dashed border-[#1A1A1A] bg-[#F7F7F8] p-4 space-y-3 rounded-lg">
              <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wider font-[family-name:var(--font-roboto)]">Nouvelle couleur</p>
              <div className="flex gap-3">
                <input type="text" value={newColorName} onChange={(e) => setNewColorName(e.target.value)} placeholder="Nom de la couleur" autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleQuickSave(); } }}
                  className="flex-1 border border-[#E5E5E5] px-3 py-2 text-sm font-[family-name:var(--font-roboto)] focus:outline-none focus:border-[#1A1A1A] bg-white rounded" />
                <input type="color" value={newColorHex} onChange={(e) => setNewColorHex(e.target.value)}
                  className="w-9 h-9 border border-[#E5E5E5] cursor-pointer p-0.5 shrink-0 bg-white rounded" title="Couleur hex" />
              </div>
              <div>
                <p className="text-[11px] text-[#6B6B6B] font-[family-name:var(--font-roboto)] mb-1.5">Image motif <span className="text-[#9CA3AF]">(optionnel)</span></p>
                {newColorPattern ? (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={newColorPattern} alt="Motif" className="w-12 h-12 rounded-lg border border-[#E5E5E5] object-cover" />
                    <button type="button" onClick={() => setNewColorPattern(null)} className="text-xs text-[#EF4444] hover:underline font-[family-name:var(--font-roboto)]">Supprimer</button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-[#D1D5DB] rounded-lg cursor-pointer hover:border-[#1A1A1A] transition-colors bg-white">
                    <svg className="w-4 h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" /></svg>
                    <span className="text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">{patternUploading ? "Upload..." : "Ajouter une image motif"}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={patternUploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePatternUpload(f); e.target.value = ""; }} />
                  </label>
                )}
              </div>
              {quickCreateErr && <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)]">{quickCreateErr}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={handleQuickSave} disabled={quickSaving || patternUploading || !newColorName.trim()}
                  className="flex-1 py-2 bg-[#1A1A1A] text-white text-sm font-medium hover:bg-black transition-colors disabled:opacity-50 font-[family-name:var(--font-roboto)] rounded">
                  {quickSaving ? "Création..." : "Créer la couleur"}
                </button>
                <button type="button" onClick={() => { setShowQuickCreate(false); setQuickCreateErr(""); setNewColorPattern(null); }}
                  className="px-4 py-2 border border-[#E5E5E5] text-sm text-[#6B6B6B] hover:border-[#1A1A1A] transition-colors font-[family-name:var(--font-roboto)] rounded">
                  Annuler
                </button>
              </div>
            </div>
          )
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
    </div>
  );
}
