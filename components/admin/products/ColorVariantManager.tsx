"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import ImageDropzone from "./ImageDropzone";

// ─────────────────────────────────────────────
// Types exportés
// ─────────────────────────────────────────────
export interface SaleOptionState {
  tempId: string;
  saleType: "UNIT" | "PACK";
  packQuantity: string;
  size: string;
  discountType: "" | "PERCENT" | "AMOUNT";
  discountValue: string;
}

export interface ColorState {
  tempId: string;
  colorId: string;
  colorName: string;
  colorHex: string;
  unitPrice: string;
  weight: string;
  stock: string;
  isPrimary: boolean;
  saleOptions: SaleOptionState[];
  imagePreviews: string[];
  imageFiles: File[];
  uploadedPaths: string[];
  uploading: boolean;
}

export interface AvailableColor {
  id: string;
  name: string;
  hex: string | null;
}

interface ColorVariantManagerProps {
  colors: ColorState[];
  availableColors: AvailableColor[];
  onChange: (colors: ColorState[]) => void;
  onQuickCreateColor?: (name: string, hex: string | null) => Promise<AvailableColor>;
}

// ─────────────────────────────────────────────
// Calculs de prix
// ─────────────────────────────────────────────
export function computeTotalPrice(unitPrice: string, opt: SaleOptionState): number | null {
  const unit = parseFloat(unitPrice);
  if (isNaN(unit) || unit <= 0) return null;
  if (opt.saleType === "UNIT") return unit;
  const qty = parseInt(opt.packQuantity);
  if (isNaN(qty) || qty <= 0) return null;
  return unit * qty;
}

export function computeFinalPrice(unitPrice: string, opt: SaleOptionState): number | null {
  const total = computeTotalPrice(unitPrice, opt);
  if (total === null) return null;
  if (!opt.discountType || !opt.discountValue) return total;
  const disc = parseFloat(opt.discountValue);
  if (isNaN(disc) || disc <= 0) return total;
  if (opt.discountType === "PERCENT") return Math.max(0, total * (1 - disc / 100));
  return Math.max(0, total - disc);
}

function uid() { return Math.random().toString(36).slice(2, 9); }

function defaultSaleOption(type: "UNIT" | "PACK" = "UNIT"): SaleOptionState {
  return { tempId: uid(), saleType: type, packQuantity: "", size: "", discountType: "", discountValue: "" };
}

// ─────────────────────────────────────────────
// ColorSelect — dropdown custom avec swatch
// ─────────────────────────────────────────────
function ColorSelect({ value, options, onChange }: {
  value: string; options: AvailableColor[]; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const sel = options.find((o) => o.id === value);

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 bg-white border border-[#E2E8F0] px-3 py-2.5 text-sm font-[family-name:var(--font-roboto)] text-[#0F172A] focus:outline-none focus:border-[#0F3460] hover:border-[#94A3B8] transition-colors text-left"
      >
        <span className="w-4 h-4 rounded-full border border-[#E2E8F0] shrink-0" style={{ backgroundColor: sel?.hex || "#94A3B8" }} />
        <span className="flex-1 truncate">{sel ? sel.name : <span className="text-[#94A3B8]">— Choisir —</span>}</span>
        <svg className={`w-4 h-4 text-[#94A3B8] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-[#E2E8F0] shadow-lg max-h-48 overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[#94A3B8]">Aucune couleur disponible</div>
          ) : options.map((opt) => (
            <button key={opt.id} type="button" onClick={() => { onChange(opt.id); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[#F1F5F9] transition-colors text-left ${opt.id === value ? "bg-[#F1F5F9]" : ""}`}
            >
              <span className="w-4 h-4 rounded-full border border-[#E2E8F0] shrink-0" style={{ backgroundColor: opt.hex || "#94A3B8" }} />
              <span className="flex-1 font-[family-name:var(--font-roboto)] text-[#0F172A]">{opt.name}</span>
              {opt.id === value && (
                <svg className="w-4 h-4 text-[#0F3460] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Label utilitaire
// ─────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider mb-1.5 font-[family-name:var(--font-roboto)]">
      {children}
    </p>
  );
}

// ─────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────
export default function ColorVariantManager({ colors, availableColors, onChange, onQuickCreateColor }: ColorVariantManagerProps) {

  // ── Scroll synchronisé haut / bas ────────────────────────────────────────
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef  = useRef<HTMLDivElement>(null);
  const innerRef      = useRef<HTMLDivElement>(null);
  const [innerScrollWidth, setInnerScrollWidth] = useState(0);

  useEffect(() => {
    if (innerRef.current) setInnerScrollWidth(innerRef.current.scrollWidth);
  }, [colors]);

  const onMainScroll = useCallback(() => {
    if (topScrollRef.current && mainScrollRef.current)
      topScrollRef.current.scrollLeft = mainScrollRef.current.scrollLeft;
  }, []);

  const onTopScroll = useCallback(() => {
    if (mainScrollRef.current && topScrollRef.current)
      mainScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
  }, []);

  // ── Quick create couleur ──────────────────────────────────────────────────
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [newColorName,    setNewColorName]    = useState("");
  const [newColorHex,     setNewColorHex]     = useState("#94A3B8");
  const [quickSaving,     setQuickSaving]     = useState(false);
  const [quickCreateErr,  setQuickCreateErr]  = useState("");

  async function handleQuickSave() {
    if (!newColorName.trim() || !onQuickCreateColor) return;
    setQuickSaving(true);
    try {
      await onQuickCreateColor(newColorName.trim(), newColorHex);
      setNewColorName("");
      setNewColorHex("#94A3B8");
      setShowQuickCreate(false);
      setQuickCreateErr("");
    } catch (e: unknown) {
      setQuickCreateErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setQuickSaving(false);
    }
  }

  // ── Raccourci bulk ────────────────────────────────────────────────────────
  const [bulkPrice,         setBulkPrice]         = useState("");
  const [bulkPackQty,       setBulkPackQty]       = useState("");
  const [bulkDiscountType,  setBulkDiscountType]  = useState<"" | "PERCENT" | "AMOUNT">("");
  const [bulkDiscountValue, setBulkDiscountValue] = useState("");
  const [bulkWeight,        setBulkWeight]        = useState("");
  const [bulkStock,         setBulkStock]         = useState("");
  const [bulkApplied,       setBulkApplied]       = useState(false);

  function applyBulkToAll() {
    const hasAny = bulkPrice || bulkPackQty || bulkWeight || bulkStock;
    if (!hasAny) return;

    onChange(colors.map((c) => {
      const patch: Partial<ColorState> = {};
      if (bulkPrice)  patch.unitPrice = bulkPrice;
      if (bulkWeight) patch.weight    = bulkWeight;
      if (bulkStock)  patch.stock     = bulkStock;

      if (bulkPackQty) {
        let saleOptions = c.saleOptions;
        // Cherche un PACK existant avec exactement la même quantité
        const sameQtyIdx = saleOptions.findIndex(
          (o) => o.saleType === "PACK" && o.packQuantity === bulkPackQty
        );

        const discountPatch = bulkDiscountType
          ? { discountType: bulkDiscountType, discountValue: bulkDiscountValue }
          : {};

        if (sameQtyIdx >= 0) {
          // Paquet existant avec même quantité → on met à jour la remise uniquement
          saleOptions = saleOptions.map((o, i) =>
            i === sameQtyIdx ? { ...o, ...discountPatch } : o
          );
        } else {
          // Pas de paquet avec cette quantité → on en crée un nouveau
          saleOptions = [
            ...saleOptions,
            { ...defaultSaleOption("PACK"), packQuantity: bulkPackQty, ...discountPatch },
          ];
        }
        patch.saleOptions = saleOptions;
      }

      return { ...c, ...patch };
    }));
    setBulkApplied(true);
    setTimeout(() => setBulkApplied(false), 2000);
  }

  // ── Mutations couleurs ────────────────────────────────────────────────────
  function updateColor(tempId: string, patch: Partial<ColorState>) {
    onChange(colors.map((c) => c.tempId === tempId ? { ...c, ...patch } : c));
  }
  function updateSaleOption(colorTempId: string, optTempId: string, patch: Partial<SaleOptionState>) {
    onChange(colors.map((c) => {
      if (c.tempId !== colorTempId) return c;
      return { ...c, saleOptions: c.saleOptions.map((o) => o.tempId === optTempId ? { ...o, ...patch } : o) };
    }));
  }
  function setPrimary(colorTempId: string) {
    onChange(colors.map((c) => ({ ...c, isPrimary: c.tempId === colorTempId })));
  }
  function addColor() {
    const usedIds = colors.map((c) => c.colorId);
    const first = availableColors.find((ac) => !usedIds.includes(ac.id));
    onChange([...colors, {
      tempId: uid(), colorId: first?.id ?? "", colorName: first?.name ?? "", colorHex: first?.hex ?? "#94A3B8",
      unitPrice: "", weight: "", stock: "", isPrimary: colors.length === 0,
      saleOptions: [defaultSaleOption("UNIT")],
      imagePreviews: [], imageFiles: [], uploadedPaths: [], uploading: false,
    }]);
  }
  function removeColor(tempId: string) { onChange(colors.filter((c) => c.tempId !== tempId)); }
  function handleColorSelect(colorTempId: string, colorId: string) {
    const sel = availableColors.find((ac) => ac.id === colorId);
    if (!sel) return;
    updateColor(colorTempId, { colorId, colorName: sel.name, colorHex: sel.hex ?? "#94A3B8" });
  }
  function addSaleOption(colorTempId: string) {
    onChange(colors.map((c) => c.tempId !== colorTempId ? c : {
      ...c, saleOptions: [...c.saleOptions, defaultSaleOption("PACK")]
    }));
  }
  function removeSaleOption(colorTempId: string, optTempId: string) {
    onChange(colors.map((c) => c.tempId !== colorTempId ? c : {
      ...c, saleOptions: c.saleOptions.filter((o) => o.tempId !== optTempId)
    }));
  }
  async function handleAddImages(colorTempId: string, files: File[]) {
    const color = colors.find((c) => c.tempId === colorTempId);
    if (!color) return;
    const blobs = files.map((f) => URL.createObjectURL(f));
    updateColor(colorTempId, { imagePreviews: [...color.imagePreviews, ...blobs], imageFiles: [...color.imageFiles, ...files], uploading: true });
    const paths: string[] = [];
    for (const file of files) {
      const fd = new FormData(); fd.append("image", file);
      try {
        const res = await fetch("/api/admin/products/images", { method: "POST", body: fd });
        const json = await res.json();
        if (res.ok) paths.push(json.path);
      } catch { console.error("Erreur upload"); }
    }
    onChange(colors.map((c) => c.tempId !== colorTempId ? c : { ...c, uploadedPaths: [...c.uploadedPaths, ...paths], uploading: false }));
  }
  function handleRemoveImage(colorTempId: string, i: number) {
    onChange(colors.map((c) => c.tempId !== colorTempId ? c : {
      ...c, imagePreviews: c.imagePreviews.filter((_, j) => j !== i),
      imageFiles: c.imageFiles.filter((_, j) => j !== i), uploadedPaths: c.uploadedPaths.filter((_, j) => j !== i),
    }));
  }
  function handleReorderImage(colorTempId: string, from: number, to: number) {
    onChange(colors.map((c) => {
      if (c.tempId !== colorTempId) return c;
      const reorder = <T,>(arr: T[]): T[] => { const r = [...arr]; const [item] = r.splice(from, 1); r.splice(to, 0, item); return r; };
      return { ...c, imagePreviews: reorder(c.imagePreviews), imageFiles: c.imageFiles.length > 0 ? reorder(c.imageFiles) : [], uploadedPaths: reorder(c.uploadedPaths) };
    }));
  }

  const usedColorIds = colors.map((c) => c.colorId);
  const canAddColor  = availableColors.length > 0 && colors.length < availableColors.length;

  return (
    <div className="space-y-5">

      {/* ── Raccourci — Appliquer à toutes les variantes ── */}
      {colors.length > 0 && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-[#0F3460] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider font-[family-name:var(--font-roboto)]">
              Raccourci — Appliquer à toutes les variantes
            </p>
          </div>
          {/* Ligne 1 : Prix, Poids, Stock */}
          <div className="grid grid-cols-3 gap-3 mb-2">
            <div>
              <label className="block text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] mb-1">Prix / unité (€)</label>
              <input
                type="number" min="0" step="0.01" value={bulkPrice} placeholder="0.00"
                onChange={(e) => setBulkPrice(e.target.value)}
                className="w-full border border-[#E2E8F0] bg-white px-2.5 py-2 text-sm text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] mb-1">Poids (kg)</label>
              <input
                type="number" min="0" step="0.001" value={bulkWeight} placeholder="0.008"
                onChange={(e) => setBulkWeight(e.target.value)}
                className="w-full border border-[#E2E8F0] bg-white px-2.5 py-2 text-sm text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] mb-1">Stock</label>
              <input
                type="number" min="0" step="1" value={bulkStock} placeholder="0"
                onChange={(e) => setBulkStock(e.target.value)}
                className="w-full border border-[#E2E8F0] bg-white px-2.5 py-2 text-sm text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
              />
            </div>
          </div>

          {/* Ligne 2 : Paquet + Remise */}
          <div className="flex gap-2 items-end mb-3">
            <div className="w-32 shrink-0">
              <label className="block text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] mb-1">
                Quantité paquet
              </label>
              <input
                type="number" min="2" step="1" value={bulkPackQty} placeholder="ex: 12"
                onChange={(e) => setBulkPackQty(e.target.value)}
                className="w-full border border-[#E2E8F0] bg-white px-2.5 py-2 text-sm text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
              />
            </div>
            <div className="shrink-0">
              <label className="block text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] mb-1">Type remise</label>
              <select
                value={bulkDiscountType}
                onChange={(e) => {
                  setBulkDiscountType(e.target.value as "" | "PERCENT" | "AMOUNT");
                  if (!e.target.value) setBulkDiscountValue("");
                }}
                disabled={!bulkPackQty}
                className="border border-[#E2E8F0] bg-white px-2.5 py-2 text-sm focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)] text-[#0F172A] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <option value="">Aucune</option>
                <option value="PERCENT">% Pourcentage</option>
                <option value="AMOUNT">€ Montant fixe</option>
              </select>
            </div>
            {bulkDiscountType && (
              <div className="w-28 shrink-0">
                <label className="block text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] mb-1">
                  Valeur remise {bulkDiscountType === "PERCENT" ? "(%)" : "(€)"}
                </label>
                <input
                  type="number" min="0" step="0.01" value={bulkDiscountValue} placeholder="0"
                  onChange={(e) => setBulkDiscountValue(e.target.value)}
                  className="w-full border border-[#E2E8F0] bg-white px-2.5 py-2 text-sm text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
                />
              </div>
            )}
            {bulkPackQty && (
              <p className="text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] pb-2 leading-tight max-w-xs">
                Si un paquet ×{bulkPackQty} existe déjà → remise mise à jour.<br />
                Sinon → nouveau paquet créé.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={applyBulkToAll}
              disabled={!bulkPrice && !bulkPackQty && !bulkWeight && !bulkStock}
              className="px-4 py-2 bg-[#0F3460] text-white text-xs font-medium hover:bg-[#0A2540] transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-[family-name:var(--font-roboto)] flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Appliquer à toutes les couleurs ({colors.length})
            </button>
            {bulkApplied && (
              <span className="text-xs text-emerald-600 font-[family-name:var(--font-roboto)] flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Appliqué !
              </span>
            )}
            <span className="text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)]">
              Seuls les champs remplis seront modifiés
            </span>
          </div>
        </div>
      )}

      {/* ── Zone scroll couleurs ── */}
      {colors.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-[#E2E8F0] text-[#94A3B8] text-sm font-[family-name:var(--font-roboto)]">
          Cliquez sur &quot;Ajouter une couleur&quot; pour commencer.
        </div>
      ) : (
        <>
          {/* Barre de scroll miroir — en haut */}
          <div ref={topScrollRef} className="overflow-x-auto" onScroll={onTopScroll} style={{ height: 12 }}>
            <div style={{ width: innerScrollWidth, height: 1 }} />
          </div>

          {/* Scroll principal */}
          <div ref={mainScrollRef} className="overflow-x-auto pb-2" onScroll={onMainScroll}>
            <div ref={innerRef} className="flex gap-5 items-start" style={{ minWidth: "max-content" }}>
              {colors.map((color, colorIdx) => {
                const selectableColors = availableColors.filter((ac) => ac.id === color.colorId || !usedColorIds.includes(ac.id));

                return (
                  <div key={color.tempId} className="border border-[#E2E8F0] overflow-hidden flex-none bg-white" style={{ width: 720 }}>

                    {/* En-tête */}
                    <div className="flex items-center justify-between px-7 py-4 bg-[#F1F5F9] border-b border-[#E2E8F0]">
                      <div className="flex items-center gap-5">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="radio"
                            name="primaryColor"
                            checked={color.isPrimary}
                            onChange={() => setPrimary(color.tempId)}
                            className="accent-[#0F3460]"
                          />
                          <span className="text-sm font-medium text-[#475569] font-[family-name:var(--font-roboto)]">Principale</span>
                        </label>
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-5 h-5 rounded-full border-2 border-white shadow-sm shrink-0"
                            style={{ backgroundColor: color.colorHex || "#94A3B8" }}
                          />
                          <span className="text-base font-semibold text-[#0F172A] font-[family-name:var(--font-poppins)]">
                            {color.colorName || `Couleur ${colorIdx + 1}`}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeColor(color.tempId)}
                        className="text-sm text-red-400 hover:text-red-600 transition-colors font-[family-name:var(--font-roboto)] flex items-center gap-1.5"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Supprimer
                      </button>
                    </div>

                    {/* Corps */}
                    <div className="p-7 space-y-7">

                      {/* Champs en grille 4 colonnes */}
                      <div className="grid grid-cols-4 gap-4">
                        <div>
                          <FieldLabel>Couleur</FieldLabel>
                          <ColorSelect
                            value={color.colorId}
                            options={selectableColors}
                            onChange={(id) => handleColorSelect(color.tempId, id)}
                          />
                        </div>
                        <div>
                          <FieldLabel>Prix / unité (€)</FieldLabel>
                          <input
                            type="number" min="0" step="0.01" value={color.unitPrice} placeholder="0.00"
                            onChange={(e) => updateColor(color.tempId, { unitPrice: e.target.value })}
                            className="w-full border border-[#E2E8F0] px-3 py-2.5 text-sm text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
                          />
                        </div>
                        <div>
                          <FieldLabel>Poids (kg)</FieldLabel>
                          <input
                            type="number" min="0" step="0.001" value={color.weight} placeholder="0.008"
                            onChange={(e) => updateColor(color.tempId, { weight: e.target.value })}
                            className="w-full border border-[#E2E8F0] px-3 py-2.5 text-sm text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
                          />
                        </div>
                        <div>
                          <FieldLabel>Stock</FieldLabel>
                          <input
                            type="number" min="0" step="1" value={color.stock} placeholder="0"
                            onChange={(e) => updateColor(color.tempId, { stock: e.target.value })}
                            className="w-full border border-[#E2E8F0] px-3 py-2.5 text-sm text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
                          />
                        </div>
                      </div>

                      {/* Options de vente */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#475569] font-[family-name:var(--font-roboto)]">
                            Options de vente
                            <span className="ml-2 font-normal normal-case text-[#94A3B8]">
                              ({color.saleOptions.length} option{color.saleOptions.length > 1 ? "s" : ""})
                            </span>
                          </p>
                          <button
                            type="button"
                            onClick={() => addSaleOption(color.tempId)}
                            className="text-xs text-[#0F3460] hover:text-[#0A2540] font-medium font-[family-name:var(--font-roboto)] flex items-center gap-1 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            Ajouter un paquet
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          {color.saleOptions.map((opt) => {
                            const totalPrice = computeTotalPrice(color.unitPrice, opt);
                            const finalPrice = computeFinalPrice(color.unitPrice, opt);
                            const hasDiscount = finalPrice !== null && totalPrice !== null && finalPrice !== totalPrice;

                            return (
                              <div
                                key={opt.tempId}
                                className="bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2 flex items-center gap-2 flex-wrap"
                              >
                                {/* Type toggle */}
                                <div className="flex gap-0.5 shrink-0">
                                  {(["UNIT", "PACK"] as const).map((type) => (
                                    <button
                                      key={type} type="button"
                                      onClick={() => updateSaleOption(color.tempId, opt.tempId, {
                                        saleType: type,
                                        packQuantity: type === "UNIT" ? "" : opt.packQuantity
                                      })}
                                      className={`px-2.5 py-1 text-xs font-semibold border transition-colors font-[family-name:var(--font-roboto)] ${
                                        opt.saleType === type
                                          ? "bg-[#0F3460] text-white border-[#0F3460]"
                                          : "bg-white text-[#475569] border-[#E2E8F0] hover:border-[#0F3460]"
                                      }`}
                                    >
                                      {type === "UNIT" ? "Unité" : "Paquet"}
                                    </button>
                                  ))}
                                </div>

                                {/* Qté paquet */}
                                {opt.saleType === "PACK" ? (
                                  <input
                                    type="number" min="2" max="99999" value={opt.packQuantity} placeholder="Qté"
                                    onChange={(e) => updateSaleOption(color.tempId, opt.tempId, { packQuantity: e.target.value })}
                                    className="w-16 border border-[#E2E8F0] px-2 py-1 text-xs text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)] bg-white shrink-0"
                                  />
                                ) : (
                                  <span className="text-xs text-[#94A3B8] italic font-[family-name:var(--font-roboto)] shrink-0">unité</span>
                                )}

                                {/* Taille */}
                                <input
                                  type="text" value={opt.size} placeholder="Taille"
                                  onChange={(e) => updateSaleOption(color.tempId, opt.tempId, { size: e.target.value })}
                                  className="w-20 border border-[#E2E8F0] px-2 py-1 text-xs focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)] bg-white shrink-0"
                                />

                                {/* Remise */}
                                <select
                                  value={opt.discountType}
                                  onChange={(e) => updateSaleOption(color.tempId, opt.tempId, {
                                    discountType: e.target.value as "" | "PERCENT" | "AMOUNT",
                                    discountValue: ""
                                  })}
                                  className="border border-[#E2E8F0] px-1.5 py-1 text-xs font-[family-name:var(--font-roboto)] focus:outline-none focus:border-[#0F3460] bg-white text-[#0F172A] shrink-0"
                                >
                                  <option value="">Remise</option>
                                  <option value="PERCENT">%</option>
                                  <option value="AMOUNT">€</option>
                                </select>
                                {opt.discountType && (
                                  <input
                                    type="number" min="0" step="0.01" value={opt.discountValue} placeholder="0"
                                    onChange={(e) => updateSaleOption(color.tempId, opt.tempId, { discountValue: e.target.value })}
                                    className="w-16 border border-[#E2E8F0] px-2 py-1 text-xs text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)] bg-white shrink-0"
                                  />
                                )}

                                {/* Prix final */}
                                <div className="flex-1 text-right min-w-0">
                                  {finalPrice !== null ? (
                                    <span className={`text-xs font-semibold font-[family-name:var(--font-poppins)] ${hasDiscount ? "text-emerald-600" : "text-[#0F172A]"}`}>
                                      {hasDiscount && totalPrice !== null && (
                                        <span className="text-[#94A3B8] line-through mr-1.5 font-normal">{totalPrice.toFixed(2)} €</span>
                                      )}
                                      {finalPrice.toFixed(2)} €
                                    </span>
                                  ) : (
                                    <span className="text-[#94A3B8] text-xs">—</span>
                                  )}
                                </div>

                                {/* Supprimer */}
                                {color.saleOptions.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeSaleOption(color.tempId, opt.tempId)}
                                    title="Supprimer cette option"
                                    className="text-[#94A3B8] hover:text-red-500 transition-colors shrink-0"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Images */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#475569] font-[family-name:var(--font-roboto)] mb-2">
                          Images{" "}
                          <span className="font-normal normal-case text-[#94A3B8]">
                            (partagées entre toutes les options — max 5)
                          </span>
                        </p>
                        <ImageDropzone
                          colorIndex={colorIdx}
                          previews={color.imagePreviews}
                          onAdd={(files) => handleAddImages(color.tempId, files)}
                          onRemove={(idx) => handleRemoveImage(color.tempId, idx)}
                          onReorder={(from, to) => handleReorderImage(color.tempId, from, to)}
                          uploading={color.uploading}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Boutons d'action en colonne verticale ── */}
      <div className="flex flex-col gap-2">
        {/* Ajouter une couleur */}
        <button
          type="button"
          onClick={addColor}
          disabled={!canAddColor}
          className="w-full border-2 border-dashed border-[#E2E8F0] py-3.5 text-sm font-[family-name:var(--font-roboto)] text-[#0F3460] hover:border-[#0F3460] hover:bg-[#F8FAFC] transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Ajouter une couleur
        </button>

        {/* Créer une couleur */}
        {onQuickCreateColor && (
          <>
            {!showQuickCreate ? (
              <button
                type="button"
                onClick={() => setShowQuickCreate(true)}
                className="w-full border-2 border-dashed border-[#E2E8F0] py-3.5 text-sm font-[family-name:var(--font-roboto)] text-[#0F3460] hover:border-[#0F3460] hover:bg-[#F8FAFC] transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
                </svg>
                Créer une couleur
              </button>
            ) : (
              /* Formulaire inline de création */
              <div className="border-2 border-dashed border-[#0F3460] bg-[#F8FAFC] p-4 space-y-3">
                <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider font-[family-name:var(--font-roboto)]">
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
                    className="flex-1 border border-[#E2E8F0] px-3 py-2 text-sm font-[family-name:var(--font-roboto)] focus:outline-none focus:border-[#0F3460] bg-white"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="color"
                      value={newColorHex}
                      onChange={(e) => setNewColorHex(e.target.value)}
                      className="w-9 h-9 border border-[#E2E8F0] cursor-pointer p-0.5 shrink-0 bg-white"
                      title="Couleur hex"
                    />
                    <span className="text-xs text-[#475569] font-mono">{newColorHex}</span>
                  </div>
                </div>
                {quickCreateErr && <p className="text-xs text-red-500 font-[family-name:var(--font-roboto)]">{quickCreateErr}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleQuickSave}
                    disabled={quickSaving || !newColorName.trim()}
                    className="flex-1 py-2 bg-[#0F3460] text-white text-sm font-medium hover:bg-[#0A2540] transition-colors disabled:opacity-50 font-[family-name:var(--font-roboto)]"
                  >
                    {quickSaving ? "Création…" : "Créer la couleur"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowQuickCreate(false); setQuickCreateErr(""); }}
                    className="px-4 py-2 border border-[#E2E8F0] text-sm text-[#475569] hover:border-[#0F3460] transition-colors font-[family-name:var(--font-roboto)]"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
