"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  return (
    <Link
      href={`/produits/${product.id}`}
      className="group block bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden hover:border-[#1A1A1A] transition-all duration-300 hover:shadow-[0_8px_32px_rgba(26,26,26,0.14)]"
    >
      <div className="aspect-square bg-[#F5F5F5] overflow-hidden">
        {product.primaryImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.primaryImage}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-[#555555] opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-3.5">
        <p className="text-xs font-mono text-[#999999]">{product.reference}</p>
        <p className="text-sm font-medium text-[#1A1A1A] font-[family-name:var(--font-roboto)] mt-0.5 line-clamp-2">
          {product.name}
        </p>
        <p className="text-sm font-[family-name:var(--font-poppins)] font-semibold text-[#1A1A1A] mt-1">
          {product.minPrice.toFixed(2)} €
        </p>
      </div>
    </Link>
  );
}

export default function ProductDetail({
  name, reference, description, category, subCategories, colors,
  compositions, dimensions, similarProducts,
}: ProductDetailProps) {
  const router = useRouter();
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
      await addToCart(saleOptionId, qty);
      setAddedOptId(saleOptionId);
      router.refresh(); // rafraîchit le badge panier dans la Navbar
      setTimeout(() => setAddedOptId(null), 2000);
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
    { label: "Longueur",     value: dimensions.length! },
    { label: "Largeur",      value: dimensions.width! },
    { label: "Hauteur",      value: dimensions.height! },
    { label: "Diamètre",     value: dimensions.diameter! },
    { label: "Circonférence", value: dimensions.circumference! },
  ].filter((d) => d.value != null && d.value > 0);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">

        {/* ── Images ──────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div
            className="aspect-square bg-[#F5F5F5] overflow-hidden relative cursor-zoom-in rounded-2xl"
            onClick={() => displayedImage && setZoomedSrc(displayedImage)}
          >
            {displayedImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={displayedImage}
                alt={`${name} — ${displayed.name}`}
                className="w-full h-full object-cover transition-all duration-300"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg className="w-16 h-16 text-[#555555] opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                    d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                </svg>
              </div>
            )}
            {displayedImage && (
              <div className="absolute bottom-3 right-3 bg-white/70 backdrop-blur-sm text-[#555555] p-1.5 rounded-lg">
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
                  alt={`${name} ${i + 1}`}
                  onMouseEnter={() => setHoveredImageIdx(i)}
                  onMouseLeave={() => setHoveredImageIdx(null)}
                  onClick={() => setActiveImageIdx(i)}
                  className={`w-16 h-16 object-cover rounded-xl cursor-pointer transition-all shrink-0 border-2 ${
                    activeImageIdx === i
                      ? "border-[#1A1A1A] shadow-sm"
                      : "border-[#E5E5E5] hover:border-[#555555]"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Infos produit ──────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Référence */}
          <span className="font-mono text-xs bg-[#F5F5F5] text-[#555555] px-2.5 py-1 rounded-full border border-[#E5E5E5] inline-block">
            {reference}
          </span>

          {/* Prix */}
          <div>
            <p className="font-[family-name:var(--font-poppins)] text-3xl font-semibold text-[#1A1A1A]">
              {maxPrice.toFixed(2)} €
              <span className="text-sm text-[#999999] font-normal ml-1">/ unité</span>
            </p>
          </div>

          {/* Nom */}
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#1A1A1A] leading-snug">
            {name}
          </h1>

          {/* Sélecteur couleur */}
          {colors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#555555] uppercase tracking-wider">
                Couleur — <span className="font-normal text-[#1A1A1A]">{displayed.name}</span>
              </p>
              <div className="flex gap-2.5 flex-wrap">
                {colors.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={c.name}
                    onMouseEnter={() => setHoveredColor(c)}
                    onMouseLeave={() => setHoveredColor(null)}
                    onClick={() => handleColorClick(c)}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      selected.id === c.id
                        ? "border-[#1A1A1A] scale-110 shadow-md"
                        : "border-[#E5E5E5] hover:border-[#555555] hover:scale-105"
                    }`}
                    style={{ backgroundColor: c.hex ?? "#999999" }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Breadcrumb catégorie */}
          <div className="flex items-center gap-2 flex-wrap text-sm font-[family-name:var(--font-roboto)] text-[#999999]">
            <span>{category}</span>
            {subCategories.map((sc) => (
              <span key={sc} className="flex items-center gap-2">
                <span>/</span>
                <span>{sc}</span>
              </span>
            ))}
          </div>

          {/* Description + Composition + Dimensions */}
          <div className="border-t border-[#F5F5F5] pt-5 space-y-5">
            <div>
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#555555] uppercase tracking-wider mb-2">
                Description
              </p>
              <p className="text-sm text-[#1A1A1A] font-[family-name:var(--font-roboto)] leading-relaxed">
                {description}
              </p>
            </div>

            {compositions.length > 0 && (
              <div>
                <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#555555] uppercase tracking-wider mb-2">
                  Composition
                </p>
                <div className="flex flex-wrap gap-2">
                  {compositions.map((comp) => (
                    <span
                      key={comp.name}
                      className="inline-flex items-center gap-1 text-xs bg-[#F5F5F5] text-[#333333] px-2.5 py-1 rounded-full font-[family-name:var(--font-roboto)] border border-[#E5E5E5]"
                    >
                      {comp.name}
                      <span className="text-[#555555]">— {comp.percentage}%</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {dimRows.length > 0 && (
              <div>
                <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#555555] uppercase tracking-wider mb-2">
                  Dimensions
                </p>
                <div className="flex flex-wrap gap-2">
                  {dimRows.map((d) => (
                    <span
                      key={d.label}
                      className="inline-flex items-center gap-1 text-xs bg-[#F5F5F5] text-[#555555] px-2.5 py-1 rounded-full font-[family-name:var(--font-roboto)] border border-[#E5E5E5]"
                    >
                      {d.label}
                      <span className="text-[#999999]">— {d.value} mm</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Options de commande */}
          {selected.saleOptions.length > 0 && (
            <div className="border-t border-[#F5F5F5] pt-5 space-y-3">
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#555555] uppercase tracking-wider">
                Options de commande — {selected.name}
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
                    className="bg-white border border-[#E5E5E5] rounded-xl px-4 py-4 space-y-3 hover:border-[#1A1A1A] transition-colors"
                  >
                    {/* Libellé + prix */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[#1A1A1A] font-[family-name:var(--font-roboto)] flex items-center flex-wrap gap-1.5">
                          {opt.saleType === "UNIT" ? "À l'unité" : `Par paquet de ${opt.packQuantity}`}
                          {opt.size && (
                            <span className="text-xs font-normal bg-[#F5F5F5] text-[#333333] px-2 py-0.5 rounded-full border border-[#E5E5E5]">
                              Taille {opt.size}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-[#999999] mt-0.5 font-[family-name:var(--font-roboto)]">
                          {effectiveStock > 0
                            ? <span className="text-[#555555]">✓ {effectiveStock} disponible{effectiveStock !== 1 ? "s" : ""}</span>
                            : <span className="text-[#1A1A1A]">Rupture de stock</span>
                          }
                          {" · "}{selected.weight} kg / unité
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {hasDiscount && (
                          <p className="text-xs text-[#999999] line-through">{basePrice.toFixed(2)} €</p>
                        )}
                        <p className={`font-[family-name:var(--font-poppins)] font-semibold text-lg ${hasDiscount ? "text-[#555555]" : "text-[#1A1A1A]"}`}>
                          {price.toFixed(2)} €
                        </p>
                        {qty > 1 && (
                          <p className="text-xs text-[#999999] font-[family-name:var(--font-roboto)]">
                            = {(price * qty).toFixed(2)} € total
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Quantité + panier */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center border border-[#E5E5E5] rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setQuantities((q) => ({ ...q, [opt.id]: Math.max(1, (q[opt.id] ?? 1) - 1) }))}
                          className="w-8 h-9 flex items-center justify-center text-[#555555] hover:bg-[#F5F5F5] transition-colors text-base"
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
                          className="w-12 h-9 text-center text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] border-x border-[#E5E5E5] focus:outline-none bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setQuantities((q) => ({ ...q, [opt.id]: (q[opt.id] ?? 1) + 1 }))}
                          className="w-8 h-9 flex items-center justify-center text-[#555555] hover:bg-[#F5F5F5] transition-colors text-base"
                        >+</button>
                      </div>
                      <button
                        type="button"
                        disabled={effectiveStock === 0 || isPending}
                        onClick={() => handleAddToCart(opt.id, qty)}
                        className="flex-1 h-9 text-white text-xs font-[family-name:var(--font-poppins)] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 rounded-lg shadow-[0_1px_3px_rgba(26,26,26,0.25)] bg-[#1A1A1A] hover:bg-[#333333]"
                        style={addedOptId === opt.id ? { backgroundColor: "#555555" } : undefined}
                      >
                        {addedOptId === opt.id ? (
                          <>
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Ajouté !
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                            </svg>
                            Ajouter au panier
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

      {/* ── Produits similaires ──────────────────────────────────────── */}
      {similarProducts.length > 0 && (
        <section className="mt-16 border-t border-[#E5E5E5] pt-12">
          <h2 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#1A1A1A] mb-6 section-title">
            Produits similaires
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
          className="fixed inset-0 z-50 bg-[#1A1A1A]/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setZoomedSrc(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedSrc}
            alt="Aperçu"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] object-contain shadow-2xl rounded-2xl"
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
