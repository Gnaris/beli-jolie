"use client";

import ImageDropzone from "./ImageDropzone";

// ─────────────────────────────────────────────
// Types exportés
// ─────────────────────────────────────────────
export interface SaleOptionState {
  tempId: string;
  saleType: "UNIT" | "PACK";
  packQuantity: string;
  stock: string;
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

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function defaultSaleOption(type: "UNIT" | "PACK" = "UNIT"): SaleOptionState {
  return { tempId: uid(), saleType: type, packQuantity: "", stock: "", discountType: "", discountValue: "" };
}

// ─────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────
export default function ColorVariantManager({ colors, availableColors, onChange }: ColorVariantManagerProps) {

  // ── Helpers ────────────────────────────────────────────────────────────
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
    const first   = availableColors.find((ac) => !usedIds.includes(ac.id));
    if (!first && availableColors.length === 0) return;

    onChange([...colors, {
      tempId: uid(),
      colorId:   first?.id   ?? "",
      colorName: first?.name ?? "",
      colorHex:  first?.hex  ?? "#B8A48A",
      unitPrice: "",
      weight:    "",
      isPrimary: colors.length === 0, // Première couleur = primaire par défaut
      saleOptions: [defaultSaleOption("UNIT")],
      imagePreviews: [], imageFiles: [], uploadedPaths: [], uploading: false,
    }]);
  }

  function removeColor(tempId: string) {
    onChange(colors.filter((c) => c.tempId !== tempId));
  }

  function handleColorSelect(colorTempId: string, colorId: string) {
    const selected = availableColors.find((ac) => ac.id === colorId);
    if (!selected) return;
    updateColor(colorTempId, {
      colorId,
      colorName: selected.name,
      colorHex:  selected.hex ?? "#B8A48A",
    });
  }

  function addSaleOption(colorTempId: string) {
    onChange(colors.map((c) => {
      if (c.tempId !== colorTempId) return c;
      return { ...c, saleOptions: [...c.saleOptions, defaultSaleOption("PACK")] };
    }));
  }

  function removeSaleOption(colorTempId: string, optTempId: string) {
    onChange(colors.map((c) => {
      if (c.tempId !== colorTempId) return c;
      return { ...c, saleOptions: c.saleOptions.filter((o) => o.tempId !== optTempId) };
    }));
  }

  // ── Images ─────────────────────────────────────────────────────────────
  async function handleAddImages(colorTempId: string, files: File[]) {
    const color = colors.find((c) => c.tempId === colorTempId);
    if (!color) return;

    const blobs = files.map((f) => URL.createObjectURL(f));
    updateColor(colorTempId, {
      imagePreviews: [...color.imagePreviews, ...blobs],
      imageFiles:    [...color.imageFiles, ...files],
      uploading:     true,
    });

    const uploadedPaths: string[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("image", file);
      try {
        const res  = await fetch("/api/admin/products/images", { method: "POST", body: fd });
        const json = await res.json();
        if (res.ok) uploadedPaths.push(json.path);
      } catch { console.error("Erreur upload image"); }
    }

    onChange((prev: ColorState[]) =>
      prev.map((c) => c.tempId !== colorTempId ? c : {
        ...c, uploadedPaths: [...c.uploadedPaths, ...uploadedPaths], uploading: false,
      })
    );
  }

  function handleRemoveImage(colorTempId: string, imgIndex: number) {
    onChange(colors.map((c) => {
      if (c.tempId !== colorTempId) return c;
      return {
        ...c,
        imagePreviews: c.imagePreviews.filter((_, i) => i !== imgIndex),
        imageFiles:    c.imageFiles.filter((_, i)    => i !== imgIndex),
        uploadedPaths: c.uploadedPaths.filter((_, i) => i !== imgIndex),
      };
    }));
  }

  function handleReorderImage(colorTempId: string, fromIdx: number, toIdx: number) {
    onChange(colors.map((c) => {
      if (c.tempId !== colorTempId) return c;
      const reorder = <T,>(arr: T[]): T[] => {
        const r = [...arr];
        const [item] = r.splice(fromIdx, 1);
        r.splice(toIdx, 0, item);
        return r;
      };
      return {
        ...c,
        imagePreviews: reorder(c.imagePreviews),
        imageFiles:    c.imageFiles.length > 0 ? reorder(c.imageFiles) : [],
        uploadedPaths: reorder(c.uploadedPaths),
      };
    }));
  }

  // ─────────────────────────────────────────────────────────────────────
  const usedColorIds = colors.map((c) => c.colorId);

  return (
    <div className="space-y-4">
      {colors.length === 0 && (
        <div className="text-center py-8 border-2 border-dashed border-[#D4CCBE] text-[#B8A48A] text-sm font-[family-name:var(--font-roboto)]">
          {availableColors.length === 0
            ? <>Aucune couleur dans la bibliothèque. <a href="/admin/couleurs" target="_blank" className="underline text-[#8B7355]">Créez-en d'abord.</a></>
            : 'Cliquez sur "Ajouter une couleur" pour commencer.'}
        </div>
      )}

      {colors.map((color, colorIdx) => {
        // Couleurs disponibles pour ce variant (toutes sauf celles déjà choisies par d'autres variants)
        const selectableColors = availableColors.filter(
          (ac) => ac.id === color.colorId || !usedColorIds.includes(ac.id)
        );

        return (
          <div key={color.tempId} className="border border-[#D4CCBE] bg-[#FDFAF6] overflow-hidden">
            {/* En-tête */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#EDE8DF] border-b border-[#D4CCBE]">
              <div className="flex items-center gap-3 flex-1">
                {/* Radio — couleur principale */}
                <label className="flex items-center gap-1.5 cursor-pointer shrink-0" title="Couleur principale affichée par défaut">
                  <input
                    type="radio"
                    name="primaryColor"
                    checked={color.isPrimary}
                    onChange={() => setPrimary(color.tempId)}
                    className="accent-[#8B7355]"
                  />
                  <span className="text-[10px] text-[#6B5B45] font-[family-name:var(--font-roboto)] hidden sm:inline">Principal</span>
                </label>
                {/* Aperçu couleur hex */}
                <span
                  className="w-7 h-7 rounded border border-[#D4CCBE] shrink-0"
                  style={{ backgroundColor: color.colorHex || "#B8A48A" }}
                />
                {/* Sélecteur couleur */}
                <select
                  value={color.colorId}
                  onChange={(e) => handleColorSelect(color.tempId, e.target.value)}
                  className="flex-1 bg-white border border-[#D4CCBE] px-2 py-1.5 text-sm font-[family-name:var(--font-roboto)] text-[#2C2418] focus:outline-none focus:border-[#8B7355]"
                >
                  <option value="">— Choisir une couleur —</option>
                  {selectableColors.map((ac) => (
                    <option key={ac.id} value={ac.id}>{ac.name}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => removeColor(color.tempId)}
                className="ml-3 text-red-400 hover:text-red-600 transition-colors p-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* ── Prix et poids partagés ── */}
              <div>
                <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider mb-2">
                  Prix & poids — partagés entre toutes les options de vente
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <SmallInput
                    label="Prix unitaire (€)"
                    type="number" min="0" step="0.01"
                    value={color.unitPrice}
                    onChange={(v) => updateColor(color.tempId, { unitPrice: v })}
                    placeholder="0.00"
                  />
                  <SmallInput
                    label="Poids (kg)"
                    type="number" min="0" step="0.001"
                    value={color.weight}
                    onChange={(v) => updateColor(color.tempId, { weight: v })}
                    placeholder="0.008"
                  />
                </div>
              </div>

              {/* ── Options de vente ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider">
                    Options de vente
                  </p>
                  {color.saleOptions.length < 2 && (
                    <button
                      type="button"
                      onClick={() => addSaleOption(color.tempId)}
                      className="text-xs text-[#8B7355] hover:text-[#6B5640] font-medium"
                    >
                      + Ajouter une option
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {color.saleOptions.map((opt) => {
                    const totalPrice = computeTotalPrice(color.unitPrice, opt);
                    const finalPrice = computeFinalPrice(color.unitPrice, opt);
                    return (
                      <div key={opt.tempId} className="border border-[#EDE8DF] bg-white p-3 space-y-3">
                        {/* Type + quantité + stock */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex gap-2">
                            {(["UNIT", "PACK"] as const).map((type) => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => updateSaleOption(color.tempId, opt.tempId, {
                                  saleType: type,
                                  packQuantity: type === "UNIT" ? "" : opt.packQuantity,
                                })}
                                className={`px-3 py-1 text-xs font-[family-name:var(--font-roboto)] font-semibold border transition-colors ${
                                  opt.saleType === type
                                    ? "bg-[#8B7355] text-white border-[#8B7355]"
                                    : "bg-white text-[#6B5B45] border-[#D4CCBE] hover:border-[#8B7355]"
                                }`}
                              >
                                {type === "UNIT" ? "À l'unité" : "Par paquet"}
                              </button>
                            ))}
                          </div>

                          {opt.saleType === "PACK" && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-[#6B5B45]">Qté / paquet :</span>
                              <input
                                type="number" min="2"
                                value={opt.packQuantity}
                                onChange={(e) => updateSaleOption(color.tempId, opt.tempId, { packQuantity: e.target.value })}
                                placeholder="12"
                                className="w-20 border border-[#D4CCBE] px-2 py-1 text-sm focus:outline-none focus:border-[#8B7355]"
                              />
                            </div>
                          )}

                          <div className="flex items-center gap-1.5 ml-auto">
                            <span className="text-xs text-[#6B5B45]">Stock :</span>
                            <input
                              type="number" min="0"
                              value={opt.stock}
                              onChange={(e) => updateSaleOption(color.tempId, opt.tempId, { stock: e.target.value })}
                              placeholder="0"
                              className="w-24 border border-[#D4CCBE] px-2 py-1 text-sm focus:outline-none focus:border-[#8B7355]"
                            />
                          </div>

                          {color.saleOptions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeSaleOption(color.tempId, opt.tempId)}
                              className="text-red-400 hover:text-red-600 text-xs"
                            >
                              Supprimer
                            </button>
                          )}
                        </div>

                        {/* Remise */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider mb-1">
                              Type de remise
                            </label>
                            <select
                              value={opt.discountType}
                              onChange={(e) => updateSaleOption(color.tempId, opt.tempId, {
                                discountType: e.target.value as "" | "PERCENT" | "AMOUNT",
                                discountValue: "",
                              })}
                              className="w-full border border-[#D4CCBE] px-2 py-1.5 text-sm font-[family-name:var(--font-roboto)] text-[#2C2418] focus:outline-none focus:border-[#8B7355] bg-white"
                            >
                              <option value="">Aucune remise</option>
                              <option value="PERCENT">En % (pourcentage)</option>
                              <option value="AMOUNT">En € (montant fixe)</option>
                            </select>
                          </div>
                          {opt.discountType && (
                            <SmallInput
                              label={opt.discountType === "PERCENT" ? "Remise (%)" : "Remise (€)"}
                              type="number" min="0" step="0.01"
                              value={opt.discountValue}
                              onChange={(v) => updateSaleOption(color.tempId, opt.tempId, { discountValue: v })}
                              placeholder="0"
                            />
                          )}
                        </div>

                        {/* Prix calculés */}
                        {totalPrice !== null && (
                          <div className="flex items-center gap-4 pt-1 border-t border-[#EDE8DF]">
                            <div>
                              <span className="text-[10px] text-[#B8A48A] uppercase tracking-wider font-[family-name:var(--font-roboto)]">
                                {opt.saleType === "UNIT" ? "Prix unitaire" : "Prix paquet"}
                              </span>
                              <p className="text-sm font-semibold text-[#2C2418] font-[family-name:var(--font-poppins)]">
                                {totalPrice.toFixed(2)} €
                                {opt.saleType === "PACK" && opt.packQuantity && (
                                  <span className="text-xs text-[#B8A48A] font-normal ml-1">
                                    ({color.unitPrice} € × {opt.packQuantity})
                                  </span>
                                )}
                              </p>
                            </div>
                            {finalPrice !== null && finalPrice !== totalPrice && (
                              <div>
                                <span className="text-[10px] text-[#B8A48A] uppercase tracking-wider font-[family-name:var(--font-roboto)]">Prix final</span>
                                <p className="text-sm font-semibold text-emerald-600 font-[family-name:var(--font-poppins)]">
                                  {finalPrice.toFixed(2)} €
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Images ── */}
              <div>
                <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider mb-2">
                  Images (partagées entre toutes les options de cette couleur)
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

      {/* Bouton ajouter couleur */}
      <button
        type="button"
        onClick={addColor}
        disabled={availableColors.length === 0 || colors.length >= availableColors.length}
        className="w-full border-2 border-dashed border-[#D4CCBE] py-3 text-sm font-[family-name:var(--font-roboto)] text-[#8B7355] hover:border-[#8B7355] hover:bg-[#F7F3EC] transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Ajouter une couleur
      </button>
    </div>
  );
}

// ── Mini-input réutilisable ───────────────────────────────────────────────
function SmallInput({
  label, value, onChange, placeholder, type = "text", min, step,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; min?: string; step?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider mb-1">
        {label}
      </label>
      <input
        type={type} min={min} step={step}
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-[#D4CCBE] px-2 py-1.5 text-sm font-[family-name:var(--font-roboto)] text-[#2C2418] focus:outline-none focus:border-[#8B7355]"
      />
    </div>
  );
}
