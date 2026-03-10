"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ColorVariantManager, { ColorState, AvailableColor } from "./ColorVariantManager";
import { createProduct, updateProduct } from "@/app/actions/admin/products";
import {
  createColorQuick,
  createCategoryQuick,
  createSubCategoryQuick,
  createCompositionQuick,
} from "@/app/actions/admin/quick-create";

interface Category {
  id: string;
  name: string;
  subCategories: { id: string; name: string }[];
}

export interface AvailableComposition {
  id: string;
  name: string;
}

export interface AvailableProduct {
  id: string;
  name: string;
  reference: string;
}

interface CompositionItem {
  compositionId: string;
  percentage: string;
}

interface ProductFormProps {
  categories: Category[];
  availableColors: AvailableColor[];
  availableCompositions: AvailableComposition[];
  allProducts: AvailableProduct[];
  mode?: "create" | "edit";
  productId?: string;
  initialData?: {
    reference: string;
    name: string;
    description: string;
    categoryId: string;
    subCategoryIds: string[];
    colors: ColorState[];
    compositions: CompositionItem[];
    similarProductIds: string[];
    dimLength: string;
    dimWidth: string;
    dimHeight: string;
    dimDiameter: string;
    dimCircumference: string;
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function defaultColor(availableColors: AvailableColor[]): ColorState {
  const first = availableColors[0];
  return {
    tempId:    uid(),
    colorId:   first?.id   ?? "",
    colorName: first?.name ?? "",
    colorHex:  first?.hex  ?? "#94A3B8",
    unitPrice: "",
    weight:    "",
    stock:     "",
    isPrimary: true,
    saleOptions: [{
      tempId: uid(), saleType: "UNIT", packQuantity: "",
      size: "", discountType: "", discountValue: "",
    }],
    imagePreviews: [], imageFiles: [], uploadedPaths: [], uploading: false,
  };
}

export default function ProductForm({
  categories,
  availableColors,
  availableCompositions,
  allProducts,
  mode = "create",
  productId,
  initialData,
}: ProductFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ── Local lists — allow inline creation to append items ─────────────────
  const [localCategories,   setLocalCategories]   = useState(categories);
  const [localCompositions, setLocalCompositions] = useState(availableCompositions);
  const [localColors,       setLocalColors]       = useState(availableColors);

  // ── Form fields ──────────────────────────────────────────────────────────
  const [reference,       setReference]       = useState(initialData?.reference       ?? "");
  const [name,            setName]            = useState(initialData?.name            ?? "");
  const [description,     setDescription]     = useState(initialData?.description     ?? "");
  const [categoryId,      setCategoryId]      = useState(initialData?.categoryId      ?? "");
  const [subCategoryIds,  setSubCategoryIds]  = useState<string[]>(initialData?.subCategoryIds ?? []);
  const [colors, setColors] = useState<ColorState[]>(
    initialData?.colors ??
    (availableColors.length > 0 ? [defaultColor(availableColors)] : [])
  );
  const [compositions, setCompositions] = useState<CompositionItem[]>(initialData?.compositions ?? []);
  const [similarProductIds, setSimilarProductIds] = useState<string[]>(initialData?.similarProductIds ?? []);

  // ── Dimensions ───────────────────────────────────────────────────────────
  const [dimLength,        setDimLength]        = useState(initialData?.dimLength        ?? "");
  const [dimWidth,         setDimWidth]         = useState(initialData?.dimWidth         ?? "");
  const [dimHeight,        setDimHeight]        = useState(initialData?.dimHeight        ?? "");
  const [dimDiameter,      setDimDiameter]      = useState(initialData?.dimDiameter      ?? "");
  const [dimCircumference, setDimCircumference] = useState(initialData?.dimCircumference ?? "");

  const [error, setError] = useState("");

  // ── Composition picker state ─────────────────────────────────────────────
  const [newCompId, setNewCompId] = useState("");

  // ── Inline creation: catégorie ───────────────────────────────────────────
  const [showCatCreate,  setShowCatCreate]  = useState(false);
  const [newCatName,     setNewCatName]     = useState("");
  const [catCreateError, setCatCreateError] = useState("");

  // ── Inline creation: sous-catégorie ─────────────────────────────────────
  const [showSubCatCreate,  setShowSubCatCreate]  = useState(false);
  const [newSubCatName,     setNewSubCatName]     = useState("");
  const [subCatCreateError, setSubCatCreateError] = useState("");

  // ── Inline creation: composition ────────────────────────────────────────
  const [showCompCreate,  setShowCompCreate]  = useState(false);
  const [newCompName,     setNewCompName]     = useState("");
  const [compCreateError, setCompCreateError] = useState("");

  const selectedCategory = localCategories.find((c) => c.id === categoryId);
  const subCategories    = selectedCategory?.subCategories ?? [];

  function toggleSubCategory(id: string) {
    setSubCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // ── Composition helpers ──────────────────────────────────────────────────
  const totalPct = compositions.reduce((sum, c) => sum + parseFloat(c.percentage || "0"), 0);

  function addComposition() {
    if (!newCompId) return;
    if (compositions.some((c) => c.compositionId === newCompId)) return;
    const evenPct = (100 / (compositions.length + 1)).toFixed(1);
    const updated = compositions.map((c) => ({ ...c, percentage: evenPct }));
    setCompositions([...updated, { compositionId: newCompId, percentage: evenPct }]);
    setNewCompId("");
  }

  function updateCompositionPct(compositionId: string, pct: string) {
    setCompositions(compositions.map((c) =>
      c.compositionId === compositionId ? { ...c, percentage: pct } : c
    ));
  }

  function removeComposition(compositionId: string) {
    const remaining = compositions.filter((c) => c.compositionId !== compositionId);
    if (remaining.length === 0) { setCompositions([]); return; }
    const evenPct = (100 / remaining.length).toFixed(1);
    setCompositions(remaining.map((c) => ({ ...c, percentage: evenPct })));
  }

  // ── Quick-create handlers ────────────────────────────────────────────────
  async function handleQuickCreateColor(colorName: string, hex: string | null): Promise<AvailableColor> {
    const created = await createColorQuick(colorName, hex);
    setLocalColors((prev) => [...prev, created]);
    return created;
  }

  async function handleCreateCategory() {
    if (!newCatName.trim()) { setCatCreateError("Nom requis."); return; }
    setCatCreateError("");
    try {
      const created = await createCategoryQuick(newCatName.trim());
      setLocalCategories((prev) => [...prev, created]);
      setCategoryId(created.id);
      setSubCategoryIds([]);
      setNewCatName("");
      setShowCatCreate(false);
    } catch (e: unknown) {
      setCatCreateError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function handleCreateSubCategory() {
    if (!newSubCatName.trim()) { setSubCatCreateError("Nom requis."); return; }
    if (!categoryId) { setSubCatCreateError("Sélectionnez d'abord une catégorie."); return; }
    setSubCatCreateError("");
    try {
      const created = await createSubCategoryQuick(newSubCatName.trim(), categoryId);
      setLocalCategories((prev) =>
        prev.map((cat) =>
          cat.id === categoryId
            ? { ...cat, subCategories: [...cat.subCategories, created] }
            : cat
        )
      );
      setSubCategoryIds((prev) => [...prev, created.id]);
      setNewSubCatName("");
      setShowSubCatCreate(false);
    } catch (e: unknown) {
      setSubCatCreateError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function handleCreateComposition() {
    if (!newCompName.trim()) { setCompCreateError("Nom requis."); return; }
    setCompCreateError("");
    try {
      const created = await createCompositionQuick(newCompName.trim());
      setLocalCompositions((prev) => [...prev, created]);
      setNewCompName("");
      setShowCompCreate(false);
    } catch (e: unknown) {
      setCompCreateError(e instanceof Error ? e.message : "Erreur");
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!reference.trim())   return setError("La référence est requise.");
    if (!name.trim())        return setError("Le nom est requis.");
    if (!description.trim()) return setError("La description est requise.");
    if (!categoryId)         return setError("Veuillez choisir une catégorie.");
    if (colors.length === 0) return setError("Ajoutez au moins une couleur.");

    for (const color of colors) {
      if (!color.colorId) return setError("Chaque variante doit avoir une couleur sélectionnée.");
      const price = parseFloat(color.unitPrice);
      if (isNaN(price) || price <= 0) return setError(`Prix invalide pour "${color.colorName || "la couleur"}".`);
      const w = parseFloat(color.weight);
      if (isNaN(w) || w <= 0) return setError(`Poids invalide pour "${color.colorName || "la couleur"}".`);
      if (color.stock !== "" && parseInt(color.stock) < 0)
        return setError(`Stock invalide pour "${color.colorName || "la couleur"}" (doit être ≥ 0).`);
      if (color.saleOptions.length === 0) return setError("Chaque couleur doit avoir au moins une option de vente.");
      for (const opt of color.saleOptions) {
        if (opt.saleType === "PACK") {
          const qty = parseInt(opt.packQuantity);
          if (isNaN(qty) || qty < 2) return setError(`Quantité paquet invalide pour "${color.colorName}" (minimum 2).`);
        }
      }
      const packKeys = color.saleOptions
        .filter((o) => o.saleType === "PACK")
        .map((o) => `${o.packQuantity}__${o.size.trim().toLowerCase()}`);
      const hasDuplicate = packKeys.some((k, i) => packKeys.indexOf(k) !== i);
      if (hasDuplicate) return setError(`La couleur "${color.colorName}" a deux paquets avec la même quantité et la même taille.`);
      if (color.uploading) return setError("Des images sont encore en cours d'upload. Veuillez patienter.");
    }

    if (compositions.length > 0 && Math.abs(totalPct - 100) > 0.5) {
      return setError(`La composition doit totaliser 100%. Total actuel : ${totalPct.toFixed(1)}%`);
    }

    const payload = {
      reference:     reference.trim().toUpperCase(),
      name:          name.trim(),
      description:   description.trim(),
      categoryId,
      subCategoryIds,
      colors: colors.map((c) => ({
        colorId:   c.colorId,
        unitPrice: parseFloat(c.unitPrice),
        weight:    parseFloat(c.weight),
        stock:     parseInt(c.stock) || 0,
        isPrimary: c.isPrimary,
        imagePaths: c.uploadedPaths,
        saleOptions: c.saleOptions.map((opt) => ({
          saleType:      opt.saleType,
          packQuantity:  opt.saleType === "PACK" ? parseInt(opt.packQuantity) : null,
          size:          opt.size.trim() || null,
          discountType:  opt.discountType || null,
          discountValue: opt.discountValue ? parseFloat(opt.discountValue) : null,
        })),
      })),
      compositions: compositions.map((c) => ({
        compositionId: c.compositionId,
        percentage:    parseFloat(c.percentage),
      })),
      similarProductIds,
      dimensionLength:        dimLength        ? parseFloat(dimLength)        : null,
      dimensionWidth:         dimWidth         ? parseFloat(dimWidth)         : null,
      dimensionHeight:        dimHeight        ? parseFloat(dimHeight)        : null,
      dimensionDiameter:      dimDiameter      ? parseFloat(dimDiameter)      : null,
      dimensionCircumference: dimCircumference ? parseFloat(dimCircumference) : null,
    };

    startTransition(async () => {
      try {
        if (mode === "edit" && productId) {
          await updateProduct(productId, payload);
        } else {
          await createProduct(payload);
        }
        router.push("/admin/produits");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Une erreur est survenue.");
      }
    });
  }

  const otherProducts = allProducts.filter((p) => p.id !== productId);

  function toggleSimilar(id: string) {
    setSimilarProductIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">

      {/* ── Informations de base ── */}
      <section className="bg-white border border-[#E2E8F0] p-8 space-y-6">
        <h2 className="font-[family-name:var(--font-poppins)] text-xl font-bold text-[#0F172A] border-b border-[#F1F5F9] pb-4">
          Informations du produit
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Référence produit *" hint="Ex: BJ-COL-001">
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value.toUpperCase())}
              placeholder="BJ-COL-001"
              className="field-input"
              required
            />
          </Field>
          <Field label="Nom du produit *">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Collier sautoir doré"
              className="field-input"
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

          {/* ── Catégorie ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#475569]">
                Catégorie *
              </label>
              <button
                type="button"
                onClick={() => { setShowCatCreate((v) => !v); setCatCreateError(""); setNewCatName(""); }}
                className="text-xs text-[#0F3460] hover:text-[#0A2540] font-medium font-[family-name:var(--font-roboto)] transition-colors"
              >
                + Créer une catégorie
              </button>
            </div>
            <select
              value={categoryId}
              onChange={(e) => { setCategoryId(e.target.value); setSubCategoryIds([]); setShowSubCatCreate(false); }}
              className="field-input"
              required
            >
              <option value="">— Sélectionner —</option>
              {localCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            {showCatCreate && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Nom de la catégorie"
                  className="border border-[#E2E8F0] px-2.5 py-2 text-sm font-[family-name:var(--font-roboto)] text-[#0F172A] focus:outline-none focus:border-[#0F3460] flex-1 min-w-0"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateCategory(); } }}
                />
                <button type="button" onClick={handleCreateCategory} disabled={!newCatName.trim()}
                  className="px-3 py-2 bg-[#0F3460] text-white text-xs font-[family-name:var(--font-roboto)] hover:bg-[#0A2540] transition-colors disabled:opacity-50 shrink-0"
                >Ajouter</button>
                <button type="button" onClick={() => { setShowCatCreate(false); setCatCreateError(""); }}
                  className="px-3 py-2 border border-[#E2E8F0] text-xs font-[family-name:var(--font-roboto)] text-[#475569] hover:border-[#0F3460] transition-colors shrink-0"
                >Annuler</button>
                {catCreateError && <span className="text-xs text-red-500 font-[family-name:var(--font-roboto)] w-full">{catCreateError}</span>}
              </div>
            )}
          </div>

          {/* ── Sous-catégories (multi) ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#475569]">
                Sous-catégories
                {subCategoryIds.length > 0 && (
                  <span className="ml-2 font-normal text-[#94A3B8]">({subCategoryIds.length} sélectionnée{subCategoryIds.length > 1 ? "s" : ""})</span>
                )}
              </label>
              {categoryId && (
                <button
                  type="button"
                  onClick={() => { setShowSubCatCreate((v) => !v); setSubCatCreateError(""); setNewSubCatName(""); }}
                  className="text-xs text-[#0F3460] hover:text-[#0A2540] font-medium font-[family-name:var(--font-roboto)] transition-colors"
                >
                  + Créer une sous-catégorie
                </button>
              )}
            </div>

            {!categoryId ? (
              <p className="text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] py-2">
                Sélectionnez d&apos;abord une catégorie.
              </p>
            ) : subCategories.length === 0 && !showSubCatCreate ? (
              <p className="text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] py-2">
                Aucune sous-catégorie — créez-en une.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 min-h-[38px] items-start">
                {subCategories.map((sub) => {
                  const selected = subCategoryIds.includes(sub.id);
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => toggleSubCategory(sub.id)}
                      className={`px-3 py-1.5 text-sm border transition-colors font-[family-name:var(--font-roboto)] ${
                        selected
                          ? "bg-[#0F3460] text-white border-[#0F3460]"
                          : "bg-white text-[#475569] border-[#E2E8F0] hover:border-[#0F3460]"
                      }`}
                    >
                      {sub.name}
                    </button>
                  );
                })}
              </div>
            )}

            {showSubCatCreate && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={newSubCatName}
                  onChange={(e) => setNewSubCatName(e.target.value)}
                  placeholder="Nom de la sous-catégorie"
                  className="border border-[#E2E8F0] px-2.5 py-2 text-sm font-[family-name:var(--font-roboto)] text-[#0F172A] focus:outline-none focus:border-[#0F3460] flex-1 min-w-0"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateSubCategory(); } }}
                />
                <button type="button" onClick={handleCreateSubCategory} disabled={!newSubCatName.trim()}
                  className="px-3 py-2 bg-[#0F3460] text-white text-xs font-[family-name:var(--font-roboto)] hover:bg-[#0A2540] transition-colors disabled:opacity-50 shrink-0"
                >Ajouter</button>
                <button type="button" onClick={() => { setShowSubCatCreate(false); setSubCatCreateError(""); }}
                  className="px-3 py-2 border border-[#E2E8F0] text-xs font-[family-name:var(--font-roboto)] text-[#475569] hover:border-[#0F3460] transition-colors shrink-0"
                >Annuler</button>
                {subCatCreateError && <span className="text-xs text-red-500 font-[family-name:var(--font-roboto)] w-full">{subCatCreateError}</span>}
              </div>
            )}
          </div>
        </div>

        <Field label="Description *">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Description commerciale du produit…"
            className="field-input resize-none"
            required
          />
        </Field>

        {/* ── Dimensions ── */}
        <div className="border-t border-[#F1F5F9] pt-5 space-y-3">
          <div>
            <p className="text-sm font-semibold text-[#475569] font-[family-name:var(--font-roboto)]">Dimensions</p>
            <p className="text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] mt-0.5">
              En millimètres (mm) — laisser vide si non applicable.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <Field label="Longueur">
              <input type="number" min="0" step="0.1" value={dimLength} placeholder="—"
                onChange={(e) => setDimLength(e.target.value)} className="field-input text-right" />
            </Field>
            <Field label="Largeur">
              <input type="number" min="0" step="0.1" value={dimWidth} placeholder="—"
                onChange={(e) => setDimWidth(e.target.value)} className="field-input text-right" />
            </Field>
            <Field label="Hauteur">
              <input type="number" min="0" step="0.1" value={dimHeight} placeholder="—"
                onChange={(e) => setDimHeight(e.target.value)} className="field-input text-right" />
            </Field>
            <Field label="Diamètre">
              <input type="number" min="0" step="0.1" value={dimDiameter} placeholder="—"
                onChange={(e) => setDimDiameter(e.target.value)} className="field-input text-right" />
            </Field>
            <Field label="Circonférence">
              <input type="number" min="0" step="0.1" value={dimCircumference} placeholder="—"
                onChange={(e) => setDimCircumference(e.target.value)} className="field-input text-right" />
            </Field>
          </div>
        </div>

        {/* ── Composition (intégrée) ── */}
        <div className="border-t border-[#F1F5F9] pt-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[#475569] font-[family-name:var(--font-roboto)]">
                Composition
              </p>
              <p className="text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] mt-0.5">
                Matériaux et pourcentages.
                {localCompositions.length === 0 && (
                  <span className="text-amber-600 ml-1">
                    Aucune composition.{" "}
                    <a href="/admin/compositions" target="_blank" className="underline">Créez-en d&apos;abord.</a>
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setShowCompCreate((v) => !v); setCompCreateError(""); setNewCompName(""); }}
              className="text-xs text-[#0F3460] hover:text-[#0A2540] font-medium font-[family-name:var(--font-roboto)] transition-colors"
            >
              + Créer un matériau
            </button>
          </div>

          {showCompCreate && (
            <div className="flex items-center gap-2 flex-wrap">
              <input type="text" value={newCompName} onChange={(e) => setNewCompName(e.target.value)}
                placeholder="Nom du matériau"
                className="border border-[#E2E8F0] px-2.5 py-2 text-sm font-[family-name:var(--font-roboto)] text-[#0F172A] focus:outline-none focus:border-[#0F3460] flex-1 min-w-0"
                autoFocus onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateComposition(); } }}
              />
              <button type="button" onClick={handleCreateComposition} disabled={!newCompName.trim()}
                className="px-3 py-2 bg-[#0F3460] text-white text-xs font-[family-name:var(--font-roboto)] hover:bg-[#0A2540] transition-colors disabled:opacity-50 shrink-0"
              >Ajouter</button>
              <button type="button" onClick={() => { setShowCompCreate(false); setCompCreateError(""); }}
                className="px-3 py-2 border border-[#E2E8F0] text-xs font-[family-name:var(--font-roboto)] text-[#475569] hover:border-[#0F3460] transition-colors shrink-0"
              >Annuler</button>
              {compCreateError && <span className="text-xs text-red-500 w-full">{compCreateError}</span>}
            </div>
          )}

          {localCompositions.length > 0 && (
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <select value={newCompId} onChange={(e) => setNewCompId(e.target.value)} className="field-input">
                  <option value="">— Choisir un matériau —</option>
                  {localCompositions
                    .filter((c) => !compositions.some((x) => x.compositionId === c.id))
                    .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <button type="button" onClick={addComposition} disabled={!newCompId}
                className="px-5 py-2.5 bg-[#0F3460] text-white text-sm font-medium hover:bg-[#0A2540] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 font-[family-name:var(--font-roboto)]"
              >Ajouter</button>
            </div>
          )}

          {compositions.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#475569] font-[family-name:var(--font-roboto)]">
                  {compositions.length} matériau{compositions.length > 1 ? "x" : ""}
                </span>
                <span className={`text-sm font-semibold px-3 py-1 font-[family-name:var(--font-roboto)] ${
                  Math.abs(totalPct - 100) <= 0.5
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}>
                  Total : {totalPct.toFixed(1)} %{Math.abs(totalPct - 100) <= 0.5 ? " ✓" : " ≠ 100%"}
                </span>
              </div>
              <ul className="divide-y divide-[#F1F5F9] border border-[#E2E8F0]">
                {compositions.map((item) => {
                  const comp = localCompositions.find((c) => c.id === item.compositionId);
                  return (
                    <li key={item.compositionId} className="flex items-center justify-between px-5 py-3 gap-4">
                      <span className="text-sm font-medium text-[#0F172A] font-[family-name:var(--font-roboto)] flex-1 min-w-0 truncate">
                        {comp?.name ?? item.compositionId}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input type="number" min="0" max="100" step="0.1" value={item.percentage}
                          onChange={(e) => updateCompositionPct(item.compositionId, e.target.value)}
                          className="w-24 border border-[#E2E8F0] px-2.5 py-1.5 text-sm text-right font-[family-name:var(--font-roboto)] text-[#0F172A] focus:outline-none focus:border-[#0F3460]"
                        />
                        <span className="text-sm text-[#475569]">%</span>
                      </div>
                      <button type="button" onClick={() => removeComposition(item.compositionId)}
                        className="text-red-400 hover:text-red-600 transition-colors text-sm shrink-0"
                      >Retirer</button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </section>

      {/* ── Variantes couleur ── */}
      <section className="bg-white border border-[#E2E8F0] p-8 space-y-5">
        <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-4">
          <h2 className="font-[family-name:var(--font-poppins)] text-xl font-bold text-[#0F172A]">
            Variantes couleur
          </h2>
          <span className="text-sm text-[#94A3B8] font-[family-name:var(--font-roboto)]">
            {colors.length} couleur{colors.length > 1 ? "s" : ""}
          </span>
        </div>
        <ColorVariantManager
          colors={colors}
          availableColors={localColors}
          onChange={setColors}
          onQuickCreateColor={handleQuickCreateColor}
        />
      </section>

      {/* ── Produits similaires ── */}
      {otherProducts.length > 0 && (
        <section className="bg-white border border-[#E2E8F0] p-8 space-y-5">
          <div className="border-b border-[#F1F5F9] pb-4">
            <h2 className="font-[family-name:var(--font-poppins)] text-xl font-bold text-[#0F172A]">
              Produits similaires
            </h2>
            <p className="text-sm text-[#94A3B8] font-[family-name:var(--font-roboto)] mt-1">
              Ces produits seront affichés dans la section &quot;Vous aimerez aussi&quot; sur la fiche client.
            </p>
          </div>
          <ProductPicker products={otherProducts} selected={similarProductIds} onToggle={toggleSimilar} />
        </section>
      )}

      {/* ── Erreur + Boutons ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-5 py-4 text-sm font-[family-name:var(--font-roboto)]">
          {error}
        </div>
      )}

      <div className="flex items-center gap-4 pt-2 pb-8">
        <button type="submit" disabled={isPending}
          className="px-10 py-3.5 bg-[#0F3460] text-white font-[family-name:var(--font-poppins)] font-semibold text-base hover:bg-[#0A2540] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending
            ? mode === "edit" ? "Enregistrement…" : "Création en cours…"
            : mode === "edit" ? "Enregistrer les modifications" : "Créer le produit"}
        </button>
        <a href="/admin/produits"
          className="px-7 py-3.5 border border-[#E2E8F0] text-sm font-[family-name:var(--font-roboto)] text-[#475569] hover:border-[#0F3460] hover:text-[#0F172A] transition-colors"
        >
          Annuler
        </a>
      </div>
    </form>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#475569] mb-1.5">
        {label}
        {hint && <span className="ml-2 font-normal text-[#94A3B8]">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ── ProductPicker ─────────────────────────────────────────────────────────
function ProductPicker({ products, selected, onToggle }: {
  products: AvailableProduct[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.reference.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((id) => {
            const p = products.find((x) => x.id === id);
            if (!p) return null;
            return (
              <span key={id} className="flex items-center gap-1.5 bg-[#0F3460] text-white text-xs px-3 py-1.5 font-[family-name:var(--font-roboto)]">
                {p.name}
                <button type="button" onClick={() => onToggle(id)} className="hover:text-[#94A3B8] transition-colors text-base leading-none">×</button>
              </span>
            );
          })}
        </div>
      )}
      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher un produit…" className="field-input" />
      <div className="max-h-52 overflow-y-auto border border-[#E2E8F0] divide-y divide-[#F1F5F9]">
        {filtered.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[#94A3B8] font-[family-name:var(--font-roboto)]">Aucun résultat</p>
        ) : filtered.map((p) => (
          <button key={p.id} type="button" onClick={() => onToggle(p.id)}
            className={`w-full flex items-center justify-between px-5 py-3 text-left transition-colors hover:bg-[#F1F5F9] ${selected.includes(p.id) ? "bg-[#F1F5F9]" : ""}`}
          >
            <div>
              <p className="text-sm font-medium text-[#0F172A] font-[family-name:var(--font-roboto)]">{p.name}</p>
              <p className="text-xs text-[#94A3B8] font-mono">{p.reference}</p>
            </div>
            {selected.includes(p.id) && (
              <svg className="w-5 h-5 text-[#0F3460] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
