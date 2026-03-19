"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { addToCart } from "@/app/actions/client/cart";

interface SubColorInfo {
  name: string;
  hex: string;
  patternImage?: string | null;
}

interface VariantData {
  id: string;
  colorId: string;
  colorName: string;
  colorHex: string | null;
  patternImage?: string | null;     // Image motif (léopard, camouflage…) — prioritaire sur hex
  subColors?: SubColorInfo[]; // Sous-couleurs optionnelles (ex: [{name:"Rouge",hex:"#FF0000"}])
  unitPrice: number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
  discountType:  "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}

interface ColorImageData {
  colorId: string;
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
  clientDiscount?: ClientDiscountInfo | null;
  isAuthenticated?: boolean;
}

function computePrice(v: VariantData): number {
  const total = v.saleType === "UNIT" ? v.unitPrice : v.unitPrice * (v.packQuantity ?? 1);
  if (!v.discountType || !v.discountValue) return total;
  if (v.discountType === "PERCENT") return Math.max(0, total * (1 - v.discountValue / 100));
  return Math.max(0, total - v.discountValue);
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
        <p className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)] mt-0.5 line-clamp-2">
          {tp(product.name)}
        </p>
        <p className="text-sm font-[family-name:var(--font-poppins)] font-semibold text-text-primary mt-1">
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
  colorImages, compositions, dimensions, similarProducts, clientDiscount, isAuthenticated,
}: ProductDetailProps) {
  const router = useRouter();
  const t = useTranslations("product");
  const { tp, tc } = useProductTranslation();
  const [isPending, startTransition] = useTransition();

  // Unique colors derived from variants (with sub-colors)
  const uniqueColors = [...new Map(
    variants.map(v => [v.colorId, {
      id: v.colorId,
      name: v.colorName,
      hex: v.colorHex,
      patternImage: v.patternImage,
      subColors: v.subColors,
    }])
  ).values()];

  const primaryColorId = variants.find(v => v.isPrimary)?.colorId ?? uniqueColors[0]?.id ?? "";

  const [selectedColorId, setSelectedColorId]     = useState<string>(primaryColorId);
  const [hoveredColorId, setHoveredColorId]       = useState<string | null>(null);
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

  // Image display (no animation on switch)

  const selectedVariants = variants.filter(v => v.colorId === selectedColorId);
  const selectedImgs     = colorImages.find(ci => ci.colorId === selectedColorId)?.images ?? [];
  const displayedImgs    = hoveredColorId
    ? colorImages.find(ci => ci.colorId === hoveredColorId)?.images ?? []
    : selectedImgs;

  const displayedImage = hoveredColorId
    ? displayedImgs[0]?.path ?? null
    : selectedImgs[hoveredImageIdx ?? activeImageIdx]?.path ?? null;

  // Build full color label including sub-colors (ex: "Doré/Rouge/Noir")
  const getFullColorName = (colorId: string) => {
    const c = uniqueColors.find(uc => uc.id === colorId);
    if (!c) return "";
    if (c.subColors && c.subColors.length > 0) {
      return [c.name, ...c.subColors.map(sc => sc.name)].join("/");
    }
    return c.name;
  };

  // Build swatch style: patternImage > conic-gradient > solid color
  const getSwatchStyle = (c: typeof uniqueColors[number]): React.CSSProperties => {
    // Pattern image takes priority (léopard, camouflage, carreaux…)
    if (c.patternImage) {
      return { backgroundImage: `url(${c.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" };
    }
    const mainHex = c.hex ?? "#9CA3AF";
    if (!c.subColors || c.subColors.length === 0) {
      return { backgroundColor: mainHex };
    }
    // Check if any sub-color has a patternImage — fall back to conic-gradient of hexes
    const allColors = [mainHex, ...c.subColors.map(sc => sc.hex)];
    const segmentSize = 360 / allColors.length;
    const stops = allColors.map((hex, i) =>
      `${hex} ${i * segmentSize}deg ${(i + 1) * segmentSize}deg`
    ).join(", ");
    return { background: `conic-gradient(${stops})` };
  };
  const displayedColorName = getFullColorName(hoveredColorId ?? selectedColorId);

  const minPrice = variants.length > 0 ? Math.min(...variants.map(v => computePrice(v))) : 0;
  const minBasePrice = variants.length > 0 ? Math.min(...variants.map(v => v.saleType === "UNIT" ? v.unitPrice : v.unitPrice * (v.packQuantity ?? 1))) : 0;
  const hasAnyProductDiscount = minPrice < minBasePrice;
  const minPriceAfterClient = applyClientDiscount(minPrice, clientDiscount);
  const hasClientDiscount = !!clientDiscount && minPriceAfterClient < minPrice;

  function handleColorClick(colorId: string) {
    if (colorId === selectedColorId) return;
    setSelectedColorId(colorId);
    setHoveredColorId(null);
    setActiveImageIdx(0);
    setHoveredImageIdx(null);
  }

  function handleImageClick(idx: number) {
    if (idx === activeImageIdx) return;
    setActiveImageIdx(idx);
  }

  function handleAddToCart(variantId: string, qty: number) {
    startTransition(async () => {
      try {
        await addToCart(variantId, qty);
        setAddedOptId(variantId);
        router.refresh();
        setTimeout(() => setAddedOptId(null), 2000);
      } catch {
        router.push("/connexion");
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

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-10 lg:gap-16">

        {/* -- Images -------------------------------------------------- */}
        <div className="space-y-4 animate-zoom-fade">
          <div
            className="aspect-square bg-bg-tertiary overflow-hidden relative cursor-zoom-in rounded-xl"
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
            <div className="flex gap-2 overflow-x-auto py-2 px-0.5">
              {selectedImgs.map((img, i) => (
                <div key={i} className="relative shrink-0">
                  <Image
                    src={img.path}
                    alt={`${tp(name)} ${i + 1}`}
                    width={72}
                    height={72}
                    sizes="72px"
                    onMouseEnter={() => setHoveredImageIdx(i)}
                    onMouseLeave={() => setHoveredImageIdx(null)}
                    onClick={() => handleImageClick(i)}
                    className={`w-[4.5rem] h-[4.5rem] object-contain rounded-lg cursor-pointer transition-all duration-200 border-2 ${
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
              <p className="font-[family-name:var(--font-roboto)] text-sm text-text-muted line-through">
                {(hasClientDiscount ? minPrice : minBasePrice).toFixed(2)} €
              </p>
            )}
            <div className="flex items-baseline gap-2">
              {hasClientDiscount && clientDiscount?.discountType === "PERCENT" && (
                <span className="text-sm font-[family-name:var(--font-roboto)] text-[#EF4444] font-medium">
                  -{clientDiscount.discountValue}%
                </span>
              )}
              <p className={`font-[family-name:var(--font-poppins)] text-3xl font-semibold ${(hasClientDiscount || hasAnyProductDiscount) ? "text-[#EF4444]" : "text-text-primary"}`}>
                {(hasClientDiscount ? minPriceAfterClient : minPrice).toFixed(2)} €
                <span className="text-sm text-text-muted font-normal ml-1">{t("htUnit")}</span>
              </p>
            </div>
          </div>

          {/* Nom */}
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-text-primary leading-snug">
            {tp(name)}
          </h1>

          {/* Mots cles */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Link
                  key={tag.id}
                  href={`/produits?tag=${tag.id}`}
                  className="text-xs px-3 py-1 rounded-full bg-bg-secondary text-text-secondary border border-border font-[family-name:var(--font-roboto)] hover:bg-bg-tertiary transition-colors"
                >
                  {tp(tag.name)}
                </Link>
              ))}
            </div>
          )}

          {/* Selecteur couleur */}
          {uniqueColors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-secondary uppercase tracking-wider">
                {t("color")} — <span className="font-normal text-text-primary">{tp(displayedColorName)}</span>
              </p>
              <div className="flex gap-2.5 flex-wrap">
                {uniqueColors.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={tp(getFullColorName(c.id))}
                    onMouseEnter={() => setHoveredColorId(c.id)}
                    onMouseLeave={() => setHoveredColorId(null)}
                    onClick={() => handleColorClick(c.id)}
                    className={`relative w-8 h-8 rounded-full border-2 transition-all duration-300 swatch-pulse ${
                      selectedColorId === c.id
                        ? "border-text-primary scale-110 shadow-md"
                        : "border-border hover:border-border-dark hover:scale-110"
                    }`}
                    style={getSwatchStyle(c)}
                  >
                    {selectedColorId === c.id && (
                      <span className="absolute inset-[-4px] rounded-full border-2 border-text-primary/30 animate-pulse-ring pointer-events-none" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Breadcrumb categorie */}
          <div className="flex items-center gap-2 flex-wrap text-sm font-[family-name:var(--font-roboto)] text-text-muted">
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
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-secondary uppercase tracking-wider mb-2">
                {t("description")}
              </p>
              <p className="text-sm text-text-primary font-[family-name:var(--font-roboto)] leading-relaxed">
                {tp(description)}
              </p>
            </div>

            {compositions.length > 0 && (
              <div>
                <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  {t("composition")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {compositions.map((comp) => (
                    <span
                      key={comp.name}
                      className="inline-flex items-center gap-1 text-xs bg-bg-tertiary text-text-primary px-2.5 py-1 rounded-full font-[family-name:var(--font-roboto)] border border-border"
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
                <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  {t("dimensions")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {dimRows.map((d) => (
                    <span
                      key={d.label}
                      className="inline-flex items-center gap-1 text-xs bg-bg-tertiary text-text-secondary px-2.5 py-1 rounded-full font-[family-name:var(--font-roboto)] border border-border"
                    >
                      {d.label}
                      <span className="text-text-muted">— {d.value} mm</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Options de commande */}
          {selectedVariants.length > 0 && (
            <div className="border-t border-border pt-5 space-y-3">
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-secondary uppercase tracking-wider">
                {t("orderOptions")} — {tp(displayedColorName)}
              </p>
              {selectedVariants.map((v) => {
                const price     = computePrice(v);
                const basePrice = v.saleType === "UNIT"
                  ? v.unitPrice
                  : v.unitPrice * (v.packQuantity ?? 1);
                const hasDiscount    = price < basePrice;
                const clientPrice    = applyClientDiscount(price, clientDiscount);
                const hasClientDsc   = !!clientDiscount && clientPrice < price;
                const anyDsc         = hasDiscount || hasClientDsc;
                const effectiveStock = v.saleType === "PACK" && v.packQuantity
                  ? Math.floor(v.stock / v.packQuantity)
                  : v.stock;
                const qty = quantities[v.id] ?? 1;
                const displayPrice = hasClientDsc ? clientPrice : price;

                return (
                  <div
                    key={v.id}
                    className="bg-bg-primary border border-border rounded-xl px-3 py-3 sm:px-4 sm:py-4 space-y-3 hover:border-border-dark transition-colors"
                  >
                    {/* Libelle + prix */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)] flex items-center flex-wrap gap-1.5">
                          {v.saleType === "UNIT" ? t("unitOption") : t("packOption", { qty: v.packQuantity ?? 1 })}
                          {v.size && (
                            <span className="text-xs font-normal bg-bg-tertiary text-text-primary px-2 py-0.5 rounded-full border border-border">
                              {t("sizeLabel", { size: v.size })}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-text-muted mt-0.5 font-[family-name:var(--font-roboto)]">
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
                        <p className={`font-[family-name:var(--font-poppins)] font-semibold text-lg ${anyDsc ? "text-[#EF4444]" : "text-text-primary"}`}>
                          {displayPrice.toFixed(2)} €
                        </p>
                        {qty > 1 && (
                          <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
                            = {(displayPrice * qty).toFixed(2)} € total
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Quantite + panier / Alerte réassort */}
                    {effectiveStock === 0 && isAuthenticated ? (
                      <button
                        type="button"
                        onClick={() => toggleRestockAlert(v.id, v.id)}
                        disabled={alertLoading[v.id]}
                        className={`w-full h-10 text-xs font-[family-name:var(--font-poppins)] font-semibold transition-colors flex items-center justify-center gap-1.5 rounded-lg border ${
                          restockAlerts[v.id]
                            ? "bg-bg-secondary text-text-primary border-border"
                            : "bg-bg-dark text-text-inverse border-transparent hover:bg-[#333333]"
                        }`}
                      >
                        {alertLoading[v.id] ? (
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : restockAlerts[v.id] ? (
                          <>
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            {t("alertActive")}
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                            </svg>
                            {t("notifyMe")}
                          </>
                        )}
                      </button>
                    ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center border border-border rounded-lg overflow-hidden">
                        <button
                          type="button"
                          aria-label="Diminuer la quantité"
                          onClick={() => setQuantities((q) => ({ ...q, [v.id]: Math.max(1, (q[v.id] ?? 1) - 1) }))}
                          className="w-9 h-10 flex items-center justify-center text-text-secondary hover:bg-bg-secondary transition-colors text-base"
                        >−</button>
                        <input
                          type="number"
                          min={1}
                          max={effectiveStock || undefined}
                          value={qty}
                          aria-label="Quantité"
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val) && val >= 1) setQuantities((q) => ({ ...q, [v.id]: val }));
                          }}
                          className="w-12 h-10 text-center text-sm font-[family-name:var(--font-roboto)] text-text-primary border-x border-border focus:outline-none bg-bg-primary"
                        />
                        <button
                          type="button"
                          aria-label="Augmenter la quantité"
                          onClick={() => setQuantities((q) => ({ ...q, [v.id]: (q[v.id] ?? 1) + 1 }))}
                          className="w-9 h-10 flex items-center justify-center text-text-secondary hover:bg-bg-secondary transition-colors text-base"
                        >+</button>
                      </div>
                      <button
                        type="button"
                        disabled={effectiveStock === 0 || isPending}
                        onClick={() => handleAddToCart(v.id, qty)}
                        className={`flex-1 h-10 text-text-inverse text-xs font-[family-name:var(--font-poppins)] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 rounded-lg ${
                          addedOptId === v.id ? "bg-accent-dark" : "bg-bg-dark hover:bg-[#333333]"
                        }`}
                      >
                        {addedOptId === v.id ? (
                          <>
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            {t("added")}
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                            </svg>
                            {t("addToCart")}
                          </>
                        )}
                      </button>
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* -- Produits similaires --------------------------------------- */}
      {similarProducts.length > 0 && (
        <section className="mt-16 border-t border-border pt-12">
          <h2 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-text-primary mb-6 section-title">
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

      {/* Lightbox */}
      {zoomedSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-lightbox-in"
          onClick={() => setZoomedSrc(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedSrc}
            alt={t("preview")}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] object-contain shadow-2xl rounded-xl animate-lightbox-img-in"
          />
          <button
            type="button"
            onClick={() => setZoomedSrc(null)}
            className="absolute top-4 right-4 w-9 h-9 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl backdrop-blur-sm transition-transform hover:scale-110 animate-zoom-fade"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
