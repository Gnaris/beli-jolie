"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import ImageDropzone from "./ImageDropzone";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";
import ColorSwatch from "@/components/ui/ColorSwatch";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import QuickCreateSizeModal, { type QuickCreateSizeModalResult } from "@/components/admin/products/QuickCreateSizeModal";
import PackCompositionModal from "@/components/admin/products/PackCompositionModal";
import { generateSku } from "@/lib/sku";

// ─────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────

export interface SizeEntryState {
  tempId: string;
  sizeId: string;
  sizeName: string;
  quantity: string;
  pricePerUnit?: string;
}

/** Une ligne d'un PACK multi-couleurs : 1 couleur + ses tailles/quantités. */
export interface PackLineState {
  tempId: string;
  colorId: string;
  colorName: string;
  colorHex: string;
  sizeEntries: SizeEntryState[];
}

export interface VariantState {
  tempId: string;
  dbId?: string;
  // Couleur unique de la variante
  colorId: string;
  colorName: string;
  colorHex: string;
  // Tailles avec quantités (UNIT ou PACK mono-couleur)
  sizeEntries: SizeEntryState[];
  unitPrice: string;
  weight: string;
  stock: string;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: string;
  // PACK multi-couleurs : si non-vide, supplante colorId/sizeEntries.
  packLines: PackLineState[];
  sku: string;
  disabled: boolean;
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
  pfsSizes?: { reference: string; label: string }[];
  onChange: (variants: VariantState[]) => void;
  onChangeImages: (images: ColorImageState[]) => void;
  onQuickCreateColor?: (name: string, hex: string | null, patternImage: string | null) => Promise<AvailableColor>;
  onColorAdded?: (color: AvailableColor) => void;
  onSizeAdded?: (size: AvailableSize) => void;
  variantErrors?: Map<string, Set<string>>;
  productReference?: string;
  sizeDetailsTu?: string;
  /** Couleur principale du produit (refonte : portée par Product, plus par la variante). */
  primaryColorId: string | null;
  /** Callback pour changer la couleur principale via la modale d'images. */
  onChangePrimaryColorId: (colorId: string) => void;
}

// ─────────────────────────────────────────────
// Verrouillage post-création
// Une fois la variante enregistrée (dbId présent), couleur / type / tailles
// ne peuvent plus changer côté marketplace (PFS bloque les modifs sur ces
// champs après publication). On les verrouille donc en UI : pour les changer,
// l'admin supprime la variante puis en recrée une nouvelle.
// ─────────────────────────────────────────────
const LOCKED_VARIANT_TOOLTIP =
  "Cette variante est déjà enregistrée. Pour changer la couleur, le type ou les tailles, supprimez-la puis recréez-en une nouvelle.";

function isVariantLocked(v: VariantState): boolean {
  return !!v.dbId;
}

// ─────────────────────────────────────────────
// Price helpers
// ─────────────────────────────────────────────

export function computeTotalPrice(v: VariantState): number | null {
  const unit = parseFloat(v.unitPrice);
  if (isNaN(unit) || unit <= 0) return null;
  if (isMultiColorPack(v)) {
    let totalQty = 0;
    for (const line of v.packLines) {
      if (!line.colorId) return null;
      if (line.sizeEntries.length === 0) return null;
      for (const se of line.sizeEntries) {
        const qty = parseInt(se.quantity);
        if (isNaN(qty) || qty <= 0) return null;
        totalQty += qty;
      }
    }
    return totalQty > 0 ? Math.round(unit * totalQty * 100) / 100 : null;
  }
  if (v.sizeEntries.length === 0) return v.saleType === "PACK" ? null : unit;
  let totalQty = 0;
  for (const se of v.sizeEntries) {
    const qty = parseInt(se.quantity);
    if (isNaN(qty) || qty <= 0) return null;
    totalQty += qty;
  }
  if (totalQty === 0) return v.saleType === "PACK" ? null : unit;
  return Math.round(unit * totalQty * 100) / 100;
}

export function computePackTotalQty(v: VariantState): number {
  if (isMultiColorPack(v)) return computePackLinesTotal(v.packLines);
  let total = 0;
  for (const se of v.sizeEntries) total += parseInt(se.quantity) || 0;
  return total;
}

export function computeFinalPrice(v: VariantState, discountPercent?: number | null): number | null {
  const total = computeTotalPrice(v);
  if (total === null) return null;
  if (!discountPercent || discountPercent <= 0) return total;
  return Math.max(0, total * (1 - discountPercent / 100));
}

export function computeGlobalPrice(v: VariantState): number | null {
  return computeTotalPrice(v);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

export function uid() { return Math.random().toString(36).slice(2, 9); }

export function buildVariantDuplicateKey(v: VariantState): string {
  if (isMultiColorPack(v)) {
    const lineKey = v.packLines
      .map((l) => {
        const sk = [...l.sizeEntries]
          .sort((a, b) => a.sizeId.localeCompare(b.sizeId))
          .map((s) => `${s.sizeId}:${s.quantity}`)
          .join(",");
        return `${l.colorId}:[${sk}]`;
      })
      .sort()
      .join("|");
    return `PACK::MULTI::${lineKey}`;
  }
  const sizeKey = [...v.sizeEntries]
    .sort((a, b) => a.sizeId.localeCompare(b.sizeId))
    .map((s) => `${s.sizeId}:${s.quantity}`)
    .join(",");
  return `${v.saleType}::${v.colorId}::${sizeKey}`;
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

/** Clé de groupe = colorId. */
export function variantGroupKeyFromState(v: { colorId: string }): string {
  return v.colorId;
}

export function imageGroupKeyFromVariant(v: VariantState): string {
  return variantGroupKeyFromState(v);
}

export function variantColorFingerprint(v: VariantState): string {
  return v.colorId ?? "";
}

/** Liste des couleurs distinctes utilisées dans les variantes existantes. */
export function computeExistingColorCombos(
  existingVariants: VariantState[],
): { key: string; color: { colorId: string; colorName: string; colorHex: string } }[] {
  const seen = new Set<string>();
  const combos: { key: string; color: { colorId: string; colorName: string; colorHex: string } }[] = [];
  for (const v of existingVariants) {
    if (!v.colorId) continue;
    if (seen.has(v.colorId)) continue;
    seen.add(v.colorId);
    combos.push({
      key: v.colorId,
      color: { colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex },
    });
  }
  return combos;
}

function defaultVariant(): VariantState {
  return {
    tempId: uid(),
    colorId: "",
    colorName: "",
    colorHex: "#9CA3AF",
    sizeEntries: [],
    unitPrice: "",
    weight: "",
    stock: "",
    isPrimary: false,
    saleType: "UNIT",
    packQuantity: "",
    packLines: [],
    sku: "",
    disabled: false,
  };
}

/** True si la variante PACK utilise la composition multi-couleurs. */
export function isMultiColorPack(v: Pick<VariantState, "saleType" | "packLines">): boolean {
  return v.saleType === "PACK" && v.packLines.length > 0;
}

/** Total des pièces d'un pack multi-couleurs. */
export function computePackLinesTotal(lines: PackLineState[]): number {
  let total = 0;
  for (const line of lines) {
    for (const se of line.sizeEntries) total += parseInt(se.quantity) || 0;
  }
  return total;
}

/** Liste des couleurs distinctes d'un pack multi-couleurs. */
export function packLinesColorList(lines: PackLineState[]): { colorId: string; colorName: string; colorHex: string }[] {
  return lines
    .filter((l) => l.colorId)
    .map((l) => ({ colorId: l.colorId, colorName: l.colorName, colorHex: l.colorHex }));
}

function isVariantPristine(v: VariantState): boolean {
  return (
    v.sizeEntries.length === 0 &&
    !v.unitPrice.trim() &&
    !v.stock.trim() &&
    !v.weight.trim() &&
    !v.packQuantity.trim()
  );
}

export function findDonorVariant(
  target: Pick<VariantState, "tempId" | "saleType" | "colorId">,
  all: VariantState[]
): VariantState | null {
  const candidates = all.filter(
    (v) =>
      v.tempId !== target.tempId &&
      !v.disabled &&
      (v.sizeEntries.length > 0 ||
        !!v.unitPrice.trim() ||
        !!v.stock.trim() ||
        !!v.weight.trim())
  );
  if (candidates.length === 0) return null;
  const findLast = <T,>(arr: T[], pred: (x: T) => boolean): T | null => {
    for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i];
    return null;
  };
  return (
    findLast(candidates, (v) => v.saleType === target.saleType && !!target.colorId && v.colorId === target.colorId) ??
    findLast(candidates, (v) => v.saleType === target.saleType) ??
    findLast(candidates, (v) => !!target.colorId && v.colorId === target.colorId) ??
    candidates[candidates.length - 1]
  );
}

export function applyDonorAutofill(target: VariantState, donor: VariantState, makeId: () => string): VariantState {
  const sameType = donor.saleType === target.saleType;
  return {
    ...target,
    unitPrice: donor.unitPrice,
    weight: donor.weight,
    stock: donor.stock,
    ...(sameType
      ? {
          sizeEntries: donor.sizeEntries.map((se) => ({ ...se, tempId: makeId() })),
          packQuantity: donor.packQuantity,
        }
      : {}),
  };
}

interface BulkEditState { unitPrice: string; weight: string; stock: string; }
function defaultBulkEdit(): BulkEditState { return { unitPrice: "", weight: "", stock: "" }; }

// ─────────────────────────────────────────────
// SingleColorSelect — modale pour choisir UNE couleur
// ─────────────────────────────────────────────
function SingleColorSelect({
  selected,
  options,
  onChange,
  onCreateColor,
  onColorAdded,
}: {
  selected: { colorId: string; colorName: string; colorHex: string } | null;
  options: AvailableColor[];
  onChange: (color: { colorId: string; colorName: string; colorHex: string } | null) => void;
  onCreateColor?: (name: string, hex: string | null, patternImage: string | null) => Promise<AvailableColor>;
  onColorAdded?: (color: AvailableColor) => void;
}) {
  void onCreateColor;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ colorId: string; colorName: string; colorHex: string } | null>(selected);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [localCreatedColors, setLocalCreatedColors] = useState<AvailableColor[]>([]);
  const backdropColorPicker = useBackdropClose(() => cancel());

  const allOptions = useMemo(() => {
    const ids = new Set(options.map((o) => o.id));
    return [...options, ...localCreatedColors.filter((c) => !ids.has(c.id))];
  }, [options, localCreatedColors]);

  function openModal() {
    setDraft(selected);
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  function cancel() {
    setOpen(false);
    setSearch("");
  }

  function confirm() {
    onChange(draft);
    setOpen(false);
    setSearch("");
  }

  function pickColor(opt: AvailableColor) {
    setDraft({ colorId: opt.id, colorName: opt.name, colorHex: opt.hex ?? "#9CA3AF" });
  }

  function clearDraft() {
    setDraft(null);
  }

  function handleQuickColorCreated(item: { id: string; name: string; hex?: string | null; patternImage?: string | null }) {
    const newColor: AvailableColor = { id: item.id, name: item.name, hex: item.hex ?? null, patternImage: item.patternImage ?? null };
    setLocalCreatedColors((prev) => [...prev, newColor]);
    onColorAdded?.(newColor);
    setDraft({ colorId: newColor.id, colorName: newColor.name, colorHex: newColor.hex ?? "#9CA3AF" });
    setShowQuickCreate(false);
  }

  const filtered = search.trim()
    ? allOptions.filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase()))
    : allOptions;

  const triggerOpt = selected ? allOptions.find((o) => o.id === selected.colorId) : null;

  return (
    <div>
      <button
        type="button"
        onClick={openModal}
        className="w-full flex items-center gap-1.5 bg-bg-primary border border-border px-2 py-1.5 text-xs font-body text-text-primary focus:outline-none focus:border-[#1A1A1A] hover:border-[#9CA3AF] transition-colors text-left min-h-[32px] rounded-md"
      >
        {!selected ? (
          <span className="text-text-muted flex-1 italic">— Couleur</span>
        ) : (
          <span className="flex items-center gap-1.5 flex-1 min-w-0">
            <ColorSwatch hex={selected.colorHex} patternImage={triggerOpt?.patternImage ?? null} size={14} rounded="full" />
            <span className="truncate text-[11px]">{selected.colorName}</span>
          </span>
        )}
        <svg className="w-3 h-3 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6" onMouseDown={backdropColorPicker.onMouseDown} onMouseUp={backdropColorPicker.onMouseUp}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col"
            style={{ maxHeight: "min(85vh, 640px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h3 className="text-base font-semibold font-heading text-text-primary">Couleur de la variante</h3>
              <button type="button" onClick={cancel} className="p-1.5 hover:bg-bg-secondary rounded-lg transition-colors" aria-label="Fermer">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 bg-[#FAFAFA] border-b border-border shrink-0">
              {!draft ? (
                <div className="flex items-center gap-3 text-text-muted">
                  <div className="w-8 h-8 rounded-full border-2 border-dashed border-[#D1D5DB]" />
                  <span className="text-sm font-body">Sélectionnez une couleur ci-dessous</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <ColorSwatch hex={draft.colorHex} patternImage={allOptions.find((o) => o.id === draft.colorId)?.patternImage ?? null} size={28} rounded="full" border />
                  <span className="text-sm font-medium text-text-primary font-body flex-1">{draft.colorName}</span>
                  <button type="button" onClick={clearDraft} className="text-[11px] text-text-muted hover:text-[#EF4444] font-body">Vider</button>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col min-h-0">
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

              <div className="flex-1 overflow-y-auto px-6 pb-3">
                {filtered.length === 0 ? (
                  <div className="py-12 text-center text-sm text-text-muted font-body">Aucun résultat</div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {filtered.map((opt) => {
                      const isChecked = draft?.colorId === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => pickColor(opt)}
                          className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center ${
                            isChecked
                              ? "border-[#1A1A1A] bg-bg-secondary shadow-sm"
                              : "border-transparent bg-bg-primary hover:bg-bg-secondary hover:border-border"
                          }`}
                        >
                          <ColorSwatch hex={opt.hex} patternImage={opt.patternImage} size={36} rounded="lg" />
                          <span className="text-[11px] font-body text-text-primary truncate w-full leading-tight">{opt.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

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

            <div className="flex items-center justify-end gap-2.5 px-6 py-3.5 border-t border-border bg-bg-primary rounded-b-2xl shrink-0">
              <button type="button" onClick={cancel}
                className="px-5 py-2 text-sm font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-xl hover:bg-bg-secondary transition-colors"
              >Annuler</button>
              <button type="button" onClick={confirm}
                className="px-5 py-2 text-sm font-medium font-body text-text-inverse bg-bg-dark rounded-xl hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!draft}
              >Valider</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MultiColorSelect — modale pour choisir PLUSIEURS couleurs (PACK multi-couleurs)
// ─────────────────────────────────────────────
interface MultiColorOption { colorId: string; colorName: string; colorHex: string; }

function MultiColorSelect({
  selected,
  options,
  onChange,
  onCreateColor,
  onColorAdded,
}: {
  selected: MultiColorOption[];
  options: AvailableColor[];
  onChange: (colors: MultiColorOption[]) => void;
  onCreateColor?: (name: string, hex: string | null, patternImage: string | null) => Promise<AvailableColor>;
  onColorAdded?: (color: AvailableColor) => void;
}) {
  void onCreateColor;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<MultiColorOption[]>(selected);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [localCreatedColors, setLocalCreatedColors] = useState<AvailableColor[]>([]);
  const backdropPicker = useBackdropClose(() => cancel());

  const allOptions = useMemo(() => {
    const ids = new Set(options.map((o) => o.id));
    return [...options, ...localCreatedColors.filter((c) => !ids.has(c.id))];
  }, [options, localCreatedColors]);

  function openModal() {
    setDraft(selected);
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 0);
  }
  function cancel() { setOpen(false); setSearch(""); }
  function confirm() { onChange(draft); setOpen(false); setSearch(""); }

  function toggleColor(opt: AvailableColor) {
    const exists = draft.find((d) => d.colorId === opt.id);
    if (exists) {
      setDraft(draft.filter((d) => d.colorId !== opt.id));
    } else {
      setDraft([...draft, { colorId: opt.id, colorName: opt.name, colorHex: opt.hex ?? "#9CA3AF" }]);
    }
  }
  function removeFromDraft(colorId: string) {
    setDraft(draft.filter((d) => d.colorId !== colorId));
  }
  function clearDraft() { setDraft([]); }

  function handleQuickColorCreated(item: { id: string; name: string; hex?: string | null; patternImage?: string | null }) {
    const newColor: AvailableColor = { id: item.id, name: item.name, hex: item.hex ?? null, patternImage: item.patternImage ?? null };
    setLocalCreatedColors((prev) => [...prev, newColor]);
    onColorAdded?.(newColor);
    setDraft((prev) => [...prev, { colorId: newColor.id, colorName: newColor.name, colorHex: newColor.hex ?? "#9CA3AF" }]);
    setShowQuickCreate(false);
  }

  const filtered = search.trim()
    ? allOptions.filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase()))
    : allOptions;

  return (
    <div>
      <button
        type="button"
        onClick={openModal}
        className="w-full flex items-center gap-1.5 bg-bg-primary border border-border px-2 py-1.5 text-xs font-body text-text-primary focus:outline-none focus:border-[#1A1A1A] hover:border-[#9CA3AF] transition-colors text-left min-h-[32px] rounded-md"
      >
        {selected.length === 0 ? (
          <span className="text-text-muted flex-1 italic">— Couleurs du paquet</span>
        ) : (
          <span className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
            {selected.slice(0, 4).map((c) => {
              const opt = allOptions.find((o) => o.id === c.colorId);
              return (
                <span key={c.colorId} className="inline-flex items-center gap-1 bg-bg-secondary px-1.5 py-0.5 rounded-md text-[10px] border border-border-light">
                  <ColorSwatch hex={c.colorHex} patternImage={opt?.patternImage ?? null} size={10} rounded="full" />
                  <span className="truncate max-w-[60px]">{c.colorName}</span>
                </span>
              );
            })}
            {selected.length > 4 && (
              <span className="text-[10px] text-text-muted font-medium">+{selected.length - 4}</span>
            )}
          </span>
        )}
        <svg className="w-3 h-3 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6" onMouseDown={backdropPicker.onMouseDown} onMouseUp={backdropPicker.onMouseUp}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col"
            style={{ maxHeight: "min(85vh, 680px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div>
                <h3 className="text-base font-semibold font-heading text-text-primary">Couleurs du paquet</h3>
                <p className="text-[11px] text-text-muted font-body mt-0.5">Choisissez toutes les couleurs présentes dans le paquet.</p>
              </div>
              <button type="button" onClick={cancel} className="p-1.5 hover:bg-bg-secondary rounded-lg transition-colors" aria-label="Fermer">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Sélection actuelle */}
            <div className="px-6 py-3 bg-[#FAFAFA] border-b border-border shrink-0 min-h-[58px]">
              {draft.length === 0 ? (
                <div className="flex items-center gap-3 text-text-muted h-9">
                  <div className="w-7 h-7 rounded-full border-2 border-dashed border-[#D1D5DB]" />
                  <span className="text-sm font-body">Aucune couleur sélectionnée</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  {draft.map((c) => {
                    const opt = allOptions.find((o) => o.id === c.colorId);
                    return (
                      <span key={c.colorId} className="inline-flex items-center gap-1.5 bg-bg-primary border border-border px-2 py-1 rounded-lg text-xs font-body">
                        <ColorSwatch hex={c.colorHex} patternImage={opt?.patternImage ?? null} size={14} rounded="full" />
                        <span className="text-text-primary">{c.colorName}</span>
                        <button type="button" onClick={() => removeFromDraft(c.colorId)} className="text-text-muted hover:text-[#EF4444] ml-0.5" aria-label="Retirer">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    );
                  })}
                  {draft.length > 1 && (
                    <button type="button" onClick={clearDraft} className="text-[11px] text-text-muted hover:text-[#EF4444] font-body underline ml-1">Tout vider</button>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col min-h-0">
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

              <div className="flex-1 overflow-y-auto px-6 pb-3">
                {filtered.length === 0 ? (
                  <div className="py-12 text-center text-sm text-text-muted font-body">Aucun résultat</div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {filtered.map((opt) => {
                      const isChecked = draft.some((d) => d.colorId === opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => toggleColor(opt)}
                          className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center ${
                            isChecked
                              ? "border-[#1A1A1A] bg-bg-secondary shadow-sm"
                              : "border-transparent bg-bg-primary hover:bg-bg-secondary hover:border-border"
                          }`}
                        >
                          {isChecked && (
                            <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#1A1A1A] flex items-center justify-center">
                              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </span>
                          )}
                          <ColorSwatch hex={opt.hex} patternImage={opt.patternImage} size={36} rounded="lg" />
                          <span className="text-[11px] font-body text-text-primary truncate w-full leading-tight">{opt.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

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

            <div className="flex items-center justify-between gap-2.5 px-6 py-3.5 border-t border-border bg-bg-primary rounded-b-2xl shrink-0">
              <span className="text-xs text-text-muted font-body">
                {draft.length === 0 ? "Aucune couleur" : `${draft.length} couleur${draft.length > 1 ? "s" : ""} sélectionnée${draft.length > 1 ? "s" : ""}`}
              </span>
              <div className="flex items-center gap-2.5">
                <button type="button" onClick={cancel}
                  className="px-5 py-2 text-sm font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-xl hover:bg-bg-secondary transition-colors"
                >Annuler</button>
                <button type="button" onClick={confirm}
                  className="px-5 py-2 text-sm font-medium font-body text-text-inverse bg-bg-dark rounded-xl hover:bg-primary-hover transition-colors"
                >Valider</button>
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
// ImageGalleryModal
// ─────────────────────────────────────────────
function ImageGalleryModal({ open, onClose, images, colorName, colorHex }: {
  open: boolean; onClose: () => void; images: string[]; colorName: string; colorHex: string;
}) {
  const [idx, setIdx] = useState(0);
  const backdrop = useBackdropClose(onClose);
  const prev = useCallback(() => setIdx((i) => (i === 0 ? images.length - 1 : i - 1)), [images.length]);
  const next = useCallback(() => setIdx((i) => (i === images.length - 1 ? 0 : i + 1)), [images.length]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, prev, next, onClose]);

  if (!open || images.length === 0) return null;

  const modal = (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onMouseDown={backdrop.onMouseDown} onMouseUp={backdrop.onMouseUp}>
      <div className="relative bg-bg-primary rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ width: 560, maxWidth: "95vw" }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full border border-border shrink-0" style={{ backgroundColor: colorHex || "#9CA3AF" }} />
            <span className="text-sm font-semibold text-text-primary font-heading">{colorName}</span>
            <span className="text-xs text-text-muted font-body">{idx + 1} / {images.length}</span>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="relative bg-bg-secondary flex items-center justify-center" style={{ height: 400 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[idx]} alt={`${colorName} ${idx + 1}`} className="w-full h-full object-contain select-none" draggable={false} />
          {images.length > 1 && (
            <>
              <button type="button" onClick={prev} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-bg-primary/90 hover:bg-bg-primary shadow-md rounded-full flex items-center justify-center transition-all hover:scale-105">
                <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button type="button" onClick={next} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-bg-primary/90 hover:bg-bg-primary shadow-md rounded-full flex items-center justify-center transition-all hover:scale-105">
                <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}
        </div>
        {images.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 py-3 bg-bg-primary shrink-0">
            {images.map((_, i) => (
              <button key={i} type="button" onClick={() => setIdx(i)}
                className={`rounded-full transition-all duration-200 ${i === idx ? "w-6 h-2 bg-bg-dark" : "w-2 h-2 bg-[#D1D5DB] hover:bg-[#9CA3AF]"}`} />
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
function ImageManagerModal({ open, onClose, colorImages, onChange, variants, availableColors, primaryColorId, onChangePrimaryColorId }: {
  open: boolean;
  onClose: () => void;
  colorImages: ColorImageState[];
  onChange: (updated: ColorImageState[]) => void;
  variants: VariantState[];
  availableColors: AvailableColor[];
  /** Couleur principale du produit (refonte : Product.primaryColorId). */
  primaryColorId: string | null;
  /** Callback pour changer la couleur principale du produit. */
  onChangePrimaryColorId: (colorId: string) => void;
}) {
  const { confirm: confirmDialog } = useConfirm();
  const backdrop = useBackdropClose(onClose);
  const colorImagesRef = useRef(colorImages);
  colorImagesRef.current = colorImages;

  function findVariantByGroupKey(groupKey: string): VariantState | undefined {
    return variants.find((v) => imageGroupKeyFromVariant(v) === groupKey);
  }

  function getSwatch(groupKey: string): { hex?: string | null; patternImage?: string | null } {
    const v = findVariantByGroupKey(groupKey);
    if (!v) return { hex: "#9CA3AF" };
    const opt = availableColors.find((c) => c.id === v.colorId);
    return { hex: v.colorHex || opt?.hex, patternImage: opt?.patternImage ?? null };
  }

  const [uploadingSlots, setUploadingSlots] = useState<Record<string, number | null>>({});

  async function handleAddImageAtPosition(groupKey: string, file: File, _position: number) {
    const state = colorImagesRef.current.find((c) => c.groupKey === groupKey);
    if (!state) return;
    const usedPositions = new Set(state.orders);
    let position = 0;
    while (usedPositions.has(position)) position++;
    if (position >= 5) return;
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
        orders: c.orders.filter((_, j) => j !== idx).map((o) => (o > position ? o - 1 : o)),
      };
    }));
  }

  function handleSwapPositions(groupKey: string, fromPos: number, toPos: number) {
    onChange(colorImages.map((c) => {
      if (c.groupKey !== groupKey) return c;
      if (!c.orders.includes(fromPos) || !c.orders.includes(toPos)) return c;
      const newOrders = c.orders.map((o) => (o === fromPos ? toPos : o === toPos ? fromPos : o));
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
        const newPreviews = c.imagePreviews.filter((_, i) => i !== srcIdx);
        const newPaths = c.uploadedPaths.filter((_, i) => i !== srcIdx);
        const newOrders = c.orders.filter((_, i) => i !== srcIdx).map((o) => (o > sourcePos ? o - 1 : o));
        return { ...c, imagePreviews: newPreviews, uploadedPaths: newPaths, orders: newOrders };
      }
      if (c.groupKey === targetGroupKey) {
        const usedPositions = new Set(c.orders);
        let finalPos = 0;
        while (usedPositions.has(finalPos) && finalPos < 5) finalPos++;
        if (finalPos >= 5) return c;
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-bold text-text-primary font-heading">Images par couleur</h3>
            <p className="text-xs text-text-muted font-body mt-0.5">
              {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""} — partagées entre toutes les variantes de la même couleur
            </p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {colorImages.length > 0 && (
            <div className="border border-border rounded-xl p-4">
              <p className="text-xs font-semibold text-text-primary uppercase tracking-wider font-body mb-3">Couleur principale</p>
              <div className="flex flex-wrap gap-2">
                {colorImages.map((cimg) => {
                  // Refonte : la couleur principale est désormais portée par le produit
                  // (Product.primaryColorId), pas par la variante. La sélection est faite
                  // directement par colorId — y compris pour les couleurs qui n'apparaissent
                  // que dans des pack-lines (résolution du bug Orange).
                  const isPrimary = !!cimg.colorId && cimg.colorId === primaryColorId;
                  const seg = getSwatch(cimg.groupKey);
                  return (
                    <button key={cimg.groupKey} type="button"
                      onClick={() => { if (cimg.colorId) onChangePrimaryColorId(cimg.colorId); }}
                      disabled={!cimg.colorId}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all font-body ${
                        isPrimary ? "border-bg-dark bg-bg-secondary shadow-sm" : "border-border hover:border-text-muted bg-bg-primary"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <ColorSwatch hex={seg.hex} patternImage={seg.patternImage} size={16} rounded="full" />
                      <span className={`text-xs font-medium ${isPrimary ? "text-text-primary" : "text-text-secondary"}`}>{cimg.colorName}</span>
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
            <p className="text-sm text-text-muted font-body text-center py-8">Aucune couleur dans les variantes. Ajoutez d&apos;abord des variantes.</p>
          ) : colorImages.map((cimg, idx) => {
            const seg = getSwatch(cimg.groupKey);
            const missingImages = cimg.uploadedPaths.length === 0;
            return (
              <div key={cimg.groupKey} className={`border rounded-xl p-4 ${missingImages ? "border-[#EF4444] bg-red-50/30" : "border-border"}`}>
                <div className="flex items-center gap-2 mb-3">
                  <ColorSwatch hex={seg.hex} patternImage={seg.patternImage} size={16} rounded="full" />
                  <span className="text-sm font-semibold text-text-primary font-body">{cimg.colorName}</span>
                  <span className="text-xs text-text-muted font-body">({cimg.imagePreviews.length}/5)</span>
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

        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button type="button" onClick={onClose}
            className="px-5 py-2.5 bg-bg-dark text-text-inverse text-sm font-medium rounded-lg hover:bg-black transition-colors font-body"
          >Fermer</button>
        </div>
      </div>
    </div>
  );

  return typeof window !== "undefined" ? createPortal(modal, document.body) : null;
}

// ─────────────────────────────────────────────
// SizeModal
// ─────────────────────────────────────────────
function SizeModal({ open, onClose, variant, availableSizes, pfsSizes, onSave, onSizeAdded }: {
  open: boolean; onClose: () => void; variant: VariantState; availableSizes: AvailableSize[];
  pfsSizes: { reference: string; label: string }[]; onSave: (entries: SizeEntryState[]) => void;
  onSizeAdded?: (size: AvailableSize) => void;
}) {
  const backdrop = useBackdropClose(onClose);
  const isUnit = variant.saleType === "UNIT";
  const isPack = variant.saleType === "PACK";
  const [draft, setDraft] = useState<SizeEntryState[]>(variant.sizeEntries);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [bulkQty, setBulkQty] = useState("");

  useEffect(() => { setDraft(variant.sizeEntries); }, [variant.sizeEntries]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const usedSizeIds = new Set(draft.map((s) => s.sizeId));

  function toggleSize(size: AvailableSize) {
    if (usedSizeIds.has(size.id)) {
      setDraft(draft.filter((s) => s.sizeId !== size.id));
    } else {
      if (isUnit && draft.length >= 1) {
        setDraft([{ tempId: uid(), sizeId: size.id, sizeName: size.name, quantity: "1" }]);
      } else {
        setDraft([...draft, { tempId: uid(), sizeId: size.id, sizeName: size.name, quantity: "1" }]);
      }
    }
  }

  function updateQty(sizeId: string, qty: string) {
    setDraft(draft.map((s) => s.sizeId === sizeId ? { ...s, quantity: qty } : s));
  }

  function handleSave() { onSave(draft); onClose(); }

  function handleSizeCreated(result: QuickCreateSizeModalResult) {
    const newSize: AvailableSize = { id: result.id, name: result.name };
    onSizeAdded?.(newSize);
    if (isUnit) setDraft([{ tempId: uid(), sizeId: newSize.id, sizeName: newSize.name, quantity: "1" }]);
    else setDraft([...draft, { tempId: uid(), sizeId: newSize.id, sizeName: newSize.name, quantity: "1" }]);
    setQuickCreateOpen(false);
  }

  function applyBulkQty() {
    const qty = parseInt(bulkQty);
    if (!qty || qty < 1) return;
    setDraft(draft.map((s) => ({ ...s, quantity: String(qty) })));
  }

  const packTotalQty = isPack ? draft.reduce((s, e) => s + (parseInt(e.quantity) || 0), 0) : 0;
  if (!open) return null;

  const modal = (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6" onMouseDown={backdrop.onMouseDown} onMouseUp={backdrop.onMouseUp}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: "min(85vh, 600px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-base font-semibold font-heading text-text-primary">{isUnit ? "Taille" : "Tailles & quantités"}</h3>
            <p className="text-xs text-text-muted font-body mt-0.5">{isUnit ? "Sélectionnez une taille (max 1)" : "Configurez les tailles et quantités du paquet"}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-bg-secondary rounded-xl transition-colors" aria-label="Fermer">
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {draft.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide font-body">Sélectionnées ({draft.length})</p>
              {draft.map((se) => (
                <div key={se.tempId} className="flex items-center gap-3 px-3 py-2.5 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg">
                  <svg className="w-4 h-4 text-[#22C55E] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="flex-1 text-sm font-medium text-text-primary font-body">{se.sizeName}</span>
                  {!isUnit && (
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10px] text-text-secondary font-body">Qté</label>
                      <input type="number" min="1" step="1" value={se.quantity}
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
          {isPack && draft.length >= 2 && (
            <div className="border border-border rounded-xl bg-bg-secondary/40 p-3 space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-text-muted font-semibold font-body">
                Raccourci — appliquer à toutes les tailles
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={bulkQty}
                  onChange={(e) => setBulkQty(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyBulkQty(); } }}
                  placeholder="Ex : 3"
                  className="w-20 border border-border bg-bg-primary px-2 py-1.5 text-xs rounded-md focus:outline-none focus:border-[#1A1A1A] font-body"
                />
                <button
                  type="button"
                  onClick={applyBulkQty}
                  disabled={!bulkQty || parseInt(bulkQty) < 1}
                  className="px-3 py-1.5 text-xs font-medium font-body text-text-inverse bg-bg-dark rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Appliquer
                </button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide font-body">Tailles disponibles</p>
            {availableSizes.length === 0 ? (
              <p className="text-xs text-amber-600 font-body">Aucune taille dans la bibliothèque. Créez-en une ci-dessous.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableSizes.map((size) => {
                  const isSelected = usedSizeIds.has(size.id);
                  return (
                    <button key={size.id} type="button" onClick={() => toggleSize(size)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors font-body ${
                        isSelected ? "bg-bg-dark text-text-inverse border-[#1A1A1A]" : "bg-bg-primary text-text-secondary border-border hover:border-bg-dark hover:text-text-primary"
                      }`}
                    >{size.name}</button>
                  );
                })}
              </div>
            )}
          </div>
          {onSizeAdded && (
            <div className="border-t border-border pt-4">
              <button type="button" onClick={() => setQuickCreateOpen(true)} className="text-sm text-text-primary font-medium hover:underline flex items-center gap-2 font-body">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Créer une taille
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-border bg-bg-primary rounded-b-2xl shrink-0">
          <span className="text-sm text-text-muted font-body">
            {isPack
              ? (packTotalQty > 0 ? `${packTotalQty} pièce${packTotalQty > 1 ? "s" : ""} au total` : "Aucune taille configurée")
              : (
                <>
                  {draft.length === 0 ? "Aucune taille" : `${draft.length} taille${draft.length > 1 ? "s" : ""}`}
                  {draft.length > 0 && (() => {
                    const totalQty = draft.reduce((a, s) => a + (parseInt(s.quantity) || 0), 0);
                    return ` — ${totalQty} pièce${totalQty > 1 ? "s" : ""}`;
                  })()}
                </>
              )
            }
          </span>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onClose} className="px-5 py-2 text-sm font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-xl hover:bg-bg-secondary transition-colors">Annuler</button>
            <button type="button" onClick={handleSave} className="px-5 py-2 text-sm font-medium font-body text-text-inverse bg-bg-dark rounded-xl hover:bg-primary-hover transition-colors">Valider</button>
          </div>
        </div>
      </div>
      <QuickCreateSizeModal open={quickCreateOpen} onClose={() => setQuickCreateOpen(false)} pfsSizes={pfsSizes} onCreated={handleSizeCreated} />
    </div>
  );

  return typeof window !== "undefined" ? createPortal(modal, document.body) : null;
}

// ─────────────────────────────────────────────
// QuickAddModal — créer plusieurs variantes d'un coup
// ─────────────────────────────────────────────
interface QuickAddColorLine {
  id: string;
  color: { colorId: string; colorName: string; colorHex: string } | null;
}

function QuickAddModal({
  open, onClose, existingVariants, availableColors, availableSizes, pfsSizes,
  onCreateColor, onColorAdded, onSizeAdded, onConfirm,
}: {
  open: boolean; onClose: () => void; existingVariants: VariantState[];
  availableColors: AvailableColor[]; availableSizes: AvailableSize[];
  pfsSizes: { reference: string; label: string }[];
  onCreateColor?: (name: string, hex: string | null, patternImage: string | null) => Promise<AvailableColor>;
  onColorAdded?: (color: AvailableColor) => void;
  onSizeAdded?: (size: AvailableSize) => void;
  onConfirm: (variants: VariantState[]) => void;
}) {
  const backdrop = useBackdropClose(onClose);
  const [colorLines, setColorLines] = useState<QuickAddColorLine[]>([{ id: uid(), color: null }]);
  const [saleType, setSaleType] = useState<"UNIT" | "PACK">("UNIT");
  const [unitPrice, setUnitPrice] = useState("");
  const [stock, setStock] = useState("");
  const [weight, setWeight] = useState("");
  const [sizeEntries, setSizeEntries] = useState<SizeEntryState[]>([]);
  const [sizeQuickCreateOpen, setSizeQuickCreateOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (open) {
      setColorLines([{ id: uid(), color: null }]);
      setSaleType("UNIT");
      setUnitPrice("");
      setStock("");
      setWeight("");
      setSizeEntries([]);
    }
  }, [open]);

  const existingCombos = useMemo(() => computeExistingColorCombos(existingVariants), [existingVariants]);
  const usedSizeIds = new Set(sizeEntries.map((s) => s.sizeId));

  function addColorLine() { setColorLines((prev) => [...prev, { id: uid(), color: null }]); }
  function removeColorLine(lineId: string) { setColorLines((prev) => prev.filter((l) => l.id !== lineId)); }
  function updateColorLine(lineId: string, color: { colorId: string; colorName: string; colorHex: string } | null) {
    setColorLines((prev) => prev.map((l) => l.id === lineId ? { ...l, color } : l));
  }
  function addExistingColor(combo: typeof existingCombos[0]) {
    setColorLines((prev) => [...prev, { id: uid(), color: combo.color }]);
  }
  function addAllExistingColors() {
    const newLines = existingCombos.map((c) => ({ id: uid(), color: c.color }));
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

  const validLines = colorLines.filter((l) => l.color !== null);
  const canConfirm = validLines.length > 0;

  function handleConfirm() {
    const isUnitType = saleType === "UNIT";
    const totalQty = sizeEntries.reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
    const newVariants: VariantState[] = validLines.map((line, i) => {
      const c = line.color!;
      return {
        tempId: uid(),
        colorId: c.colorId,
        colorName: c.colorName,
        colorHex: c.colorHex,
        sizeEntries: sizeEntries.map((se) => ({ ...se, tempId: uid() })),
        unitPrice,
        weight,
        stock,
        isPrimary: i === 0 && existingVariants.length === 0,
        saleType: isUnitType ? "UNIT" : "PACK",
        packQuantity: isUnitType ? "" : String(totalQty || 1),
        packLines: [],
        sku: "",
        disabled: false,
      };
    });
    onConfirm(newVariants);
    onClose();
  }

  if (!open) return null;

  const modal = (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6" onMouseDown={backdrop.onMouseDown} onMouseUp={backdrop.onMouseUp}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: "min(92vh, 750px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-lg font-semibold font-heading text-text-primary">Ajouter des couleurs</h3>
            <p className="text-xs text-text-muted font-body mt-1">Les paramètres de prix, stock et tailles s’appliqueront à chacune.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 -mr-1 hover:bg-bg-secondary rounded-xl transition-colors" aria-label="Fermer">
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-text-primary font-body">Quelles couleurs ?</h4>
              <p className="text-xs text-text-muted font-body mt-0.5">Une couleur par variante.</p>
            </div>

            {existingCombos.length > 0 && (
              <div className="rounded-xl bg-bg-secondary/60 border border-border-light p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-text-secondary font-body">Déjà sur ce produit — cliquez pour réutiliser</p>
                  <button type="button" onClick={addAllExistingColors}
                    className="text-[11px] text-text-secondary hover:text-text-primary font-body hover:underline transition-colors">
                    Toutes les ajouter
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {existingCombos.map((combo) => {
                    const optC = availableColors.find((o) => o.id === combo.color.colorId);
                    return (
                      <button key={combo.key} type="button" onClick={() => addExistingColor(combo)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-bg-primary hover:border-bg-dark hover:shadow-sm transition-all text-left">
                        <ColorSwatch hex={combo.color.colorHex} patternImage={optC?.patternImage ?? null} size={14} rounded="full" border />
                        <span className="text-[11px] text-text-secondary font-body truncate max-w-[140px]">{combo.color.colorName}</span>
                        <svg className="w-3 h-3 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {colorLines.map((line) => (
                <div key={line.id} className="flex items-center gap-2">
                  <div className="flex-1">
                    <SingleColorSelect
                      selected={line.color}
                      options={availableColors}
                      onChange={(c) => updateColorLine(line.id, c)}
                      onCreateColor={onCreateColor}
                      onColorAdded={onColorAdded}
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

          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-text-primary font-body">Mode de vente</h4>
            <div className="grid grid-cols-2 gap-2">
              <button type="button"
                onClick={() => { setSaleType("UNIT"); if (sizeEntries.length > 1) setSizeEntries(sizeEntries.slice(0, 1)); }}
                className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all font-body ${
                  saleType === "UNIT" ? "border-[#1A1A1A] bg-bg-secondary ring-1 ring-[#1A1A1A]" : "border-border bg-bg-primary hover:border-bg-dark"
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
                  saleType === "PACK" ? "border-[#7C3AED] bg-[#FAF5FF] ring-1 ring-[#7C3AED]" : "border-border bg-bg-primary hover:border-bg-dark"
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

          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-text-primary font-body">Prix & stock</h4>
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

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h4 className="text-sm font-semibold text-text-primary font-body">Tailles disponibles</h4>
              <p className="text-[11px] text-text-muted font-body">{saleType === "UNIT" ? "Une seule taille possible" : "Définissez la quantité par taille"}</p>
            </div>
            {availableSizes.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {availableSizes.map((size) => {
                  const isSelected = usedSizeIds.has(size.id);
                  return (
                    <button key={size.id} type="button" onClick={() => toggleSize(size)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors font-body ${
                        isSelected ? "bg-bg-dark text-text-inverse border-[#1A1A1A]" : "bg-bg-primary text-text-secondary border-border hover:border-bg-dark"
                      }`}>{size.name}</button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-body">Aucune taille dans la bibliothèque. Créez-en une ci-dessous.</p>
            )}
            {saleType === "PACK" && sizeEntries.length > 0 && (
              <div className="rounded-xl bg-bg-secondary/60 border border-border-light p-3 space-y-1.5">
                <p className="text-[11px] text-text-muted font-body mb-1">Pièces par taille dans un pack</p>
                {sizeEntries.map((se) => (
                  <div key={se.tempId} className="flex items-center gap-2">
                    <span className="text-xs text-text-primary font-medium flex-1 font-body">{se.sizeName}</span>
                    <input type="number" min="1" step="1" value={se.quantity}
                      onChange={(e) => updateSizeQty(se.sizeId, e.target.value)}
                      className="w-16 border border-border bg-bg-primary px-2 py-1 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body" />
                    <span className="text-[10px] text-text-muted font-body w-10">pièces</span>
                  </div>
                ))}
              </div>
            )}
            {onSizeAdded && (
              <button type="button" onClick={() => setSizeQuickCreateOpen(true)} className="text-xs text-text-secondary hover:text-text-primary flex items-center gap-1 font-body hover:underline transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Créer une nouvelle taille
              </button>
            )}
          </section>
        </div>
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-border bg-bg-primary rounded-b-2xl shrink-0">
          <span className="text-sm text-text-secondary font-body">
            {validLines.length === 0
              ? "Choisissez au moins une couleur"
              : validLines.length === 1
                ? "Prêt à ajouter 1 couleur"
                : `Prêt à ajouter ${validLines.length} couleurs`}
          </span>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onClose} className="px-5 py-2 text-sm font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-xl hover:bg-bg-secondary transition-colors">Annuler</button>
            <button type="button" onClick={handleConfirm} disabled={!canConfirm} className="px-5 py-2 text-sm font-medium font-body text-text-inverse bg-bg-dark rounded-xl hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">Ajouter</button>
          </div>
        </div>
      </div>
      <QuickCreateSizeModal open={sizeQuickCreateOpen} onClose={() => setSizeQuickCreateOpen(false)} pfsSizes={pfsSizes} onCreated={handleQuickAddSizeCreated} />
    </div>
  );

  return typeof window !== "undefined" ? createPortal(modal, document.body) : null;
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export default function ColorVariantManager({
  variants, colorImages, availableColors, availableSizes, pfsSizes = [],
  onChange, onChangeImages, onQuickCreateColor, onColorAdded, onSizeAdded,
  variantErrors, productReference, sizeDetailsTu,
  primaryColorId, onChangePrimaryColorId,
}: Props) {
  /** Formate "Taille Unique"/"TU" → "TU 52-56" si sizeDetailsTu renseigné */
  const fmtSize = (name: string) => {
    if (!sizeDetailsTu) return name;
    const l = name.toLowerCase();
    return (l === "tu" || l === "taille unique") ? `TU ${sizeDetailsTu}` : name;
  };

  const { confirm: confirmDialog } = useConfirm();
  const [showImageModal, setShowImageModal] = useState(false);
  const [galleryState, setGalleryState] = useState<{ images: string[]; colorName: string; colorHex: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEdit, setBulkEdit] = useState<BulkEditState>(defaultBulkEdit());
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [sizeModalVariantId, setSizeModalVariantId] = useState<string | null>(null);
  const sizeModalVariant = variants.find((v) => v.tempId === sizeModalVariantId);
  const [packCompoVariantId, setPackCompoVariantId] = useState<string | null>(null);
  const packCompoVariant = variants.find((v) => v.tempId === packCompoVariantId);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const bulkActionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      const allSelected = selectedIds.size === variants.length && variants.length > 0;
      const someSelected = selectedIds.size > 0 && !allSelected;
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [selectedIds, variants.length]);

  useEffect(() => {
    if (!actionMenuId) return;
    function handleClick(e: MouseEvent) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [actionMenuId]);

  useEffect(() => {
    if (!bulkActionOpen) return;
    function handleClick(e: MouseEvent) {
      if (bulkActionRef.current && !bulkActionRef.current.contains(e.target as Node)) {
        setBulkActionOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [bulkActionOpen]);

  const totalPhotos = colorImages.reduce((s, c) => s + c.imagePreviews.length, 0);
  const hasAnyMissingImages = colorImages.some((c) => c.uploadedPaths.length === 0);
  const showBulkRow = selectedIds.size > 0;
  const duplicateTempIds = findDuplicateVariantTempIds(variants);

  function updateVariant(tempId: string, patch: Partial<VariantState>) {
    onChange(variants.map((v) => v.tempId === tempId ? { ...v, ...patch } : v));
  }

  /**
   * @deprecated Refonte couleurs : la couleur principale est désormais portée
   * par Product.primaryColorId, pas par la variante. Cette fonction n'est plus
   * appelée — la sélection passe par `onChangePrimaryColorId` (prop).
   * Conservée temporairement pour compat (champ `isPrimary` toujours présent dans
   * VariantState pour rétro-compat avec produits non encore migrés).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function setPrimary(tempId: string) {
    onChange(variants.map((v) => ({ ...v, isPrimary: v.tempId === tempId })));
  }

  function addVariant() {
    const def = defaultVariant();
    const isPrimary = variants.length === 0;
    onChange([...variants, { ...def, isPrimary }]);
  }

  function handleQuickAddConfirm(newVariants: VariantState[]) {
    if (variants.length === 0 && newVariants.length > 0) newVariants[0].isPrimary = true;
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

  function toggleVariantDisabled(tempId: string) {
    onChange(variants.map((v) => v.tempId === tempId ? { ...v, disabled: !v.disabled } : v));
  }

  function bulkToggleDisabled() {
    const selected = variants.filter((v) => selectedIds.has(v.tempId));
    const allDisabled = selected.every((v) => v.disabled);
    onChange(variants.map((v) => selectedIds.has(v.tempId) ? { ...v, disabled: !allDisabled } : v));
    setBulkActionOpen(false);
  }

  async function bulkRemove() {
    const count = selectedIds.size;
    const ok = await confirmDialog({
      title: "Supprimer les variantes ?",
      message: `Voulez-vous supprimer ${count} variante${count > 1 ? "s" : ""} ?`,
      confirmLabel: "Supprimer",
      type: "danger",
    });
    if (!ok) return;
    let newVariants = variants.filter((v) => !selectedIds.has(v.tempId));
    if (newVariants.length > 0 && !newVariants.some((v) => v.isPrimary)) {
      newVariants = newVariants.map((v, i) => ({ ...v, isPrimary: i === 0 }));
    }
    setSelectedIds(new Set());
    onChange(newVariants);
    setBulkActionOpen(false);
  }

  function handleColorChange(tempId: string, color: { colorId: string; colorName: string; colorHex: string } | null) {
    if (!color) {
      updateVariant(tempId, { colorId: "", colorName: "", colorHex: "#9CA3AF" });
      return;
    }
    onChange(variants.map((v) => {
      if (v.tempId !== tempId) return v;
      let next: VariantState = { ...v, colorId: color.colorId, colorName: color.colorName, colorHex: color.colorHex };
      if (isVariantPristine(v)) {
        const donor = findDonorVariant(next, variants);
        if (donor) next = applyDonorAutofill(next, donor, uid);
      }
      return next;
    }));
  }

  /** PACK : la cellule Couleur est multi-select. Chaque couleur choisie devient une packLine.
   *  Règle PFS : toutes les couleurs partagent les mêmes tailles. Une nouvelle couleur hérite
   *  des tailles communes existantes (qty=1 par défaut). Les quantités déjà saisies pour les
   *  couleurs préservées sont conservées. La 1ère couleur est aussi écrite dans
   *  colorId/colorName/colorHex pour le SKU et l'index images. */
  function handlePackColorsChange(tempId: string, colors: { colorId: string; colorName: string; colorHex: string }[]) {
    onChange(variants.map((v) => {
      if (v.tempId !== tempId) return v;

      // Tailles communes du paquet = union des tailles présentes dans les packLines actuelles.
      const commonSizes = new Map<string, { sizeId: string; sizeName: string }>();
      for (const l of v.packLines) {
        for (const s of l.sizeEntries) {
          if (!commonSizes.has(s.sizeId)) commonSizes.set(s.sizeId, { sizeId: s.sizeId, sizeName: s.sizeName });
        }
      }
      const commonList = [...commonSizes.values()];

      const newPackLines: PackLineState[] = colors.map((c) => {
        const existing = v.packLines.find((l) => l.colorId === c.colorId);
        if (existing) {
          // Couleur déjà présente : on conserve ses quantités, mais on s'assure qu'elle
          // a bien toutes les tailles communes (et seulement celles-ci).
          const byId = new Map(existing.sizeEntries.map((s) => [s.sizeId, s]));
          return {
            ...existing,
            colorName: c.colorName,
            colorHex: c.colorHex,
            sizeEntries: commonList.map((u) => {
              const prev = byId.get(u.sizeId);
              return prev
                ? { ...prev, tempId: prev.tempId || uid() }
                : { tempId: uid(), sizeId: u.sizeId, sizeName: u.sizeName, quantity: "1" };
            }),
          };
        }
        // Nouvelle couleur : hérite des tailles communes avec qty=1.
        return {
          tempId: uid(),
          colorId: c.colorId,
          colorName: c.colorName,
          colorHex: c.colorHex,
          sizeEntries: commonList.map((u) => ({
            tempId: uid(),
            sizeId: u.sizeId,
            sizeName: u.sizeName,
            quantity: "1",
          })),
        };
      });
      const first = colors[0];
      const totalQty = newPackLines.reduce(
        (s, l) => s + l.sizeEntries.reduce((a, e) => a + (parseInt(e.quantity) || 0), 0),
        0,
      );
      return {
        ...v,
        colorId: first?.colorId ?? "",
        colorName: first?.colorName ?? "",
        colorHex: first?.colorHex ?? "#9CA3AF",
        packLines: newPackLines,
        // Quand la composition change, on recalcule packQuantity à partir des lignes.
        packQuantity: totalQty > 0 ? String(totalQty) : v.packQuantity,
      };
    }));
  }

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

  function applyBulk() {
    if (selectedIds.size === 0) return;
    onChange(variants.map((v) => {
      if (!selectedIds.has(v.tempId)) return v;
      const patch: Partial<VariantState> = {};
      if (bulkEdit.unitPrice !== "") patch.unitPrice = bulkEdit.unitPrice;
      if (bulkEdit.weight !== "") patch.weight = bulkEdit.weight;
      if (bulkEdit.stock !== "") patch.stock = bulkEdit.stock;
      return { ...v, ...patch };
    }));
    setBulkEdit(defaultBulkEdit());
  }

  const sortedVariants = useMemo(() => {
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
    return [...unitVars, ...packs];
  }, [variants]);

  const savedVariants = useMemo(() => sortedVariants.filter((v) => !!v.dbId), [sortedVariants]);
  const newVariants = useMemo(() => sortedVariants.filter((v) => !v.dbId), [sortedVariants]);

  const displaySkuByTempId = useMemo(() => {
    const map = new Map<string, string>();
    const ref = (productReference ?? "").trim().toUpperCase();
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (v.sku) { map.set(v.tempId, v.sku); continue; }
      if (!ref || !v.colorId || !v.colorName) continue;
      const colorNames = isMultiColorPack(v)
        ? v.packLines.map((l) => l.colorName).filter(Boolean)
        : [v.colorName].filter(Boolean);
      map.set(v.tempId, generateSku(ref, colorNames, v.saleType, i + 1));
    }
    return map;
  }, [variants, productReference]);

  function renderSizeSummary(v: VariantState) {
    if (isMultiColorPack(v)) {
      const summary = v.packLines
        .map((l) => `${l.colorName}: ${l.sizeEntries.map((s) => `${fmtSize(s.sizeName)}×${s.quantity}`).join(", ")}`)
        .join(" | ");
      const aggregated = new Map<string, number>();
      const order: string[] = [];
      v.packLines.forEach((l) => {
        l.sizeEntries.forEach((s) => {
          const qty = parseInt(s.quantity) || 0;
          if (!aggregated.has(s.sizeName)) order.push(s.sizeName);
          aggregated.set(s.sizeName, (aggregated.get(s.sizeName) ?? 0) + qty);
        });
      });
      if (order.length === 0) return <span className="text-text-muted italic">—</span>;
      return (
        <span className="inline-flex items-center gap-1.5 flex-wrap" title={summary}>
          {order.map((name, i) => (
            <span key={`${name}-${i}`} className="inline-flex flex-col items-center leading-none gap-0.5">
              <span className="text-[10px] font-semibold text-text-primary">{fmtSize(name)}</span>
              <span className="text-[9px] text-text-muted">{aggregated.get(name)}</span>
            </span>
          ))}
        </span>
      );
    }
    if (v.sizeEntries.length === 0) return <span className="text-text-muted italic">—</span>;
    const entries = v.saleType === "UNIT"
      ? [{ sizeName: v.sizeEntries[0]?.sizeName ?? "", quantity: "1" }]
      : v.sizeEntries;
    const summary = entries.map((s) => `${fmtSize(s.sizeName)}×${s.quantity}`).join(", ");
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap" title={summary}>
        {entries.map((s, i) => (
          <span key={`${s.sizeName}-${i}`} className="inline-flex flex-col items-center leading-none gap-0.5">
            <span className="text-[10px] font-semibold text-text-primary">{fmtSize(s.sizeName)}</span>
            <span className="text-[9px] text-text-muted">{s.quantity}</span>
          </span>
        ))}
      </span>
    );
  }

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

  return (
    <div className="space-y-4">
      {variants.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-border text-text-muted text-sm font-body rounded-lg">
          Cliquez sur &ldquo;Ajouter une variante&rdquo; pour commencer.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Mobile cards — saved variants */}
          {savedVariants.length > 0 && (
          <div className="block md:hidden border border-border rounded-xl overflow-visible divide-y divide-[#F0F0F0]">
            <div className={`px-3 py-2 flex items-center gap-2 ${showBulkRow ? "bg-[#F0FDF4]" : "bg-[#FAFAFA]"}`}>
              <input type="checkbox"
                checked={selectedIds.size === variants.length && variants.length > 0}
                onChange={(e) => {
                  if (e.target.checked) setSelectedIds(new Set(variants.map((v) => v.tempId)));
                  else setSelectedIds(new Set());
                }}
                className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5 shrink-0" />
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
                  <button type="button" onClick={applyBulk} className="p-1 rounded text-[#16A34A] hover:bg-[#DCFCE7] transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <div className="relative" ref={bulkActionRef}>
                    <button type="button" onClick={() => setBulkActionOpen(!bulkActionOpen)}
                      className="px-2 py-0.5 text-[10px] font-medium font-body text-text-muted border border-border rounded hover:bg-bg-secondary transition-colors">
                      Action
                    </button>
                    {bulkActionOpen && (
                      <div className="absolute right-0 top-full mt-1 bg-bg-primary border border-border rounded-lg shadow-md z-50 min-w-[140px] py-1">
                        <button type="button" onClick={bulkToggleDisabled}
                          className="w-full text-left px-3 py-1.5 text-xs font-body hover:bg-bg-secondary transition-colors">
                          {variants.filter((v) => selectedIds.has(v.tempId)).every((v) => v.disabled) ? "Activer" : "Désactiver"}
                        </button>
                        <button type="button" onClick={bulkRemove}
                          className="w-full text-left px-3 py-1.5 text-xs font-body text-[#EF4444] hover:bg-[#FEF2F2] transition-colors">
                          Supprimer
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {savedVariants.map((v) => {
              const isSelected = selectedIds.has(v.tempId);
              const isDuplicate = duplicateTempIds.has(v.tempId);
              const vErrs = variantErrors?.get(v.tempId);
              const imgGk = imageGroupKeyFromVariant(v);
              const imgEntry = colorImages.find((c) => c.groupKey === imgGk);
              const imgCount = imgEntry?.uploadedPaths.length ?? 0;
              const locked = isVariantLocked(v);
              return (
                <div key={v.tempId} className={`p-3 space-y-2.5 ${isDuplicate ? "bg-[#FEF2F2]" : isSelected ? "bg-[#F0FDF4]" : ""}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={isSelected}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(v.tempId); else next.delete(v.tempId);
                        setSelectedIds(next);
                      }}
                      className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5 shrink-0" />
                    <span title={v.disabled ? "Désactivée" : "Active"}
                      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${v.disabled ? "bg-[#EF4444] animate-pulse" : "bg-[#22C55E] animate-pulse"}`} />
                    {locked && (
                      <span title={LOCKED_VARIANT_TOOLTIP} className="inline-flex items-center text-text-muted shrink-0" aria-label="Variante verrouillée">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c-1.105 0-2 .895-2 2v2a2 2 0 104 0v-2c0-1.105-.895-2-2-2zm6-3V7a6 6 0 10-12 0v1H4v12h16V8h-2zM8 7a4 4 0 118 0v1H8V7z" />
                        </svg>
                      </span>
                    )}
                    {locked ? (
                      <span className="inline-flex items-center px-2 py-1.5 text-xs font-body text-text-primary bg-bg-secondary rounded-md">
                        {v.saleType === "PACK" ? "Pack" : "Unité"}
                      </span>
                    ) : (
                    <div className={v.disabled ? "opacity-50" : ""}><CustomSelect
                      value={v.saleType}
                      onChange={(val) => {
                        if (val === "PACK" && v.saleType === "UNIT") {
                          const initialLine: PackLineState | null = v.colorId
                            ? {
                                tempId: uid(),
                                colorId: v.colorId,
                                colorName: v.colorName,
                                colorHex: v.colorHex,
                                sizeEntries: v.sizeEntries.map((se) => ({ ...se, tempId: uid() })),
                              }
                            : null;
                          const totalQty = initialLine
                            ? initialLine.sizeEntries.reduce((s, se) => s + (parseInt(se.quantity) || 0), 0)
                            : 0;
                          updateVariant(v.tempId, {
                            saleType: "PACK",
                            packLines: initialLine ? [initialLine] : [],
                            sizeEntries: [],
                            packQuantity: String(totalQty || 1),
                          });
                        } else if (val === "UNIT" && v.saleType === "PACK") {
                          if (v.packLines.length > 0) {
                            const [first] = v.packLines;
                            const restoredSizes = first.sizeEntries.slice(0, 1).map((se) => ({ ...se, tempId: uid() }));
                            updateVariant(v.tempId, {
                              saleType: "UNIT",
                              packQuantity: "",
                              colorId: first.colorId,
                              colorName: first.colorName,
                              colorHex: first.colorHex,
                              sizeEntries: restoredSizes,
                              packLines: [],
                            });
                          } else {
                            const restoredSizes = v.sizeEntries.slice(0, 1);
                            updateVariant(v.tempId, { saleType: "UNIT", packQuantity: "", sizeEntries: restoredSizes });
                          }
                        }
                      }}
                      options={[{ value: "UNIT", label: "Unité" }, { value: "PACK", label: "Pack" }]}
                      size="sm" className="w-[75px]" /></div>
                    )}
                    <div className="flex-1" />
                    <span title={imgCount === 0 ? "Aucune image" : `${imgCount} image${imgCount > 1 ? "s" : ""}`}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold font-body ${
                        imgCount === 0 ? "bg-[#FEE2E2] text-[#DC2626]" : "bg-bg-secondary text-text-muted"
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18a1.5 1.5 0 001.5-1.5V6A1.5 1.5 0 0021 4.5H3A1.5 1.5 0 001.5 6v13.5A1.5 1.5 0 003 21z" />
                      </svg>
                      {imgCount}/5
                    </span>
                    <div className="relative" ref={actionMenuId === v.tempId ? actionMenuRef : undefined}>
                      <button type="button" onClick={() => setActionMenuId(actionMenuId === v.tempId ? null : v.tempId)}
                        className="px-2 py-0.5 text-[10px] font-medium font-body text-text-muted border border-border rounded hover:bg-bg-secondary transition-colors">
                        Action
                      </button>
                      {actionMenuId === v.tempId && (
                        <div className="absolute right-0 top-full mt-1 bg-bg-primary border border-border rounded-lg shadow-md z-50 min-w-[140px] py-1">
                          <button type="button" onClick={() => { setActionMenuId(null); toggleVariantDisabled(v.tempId); }}
                            className="w-full text-left px-3 py-1.5 text-xs font-body hover:bg-bg-secondary transition-colors">
                            {v.disabled ? "Activer" : "Désactiver"}
                          </button>
                          <button type="button" onClick={() => { setActionMenuId(null); removeVariant(v.tempId); }}
                            className="w-full text-left px-3 py-1.5 text-xs font-body text-[#EF4444] hover:bg-[#FEF2F2] transition-colors">
                            Supprimer
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={v.disabled ? "opacity-50 space-y-2.5" : "space-y-2.5"}>
                    {(() => {
                      const dsku = displaySkuByTempId.get(v.tempId);
                      return dsku ? (
                        <div className="text-[10px] text-text-muted font-mono truncate" title={dsku}>SKU: {dsku}</div>
                      ) : null;
                    })()}

                    {locked ? (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg-secondary rounded-md min-h-[32px]" title={LOCKED_VARIANT_TOOLTIP}>
                        {v.saleType === "PACK" && v.packLines.length > 0 ? (
                          <span className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
                            {v.packLines.slice(0, 4).map((l) => {
                              const opt = availableColors.find((o) => o.id === l.colorId);
                              return (
                                <span key={l.colorId} className="inline-flex items-center gap-1 bg-bg-primary px-1.5 py-0.5 rounded-md text-[10px] border border-border-light">
                                  <ColorSwatch hex={l.colorHex} patternImage={opt?.patternImage ?? null} size={10} rounded="full" />
                                  <span className="truncate max-w-[60px]">{l.colorName}</span>
                                </span>
                              );
                            })}
                            {v.packLines.length > 4 && (
                              <span className="text-[10px] text-text-muted font-medium">+{v.packLines.length - 4}</span>
                            )}
                          </span>
                        ) : v.colorId ? (
                          <span className="flex items-center gap-1.5 flex-1 min-w-0">
                            <ColorSwatch hex={v.colorHex} patternImage={availableColors.find((o) => o.id === v.colorId)?.patternImage ?? null} size={14} rounded="full" />
                            <span className="truncate text-[11px] text-text-primary font-body">{v.colorName}</span>
                          </span>
                        ) : (
                          <span className="text-text-muted italic text-xs">—</span>
                        )}
                      </div>
                    ) : (
                    <div>
                    {v.saleType === "PACK" ? (
                      <MultiColorSelect
                        selected={v.packLines.length > 0
                          ? v.packLines.map((l) => ({ colorId: l.colorId, colorName: l.colorName, colorHex: l.colorHex }))
                          : (v.colorId ? [{ colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex }] : [])}
                        options={availableColors}
                        onChange={(colors) => { handlePackColorsChange(v.tempId, colors); }}
                        onCreateColor={onQuickCreateColor}
                        onColorAdded={onColorAdded}
                      />
                    ) : (
                      <SingleColorSelect
                        selected={v.colorId ? { colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex } : null}
                        options={availableColors}
                        onChange={(c) => { handleColorChange(v.tempId, c); }}
                        onCreateColor={onQuickCreateColor}
                        onColorAdded={onColorAdded}
                      />
                    )}
                    </div>
                    )}

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

                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-wider text-text-muted font-semibold mb-1 font-body">
                          {v.saleType === "PACK" ? "Composition" : "Tailles"}
                        </p>
                        {locked ? (
                          <div className="w-full flex items-center gap-1.5 bg-bg-secondary px-2 py-1.5 text-xs text-left rounded-md min-h-[30px]" title={LOCKED_VARIANT_TOOLTIP}>
                            {renderSizeSummary(v)}
                          </div>
                        ) : (
                        <button type="button"
                          onClick={() => {
                            if (v.saleType === "PACK") setPackCompoVariantId(v.tempId);
                            else setSizeModalVariantId(v.tempId);
                          }}
                          className={`w-full flex items-center gap-1.5 bg-bg-primary border ${vErrs?.has("sizes") ? "border-[#EF4444]" : "border-border"} px-2 py-1.5 text-xs text-left rounded-md transition-colors min-h-[30px] hover:border-[#9CA3AF]`}>
                          {renderSizeSummary(v)}
                          <svg className="w-3 h-3 text-text-muted shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        )}
                      </div>
                      <div className="shrink-0">
                        <p className="text-[9px] uppercase tracking-wider text-text-muted font-semibold mb-1 font-body">Total</p>
                        <div className="text-xs pt-1.5">{renderTotalPrice(v)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {/* Mobile — New variants section */}
          {newVariants.length > 0 && (
            <div className="block md:hidden border-2 border-dashed border-[#3B82F6]/40 rounded-xl overflow-visible divide-y divide-[#DBEAFE] bg-[#EFF6FF]/40">
              <div className="px-3 py-2 flex items-center gap-2 bg-[#DBEAFE]/50 rounded-t-xl">
                <svg className="w-3.5 h-3.5 text-[#3B82F6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span className="text-[10px] font-semibold font-body text-[#2563EB]">
                  {newVariants.length === 1 ? "Nouvelle variante" : `${newVariants.length} nouvelles variantes`} — en cours de création
                </span>
              </div>
              {newVariants.map((v) => {
              const isSelected = selectedIds.has(v.tempId);
              const isDuplicate = duplicateTempIds.has(v.tempId);
              const vErrs = variantErrors?.get(v.tempId);
              const imgGk = imageGroupKeyFromVariant(v);
              const imgEntry = colorImages.find((c) => c.groupKey === imgGk);
              const imgCount = imgEntry?.uploadedPaths.length ?? 0;
              const locked = isVariantLocked(v);
              return (
                <div key={v.tempId} className={`p-3 space-y-2.5 ${isDuplicate ? "bg-[#FEF2F2]" : isSelected ? "bg-[#EFF6FF]" : ""}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={isSelected}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(v.tempId); else next.delete(v.tempId);
                        setSelectedIds(next);
                      }}
                      className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5 shrink-0" />
                    <span title={v.disabled ? "Désactivée" : "Active"}
                      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${v.disabled ? "bg-[#EF4444] animate-pulse" : "bg-[#22C55E] animate-pulse"}`} />
                    {locked && (
                      <span title={LOCKED_VARIANT_TOOLTIP} className="inline-flex items-center text-text-muted shrink-0" aria-label="Variante verrouillée">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c-1.105 0-2 .895-2 2v2a2 2 0 104 0v-2c0-1.105-.895-2-2-2zm6-3V7a6 6 0 10-12 0v1H4v12h16V8h-2zM8 7a4 4 0 118 0v1H8V7z" />
                        </svg>
                      </span>
                    )}
                    {locked ? (
                      <span className="inline-flex items-center px-2 py-1.5 text-xs font-body text-text-primary bg-bg-secondary rounded-md">
                        {v.saleType === "PACK" ? "Pack" : "Unité"}
                      </span>
                    ) : (
                    <div className={v.disabled ? "opacity-50" : ""}><CustomSelect
                      value={v.saleType}
                      onChange={(val) => {
                        if (val === "PACK" && v.saleType === "UNIT") {
                          const initialLine: PackLineState | null = v.colorId
                            ? {
                                tempId: uid(),
                                colorId: v.colorId,
                                colorName: v.colorName,
                                colorHex: v.colorHex,
                                sizeEntries: v.sizeEntries.map((se) => ({ ...se, tempId: uid() })),
                              }
                            : null;
                          const totalQty = initialLine
                            ? initialLine.sizeEntries.reduce((s, se) => s + (parseInt(se.quantity) || 0), 0)
                            : 0;
                          updateVariant(v.tempId, {
                            saleType: "PACK",
                            packLines: initialLine ? [initialLine] : [],
                            sizeEntries: [],
                            packQuantity: String(totalQty || 1),
                          });
                        } else if (val === "UNIT" && v.saleType === "PACK") {
                          if (v.packLines.length > 0) {
                            const [first] = v.packLines;
                            const restoredSizes = first.sizeEntries.slice(0, 1).map((se) => ({ ...se, tempId: uid() }));
                            updateVariant(v.tempId, {
                              saleType: "UNIT",
                              packQuantity: "",
                              colorId: first.colorId,
                              colorName: first.colorName,
                              colorHex: first.colorHex,
                              sizeEntries: restoredSizes,
                              packLines: [],
                            });
                          } else {
                            const restoredSizes = v.sizeEntries.slice(0, 1);
                            updateVariant(v.tempId, { saleType: "UNIT", packQuantity: "", sizeEntries: restoredSizes });
                          }
                        }
                      }}
                      options={[{ value: "UNIT", label: "Unité" }, { value: "PACK", label: "Pack" }]}
                      size="sm" className="w-[75px]" /></div>
                    )}
                    <div className="flex-1" />
                    <span title={imgCount === 0 ? "Aucune image" : `${imgCount} image${imgCount > 1 ? "s" : ""}`}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold font-body ${
                        imgCount === 0 ? "bg-[#FEE2E2] text-[#DC2626]" : "bg-bg-secondary text-text-muted"
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18a1.5 1.5 0 001.5-1.5V6A1.5 1.5 0 0021 4.5H3A1.5 1.5 0 001.5 6v13.5A1.5 1.5 0 003 21z" />
                      </svg>
                      {imgCount}/5
                    </span>
                    <div className="relative" ref={actionMenuId === v.tempId ? actionMenuRef : undefined}>
                      <button type="button" onClick={() => setActionMenuId(actionMenuId === v.tempId ? null : v.tempId)}
                        className="px-2 py-0.5 text-[10px] font-medium font-body text-text-muted border border-border rounded hover:bg-bg-secondary transition-colors">
                        Action
                      </button>
                      {actionMenuId === v.tempId && (
                        <div className="absolute right-0 top-full mt-1 bg-bg-primary border border-border rounded-lg shadow-md z-50 min-w-[140px] py-1">
                          <button type="button" onClick={() => { setActionMenuId(null); toggleVariantDisabled(v.tempId); }}
                            className="w-full text-left px-3 py-1.5 text-xs font-body hover:bg-bg-secondary transition-colors">
                            {v.disabled ? "Activer" : "Désactiver"}
                          </button>
                          <button type="button" onClick={() => { setActionMenuId(null); removeVariant(v.tempId); }}
                            className="w-full text-left px-3 py-1.5 text-xs font-body text-[#EF4444] hover:bg-[#FEF2F2] transition-colors">
                            Supprimer
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={v.disabled ? "opacity-50 space-y-2.5" : "space-y-2.5"}>
                    {(() => {
                      const dsku = displaySkuByTempId.get(v.tempId);
                      return dsku ? (
                        <div className="text-[10px] text-text-muted font-mono truncate" title={dsku}>SKU: {dsku}</div>
                      ) : null;
                    })()}

                    {locked ? (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg-secondary rounded-md min-h-[32px]" title={LOCKED_VARIANT_TOOLTIP}>
                        {v.saleType === "PACK" && v.packLines.length > 0 ? (
                          <span className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
                            {v.packLines.slice(0, 4).map((l) => {
                              const opt = availableColors.find((o) => o.id === l.colorId);
                              return (
                                <span key={l.colorId} className="inline-flex items-center gap-1 bg-bg-primary px-1.5 py-0.5 rounded-md text-[10px] border border-border-light">
                                  <ColorSwatch hex={l.colorHex} patternImage={opt?.patternImage ?? null} size={10} rounded="full" />
                                  <span className="truncate max-w-[60px]">{l.colorName}</span>
                                </span>
                              );
                            })}
                            {v.packLines.length > 4 && (
                              <span className="text-[10px] text-text-muted font-medium">+{v.packLines.length - 4}</span>
                            )}
                          </span>
                        ) : v.colorId ? (
                          <span className="flex items-center gap-1.5 flex-1 min-w-0">
                            <ColorSwatch hex={v.colorHex} patternImage={availableColors.find((o) => o.id === v.colorId)?.patternImage ?? null} size={14} rounded="full" />
                            <span className="truncate text-[11px] text-text-primary font-body">{v.colorName}</span>
                          </span>
                        ) : (
                          <span className="text-text-muted italic text-xs">—</span>
                        )}
                      </div>
                    ) : (
                    <div>
                    {v.saleType === "PACK" ? (
                      <MultiColorSelect
                        selected={v.packLines.length > 0
                          ? v.packLines.map((l) => ({ colorId: l.colorId, colorName: l.colorName, colorHex: l.colorHex }))
                          : (v.colorId ? [{ colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex }] : [])}
                        options={availableColors}
                        onChange={(colors) => { handlePackColorsChange(v.tempId, colors); }}
                        onCreateColor={onQuickCreateColor}
                        onColorAdded={onColorAdded}
                      />
                    ) : (
                      <SingleColorSelect
                        selected={v.colorId ? { colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex } : null}
                        options={availableColors}
                        onChange={(c) => { handleColorChange(v.tempId, c); }}
                        onCreateColor={onQuickCreateColor}
                        onColorAdded={onColorAdded}
                      />
                    )}
                    </div>
                    )}

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

                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-wider text-text-muted font-semibold mb-1 font-body">
                          {v.saleType === "PACK" ? "Composition" : "Tailles"}
                        </p>
                        {locked ? (
                          <div className="w-full flex items-center gap-1.5 bg-bg-secondary px-2 py-1.5 text-xs text-left rounded-md min-h-[30px]" title={LOCKED_VARIANT_TOOLTIP}>
                            {renderSizeSummary(v)}
                          </div>
                        ) : (
                        <button type="button"
                          onClick={() => {
                            if (v.saleType === "PACK") setPackCompoVariantId(v.tempId);
                            else setSizeModalVariantId(v.tempId);
                          }}
                          className={`w-full flex items-center gap-1.5 bg-bg-primary border ${vErrs?.has("sizes") ? "border-[#EF4444]" : "border-border"} px-2 py-1.5 text-xs text-left rounded-md transition-colors min-h-[30px] hover:border-[#9CA3AF]`}>
                          {renderSizeSummary(v)}
                          <svg className="w-3 h-3 text-text-muted shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        )}
                      </div>
                      <div className="shrink-0">
                        <p className="text-[9px] uppercase tracking-wider text-text-muted font-semibold mb-1 font-body">Total</p>
                        <div className="text-xs pt-1.5">{renderTotalPrice(v)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          )}

          {/* Desktop table */}
          <div className="hidden md:block border border-border rounded-xl overflow-visible">
            <table className="w-full table-fixed text-xs font-body">
              <thead>
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
                  <th className="w-6 px-0 py-2 text-center" title="Statut"></th>
                  <th className="w-[78px] px-2 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted font-semibold">Type</th>
                  <th className="w-[20%] px-2 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted font-semibold">Couleur</th>
                  <th className="w-[11%] px-1 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted font-semibold">SKU</th>
                  <th className="w-[14%] px-1 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted font-semibold">Tailles</th>
                  <th className="w-[60px] px-1 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted font-semibold">Stock</th>
                  <th className="w-[62px] px-1 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted font-semibold">Poids</th>
                  <th className="w-[68px] px-1 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted font-semibold">Prix/u.</th>
                  <th className="w-[56px] px-1 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted font-semibold">Total</th>
                  <th className="w-[80px] px-1 py-2 text-center text-[10px] uppercase tracking-wider text-text-muted font-semibold">Actions</th>
                </tr>
                <tr className={`border-b transition-colors ${showBulkRow ? "bg-[#F0FDF4] border-[#BBF7D0]" : "bg-[#FAFAFA] border-border"}`}>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`text-[9px] font-semibold ${showBulkRow ? "text-[#16A34A]" : "text-[#D1D5DB]"}`}>
                      {showBulkRow ? selectedIds.size : "—"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5" colSpan={4}>
                    <span className={`text-[10px] font-body ${showBulkRow ? "text-[#16A34A] font-semibold" : "text-[#D1D5DB]"}`}>
                      {showBulkRow ? `${selectedIds.size} sélectionnée${selectedIds.size > 1 ? "s" : ""}` : "Modification en masse"}
                    </span>
                  </td>
                  <td className="px-1 py-1.5" />
                  <td className="px-1 py-1.5">
                    <input type="number" min="0" step="1" placeholder="Stock" value={bulkEdit.stock} disabled={!showBulkRow}
                      onChange={(e) => setBulkEdit((b) => ({ ...b, stock: e.target.value }))}
                      className={`w-full border px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-body ${
                        showBulkRow ? "border-[#86EFAC] bg-bg-primary" : "border-border bg-bg-secondary text-[#D1D5DB] cursor-not-allowed"
                      }`} />
                  </td>
                  <td className="px-1 py-1.5">
                    <input type="number" min="0" step="0.001" placeholder="Poids" value={bulkEdit.weight} disabled={!showBulkRow}
                      onChange={(e) => setBulkEdit((b) => ({ ...b, weight: e.target.value }))}
                      className={`w-full border px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-body ${
                        showBulkRow ? "border-[#86EFAC] bg-bg-primary" : "border-border bg-bg-secondary text-[#D1D5DB] cursor-not-allowed"
                      }`} />
                  </td>
                  <td className="px-1 py-1.5">
                    <input type="number" min="0" step="0.01" placeholder="Prix" value={bulkEdit.unitPrice} disabled={!showBulkRow}
                      onChange={(e) => setBulkEdit((b) => ({ ...b, unitPrice: e.target.value }))}
                      className={`w-full border px-1.5 py-1 text-xs text-right rounded-md focus:outline-none font-body ${
                        showBulkRow ? "border-[#86EFAC] bg-bg-primary" : "border-border bg-bg-secondary text-[#D1D5DB] cursor-not-allowed"
                      }`} />
                  </td>
                  <td className="px-1 py-1.5" />
                  <td className="px-1 py-1.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button type="button" onClick={applyBulk} disabled={!showBulkRow}
                        title="Appliquer en masse"
                        className={`p-1 rounded transition-colors ${showBulkRow ? "text-[#16A34A] hover:bg-[#DCFCE7]" : "text-[#D1D5DB] cursor-not-allowed"}`}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                      {showBulkRow && (
                        <div className="relative" ref={bulkActionRef}>
                          <button type="button" onClick={() => setBulkActionOpen(!bulkActionOpen)}
                            className="px-2 py-0.5 text-[10px] font-medium font-body text-text-muted border border-border rounded hover:bg-bg-secondary transition-colors">
                            Action
                          </button>
                          {bulkActionOpen && (
                            <div className="absolute right-0 top-full mt-1 bg-bg-primary border border-border rounded-lg shadow-md z-50 min-w-[140px] py-1">
                              <button type="button" onClick={bulkToggleDisabled}
                                className="w-full text-left px-3 py-1.5 text-xs font-body hover:bg-bg-secondary transition-colors">
                                {variants.filter((v) => selectedIds.has(v.tempId)).every((v) => v.disabled) ? "Activer" : "Désactiver"}
                              </button>
                              <button type="button" onClick={bulkRemove}
                                className="w-full text-left px-3 py-1.5 text-xs font-body text-[#EF4444] hover:bg-[#FEF2F2] transition-colors">
                                Supprimer
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              </thead>
              <tbody>
                {savedVariants.map((v) => {
                  const isSelected = selectedIds.has(v.tempId);
                  const isDuplicate = duplicateTempIds.has(v.tempId);
                  const vErrs = variantErrors?.get(v.tempId);
                  const imgGkD = imageGroupKeyFromVariant(v);
                  const imgEntryD = colorImages.find((c) => c.groupKey === imgGkD);
                  const imgCountD = imgEntryD?.uploadedPaths.length ?? 0;
                  const dimCls = v.disabled ? " opacity-50" : "";
                  const lockedD = isVariantLocked(v);
                  return (
                    <tr key={v.tempId}
                      className={`border-b border-border-light last:border-b-0 transition-colors ${
                        isDuplicate ? "bg-[#FEF2F2]" : isSelected ? "bg-[#F0FDF4]" : "hover:bg-[#FAFAFA]"
                      }`}
                    >
                      <td className={`px-2 py-2 text-center${dimCls}`}>
                        <input type="checkbox" checked={isSelected}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(v.tempId); else next.delete(v.tempId);
                            setSelectedIds(next);
                          }}
                          className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5" />
                      </td>
                      <td className="px-0 py-2 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span title={v.disabled ? "Désactivée" : "Active"}
                            className={`inline-block w-2.5 h-2.5 rounded-full ${v.disabled ? "bg-[#EF4444] animate-pulse" : "bg-[#22C55E] animate-pulse"}`} />
                          {lockedD && (
                            <span title={LOCKED_VARIANT_TOOLTIP} className="inline-flex items-center text-text-muted" aria-label="Variante verrouillée">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c-1.105 0-2 .895-2 2v2a2 2 0 104 0v-2c0-1.105-.895-2-2-2zm6-3V7a6 6 0 10-12 0v1H4v12h16V8h-2zM8 7a4 4 0 118 0v1H8V7z" />
                              </svg>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`px-2 py-2${dimCls}`} title={lockedD ? LOCKED_VARIANT_TOOLTIP : undefined}>
                        {lockedD ? (
                          <span className="inline-flex items-center px-2 py-1.5 text-xs font-body text-text-primary bg-bg-secondary rounded-md w-[72px]">
                            {v.saleType === "PACK" ? "Pack" : "Unité"}
                          </span>
                        ) : (
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
                          size="sm" className="w-[72px]" />
                        )}
                      </td>
                      <td className={`px-2 py-2${dimCls}`}>
                        {lockedD ? (
                          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg-secondary rounded-md min-h-[32px]" title={LOCKED_VARIANT_TOOLTIP}>
                            {v.saleType === "PACK" && v.packLines.length > 0 ? (
                              <span className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
                                {v.packLines.slice(0, 4).map((l) => {
                                  const opt = availableColors.find((o) => o.id === l.colorId);
                                  return (
                                    <span key={l.colorId} className="inline-flex items-center gap-1 bg-bg-primary px-1.5 py-0.5 rounded-md text-[10px] border border-border-light">
                                      <ColorSwatch hex={l.colorHex} patternImage={opt?.patternImage ?? null} size={10} rounded="full" />
                                      <span className="truncate max-w-[60px]">{l.colorName}</span>
                                    </span>
                                  );
                                })}
                                {v.packLines.length > 4 && (
                                  <span className="text-[10px] text-text-muted font-medium">+{v.packLines.length - 4}</span>
                                )}
                              </span>
                            ) : v.colorId ? (
                              <span className="flex items-center gap-1.5 flex-1 min-w-0">
                                <ColorSwatch hex={v.colorHex} patternImage={availableColors.find((o) => o.id === v.colorId)?.patternImage ?? null} size={14} rounded="full" />
                                <span className="truncate text-[11px] text-text-primary font-body">{v.colorName}</span>
                              </span>
                            ) : (
                              <span className="text-text-muted italic text-xs">—</span>
                            )}
                          </div>
                        ) : (
                        <div>
                        {v.saleType === "PACK" ? (
                          <MultiColorSelect
                            selected={v.packLines.length > 0
                              ? v.packLines.map((l) => ({ colorId: l.colorId, colorName: l.colorName, colorHex: l.colorHex }))
                              : (v.colorId ? [{ colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex }] : [])}
                            options={availableColors}
                            onChange={(colors) => { handlePackColorsChange(v.tempId, colors); }}
                            onCreateColor={onQuickCreateColor}
                            onColorAdded={onColorAdded}
                          />
                        ) : (
                          <SingleColorSelect
                            selected={v.colorId ? { colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex } : null}
                            options={availableColors}
                            onChange={(c) => { handleColorChange(v.tempId, c); }}
                            onCreateColor={onQuickCreateColor}
                            onColorAdded={onColorAdded}
                          />
                        )}
                        </div>
                        )}
                      </td>
                      <td className={`px-1 py-2${dimCls}`}>
                        {(() => {
                          const dsku = displaySkuByTempId.get(v.tempId) || "—";
                          return <span className="text-[10px] text-text-muted font-mono truncate block" title={dsku}>{dsku}</span>;
                        })()}
                      </td>
                      <td className={`px-1 py-2${dimCls}`}>
                        {lockedD ? (
                          <div className="w-full flex items-center gap-1.5 bg-bg-secondary px-2 py-1.5 text-xs text-left rounded-md min-h-[30px]" title={LOCKED_VARIANT_TOOLTIP}>
                            {renderSizeSummary(v)}
                          </div>
                        ) : (
                        <button type="button"
                          onClick={() => {
                            if (v.saleType === "PACK") setPackCompoVariantId(v.tempId);
                            else setSizeModalVariantId(v.tempId);
                          }}
                          className={`w-full flex items-center gap-1.5 bg-bg-primary border ${vErrs?.has("sizes") ? "border-[#EF4444]" : "border-border"} px-2 py-1.5 text-xs text-left rounded-md transition-colors min-h-[30px] hover:border-[#9CA3AF]`}
                          title={v.saleType === "PACK"
                            ? (isMultiColorPack(v)
                                ? v.packLines.map((l) => `${l.colorName}: ${l.sizeEntries.map((s) => `${fmtSize(s.sizeName)}×${s.quantity}`).join(", ")}`).join(" | ")
                                : "Définir la composition du paquet")
                            : (v.sizeEntries.length > 0 ? v.sizeEntries.map((s) => `${fmtSize(s.sizeName)}×${s.quantity}`).join(", ") : "Ajouter des tailles")}
                        >
                          {renderSizeSummary(v)}
                          <svg className="w-3 h-3 text-text-muted shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        )}
                      </td>
                      <td className={`px-1 py-2${dimCls}`}>
                        <input type="number" min="0" step="1" value={v.stock} placeholder="0"
                          onChange={(e) => updateVariant(v.tempId, { stock: e.target.value })}
                          className={`w-full border ${vErrs?.has("stock") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-1.5 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`} />
                      </td>
                      <td className={`px-1 py-2${dimCls}`}>
                        <input type="number" min="0" step="0.001" value={v.weight} placeholder="0.000"
                          onChange={(e) => updateVariant(v.tempId, { weight: e.target.value })}
                          className={`w-full border ${vErrs?.has("weight") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-1.5 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`} />
                      </td>
                      <td className={`px-1 py-2${dimCls}`}>
                        <input type="number" min="0" step="0.01" value={v.unitPrice} placeholder="0.00"
                          onChange={(e) => updateVariant(v.tempId, { unitPrice: e.target.value })}
                          className={`w-full border ${vErrs?.has("price") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-1.5 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`} />
                      </td>
                      <td className={`px-1 py-2 text-right text-xs${dimCls}`}>{renderTotalPrice(v)}</td>
                      <td className="px-1 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span title={imgCountD === 0 ? "Aucune image" : `${imgCountD} image${imgCountD > 1 ? "s" : ""}`}
                            className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold font-body ${
                              imgCountD === 0 ? "bg-[#FEE2E2] text-[#DC2626]" : "text-text-muted"
                            }`}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18a1.5 1.5 0 001.5-1.5V6A1.5 1.5 0 0021 4.5H3A1.5 1.5 0 001.5 6v13.5A1.5 1.5 0 003 21z" />
                            </svg>
                            {imgCountD}
                          </span>
                          <div className="relative" ref={actionMenuId === v.tempId ? actionMenuRef : undefined}>
                            <button type="button" onClick={() => setActionMenuId(actionMenuId === v.tempId ? null : v.tempId)}
                              className="px-2 py-0.5 text-[10px] font-medium font-body text-text-muted border border-border rounded hover:bg-bg-secondary transition-colors">
                              Action
                            </button>
                            {actionMenuId === v.tempId && (
                              <div className="absolute right-0 top-full mt-1 bg-bg-primary border border-border rounded-lg shadow-md z-50 min-w-[140px] py-1">
                                <button type="button" onClick={() => { setActionMenuId(null); toggleVariantDisabled(v.tempId); }}
                                  className="w-full text-left px-3 py-1.5 text-xs font-body hover:bg-bg-secondary transition-colors">
                                  {v.disabled ? "Activer" : "Désactiver"}
                                </button>
                                <button type="button" onClick={() => { setActionMenuId(null); removeVariant(v.tempId); }}
                                  className="w-full text-left px-3 py-1.5 text-xs font-body text-[#EF4444] hover:bg-[#FEF2F2] transition-colors">
                                  Supprimer
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* New variants separator + rows */}
                {newVariants.length > 0 && (
                  <tr>
                    <td colSpan={11} className="px-0 py-0">
                      <div className="flex items-center gap-2 px-3 py-2 bg-[#DBEAFE]/60 border-y-2 border-dashed border-[#3B82F6]/40">
                        <svg className="w-3.5 h-3.5 text-[#3B82F6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        <span className="text-[10px] font-semibold font-body text-[#2563EB]">
                          {newVariants.length === 1 ? "Nouvelle variante" : `${newVariants.length} nouvelles variantes`} — en cours de création
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {newVariants.map((v) => {
                  const isSelected = selectedIds.has(v.tempId);
                  const isDuplicate = duplicateTempIds.has(v.tempId);
                  const vErrs = variantErrors?.get(v.tempId);
                  const imgGkD = imageGroupKeyFromVariant(v);
                  const imgEntryD = colorImages.find((c) => c.groupKey === imgGkD);
                  const imgCountD = imgEntryD?.uploadedPaths.length ?? 0;
                  const dimCls = v.disabled ? " opacity-50" : "";
                  const lockedD = isVariantLocked(v);
                  return (
                    <tr key={v.tempId}
                      className={`border-b border-border-light last:border-b-0 transition-colors ${
                        isDuplicate ? "bg-[#FEF2F2]" : isSelected ? "bg-[#EFF6FF]" : "bg-[#EFF6FF]/30 hover:bg-[#EFF6FF]/60"
                      }`}
                    >
                      <td className={`px-2 py-2 text-center${dimCls}`}>
                        <input type="checkbox" checked={isSelected}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(v.tempId); else next.delete(v.tempId);
                            setSelectedIds(next);
                          }}
                          className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5" />
                      </td>
                      <td className="px-0 py-2 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span title={v.disabled ? "Désactivée" : "Active"}
                            className={`inline-block w-2.5 h-2.5 rounded-full ${v.disabled ? "bg-[#EF4444] animate-pulse" : "bg-[#22C55E] animate-pulse"}`} />
                          {lockedD && (
                            <span title={LOCKED_VARIANT_TOOLTIP} className="inline-flex items-center text-text-muted" aria-label="Variante verrouillée">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c-1.105 0-2 .895-2 2v2a2 2 0 104 0v-2c0-1.105-.895-2-2-2zm6-3V7a6 6 0 10-12 0v1H4v12h16V8h-2zM8 7a4 4 0 118 0v1H8V7z" />
                              </svg>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`px-2 py-2${dimCls}`} title={lockedD ? LOCKED_VARIANT_TOOLTIP : undefined}>
                        {lockedD ? (
                          <span className="inline-flex items-center px-2 py-1.5 text-xs font-body text-text-primary bg-bg-secondary rounded-md w-[72px]">
                            {v.saleType === "PACK" ? "Pack" : "Unité"}
                          </span>
                        ) : (
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
                          size="sm" className="w-[72px]" />
                        )}
                      </td>
                      <td className={`px-2 py-2${dimCls}`}>
                        {lockedD ? (
                          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg-secondary rounded-md min-h-[32px]" title={LOCKED_VARIANT_TOOLTIP}>
                            {v.saleType === "PACK" && v.packLines.length > 0 ? (
                              <span className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
                                {v.packLines.slice(0, 4).map((l) => {
                                  const opt = availableColors.find((o) => o.id === l.colorId);
                                  return (
                                    <span key={l.colorId} className="inline-flex items-center gap-1 bg-bg-primary px-1.5 py-0.5 rounded-md text-[10px] border border-border-light">
                                      <ColorSwatch hex={l.colorHex} patternImage={opt?.patternImage ?? null} size={10} rounded="full" />
                                      <span className="truncate max-w-[60px]">{l.colorName}</span>
                                    </span>
                                  );
                                })}
                                {v.packLines.length > 4 && (
                                  <span className="text-[10px] text-text-muted font-medium">+{v.packLines.length - 4}</span>
                                )}
                              </span>
                            ) : v.colorId ? (
                              <span className="flex items-center gap-1.5 flex-1 min-w-0">
                                <ColorSwatch hex={v.colorHex} patternImage={availableColors.find((o) => o.id === v.colorId)?.patternImage ?? null} size={14} rounded="full" />
                                <span className="truncate text-[11px] text-text-primary font-body">{v.colorName}</span>
                              </span>
                            ) : (
                              <span className="text-text-muted italic text-xs">—</span>
                            )}
                          </div>
                        ) : (
                        <div>
                        {v.saleType === "PACK" ? (
                          <MultiColorSelect
                            selected={v.packLines.length > 0
                              ? v.packLines.map((l) => ({ colorId: l.colorId, colorName: l.colorName, colorHex: l.colorHex }))
                              : (v.colorId ? [{ colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex }] : [])}
                            options={availableColors}
                            onChange={(colors) => { handlePackColorsChange(v.tempId, colors); }}
                            onCreateColor={onQuickCreateColor}
                            onColorAdded={onColorAdded}
                          />
                        ) : (
                          <SingleColorSelect
                            selected={v.colorId ? { colorId: v.colorId, colorName: v.colorName, colorHex: v.colorHex } : null}
                            options={availableColors}
                            onChange={(c) => { handleColorChange(v.tempId, c); }}
                            onCreateColor={onQuickCreateColor}
                            onColorAdded={onColorAdded}
                          />
                        )}
                        </div>
                        )}
                      </td>
                      <td className={`px-1 py-2${dimCls}`}>
                        {(() => {
                          const dsku = displaySkuByTempId.get(v.tempId) || "—";
                          return <span className="text-[10px] text-text-muted font-mono truncate block" title={dsku}>{dsku}</span>;
                        })()}
                      </td>
                      <td className={`px-1 py-2${dimCls}`}>
                        {lockedD ? (
                          <div className="w-full flex items-center gap-1.5 bg-bg-secondary px-2 py-1.5 text-xs text-left rounded-md min-h-[30px]" title={LOCKED_VARIANT_TOOLTIP}>
                            {renderSizeSummary(v)}
                          </div>
                        ) : (
                        <button type="button"
                          onClick={() => {
                            if (v.saleType === "PACK") setPackCompoVariantId(v.tempId);
                            else setSizeModalVariantId(v.tempId);
                          }}
                          className={`w-full flex items-center gap-1.5 bg-bg-primary border ${vErrs?.has("sizes") ? "border-[#EF4444]" : "border-border"} px-2 py-1.5 text-xs text-left rounded-md transition-colors min-h-[30px] hover:border-[#9CA3AF]`}
                          title={v.saleType === "PACK"
                            ? (isMultiColorPack(v)
                                ? v.packLines.map((l) => `${l.colorName}: ${l.sizeEntries.map((s) => `${fmtSize(s.sizeName)}×${s.quantity}`).join(", ")}`).join(" | ")
                                : "Définir la composition du paquet")
                            : (v.sizeEntries.length > 0 ? v.sizeEntries.map((s) => `${fmtSize(s.sizeName)}×${s.quantity}`).join(", ") : "Ajouter des tailles")}
                        >
                          {renderSizeSummary(v)}
                          <svg className="w-3 h-3 text-text-muted shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        )}
                      </td>
                      <td className={`px-1 py-2${dimCls}`}>
                        <input type="number" min="0" step="1" value={v.stock} placeholder="0"
                          onChange={(e) => updateVariant(v.tempId, { stock: e.target.value })}
                          className={`w-full border ${vErrs?.has("stock") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-1.5 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`} />
                      </td>
                      <td className={`px-1 py-2${dimCls}`}>
                        <input type="number" min="0" step="0.001" value={v.weight} placeholder="0.000"
                          onChange={(e) => updateVariant(v.tempId, { weight: e.target.value })}
                          className={`w-full border ${vErrs?.has("weight") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-1.5 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`} />
                      </td>
                      <td className={`px-1 py-2${dimCls}`}>
                        <input type="number" min="0" step="0.01" value={v.unitPrice} placeholder="0.00"
                          onChange={(e) => updateVariant(v.tempId, { unitPrice: e.target.value })}
                          className={`w-full border ${vErrs?.has("price") ? "border-[#EF4444]" : "border-border"} bg-bg-primary px-1.5 py-1.5 text-xs text-right rounded-md focus:outline-none focus:border-[#1A1A1A] font-body`} />
                      </td>
                      <td className={`px-1 py-2 text-right text-xs${dimCls}`}>{renderTotalPrice(v)}</td>
                      <td className="px-1 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span title={imgCountD === 0 ? "Aucune image" : `${imgCountD} image${imgCountD > 1 ? "s" : ""}`}
                            className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold font-body ${
                              imgCountD === 0 ? "bg-[#FEE2E2] text-[#DC2626]" : "text-text-muted"
                            }`}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18a1.5 1.5 0 001.5-1.5V6A1.5 1.5 0 0021 4.5H3A1.5 1.5 0 001.5 6v13.5A1.5 1.5 0 003 21z" />
                            </svg>
                            {imgCountD}
                          </span>
                          <div className="relative" ref={actionMenuId === v.tempId ? actionMenuRef : undefined}>
                            <button type="button" onClick={() => setActionMenuId(actionMenuId === v.tempId ? null : v.tempId)}
                              className="px-2 py-0.5 text-[10px] font-medium font-body text-text-muted border border-border rounded hover:bg-bg-secondary transition-colors">
                              Action
                            </button>
                            {actionMenuId === v.tempId && (
                              <div className="absolute right-0 top-full mt-1 bg-bg-primary border border-border rounded-lg shadow-md z-50 min-w-[140px] py-1">
                                <button type="button" onClick={() => { setActionMenuId(null); toggleVariantDisabled(v.tempId); }}
                                  className="w-full text-left px-3 py-1.5 text-xs font-body hover:bg-bg-secondary transition-colors">
                                  {v.disabled ? "Activer" : "Désactiver"}
                                </button>
                                <button type="button" onClick={() => { setActionMenuId(null); removeVariant(v.tempId); }}
                                  className="w-full text-left px-3 py-1.5 text-xs font-body text-[#EF4444] hover:bg-[#FEF2F2] transition-colors">
                                  Supprimer
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {duplicateTempIds.size > 0 && (
            <div className="px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg flex items-center gap-2">
              <svg className="w-4 h-4 text-[#EF4444] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs text-[#EF4444] font-body">
                Doublon détecté : même type, même couleur et mêmes tailles/quantités.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button type="button" onClick={addVariant}
            className="flex-1 border-2 border-dashed border-border py-3 text-sm font-body text-text-secondary hover:border-bg-dark hover:bg-bg-secondary transition-colors flex items-center justify-center gap-2 rounded-lg">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Ajouter une variante
          </button>
          <button type="button" onClick={() => setShowQuickAdd(true)}
            className="flex-1 border-2 border-dashed border-border py-3 text-sm font-body text-text-secondary hover:border-bg-dark hover:bg-bg-secondary transition-colors flex items-center justify-center gap-2 rounded-lg">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
            Création rapide
          </button>
        </div>
        {variants.length > 0 && (
          <button type="button" onClick={() => setShowImageModal(true)}
            className={`w-full border-2 border-dashed py-3 text-sm font-body transition-colors flex items-center justify-center gap-2 rounded-lg ${
              hasAnyMissingImages ? "border-[#EF4444] text-[#EF4444] hover:border-red-400 hover:bg-red-50/50" : "border-border text-text-secondary hover:border-bg-dark hover:bg-bg-secondary"
            }`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            Gérer les images ({totalPhotos} photo{totalPhotos !== 1 ? "s" : ""})
          </button>
        )}
      </div>

      <ImageGalleryModal
        key={galleryState?.colorName ?? ""}
        open={galleryState !== null}
        onClose={() => setGalleryState(null)}
        images={galleryState?.images ?? []}
        colorName={galleryState?.colorName ?? ""}
        colorHex={galleryState?.colorHex ?? "#9CA3AF"}
      />

      <ImageManagerModal
        open={showImageModal}
        onClose={() => setShowImageModal(false)}
        colorImages={colorImages}
        onChange={onChangeImages}
        variants={variants}
        availableColors={availableColors}
        primaryColorId={primaryColorId}
        onChangePrimaryColorId={onChangePrimaryColorId}
      />

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

      {packCompoVariant && (
        <PackCompositionModal
          open={!!packCompoVariantId}
          onClose={() => setPackCompoVariantId(null)}
          initialLines={packCompoVariant.packLines.length > 0
            ? packCompoVariant.packLines
            : (packCompoVariant.colorId
                ? [{
                    tempId: uid(),
                    colorId: packCompoVariant.colorId,
                    colorName: packCompoVariant.colorName,
                    colorHex: packCompoVariant.colorHex,
                    sizeEntries: packCompoVariant.sizeEntries.map((se) => ({ ...se, tempId: uid() })),
                  }]
                : [])}
          availableSizes={availableSizes}
          onSave={(lines) => {
            const total = lines.reduce((s, l) => s + l.sizeEntries.reduce((a, e) => a + (parseInt(e.quantity) || 0), 0), 0);
            const firstLine = lines[0];
            updateVariant(packCompoVariant.tempId, {
              packLines: lines,
              packQuantity: String(total),
              sizeEntries: [],
              colorId: firstLine?.colorId || packCompoVariant.colorId,
              colorName: firstLine?.colorName || packCompoVariant.colorName,
              colorHex: firstLine?.colorHex || packCompoVariant.colorHex,
            });
          }}
        />
      )}

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
