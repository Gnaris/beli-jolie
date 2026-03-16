"use client";

import { useState, useTransition, useRef } from "react";
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
  availableTags?: { id: string; name: string }[];
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
    similarProducts?: { id: string; name: string; reference: string; category: string; image: string | null }[];
    tagNames: string[];
    isBestSeller: boolean;
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
    colorHex:  first?.hex  ?? "#9CA3AF",
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
  availableTags = [],
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
  const [tagNames,          setTagNames]          = useState<string[]>(initialData?.tagNames ?? []);
  const [isBestSeller,      setIsBestSeller]      = useState(initialData?.isBestSeller ?? false);
  const [tagInput,          setTagInput]          = useState("");

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

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (!t || tagNames.includes(t)) { setTagInput(""); return; }
    setTagNames((prev) => [...prev, t]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTagNames((prev) => prev.filter((x) => x !== tag));
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
      tagNames,
      isBestSeller,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-8">

      {/* ── Informations du produit ── */}
      <div className="space-y-4">
        <h2 className="font-[family-name:var(--font-poppins)] text-xl font-bold text-[#1A1A1A]">
          Informations du produit
        </h2>

        {/* Row 1 : Bloc principal (left) + Bloc mots clés (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">

          {/* ── BLOC PRINCIPAL ── */}
          <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 space-y-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <p className="text-sm font-semibold text-[#1A1A1A] font-[family-name:var(--font-poppins)]">Fiche produit</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Référence produit *" hint="Ex: BJ-COL-001">
                <input type="text" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())}
                  placeholder="BJ-COL-001" className="field-input" required />
              </Field>
              <Field label="Nom du produit *">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Collier sautoir doré" className="field-input" required />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Catégorie */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#6B6B6B]">Catégorie *</label>
                  <button type="button"
                    onClick={() => { setShowCatCreate((v) => !v); setCatCreateError(""); setNewCatName(""); }}
                    className="text-xs text-[#1A1A1A] hover:text-[#000000] font-medium font-[family-name:var(--font-roboto)] transition-colors"
                  >+ Créer</button>
                </div>
                <select value={categoryId}
                  onChange={(e) => { setCategoryId(e.target.value); setSubCategoryIds([]); setShowSubCatCreate(false); }}
                  className="field-input" required
                >
                  <option value="">— Sélectionner —</option>
                  {localCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                {showCatCreate && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <input type="text" value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                      placeholder="Nom de la catégorie" className="field-input flex-1 min-w-0" autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateCategory(); } }} />
                    <button type="button" onClick={handleCreateCategory} disabled={!newCatName.trim()}
                      className="px-3 py-2 bg-[#1A1A1A] text-white text-xs font-[family-name:var(--font-roboto)] rounded-lg hover:bg-[#000000] transition-colors disabled:opacity-50 shrink-0"
                    >Ajouter</button>
                    <button type="button" onClick={() => { setShowCatCreate(false); setCatCreateError(""); }}
                      className="px-3 py-2 border border-[#E5E5E5] text-xs font-[family-name:var(--font-roboto)] text-[#6B6B6B] rounded-lg hover:border-[#9CA3AF] transition-colors shrink-0"
                    >Annuler</button>
                    {catCreateError && <span className="text-xs text-[#DC2626] font-[family-name:var(--font-roboto)] w-full">{catCreateError}</span>}
                  </div>
                )}
              </div>

              {/* Sous-catégories */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#6B6B6B]">
                    Sous-catégories
                    {subCategoryIds.length > 0 && (
                      <span className="ml-2 font-normal text-[#9CA3AF]">({subCategoryIds.length})</span>
                    )}
                  </label>
                  {categoryId && (
                    <button type="button"
                      onClick={() => { setShowSubCatCreate((v) => !v); setSubCatCreateError(""); setNewSubCatName(""); }}
                      className="text-xs text-[#1A1A1A] hover:text-[#000000] font-medium font-[family-name:var(--font-roboto)] transition-colors"
                    >+ Créer</button>
                  )}
                </div>
                {!categoryId ? (
                  <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] py-2">Sélectionnez d&apos;abord une catégorie.</p>
                ) : subCategories.length === 0 && !showSubCatCreate ? (
                  <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] py-2">Aucune sous-catégorie — créez-en une.</p>
                ) : (
                  <div className="flex flex-wrap gap-2 min-h-[38px] items-start">
                    {subCategories.map((sub) => {
                      const selected = subCategoryIds.includes(sub.id);
                      return (
                        <button key={sub.id} type="button" onClick={() => toggleSubCategory(sub.id)}
                          className={`px-3 py-1.5 text-sm border rounded-lg transition-colors font-[family-name:var(--font-roboto)] ${
                            selected ? "bg-[#1A1A1A] text-white border-[#1A1A1A]" : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#1A1A1A]"
                          }`}
                        >{sub.name}</button>
                      );
                    })}
                  </div>
                )}
                {showSubCatCreate && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <input type="text" value={newSubCatName} onChange={(e) => setNewSubCatName(e.target.value)}
                      placeholder="Nom de la sous-catégorie" className="field-input flex-1 min-w-0" autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateSubCategory(); } }} />
                    <button type="button" onClick={handleCreateSubCategory} disabled={!newSubCatName.trim()}
                      className="px-3 py-2 bg-[#1A1A1A] text-white text-xs font-[family-name:var(--font-roboto)] rounded-lg hover:bg-[#000000] transition-colors disabled:opacity-50 shrink-0"
                    >Ajouter</button>
                    <button type="button" onClick={() => { setShowSubCatCreate(false); setSubCatCreateError(""); }}
                      className="px-3 py-2 border border-[#E5E5E5] text-xs font-[family-name:var(--font-roboto)] text-[#6B6B6B] rounded-lg hover:border-[#9CA3AF] transition-colors shrink-0"
                    >Annuler</button>
                    {subCatCreateError && <span className="text-xs text-[#DC2626] font-[family-name:var(--font-roboto)] w-full">{subCatCreateError}</span>}
                  </div>
                )}
              </div>
            </div>

            <Field label="Description *">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                rows={4} placeholder="Description commerciale du produit…" className="field-input resize-none" required />
            </Field>
          </div>

          {/* ── BLOC MOTS CLÉS ── */}
          <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 space-y-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <p className="text-sm font-semibold text-[#1A1A1A] font-[family-name:var(--font-poppins)]">Mots clés & Tags</p>

            {/* Tags existants — picker */}
            {availableTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-3 bg-[#EFEFEF] border border-[#E5E5E5] rounded-lg max-h-44 overflow-y-auto">
                {availableTags.map((t) => {
                  const selected = tagNames.includes(t.name);
                  return (
                    <button key={t.id} type="button"
                      onClick={() => selected ? removeTag(t.name) : setTagNames((prev) => [...prev, t.name])}
                      className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-[family-name:var(--font-roboto)] transition-all ${
                        selected
                          ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                          : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#1A1A1A] hover:text-[#1A1A1A]"
                      }`}
                    >
                      {selected && <span className="text-[10px]">&#10003;</span>}
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Créer un nouveau tag */}
            <div className="flex gap-2">
              <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                placeholder="Nouveau mot clé…" className="field-input flex-1"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
              <button type="button" onClick={addTag} disabled={!tagInput.trim()}
                className="px-3 py-2 bg-[#1A1A1A] text-white text-xs font-[family-name:var(--font-roboto)] hover:bg-[#000000] transition-colors disabled:opacity-40 shrink-0 rounded-lg"
              >Créer</button>
            </div>
            {tagNames.length > 0 && (
              <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                {tagNames.length} sélectionné{tagNames.length > 1 ? "s" : ""} : {tagNames.join(", ")}
              </p>
            )}

            {/* Best Seller */}
            <div className="pt-3 border-t border-[#F0F0F0]">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" checked={isBestSeller} onChange={(e) => setIsBestSeller(e.target.checked)}
                  className="w-4 h-4 border-[#E5E5E5] accent-[#1A1A1A]" />
                <div>
                  <span className="text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#6B6B6B]">Best Seller</span>
                  <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">Mettre en avant dans les filtres</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Row 2 : Bloc dimensions (left) + Bloc composition (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* ── BLOC DIMENSIONS ── */}
          <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A] font-[family-name:var(--font-poppins)]">Dimensions</p>
              <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
                En millimètres (mm) — laisser vide si non applicable.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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

          {/* ── BLOC COMPOSITION ── */}
          <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#1A1A1A] font-[family-name:var(--font-poppins)]">Composition</p>
                <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
                  Matériaux et pourcentages.
                  {localCompositions.length === 0 && (
                    <span className="text-amber-600 ml-1">
                      Aucune composition.{" "}
                      <a href="/admin/compositions" target="_blank" className="underline">Créez-en d&apos;abord.</a>
                    </span>
                  )}
                </p>
              </div>
              <button type="button"
                onClick={() => { setShowCompCreate((v) => !v); setCompCreateError(""); setNewCompName(""); }}
                className="text-xs text-[#1A1A1A] hover:text-[#000000] font-medium font-[family-name:var(--font-roboto)] transition-colors"
              >+ Créer un matériau</button>
            </div>

            {showCompCreate && (
              <div className="flex items-center gap-2 flex-wrap">
                <input type="text" value={newCompName} onChange={(e) => setNewCompName(e.target.value)}
                  placeholder="Nom du matériau" className="field-input flex-1 min-w-0" autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateComposition(); } }} />
                <button type="button" onClick={handleCreateComposition} disabled={!newCompName.trim()}
                  className="px-3 py-2 bg-[#1A1A1A] text-white text-xs font-[family-name:var(--font-roboto)] rounded-lg hover:bg-[#000000] transition-colors disabled:opacity-50 shrink-0"
                >Ajouter</button>
                <button type="button" onClick={() => { setShowCompCreate(false); setCompCreateError(""); }}
                  className="px-3 py-2 border border-[#E5E5E5] text-xs font-[family-name:var(--font-roboto)] text-[#6B6B6B] rounded-lg hover:border-[#9CA3AF] transition-colors shrink-0"
                >Annuler</button>
                {compCreateError && <span className="text-xs text-[#DC2626] w-full">{compCreateError}</span>}
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
                  className="px-4 py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-lg hover:bg-[#000000] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 font-[family-name:var(--font-roboto)]"
                >Ajouter</button>
              </div>
            )}

            {compositions.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
                    {compositions.length} matériau{compositions.length > 1 ? "x" : ""}
                  </span>
                  <span className={`text-sm font-semibold px-3 py-1 rounded-full font-[family-name:var(--font-roboto)] ${
                    Math.abs(totalPct - 100) <= 0.5
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA]"
                  }`}>
                    Total : {totalPct.toFixed(1)} %{Math.abs(totalPct - 100) <= 0.5 ? " ✓" : " ≠ 100%"}
                  </span>
                </div>
                <ul className="divide-y divide-[#E5E5E5] border border-[#E5E5E5] rounded-xl overflow-hidden">
                  {compositions.map((item) => {
                    const comp = localCompositions.find((c) => c.id === item.compositionId);
                    return (
                      <li key={item.compositionId} className="flex items-center justify-between px-4 py-2.5 gap-3">
                        <span className="text-sm font-medium text-[#1A1A1A] font-[family-name:var(--font-roboto)] flex-1 min-w-0 truncate">
                          {comp?.name ?? item.compositionId}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input type="number" min="0" max="100" step="0.1" value={item.percentage}
                            onChange={(e) => updateCompositionPct(item.compositionId, e.target.value)}
                            className="w-20 field-input px-2 py-1.5 text-sm text-right" />
                          <span className="text-sm text-[#6B6B6B]">%</span>
                        </div>
                        <button type="button" onClick={() => removeComposition(item.compositionId)}
                          className="text-[#1A1A1A] hover:text-[#DC2626] transition-colors text-sm shrink-0"
                        >Retirer</button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Variantes couleur ── */}
      <section className="bg-white border border-[#E5E5E5] rounded-2xl p-8 space-y-5 shadow-card">
        <div className="flex items-center justify-between border-b border-[#E5E5E5] pb-4">
          <h2 className="font-[family-name:var(--font-poppins)] text-xl font-bold text-[#1A1A1A]">
            Variantes couleur
          </h2>
          <span className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
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
      <section className="bg-white border border-[#E5E5E5] rounded-2xl p-8 space-y-5 shadow-card">
        <div className="border-b border-[#E5E5E5] pb-4">
          <h2 className="font-[family-name:var(--font-poppins)] text-xl font-bold text-[#1A1A1A]">
            Produits similaires
          </h2>
          <p className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-1">
            Ces produits seront affichés dans la section &quot;Vous aimerez aussi&quot; sur la fiche client.
          </p>
        </div>
        <SimilarProductPicker
          productId={productId}
          selected={similarProductIds}
          initialProducts={initialData?.similarProducts}
          onAdd={(id) => setSimilarProductIds((prev) => [...prev, id])}
          onRemove={(id) => setSimilarProductIds((prev) => prev.filter((x) => x !== id))}
        />
      </section>

      {/* ── Erreur + Boutons ── */}
      {error && (
        <div className="bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] px-5 py-4 text-sm font-[family-name:var(--font-roboto)] rounded-xl">
          {error}
        </div>
      )}

      <div className="flex items-center gap-4 pt-2 pb-8">
        <button type="submit" disabled={isPending}
          className="btn-primary px-10 py-3.5 text-base disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending
            ? mode === "edit" ? "Enregistrement…" : "Création en cours…"
            : mode === "edit" ? "Enregistrer les modifications" : "Créer le produit"}
        </button>
        <a href="/admin/produits"
          className="btn-secondary px-7 py-3.5 text-sm"
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
      <label className="block text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#6B6B6B] mb-1.5">
        {label}
        {hint && <span className="ml-2 font-normal text-[#9CA3AF]">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ── SimilarProductPicker (search-based with images) ──────────────────────
interface SearchProduct {
  id: string;
  name: string;
  reference: string;
  category: string;
  image: string | null;
}

function SimilarProductPicker({
  productId,
  selected,
  initialProducts,
  onAdd,
  onRemove,
}: {
  productId?: string;
  selected: string[];
  initialProducts?: SearchProduct[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<SearchProduct[]>(initialProducts ?? []);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/products/search?q=${encodeURIComponent(value.trim())}${productId ? `&exclude=${productId}` : ""}`);
        const data = await res.json();
        setResults(data.products ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function handleSelect(product: SearchProduct) {
    if (selected.includes(product.id)) return;
    onAdd(product.id);
    setSelectedProducts((prev) => [...prev, product]);
  }

  function handleRemove(id: string) {
    onRemove(id);
    setSelectedProducts((prev) => prev.filter((p) => p.id !== id));
  }

  // Filter results to exclude already-selected
  const filteredResults = results.filter((r) => !selected.includes(r.id));

  return (
    <div className="space-y-4">
      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Rechercher un produit par nom ou reference..."
          className="field-input !pl-10"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-[#E5E5E5] border-t-[#1A1A1A] rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Search results */}
      {search.trim().length >= 1 && (
        <div className="border border-[#E5E5E5] rounded-xl overflow-hidden max-h-80 overflow-y-auto">
          {filteredResults.length === 0 && !loading ? (
            <p className="px-5 py-4 text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)] text-center">
              {results.length > 0 && filteredResults.length === 0
                ? "Tous les resultats sont deja selectionnes"
                : "Aucun resultat"}
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-0.5 p-2">
              {filteredResults.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(p)}
                  className="group flex flex-col items-center p-3 rounded-xl hover:bg-[#F7F7F8] transition-colors text-center"
                >
                  {/* Large image */}
                  <div className="w-full aspect-square bg-[#EFEFEF] rounded-xl overflow-hidden mb-2">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image}
                        alt={p.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <p className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] truncate w-full">
                    {p.name}
                  </p>
                  <p className="text-[10px] text-[#9CA3AF] font-mono truncate w-full">
                    {p.reference}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected products */}
      {selected.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wider mb-2 font-[family-name:var(--font-roboto)]">
            {selected.length} produit{selected.length > 1 ? "s" : ""} similaire{selected.length > 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-3">
            {selectedProducts.map((p) => (
              <div
                key={p.id}
                className="relative group w-28"
              >
                {/* Image */}
                <div className="w-full aspect-square bg-[#EFEFEF] rounded-xl overflow-hidden">
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-6 h-6 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                      </svg>
                    </div>
                  )}
                </div>
                {/* Remove button on hover */}
                <button
                  type="button"
                  onClick={() => handleRemove(p.id)}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10 text-xs font-bold"
                >
                  ×
                </button>
                {/* Info */}
                <p className="text-[10px] font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] truncate mt-1.5">
                  {p.reference}
                </p>
                <p className="text-[10px] text-[#9CA3AF] font-[family-name:var(--font-roboto)] truncate">
                  {p.category}
                </p>
              </div>
            ))}
            {/* Show placeholders for selected products we don't have info for yet */}
            {selected.filter((id) => !selectedProducts.find((p) => p.id === id)).map((id) => (
              <div key={id} className="relative group w-28">
                <div className="w-full aspect-square bg-[#EFEFEF] rounded-xl flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-[#E5E5E5] border-t-[#1A1A1A] rounded-full animate-spin" />
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(id)}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10 text-xs font-bold"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
