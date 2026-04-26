"use client";

import { useState, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  updateCollection,
  addProductToCollection,
  removeProductFromCollection,
  updateCollectionProductColor,
  reorderCollectionProducts,
} from "@/app/actions/admin/collections";
import TranslateButton from "@/components/admin/TranslateButton";
import { VALID_LOCALES, LOCALE_FULL_NAMES } from "@/i18n/locales";
import ProductPickerModal, { type PickerProduct } from "@/components/admin/catalogues/ProductPickerModal";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RawColorVariant {
  colorId: string;
  isPrimary: boolean;
  unitPrice: number;
  color: { id: string; name: string; hex: string | null };
}

interface RawImage {
  path: string;
  colorId: string;
}

interface ProductSnap {
  id: string;
  name: string;
  reference: string;
  colorImages: RawImage[];
  colors: RawColorVariant[];
}

interface CollectionProductRow {
  productId: string;
  colorId: string | null;
  position: number;
  product: ProductSnap;
}

interface CollectionData {
  id: string;
  name: string;
  image: string | null;
  translations: Record<string, string>;
  products: CollectionProductRow[];
}

interface CategoryOption {
  id: string;
  name: string;
}

interface UniqueColor {
  colorId: string;
  name: string;
  hex: string | null;
  isPrimary: boolean;
  images: RawImage[];
}

interface Props {
  collection: CollectionData;
  categories: CategoryOption[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function deduplicateColors(raw: RawColorVariant[], images: RawImage[]): UniqueColor[] {
  const map = new Map<string, UniqueColor>();
  for (const r of raw) {
    const existing = map.get(r.colorId);
    if (!existing) {
      map.set(r.colorId, {
        colorId: r.colorId,
        name: r.color.name,
        hex: r.color.hex,
        isPrimary: r.isPrimary,
        images: images.filter((img) => img.colorId === r.colorId),
      });
    } else {
      if (r.isPrimary) existing.isPrimary = true;
    }
  }
  return Array.from(map.values());
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CollectionEditor({ collection, categories }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Form state ──────────────────────────────────────────────────────────
  const [name, setName] = useState(collection.name);
  const [translations, setTranslations] = useState<Record<string, string>>(collection.translations);
  const [image, setImage] = useState<string | null>(collection.image);
  const [preview, setPreview] = useState<string | null>(collection.image);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Products state ──────────────────────────────────────────────────────
  const [selectedProducts, setSelectedProducts] = useState<CollectionProductRow[]>(collection.products);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [productPage, setProductPage] = useState(1);
  const PRODUCTS_PER_PAGE = 20;

  // ── Drag state ──────────────────────────────────────────────────────────
  const dragIndex = useRef<number | null>(null);

  // IDs already in the collection
  const selectedIds = useMemo(() => new Set(selectedProducts.map((p) => p.productId)), [selectedProducts]);

  // Detect unsaved changes
  const hasChanges = name !== collection.name
    || image !== collection.image
    || JSON.stringify(translations) !== JSON.stringify(collection.translations);

  // ── Image upload ────────────────────────────────────────────────────────

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const fd = new FormData();
    fd.append("image", file);

    const res = await fetch("/api/admin/collections/images", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Erreur upload.");
    } else {
      setImage(data.path);
      setPreview(data.path);
    }
    setUploading(false);
  }

  // ── Save collection info ────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setError(null);

    const fd = new FormData();
    fd.append("name", name);
    if (image) fd.append("image", image);

    for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
      if (translations[locale]) {
        fd.append(`translation_${locale}`, translations[locale]);
      }
    }

    const result = await updateCollection(collection.id, fd);
    setSaving(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  // ── Product picker handlers ─────────────────────────────────────────────

  const handlePickerAdd = (pickerProduct: PickerProduct) => {
    if (selectedIds.has(pickerProduct.id)) return;
    startTransition(async () => {
      await addProductToCollection(collection.id, pickerProduct.id);
      const snap: ProductSnap = {
        id: pickerProduct.id,
        name: pickerProduct.name,
        reference: pickerProduct.reference,
        colorImages: pickerProduct.colorImages,
        colors: pickerProduct.colors,
      };
      setSelectedProducts((prev) => [
        ...prev,
        { productId: snap.id, position: prev.length, colorId: null, product: snap },
      ]);
    });
  };

  const handlePickerRemove = (productId: string) => {
    startTransition(async () => {
      await removeProductFromCollection(collection.id, productId);
      setSelectedProducts((prev) => prev.filter((p) => p.productId !== productId));
      if (expandedProduct === productId) setExpandedProduct(null);
    });
  };

  const handleRemove = (productId: string) => {
    startTransition(async () => {
      await removeProductFromCollection(collection.id, productId);
      setSelectedProducts((prev) => prev.filter((p) => p.productId !== productId));
      if (expandedProduct === productId) setExpandedProduct(null);
    });
  };

  // ── Color change ────────────────────────────────────────────────────────

  const handleColorChange = (productId: string, colorId: string | null) => {
    startTransition(async () => {
      await updateCollectionProductColor(collection.id, productId, colorId);
      setSelectedProducts((prev) =>
        prev.map((p) =>
          p.productId === productId ? { ...p, colorId } : p
        )
      );
    });
  };

  // ── Drag & drop ─────────────────────────────────────────────────────────

  function onDragStart(index: number) {
    dragIndex.current = index;
  }

  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) return;
    const newItems = [...selectedProducts];
    const [moved] = newItems.splice(dragIndex.current, 1);
    newItems.splice(index, 0, moved);
    dragIndex.current = index;
    setSelectedProducts(newItems);
  }

  function onDragEnd() {
    dragIndex.current = null;
    startTransition(async () => {
      await reorderCollectionProducts(
        collection.id,
        selectedProducts.map((it, i) => ({ productId: it.productId, position: i }))
      );
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ═══════ Header bar ═══════ */}
      <div className="bg-bg-primary border border-border rounded-2xl p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              onClick={() => router.push("/admin/collections")}
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl border border-border hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-primary"
              title="Retour aux collections"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 min-w-0 text-lg font-heading font-semibold text-text-primary bg-transparent border-0 outline-none focus:ring-0 px-0 placeholder:text-text-muted"
              placeholder="Nom de la collection"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* View on site */}
            <a
              href={`/collections/${collection.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Voir la collection en vitrine"
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-border hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-primary"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>

            <div className="w-px h-6 bg-border" />

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={saving || uploading}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium font-body transition-all disabled:opacity-50 ${
                saved
                  ? "bg-[#DCFCE7] text-[#16A34A]"
                  : hasChanges
                    ? "bg-bg-dark text-text-inverse hover:opacity-90 shadow-sm"
                    : "bg-bg-dark text-text-inverse hover:opacity-90"
              }`}
            >
              {saved ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Enregistre
                </>
              ) : saving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Enregistrement...
                </>
              ) : (
                "Enregistrer"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-[#FEE2E2] border border-[#FECACA] text-error text-sm px-4 py-2.5 rounded-xl">
          {error}
        </div>
      )}

      {/* ═══════ Main content: products (left) + settings (right) ═══════ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ── Left column: products (2/3) ──────────────────────────────── */}
        <div className="xl:col-span-2 space-y-5">
          <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">

            {/* Header + add button */}
            <div className="p-5 pb-0">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="font-heading font-semibold text-text-primary text-sm">
                    Produits de la collection
                  </h2>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-bg-dark text-text-inverse font-medium">
                    {selectedProducts.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-bg-dark text-text-inverse text-sm font-medium font-body hover:opacity-90 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Ajouter des produits
                </button>
              </div>
            </div>

            {/* Product list */}
            <div className="px-5 pb-5">
              {selectedProducts.length === 0 ? (
                <div className="py-12 flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-bg-secondary flex items-center justify-center mb-4">
                    <svg className="w-7 h-7 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                  </div>
                  <p className="text-sm text-[#6B7280] font-body mb-1">
                    Aucun produit dans cette collection
                  </p>
                  <p className="text-xs text-text-muted font-body">
                    Cliquez sur &laquo; Ajouter des produits &raquo; pour commencer.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedProducts
                      .slice((productPage - 1) * PRODUCTS_PER_PAGE, productPage * PRODUCTS_PER_PAGE)
                      .map((row, sliceIdx) => {
                      const globalIdx = (productPage - 1) * PRODUCTS_PER_PAGE + sliceIdx;
                      const uniqueColors = deduplicateColors(row.product.colors, row.product.colorImages);
                      const hasMultipleColors = uniqueColors.length > 1;
                      const activeColor = row.colorId
                        ? uniqueColors.find((c) => c.colorId === row.colorId)
                        : (uniqueColors.find((c) => c.isPrimary) ?? uniqueColors[0]);
                      const activeImages = activeColor?.images ?? row.product.colorImages;
                      const displayImage = activeImages[0]?.path ?? null;
                      const isExpanded = expandedProduct === row.productId;

                      return (
                        <div
                          key={row.productId}
                          draggable
                          onDragStart={() => onDragStart(globalIdx)}
                          onDragOver={(e) => onDragOver(e, globalIdx)}
                          onDragEnd={onDragEnd}
                          className={`rounded-xl border transition-all ${
                            isExpanded
                              ? "border-[#1A1A1A]/20 bg-bg-secondary/30 shadow-sm"
                              : "border-border hover:border-[#D1D5DB] hover:shadow-sm"
                          }`}
                        >
                          {/* Product card */}
                          <div className="p-3 flex items-start gap-3">
                            {/* Drag handle */}
                            <div className="text-text-muted shrink-0 cursor-grab active:cursor-grabbing mt-1" aria-hidden>
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
                              </svg>
                            </div>

                            {/* Image */}
                            <div className="w-16 h-16 rounded-lg bg-bg-secondary overflow-hidden shrink-0">
                              {displayImage ? (
                                <Image src={displayImage} alt={row.product.name} className="w-full h-full object-cover" width={64} height={64} unoptimized />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <svg className="w-5 h-5 text-[#C4C4C4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                      d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                                  </svg>
                                </div>
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-heading font-medium text-text-primary truncate">
                                {row.product.name}
                              </p>
                              <p className="text-xs text-text-muted font-body mt-0.5">
                                {row.product.reference}
                              </p>
                              {activeColor && (
                                <div className="flex items-center gap-1.5 mt-1.5">
                                  {activeColor.hex && (
                                    <span
                                      className="inline-block w-3 h-3 rounded-full border border-border shrink-0"
                                      style={{
                                        backgroundColor: activeColor.hex,
                                        boxShadow: activeColor.hex.toLowerCase() === "#ffffff" ? "inset 0 0 0 1px #E5E5E5" : undefined,
                                      }}
                                    />
                                  )}
                                  <span className="text-xs text-[#6B7280] font-body">{activeColor.name}</span>
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex flex-col gap-1 shrink-0">
                              {/* Position badge */}
                              <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-secondary text-xs text-text-muted font-medium font-body">
                                {globalIdx + 1}
                              </span>

                              {/* Customize (if multiple colors) */}
                              {hasMultipleColors && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedProduct(isExpanded ? null : row.productId)}
                                  title="Personnaliser la couleur"
                                  className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                                    isExpanded
                                      ? "bg-bg-dark text-text-inverse"
                                      : "text-text-muted hover:text-text-primary hover:bg-bg-secondary"
                                  }`}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                                  </svg>
                                </button>
                              )}

                              {/* Remove */}
                              <button
                                onClick={() => handleRemove(row.productId)}
                                disabled={isPending}
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-[#EF4444] hover:bg-[#FEF2F2] transition-colors disabled:opacity-50"
                                title="Retirer de la collection"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          {/* Color customization panel */}
                          {isExpanded && hasMultipleColors && (
                            <div className="px-3 pb-3">
                              <div className="p-3 rounded-lg bg-bg-primary border border-border">
                                <p className="text-[11px] text-text-muted font-body font-medium mb-2 uppercase tracking-wide">
                                  Couleur affichee
                                </p>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    type="button"
                                    onClick={() => handleColorChange(row.productId, null)}
                                    disabled={isPending}
                                    title="Couleur par defaut"
                                    className={`h-7 px-2.5 rounded-lg border text-xs font-body flex items-center gap-1.5 transition-all ${
                                      row.colorId === null
                                        ? "border-[#1A1A1A] bg-bg-dark text-text-inverse"
                                        : "border-border bg-bg-primary text-text-muted hover:border-[#9CA3AF]"
                                    }`}
                                  >
                                    Auto
                                  </button>
                                  {uniqueColors.map((cv) => (
                                    <button
                                      key={cv.colorId}
                                      type="button"
                                      onClick={() => handleColorChange(row.productId, cv.colorId)}
                                      disabled={isPending}
                                      title={cv.name}
                                      className={`h-7 px-2.5 rounded-lg border text-xs font-body flex items-center gap-1.5 transition-all ${
                                        row.colorId === cv.colorId
                                          ? "border-[#1A1A1A] bg-[#F9FAFB]"
                                          : "border-border hover:border-[#9CA3AF]"
                                      }`}
                                    >
                                      <span
                                        className="w-3.5 h-3.5 rounded-full border border-border shrink-0"
                                        style={{
                                          backgroundColor: cv.hex ?? "#E5E5E5",
                                          boxShadow: cv.hex?.toLowerCase() === "#ffffff" ? "inset 0 0 0 1px #E5E5E5" : undefined,
                                        }}
                                      />
                                      {cv.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Pagination */}
                  {selectedProducts.length > PRODUCTS_PER_PAGE && (
                    <div className="flex items-center justify-between pt-4 mt-1 border-t border-border">
                      <p className="text-xs text-text-muted font-body">
                        {(productPage - 1) * PRODUCTS_PER_PAGE + 1}–{Math.min(productPage * PRODUCTS_PER_PAGE, selectedProducts.length)} sur {selectedProducts.length}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setProductPage((p) => Math.max(1, p - 1))}
                          disabled={productPage === 1}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-bg-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
                          </svg>
                        </button>
                        {Array.from({ length: Math.ceil(selectedProducts.length / PRODUCTS_PER_PAGE) }, (_, i) => i + 1).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setProductPage(p)}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-medium font-body transition-colors ${
                              p === productPage
                                ? "bg-bg-dark text-text-inverse"
                                : "border border-border hover:bg-bg-secondary text-text-muted"
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setProductPage((p) => Math.min(Math.ceil(selectedProducts.length / PRODUCTS_PER_PAGE), p + 1))}
                          disabled={productPage >= Math.ceil(selectedProducts.length / PRODUCTS_PER_PAGE)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-bg-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Right column: settings (1/3) ─────────────────────────────── */}
        <div className="xl:col-span-1 space-y-5">

          {/* Image */}
          <div className="bg-bg-primary border border-border rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="font-heading font-semibold text-text-primary text-sm">
              Image de la collection
            </h2>
            {preview ? (
              <div className="relative rounded-xl overflow-hidden border border-border">
                <img src={preview} alt="Apercu" className="w-full h-32 object-cover" />
                <div className="absolute top-2 right-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-primary/90 hover:bg-bg-primary border border-border text-text-muted hover:text-text-primary transition-colors"
                    title="Changer l'image"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setImage(null); setPreview(null); }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-primary/90 hover:bg-bg-primary border border-border text-[#EF4444] transition-colors"
                    title="Supprimer l'image"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full border-2 border-dashed border-border rounded-xl py-8 flex flex-col items-center gap-2 hover:border-[#9CA3AF] hover:bg-bg-secondary transition-colors disabled:opacity-50"
              >
                {uploading ? (
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-sm text-[#6B7280] font-body">Telechargement...</span>
                  </div>
                ) : (
                  <>
                    <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <span className="text-sm text-[#6B7280] font-body">Choisir une image</span>
                    <span className="text-xs text-text-muted">JPG, PNG, WEBP</span>
                  </>
                )}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleImageChange}
            />
          </div>

          {/* Translations */}
          <div className="bg-bg-primary border border-border rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-semibold text-text-primary text-sm">
                Traductions
              </h2>
              <TranslateButton
                text={name}
                onTranslated={(t) => setTranslations((prev) => ({ ...prev, ...t }))}
                disabled={!name.trim()}
              />
            </div>
            <div className="space-y-3">
              {VALID_LOCALES.filter((l) => l !== "fr").map((locale) => (
                <div key={locale}>
                  <label className="text-[11px] text-text-muted font-body font-medium uppercase tracking-wide">
                    {LOCALE_FULL_NAMES[locale]}
                  </label>
                  <input
                    type="text"
                    value={translations[locale] ?? ""}
                    onChange={(e) =>
                      setTranslations((prev) => ({ ...prev, [locale]: e.target.value }))
                    }
                    className="field-input text-sm mt-1"
                    placeholder={LOCALE_FULL_NAMES[locale]}
                    dir={locale === "ar" ? "rtl" : undefined}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ Product Picker Modal ═══════ */}
      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        catalogProductIds={selectedIds}
        onAdd={handlePickerAdd}
        onRemove={handlePickerRemove}
        categories={categories}
      />
    </div>
  );
}
