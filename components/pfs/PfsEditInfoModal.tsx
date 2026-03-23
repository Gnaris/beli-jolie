"use client";

import { useState, useEffect, useCallback } from "react";
import type { StagedProductFull } from "./PfsProductDetailModal";
import CustomSelect from "@/components/ui/CustomSelect";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import type { QuickCreateType } from "@/components/admin/products/QuickCreateModal";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface CategoryOption {
  id: string;
  name: string;
  subCategories: { id: string; name: string }[];
}

interface TagOption {
  id: string;
  name: string;
}

interface PfsEditInfoModalProps {
  product: StagedProductFull;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: StagedProductFull) => void;
}

// ─────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function PfsEditInfoModal({
  product,
  open,
  onClose,
  onSaved,
}: PfsEditInfoModalProps) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [categoryName, setCategoryName] = useState(product.categoryName);
  const [subCategoryIds, setSubCategoryIds] = useState<string[]>(product.subCategoryIds ?? []);
  const [subCategoryNames, setSubCategoryNames] = useState<string[]>(product.subCategoryNames ?? []);
  const [isBestSeller, setIsBestSeller] = useState(product.isBestSeller);
  const [tagNames, setTagNames] = useState<string[]>(product.tags ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Entity lists
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);

  // QuickCreate modal
  const [quickCreateType, setQuickCreateType] = useState<QuickCreateType | null>(null);

  // Fetch entities when modal opens
  const fetchEntities = useCallback(async () => {
    setLoadingEntities(true);
    try {
      const res = await fetch("/api/admin/pfs-sync/entities");
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
        setTagOptions(data.tags || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingEntities(false);
    }
  }, []);

  // Reset form when product changes or modal opens
  useEffect(() => {
    if (open) {
      setName(product.name);
      setDescription(product.description);
      setCategoryId(product.categoryId);
      setCategoryName(product.categoryName);
      setSubCategoryIds(product.subCategoryIds ?? []);
      setSubCategoryNames(product.subCategoryNames ?? []);
      setIsBestSeller(product.isBestSeller);
      setTagNames(product.tags ?? []);
      setError(null);
      fetchEntities();
    }
  }, [open, product.id, product.name, product.description, product.categoryId, product.categoryName, product.subCategoryIds, product.subCategoryNames, product.isBestSeller, product.tags, fetchEntities]);

  const handleCategoryChange = (value: string) => {
    setCategoryId(value);
    const cat = categories.find((c) => c.id === value);
    if (cat) setCategoryName(cat.name);
    // Reset subcategories when category changes
    setSubCategoryIds([]);
    setSubCategoryNames([]);
  };

  const toggleSubCategory = (id: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    const sub = cat?.subCategories.find((s) => s.id === id);
    if (!sub) return;
    if (subCategoryIds.includes(id)) {
      setSubCategoryIds((prev) => prev.filter((x) => x !== id));
      setSubCategoryNames((prev) => prev.filter((x) => x !== sub.name));
    } else {
      setSubCategoryIds((prev) => [...prev, id]);
      setSubCategoryNames((prev) => [...prev, sub.name]);
    }
  };

  const toggleTag = (tagName: string) => {
    setTagNames((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};

      if (name !== product.name) body.name = name;
      if (description !== product.description) body.description = description;
      if (categoryId !== product.categoryId) {
        body.categoryId = categoryId;
        body.categoryName = categoryName;
      }
      const prevSubIds = product.subCategoryIds ?? [];
      if (JSON.stringify([...subCategoryIds].sort()) !== JSON.stringify([...prevSubIds].sort())) {
        body.subCategoryIds = subCategoryIds;
        body.subCategoryNames = subCategoryNames;
      }
      if (isBestSeller !== product.isBestSeller) body.isBestSeller = isBestSeller;

      // Always send tags (compare arrays)
      const prevTags = product.tags ?? [];
      if (JSON.stringify(tagNames.sort()) !== JSON.stringify([...prevTags].sort())) {
        body.tags = tagNames;
      }

      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }

      const res = await fetch(`/api/admin/pfs-sync/staged/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }

      const { product: updated } = await res.json();
      const parsed: StagedProductFull = {
        ...product,
        ...updated,
        variants: typeof updated.variants === "string" ? JSON.parse(updated.variants) : updated.variants ?? product.variants,
        compositions: typeof updated.compositions === "string" ? JSON.parse(updated.compositions) : updated.compositions ?? product.compositions,
        translations: typeof updated.translations === "string" ? JSON.parse(updated.translations) : updated.translations ?? product.translations,
        imagesByColor: typeof updated.imagesByColor === "string" ? JSON.parse(updated.imagesByColor) : updated.imagesByColor ?? product.imagesByColor,
        tags: typeof updated.tags === "string" ? JSON.parse(updated.tags) : updated.tags ?? product.tags,
      };
      onSaved(parsed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  // SubCategories for current category
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const subCategoryOptions = (selectedCategory?.subCategories ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));

  return (
    <>
      <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div
          className="relative w-full max-w-lg rounded-2xl bg-bg-primary shadow-2xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
            <h3 className="text-base font-semibold text-text-primary font-[family-name:var(--font-poppins)]">
              Modifier les informations
            </h3>
            <button
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-bg-secondary text-text-secondary transition-colors hover:bg-border hover:text-text-primary"
              aria-label="Fermer"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Body */}
          <div className="space-y-4 p-5 overflow-y-auto">
            {/* Nom */}
            <div>
              <label className="field-label text-xs">Nom du produit</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field-input mt-1"
                placeholder="Nom du produit"
              />
            </div>

            {/* Description */}
            <div>
              <label className="field-label text-xs">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="field-input mt-1 resize-none"
                placeholder="Description du produit"
              />
            </div>

            {/* Catégorie */}
            <div>
              <label className="field-label text-xs">Catégorie</label>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1">
                  {loadingEntities ? (
                    <div className="field-input animate-pulse h-10" />
                  ) : (
                    <CustomSelect
                      value={categoryId}
                      onChange={handleCategoryChange}
                      options={categoryOptions}
                      placeholder="Sélectionner une catégorie…"
                      aria-label="Catégorie"
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setQuickCreateType("category")}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bg-secondary text-text-secondary transition-colors hover:bg-border hover:text-text-primary"
                  aria-label="Créer une catégorie"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Sous-catégories — multi-select toggle chips */}
            {categoryId && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="field-label text-xs">
                    Sous-catégories {subCategoryIds.length > 0 && <span className="text-text-secondary">({subCategoryIds.length})</span>}
                  </label>
                  <button
                    type="button"
                    onClick={() => setQuickCreateType("subcategory")}
                    className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                    aria-label="Créer une sous-catégorie"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Nouvelle
                  </button>
                </div>
                {subCategoryOptions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {subCategoryOptions.map((sub) => {
                      const isSelected = subCategoryIds.includes(sub.value);
                      return (
                        <button
                          key={sub.value}
                          type="button"
                          onClick={() => toggleSubCategory(sub.value)}
                          className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                            isSelected
                              ? "bg-text-primary text-text-inverse"
                              : "bg-bg-secondary text-text-secondary hover:bg-border hover:text-text-primary"
                          }`}
                        >
                          {isSelected && <CheckIcon className="h-3 w-3" />}
                          {sub.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-text-secondary py-2.5 px-3 bg-bg-secondary rounded-xl">
                    Aucune sous-catégorie — créez-en une
                  </p>
                )}
              </div>
            )}

            {/* Mots-clés */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="field-label text-xs">
                  Mots-clés {tagNames.length > 0 && <span className="text-text-secondary">({tagNames.length})</span>}
                </label>
                <button
                  type="button"
                  onClick={() => setQuickCreateType("tag")}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                  aria-label="Créer un mot-clé"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Nouveau
                </button>
              </div>
              {loadingEntities ? (
                <div className="field-input animate-pulse h-20" />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tagOptions.map((tag) => {
                    const isSelected = tagNames.includes(tag.name);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.name)}
                        className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          isSelected
                            ? "bg-text-primary text-text-inverse"
                            : "bg-bg-secondary text-text-secondary hover:bg-border hover:text-text-primary"
                        }`}
                      >
                        {isSelected && <CheckIcon className="h-3 w-3" />}
                        {tag.name}
                      </button>
                    );
                  })}
                  {tagOptions.length === 0 && (
                    <p className="text-xs text-text-secondary py-1">Aucun mot-clé disponible</p>
                  )}
                </div>
              )}
            </div>

            {/* Best-seller toggle */}
            <div className="flex items-center justify-between">
              <label className="field-label text-xs">Best-seller</label>
              <button
                type="button"
                role="switch"
                aria-checked={isBestSeller}
                onClick={() => setIsBestSeller(!isBestSeller)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                  isBestSeller ? "bg-[#22C55E]" : "bg-border"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    isBestSeller ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Error */}
            {error && (
              <p className="text-sm text-[#EF4444]">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4 shrink-0">
            <button onClick={onClose} className="btn-secondary min-w-[140px]" disabled={saving}>
              Annuler
            </button>
            <button
              onClick={handleSave}
              className="btn-primary min-w-[140px]"
              disabled={saving}
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>

      {/* QuickCreate Modal */}
      {quickCreateType && (
        <QuickCreateModal
          type={quickCreateType}
          categoryId={quickCreateType === "subcategory" ? categoryId : undefined}
          open={!!quickCreateType}
          onClose={() => setQuickCreateType(null)}
          onCreated={(item) => {
            if (quickCreateType === "category") {
              setCategories((prev) =>
                prev.some((c) => c.id === item.id)
                  ? prev
                  : [...prev, { id: item.id, name: item.name, subCategories: item.subCategories || [] }]
              );
              setCategoryId(item.id);
              setCategoryName(item.name);
            } else if (quickCreateType === "subcategory") {
              // Add to the current category's subcategories (skip if already present)
              setCategories((prev) =>
                prev.map((c) =>
                  c.id === categoryId
                    ? {
                        ...c,
                        subCategories: c.subCategories.some((s) => s.id === item.id)
                          ? c.subCategories
                          : [...c.subCategories, { id: item.id, name: item.name }].sort((a, b) => a.name.localeCompare(b.name)),
                      }
                    : c
                )
              );
              if (!subCategoryIds.includes(item.id)) {
                setSubCategoryIds((prev) => [...prev, item.id]);
                setSubCategoryNames((prev) => [...prev, item.name]);
              }
            } else if (quickCreateType === "tag") {
              setTagOptions((prev) =>
                prev.some((t) => t.id === item.id)
                  ? prev
                  : [...prev, { id: item.id, name: item.name }].sort((a, b) => a.name.localeCompare(b.name))
              );
              setTagNames((prev) => [...prev, item.name]);
            }
            setQuickCreateType(null);
          }}
        />
      )}
    </>
  );
}
