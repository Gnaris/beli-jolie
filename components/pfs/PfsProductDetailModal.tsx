"use client";

import { useState, useEffect, useCallback } from "react";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import PfsEditInfoModal from "./PfsEditInfoModal";
import PfsEditVariantsModal from "./PfsEditVariantsModal";
import PfsEditImagesModal from "./PfsEditImagesModal";
import PfsEditCompositionsModal from "./PfsEditCompositionsModal";
import PfsImageCompareModal from "./PfsImageCompareModal";
import type { ImageModifications } from "./PfsImageCompareModal";
import { applyImageModifications } from "@/app/actions/admin/pfs-image-compare";
import ColorSwatch from "@/components/ui/ColorSwatch";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface StagedSubColor {
  colorId: string;
  colorName: string;
  hex: string | null;
  patternImage: string | null;
}

export interface StagedPackColorLine {
  colors: { colorId: string; colorRef: string; colorName: string }[];
}

export interface StagedVariantData {
  colorId: string;
  colorRef: string;
  colorName: string;
  colorHex?: string | null;
  colorPatternImage?: string | null;
  subColors?: StagedSubColor[];
  packColorLines?: StagedPackColorLine[];
  unitPrice: number;
  weight: number;
  stock: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
  isPrimary: boolean;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}

export interface StagedImageGroup {
  colorRef: string;
  colorName: string;
  colorId: string;
  colorHex?: string | null;
  paths: string[];
}

export interface StagedComposition {
  compositionId: string;
  name: string;
  percentage: number;
}

export interface StagedTranslation {
  locale: string;
  name: string;
  description: string;
}

export interface StagedProductFull {
  id: string;
  reference: string;
  pfsReference: string;
  name: string;
  description: string;
  categoryId: string;
  categoryName: string;
  subCategoryIds?: string[] | null;
  subCategoryNames?: string[] | null;
  isBestSeller: boolean;
  status: string;
  variants: StagedVariantData[];
  compositions: StagedComposition[];
  translations: StagedTranslation[];
  imagesByColor: StagedImageGroup[];
  tags?: string[] | null;
  errorMessage?: string | null;
  existsInDb?: boolean;
  existingProductId?: string | null;
  differences?: Array<{ field: string; stagedValue: unknown; existingValue: unknown }> | null;
  createdProductId?: string | null;
}

interface PfsProductDetailModalProps {
  productId: string;
  open: boolean;
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onSaved: () => void;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getThumbSrc(path: string): string {
  if (!path) return "";
  if (path.endsWith(".webp")) return path.replace(/\.webp$/, "_thumb.webp");
  return path;
}

function getLargeSrc(path: string): string {
  if (!path) return "";
  // Remove _thumb or _md suffix to get the large version
  return path
    .replace(/_thumb\.webp$/, ".webp")
    .replace(/_md\.webp$/, ".webp");
}

function formatDiscount(
  type: "PERCENT" | "AMOUNT" | null,
  value: number | null
): string {
  if (!type || value == null) return "—";
  if (type === "PERCENT") return `${value}%`;
  return `${value.toFixed(2)}€`;
}

/** Build a groupKey from colorRef + sorted sub-color names */
function variantGroupKey(v: StagedVariantData): string {
  const subNames = (v.subColors ?? []).map((sc) => sc.colorName).join(",");
  return `${v.colorRef}::${subNames}`;
}

interface VariantGroup {
  key: string;
  colorName: string;
  colorRef: string;
  colorHex?: string | null;
  colorPatternImage?: string | null;
  subColors?: StagedSubColor[];
  variants: StagedVariantData[];
}

/** Group variants by color + sub-colors */
function groupVariants(variants: StagedVariantData[]): VariantGroup[] {
  const map = new Map<string, VariantGroup>();
  for (const v of variants) {
    const key = variantGroupKey(v);
    if (!map.has(key)) {
      map.set(key, {
        key,
        colorName: v.colorName,
        colorRef: v.colorRef,
        colorHex: v.colorHex,
        colorPatternImage: v.colorPatternImage,
        subColors: v.subColors,
        variants: [],
      });
    }
    map.get(key)!.variants.push(v);
  }
  return Array.from(map.values());
}

const LOCALE_LABELS: Record<string, string> = {
  en: "Anglais",
  de: "Allemand",
  es: "Espagnol",
  it: "Italien",
  ar: "Arabe",
  zh: "Chinois",
};

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

function StarIcon({ className, filled }: { className?: string; filled: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function ChevronIcon({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg
      className={`${className ?? ""} transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function PackageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
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
// Section Wrapper
// ─────────────────────────────────────────────

function Section({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary font-[family-name:var(--font-poppins)]">
          {title}
        </h3>
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-primary hover:text-text-primary"
            aria-label={`Modifier ${title.toLowerCase()}`}
          >
            <EditIcon className="h-3.5 w-3.5" />
            Modifier
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────
// Image Zoom Overlay
// ─────────────────────────────────────────────

function ImageZoom({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const backdrop = useBackdropClose(onClose);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="Fermer le zoom"
      >
        <XIcon className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export default function PfsProductDetailModal({
  productId,
  open,
  onClose,
  onApprove,
  onReject,
  onSaved,
}: PfsProductDetailModalProps) {
  const [product, setProduct] = useState<StagedProductFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdrop = useBackdropClose(onClose);

  // Image zoom state
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

  // Edit modals
  const [editInfo, setEditInfo] = useState(false);
  const [editVariants, setEditVariants] = useState(false);
  const [editImages, setEditImages] = useState(false);
  const [editCompositions, setEditCompositions] = useState(false);
  const [compareImages, setCompareImages] = useState(false);
  const [savingCompareImages, setSavingCompareImages] = useState(false);

  // Accordion state for translations
  const [openLocales, setOpenLocales] = useState<Set<string>>(new Set());

  // Description expand
  const [descExpanded, setDescExpanded] = useState(false);

  // Color map for resolving hex/patternImage
  const [colorMap, setColorMap] = useState<Map<string, { hex: string | null; patternImage: string | null }>>(new Map());

  // ── Fetch colors ──
  useEffect(() => {
    if (!open) return;
    fetch("/api/admin/pfs-sync/entities")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.colors) return;
        const map = new Map<string, { hex: string | null; patternImage: string | null }>();
        for (const c of data.colors) map.set(c.id, { hex: c.hex, patternImage: c.patternImage });
        setColorMap(map);
      })
      .catch(() => {});
  }, [open]);

  // Helper to resolve color display data
  const resolveColor = (v: StagedVariantData) => {
    // First try stored data, then fallback to color map
    const hex = v.colorHex ?? colorMap.get(v.colorId)?.hex ?? null;
    const pat = v.colorPatternImage ?? colorMap.get(v.colorId)?.patternImage ?? null;
    return { hex, patternImage: pat };
  };

  // ── Fetch product data ──
  const fetchProduct = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pfs-sync/staged/${productId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }
      const { product: p } = await res.json();
      // Parse JSON fields if they are strings
      const parsed: StagedProductFull = {
        ...p,
        variants: typeof p.variants === "string" ? JSON.parse(p.variants) : p.variants ?? [],
        compositions: typeof p.compositions === "string" ? JSON.parse(p.compositions) : p.compositions ?? [],
        translations: typeof p.translations === "string" ? JSON.parse(p.translations) : p.translations ?? [],
        imagesByColor: typeof p.imagesByColor === "string" ? JSON.parse(p.imagesByColor) : p.imagesByColor ?? [],
      };
      setProduct(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (open && productId) {
      fetchProduct();
      // Reset state
      setDescExpanded(false);
      setOpenLocales(new Set());
    }
  }, [open, productId, fetchProduct]);

  // Toggle locale accordion
  const toggleLocale = (locale: string) => {
    setOpenLocales((prev) => {
      const next = new Set(prev);
      if (next.has(locale)) next.delete(locale);
      else next.add(locale);
      return next;
    });
  };

  // Handle best-seller toggle
  const handleToggleBestSeller = async () => {
    if (!product) return;
    try {
      const res = await fetch(`/api/admin/pfs-sync/staged/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isBestSeller: !product.isBestSeller }),
      });
      if (!res.ok) return;
      const { product: updated } = await res.json();
      setProduct((prev) =>
        prev
          ? {
              ...prev,
              isBestSeller: updated.isBestSeller,
            }
          : prev
      );
      onSaved();
    } catch {
      // silent fail
    }
  };

  // Handle edit modal saved
  const handleEditSaved = (updated: StagedProductFull) => {
    setProduct(updated);
    onSaved();
  };

  if (!open) return null;

  const isReady = product?.status === "READY";

  // Detect orphaned images — compare full color composition, not just main colorRef
  // Image "NOIR" should NOT match variant "NOIR/ROUGE/JAUNE"
  const orphanedImageGroups = product
    ? (() => {
        const fullKey = (v: StagedVariantData) => {
          const parts = [v.colorRef, ...(v.subColors ?? []).map((sc) => sc.colorName.toUpperCase().replace(/\s+/g, "_"))];
          return parts.join("::");
        };
        const variantKeys = new Set(product.variants.map(fullKey));
        // Map each image's colorRef to its original full key
        const originalKeyByRef = new Map<string, string>();
        for (const v of product.variants) {
          originalKeyByRef.set(v.colorRef, fullKey(v));
        }
        return product.imagesByColor.filter((g) => {
          const origKey = originalKeyByRef.get(g.colorRef) ?? g.colorRef;
          return !variantKeys.has(origKey);
        });
      })()
    : [];

  return (
    <>
      {/* ── Main overlay ── */}
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4 sm:p-8" onMouseDown={backdrop.onMouseDown} onMouseUp={backdrop.onMouseUp}>
        <div
          className="relative w-full max-w-4xl rounded-2xl bg-bg-primary shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Close button ── */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-xl bg-bg-secondary text-text-secondary transition-colors hover:bg-border hover:text-text-primary"
            aria-label="Fermer"
          >
            <XIcon className="h-5 w-5" />
          </button>

          {/* ── Loading / Error states ── */}
          {loading && (
            <div className="flex items-center justify-center p-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-text-primary" />
            </div>
          )}

          {error && !loading && (
            <div className="p-8 text-center">
              <p className="text-sm text-[#EF4444]">{error}</p>
              <button
                onClick={fetchProduct}
                className="btn-secondary mt-4"
              >
                Réessayer
              </button>
            </div>
          )}

          {/* ── Content ── */}
          {product && !loading && (
            <div className="flex flex-col gap-4 p-5 sm:p-6 pb-0">
              {/* ─── 1. Header ─── */}
              <div className="flex items-start gap-3 pr-12">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="badge badge-neutral text-xs shrink-0">
                      {product.reference}
                    </span>
                    {product.pfsReference !== product.reference && (
                      <span className="text-xs text-text-secondary">
                        PFS: {product.pfsReference}
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg sm:text-xl font-semibold text-text-primary font-[family-name:var(--font-poppins)] leading-tight">
                    {product.name}
                  </h2>
                </div>
                <button
                  onClick={handleToggleBestSeller}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    product.isBestSeller
                      ? "bg-[#F59E0B]/10 text-[#F59E0B]"
                      : "bg-bg-secondary text-text-secondary hover:text-[#F59E0B]"
                  }`}
                  aria-label={product.isBestSeller ? "Retirer des best-sellers" : "Marquer best-seller"}
                  aria-pressed={product.isBestSeller}
                  title={product.isBestSeller ? "Best-seller" : "Marquer best-seller"}
                >
                  <StarIcon className="h-5 w-5" filled={product.isBestSeller} />
                </button>
              </div>

              {/* ─── Duplicate warning ─── */}
              {product.existsInDb && (
                <div className="rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/20 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="h-5 w-5 text-[#F59E0B] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span className="text-sm font-medium text-[#F59E0B]">
                      Ce produit existe déjà dans l&apos;application
                    </span>
                    {product.existingProductId && (
                      <a
                        href={`/admin/produits/${product.existingProductId}/modifier`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-xs text-[#3B82F6] underline underline-offset-2 hover:text-[#2563EB]"
                      >
                        Voir le produit
                      </a>
                    )}
                  </div>
                  {product.differences && product.differences.length > 0 ? (
                    <div className="space-y-1.5 mt-3">
                      <p className="text-xs font-medium text-text-secondary">{product.differences.length} différence(s) détectée(s) :</p>
                      {product.differences.map((d, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs bg-bg-primary/50 rounded-lg px-3 py-2">
                          <span className="font-medium text-text-primary w-28 shrink-0">{d.field}</span>
                          <span className="text-[#EF4444] line-through">{JSON.stringify(d.existingValue)}</span>
                          <span className="text-text-secondary">→</span>
                          <span className="text-[#22C55E]">{JSON.stringify(d.stagedValue)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-text-secondary mt-1">Aucune différence de données détectée.</p>
                  )}
                  <button
                    onClick={() => setCompareImages(true)}
                    disabled={savingCompareImages}
                    className="mt-3 btn-secondary text-xs disabled:opacity-50"
                  >
                    {savingCompareImages ? (
                      <div className="h-4 w-4 mr-1.5 inline-block animate-spin rounded-full border-2 border-border border-t-text-primary" />
                    ) : (
                      <svg className="h-4 w-4 mr-1.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}
                    {savingCompareImages ? "Application en cours..." : "Comparer les images"}
                  </button>
                </div>
              )}

              {/* ─── 2. Images ─── */}
              <Section title="Images" onEdit={() => setEditImages(true)}>
                {product.imagesByColor.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-text-secondary">
                    <PackageIcon className="h-8 w-8 mr-2" />
                    <span className="text-sm">Aucune image</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {product.imagesByColor.map((group) => {
                      // Resolve color display for this image group
                      const imgVariant = product.variants.find((v) => v.colorRef === group.colorRef);
                      const imgHex = imgVariant?.colorHex ?? colorMap.get(group.colorId)?.hex ?? null;
                      const imgPat = imgVariant?.colorPatternImage ?? colorMap.get(group.colorId)?.patternImage ?? null;
                      const imgSubSegs = imgVariant?.subColors && imgVariant.subColors.length > 0
                        ? imgVariant.subColors.map((sc) => {
                            const r = colorMap.get(sc.colorId);
                            return { hex: sc.hex ?? r?.hex ?? null, patternImage: sc.patternImage ?? r?.patternImage ?? null };
                          })
                        : undefined;
                      const allColorNames = imgVariant
                        ? [imgVariant.colorName, ...(imgVariant.subColors ?? []).map((sc) => sc.colorName)].join(", ")
                        : group.colorName;
                      return (
                      <div key={group.colorRef}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <ColorSwatch hex={imgHex} patternImage={imgPat} subColors={imgSubSegs} size={16} rounded="full" border />
                          <p className="text-xs font-medium text-text-secondary">
                            {allColorNames}
                          </p>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                          {group.paths.map((path, i) => (
                            <button
                              key={`${group.colorRef}-${i}`}
                              onClick={() => setZoomSrc(getLargeSrc(path))}
                              className="shrink-0 h-20 w-20 sm:h-24 sm:w-24 rounded-lg overflow-hidden border border-border bg-bg-primary transition-shadow hover:shadow-md"
                              aria-label={`Voir l'image ${i + 1} de ${group.colorName}`}
                            >
                              <img
                                src={getThumbSrc(path)}
                                alt={`${product.name} - ${group.colorName} ${i + 1}`}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </Section>

              {/* ─── 3. Informations ─── */}
              <Section title="Informations" onEdit={() => setEditInfo(true)}>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="field-label text-xs w-28 shrink-0">Catégorie</span>
                    <span className="badge badge-neutral text-xs">{product.categoryName}</span>
                  </div>
                  {product.subCategoryNames && product.subCategoryNames.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="field-label text-xs w-28 shrink-0">Sous-catégorie{product.subCategoryNames.length > 1 ? "s" : ""}</span>
                      <div className="flex flex-wrap gap-1">
                        {product.subCategoryNames.map((name, i) => (
                          <span key={product.subCategoryIds?.[i] ?? i} className="badge badge-neutral text-xs">{name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <span className="field-label text-xs">Description</span>
                    <p
                      className={`mt-1 text-sm text-text-secondary leading-relaxed ${
                        !descExpanded ? "line-clamp-3" : ""
                      }`}
                    >
                      {product.description || "Aucune description"}
                    </p>
                    {product.description && product.description.length > 200 && (
                      <button
                        onClick={() => setDescExpanded(!descExpanded)}
                        className="mt-1 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                      >
                        {descExpanded ? "Voir moins" : "Voir plus"}
                      </button>
                    )}
                  </div>
                </div>
              </Section>

              {/* ─── 4. Variants (grouped by color+subColors) ─── */}
              <Section title="Variantes" onEdit={() => setEditVariants(true)}>
                {product.variants.length === 0 ? (
                  <p className="text-sm text-text-secondary py-2">Aucune variante</p>
                ) : (
                  <div className="space-y-3">
                    {groupVariants(product.variants).map((group) => {
                      const color = resolveColor(group.variants[0]);
                      // Resolve sub-color hex/patternImage via colorMap (DB data)
                      const subSegs = group.subColors && group.subColors.length > 0
                        ? group.subColors.map((sc) => {
                            const resolved = colorMap.get(sc.colorId);
                            return {
                              hex: sc.hex ?? resolved?.hex ?? null,
                              patternImage: sc.patternImage ?? resolved?.patternImage ?? null,
                            };
                          })
                        : undefined;
                      return (
                        <div key={group.key} className="rounded-xl border border-border bg-bg-secondary/50 overflow-hidden">
                          {/* Color header */}
                          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-light bg-bg-secondary">
                            <ColorSwatch
                              hex={color.hex}
                              patternImage={color.patternImage}
                              subColors={subSegs}
                              size={20}
                              rounded="full"
                              border
                            />
                            <span className="text-sm font-medium text-text-primary">
                              {[group.colorName, ...(group.subColors ?? []).map((sc) => sc.colorName)].join(", ")}
                            </span>
                          </div>
                          {/* Variant rows */}
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[500px] text-sm">
                              <thead>
                                <tr className="border-b border-border-light">
                                  <th className="table-header text-left py-1.5 px-4">Type</th>
                                  <th className="table-header text-right py-1.5 px-3">Prix unitaire</th>
                                  <th className="table-header text-right py-1.5 px-3">Stock</th>
                                  <th className="table-header text-right py-1.5 px-3">Poids</th>
                                  <th className="table-header text-right py-1.5 px-4">Remise</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.variants.map((v, vi) => (
                                  <tr key={`${v.saleType}-${vi}`} className="border-b border-border-light last:border-0">
                                    <td className="py-2 px-4">
                                      <span className={`badge text-xs ${v.saleType === "PACK" ? "badge-purple" : "badge-neutral"}`}>
                                        {v.saleType}
                                        {v.saleType === "PACK" && v.packQuantity ? ` ×${v.packQuantity}` : ""}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 text-right tabular-nums">{v.unitPrice.toFixed(2)}€</td>
                                    <td className="py-2 px-3 text-right tabular-nums">{v.stock}</td>
                                    <td className="py-2 px-3 text-right tabular-nums">{v.weight.toFixed(2)} kg</td>
                                    <td className="py-2 px-4 text-right">{formatDiscount(v.discountType, v.discountValue)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>

              {/* ─── 5. Compositions ─── */}
              {product.compositions.length > 0 && (
                <Section title="Compositions" onEdit={product.status === "READY" ? () => setEditCompositions(true) : undefined}>
                  <div className="flex flex-wrap gap-2">
                    {product.compositions.map((c, idx) => (
                      <span
                        key={`${c.compositionId}-${idx}`}
                        className="badge badge-neutral text-xs"
                      >
                        {c.name} — {c.percentage}%
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {/* ─── 6. Tags ─── */}
              <Section title="Mots-clés" onEdit={product.status === "READY" ? () => setEditInfo(true) : undefined}>
                {product.tags && product.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {[...new Set(product.tags)].map((tag) => (
                      <span key={tag} className="badge badge-neutral text-xs">{tag}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary py-1">Aucun mot-clé</p>
                )}
              </Section>

              {/* ─── 7. Translations ─── */}
              {product.translations.length > 0 && (
                <Section title="Traductions">
                  <div className="space-y-1">
                    {product.translations.map((t) => {
                      const isOpen = openLocales.has(t.locale);
                      const label = LOCALE_LABELS[t.locale] ?? t.locale.toUpperCase();
                      return (
                        <div key={t.locale} className="border border-border-light rounded-lg overflow-hidden">
                          <button
                            onClick={() => toggleLocale(t.locale)}
                            className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-primary"
                            aria-expanded={isOpen}
                          >
                            <span className="flex items-center gap-2">
                              <span className="uppercase text-[10px] font-semibold text-text-secondary bg-bg-primary rounded px-1.5 py-0.5">
                                {t.locale}
                              </span>
                              {label}
                            </span>
                            <ChevronIcon className="h-4 w-4 text-text-secondary" open={isOpen} />
                          </button>
                          {isOpen && (
                            <div className="border-t border-border-light px-3 py-2 space-y-1">
                              <p className="text-xs font-medium text-text-secondary">Nom</p>
                              <p className="text-sm text-text-primary">{t.name}</p>
                              <p className="text-xs font-medium text-text-secondary mt-2">Description</p>
                              <p className="text-sm text-text-secondary leading-relaxed">{t.description}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* ─── Error message ─── */}
              {product.errorMessage && (
                <div className="rounded-xl border border-[#EF4444]/20 bg-[#EF4444]/5 p-4">
                  <p className="text-xs font-medium text-[#EF4444] mb-1">Erreur</p>
                  <p className="text-sm text-[#EF4444]/80">{product.errorMessage}</p>
                </div>
              )}

              {/* ─── Orphaned images warning ─── */}
              {orphanedImageGroups.length > 0 && (
                <div className="rounded-xl border-2 border-[#F59E0B]/40 bg-[#F59E0B]/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-[#F59E0B] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <p className="text-sm font-medium text-[#F59E0B]">
                      Images sans couleur attribuée
                    </p>
                  </div>
                  <p className="text-xs text-text-secondary">
                    {orphanedImageGroups.length} groupe(s) d&apos;images ne correspond(ent) à aucune variante.
                    Modifiez les variantes pour réattribuer ou supprimer ces images avant d&apos;approuver.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {orphanedImageGroups.map((g) => (
                      <span key={g.colorRef} className="badge badge-warning text-xs">
                        {g.colorName} ({g.paths.length} image{g.paths.length > 1 ? "s" : ""})
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => setEditVariants(true)}
                    className="btn-secondary text-xs"
                  >
                    <EditIcon className="h-3.5 w-3.5 inline mr-1.5" />
                    Modifier les variantes
                  </button>
                </div>
              )}

              {/* ─── Footer (sticky) ─── */}
              <div className="sticky bottom-0 -mx-5 sm:-mx-6 mt-2 flex items-center justify-end gap-3 border-t border-border bg-bg-primary px-5 sm:px-6 py-4 rounded-b-2xl">
                {isReady && (
                  <>
                    <button
                      onClick={() => onReject(product.id)}
                      className="btn-danger min-w-[140px]"
                    >
                      Refuser
                    </button>
                    <button
                      onClick={() => onApprove(product.id)}
                      disabled={orphanedImageGroups.length > 0}
                      className={`btn-primary min-w-[140px] ${
                        orphanedImageGroups.length > 0
                          ? "opacity-50 cursor-not-allowed bg-[#22C55E]/50 border-[#22C55E]/50"
                          : "bg-[#22C55E] hover:bg-[#16A34A] border-[#22C55E]"
                      }`}
                      title={orphanedImageGroups.length > 0 ? "Résolvez les images orphelines avant d'approuver" : undefined}
                    >
                      <CheckIcon className="h-4 w-4" />
                      Approuver
                    </button>
                  </>
                )}
                <button onClick={onClose} className="btn-secondary min-w-[140px]">
                  Fermer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Image Zoom ── */}
      {zoomSrc && (
        <ImageZoom
          src={zoomSrc}
          alt={product?.name ?? "Image"}
          onClose={() => setZoomSrc(null)}
        />
      )}

      {/* ── Edit modals ── */}
      {product && (
        <>
          <PfsEditInfoModal
            product={product}
            open={editInfo}
            onClose={() => setEditInfo(false)}
            onSaved={handleEditSaved}
          />
          <PfsEditVariantsModal
            product={product}
            open={editVariants}
            onClose={() => setEditVariants(false)}
            onSaved={handleEditSaved}
          />
          <PfsEditImagesModal
            product={product}
            open={editImages}
            onClose={() => setEditImages(false)}
            onSaved={handleEditSaved}
          />
          <PfsEditCompositionsModal
            product={product}
            open={editCompositions}
            onClose={() => setEditCompositions(false)}
            onSaved={handleEditSaved}
          />
          {product.existsInDb && product.existingProductId && (
            <PfsImageCompareModal
              product={product}
              open={compareImages}
              onClose={() => setCompareImages(false)}
              onSaved={async (modifications: ImageModifications) => {
                if (!product.existingProductId) return;
                const hasChanges =
                  modifications.replacements.length > 0 ||
                  modifications.deletions.length > 0 ||
                  modifications.reorders.length > 0;
                if (!hasChanges) {
                  setCompareImages(false);
                  return;
                }
                setSavingCompareImages(true);
                try {
                  const result = await applyImageModifications(
                    product.existingProductId,
                    modifications
                  );
                  if (!result.success) {
                    alert(result.error ?? "Erreur lors de l'application des modifications");
                  }
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Erreur réseau");
                } finally {
                  setSavingCompareImages(false);
                  setCompareImages(false);
                  onSaved();
                }
              }}
            />
          )}
        </>
      )}
    </>
  );
}
