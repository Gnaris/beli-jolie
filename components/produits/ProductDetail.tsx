"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { addToCart } from "@/app/actions/client/cart";

interface SaleOptionData {
  id: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
  discountType:  "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}

interface ColorData {
  id: string;
  name: string;
  hex: string | null;
  unitPrice: number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  images: { path: string; order: number }[];
  saleOptions: SaleOptionData[];
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

interface ProductDetailProps {
  name: string;
  reference: string;
  description: string;
  category: string;
  subCategories: string[];
  tags: { id: string; name: string }[];
  colors: ColorData[];
  compositions: CompositionData[];
  dimensions: DimensionsData;
  similarProducts: RelatedProduct[];
}

function computePrice(unitPrice: number, opt: SaleOptionData): number {
  const total = opt.saleType === "UNIT" ? unitPrice : unitPrice * (opt.packQuantity ?? 1);
  if (!opt.discountType || !opt.discountValue) return total;
  if (opt.discountType === "PERCENT") return Math.max(0, total * (1 - opt.discountValue / 100));
  return Math.max(0, total - opt.discountValue);
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
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.primaryImage}
            alt={tp(product.name)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
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

export default function ProductDetail({
  name, reference, description, category, subCategories, tags, colors,
  compositions, dimensions, similarProducts,
}: ProductDetailProps) {
  const router = useRouter();
  const t = useTranslations("product");
  const { tp, tc } = useProductTranslation();
  const [isPending, startTransition]          = useTransition();
  const primaryColor = colors.find((c) => c.isPrimary) ?? colors[0];
  const [selected, setSelected]               = useState<ColorData>(primaryColor);
  const [hoveredColor, setHoveredColor]       = useState<ColorData | null>(null);
  const [activeImageIdx, setActiveImageIdx]   = useState(0);
  const [hoveredImageIdx, setHoveredImageIdx] = useState<number | null>(null);
  const [zoomedSrc, setZoomedSrc]             = useState<string | null>(null);
  const [quantities, setQuantities]           = useState<Record<string, number>>({});
  const [addedOptId, setAddedOptId]           = useState<string | null>(null);

  function handleAddToCart(saleOptionId: string, qty: number) {
    startTransition(async () => {
      try {
        await addToCart(saleOptionId, qty);
        setAddedOptId(saleOptionId);
        router.refresh(); // rafraichit le badge panier dans la Navbar
        setTimeout(() => setAddedOptId(null), 2000);
      } catch {
        router.push("/connexion");
      }
    });
  }

  const displayed = hoveredColor ?? selected;
  const displayedImage = hoveredColor
    ? hoveredColor.images[0]?.path ?? null
    : selected.images[hoveredImageIdx ?? activeImageIdx]?.path ?? null;

  const maxPrice = Math.max(...colors.map((c) => c.unitPrice));

  function handleColorClick(c: ColorData) {
    setSelected(c);
    setHoveredColor(null);
    setActiveImageIdx(0);
    setHoveredImageIdx(null);
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">

        {/* -- Images -------------------------------------------------- */}
        <div className="space-y-4">
          <div
            className="aspect-square bg-bg-tertiary overflow-hidden relative cursor-zoom-in rounded-xl"
            onClick={() => displayedImage && setZoomedSrc(displayedImage)}
          >
            {displayedImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={displayedImage}
                alt={`${tp(name)} — ${tp(displayed.name)}`}
                className="w-full h-full object-cover transition-all duration-300"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg className="w-16 h-16 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                    d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                </svg>
              </div>
            )}
            {displayedImage && (
              <div className="absolute bottom-3 right-3 bg-white/70 backdrop-blur-sm text-text-secondary p-1.5 rounded-lg">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
                </svg>
              </div>
            )}
          </div>

          {selected.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {selected.images.map((img, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={img.path}
                  alt={`${tp(name)} ${i + 1}`}
                  onMouseEnter={() => setHoveredImageIdx(i)}
                  onMouseLeave={() => setHoveredImageIdx(null)}
                  onClick={() => setActiveImageIdx(i)}
                  className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-all shrink-0 border-2 ${
                    activeImageIdx === i
                      ? "border-text-primary shadow-sm"
                      : "border-border hover:border-border-dark"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* -- Infos produit ------------------------------------------- */}
        <div className="space-y-6">
          {/* Reference */}
          <span className="font-mono text-xs bg-bg-tertiary text-text-secondary px-2.5 py-1 rounded-full border border-border inline-block">
            {reference}
          </span>

          {/* Prix */}
          <div>
            <p className="font-[family-name:var(--font-poppins)] text-3xl font-semibold text-text-primary">
              {maxPrice.toFixed(2)} €
              <span className="text-sm text-text-muted font-normal ml-1">{t("perUnit")}</span>
            </p>
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
          {colors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-secondary uppercase tracking-wider">
                {t("color")} — <span className="font-normal text-text-primary">{tp(displayed.name)}</span>
              </p>
              <div className="flex gap-2.5 flex-wrap">
                {colors.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={tp(c.name)}
                    onMouseEnter={() => setHoveredColor(c)}
                    onMouseLeave={() => setHoveredColor(null)}
                    onClick={() => handleColorClick(c)}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      selected.id === c.id
                        ? "border-text-primary scale-110 shadow-md"
                        : "border-border hover:border-border-dark hover:scale-105"
                    }`}
                    style={{ backgroundColor: c.hex ?? "#9CA3AF" }}
                  />
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
          {selected.saleOptions.length > 0 && (
            <div className="border-t border-border pt-5 space-y-3">
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-secondary uppercase tracking-wider">
                {t("orderOptions")} — {tp(selected.name)}
              </p>
              {selected.saleOptions.map((opt) => {
                const price     = computePrice(selected.unitPrice, opt);
                const basePrice = opt.saleType === "UNIT"
                  ? selected.unitPrice
                  : selected.unitPrice * (opt.packQuantity ?? 1);
                const hasDiscount    = price < basePrice;
                const effectiveStock = opt.saleType === "PACK" && opt.packQuantity
                  ? Math.floor(selected.stock / opt.packQuantity)
                  : selected.stock;
                const qty = quantities[opt.id] ?? 1;

                return (
                  <div
                    key={opt.id}
                    className="bg-bg-primary border border-border rounded-xl px-4 py-4 space-y-3 hover:border-border-dark transition-colors"
                  >
                    {/* Libelle + prix */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)] flex items-center flex-wrap gap-1.5">
                          {opt.saleType === "UNIT" ? t("unitOption") : t("packOption", { qty: opt.packQuantity })}
                          {opt.size && (
                            <span className="text-xs font-normal bg-bg-tertiary text-text-primary px-2 py-0.5 rounded-full border border-border">
                              {t("sizeLabel", { size: opt.size })}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-text-muted mt-0.5 font-[family-name:var(--font-roboto)]">
                          {effectiveStock > 0
                            ? <span className="text-text-secondary">&#10003; {effectiveStock} {effectiveStock !== 1 ? t("available_plural") : t("available")}</span>
                            : <span className="text-text-primary">{t("outOfStock")}</span>
                          }
                          {" · "}{selected.weight} {t("kgPerUnit")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {hasDiscount && (
                          <p className="text-xs text-text-muted line-through">{basePrice.toFixed(2)} €</p>
                        )}
                        <p className={`font-[family-name:var(--font-poppins)] font-semibold text-lg ${hasDiscount ? "text-accent-dark" : "text-text-primary"}`}>
                          {price.toFixed(2)} €
                        </p>
                        {qty > 1 && (
                          <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
                            = {(price * qty).toFixed(2)} € total
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Quantite + panier */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center border border-border rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setQuantities((q) => ({ ...q, [opt.id]: Math.max(1, (q[opt.id] ?? 1) - 1) }))}
                          className="w-8 h-9 flex items-center justify-center text-text-secondary hover:bg-bg-secondary transition-colors text-base"
                        >−</button>
                        <input
                          type="number"
                          min={1}
                          max={effectiveStock || undefined}
                          value={qty}
                          onChange={(e) => {
                            const v = parseInt(e.target.value);
                            if (!isNaN(v) && v >= 1) setQuantities((q) => ({ ...q, [opt.id]: v }));
                          }}
                          className="w-12 h-9 text-center text-sm font-[family-name:var(--font-roboto)] text-text-primary border-x border-border focus:outline-none bg-bg-primary"
                        />
                        <button
                          type="button"
                          onClick={() => setQuantities((q) => ({ ...q, [opt.id]: (q[opt.id] ?? 1) + 1 }))}
                          className="w-8 h-9 flex items-center justify-center text-text-secondary hover:bg-bg-secondary transition-colors text-base"
                        >+</button>
                      </div>
                      <button
                        type="button"
                        disabled={effectiveStock === 0 || isPending}
                        onClick={() => handleAddToCart(opt.id, qty)}
                        className={`flex-1 h-9 text-text-inverse text-xs font-[family-name:var(--font-poppins)] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 rounded-lg ${
                          addedOptId === opt.id ? "bg-accent-dark" : "bg-bg-dark hover:bg-[#333333]"
                        }`}
                      >
                        {addedOptId === opt.id ? (
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
            {similarProducts.map((p) => (
              <RelatedCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* Lightbox */}
      {zoomedSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setZoomedSrc(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedSrc}
            alt={t("preview")}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] object-contain shadow-2xl rounded-xl"
          />
          <button
            type="button"
            onClick={() => setZoomedSrc(null)}
            className="absolute top-4 right-4 w-9 h-9 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl backdrop-blur-sm"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
