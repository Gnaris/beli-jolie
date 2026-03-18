"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import ImageDropzone from "./ImageDropzone";

// ─────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────

export interface VariantState {
  tempId: string;
  dbId?: string;           // ProductColor.id when editing
  colorId: string;
  colorName: string;
  colorHex: string;
  unitPrice: string;
  weight: string;
  stock: string;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: string;    // "" if UNIT
  size: string;
  discountType: "" | "PERCENT" | "AMOUNT";
  discountValue: string;
}

export interface ColorImageState {
  colorId: string;
  colorName: string;
  colorHex: string;
  imagePreviews: string[];
  uploadedPaths: string[];
  uploading: boolean;
}

export interface AvailableColor {
  id: string;
  name: string;
  hex: string | null;
}

interface Props {
  variants: VariantState[];
  colorImages: ColorImageState[];
  availableColors: AvailableColor[];
  onChange: (variants: VariantState[]) => void;
  onChangeImages: (images: ColorImageState[]) => void;
  onQuickCreateColor?: (name: string, hex: string | null) => Promise<AvailableColor>;
}

// ─────────────────────────────────────────────
// Price helpers (exported for reuse in ProductForm)
// ─────────────────────────────────────────────

export function computeTotalPrice(v: VariantState): number | null {
  const unit = parseFloat(v.unitPrice);
  if (isNaN(unit) || unit <= 0) return null;
  if (v.saleType === "UNIT") return unit;
  const qty = parseInt(v.packQuantity);
  if (isNaN(qty) || qty <= 0) return null;
  return unit * qty;
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

function defaultVariant(availableColors: AvailableColor[]): VariantState {
  const first = availableColors[0];
  return {
    tempId:       uid(),
    colorId:      first?.id   ?? "",
    colorName:    first?.name ?? "",
    colorHex:     first?.hex  ?? "#9CA3AF",
    unitPrice:    "",
    weight:       "",
    stock:        "",
    isPrimary:    false,
    saleType:     "UNIT",
    packQuantity: "",
    size:         "",
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
  applyType:    boolean;
  saleType:     "UNIT" | "PACK";
  packQuantity: string;
  size:         string;
  discountType: "" | "PERCENT" | "AMOUNT";
  discountValue: string;
}

function defaultBulkEdit(): BulkEditState {
  return { unitPrice: "", weight: "", stock: "", applyType: false, saleType: "UNIT", packQuantity: "", size: "", discountType: "", discountValue: "" };
}

// ─────────────────────────────────────────────
// ColorSelect dropdown (portal-based, escapes overflow)
// ─────────────────────────────────────────────
function ColorSelect({ value, options, onChange }: {
  value: string; options: AvailableColor[]; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => { setOpen(false); setSearch(""); }, []);

  // Position the portal dropdown under the trigger button
  const openDropdown = useCallback(() => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: Math.max(r.width, 180) });
    }
    setOpen(true);
  }, []);

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    function onMouse(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      const portal = document.getElementById("color-select-portal");
      if (portal?.contains(target)) return;
      close();
    }
    function onScroll() { close(); }
    document.addEventListener("mousedown", onMouse);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  // Auto-focus search when open
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 10);
  }, [open]);

  const sel = options.find((o) => o.id === value);
  const filtered = search.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  return (
    <div className="relative" style={{ minWidth: 140 }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => open ? close() : openDropdown()}
        className="w-full flex items-center gap-1.5 bg-white border border-[#E5E5E5] px-2.5 py-2 text-xs font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] hover:border-[#9CA3AF] transition-colors text-left"
      >
        <span className="w-3.5 h-3.5 rounded-full border border-[#E5E5E5] shrink-0" style={{ backgroundColor: sel?.hex || "#9CA3AF" }} />
        <span className="flex-1 truncate">{sel ? sel.name : <span className="text-[#9CA3AF]">—</span>}</span>
        <svg className={`w-3 h-3 text-[#9CA3AF] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          id="color-select-portal"
          className="bg-white border border-[#E5E5E5] shadow-xl rounded"
          style={{ position: "absolute", top: pos.top, left: pos.left, width: pos.width, zIndex: 9000 }}
        >
          {/* Search bar */}
          <div className="px-2 py-1.5 border-b border-[#E5E5E5]">
            <div className="flex items-center gap-1.5 bg-[#F7F7F8] border border-[#E5E5E5] px-2 py-1 rounded">
              <svg className="w-3 h-3 text-[#9CA3AF] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..."
                className="flex-1 bg-transparent text-xs text-[#1A1A1A] placeholder-[#9CA3AF] outline-none min-w-0"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="text-[#9CA3AF] hover:text-[#1A1A1A]">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          {/* Options list */}
          <div className="max-h-44 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[#9CA3AF]">Aucun résultat</div>
            ) : filtered.map((opt) => (
              <button key={opt.id} type="button"
                onClick={() => { onChange(opt.id); close(); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[#F7F7F8] transition-colors text-left ${opt.id === value ? "bg-[#F7F7F8]" : ""}`}
              >
                <span className="w-3.5 h-3.5 rounded-full border border-[#E5E5E5] shrink-0" style={{ backgroundColor: opt.hex || "#9CA3AF" }} />
                <span className="flex-1 font-[family-name:var(--font-roboto)] text-[#1A1A1A]">{opt.name}</span>
                {opt.id === value && (
                  <svg className="w-3 h-3 text-[#1A1A1A] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Validation: find duplicate variant keys
// ─────────────────────────────────────────────
function findInvalidVariantTempIds(variants: VariantState[]): Set<string> {
  const invalid = new Set<string>();
  // Duplicate UNIT per colorId
  const unitSeen = new Map<string, string>(); // colorId -> tempId
  for (const v of variants) {
    if (v.saleType === "UNIT") {
      if (unitSeen.has(v.colorId)) {
        invalid.add(v.tempId);
        const prev = unitSeen.get(v.colorId)!;
        invalid.add(prev);
      } else {
        unitSeen.set(v.colorId, v.tempId);
      }
    }
  }
  // Duplicate PACK per colorId + packQuantity + size (same pack qty OK if different size)
  const packSeen = new Map<string, string>(); // key -> tempId
  for (const v of variants) {
    if (v.saleType === "PACK" && v.packQuantity) {
      const key = `${v.colorId}__${v.packQuantity}__${v.size.trim().toLowerCase()}`;
      if (packSeen.has(key)) {
        invalid.add(v.tempId);
        const prev = packSeen.get(key)!;
        invalid.add(prev);
      } else {
        packSeen.set(key, v.tempId);
      }
    }
  }
  return invalid;
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
  onSetPrimary: (colorId: string) => void;
}

function ImageManagerModal({ open, onClose, colorImages, onChange, variants, onSetPrimary }: ImageManagerModalProps) {
  const colorImagesRef = useRef(colorImages);
  colorImagesRef.current = colorImages;

  async function handleAddImages(colorId: string, files: File[]) {
    const state = colorImagesRef.current.find((c) => c.colorId === colorId);
    if (!state) return;
    const blobs = files.map((f) => URL.createObjectURL(f));
    onChange(colorImagesRef.current.map((c) => c.colorId === colorId
      ? { ...c, imagePreviews: [...c.imagePreviews, ...blobs], uploading: true }
      : c
    ));
    const paths: string[] = [];
    for (const file of files) {
      const fd = new FormData(); fd.append("image", file);
      try {
        const res = await fetch("/api/admin/products/images", { method: "POST", body: fd });
        const json = await res.json();
        if (res.ok) paths.push(json.path);
      } catch { console.error("Erreur upload"); }
    }
    onChange(colorImagesRef.current.map((c) => c.colorId === colorId
      ? { ...c, uploadedPaths: [...c.uploadedPaths, ...paths], uploading: false }
      : c
    ));
  }

  function handleRemoveImage(colorId: string, i: number) {
    if (!window.confirm("Supprimer cette image ?")) return;
    onChange(colorImages.map((c) => c.colorId !== colorId ? c : {
      ...c,
      imagePreviews: c.imagePreviews.filter((_, j) => j !== i),
      uploadedPaths: c.uploadedPaths.filter((_, j) => j !== i),
    }));
  }

  function handleReorderImage(colorId: string, from: number, to: number) {
    onChange(colorImages.map((c) => {
      if (c.colorId !== colorId) return c;
      const reorder = <T,>(arr: T[]): T[] => {
        const r = [...arr]; const [item] = r.splice(from, 1); r.splice(to, 0, item); return r;
      };
      return { ...c, imagePreviews: reorder(c.imagePreviews), uploadedPaths: reorder(c.uploadedPaths) };
    }));
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
                  const isPrimary = variants.some((v) => v.colorId === cimg.colorId && v.isPrimary);
                  return (
                    <button
                      key={cimg.colorId}
                      type="button"
                      onClick={() => onSetPrimary(cimg.colorId)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all font-[family-name:var(--font-roboto)] ${
                        isPrimary
                          ? "border-[#1A1A1A] bg-[#F7F7F8] shadow-sm"
                          : "border-[#E5E5E5] hover:border-[#9CA3AF] bg-white"
                      }`}
                    >
                      <span
                        className="w-4 h-4 rounded-full border border-[#E5E5E5] shrink-0"
                        style={{ backgroundColor: cimg.colorHex || "#9CA3AF" }}
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
          ) : colorImages.map((cimg, idx) => (
            <div key={cimg.colorId} className="border border-[#E5E5E5] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-4 h-4 rounded-full border border-[#E5E5E5] shrink-0" style={{ backgroundColor: cimg.colorHex || "#9CA3AF" }} />
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
                onAdd={(files) => handleAddImages(cimg.colorId, files)}
                onRemove={(i) => handleRemoveImage(cimg.colorId, i)}
                onReorder={(from, to) => handleReorderImage(cimg.colorId, from, to)}
                uploading={cimg.uploading}
              />
            </div>
          ))}
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
  onChange,
  onChangeImages,
  onQuickCreateColor,
}: Props) {
  const [showImageModal, setShowImageModal] = useState(false);
  const [galleryState, setGalleryState] = useState<{ images: string[]; colorName: string; colorHex: string } | null>(null);
  const [quickCreateErr, setQuickCreateErr] = useState("");
  const [quickSaving, setQuickSaving]       = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [newColorName, setNewColorName]     = useState("");
  const [newColorHex, setNewColorHex]       = useState("#9CA3AF");

  // ── Bulk edit state ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEdit, setBulkEdit]       = useState<BulkEditState>(defaultBulkEdit());
  const selectAllRef                  = useRef<HTMLInputElement>(null);

  // Sync "select all" indeterminate state
  useEffect(() => {
    if (selectAllRef.current) {
      const allSelected  = selectedIds.size === variants.length && variants.length > 0;
      const someSelected = selectedIds.size > 0 && !allSelected;
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [selectedIds, variants.length]);

  const totalPhotos    = colorImages.reduce((s, c) => s + c.imagePreviews.length, 0);
  const invalidTempIds = findInvalidVariantTempIds(variants);
  const showBulkRow    = selectedIds.size > 0;

  // ── Quick create color ─────────────────────────────────────────────────────
  async function handleQuickSave() {
    if (!newColorName.trim() || !onQuickCreateColor) return;
    setQuickSaving(true);
    try {
      await onQuickCreateColor(newColorName.trim(), newColorHex);
      setNewColorName("");
      setNewColorHex("#9CA3AF");
      setShowQuickCreate(false);
      setQuickCreateErr("");
    } catch (e: unknown) {
      setQuickCreateErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setQuickSaving(false);
    }
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  function updateVariant(tempId: string, patch: Partial<VariantState>) {
    onChange(variants.map((v) => v.tempId === tempId ? { ...v, ...patch } : v));
  }

  function setPrimary(tempId: string) {
    onChange(variants.map((v) => ({ ...v, isPrimary: v.tempId === tempId })));
  }

  function addVariant() {
    const def = defaultVariant(availableColors);
    const isPrimary = variants.length === 0;
    onChange([...variants, { ...def, isPrimary }]);
  }

  function removeVariant(tempId: string) {
    if (variants.length <= 1) return;
    const removed = variants.find((v) => v.tempId === tempId);
    let newVariants = variants.filter((v) => v.tempId !== tempId);
    if (removed?.isPrimary && newVariants.length > 0) {
      newVariants = newVariants.map((v, i) => ({ ...v, isPrimary: i === 0 }));
    }
    // Remove from selection if present
    if (selectedIds.has(tempId)) {
      const next = new Set(selectedIds);
      next.delete(tempId);
      setSelectedIds(next);
    }
    onChange(newVariants);
  }

  function handleColorSelect(tempId: string, colorId: string) {
    const sel = availableColors.find((ac) => ac.id === colorId);
    if (!sel) return;
    updateVariant(tempId, { colorId, colorName: sel.name, colorHex: sel.hex ?? "#9CA3AF" });
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
      if (bulkEdit.size       !== "") patch.size       = bulkEdit.size;
      if (bulkEdit.applyType) {
        patch.saleType     = bulkEdit.saleType;
        patch.packQuantity = bulkEdit.saleType === "UNIT" ? "" : bulkEdit.packQuantity;
      }
      if (bulkEdit.discountType !== "") {
        patch.discountType  = bulkEdit.discountType;
        patch.discountValue = bulkEdit.discountValue;
      } else if (bulkEdit.discountType === "" && bulkEdit.discountValue === "" && bulkEdit.unitPrice === "" && bulkEdit.weight === "" && bulkEdit.stock === "" && bulkEdit.size === "" && !bulkEdit.applyType) {
        // nothing to apply
      }
      return { ...v, ...patch };
    }));
    setBulkEdit(defaultBulkEdit());
  }

  // ── Scroll sync (top mirror) ───────────────────────────────────────────────
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef  = useRef<HTMLDivElement>(null);
  const innerRef      = useRef<HTMLDivElement>(null);
  const [innerScrollWidth, setInnerScrollWidth] = useState(0);

  useEffect(() => {
    if (innerRef.current) setInnerScrollWidth(innerRef.current.scrollWidth);
  }, [variants]);

  const onMainScroll = useCallback(() => {
    if (topScrollRef.current && mainScrollRef.current)
      topScrollRef.current.scrollLeft = mainScrollRef.current.scrollLeft;
  }, []);

  const onTopScroll = useCallback(() => {
    if (mainScrollRef.current && topScrollRef.current)
      mainScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
  }, []);

  return (
    <div className="space-y-4">

      {/* ── Table area ── */}
      {variants.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-[#E5E5E5] text-[#9CA3AF] text-sm font-[family-name:var(--font-roboto)] rounded-lg">
          Cliquez sur &ldquo;Ajouter une variante&rdquo; pour commencer.
        </div>
      ) : (
        <>
          {/* Top scroll mirror */}
          <div ref={topScrollRef} className="overflow-x-auto" onScroll={onTopScroll} style={{ height: 12 }}>
            <div style={{ width: innerScrollWidth, height: 1 }} />
          </div>

          {/* Main scrollable table */}
          <div ref={mainScrollRef} className="overflow-x-auto pb-1" onScroll={onMainScroll}>
            <div ref={innerRef} style={{ minWidth: "max-content", width: "100%" }}>
              <table className="border-collapse text-xs font-[family-name:var(--font-roboto)] w-full" style={{ minWidth: 1100 }}>
                <thead>
                  {/* ── Column headers ── */}
                  <tr className="bg-[#1A1A1A] text-white">
                    {/* Checkbox select-all */}
                    <th className="px-3 py-2.5 text-center font-semibold whitespace-nowrap" style={{ width: 36 }}>
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={selectedIds.size === variants.length && variants.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds(new Set(variants.map((v) => v.tempId)));
                          } else {
                            setSelectedIds(new Set());
                          }
                        }}
                        className="cursor-pointer w-3.5 h-3.5 accent-white"
                        title="Tout sélectionner / désélectionner"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold whitespace-nowrap" style={{ width: 56 }}>Photo</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap" style={{ width: 160 }}>Couleur</th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap" style={{ width: 90 }}>Prix (EUR)</th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap" style={{ width: 90 }}>Poids (kg)</th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap" style={{ width: 70 }}>Stock</th>
                    <th className="px-3 py-2.5 text-center font-semibold whitespace-nowrap" style={{ width: 110 }}>Type</th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap" style={{ width: 80 }}>Qté paquet</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap" style={{ width: 80 }}>Taille</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap" style={{ width: 180 }}>Remise</th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap" style={{ width: 100 }}>Prix final</th>
                    <th className="px-3 py-2.5 text-center font-semibold whitespace-nowrap" style={{ width: 50 }}></th>
                  </tr>

                  {/* ── Bulk edit row (visible when at least one variant selected) ── */}
                  {showBulkRow && (
                    <tr className="bg-[#F0FDF4] border-b-2 border-b-[#22C55E]">
                      {/* Spacer (checkbox col) */}
                      <td className="px-3 py-2" />
                      {/* Spacer (photo col) */}
                      <td className="px-3 py-2" />
                      {/* Selected count */}
                      <td className="px-3 py-2" colSpan={1}>
                        <span className="text-[11px] text-[#16A34A] font-semibold font-[family-name:var(--font-roboto)] whitespace-nowrap">
                          ✦ {selectedIds.size} variante{selectedIds.size > 1 ? "s" : ""} sélectionnée{selectedIds.size > 1 ? "s" : ""}
                        </span>
                      </td>
                      {/* Prix */}
                      <td className="px-3 py-2">
                        <input
                          type="number" min="0" step="0.01" placeholder="—"
                          value={bulkEdit.unitPrice}
                          onChange={(e) => setBulkEdit((b) => ({ ...b, unitPrice: e.target.value }))}
                          className="w-full border border-[#22C55E] bg-white px-2 py-1.5 text-xs text-right focus:outline-none focus:border-[#16A34A] font-[family-name:var(--font-roboto)]"
                        />
                      </td>
                      {/* Poids */}
                      <td className="px-3 py-2">
                        <input
                          type="number" min="0" step="0.001" placeholder="—"
                          value={bulkEdit.weight}
                          onChange={(e) => setBulkEdit((b) => ({ ...b, weight: e.target.value }))}
                          className="w-full border border-[#22C55E] bg-white px-2 py-1.5 text-xs text-right focus:outline-none focus:border-[#16A34A] font-[family-name:var(--font-roboto)]"
                        />
                      </td>
                      {/* Stock */}
                      <td className="px-3 py-2">
                        <input
                          type="number" min="0" step="1" placeholder="—"
                          value={bulkEdit.stock}
                          onChange={(e) => setBulkEdit((b) => ({ ...b, stock: e.target.value }))}
                          className="w-full border border-[#22C55E] bg-white px-2 py-1.5 text-xs text-right focus:outline-none focus:border-[#16A34A] font-[family-name:var(--font-roboto)]"
                        />
                      </td>
                      {/* Type (optionnel) */}
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1 items-center">
                          <label className="flex items-center gap-1 text-[10px] text-[#374151] font-[family-name:var(--font-roboto)] cursor-pointer select-none whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={bulkEdit.applyType}
                              onChange={(e) => setBulkEdit((b) => ({ ...b, applyType: e.target.checked }))}
                              className="accent-[#22C55E] w-3 h-3 cursor-pointer"
                            />
                            Modifier type
                          </label>
                          {bulkEdit.applyType && (
                            <div className="flex gap-0.5">
                              {(["UNIT", "PACK"] as const).map((type) => (
                                <button
                                  key={type} type="button"
                                  onClick={() => setBulkEdit((b) => ({ ...b, saleType: type }))}
                                  className={`px-2 py-1 text-[11px] font-semibold border transition-colors font-[family-name:var(--font-roboto)] ${
                                    bulkEdit.saleType === type
                                      ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                                      : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#1A1A1A]"
                                  }`}
                                >
                                  {type === "UNIT" ? "Unité" : "Pack"}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Qté paquet */}
                      <td className="px-3 py-2">
                        <input
                          type="number" min="2" placeholder="—"
                          value={bulkEdit.packQuantity}
                          disabled={!bulkEdit.applyType || bulkEdit.saleType === "UNIT"}
                          onChange={(e) => setBulkEdit((b) => ({ ...b, packQuantity: e.target.value }))}
                          className="w-full border border-[#22C55E] bg-white px-2 py-1.5 text-xs text-right focus:outline-none focus:border-[#16A34A] font-[family-name:var(--font-roboto)] disabled:opacity-40 disabled:bg-[#F7F7F8] disabled:cursor-not-allowed"
                        />
                      </td>
                      {/* Taille */}
                      <td className="px-3 py-2">
                        <input
                          type="text" placeholder="—"
                          value={bulkEdit.size}
                          onChange={(e) => setBulkEdit((b) => ({ ...b, size: e.target.value }))}
                          className="w-full border border-[#22C55E] bg-white px-2 py-1.5 text-xs focus:outline-none focus:border-[#16A34A] font-[family-name:var(--font-roboto)]"
                        />
                      </td>
                      {/* Remise */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <select
                            value={bulkEdit.discountType}
                            onChange={(e) => setBulkEdit((b) => ({
                              ...b,
                              discountType:  e.target.value as "" | "PERCENT" | "AMOUNT",
                              discountValue: "",
                            }))}
                            className="border border-[#22C55E] bg-white px-1.5 py-1.5 text-[11px] focus:outline-none font-[family-name:var(--font-roboto)] text-[#1A1A1A]"
                          >
                            <option value="">Aucune</option>
                            <option value="PERCENT">%</option>
                            <option value="AMOUNT">EUR</option>
                          </select>
                          {bulkEdit.discountType && (
                            <input
                              type="number" min="0" step="0.01" placeholder="0"
                              value={bulkEdit.discountValue}
                              onChange={(e) => setBulkEdit((b) => ({ ...b, discountValue: e.target.value }))}
                              className="w-16 border border-[#22C55E] bg-white px-2 py-1.5 text-xs text-right focus:outline-none font-[family-name:var(--font-roboto)]"
                            />
                          )}
                        </div>
                      </td>
                      {/* Bouton Appliquer */}
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={applyBulk}
                          className="px-3 py-1.5 bg-[#22C55E] text-white text-[11px] font-semibold rounded hover:bg-[#16A34A] transition-colors font-[family-name:var(--font-roboto)] whitespace-nowrap"
                        >
                          Appliquer
                        </button>
                      </td>
                      {/* Spacer (supprimer col) */}
                      <td />
                    </tr>
                  )}
                </thead>

                <tbody>
                  {variants.map((v, idx) => {
                    const isInvalid  = invalidTempIds.has(v.tempId);
                    const isSelected = selectedIds.has(v.tempId);
                    const totalPrice = computeTotalPrice(v);
                    const finalPrice = computeFinalPrice(v);
                    const hasDiscount = finalPrice !== null && totalPrice !== null && finalPrice !== totalPrice;
                    const rowClass = isSelected
                      ? "bg-[#F0FDF4] border-l-2 border-l-[#22C55E]"
                      : isInvalid
                        ? "bg-[#FEF2F2] border-l-2 border-l-[#EF4444]"
                        : idx % 2 === 0 ? "bg-white" : "bg-[#F7F7F8]";

                    return (
                      <tr key={v.tempId} className={`${rowClass} hover:bg-[#F0F0F0] transition-colors group`}>

                        {/* Checkbox sélection */}
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const next = new Set(selectedIds);
                              if (e.target.checked) next.add(v.tempId);
                              else next.delete(v.tempId);
                              setSelectedIds(next);
                            }}
                            className="accent-[#22C55E] cursor-pointer w-3.5 h-3.5"
                          />
                        </td>

                        {/* Photo */}
                        <td className="px-3 py-2 text-center">
                          {(() => {
                            const cimg = colorImages.find((ci) => ci.colorId === v.colorId);
                            const firstImg = cimg?.imagePreviews[0];
                            if (firstImg) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setGalleryState({
                                    images: cimg!.imagePreviews,
                                    colorName: v.colorName,
                                    colorHex: v.colorHex,
                                  })}
                                  className="relative w-10 h-10 rounded-lg overflow-hidden border border-[#E5E5E5] hover:border-[#1A1A1A] transition-all mx-auto block group/thumb"
                                  title={`Voir les ${cimg!.imagePreviews.length} photo(s)`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={firstImg} alt={v.colorName} className="w-full h-full object-cover" />
                                  {cimg!.imagePreviews.length > 1 && (
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                                      <span className="text-white text-[10px] font-bold">+{cimg!.imagePreviews.length}</span>
                                    </div>
                                  )}
                                </button>
                              );
                            }
                            return (
                              <div className="w-10 h-10 rounded-lg border border-dashed border-[#D1D5DB] bg-[#F7F7F8] flex items-center justify-center mx-auto" title="Aucune image">
                                <svg className="w-4 h-4 text-[#D1D5DB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                                </svg>
                              </div>
                            );
                          })()}
                        </td>

                        {/* Couleur */}
                        <td className="px-3 py-2">
                          <ColorSelect
                            value={v.colorId}
                            options={availableColors}
                            onChange={(id) => handleColorSelect(v.tempId, id)}
                          />
                        </td>

                        {/* Prix */}
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="0.01" value={v.unitPrice} placeholder="0.00"
                            onChange={(e) => updateVariant(v.tempId, { unitPrice: e.target.value })}
                            className="w-full border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs text-right focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]"
                          />
                        </td>

                        {/* Poids */}
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="0.001" value={v.weight} placeholder="0.008"
                            onChange={(e) => updateVariant(v.tempId, { weight: e.target.value })}
                            className="w-full border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs text-right focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]"
                          />
                        </td>

                        {/* Stock */}
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="1" value={v.stock} placeholder="0"
                            onChange={(e) => updateVariant(v.tempId, { stock: e.target.value })}
                            className="w-full border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs text-right focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]"
                          />
                        </td>

                        {/* Type toggle */}
                        <td className="px-3 py-2">
                          <div className="flex gap-0.5 justify-center">
                            {(["UNIT", "PACK"] as const).map((type) => (
                              <button
                                key={type} type="button"
                                onClick={() => updateVariant(v.tempId, {
                                  saleType: type,
                                  packQuantity: type === "UNIT" ? "" : v.packQuantity,
                                })}
                                className={`px-2 py-1 text-[11px] font-semibold border transition-colors font-[family-name:var(--font-roboto)] ${
                                  v.saleType === type
                                    ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                                    : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#1A1A1A]"
                                }`}
                              >
                                {type === "UNIT" ? "Unité" : "Pack"}
                              </button>
                            ))}
                          </div>
                        </td>

                        {/* Qty paquet */}
                        <td className="px-3 py-2">
                          <input
                            type="number" min="2" max="99999" value={v.packQuantity} placeholder="—"
                            disabled={v.saleType === "UNIT"}
                            onChange={(e) => updateVariant(v.tempId, { packQuantity: e.target.value })}
                            className="w-full border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs text-right focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)] disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-[#F7F7F8]"
                          />
                        </td>

                        {/* Taille */}
                        <td className="px-3 py-2">
                          <input
                            type="text" value={v.size} placeholder="—"
                            onChange={(e) => updateVariant(v.tempId, { size: e.target.value })}
                            className="w-full border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]"
                          />
                        </td>

                        {/* Remise */}
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <select
                              value={v.discountType}
                              onChange={(e) => updateVariant(v.tempId, {
                                discountType: e.target.value as "" | "PERCENT" | "AMOUNT",
                                discountValue: "",
                              })}
                              className="border border-[#E5E5E5] bg-white px-1.5 py-1.5 text-[11px] focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)] text-[#1A1A1A]"
                            >
                              <option value="">Aucune</option>
                              <option value="PERCENT">%</option>
                              <option value="AMOUNT">EUR</option>
                            </select>
                            {v.discountType && (
                              <input
                                type="number" min="0" step="0.01" value={v.discountValue} placeholder="0"
                                onChange={(e) => updateVariant(v.tempId, { discountValue: e.target.value })}
                                className="w-16 border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs text-right focus:outline-none focus:border-[#1A1A1A] font-[family-name:var(--font-roboto)]"
                              />
                            )}
                          </div>
                        </td>

                        {/* Prix final */}
                        <td className="px-3 py-2 text-right">
                          {finalPrice !== null ? (
                            <span className={`font-semibold font-[family-name:var(--font-poppins)] ${hasDiscount ? "text-emerald-600" : "text-[#1A1A1A]"}`}>
                              {hasDiscount && totalPrice !== null && (
                                <span className="text-[#9CA3AF] line-through mr-1 font-normal text-[10px]">
                                  {totalPrice.toFixed(2)}
                                </span>
                              )}
                              {finalPrice.toFixed(2)} €
                            </span>
                          ) : (
                            <span className="text-[#9CA3AF]">—</span>
                          )}
                        </td>

                        {/* Supprimer */}
                        <td className="px-3 py-2 text-center">
                          {variants.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeVariant(v.tempId)}
                              title="Supprimer cette variante"
                              className="text-[#9CA3AF] hover:text-[#EF4444] transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Validation warning */}
              {invalidTempIds.size > 0 && (
                <div className="mt-2 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg flex items-center gap-2">
                  <svg className="w-4 h-4 text-[#EF4444] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)]">
                    Doublon détecté : une couleur ne peut avoir qu&apos;une variante à l&apos;unité, et pas deux paquets identiques (même quantité et même taille).
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Action buttons ── */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={addVariant}
          disabled={availableColors.length === 0}
          className="w-full border-2 border-dashed border-[#E5E5E5] py-3 text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:border-[#1A1A1A] hover:bg-[#F7F7F8] transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg"
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
            <button
              type="button"
              onClick={() => setShowQuickCreate(true)}
              className="w-full border-2 border-dashed border-[#E5E5E5] py-3 text-sm font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:border-[#1A1A1A] hover:bg-[#F7F7F8] transition-colors flex items-center justify-center gap-2 rounded-lg"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
              </svg>
              Créer une couleur
            </button>
          ) : (
            <div className="border-2 border-dashed border-[#1A1A1A] bg-[#F7F7F8] p-4 space-y-3 rounded-lg">
              <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wider font-[family-name:var(--font-roboto)]">
                Nouvelle couleur
              </p>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={newColorName}
                  onChange={(e) => setNewColorName(e.target.value)}
                  placeholder="Nom de la couleur"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleQuickSave(); } }}
                  className="flex-1 border border-[#E5E5E5] px-3 py-2 text-sm font-[family-name:var(--font-roboto)] focus:outline-none focus:border-[#1A1A1A] bg-white rounded"
                />
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="color"
                    value={newColorHex}
                    onChange={(e) => setNewColorHex(e.target.value)}
                    className="w-9 h-9 border border-[#E5E5E5] cursor-pointer p-0.5 shrink-0 bg-white rounded"
                    title="Couleur hex"
                  />
                </div>
              </div>
              {quickCreateErr && <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)]">{quickCreateErr}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleQuickSave}
                  disabled={quickSaving || !newColorName.trim()}
                  className="flex-1 py-2 bg-[#1A1A1A] text-white text-sm font-medium hover:bg-black transition-colors disabled:opacity-50 font-[family-name:var(--font-roboto)] rounded"
                >
                  {quickSaving ? "Création..." : "Créer la couleur"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowQuickCreate(false); setQuickCreateErr(""); }}
                  className="px-4 py-2 border border-[#E5E5E5] text-sm text-[#6B6B6B] hover:border-[#1A1A1A] transition-colors font-[family-name:var(--font-roboto)] rounded"
                >
                  Annuler
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {/* ── Image Gallery Modal ── key resets idx to 0 when color changes */}
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
        onSetPrimary={(colorId) => {
          const target = variants.find((v) => v.colorId === colorId);
          if (target) setPrimary(target.tempId);
        }}
      />
    </div>
  );
}
