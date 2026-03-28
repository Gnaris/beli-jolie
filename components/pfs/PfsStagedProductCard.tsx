"use client";

import { useCallback } from "react";
import ColorSwatch from "@/components/ui/ColorSwatch";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface StagedPackColorLine {
  colors: { colorId: string; colorRef: string; colorName: string }[];
}

export interface StagedVariantData {
  colorId: string;
  colorRef: string;
  colorName: string;
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
  paths: string[];
}

export interface StagedComposition {
  compositionId: string;
  name: string;
  percentage: number;
}

export interface StagedProduct {
  id: string;
  reference: string;
  pfsReference: string;
  name: string;
  description: string;
  categoryName: string;
  isBestSeller: boolean;
  status: "PREPARING" | "READY" | "APPROVED" | "REJECTED" | "ERROR";
  variants: StagedVariantData[];
  compositions?: StagedComposition[];
  imagesByColor: StagedImageGroup[];
  errorMessage?: string | null;
  createdProductId?: string | null;
}

export interface ColorMapEntry {
  hex: string | null;
  patternImage: string | null;
}

interface PfsStagedProductCardProps {
  product: StagedProduct;
  selected: boolean;
  colorMap: Map<string, ColorMapEntry>;
  onSelect: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getThumbSrc(path: string): string {
  if (!path) return "";
  if (path.endsWith(".webp")) {
    return path.replace(/\.webp$/, "_thumb.webp");
  }
  return path;
}

function computePriceRange(variants: StagedVariantData[]): { min: number; max: number } | null {
  if (variants.length === 0) return null;
  const prices = variants.map((v) => v.unitPrice);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

const STATUS_CONFIG: Record<
  StagedProduct["status"],
  { label: string; className: string }
> = {
  PREPARING: { label: "Préparation…", className: "badge badge-warning" },
  READY: { label: "Prêt", className: "badge badge-info" },
  APPROVED: { label: "Approuvé", className: "badge badge-success" },
  REJECTED: { label: "Refusé", className: "badge badge-error" },
  ERROR: { label: "Erreur", className: "badge badge-error" },
};

// ─────────────────────────────────────────────
// Icons (inline SVG)
// ─────────────────────────────────────────────

function PackageIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
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

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function PfsStagedProductCard({
  product,
  selected,
  colorMap,
  onSelect,
  onApprove,
  onReject,
}: PfsStagedProductCardProps) {
  const { status } = product;
  const isReady = status === "READY";
  const isDimmed = status === "APPROVED" || status === "REJECTED";
  const isPreparing = status === "PREPARING";

  const priceRange = computePriceRange(product.variants);
  const variantCount = product.variants.length;
  const statusCfg = STATUS_CONFIG[status];

  // First thumbnail
  const firstImage =
    product.imagesByColor.length > 0 && product.imagesByColor[0].paths.length > 0
      ? getThumbSrc(product.imagesByColor[0].paths[0])
      : null;

  // Unique colors from variants
  const uniqueColors = (() => {
    const seen = new Set<string>();
    return product.variants.filter((v) => {
      if (seen.has(v.colorId)) return false;
      seen.add(v.colorId);
      return true;
    });
  })();

  // Compositions
  const compositions = product.compositions ?? [];

  const handleSelect = useCallback(() => {
    onSelect(product.id);
  }, [onSelect, product.id]);

  const handleApprove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onApprove(product.id);
    },
    [onApprove, product.id],
  );

  const handleReject = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onReject(product.id);
    },
    [onReject, product.id],
  );

  return (
    <div
      className={`
        card animate-fadeIn relative flex flex-col overflow-hidden transition-opacity duration-300
        ${isDimmed ? "opacity-60" : ""}
        ${isPreparing ? "animate-pulse" : ""}
      `}
    >
      {/* ── Image area ── */}
      <div className="relative aspect-square w-full overflow-hidden rounded-t-xl bg-bg-secondary">
        {/* Checkbox (READY only) */}
        {isReady && (
          <label className="absolute top-2 left-2 z-10 flex h-11 w-11 cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              checked={selected}
              onChange={handleSelect}
              className="checkbox-custom h-5 w-5 rounded border-border accent-[#1A1A1A]"
              aria-label={`Sélectionner ${product.name}`}
            />
          </label>
        )}

        {/* Reference badge */}
        <span className="absolute top-2 right-2 z-10 rounded-md bg-bg-primary/80 px-2 py-0.5 text-xs font-medium text-text-primary backdrop-blur-sm">
          {product.reference}
        </span>

        {/* Thumbnail or placeholder */}
        {firstImage ? (
          <img
            src={firstImage}
            alt={product.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-secondary">
            <PackageIcon className="h-12 w-12" />
          </div>
        )}

        {/* Best-seller star */}
        {product.isBestSeller && (
          <span className="absolute bottom-2 left-2 z-10" title="Best-seller">
            <StarIcon className="h-5 w-5 text-[#F59E0B] drop-shadow" />
          </span>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* Name */}
        <h3
          className="line-clamp-2 text-sm font-semibold leading-snug text-text-primary font-heading"
          title={product.name}
        >
          {product.name}
        </h3>

        {/* Category */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="badge badge-neutral w-fit text-xs">{product.categoryName}</span>
        </div>

        {/* Description (truncated) */}
        {product.description && (
          <p className="line-clamp-2 text-xs text-text-secondary leading-relaxed" title={product.description}>
            {product.description}
          </p>
        )}

        {/* Color swatches */}
        {uniqueColors.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {uniqueColors.map((v) => {
              const c = colorMap.get(v.colorId);
              return (
                <div key={v.colorId} title={v.colorName}>
                  <ColorSwatch
                    hex={c?.hex ?? null}
                    patternImage={c?.patternImage ?? null}
                    size={20}
                    rounded="full"
                    border
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Compositions */}
        {compositions.length > 0 && (
          <p className="text-[11px] text-text-secondary leading-snug">
            {compositions.map((c) => `${c.name} ${c.percentage}%`).join(", ")}
          </p>
        )}

        {/* Price range + variant count */}
        <div className="flex items-center justify-between text-sm">
          {priceRange ? (
            <span className="font-medium text-text-primary">
              {priceRange.min === priceRange.max
                ? `${priceRange.min.toFixed(2)}€`
                : `${priceRange.min.toFixed(2)}€ — ${priceRange.max.toFixed(2)}€`}
            </span>
          ) : (
            <span className="text-text-secondary">—</span>
          )}
          <span className="text-xs text-text-secondary">
            {variantCount} variante{variantCount > 1 ? "s" : ""}
          </span>
        </div>

        {/* Status badge */}
        <div className="mt-auto flex flex-col gap-1.5 pt-2">
          <span className={`${statusCfg.className} text-xs w-fit`}>{statusCfg.label}</span>

          {/* Error message */}
          {product.errorMessage && (
            <div className="rounded-lg bg-[#EF4444]/8 border border-[#EF4444]/20 px-2.5 py-2 text-xs text-[#EF4444] break-words leading-relaxed">
              {product.errorMessage}
            </div>
          )}
        </div>

        {/* Action buttons (READY only) */}
        {isReady && (
          <div className="flex items-center gap-2 border-t border-border pt-2">
            <button
              onClick={handleApprove}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#22C55E]/10 text-[#22C55E] transition-colors hover:bg-[#22C55E]/20"
              aria-label="Approuver"
              title="Approuver"
            >
              <CheckIcon className="h-4.5 w-4.5" />
            </button>
            <button
              onClick={handleReject}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EF4444]/10 text-[#EF4444] transition-colors hover:bg-[#EF4444]/20"
              aria-label="Refuser"
              title="Refuser"
            >
              <XIcon className="h-4.5 w-4.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
