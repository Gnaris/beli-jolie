"use client";

import { useState } from "react";

interface SaleOptionData {
  id: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  stock: number;
  discountType:  "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}

interface ColorData {
  id: string;
  name: string;
  hex: string | null;
  unitPrice: number;
  weight: number;
  isPrimary: boolean;
  images: { path: string; order: number }[];
  saleOptions: SaleOptionData[];
}

interface ProductDetailProps {
  name: string;
  reference: string;
  description: string;
  composition: string;
  category: string;
  subCategory: string | null;
  colors: ColorData[];
}

function computePrice(unitPrice: number, opt: SaleOptionData): number {
  const total = opt.saleType === "UNIT" ? unitPrice : unitPrice * (opt.packQuantity ?? 1);
  if (!opt.discountType || !opt.discountValue) return total;
  if (opt.discountType === "PERCENT") return Math.max(0, total * (1 - opt.discountValue / 100));
  return Math.max(0, total - opt.discountValue);
}

export default function ProductDetail({
  name, reference, description, composition, category, subCategory, colors,
}: ProductDetailProps) {
  const primaryColor   = colors.find((c) => c.isPrimary) ?? colors[0];
  const [selected, setSelected]   = useState<ColorData>(primaryColor);
  const [hovered, setHovered]     = useState<ColorData | null>(null);
  const [zoomedSrc, setZoomedSrc] = useState<string | null>(null);

  const displayed     = hovered ?? selected;
  const displayedImage = displayed.images[0]?.path ?? null;
  const maxPrice      = Math.max(...colors.map((c) => c.unitPrice));

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">

        {/* ── Image principale + swatches ─────────────────────────────── */}
        <div className="space-y-4">
          {/* Image principale */}
          <div
            className="aspect-square bg-[#EDE8DF] overflow-hidden relative cursor-zoom-in"
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
                <svg className="w-16 h-16 text-[#B8A48A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  onClick={() => setZoomedSrc(img.path)}
                  className="w-16 h-16 object-cover border border-[#D4CCBE] cursor-zoom-in hover:border-[#8B7355] transition-colors shrink-0"
                />
              ))}
            </div>
          )}

        </div>

        {/* ── Infos produit ────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Référence */}
          <span className="font-mono text-xs bg-[#EDE8DF] px-2 py-1 text-[#6B5B45]">
            {reference}
          </span>

          {/* Prix (le plus élevé de tous les variants) */}
          <div>
            <p className="font-[family-name:var(--font-poppins)] text-3xl font-semibold text-[#8B7355]">
              {maxPrice.toFixed(2)} €
              <span className="text-sm text-[#B8A48A] font-normal ml-1">/ unité</span>
            </p>
          </div>

          {/* Nom */}
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#2C2418] leading-snug">
            {name}
          </h1>

          {/* Color picker */}
          {colors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider">
                Couleur — <span className="font-normal text-[#2C2418]">{displayed.name}</span>
              </p>
              <div className="flex gap-2.5 flex-wrap">
                {colors.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={c.name}
                    onMouseEnter={() => setHovered(c)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => setSelected(c)}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      selected.id === c.id
                        ? "border-[#8B7355] scale-110 shadow-md"
                        : "border-[#D4CCBE] hover:border-[#B8A48A] hover:scale-105"
                    }`}
                    style={{ backgroundColor: c.hex ?? "#B8A48A" }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Catégorie */}
          <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#B8A48A]">
            <span>{category}</span>
            {subCategory && <><span>/</span><span>{subCategory}</span></>}
          </div>

          {/* Description */}
          <div className="border-t border-[#EDE8DF] pt-4 space-y-4">
            <div>
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider mb-2">
                Description
              </p>
              <p className="text-sm text-[#2C2418] font-[family-name:var(--font-roboto)] leading-relaxed">
                {description}
              </p>
            </div>
            <div>
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider mb-2">
                Composition
              </p>
              <p className="text-sm text-[#2C2418] font-[family-name:var(--font-roboto)] leading-relaxed">
                {composition}
              </p>
            </div>
          </div>

          {/* Options de vente de la couleur sélectionnée */}
          {selected.saleOptions.length > 0 && (
            <div className="border-t border-[#EDE8DF] pt-4 space-y-3">
              <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider">
                Options de commande — {selected.name}
              </p>
              {selected.saleOptions.map((opt) => {
                const price    = computePrice(selected.unitPrice, opt);
                const basePrice = opt.saleType === "UNIT"
                  ? selected.unitPrice
                  : selected.unitPrice * (opt.packQuantity ?? 1);
                const hasDiscount = price < basePrice;
                return (
                  <div
                    key={opt.id}
                    className="flex items-center justify-between bg-[#FDFAF6] border border-[#EDE8DF] px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-[#2C2418] font-[family-name:var(--font-roboto)]">
                        {opt.saleType === "UNIT"
                          ? "À l'unité"
                          : `Par paquet de ${opt.packQuantity}`}
                      </p>
                      <p className="text-xs text-[#B8A48A]">
                        Stock : {opt.stock} disponible{opt.stock > 1 ? "s" : ""}
                        {" · "}{selected.weight} kg / unité
                      </p>
                    </div>
                    <div className="text-right">
                      {hasDiscount && (
                        <p className="text-xs text-[#B8A48A] line-through">{basePrice.toFixed(2)} €</p>
                      )}
                      <p className={`font-[family-name:var(--font-poppins)] font-semibold ${hasDiscount ? "text-emerald-600" : "text-[#2C2418]"}`}>
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
