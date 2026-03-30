"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { addToCart } from "@/app/actions/client/cart";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import ColorSwatch from "@/components/ui/ColorSwatch";

interface SubColorInfo {
  name: string;
  hex: string;
  patternImage?: string | null;
}

interface PackColorLineColorInfo {
  name: string;
  hex: string;
  patternImage?: string | null;
}

interface PackColorLineInfo {
  colors: PackColorLineColorInfo[];
}

interface VariantData {
  id: string;
  groupKey: string;              // Unique key: colorId + ordered sub-color names (order matters)
  colorId: string | null;
  colorName: string | undefined;
  colorHex: string | null | undefined;
  patternImage?: string | null;     // Image motif (léopard, camouflage…) — prioritaire sur hex
  subColors?: SubColorInfo[]; // Sous-couleurs optionnelles (ex: [{name:"Rouge",hex:"#FF0000"}])
  unitPrice: number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizes: { name: string; quantity: number; pricePerUnit?: number }[];
  packColorLines?: PackColorLineInfo[];
  discountType:  "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}

interface ColorImageData {
  groupKey: string;
  images: { path: string; order: number }[];
}

interface CompositionData {
  name: string;
  percentage: number;
}

interface DimensionsData {
  length: number | null;
  width: number | null;
  height: number | null;
  diameter: number | null;
  circumference: number | null;
}

interface RelatedProduct {
  id: string;
  name: string;
  reference: string;
  primaryImage: string | null;
  primaryColorName: string | null;
  minPrice: number;
}

export interface ClientDiscountInfo {
  discountType: "PERCENT" | "AMOUNT";
  discountValue: number;
}

interface ProductDetailProps {
  productId: string;
  name: string;
  reference: string;
  description: string;
  category: string;
  subCategories: string[];
  tags: { id: string; name: string }[];
  variants: VariantData[];
  colorImages: ColorImageData[];
  compositions: CompositionData[];
  dimensions: DimensionsData;
  similarProducts: RelatedProduct[];
  bundleChildren: RelatedProduct[];
  bundleParents: RelatedProduct[];
  clientDiscount?: ClientDiscountInfo | null;
  isAuthenticated?: boolean;
}

function computePrice(v: VariantData): number {
  // unitPrice is always the total price (for both UNIT and PACK)
  const total = Number(v.unitPrice);
  if (!v.discountType || !v.discountValue) return total;
  const dv = Number(v.discountValue);
  if (v.discountType === "PERCENT") return Math.max(0, total * (1 - dv / 100));
  return Math.max(0, total - dv);
}

function RelatedCard({ product }: { product: RelatedProduct }) {
  const { tp } = useProductTranslation();
  return (
    <Link
      href={`/produits/${product.id}`}
      className="group block card card-hover overflow-hidden"
    >
      <div className="aspect-square bg-bg-tertiary overflow-hidden">
        {product.primaryImage ? (
          <Image
            src={product.primaryImage}
            alt={tp(product.name)}
            fill
            sizes="(max-width: 640px) 50vw, 25vw"
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-3.5">
        <p className="text-xs font-mono text-text-muted">{product.reference}</p>
        <p className="text-sm font-medium text-text-primary font-body mt-0.5 line-clamp-2">
          {tp(product.name)}
        </p>
        <p className="text-sm font-heading font-semibold text-text-primary mt-1">
          {product.minPrice.toFixed(2)} €
        </p>
      </div>
    </Link>
  );
}

function applyClientDiscount(price: number, discount: ClientDiscountInfo | null | undefined): number {
  if (!discount) return price;
  if (discount.discountType === "PERCENT") return Math.max(0, price * (1 - discount.discountValue / 100));
  return Math.max(0, price - discount.discountValue);
}

export default function ProductDetail({
  productId, name, reference, description, category, subCategories, tags, variants,
  colorImages, compositions, dimensions, similarProducts, bundleChildren, bundleParents, clientDiscount, isAuthenticated,
}: ProductDetailProps) {
  const router = useRouter();
  const t = useTranslations("product");
  const { tp, tc } = useProductTranslation();
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();

  // Unique color groups derived from UNIT variants only (PACK have no single color to display)
  const uniqueColors = [...new Map(
    variants
      .filter(v => v.saleType === "UNIT" && v.colorId)
      .map(v => [v.groupKey, {
        groupKey: v.groupKey,
        id: v.colorId,
        name: v.colorName,
        hex: v.colorHex,
        patternImage: v.patternImage,
        subColors: v.subColors,
      }])
  ).values()];

  const primaryGroupKey = variants.find(v => v.isPrimary)?.groupKey ?? uniqueColors[0]?.groupKey ?? "";

  const [selectedGroupKey, setSelectedGroupKey]   = useState<string>(primaryGroupKey);
  const [hoveredGroupKey, setHoveredGroupKey]     = useState<string | null>(null);
  const [activeImageIdx, setActiveImageIdx]       = useState(0);
  const [hoveredImageIdx, setHoveredImageIdx]     = useState<number | null>(null);
  const [zoomedSrc, setZoomedSrc]                 = useState<string | null>(null);
  const [quantities, setQuantities]               = useState<Record<string, number>>({});
  const [addedOptId, setAddedOptId]               = useState<string | null>(null);
  const [restockAlerts, setRestockAlerts]         = useState<Record<string, boolean>>({});
  const [alertLoading, setAlertLoading]           = useState<Record<string, boolean>>({});

  const toggleRestockAlert = useCallback(async (variantId: string, productColorId: string) => {
    setAlertLoading((prev) => ({ ...prev, [variantId]: true }));
    try {
      const res = await fetch("/api/restock-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, productColorId }),
      });
      if (res.ok) {
        const data = await res.json();
        setRestockAlerts((prev) => ({ ...prev, [variantId]: data.subscribed }));
      }
    } finally {
      setAlertLoading((prev) => ({ ...prev, [variantId]: false }));
    }
  }, [productId]);

  // UNIT variants matching selected color + all PACK variants (no color to select for packs)
  const selectedVariants = variants.filter(v =>
    v.saleType === "PACK" || v.groupKey === selectedGroupKey
  );
  const selectedUnitVariants = selectedVariants.filter(v => v.saleType === "UNIT");
  const selectedPackVariants = selectedVariants.filter(v => v.saleType === "PACK");
  const selectedImgs     = colorImages.find(ci => ci.groupKey === selectedGroupKey)?.images ?? [];
  const displayedImgs    = hoveredGroupKey
    ? colorImages.find(ci => ci.groupKey === hoveredGroupKey)?.images ?? []
    : selectedImgs;

  const displayedImage = hoveredGroupKey
    ? displayedImgs[0]?.path ?? null
    : selectedImgs[hoveredImageIdx ?? activeImageIdx]?.path ?? null;

  // Build full color label including sub-colors (ex: "Doré/Rouge/Noir")
  const getFullColorName = (groupKey: string) => {
    const c = uniqueColors.find(uc => uc.groupKey === groupKey);
    if (!c) return "";
    if (c.subColors && c.subColors.length > 0) {
      return [c.name, ...c.subColors.map(sc => sc.name)].join("/");
    }
    return c.name;
  };

  const displayedColorName = getFullColorName(hoveredGroupKey ?? selectedGroupKey);

  const minPrice = variants.length > 0 ? Math.min(...variants.map(v => computePrice(v))) : 0;
  const minBasePrice = variants.length > 0 ? Math.min(...variants.map(v => Number(v.unitPrice))) : 0;
  const hasAnyProductDiscount = minPrice < minBasePrice;
  const minPriceAfterClient = applyClientDiscount(minPrice, clientDiscount);
  const hasClientDiscount = !!clientDiscount && minPriceAfterClient < minPrice;

  function handleColorClick(groupKey: string) {
    if (groupKey === selectedGroupKey) return;
    setSelectedGroupKey(groupKey);
    setHoveredGroupKey(null);
    setActiveImageIdx(0);
    setHoveredImageIdx(null);
  }

  function handleImageClick(idx: number) {
    if (idx === activeImageIdx) return;
    setActiveImageIdx(idx);
  }

  function handleAddToCart(variantId: string, qty: number) {
    showLoading();
    startTransition(async () => {
      try {
        await addToCart(variantId, qty);
        setAddedOptId(variantId);
        router.refresh();
        setTimeout(() => setAddedOptId(null), 2000);
      } catch {
        router.push("/connexion");
      } finally {
        hideLoading();
      }
    });
  }

  const dimRows: { label: string; value: number }[] = [
    { label: t("length"),        value: dimensions.length! },
    { label: t("width"),         value: dimensions.width! },
    { label: t("height"),        value: dimensions.height! },
    { label: t("diameter"),      value: dimensions.diameter! },
    { label: t("circumference"), value: dimensions.circumference! },
  ].filter((d) => d.value != null && d.value > 0);

  // Shared cart section renderer
  function renderCartActions(v: VariantData, effectiveStock: number, qty: number) {
    if (effectiveStock === 0 && isAuthenticated) {
      return (
        <button
          type="button"
          onClick={() => toggleRestockAlert(v.id, v.id)}
          disabled={alertLoading[v.id]}
          className={`w-full h-10 text-xs font-heading font-semibold transition-colors flex items-center justify-center gap-1.5 rounded-lg border ${
            restockAlerts[v.id]
              ? "bg-bg-secondary text-text-primary border-border"
              : "bg-bg-dark text-text-inverse border-transparent hover:bg-primary-hover"
          }`}
        >
          {alertLoading[v.id] ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : restockAlerts[v.id] ? (
            <><svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>{t("alertActive")}</>
          ) : (
            <><svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>{t("notifyMe")}</>
          )}
        </button>
      );
    }
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center border border-border rounded-lg overflow-hidden">
          <button type="button" aria-label="Diminuer la quantité"
            onClick={() => setQuantities((q) => ({ ...q, [v.id]: Math.max(1, (q[v.id] ?? 1) - 1) }))}
            className="w-9 h-10 flex items-center justify-center text-text-secondary hover:bg-bg-secondary transition-colors text-base"
          >−</button>
          <input type="number" min={1} max={effectiveStock || undefined} value={qty} aria-label="Quantité"
            onChange={(e) => { const val = parseInt(e.target.value); if (!isNaN(val) && val >= 1) setQuantities((q) => ({ ...q, [v.id]: val })); }}
            className="w-12 h-10 text-center text-sm font-body text-text-primary border-x border-border focus:outline-none bg-bg-primary"
          />
          <button type="button" aria-label="Augmenter la quantité"
            onClick={() => setQuantities((q) => ({ ...q, [v.id]: (q[v.id] ?? 1) + 1 }))}
            className="w-9 h-10 flex items-center justify-center text-text-secondary hover:bg-bg-secondary transition-colors text-base"
          >+</button>
        </div>
        <button type="button" disabled={effectiveStock === 0 || isPending} onClick={() => handleAddToCart(v.id, qty)}
          className={`flex-1 h-10 text-text-inverse text-xs font-heading font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 rounded-lg ${
            addedOptId === v.id ? "bg-accent-dark" : "bg-bg-dark hover:bg-primary-hover"
          }`}
        >
          {addedOptId === v.id ? (
            <><svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>{t("added")}</>
          ) : (
            <><svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>{t("addToCart")}</>
          )}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-10 lg:gap-16">

        {/* -- Images -------------------------------------------------- */}
        <div className="space-y-4 animate-zoom-fade">
          <div
            className="aspect-square bg-bg-secondary overflow-hidden relative cursor-zoom-in rounded-2xl shadow-[inset_3px_3px_8px_rgba(0,0,0,0.06),inset_-2px_-2px_6px_rgba(255,255,255,0.8)]"
            onClick={() => displayedImage && setZoomedSrc(displayedImage)}
          >
            {displayedImage ? (
              <div className="absolute inset-0">
                <Image
                  src={displayedImage}
                  alt={`${tp(name)} — ${tp(displayedColorName)}`}
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-contain"
                  priority
                />
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg className="w-16 h-16 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                    d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                </svg>
              </div>
            )}
            {displayedImage && (
              <div className="absolute bottom-3 right-3 bg-white/70 backdrop-blur-sm text-text-secondary p-1.5 rounded-lg transition-opacity duration-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
                </svg>
              </div>
            )}
          </div>

          {selectedImgs.length > 1 && (
            <div className="flex gap-2 overflow-x-auto py-2 px-0.5 snap-x snap-mandatory scroll-smooth scrollbar-none [-webkit-overflow-scrolling:touch]">
              {selectedImgs.map((img, i) => (
                <div key={i} className="relative shrink-0 snap-start">
                  <Image
                    src={img.path}
                    alt={`${tp(name)} ${i + 1}`}
                    width={72}
                    height={72}
                    sizes="72px"
                    onMouseEnter={() => setHoveredImageIdx(i)}
                    onMouseLeave={() => setHoveredImageIdx(null)}
                    onClick={() => handleImageClick(i)}
                    className={`w-[4.5rem] h-[4.5rem] object-contain rounded-xl cursor-pointer transition-all duration-200 border-2 shadow-[inset_2px_2px_4px_rgba(0,0,0,0.04),inset_-1px_-1px_3px_rgba(255,255,255,0.8)] ${
                      activeImageIdx === i
                        ? "border-text-primary shadow-sm scale-105"
                        : "border-border hover:border-border-dark hover:scale-105"
                    }`}
                  />
                  {activeImageIdx === i && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-text-primary rounded-full animate-thumb-select" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* -- Infos produit ------------------------------------------- */}
        <div className="space-y-4 sm:space-y-6 animate-slide-up">
          {/* Reference */}
          <span className="font-mono text-xs bg-bg-tertiary text-text-secondary px-2.5 py-1 rounded-full border border-border inline-block">
            {reference}
          </span>

          {/* Prix */}
          <div>
            {(hasClientDiscount || hasAnyProductDiscount) && (
              <p className="font-body text-sm text-text-muted line-through">
                {(hasClientDiscount ? minPrice : minBasePrice).toFixed(2)} €
              </p>
            )}
            <div className="flex items-baseline gap-2">
              {hasClientDiscount && clientDiscount?.discountType === "PERCENT" && (
                <span className="text-sm font-body text-[#EF4444] font-medium">
                  -{clientDiscount.discountValue}%
                </span>
              )}
              <p className={`font-heading text-3xl font-semibold ${(hasClientDiscount || hasAnyProductDiscount) ? "text-[#EF4444]" : "text-text-primary"}`}>
                {(hasClientDiscount ? minPriceAfterClient : minPrice).toFixed(2)} €
                <span className="text-sm text-text-muted font-normal ml-1">{t("htUnit")}</span>
              </p>
            </div>
          </div>

          {/* Nom */}
          <h1 className="font-heading text-2xl font-semibold text-text-primary leading-snug">
            {tp(name)}
          </h1>

          {/* Mots cles */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Link
                  key={tag.id}
                  href={`/produits?tag=${tag.id}`}
                  className="text-xs px-3 py-1 rounded-full bg-bg-secondary text-text-secondary border border-border font-body hover:bg-bg-tertiary transition-colors"
                >
                  {tp(tag.name)}
                </Link>
              ))}
            </div>
          )}

          {/* Selecteur couleur */}
          {uniqueColors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-body font-semibold text-text-secondary uppercase tracking-wider">
                {t("color")} — <span className="font-normal text-text-primary">{tp(displayedColorName)}</span>
              </p>
              <div className="flex gap-4 sm:gap-3 flex-wrap">
                {uniqueColors.map((c) => (
                  <button
                    key={c.groupKey}
                    type="button"
                    title={tp(getFullColorName(c.groupKey))}
                    onMouseEnter={() => setHoveredGroupKey(c.groupKey)}
                    onMouseLeave={() => setHoveredGroupKey(null)}
                    onClick={() => handleColorClick(c.groupKey)}
                    className={`relative rounded-full transition-all duration-300 swatch-pulse flex items-center justify-center w-[36px] h-[36px] sm:w-[28px] sm:h-[28px] shadow-[2px_2px_6px_rgba(26,86,219,0.08),-1px_-1px_4px_rgba(255,255,255,0.8)] ${
                      selectedGroupKey === c.groupKey
                        ? "ring-2 ring-accent ring-offset-2 scale-110 shadow-md"
                        : "ring-1 ring-border hover:ring-border-dark hover:scale-110"
                    }`}
                  >
                    <ColorSwatch
                      hex={c.hex}
                      patternImage={c.patternImage}
                      subColors={c.subColors?.map(sc => ({ hex: sc.hex, patternImage: sc.patternImage }))}
                      size={36}
                      rounded="full"
                      border={false}
                    />
                    {selectedGroupKey === c.groupKey && (
                      <span className="absolute inset-[-4px] rounded-full border-2 border-accent/30 animate-pulse-ring pointer-events-none" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Breadcrumb categorie */}
          <div className="flex items-center gap-2 flex-wrap text-sm font-body text-text-muted">
            <span>{tc(category)}</span>
            {subCategories.map((sc) => (
              <span key={sc} className="flex items-center gap-2">
                <span>/</span>
                <span>{tc(sc)}</span>
              </span>
            ))}
          </div>

          {/* Description + Composition + Dimensions */}
          <div className="border-t border-border pt-5 space-y-5">
            <div>
              <p className="text-xs font-body font-semibold text-text-secondary uppercase tracking-wider mb-2">
                {t("description")}
              </p>
              <p className="text-sm text-text-primary font-body leading-relaxed">
                {tp(description)}
              </p>
            </div>

            {compositions.length > 0 && (
              <div>
                <p className="text-xs font-body font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  {t("composition")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {compositions.map((comp) => (
                    <span
                      key={comp.name}
                      className="inline-flex items-center gap-1 text-xs bg-bg-tertiary text-text-primary px-2.5 py-1 rounded-full font-body border border-border"
                    >
                      {tp(comp.name)}
                      <span className="text-text-secondary">— {comp.percentage}%</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {dimRows.length > 0 && (
              <div>
                <p className="text-xs font-body font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  {t("dimensions")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {dimRows.map((d) => (
                    <span
                      key={d.label}
                      className="inline-flex items-center gap-1 text-xs bg-bg-tertiary text-text-secondary px-2.5 py-1 rounded-full font-body border border-border"
                    >
                      {d.label}
                      <span className="text-text-muted">— {d.value} mm</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* -- Options de commande (2 colonnes : Unités gauche | Paquets droite) -- */}
      {(selectedUnitVariants.length > 0 || selectedPackVariants.length > 0) && (
        <section className="mt-10 border-t border-border pt-8">
          <h2 className="font-heading text-xl font-semibold text-text-primary mb-6 section-title">
            {t("orderOptions")}
          </h2>
          <div className={
            selectedUnitVariants.length > 0 && selectedPackVariants.length > 0
              ? "grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8"
              : ""
          }>

            {/* ── Colonne gauche : Unités ────────────────────────────── */}
            {selectedUnitVariants.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-heading text-sm font-semibold text-text-primary pb-3 border-b border-border">
                  Unités
                </h3>
                {selectedUnitVariants.map((v) => {
                  const price        = computePrice(v);
                  const basePrice    = Number(v.unitPrice);
                  const hasDiscount  = price < basePrice;
                  const clientPrice  = applyClientDiscount(price, clientDiscount);
                  const hasClientDsc = !!clientDiscount && clientPrice < price;
                  const anyDsc       = hasDiscount || hasClientDsc;
                  const effectiveStock = v.stock;
                  const qty          = quantities[v.id] ?? 1;
                  const displayPrice = hasClientDsc ? clientPrice : price;
                  const fullColorName = v.subColors && v.subColors.length > 0
                    ? [v.colorName, ...v.subColors.map(sc => sc.name)].filter(Boolean).join(" / ")
                    : v.colorName ?? "";
                  return (
                    <div key={v.id} className="bg-bg-primary border border-border rounded-xl px-4 py-4 space-y-3 hover:border-border-dark transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ColorSwatch
                            hex={v.colorHex ?? "#9CA3AF"}
                            patternImage={v.patternImage}
                            subColors={v.subColors?.map(sc => ({ hex: sc.hex, patternImage: sc.patternImage }))}
                            size={28}
                            rounded="full"
                            border={true}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-text-primary font-body truncate">
                              {fullColorName || t("unitOption")}
                            </p>
                            {v.sizes?.length > 0 && (
                              <p className="text-xs text-text-muted font-body mt-0.5">
                                {v.sizes[0]?.name}
                              </p>
                            )}
                            <p className="text-xs text-text-muted mt-0.5 font-body">
                              {effectiveStock > 0
                                ? <span className="text-text-secondary">&#10003; {effectiveStock} {effectiveStock !== 1 ? t("available_plural") : t("available")}</span>
                                : <span className="text-text-primary">{t("outOfStock")}</span>
                              }
                              {" · "}{v.weight} {t("kgPerUnit")}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {hasDiscount && (
                            <p className="text-xs text-text-muted line-through">{basePrice.toFixed(2)} €</p>
                          )}
                          {hasClientDsc && (
                            <div className="flex items-center gap-1 justify-end">
                              <p className="text-xs text-text-muted line-through">{price.toFixed(2)} €</p>
                              {clientDiscount?.discountType === "PERCENT" && (
                                <span className="text-[10px] text-[#EF4444] font-medium">-{clientDiscount.discountValue}%</span>
                              )}
                            </div>
                          )}
                          <p className={`font-heading font-semibold text-lg ${anyDsc ? "text-[#EF4444]" : "text-text-primary"}`}>
                            {displayPrice.toFixed(2)} €
                          </p>
                          {qty > 1 && (
                            <p className="text-xs text-text-muted font-body">
                              = {(displayPrice * qty).toFixed(2)} € total
                            </p>
                          )}
                        </div>
                      </div>
                      {renderCartActions(v, effectiveStock, qty)}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Colonne droite : Paquets ───────────────────────────── */}
            {selectedPackVariants.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-heading text-sm font-semibold text-text-primary pb-3 border-b border-border">
                  Paquets
                </h3>
                {selectedPackVariants.map((v) => {
                  const price        = computePrice(v);
                  const basePrice    = Number(v.unitPrice);
                  const hasDiscount  = price < basePrice;
                  const clientPrice  = applyClientDiscount(price, clientDiscount);
                  const hasClientDsc = !!clientDiscount && clientPrice < price;
                  const anyDsc       = hasDiscount || hasClientDsc;
                  const effectiveStock = v.packQuantity ? Math.floor(v.stock / v.packQuantity) : v.stock;
                  const qty          = quantities[v.id] ?? 1;
                  const displayPrice = hasClientDsc ? clientPrice : price;
                  return (
                    <div key={v.id} className="bg-bg-primary border border-border rounded-xl px-4 py-4 space-y-3 hover:border-border-dark transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary font-body">
                            {t("packOption", { qty: v.packQuantity ?? 1 })}
                          </p>
                          {(v.packColorLines?.[0]?.colors?.length ?? 0) > 0 && (() => {
                            const line = v.packColorLines![0];
                            return (
                              <div className="mt-1.5 flex items-center gap-2">
                                <ColorSwatch
                                  hex={line.colors[0]?.hex ?? "#9CA3AF"}
                                  patternImage={line.colors[0]?.patternImage}
                                  subColors={line.colors.slice(1).map(c => ({ hex: c.hex, patternImage: c.patternImage }))}
                                  size={22}
                                  rounded="full"
                                  border={true}
                                />
                                <span className="text-xs text-text-secondary font-body truncate">
                                  {line.colors.map(c => c.name).join(" / ")}
                                </span>
                              </div>
                            );
                          })()}
                          {v.sizes?.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {v.sizes.map((s) => (
                                <p key={s.name} className="text-xs text-text-muted font-body">
                                  {s.name} × {s.quantity}
                                  {s.pricePerUnit != null && (
                                    <span className="text-text-secondary ml-1">— {Number(s.pricePerUnit).toFixed(2)} €/u</span>
                                  )}
                                </p>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-text-muted mt-0.5 font-body">
                            {effectiveStock > 0
                              ? <span className="text-text-secondary">&#10003; {effectiveStock} {effectiveStock !== 1 ? t("available_plural") : t("available")}</span>
                              : <span className="text-text-primary">{t("outOfStock")}</span>
                            }
                            {" · "}{v.weight} {t("kgPerUnit")}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {hasDiscount && (
                            <p className="text-xs text-text-muted line-through">{basePrice.toFixed(2)} €</p>
                          )}
                          {hasClientDsc && (
                            <div className="flex items-center gap-1 justify-end">
                              <p className="text-xs text-text-muted line-through">{price.toFixed(2)} €</p>
                              {clientDiscount?.discountType === "PERCENT" && (
                                <span className="text-[10px] text-[#EF4444] font-medium">-{clientDiscount.discountValue}%</span>
                              )}
                            </div>
                          )}
                          <p className={`font-heading font-semibold text-lg ${anyDsc ? "text-[#EF4444]" : "text-text-primary"}`}>
                            {displayPrice.toFixed(2)} €
                          </p>
                          {qty > 1 && (
                            <p className="text-xs text-text-muted font-body">
                              = {(displayPrice * qty).toFixed(2)} € total
                            </p>
                          )}
                        </div>
                      </div>
                      {renderCartActions(v, effectiveStock, qty)}
                    </div>
                  );
                })}
              </div>
            )}


          </div>
        </section>
      )}

      {/* -- Contenu de l'ensemble (bundle children) -------------------- */}
      {bundleChildren.length > 0 && (
        <section className="mt-16 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-semibold text-text-primary mb-6 section-title">
            {t("bundleContains")}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {bundleChildren.map((p, i) => (
              <div key={p.id} className="animate-zoom-fade" style={{ animationDelay: `${i * 0.08}s` }}>
                <RelatedCard product={p} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* -- Fait partie de (bundle parents) ----------------------------- */}
      {bundleParents.length > 0 && (
        <section className="mt-16 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-semibold text-text-primary mb-6 section-title">
            {t("bundleFoundIn")}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {bundleParents.map((p, i) => (
              <div key={p.id} className="animate-zoom-fade" style={{ animationDelay: `${i * 0.08}s` }}>
                <RelatedCard product={p} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* -- Produits similaires --------------------------------------- */}
      {similarProducts.length > 0 && (
        <section className="mt-16 border-t border-border pt-12 pb-20 lg:pb-0">
          <h2 className="font-heading text-xl font-semibold text-text-primary mb-6 section-title">
            {t("similar")}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {similarProducts.map((p, i) => (
              <div key={p.id} className="animate-zoom-fade" style={{ animationDelay: `${i * 0.08}s` }}>
                <RelatedCard product={p} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sticky mobile add-to-cart bar */}
      {selectedUnitVariants.length > 0 && (() => {
        const firstV = selectedUnitVariants[0];
        const stickyPrice = computePrice(firstV);
        const stickyClientPrice = applyClientDiscount(stickyPrice, clientDiscount);
        const stickyDisplayPrice = clientDiscount ? stickyClientPrice : stickyPrice;
        const stickyStock = firstV.stock;
        const stickyQty = quantities[firstV.id] ?? 1;
        return (
          <div className="fixed bottom-0 left-0 right-0 z-40 bg-bg-primary border-t border-border px-4 py-3 flex items-center gap-3 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] lg:hidden safe-area-bottom">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-heading font-semibold text-text-primary truncate">
                {stickyDisplayPrice.toFixed(2)} € <span className="text-xs text-text-muted font-normal">{t("htUnit")}</span>
              </p>
              <p className="text-xs text-text-muted font-body truncate">
                {stickyStock > 0 ? `${stickyStock} ${t("available")}` : t("outOfStock")}
              </p>
            </div>
            <div className="flex items-center border border-border rounded-lg overflow-hidden shrink-0">
              <button type="button" aria-label="Diminuer"
                onClick={() => setQuantities((q) => ({ ...q, [firstV.id]: Math.max(1, (q[firstV.id] ?? 1) - 1) }))}
                className="w-10 h-11 flex items-center justify-center text-text-secondary text-base"
              >−</button>
              <span className="w-8 h-11 flex items-center justify-center text-sm font-body text-text-primary border-x border-border">{stickyQty}</span>
              <button type="button" aria-label="Augmenter"
                onClick={() => setQuantities((q) => ({ ...q, [firstV.id]: (q[firstV.id] ?? 1) + 1 }))}
                className="w-10 h-11 flex items-center justify-center text-text-secondary text-base"
              >+</button>
            </div>
            <button type="button" disabled={stickyStock === 0 || isPending} onClick={() => handleAddToCart(firstV.id, stickyQty)}
              className={`h-11 px-5 text-text-inverse text-xs font-heading font-semibold rounded-lg shrink-0 flex items-center gap-1.5 transition-colors disabled:opacity-40 ${
                addedOptId === firstV.id ? "bg-accent-dark" : "bg-bg-dark hover:bg-primary-hover"
              }`}
            >
              {addedOptId === firstV.id ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>
              )}
            </button>
          </div>
        );
      })()}

      {/* Lightbox */}
      {zoomedSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/90 sm:bg-black/80 flex items-center justify-center p-0 sm:p-4 animate-lightbox-in touch-manipulation"
          onClick={() => setZoomedSrc(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedSrc}
            alt={t("preview")}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[100dvh] max-w-[100vw] sm:max-h-[90vh] sm:max-w-[90vw] object-contain sm:shadow-2xl sm:rounded-xl animate-lightbox-img-in touch-pinch-zoom"
          />
          <button
            type="button"
            onClick={() => setZoomedSrc(null)}
            className="absolute top-4 right-4 w-11 h-11 sm:w-9 sm:h-9 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl backdrop-blur-sm transition-transform hover:scale-110 animate-zoom-fade"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
