"use client";

import { useRef, useState, useMemo, useTransition, useCallback } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { useScrollReveal } from "./useScrollReveal";
import { addToCart } from "@/app/actions/client/cart";
import ColorSwatch from "@/components/ui/ColorSwatch";
import { canSeePrices } from "@/lib/price-visibility";
import { buildProductHandle } from "@/lib/product-url";

interface CarouselVariant {
  id: string;
  saleType: string;
  packQuantity: number | null;
  unitPrice: number;
  stock: number;
  sizes: { name: string; quantity: number }[];
}

interface ColorData {
  id: string;
  groupKey?: string;
  hex: string | null;
  patternImage?: string | null;
  name: string;
  firstImage: string | null;
  unitPrice: number;
  discountedPrice?: number;
  hasDiscount?: boolean;
  isPrimary: boolean;
  variantId?: string;
  variants?: CarouselVariant[];
}

export interface CarouselProduct {
  id: string;
  name: string;
  reference: string;
  category: string;
  colors: ColorData[];
}

// ─── Sale option helpers ────────────────────────────────────────────────────

interface SaleOpt {
  key: string;
  label: string;
  saleType: string;
  packQuantity: number | null;
  variants: CarouselVariant[];
}

function buildCarouselSaleOptions(variants: CarouselVariant[], unitLabel: string): SaleOpt[] {
  const map = new Map<string, SaleOpt>();
  for (const v of variants) {
    const key = v.saleType === "UNIT" ? "UNIT" : `PACK:${v.packQuantity ?? 0}`;
    const existing = map.get(key);
    if (existing) {
      existing.variants.push(v);
    } else {
      let label = unitLabel;
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

export interface ClientDiscountInfo {
  discountType: "PERCENT" | "AMOUNT";
  discountValue: number;
}

interface Props {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  products: CarouselProduct[];
  viewMoreHref: string;
  viewMoreLabel?: string;
  variant?: "white" | "gray";
  size?: "premium" | "standard";
  clientDiscount?: ClientDiscountInfo | null;
  showPromoBadge?: boolean;
}

function applyClientDiscount(price: number, discount: ClientDiscountInfo | null | undefined): number {
  if (!discount) return price;
  if (discount.discountType === "PERCENT") return Math.max(0, price * (1 - discount.discountValue / 100));
  return Math.max(0, price - discount.discountValue);
}

function CarouselCard({
  product,
  clientDiscount,
  showPromoBadge,
  size,
}: {
  product: CarouselProduct;
  clientDiscount?: ClientDiscountInfo | null;
  showPromoBadge?: boolean;
  size: "premium" | "standard";
}) {
  const t = useTranslations("products");
  const tProduct = useTranslations("product");
  const { tp, tc: translateCat } = useProductTranslation();
  const { data: session } = useSession();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const showPrices = canSeePrices(session);

  const primaryColor = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  const [selectedColorKey, setSelectedColorKey] = useState<string>(primaryColor?.groupKey ?? primaryColor?.id ?? "");

  const selectedColor = product.colors.find((c) => (c.groupKey ?? c.id) === selectedColorKey) ?? primaryColor;
  const image = selectedColor?.firstImage;

  // ── Sale type / sizes logic ──
  const variants = selectedColor?.variants ?? [];
  const hasVariants = variants.length > 0;

  const saleOptions = useMemo(
    () => hasVariants ? buildCarouselSaleOptions(variants, tProduct("unit")) : [],
    [variants, hasVariants, tProduct],
  );

  const [activeSaleKey, setActiveSaleKey] = useState(() => saleOptions[0]?.key ?? "UNIT");

  // Re-sync sale key on color change
  const prevColorKey = useRef(selectedColorKey);
  if (prevColorKey.current !== selectedColorKey) {
    prevColorKey.current = selectedColorKey;
    const hasKey = saleOptions.some((o) => o.key === activeSaleKey);
    if (!hasKey && saleOptions.length > 0) setActiveSaleKey(saleOptions[0].key);
  }

  const activeOption = saleOptions.find((o) => o.key === activeSaleKey) ?? saleOptions[0];

  const variantSizeGroups = useMemo(() => {
    if (!activeOption) return [];
    const groups: { variantId: string; label: string }[] = [];
    for (const v of activeOption.variants) {
      if (v.sizes.length === 0) continue;
      const label = v.sizes.map((s) => s.name + (s.quantity > 1 ? ` \u00d7${s.quantity}` : "")).join(", ");
      groups.push({ variantId: v.id, label });
    }
    return groups;
  }, [activeOption]);

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  const activeVariant = (() => {
    if (selectedVariantId) {
      const found = activeOption?.variants.find((v) => v.id === selectedVariantId);
      if (found) return found;
    }
    return activeOption?.variants[0] ?? (hasVariants ? variants[0] : null);
  })();

  const [quantity, setQuantity] = useState(1);

  const effectiveStock = activeVariant
    ? activeVariant.saleType === "PACK" && activeVariant.packQuantity
      ? Math.floor(activeVariant.stock / activeVariant.packQuantity)
      : activeVariant.stock
    : 1;

  // Prix affiché PAR UNITÉ (pour PACK : total / packQuantity)
  const variantPricePerUnit = (v: CarouselVariant): number => {
    const p = Number(v.unitPrice);
    if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) return p / v.packQuantity;
    return p;
  };

  // basePrice = prix brut par unité (avant toute remise) pour la variante active
  const basePrice = activeVariant
    ? variantPricePerUnit(activeVariant)
    : (selectedColor?.unitPrice ?? 0);

  // Ratio de remise produit calculé côté serveur sur le prix de référence couleur
  const productDiscountRatio = selectedColor && selectedColor.unitPrice > 0 && selectedColor.hasDiscount
    ? (selectedColor.discountedPrice ?? selectedColor.unitPrice) / selectedColor.unitPrice
    : 1;
  const hasProductDiscount = productDiscountRatio < 1;
  const priceBeforeClient = basePrice * productDiscountRatio;

  const finalPrice = applyClientDiscount(priceBeforeClient, clientDiscount);
  const hasClientDiscount = !!clientDiscount && finalPrice < priceBeforeClient;

  const showStrikethrough = hasClientDiscount || hasProductDiscount;
  const strikethroughPrice = hasClientDiscount ? priceBeforeClient : basePrice;
  const anyColorHasDiscount = product.colors.some((c) => c.hasDiscount);

  const isPremium = size === "premium";
  const cardWidth = isPremium ? "w-[300px] sm:w-[340px]" : "w-[250px] sm:w-[280px]";
  const imageAspect = isPremium ? "aspect-[3/4]" : "aspect-[4/5]";
  const cardRadius = isPremium ? "rounded-2xl" : "rounded-xl";
  const cardShadow = isPremium ? "shadow-md hover:shadow-lg" : "shadow-sm hover:shadow-md";

  const imageRef = useRef<HTMLDivElement>(null);
  const [addedFeedback, setAddedFeedback] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAddToCart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setErrorMsg(null);

    if (!session?.user) {
      router.push("/connexion");
      return;
    }

    const variantId = activeVariant?.id ?? selectedColor?.variantId;
    if (!variantId) return;

    startTransition(async () => {
      try {
        await addToCart(variantId, quantity);
        if (imageRef.current && image) {
          const rect = imageRef.current.getBoundingClientRect();
          window.dispatchEvent(new CustomEvent("cart:item-added", {
            detail: { imageSrc: image, rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }, quantity },
          }));
        }
        setAddedFeedback(true);
        setQuantity(1);
        setTimeout(() => setAddedFeedback(false), 2000);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erreur";
        setErrorMsg(msg);
        setTimeout(() => setErrorMsg(null), 3000);
      }
    });
  }, [session, activeVariant, selectedColor, image, router, quantity]);

  return (
    <article className={`group shrink-0 h-full ${cardWidth} ${cardRadius} bg-bg-primary border border-border overflow-hidden flex flex-col transition-shadow duration-300 ${cardShadow}`}>
      <Link href={`/produits/${buildProductHandle(product.name, product.reference)}`} className="block">
        <div ref={imageRef} className={`${imageAspect} bg-bg-secondary relative overflow-hidden`}>
          {image ? (
            <Image
              src={image}
              alt={product.name}
              fill
              sizes={isPremium ? "340px" : "280px"}
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
              </svg>
            </div>
          )}

          {isPremium && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <span className="px-5 py-2 bg-white/90 backdrop-blur-sm text-bg-darker font-heading font-medium text-sm rounded-full shadow-md">
                Voir
              </span>
            </div>
          )}

          {(showPromoBadge || anyColorHasDiscount) && hasProductDiscount && (
            <span className="absolute top-2.5 right-2.5 bg-[#EF4444] text-white text-[10px] font-bold font-heading px-2.5 py-0.5 rounded-full shadow-sm uppercase tracking-wide">
              {tProduct("promo")}
            </span>
          )}

          {product.colors.length > 1 && (
            <span className="absolute bottom-2.5 right-2.5 bg-white/80 backdrop-blur-sm text-text-secondary text-[10px] font-body px-2 py-0.5 rounded-full">
              {t("colors", { count: product.colors.length })}
            </span>
          )}
        </div>
      </Link>

      <div className="p-4 flex flex-col gap-2 flex-1">
        {/* Color swatches */}
        <div className="flex items-center gap-1.5 flex-wrap min-h-[20px]">
          {product.colors.slice(0, 5).map((c) => (
            <button
              key={c.groupKey ?? c.id}
              type="button"
              title={tp(c.name)}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSelectedColorKey(c.groupKey ?? c.id);
                setSelectedVariantId(null);
                setQuantity(1);
              }}
              className={`rounded-full transition-all duration-200 ${
                (c.groupKey ?? c.id) === selectedColorKey
                  ? "ring-2 ring-accent ring-offset-1 scale-110"
                  : "hover:scale-110"
              }`}
            >
              <ColorSwatch
                hex={c.hex}
                patternImage={c.patternImage}
                size={16}
                border
                rounded="full"
              />
            </button>
          ))}
        </div>

        <Link href={`/produits/${buildProductHandle(product.name, product.reference)}`}>
          <p className="font-body font-semibold text-sm text-text-primary line-clamp-1 leading-snug hover:text-text-secondary transition-colors">
            {tp(product.name)}
          </p>
        </Link>

        <p className="text-xs text-text-muted font-body">
          {translateCat(product.category)}
        </p>

        {/* Price */}
        {showPrices ? (() => {
          const unitDisplay = hasClientDiscount ? finalPrice : priceBeforeClient;
          const isPack = activeVariant?.saleType === "PACK" && !!activeVariant.packQuantity && activeVariant.packQuantity > 0;
          const packQty = activeVariant?.packQuantity ?? 1;
          const headlinePrice = isPack ? unitDisplay * packQty : unitDisplay;
          const headlineStrikethrough = isPack ? strikethroughPrice * packQty : strikethroughPrice;
          return (
            <div className="space-y-0.5">
              <div className="flex items-baseline gap-1.5 flex-wrap">
                {showStrikethrough && (
                  <span className="font-body text-xs text-text-muted line-through">
                    {headlineStrikethrough.toFixed(2)} &euro;
                  </span>
                )}
                {hasClientDiscount && clientDiscount?.discountType === "PERCENT" && (
                  <span className="text-[10px] font-body text-[#EF4444] font-medium">
                    -{clientDiscount.discountValue}%
                  </span>
                )}
                <span className={`font-heading font-semibold ${isPremium ? "text-base" : "text-sm"} ${showStrikethrough ? "text-[#EF4444]" : "text-text-primary"}`}>
                  {headlinePrice.toFixed(2)} &euro;
                </span>
                <span className="text-[10px] text-text-muted font-body">
                  {isPack ? tProduct("htPack", { qty: packQty }) : tProduct("htUnit")}
                </span>
              </div>
              {isPack && (
                <p className="text-[10px] text-text-muted font-body">
                  {tProduct("perUnitNote", { price: unitDisplay.toFixed(2) })}
                </p>
              )}
            </div>
          );
        })() : (
          <Link
            href="/connexion"
            className="inline-flex items-center gap-1.5 text-xs font-body text-text-secondary hover:text-text-primary underline-offset-4 hover:underline transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            {tProduct("loginToSeePrices")}
          </Link>
        )}

        {/* Options: sale type + sizes + quantity + button */}
        {!showPrices ? (
          <div className="mt-auto pt-2 border-t border-border-light">
            <Link
              href="/inscription"
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-body font-medium bg-accent text-white hover:bg-accent-dark active:scale-[0.98] transition-all"
            >
              {tProduct("createAccountToOrder")}
            </Link>
          </div>
        ) : (
        <div className="mt-auto space-y-2 pt-2 border-t border-border-light">
          {/* Sale type selector */}
          {saleOptions.length >= 1 && (
            <div className="flex flex-wrap gap-1 p-0.5 bg-bg-secondary rounded-lg">
              {saleOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (saleOptions.length > 1) {
                      setActiveSaleKey(opt.key);
                      setSelectedVariantId(null);
                      setQuantity(1);
                    }
                  }}
                  className={`flex-1 min-w-0 py-1 px-1.5 text-[10px] font-medium font-body rounded-md transition-all ${
                    saleOptions.length > 1
                      ? activeSaleKey === opt.key
                        ? "bg-bg-primary text-text-primary shadow-sm"
                        : "text-text-muted hover:text-text-secondary cursor-pointer"
                      : "bg-bg-primary text-text-primary shadow-sm"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Sizes */}
          {variantSizeGroups.length > 0 && (
            <div>
              <p className="text-[9px] text-text-muted uppercase tracking-[0.08em] font-medium font-body mb-1">
                {tProduct("sizes")}
              </p>
              <div className="flex flex-wrap gap-1">
                {variantSizeGroups.map((g) => {
                  const isSelectable = variantSizeGroups.length > 1;
                  const isActive = selectedVariantId === g.variantId || (!selectedVariantId && activeOption?.variants[0]?.id === g.variantId);
                  return (
                    <button
                      key={g.variantId}
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isSelectable) {
                          setSelectedVariantId(g.variantId);
                          setQuantity(1);
                        }
                      }}
                      className={`px-2 py-0.5 text-[10px] font-medium font-body rounded-md transition-all ${
                        isSelectable
                          ? isActive
                            ? "bg-bg-dark text-text-inverse"
                            : "bg-bg-secondary text-text-muted hover:bg-bg-tertiary cursor-pointer"
                          : "bg-bg-secondary text-text-muted cursor-default"
                      }`}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantity */}
          <div className="flex items-center justify-center border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setQuantity(Math.max(1, quantity - 1)); }}
              className="w-8 h-7 flex items-center justify-center text-text-muted hover:bg-bg-secondary transition-colors text-sm"
            >&minus;</button>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label={tProduct("quantity") ?? "Quantité"}
              value={quantity || ""}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9]/g, "");
                if (raw === "") { setQuantity(0); return; }
                const n = parseInt(raw, 10);
                if (!Number.isNaN(n)) setQuantity(Math.min(effectiveStock, Math.max(0, n)));
              }}
              onBlur={() => { if (quantity < 1) setQuantity(1); }}
              onFocus={(e) => e.target.select()}
              className="w-10 h-7 text-center text-xs font-body text-text-primary bg-transparent outline-none focus:bg-bg-secondary"
            />
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setQuantity(Math.min(effectiveStock, quantity + 1)); }}
              disabled={quantity >= effectiveStock}
              className="w-8 h-7 flex items-center justify-center text-text-muted hover:bg-bg-secondary transition-colors text-sm disabled:opacity-30"
            >+</button>
          </div>

          {/* Add to cart button */}
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={isPending || addedFeedback || effectiveStock <= 0}
            className={`w-full py-2 rounded-lg text-xs font-medium font-body transition-all duration-200 ${
              addedFeedback
                ? "bg-green-500 text-white"
                : errorMsg
                  ? "bg-red-50 text-red-600 border border-red-200"
                  : effectiveStock <= 0
                    ? "bg-bg-tertiary text-text-muted"
                    : "bg-accent text-white hover:bg-accent-dark active:scale-[0.98]"
            } disabled:opacity-70`}
          >
            {isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </span>
            ) : addedFeedback ? (
              <span className="inline-flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {tProduct("addedToCart")}
              </span>
            ) : errorMsg ? (
              errorMsg
            ) : effectiveStock <= 0 ? (
              tProduct("outOfStock")
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
                {tProduct("addToCart")}
              </span>
            )}
          </button>
        </div>
        )}
      </div>
    </article>
  );
}

export default function ProductCarousel({
  title,
  subtitle,
  eyebrow,
  products,
  viewMoreHref,
  viewMoreLabel = "Voir plus",
  variant = "white",
  size = "standard",
  clientDiscount,
  showPromoBadge,
}: Props) {
  const tCommon = useTranslations("common");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRef = useScrollReveal();

  const isPremium = size === "premium";
  const scrollAmount = isPremium ? 364 : 304;

  function scroll(dir: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? scrollAmount : -scrollAmount, behavior: "smooth" });
  }

  if (products.length === 0) return null;

  return (
    <section
      ref={sectionRef}
      className={`scroll-fade-up py-20 lg:py-24 ${variant === "gray" ? "bg-bg-secondary" : "bg-bg-primary"} ${variant === "white" ? "border-y border-border" : ""}`}
    >
      <div className="container-site" style={{ maxWidth: "1440px" }}>
        {/* Header éditorial */}
        <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
          <div>
            {eyebrow && (
              <p className="text-[11px] uppercase tracking-[0.22em] text-text-muted font-medium mb-4">
                {eyebrow}
              </p>
            )}
            <h2
              className="font-heading font-bold text-text-primary leading-tight"
              style={{ fontSize: "clamp(1.75rem, 3vw, 2.75rem)", letterSpacing: "-0.01em" }}
            >
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-text-secondary font-body mt-2">{subtitle}</p>
            )}
          </div>
          <Link
            href={viewMoreHref}
            className="hidden md:inline-flex items-center gap-2 px-5 py-2.5 border border-border rounded-full text-sm font-heading font-medium text-text-primary hover:bg-bg-dark hover:text-text-inverse hover:border-bg-dark transition-colors"
          >
            {viewMoreLabel} <span aria-hidden>→</span>
          </Link>
        </div>

        {/* Scroll container with side arrows */}
        <div className="relative">
          {/* Left arrow */}
          <button
            onClick={() => scroll("left")}
            className={`hidden sm:flex items-center justify-center rounded-full transition-colors absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 shadow-md ${
              isPremium
                ? "w-10 h-10 bg-accent text-white hover:bg-accent-dark"
                : "w-9 h-9 border border-border bg-bg-primary hover:bg-bg-dark hover:border-bg-dark hover:text-text-inverse text-text-secondary"
            }`}
            aria-label={tCommon("previous")}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>

          {/* Right arrow */}
          <button
            onClick={() => scroll("right")}
            className={`hidden sm:flex items-center justify-center rounded-full transition-colors absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 shadow-md ${
              isPremium
                ? "w-10 h-10 bg-accent text-white hover:bg-accent-dark"
                : "w-9 h-9 border border-border bg-bg-primary hover:bg-bg-dark hover:border-bg-dark hover:text-text-inverse text-text-secondary"
            }`}
            aria-label={tCommon("next")}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>

          {/* Products */}
          <div
            ref={scrollRef}
            className="flex items-stretch gap-5 overflow-x-auto pb-2 scroll-smooth no-scrollbar snap-x snap-mandatory"
          >
            {products.map((p) => (
              <div key={p.id} className="snap-start h-full">
                <CarouselCard product={p} clientDiscount={clientDiscount} showPromoBadge={showPromoBadge} size={size} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
