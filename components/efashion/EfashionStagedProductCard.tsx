"use client";

import { useCallback } from "react";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface EfashionStagedVariant {
  colorId: string;
  colorName: string;
  unitPrice: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
}

export interface EfashionStagedProduct {
  id: string;
  reference: string;
  efashionProductId: number;
  name: string;
  description: string;
  categoryName: string;
  isBestSeller: boolean;
  status: "PREPARING" | "READY" | "APPROVED" | "REJECTED" | "ERROR";
  variants: EfashionStagedVariant[] | string;
  compositions: { name: string; percentage: number }[] | string;
  imageUrls: string[] | string;
  colorData: Record<string, { name: string; hex: string | null }> | string;
  errorMessage?: string | null;
  createdProductId?: string | null;
}

interface EfashionStagedProductCardProps {
  product: EfashionStagedProduct;
  selected: boolean;
  approving?: boolean;
  onSelect: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function parseJson<T>(value: T | string): T {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value as T; }
  }
  return value;
}

function computePriceRange(variants: EfashionStagedVariant[]): { min: number; max: number } | null {
  if (variants.length === 0) return null;
  const prices = variants.map((v) => v.unitPrice);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

const STATUS_CONFIG: Record<
  EfashionStagedProduct["status"],
  { label: string; className: string }
> = {
  PREPARING: { label: "Préparation...", className: "badge badge-warning" },
  READY: { label: "Prêt", className: "badge badge-info" },
  APPROVED: { label: "Approuvé", className: "badge badge-success" },
  REJECTED: { label: "Refusé", className: "badge badge-error" },
  ERROR: { label: "Erreur", className: "badge badge-error" },
};

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function EfashionStagedProductCard({
  product,
  selected,
  approving,
  onSelect,
  onApprove,
  onReject,
}: EfashionStagedProductCardProps) {
  const { status } = product;
  const isReady = status === "READY";
  const isDimmed = status === "APPROVED" || status === "REJECTED";
  const isPreparing = status === "PREPARING";

  const variants = parseJson<EfashionStagedVariant[]>(product.variants) || [];
  const compositions = parseJson<{ name: string; percentage: number }[]>(product.compositions) || [];
  const imageUrls = parseJson<string[]>(product.imageUrls) || [];
  const colorData = parseJson<Record<string, { name: string; hex: string | null }>>(product.colorData) || {};

  const priceRange = computePriceRange(variants);
  const variantCount = variants.length;
  const statusCfg = STATUS_CONFIG[status];

  // First thumbnail
  const firstImage = imageUrls.length > 0 ? imageUrls[0] : null;

  // Unique colors
  const uniqueColors = (() => {
    const seen = new Set<string>();
    return variants.filter((v) => {
      if (seen.has(v.colorId)) return false;
      seen.add(v.colorId);
      return true;
    });
  })();

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
      className={`card p-4 space-y-3 transition-all cursor-pointer ${
        isDimmed ? "opacity-60" : ""
      } ${isPreparing ? "animate-pulse" : ""} ${
        selected ? "ring-2 ring-text-primary" : ""
      }`}
      onClick={handleSelect}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={handleSelect}
            onClick={(e) => e.stopPropagation()}
            className="checkbox-custom shrink-0"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{product.name}</p>
            <p className="text-xs text-text-muted font-mono">{product.reference}</p>
          </div>
        </div>
        <span className={statusCfg.className}>{statusCfg.label}</span>
      </div>

      {/* Image + info row */}
      <div className="flex gap-3">
        {/* Thumbnail */}
        <div className="w-20 h-20 rounded-lg bg-bg-secondary flex items-center justify-center shrink-0 overflow-hidden">
          {firstImage ? (
            <img
              src={firstImage}
              alt={product.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="badge badge-neutral text-[10px]">{product.categoryName}</span>
            {product.isBestSeller && (
              <span className="badge badge-purple text-[10px]">Best-seller</span>
            )}
          </div>

          {/* Colors */}
          {uniqueColors.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {uniqueColors.slice(0, 6).map((v) => {
                const color = colorData[v.colorId];
                return (
                  <div
                    key={v.colorId}
                    className="w-4 h-4 rounded-full border border-border"
                    style={{ backgroundColor: color?.hex || "#ccc" }}
                    title={color?.name || v.colorName}
                  />
                );
              })}
              {uniqueColors.length > 6 && (
                <span className="text-[10px] text-text-muted">+{uniqueColors.length - 6}</span>
              )}
            </div>
          )}

          {/* Price & variants */}
          <div className="flex items-center gap-3 text-xs text-text-secondary">
            {priceRange && (
              <span>
                {priceRange.min === priceRange.max
                  ? `${priceRange.min.toFixed(2)} €`
                  : `${priceRange.min.toFixed(2)} - ${priceRange.max.toFixed(2)} €`}
              </span>
            )}
            <span>{variantCount} variante{variantCount > 1 ? "s" : ""}</span>
          </div>

          {/* Compositions */}
          {compositions.length > 0 && (
            <p className="text-[10px] text-text-muted truncate">
              {compositions.map((c) => `${c.name} ${c.percentage}%`).join(", ")}
            </p>
          )}
        </div>
      </div>

      {/* Error message */}
      {product.errorMessage && (
        <p className="text-xs text-[#EF4444] bg-[#EF4444]/5 rounded-lg px-3 py-2 truncate">
          {product.errorMessage}
        </p>
      )}

      {/* Action buttons */}
      {isReady && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleApprove}
            disabled={approving}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#22C55E] hover:bg-[#16A34A] rounded-lg transition-colors"
          >
            {approving ? (
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            Approuver
          </button>
          <button
            onClick={handleReject}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-[#EF4444] bg-[#EF4444]/10 hover:bg-[#EF4444]/20 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Refuser
          </button>
        </div>
      )}
    </div>
  );
}
