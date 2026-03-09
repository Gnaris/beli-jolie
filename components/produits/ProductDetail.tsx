"use client";

import { useState } from "react";
import Link from "next/link";

interface SaleOptionData {
  id: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
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
  subCategory: string | null;
  colors: ColorData[];
  compositions: CompositionData[];
  similarProducts: RelatedProduct[];
  references: RelatedProduct[];
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
      className="group block bg-white border border-[#E2E8F0] hover:border-[#0F3460] transition-colors"
    >
      <div className="aspect-square bg-[#F1F5F9] overflow-hidden">
        {product.primaryImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.primaryImage}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-[#94A3B8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-xs font-mono text-[#94A3B8]">{product.reference}</p>
        <p className="text-sm font-medium text-[#0F172A] font-[family-name:var(--font-roboto)] mt-0.5 line-clamp-2">
          {product.name}
        </p>
        <p className="text-sm font-[family-name:var(--font-poppins)] font-semibold text-[#0F3460] mt-1">
          {product.minPrice.toFixed(2)} €
        </p>
      </div>
    </Link>
  );
}

export default function ProductDetail({
  name, reference, description, category, subCategory, colors,
  compositions, similarProducts, references,
}: ProductDetailProps) {
  const primaryColor = colors.find((c) => c.isPrimary) ?? colors[0];
  const [selected, setSelected]           = useState<ColorData>(primaryColor);
  const [hoveredColor, setHoveredColor]   = useState<ColorData | null>(null);
  const [activeImageIdx, setActiveImageIdx]   = useState(0);
  const [hoveredImageIdx, setHoveredImageIdx] = useState<number | null>(null);
  const [zoomedSrc, setZoomedSrc]         = useState<string | null>(null);

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

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">

        {/* ── Image principale + thumbnails ────────────────────────────── */}
        <div className="space-y-4">
          {/* Image principale */}
          <div
            className="aspect-square bg-[#F1F5F9] overflow-hidden relative cursor-zoom-in"
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
                <svg className="w-16 h-16 text-[#94A3B8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                    d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                </svg>
              </div>
            )}
            {displayedImage && (
              <div className="absolute bottom-2 right-2 bg-black/40 text-white p-1 rounded">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
                </svg>
              </div>
            )}
          </div>

          {/* Thumbnails */}
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
                  className={`w-16 h-16 object-cover border-2 cursor-pointer transition-colors shrink-0 ${
                    activeImageIdx === i
                      ? "border-[#0F3460]"
                      : "border-[#E2E8F0] hover:border-[#94A3B8]"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Infos produit ────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Référence */}
          <span className="font-mono text-xs bg-[#F1F5F9] px-2 py-1 text-[#475569]">
            {reference}
          </span>

          {/* Prix */}
          <div>
            <p className="font-[family-name:var(--font-poppins)] text-3xl font-semibold text-[#0F3460]">
              {maxPrice.toFixed(2)} €
              <span className="text-sm text-[#94A3B8] font-normal ml-1">/ unité</span>
            </p>
          </div>

          {/* Nom */}
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#0F172A] leading-snug">
            {name}
          </h1>

          {/* Color picker */}
          {colors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#475569] uppercase tracking-wider">
                Couleur — <span className="font-normal text-[#0F172A]">{displayed.name}</span>
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
                        ? "border-[#0F3460] scale-110 shadow-md"
                        : "border-[#E2E8F0] hover:border-[#94A3B8] hover:scale-105"
                    }`}
                    style={{ backgroundColor: c.hex ?? "#94A3B8" }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Catégorie */}
          <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#94A3B8]">
            <span>{category}</span>
            {subCategory && <><span>/</span><span>{subCategory}</span></>}
          </div>

          {/* Description + Composition */}
          <div className="border-t border-[#F1F5F9] pt-4 space-y-4">
            <div>
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#475569] uppercase tracking-wider mb-2">
                Description
              </p>
              <p className="text-sm text-[#0F172A] font-[family-name:var(--font-roboto)] leading-relaxed">
                {description}
              </p>
            </div>

            {compositions.length > 0 && (
              <div>
                <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#475569] uppercase tracking-wider mb-2">
                  Composition
                </p>
                <div className="flex flex-wrap gap-2">
                  {compositions.map((comp) => (
                    <span
                      key={comp.name}
                      className="inline-flex items-center gap-1 text-xs bg-[#F1F5F9] text-[#475569] px-2.5 py-1 font-[family-name:var(--font-roboto)]"
                    >
                      {comp.name}
                      <span className="text-[#94A3B8]">— {comp.percentage}%</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Options de vente */}
          {selected.saleOptions.length > 0 && (
            <div className="border-t border-[#F1F5F9] pt-4 space-y-3">
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#475569] uppercase tracking-wider">
                Options de commande — {selected.name}
              </p>
              {selected.saleOptions.map((opt) => {
                const price     = computePrice(selected.unitPrice, opt);
                const basePrice = opt.saleType === "UNIT"
                  ? selected.unitPrice
                  : selected.unitPrice * (opt.packQuantity ?? 1);
                const hasDiscount = price < basePrice;
                // Stock effectif : pour un paquet, si stock < qté → stock paquet = 0
                const effectiveStock = opt.saleType === "PACK" && opt.packQuantity
                  ? Math.floor(selected.stock / opt.packQuantity)
                  : selected.stock;
                return (
                  <div
                    key={opt.id}
                    className="flex items-center justify-between bg-[#FFFFFF] border border-[#F1F5F9] px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-[#0F172A] font-[family-name:var(--font-roboto)]">
                        {opt.saleType === "UNIT"
                          ? "À l'unité"
                          : `Par paquet de ${opt.packQuantity}`}
                      </p>
                      <p className="text-xs text-[#94A3B8]">
                        Stock : {effectiveStock} disponible{effectiveStock > 1 ? "s" : ""}
                        {" · "}{selected.weight} kg / unité
                      </p>
                    </div>
                    <div className="text-right">
                      {hasDiscount && (
                        <p className="text-xs text-[#94A3B8] line-through">{basePrice.toFixed(2)} €</p>
                      )}
                      <p className={`font-[family-name:var(--font-poppins)] font-semibold ${hasDiscount ? "text-emerald-600" : "text-[#0F172A]"}`}>
                        {price.toFixed(2)} €
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Produits similaires ──────────────────────────────────────────── */}
      {similarProducts.length > 0 && (
        <section className="mt-16 border-t border-[#E2E8F0] pt-12">
          <h2 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#0F172A] mb-6">
            Produits similaires
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {similarProducts.map((p) => (
              <RelatedCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* ── Produit dans ces références ─────────────────────────────────── */}
      {references.length > 0 && (
        <section className="mt-16 border-t border-[#E2E8F0] pt-12">
          <h2 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#0F172A] mb-6">
            Ce produit fait partie de ces références
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {references.map((p) => (
              <RelatedCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* Lightbox */}
      {zoomedSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setZoomedSrc(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedSrc}
            alt="Aperçu"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] object-contain shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setZoomedSrc(null)}
            className="absolute top-4 right-4 w-9 h-9 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
