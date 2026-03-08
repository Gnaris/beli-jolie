"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ColorVariantManager, { ColorState, AvailableColor } from "./ColorVariantManager";
import { createProduct, updateProduct } from "@/app/actions/admin/products";

interface Category {
  id: string;
  name: string;
  subCategories: { id: string; name: string }[];
}

interface ProductFormProps {
  categories: Category[];
  availableColors: AvailableColor[];
  // Mode édition
  mode?: "create" | "edit";
  productId?: string;
  initialData?: {
    reference: string;
    name: string;
    description: string;
    composition: string;
    categoryId: string;
    subCategoryId: string;
    colors: ColorState[];
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function defaultColor(availableColors: AvailableColor[]): ColorState {
  const first = availableColors[0];
  return {
    tempId: uid(),
    colorId:   first?.id   ?? "",
    colorName: first?.name ?? "",
    colorHex:  first?.hex  ?? "#B8A48A",
    unitPrice: "",
    weight:    "",
    saleOptions: [{
      tempId: uid(), saleType: "UNIT", packQuantity: "",
      stock: "", discountType: "", discountValue: "",
    }],
    imagePreviews: [], imageFiles: [], uploadedPaths: [], uploading: false,
  };
}

export default function ProductForm({
  categories,
  availableColors,
  mode = "create",
  productId,
  initialData,
}: ProductFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [reference,   setReference]   = useState(initialData?.reference   ?? "");
  const [name,        setName]        = useState(initialData?.name        ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [composition, setComposition] = useState(initialData?.composition ?? "");
  const [categoryId,  setCategoryId]  = useState(initialData?.categoryId  ?? "");
  const [subCategoryId, setSubCategoryId] = useState(initialData?.subCategoryId ?? "");
  const [colors, setColors] = useState<ColorState[]>(
    initialData?.colors ??
    (availableColors.length > 0
      ? [{ ...defaultColor(availableColors), isPrimary: true }]
      : [])
  );
  const [error, setError] = useState("");

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const subCategories    = selectedCategory?.subCategories ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!reference.trim()) return setError("La référence est requise.");
    if (!name.trim())       return setError("Le nom est requis.");
    if (!description.trim()) return setError("La description est requise.");
    if (!composition.trim()) return setError("La composition est requise.");
    if (!categoryId)        return setError("Veuillez choisir une catégorie.");
    if (colors.length === 0) return setError("Ajoutez au moins une couleur.");

    for (const color of colors) {
      if (!color.colorId) return setError("Chaque variante doit avoir une couleur sélectionnée.");
      const price = parseFloat(color.unitPrice);
      if (isNaN(price) || price <= 0) return setError(`Prix invalide pour "${color.colorName || "la couleur"}".`);
      const w = parseFloat(color.weight);
      if (isNaN(w) || w <= 0) return setError(`Poids invalide pour "${color.colorName || "la couleur"}".`);
      if (color.saleOptions.length === 0) return setError("Chaque couleur doit avoir au moins une option de vente.");
      for (const opt of color.saleOptions) {
        if (opt.saleType === "PACK") {
          const qty = parseInt(opt.packQuantity);
          if (isNaN(qty) || qty < 2) return setError(`Quantité paquet invalide pour "${color.colorName}".`);
        }
      }
      if (color.uploading) return setError("Des images sont encore en cours d'upload. Veuillez patienter.");
    }

    const payload = {
      reference: reference.trim().toUpperCase(),
      name: name.trim(),
      description: description.trim(),
      composition: composition.trim(),
      categoryId,
      subCategoryId: subCategoryId || null,
      colors: colors.map((c) => ({
        colorId:   c.colorId,
        unitPrice: parseFloat(c.unitPrice),
        weight:    parseFloat(c.weight),
        isPrimary: c.isPrimary,
        imagePaths: c.uploadedPaths,
        saleOptions: c.saleOptions.map((opt) => ({
          saleType:      opt.saleType,
          packQuantity:  opt.saleType === "PACK" ? parseInt(opt.packQuantity) : null,
          stock:         parseInt(opt.stock) || 0,
          discountType:  opt.discountType || null,
          discountValue: opt.discountValue ? parseFloat(opt.discountValue) : null,
        })),
      })),
    };

    startTransition(async () => {
      try {
        if (mode === "edit" && productId) {
          await updateProduct(productId, payload);
          router.push("/admin/produits");
        } else {
          await createProduct(payload);
          router.push("/admin/produits");
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Une erreur est survenue.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">

      {/* ── Informations de base ── */}
      <section className="bg-white border border-[#D4CCBE] p-6 space-y-5">
        <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#2C2418] border-b border-[#EDE8DF] pb-3">
          Informations du produit
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Catégorie *">
            <select
              value={categoryId}
              onChange={(e) => { setCategoryId(e.target.value); setSubCategoryId(""); }}
              className="field-input"
              required
            >
              <option value="">— Sélectionner —</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Sous-catégorie">
            <select
              value={subCategoryId}
              onChange={(e) => setSubCategoryId(e.target.value)}
              className="field-input"
              disabled={subCategories.length === 0}
            >
              <option value="">— Aucune —</option>
              {subCategories.map((sub) => (
                <option key={sub.id} value={sub.id}>{sub.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Description *">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Description commerciale du produit…"
            className="field-input resize-none"
            required
          />
        </Field>

        <Field label="Composition *" hint="Matériaux, traitement de surface, etc.">
          <textarea
            value={composition}
            onChange={(e) => setComposition(e.target.value)}
            rows={2}
            placeholder="Acier inoxydable 316L, plaqué or 18 carats…"
            className="field-input resize-none"
            required
          />
        </Field>
      </section>

      {/* ── Variantes couleur ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#2C2418]">
            Variantes couleur
          </h2>
          <span className="text-xs text-[#B8A48A] font-[family-name:var(--font-roboto)]">
            {colors.length} couleur{colors.length > 1 ? "s" : ""}
          </span>
        </div>
        <ColorVariantManager
          colors={colors}
          availableColors={availableColors}
          onChange={setColors}
        />
      </section>

      {/* ── Erreur + Boutons ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm font-[family-name:var(--font-roboto)]">
          {error}
        </div>
      )}

      <div className="flex items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="px-8 py-3 bg-[#8B7355] text-white font-[family-name:var(--font-poppins)] font-semibold text-sm hover:bg-[#6B5640] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending
            ? mode === "edit" ? "Enregistrement…" : "Création en cours…"
            : mode === "edit" ? "Enregistrer les modifications" : "Créer le produit"}
        </button>
        <a
          href="/admin/produits"
          className="px-6 py-3 border border-[#D4CCBE] text-sm font-[family-name:var(--font-roboto)] text-[#6B5B45] hover:border-[#8B7355] hover:text-[#2C2418] transition-colors"
        >
          Annuler
        </a>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider mb-1.5">
        {label}
        {hint && <span className="ml-2 font-normal normal-case text-[#B8A48A]">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}
