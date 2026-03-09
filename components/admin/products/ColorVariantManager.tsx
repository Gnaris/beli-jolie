"use client";
import { useState, useRef, useEffect } from "react";
import ImageDropzone from "./ImageDropzone";

// ─────────────────────────────────────────────
// Types exportés
// ─────────────────────────────────────────────
export interface SaleOptionState {
  tempId: string;
  saleType: "UNIT" | "PACK";
  packQuantity: string;
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
  return { tempId: uid(), saleType: type, packQuantity: "", discountType: "", discountValue: "" };
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
        className="w-full flex items-center gap-2 bg-white border border-[#E2E8F0] px-2 py-1.5 text-xs font-[family-name:var(--font-roboto)] text-[#0F172A] focus:outline-none focus:border-[#0F3460] hover:border-[#94A3B8] transition-colors text-left"
      >
        <span className="w-3.5 h-3.5 rounded-full border border-[#E2E8F0] shrink-0" style={{ backgroundColor: sel?.hex || "#94A3B8" }} />
        <span className="flex-1 truncate">{sel ? sel.name : <span className="text-[#94A3B8]">— Choisir —</span>}</span>
        <svg className={`w-3 h-3 text-[#94A3B8] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-[#E2E8F0] shadow-lg max-h-40 overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[#94A3B8]">Aucune couleur disponible</div>
          ) : options.map((opt) => (
            <button key={opt.id} type="button" onClick={() => { onChange(opt.id); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#F1F5F9] transition-colors text-left ${opt.id === value ? "bg-[#F1F5F9]" : ""}`}
            >
              <span className="w-3.5 h-3.5 rounded-full border border-[#E2E8F0] shrink-0" style={{ backgroundColor: opt.hex || "#94A3B8" }} />
              <span className="flex-1 font-[family-name:var(--font-roboto)] text-[#0F172A]">{opt.name}</span>
              {opt.id === value && (
                <svg className="w-3 h-3 text-[#0F3460] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
// QuickCreateColorForm — mini-form inline
// ─────────────────────────────────────────────
function QuickCreateColorForm({ onSave, onCancel }: {
  onSave: (name: string, hex: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [hex, setHex] = useState("#94A3B8");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleSave() {
    if (!name.trim()) { setErr("Nom requis."); return; }
    setSaving(true);
    try { await onSave(name.trim(), hex); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : "Erreur"); setSaving(false); }
  }

  return (
    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom"
        className="border border-[#E2E8F0] px-2 py-1 text-[10px] font-[family-name:var(--font-roboto)] focus:outline-none focus:border-[#0F3460] flex-1 min-w-0"
        autoFocus onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); }}}
      />
      <input type="color" value={hex} onChange={(e) => setHex(e.target.value)}
        className="w-7 h-6 border border-[#E2E8F0] cursor-pointer p-0 shrink-0" title="Couleur hex"
      />
      <button type="button" onClick={handleSave} disabled={saving || !name.trim()}
        className="px-2 py-1 bg-[#0F3460] text-white text-[10px] hover:bg-[#0A2540] transition-colors disabled:opacity-50 shrink-0"
      >{saving ? "…" : "OK"}</button>
      <button type="button" onClick={onCancel}
        className="px-2 py-1 border border-[#E2E8F0] text-[10px] text-[#475569] hover:border-[#0F3460] shrink-0"
      >✕</button>
      {err && <span className="text-[10px] text-red-500 w-full">{err}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────
export default function ColorVariantManager({ colors, availableColors, onChange, onQuickCreateColor }: ColorVariantManagerProps) {
  const [quickCreateFor, setQuickCreateFor] = useState<string | null>(null);

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
    onChange(colors.map((c) => c.tempId !== colorTempId ? c : { ...c, saleOptions: [...c.saleOptions, defaultSaleOption("PACK")] }));
  }
  function removeSaleOption(colorTempId: string, optTempId: string) {
    onChange(colors.map((c) => c.tempId !== colorTempId ? c : { ...c, saleOptions: c.saleOptions.filter((o) => o.tempId !== optTempId) }));
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
  async function handleQuickCreate(colorTempId: string, name: string, hex: string | null) {
    if (!onQuickCreateColor) return;
    const newColor = await onQuickCreateColor(name, hex);
    updateColor(colorTempId, { colorId: newColor.id, colorName: newColor.name, colorHex: newColor.hex ?? "#94A3B8" });
    setQuickCreateFor(null);
  }

  const usedColorIds = colors.map((c) => c.colorId);

  if (colors.length === 0) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8 border-2 border-dashed border-[#E2E8F0] text-[#94A3B8] text-sm font-[family-name:var(--font-roboto)]">
          Cliquez sur &quot;Ajouter une couleur&quot; pour commencer.
        </div>
        <button type="button" onClick={addColor} disabled={availableColors.length === 0}
          className="w-full border-2 border-dashed border-[#E2E8F0] py-3 text-sm font-[family-name:var(--font-roboto)] text-[#0F3460] hover:border-[#0F3460] transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" /></svg>
          Ajouter une couleur
        </button>
      </div>
    );
  }

  // Flatten: each row = (color, saleOption, optIdx)
  type FlatRow = { color: ColorState; opt: SaleOptionState; optIdx: number };
  const rows: FlatRow[] = colors.flatMap((color) =>
    color.saleOptions.map((opt, optIdx) => ({ color, opt, optIdx }))
  );

  const thCls = "px-2 py-2 text-[10px] font-semibold text-[#475569] uppercase tracking-wider font-[family-name:var(--font-roboto)] whitespace-nowrap text-left border-b border-[#E2E8F0] bg-[#F8FAFC]";
  const tdCls = "px-2 py-1.5 align-middle border-b border-[#F1F5F9]";

  return (
    <div className="space-y-6">
      {/* ── Tableau unique scrollable ── */}
      <div className="border border-[#E2E8F0] overflow-x-auto overflow-y-auto max-h-[520px]">
        <table className="w-full border-collapse text-xs min-w-[860px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={thCls} style={{ width: 28 }}>★</th>
              <th className={thCls} style={{ minWidth: 160 }}>Couleur</th>
              <th className={thCls} style={{ width: 90 }}>Prix/u. (€)</th>
              <th className={thCls} style={{ width: 80 }}>Poids (kg)</th>
              <th className={thCls} style={{ width: 70 }}>Stock</th>
              <th className={thCls} style={{ minWidth: 110 }}>Type vente</th>
              <th className={thCls} style={{ width: 80 }}>Qté/paquet</th>
              <th className={thCls} style={{ minWidth: 130 }}>Remise</th>
              <th className={thCls} style={{ width: 90 }}>Prix final</th>
              <th className={thCls} style={{ width: 72 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ color, opt, optIdx }) => {
              const isFirst = optIdx === 0;
              const rowSpan = color.saleOptions.length;
              const isQuickOpen = quickCreateFor === color.tempId;
              const selectableColors = availableColors.filter((ac) => ac.id === color.colorId || !usedColorIds.includes(ac.id));
              const totalPrice = computeTotalPrice(color.unitPrice, opt);
              const finalPrice = computeFinalPrice(color.unitPrice, opt);
              const hasDiscount = finalPrice !== null && totalPrice !== null && finalPrice !== totalPrice;

              // Row background: alternate per color group
              const colorIdx = colors.findIndex((c) => c.tempId === color.tempId);
              const rowBg = colorIdx % 2 === 0 ? "bg-white" : "bg-[#FAFBFC]";

              return (
                <tr key={`${color.tempId}-${opt.tempId}`} className={`${rowBg} hover:bg-[#F1F5F9] transition-colors`}>

                  {/* ── Color-level cells (rowSpan) ── */}
                  {isFirst && (
                    <>
                      {/* ★ Radio */}
                      <td rowSpan={rowSpan} className={`${tdCls} border-r border-[#E2E8F0] text-center`} style={{ verticalAlign: "top", paddingTop: 10 }}>
                        <input type="radio" name="primaryColor" checked={color.isPrimary} onChange={() => setPrimary(color.tempId)} className="accent-[#0F3460]" title="Couleur principale" />
                      </td>

                      {/* Couleur — ColorSelect + quick create */}
                      <td rowSpan={rowSpan} className={`${tdCls} border-r border-[#E2E8F0]`} style={{ verticalAlign: "top", paddingTop: 6 }}>
                        <ColorSelect value={color.colorId} options={selectableColors} onChange={(id) => handleColorSelect(color.tempId, id)} />
                        {onQuickCreateColor && (
                          <button type="button" onClick={() => setQuickCreateFor(isQuickOpen ? null : color.tempId)}
                            className="mt-1 text-[10px] text-[#0F3460] hover:text-[#0A2540] font-medium font-[family-name:var(--font-roboto)]"
                          >
                            {isQuickOpen ? "✕ Annuler" : "+ Créer une couleur"}
                          </button>
                        )}
                        {isQuickOpen && (
                          <QuickCreateColorForm
                            onSave={(name, hex) => handleQuickCreate(color.tempId, name, hex)}
                            onCancel={() => setQuickCreateFor(null)}
                          />
                        )}
                      </td>

                      {/* Prix unitaire */}
                      <td rowSpan={rowSpan} className={`${tdCls} border-r border-[#E2E8F0]`} style={{ verticalAlign: "top", paddingTop: 6 }}>
                        <input type="number" min="0" step="0.01" value={color.unitPrice} placeholder="0.00"
                          onChange={(e) => updateColor(color.tempId, { unitPrice: e.target.value })}
                          className="w-full border border-[#E2E8F0] px-1.5 py-1 text-xs text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
                        />
                      </td>

                      {/* Poids */}
                      <td rowSpan={rowSpan} className={`${tdCls} border-r border-[#E2E8F0]`} style={{ verticalAlign: "top", paddingTop: 6 }}>
                        <input type="number" min="0" step="0.001" value={color.weight} placeholder="0.008"
                          onChange={(e) => updateColor(color.tempId, { weight: e.target.value })}
                          className="w-full border border-[#E2E8F0] px-1.5 py-1 text-xs text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
                        />
                      </td>

                      {/* Stock */}
                      <td rowSpan={rowSpan} className={`${tdCls} border-r border-[#E2E8F0]`} style={{ verticalAlign: "top", paddingTop: 6 }}>
                        <input type="number" min="0" step="1" value={color.stock} placeholder="0"
                          onChange={(e) => updateColor(color.tempId, { stock: e.target.value })}
                          className="w-full border border-[#E2E8F0] px-1.5 py-1 text-xs text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
                        />
                      </td>
                    </>
                  )}

                  {/* ── Option-level cells ── */}

                  {/* Type vente */}
                  <td className={`${tdCls} border-r border-[#E2E8F0]`}>
                    <div className="flex gap-1">
                      {(["UNIT", "PACK"] as const).map((type) => (
                        <button key={type} type="button"
                          onClick={() => updateSaleOption(color.tempId, opt.tempId, { saleType: type, packQuantity: type === "UNIT" ? "" : opt.packQuantity })}
                          className={`px-2 py-0.5 text-[10px] font-semibold border transition-colors font-[family-name:var(--font-roboto)] ${opt.saleType === type ? "bg-[#0F3460] text-white border-[#0F3460]" : "bg-white text-[#475569] border-[#E2E8F0] hover:border-[#0F3460]"}`}
                        >
                          {type === "UNIT" ? "Unité" : "Paquet"}
                        </button>
                      ))}
                    </div>
                  </td>

                  {/* Qté/paquet */}
                  <td className={`${tdCls} border-r border-[#E2E8F0]`}>
                    {opt.saleType === "PACK" ? (
                      <input type="number" min="2" max="99999" value={opt.packQuantity} placeholder="12"
                        onChange={(e) => updateSaleOption(color.tempId, opt.tempId, { packQuantity: e.target.value })}
                        className="w-full border border-[#E2E8F0] px-1.5 py-1 text-xs text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
                      />
                    ) : (
                      <span className="text-[#94A3B8] text-[10px] px-1">—</span>
                    )}
                  </td>

                  {/* Remise */}
                  <td className={`${tdCls} border-r border-[#E2E8F0]`}>
                    <div className="flex items-center gap-1">
                      <select value={opt.discountType}
                        onChange={(e) => updateSaleOption(color.tempId, opt.tempId, { discountType: e.target.value as "" | "PERCENT" | "AMOUNT", discountValue: "" })}
                        className="border border-[#E2E8F0] px-1 py-1 text-[10px] font-[family-name:var(--font-roboto)] focus:outline-none focus:border-[#0F3460] bg-white text-[#0F172A]"
                      >
                        <option value="">Aucune</option>
                        <option value="PERCENT">%</option>
                        <option value="AMOUNT">€</option>
                      </select>
                      {opt.discountType && (
                        <input type="number" min="0" step="0.01" value={opt.discountValue} placeholder="0"
                          onChange={(e) => updateSaleOption(color.tempId, opt.tempId, { discountValue: e.target.value })}
                          className="w-14 border border-[#E2E8F0] px-1.5 py-1 text-[10px] text-right focus:outline-none focus:border-[#0F3460] font-[family-name:var(--font-roboto)]"
                        />
                      )}
                    </div>
                  </td>

                  {/* Prix final */}
                  <td className={`${tdCls} border-r border-[#E2E8F0]`}>
                    {finalPrice !== null ? (
                      <div className="flex flex-col items-end">
                        {hasDiscount && totalPrice !== null && (
                          <span className="text-[9px] text-[#94A3B8] line-through">{totalPrice.toFixed(2)} €</span>
                        )}
                        <span className={`text-xs font-semibold font-[family-name:var(--font-poppins)] ${hasDiscount ? "text-emerald-600" : "text-[#0F172A]"}`}>
                          {finalPrice.toFixed(2)} €
                        </span>
                        {opt.saleType === "PACK" && opt.packQuantity && (
                          <span className="text-[9px] text-[#94A3B8]">({color.unitPrice} × {opt.packQuantity})</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[#94A3B8] text-[10px]">—</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className={tdCls}>
                    <div className="flex items-center justify-center gap-1">
                      {isFirst && color.saleOptions.length < 2 && (
                        <button type="button" onClick={() => addSaleOption(color.tempId)} title="Ajouter une option de vente"
                          className="text-[#0F3460] hover:text-[#0A2540] transition-colors p-0.5"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                      )}
                      {color.saleOptions.length > 1 && (
                        <button type="button" onClick={() => removeSaleOption(color.tempId, opt.tempId)} title="Supprimer cette option"
                          className="text-[#94A3B8] hover:text-red-500 transition-colors p-0.5"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                      {isFirst && (
                        <button type="button" onClick={() => removeColor(color.tempId)} title="Supprimer cette couleur"
                          className="text-red-300 hover:text-red-600 transition-colors p-0.5 ml-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bouton ajouter couleur */}
      <button type="button" onClick={addColor}
        disabled={availableColors.length === 0 || colors.length >= availableColors.length}
        className="w-full border-2 border-dashed border-[#E2E8F0] py-2.5 text-sm font-[family-name:var(--font-roboto)] text-[#0F3460] hover:border-[#0F3460] transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" /></svg>
        Ajouter une couleur
      </button>

      {/* ── Images par couleur ── */}
      {colors.length > 0 && (
        <div className="space-y-4 border-t border-[#E2E8F0] pt-4">
          <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider font-[family-name:var(--font-roboto)]">
            Images par couleur (partagées entre toutes les options de la même couleur)
          </p>
          {colors.map((color, colorIdx) => (
            <div key={color.tempId} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full border border-[#E2E8F0] shrink-0" style={{ backgroundColor: color.colorHex || "#94A3B8" }} />
                <span className="text-xs font-medium text-[#0F172A] font-[family-name:var(--font-roboto)]">
                  {color.colorName || `Couleur ${colorIdx + 1}`}
                </span>
              </div>
              <ImageDropzone
                colorIndex={colorIdx}
                previews={color.imagePreviews}
                onAdd={(files) => handleAddImages(color.tempId, files)}
                onRemove={(idx) => handleRemoveImage(color.tempId, idx)}
                onReorder={(from, to) => handleReorderImage(color.tempId, from, to)}
                uploading={color.uploading}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
