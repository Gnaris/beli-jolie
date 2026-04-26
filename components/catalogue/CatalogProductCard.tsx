"use client";

import { useState, useTransition, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { addToCart } from "@/app/actions/client/cart";
import { getImageSrc } from "@/lib/image-utils";
import ColorSwatch from "@/components/ui/ColorSwatch";
import FavoriteToggle from "@/components/client/FavoriteToggle";

interface SubColor {
  color: { name: string; hex: string | null; patternImage?: string | null };
}
interface VariantSize {
  size: { name: string };
  quantity: number;
}
interface ColorVariant {
  id: string;
  colorId: string | null;
  unitPrice: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  color: { id: string; name: string; hex: string | null; patternImage?: string | null } | null;
  subColors: SubColor[];
  variantSizes: VariantSize[];
}
interface ColorImage {
  path: string;
  colorId: string;
  order: number;
}

interface CatalogProductCardProps {
  product: {
    id: string;
    name: string;
    reference: string;
    category: { name: string };
    colors: ColorVariant[];
    colorImages: ColorImage[];
  };
  selectedColorId: string | null;
  selectedImagePath: string | null;
  isAuthenticated: boolean;
  catalogToken: string;
  isFavorite?: boolean;
}

// ─── Helper: group variants by color ────────────────────────────────────────

interface ColorGroup {
  colorId: string | null;
  groupKey: string;
  name: string;
  hex: string | null;
  patternImage?: string | null;
  subColors: SubColor[];
  isPrimary: boolean;
  variants: ColorVariant[];
}

function variantGroupKey(v: ColorVariant): string {
  const base = v.color?.id ?? "__none__";
  if (v.subColors.length === 0) return base;
  const sorted = [...v.subColors]
    .map((sc) => sc.color.name)
    .sort()
    .join("|");
  return `${base}::${sorted}`;
}

function groupByColor(variants: ColorVariant[]): ColorGroup[] {
  const map = new Map<string, ColorGroup>();
  for (const v of variants) {
    const key = variantGroupKey(v);
    const existing = map.get(key);
    if (existing) {
      existing.variants.push(v);
      if (v.isPrimary) existing.isPrimary = true;
    } else {
      map.set(key, {
        colorId: v.color?.id ?? null,
        groupKey: key,
        name: v.color?.name ?? "Standard",
        hex: v.color?.hex ?? null,
        patternImage: v.color?.patternImage,
        subColors: v.subColors,
        isPrimary: v.isPrimary,
        variants: [v],
      });
    }
  }
  return Array.from(map.values());
}

// ─── Sale option helpers ────────────────────────────────────────────────────

interface SaleOption {
  key: string;
  label: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  variants: ColorVariant[];
}

function saleOptionKey(v: ColorVariant): string {
  if (v.saleType === "UNIT") return "UNIT";
  return `PACK:${v.packQuantity ?? 0}`;
}

function buildSaleOptions(group: ColorGroup): SaleOption[] {
  const map = new Map<string, SaleOption>();
  for (const v of group.variants) {
    const key = saleOptionKey(v);
    const existing = map.get(key);
    if (existing) {
      existing.variants.push(v);
    } else {
      let label = "Unité";
      if (v.saleType === "PACK") {
        label = v.packQuantity ? `Pack x${v.packQuantity}` : "Pack";
      }
      map.set(key, { key, label, saleType: v.saleType, packQuantity: v.packQuantity, variants: [v] });
    }
  }
  const arr = Array.from(map.values());
  arr.sort((a, b) => {
    if (a.saleType !== b.saleType) return a.saleType === "UNIT" ? -1 : 1;
    return (a.packQuantity ?? 0) - (b.packQuantity ?? 0);
  });
  return arr;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CatalogProductCard({
  product,
  selectedColorId,
  selectedImagePath,
  isAuthenticated,
  catalogToken,
  isFavorite = false,
}: CatalogProductCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Group variants by color
  const colorGroups = useMemo(() => groupByColor(product.colors), [product.colors]);

  // Initial color group
  const initialGroup = selectedColorId
    ? colorGroups.find((g) => g.colorId === selectedColorId) ?? colorGroups.find((g) => g.isPrimary) ?? colorGroups[0]
    : colorGroups.find((g) => g.isPrimary) ?? colorGroups[0];

  const [activeGroup, setActiveGroup] = useState<ColorGroup>(initialGroup);

  // Build sale options for active color group
  const saleOptions = useMemo(() => buildSaleOptions(activeGroup), [activeGroup]);

  // Initial sale option key
  const initialSaleKey = useMemo(() => {
    const primary = activeGroup.variants.find((v) => v.isPrimary);
    return primary ? saleOptionKey(primary) : saleOptions[0]?.key ?? "UNIT";
  }, [activeGroup, saleOptions]);

  const [activeSaleKey, setActiveSaleKey] = useState(initialSaleKey);

  // Active sale option (fallback to first if key not found after color change)
  const activeOption = saleOptions.find((o) => o.key === activeSaleKey) ?? saleOptions[0];

  // Sizes grouped by variant (one entry per variant, sizes joined)
  const variantSizeGroups = useMemo(() => {
    if (!activeOption) return [];
    const groups: { variantId: string; label: string }[] = [];
    for (const v of activeOption.variants) {
      if (v.variantSizes.length === 0) continue;
      const label = v.variantSizes
        .map((vs) => vs.size.name + (vs.quantity > 1 ? ` \u00d7${vs.quantity}` : ""))
        .join(", ");
      groups.push({ variantId: v.id, label });
    }
    return groups;
  }, [activeOption]);

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  // Active variant: if a size is selected, use that variant; otherwise first in option
  const activeVariant = useMemo(() => {
    if (selectedVariantId) {
      const found = activeOption?.variants.find((v) => v.id === selectedVariantId);
      if (found) return found;
    }
    return activeOption?.variants[0] ?? activeGroup.variants[0];
  }, [selectedVariantId, activeOption, activeGroup]);

  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const effectiveStock = activeVariant.saleType === "PACK" && activeVariant.packQuantity
    ? Math.floor(activeVariant.stock / activeVariant.packQuantity)
    : activeVariant.stock;

  const activeColorId = activeVariant.color?.id;
  const image =
    (activeColorId === (selectedColorId ?? initialGroup.colorId) ? selectedImagePath : null) ??
    (activeColorId
      ? product.colorImages.find((img) => img.colorId === activeColorId)?.path
      : null) ??
    product.colorImages[0]?.path;

  const price = Number(activeVariant.unitPrice);

  function handleColorChange(group: ColorGroup) {
    setActiveGroup(group);
    // Rebuild sale options for new group and keep key if available
    const newOptions = buildSaleOptions(group);
    const hasCurrentKey = newOptions.some((o) => o.key === activeSaleKey);
    if (!hasCurrentKey) {
      setActiveSaleKey(newOptions[0]?.key ?? "UNIT");
    }
    setSelectedVariantId(null);
    setQuantity(1);
    setError("");
  }

  function handleSaleChange(key: string) {
    setActiveSaleKey(key);
    setSelectedVariantId(null);
    setQuantity(1);
  }

  function handleAddToCart() {
    if (!isAuthenticated) {
      router.push(`/connexion?callbackUrl=/catalogue/${catalogToken}`);
      return;
    }
    setError("");
    setSuccess(false);
    startTransition(async () => {
      try {
        await addToCart(activeVariant.id, quantity);
        if (imageContainerRef.current && image) {
          const rect = imageContainerRef.current.getBoundingClientRect();
          window.dispatchEvent(new CustomEvent("cart:item-added", {
            detail: { imageSrc: getImageSrc(image, "medium"), rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }, quantity },
          }));
        }
        setSuccess(true);
        setQuantity(1);
        setTimeout(() => setSuccess(false), 2500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur lors de l'ajout au panier.");
      }
    });
  }

  return (
    <div className="group bg-white rounded-xl overflow-hidden transition-all duration-200 hover:shadow-md shadow-sm border border-[#EEECE9] h-full flex flex-col">

      {/* ── Image ───────────────────────────────────────────────────────── */}
      <div className="relative aspect-[4/5] bg-[#F7F6F4] overflow-hidden" ref={imageContainerRef}>
        <a href={`/produits/${product.id}`} className="block w-full h-full cursor-pointer">
          {image ? (
            <img
              src={getImageSrc(image, "medium")}
              alt={product.name}
              className="w-full h-full object-cover transition-transform duration-400 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-9 h-9 text-[#DDD9D3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
              </svg>
            </div>
          )}
        </a>

        {/* Category pill */}
        <div className="absolute top-2.5 left-2.5">
          <span
            className="px-2 py-0.5 text-[9px] uppercase tracking-[0.06em] font-medium rounded-md bg-white/85 backdrop-blur-sm text-[#6B7280]"
            style={{ fontFamily: "var(--font-roboto)" }}
          >
            {product.category.name}
          </span>
        </div>

        {/* Favorite button */}
        <div className="absolute top-2.5 right-2.5 z-10">
          <FavoriteToggle productId={product.id} isFavorite={isFavorite} />
        </div>

        {/* Stock badge */}
        {effectiveStock > 0 && effectiveStock <= 5 && (
          <div className="absolute bottom-2.5 right-2.5">
            <span className="px-2 py-0.5 text-[9px] font-medium rounded-md bg-[#FEF3C7] text-[#92400E]">
              Plus que {effectiveStock}
            </span>
          </div>
        )}
        {effectiveStock <= 0 && (
          <div className="absolute bottom-2.5 right-2.5">
            <span className="px-2 py-0.5 text-[9px] font-medium rounded-md bg-[#FEE2E2] text-[#991B1B]">
              Rupture
            </span>
          </div>
        )}
      </div>

      {/* ── Info ────────────────────────────────────────────────────────── */}
      <div className="p-4 flex-1 flex flex-col">
        <a href={`/produits/${product.id}`} className="block">
        <h2
          className="font-semibold text-[#1A1A1A] text-sm leading-snug line-clamp-2 mb-0.5 hover:text-[#555] transition-colors"
          style={{ fontFamily: "var(--font-poppins)" }}
        >
          {product.name}
        </h2>
        <p className="text-[10px] text-[#C5C2BC] mb-3" style={{ fontFamily: "var(--font-roboto)" }}>
          {product.reference}
        </p>
        </a>

        {/* Prix */}
        <div className="flex items-baseline gap-1.5 mb-3">
          <span
            className="text-lg font-bold text-[#1A1A1A] tracking-tight"
            style={{ fontFamily: "var(--font-poppins)" }}
          >
            {price.toFixed(2)}&nbsp;&euro;
          </span>
          <span className="text-[10px] text-[#B0ADA6]" style={{ fontFamily: "var(--font-roboto)" }}>
            HT{activeVariant.saleType === "PACK" && activeVariant.packQuantity ? ` / pack x${activeVariant.packQuantity}` : ""}
          </span>
        </div>

        {/* ── Options ──────────────────────────────────────────────────── */}
        <div className="space-y-2.5 pt-3 border-t border-[#F0EFED] mt-auto">

          {/* 1. Couleurs (une pastille par couleur, pas par variante) */}
          {colorGroups.length >= 1 && (
            <div>
              <p className="text-[9px] text-[#B0ADA6] uppercase tracking-[0.08em] font-medium mb-1.5" style={{ fontFamily: "var(--font-roboto)" }}>
                {activeGroup.name}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {colorGroups.map((g) => (
                  <button
                    key={g.colorId ?? "__none__"}
                    type="button"
                    onClick={() => handleColorChange(g)}
                    className={`rounded-md transition-all ${
                      g.groupKey === activeGroup.groupKey
                        ? "ring-2 ring-[#1A1A1A] ring-offset-1"
                        : "hover:ring-1 hover:ring-[#D1D5DB]"
                    }`}
                    title={g.name}
                  >
                    <ColorSwatch
                      hex={g.hex}
                      patternImage={g.patternImage}
                      subColors={g.subColors.map((sc) => ({
                        hex: sc.color.hex,
                        patternImage: sc.color.patternImage,
                      }))}
                      size={26}
                      border
                      rounded="lg"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 2. Sélecteur type de vente (Unité, Pack x12, Pack x24…) */}
          {saleOptions.length >= 1 && (
            <div className="flex flex-wrap gap-1 p-0.5 bg-[#F5F4F2] rounded-lg">
              {saleOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => saleOptions.length > 1 && handleSaleChange(opt.key)}
                  className={`flex-1 min-w-0 py-1.5 px-2 text-[11px] font-medium rounded-md transition-all ${
                    saleOptions.length > 1
                      ? activeSaleKey === opt.key
                        ? "bg-white text-[#1A1A1A] shadow-sm"
                        : "text-[#9CA3AF] hover:text-[#6B7280] cursor-pointer"
                      : "bg-white text-[#1A1A1A] shadow-sm"
                  }`}
                  style={{ fontFamily: "var(--font-roboto)" }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* 3. Tailles */}
          {variantSizeGroups.length > 0 && (
            <div>
              <p className="text-[9px] text-[#B0ADA6] uppercase tracking-[0.08em] font-medium mb-1" style={{ fontFamily: "var(--font-roboto)" }}>
                Tailles
              </p>
              <div className="flex flex-wrap gap-1">
                {variantSizeGroups.map((g) => {
                  const isSelectable = variantSizeGroups.length > 1;
                  const isActive = selectedVariantId === g.variantId || (!selectedVariantId && activeOption?.variants[0]?.id === g.variantId);
                  return (
                    <button
                      key={g.variantId}
                      type="button"
                      onClick={() => {
                        if (isSelectable) {
                          setSelectedVariantId(g.variantId);
                          setQuantity(1);
                        }
                      }}
                      className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-all ${
                        isSelectable
                          ? isActive
                            ? "bg-[#1A1A1A] text-white"
                            : "bg-[#F5F4F2] text-[#6B7280] hover:bg-[#EDEBE8] cursor-pointer"
                          : "bg-[#F5F4F2] text-[#6B7280] cursor-default"
                      }`}
                      style={{ fontFamily: "var(--font-roboto)" }}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Quantité */}
          <div className="flex items-center justify-center bg-[#F5F4F2] rounded-lg overflow-hidden border border-[#EDEBE8]">
            <button
              type="button"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="w-9 h-8 flex items-center justify-center text-[#6B7280] hover:bg-[#EDEBE8] transition-colors text-sm"
            >
              &minus;
            </button>
            <span
              className="w-8 h-8 flex items-center justify-center text-xs font-semibold text-[#1A1A1A]"
              style={{ fontFamily: "var(--font-poppins)" }}
            >
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity(Math.min(effectiveStock, quantity + 1))}
              disabled={quantity >= effectiveStock}
              className="w-9 h-8 flex items-center justify-center text-[#6B7280] hover:bg-[#EDEBE8] transition-colors text-sm disabled:opacity-30"
            >
              +
            </button>
          </div>

          {/* 5. Bouton Ajouter au panier */}
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={isPending || effectiveStock <= 0}
            className={`w-full py-2 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-60 ${
              success
                ? "bg-green-500 text-white"
                : error
                  ? "bg-red-50 text-red-600 border border-red-200"
                  : "bg-accent text-white hover:bg-accent-dark active:scale-[0.98]"
            }`}
            style={{ fontFamily: "var(--font-roboto)" }}
          >
            {isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </span>
            ) : effectiveStock <= 0 ? (
              "Rupture de stock"
            ) : !isAuthenticated ? (
              "Se connecter"
            ) : success ? (
              <span className="inline-flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Ajouté
              </span>
            ) : error ? (
              error
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
                Ajouter au panier
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
