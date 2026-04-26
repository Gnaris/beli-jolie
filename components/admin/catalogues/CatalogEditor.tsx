"use client";

import { useState, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  updateCatalog,
  addProductToCatalog,
  removeProductFromCatalog,
  updateCatalogProductDisplay,
} from "@/app/actions/admin/catalogs";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import ProductPickerModal, { type PickerProduct } from "./ProductPickerModal";

// ─── Types bruts Prisma (tels que retournés par la page) ──────────────────────

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

interface CatalogProductRow {
  productId: string;
  position: number;
  selectedColorId: string | null;
  selectedImagePath: string | null;
  product: ProductSnap;
}

interface CatalogData {
  id: string;
  title: string;
  token: string;
  status: "INACTIVE" | "ACTIVE";
  products: CatalogProductRow[];
}

interface CategoryOption {
  id: string;
  name: string;
}

interface Props {
  catalog: CatalogData;
  categories: CategoryOption[];
}

// ─── Type couleur dédupliquée ─────────────────────────────────────────────────

interface UniqueColor {
  colorId: string;
  name: string;
  hex: string | null;
  unitPrice: number;
  isPrimary: boolean;
  images: RawImage[];
}

// ─── Helper : déduplique les couleurs d'un produit par colorId ────────────────
function deduplicateColors(raw: RawColorVariant[], images: RawImage[]): UniqueColor[] {
  const map = new Map<string, UniqueColor>();
  for (const r of raw) {
    const existing = map.get(r.colorId);
    if (!existing) {
      map.set(r.colorId, {
        colorId: r.colorId,
        name: r.color.name,
        hex: r.color.hex,
        unitPrice: r.unitPrice,
        isPrimary: r.isPrimary,
        images: images.filter((img) => img.colorId === r.colorId),
      });
    } else {
      if (r.isPrimary) existing.isPrimary = true;
    }
  }
  return Array.from(map.values());
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function CatalogEditor({ catalog, categories }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  // ── État local ──────────────────────────────────────────────────────────────
  const [title, setTitle] = useState(catalog.title);
  const [status, setStatus] = useState<"INACTIVE" | "ACTIVE">(catalog.status);
  const [selectedProducts, setSelectedProducts] = useState<CatalogProductRow[]>(catalog.products);
  const [saved, setSaved] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [productPage, setProductPage] = useState(1);
  const PRODUCTS_PER_PAGE = 20;
  const [pickerOpen, setPickerOpen] = useState(false);

  // IDs déjà dans le catalogue
  const selectedIds = useMemo(() => new Set(selectedProducts.map((p) => p.productId)), [selectedProducts]);

  // ─── Sauvegarder les réglages ──────────────────────────────────────────────
  const handleSave = () => {
    showLoading();
    startTransition(async () => {
      try {
        await updateCatalog(catalog.id, {
          title,
          status,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } finally {
        hideLoading();
      }
    });
  };

  // ─── Ajouter un produit (depuis le picker) ─────────────────────────────────
  const handlePickerAdd = (pickerProduct: PickerProduct) => {
    if (selectedIds.has(pickerProduct.id)) return;
    startTransition(async () => {
      await addProductToCatalog(catalog.id, pickerProduct.id);
      // Convert PickerProduct → ProductSnap for local state
      const snap: ProductSnap = {
        id: pickerProduct.id,
        name: pickerProduct.name,
        reference: pickerProduct.reference,
        colorImages: pickerProduct.colorImages,
        colors: pickerProduct.colors,
      };
      setSelectedProducts((prev) => [
        ...prev,
        { productId: snap.id, position: prev.length, selectedColorId: null, selectedImagePath: null, product: snap },
      ]);
    });
  };

  // ─── Retirer un produit ───────────────────────────────────────────────────
  const handleRemove = (productId: string) => {
    showLoading();
    startTransition(async () => {
      try {
        await removeProductFromCatalog(catalog.id, productId);
        setSelectedProducts((prev) => prev.filter((p) => p.productId !== productId));
        if (expandedProduct === productId) setExpandedProduct(null);
      } finally {
        hideLoading();
      }
    });
  };

  // ─── Retirer un produit (depuis le picker, sans loading overlay) ──────────
  const handlePickerRemove = (productId: string) => {
    startTransition(async () => {
      await removeProductFromCatalog(catalog.id, productId);
      setSelectedProducts((prev) => prev.filter((p) => p.productId !== productId));
      if (expandedProduct === productId) setExpandedProduct(null);
    });
  };

  // ─── Changer la couleur d'un produit (reset image) ────────────────────────
  const handleColorChange = (productId: string, colorId: string | null) => {
    showLoading();
    startTransition(async () => {
      try {
        await updateCatalogProductDisplay(catalog.id, productId, colorId, null);
        setSelectedProducts((prev) =>
          prev.map((p) =>
            p.productId === productId
              ? { ...p, selectedColorId: colorId, selectedImagePath: null }
              : p
          )
        );
      } finally {
        hideLoading();
      }
    });
  };

  // ─── Changer l'image spécifique d'un produit ──────────────────────────────
  const handleImageChange = (productId: string, imagePath: string | null, currentColorId: string | null) => {
    showLoading();
    startTransition(async () => {
      try {
        await updateCatalogProductDisplay(catalog.id, productId, currentColorId, imagePath);
        setSelectedProducts((prev) =>
          prev.map((p) =>
            p.productId === productId ? { ...p, selectedImagePath: imagePath } : p
          )
        );
      } finally {
        hideLoading();
      }
    });
  };

  // ─── Copier le lien ───────────────────────────────────────────────────────
  const handleCopyLink = async () => {
    const url = `${window.location.origin}/catalogue/${catalog.token}`;
    await navigator.clipboard.writeText(url);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
  };

  // Detect if there are unsaved changes
  const hasChanges = title !== catalog.title || status !== catalog.status;

  return (
    <div className="space-y-6">

      {/* ════════════════════════════════════════════════════════════════════════
          BARRE D'EN-TÊTE : retour, titre, statut, actions
          ════════════════════════════════════════════════════════════════════════ */}
      <div className="bg-bg-primary border border-border rounded-2xl p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Retour + Titre */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              onClick={() => router.push("/admin/catalogues")}
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl border border-border hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-primary"
              title="Retour aux catalogues"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1 min-w-0 text-lg font-heading font-semibold text-text-primary bg-transparent border-0 outline-none focus:ring-0 px-0 placeholder:text-text-muted"
              placeholder="Titre du catalogue"
            />
          </div>

          {/* Statut + Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Toggle statut */}
            <button
              type="button"
              onClick={() => setStatus(status === "INACTIVE" ? "ACTIVE" : "INACTIVE")}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium font-body transition-all hover:bg-bg-secondary"
              title={status === "ACTIVE" ? "Désactiver le catalogue" : "Activer le catalogue"}
            >
              <span
                className={`relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-200 ${
                  status === "ACTIVE" ? "bg-[#22C55E]" : "bg-[#D1D5DB]"
                }`}
              >
                <span
                  className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 mt-[2px] ${
                    status === "ACTIVE" ? "translate-x-[16px]" : "translate-x-[2px]"
                  }`}
                />
              </span>
              <span className={status === "ACTIVE" ? "text-[#16A34A]" : "text-[#9CA3AF]"}>
                {status === "ACTIVE" ? "Activé" : "Désactivé"}
              </span>
            </button>

            {/* Separateur */}
            <div className="w-px h-6 bg-border" />

            {/* Copier le lien */}
            <button
              onClick={handleCopyLink}
              title="Copier le lien"
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-border hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-primary"
            >
              {copyDone ? (
                <svg className="w-4 h-4 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
              )}
            </button>

            {/* Visualiser */}
            <a
              href={`/catalogue/${catalog.token}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Visualiser le catalogue"
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-border hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-primary"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>

            {/* Enregistrer */}
            <button
              onClick={handleSave}
              disabled={isPending}
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
              ) : isPending ? (
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

      {/* ════════════════════════════════════════════════════════════════════════
          CONTENU PRINCIPAL : produits
          ════════════════════════════════════════════════════════════════════════ */}
      <div>
        <div className="space-y-5">

          {/* Bloc produits avec recherche intégrée */}
          <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">

            {/* Header du bloc + bouton ajouter */}
            <div className="p-5 pb-0">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="font-heading font-semibold text-text-primary text-sm">
                    Produits du catalogue
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

            {/* Liste des produits sélectionnés */}
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
                    Aucun produit dans ce catalogue
                  </p>
                  <p className="text-xs text-text-muted font-body">
                    Utilisez la barre de recherche ci-dessus pour ajouter des produits.
                  </p>
                </div>
              ) : (
                <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedProducts
                    .slice((productPage - 1) * PRODUCTS_PER_PAGE, productPage * PRODUCTS_PER_PAGE)
                    .map((row) => {
                    const uniqueColors = deduplicateColors(row.product.colors, row.product.colorImages);
                    const hasMultipleColors = uniqueColors.length > 1;
                    const activeColor = row.selectedColorId
                      ? uniqueColors.find((c) => c.colorId === row.selectedColorId)
                      : (uniqueColors.find((c) => c.isPrimary) ?? uniqueColors[0]);
                    const activeImages = activeColor?.images ?? row.product.colorImages;
                    const hasMultipleImages = activeImages.length > 1;
                    const displayImage = row.selectedImagePath ?? activeImages[0]?.path ?? null;
                    const isExpanded = expandedProduct === row.productId;
                    const hasOptions = hasMultipleColors || hasMultipleImages;

                    return (
                      <div
                        key={row.productId}
                        className={`rounded-xl border transition-all ${
                          isExpanded
                            ? "border-[#1A1A1A]/20 bg-bg-secondary/30 shadow-sm"
                            : "border-border hover:border-[#D1D5DB] hover:shadow-sm"
                        }`}
                      >
                        {/* Carte produit */}
                        <div className="p-3 flex items-start gap-3">
                          {/* Image plus grande */}
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

                          {/* Infos */}
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
                                <span className="text-xs text-text-muted font-body ml-auto">{Number(activeColor.unitPrice).toFixed(2)} \u20AC</span>
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex flex-col gap-1 shrink-0">
                            {/* Personnaliser (si options) */}
                            {hasOptions && (
                              <button
                                type="button"
                                onClick={() => setExpandedProduct(isExpanded ? null : row.productId)}
                                title="Personnaliser l'affichage"
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
                            {/* Retirer */}
                            <button
                              onClick={() => handleRemove(row.productId)}
                              disabled={isPending}
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-[#EF4444] hover:bg-[#FEF2F2] transition-colors disabled:opacity-50"
                              title="Retirer du catalogue"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Panel de personnalisation (couleur + image) */}
                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-3">
                            {/* Sélecteur couleur */}
                            {hasMultipleColors && (
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
                                      row.selectedColorId === null
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
                                        row.selectedColorId === cv.colorId
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
                            )}

                            {/* Sélecteur image */}
                            {hasMultipleImages && (
                              <div className="p-3 rounded-lg bg-bg-primary border border-border">
                                <p className="text-[11px] text-text-muted font-body font-medium mb-2 uppercase tracking-wide">
                                  Image affichee
                                </p>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {activeImages.map((img, idx) => {
                                    const isSelected =
                                      row.selectedImagePath === img.path ||
                                      (row.selectedImagePath === null && idx === 0);
                                    return (
                                      <button
                                        key={img.path}
                                        type="button"
                                        onClick={() =>
                                          handleImageChange(
                                            row.productId,
                                            idx === 0 ? null : img.path,
                                            row.selectedColorId
                                          )
                                        }
                                        disabled={isPending}
                                        title={`Image ${idx + 1}`}
                                        className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
                                          isSelected
                                            ? "border-[#1A1A1A] scale-105"
                                            : "border-border hover:border-[#9CA3AF]"
                                        }`}
                                      >
                                        <Image
                                          src={img.path}
                                          alt={`Image ${idx + 1}`}
                                          className="w-full h-full object-cover"
                                          width={56}
                                          height={56}
                                          unoptimized
                                        />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
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

      </div>

      {/* ── Product Picker Modal ──────────────────────────────────────── */}
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
