"use client";

import { useState } from "react";
import Link from "next/link";

interface ColorData {
  id: string;
  hex: string | null;
  name: string;
  firstImage: string | null;
  unitPrice: number;
  isPrimary: boolean;
}

interface ProductCardProps {
  id: string;
  name: string;
  reference: string;
  category: string;
  subCategory: string | null;
  colors: ColorData[];
}

export default function ProductCard({
  id, name, reference, category, subCategory, colors,
}: ProductCardProps) {
  const primaryColor = colors.find((c) => c.isPrimary) ?? colors[0];
  const [hoveredColor, setHoveredColor] = useState<ColorData | null>(null);

  const displayed = hoveredColor ?? primaryColor;
  const image     = displayed?.firstImage;
  const minPrice  = Math.min(...colors.map((c) => c.unitPrice));

  return (
    <Link
      href={`/produits/${id}`}
      className="group block bg-white border border-[#E5E5E5] rounded-lg overflow-hidden transition-shadow duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)]"
    >
      {/* Image */}
      <div className="aspect-square bg-[#F5F5F5] relative overflow-hidden">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-103"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-[#CCCCCC]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          </div>
        )}

        {/* Badge référence */}
        <span className="absolute top-2 left-2 bg-white text-[#555555] text-[10px] font-mono px-2 py-0.5 rounded border border-[#E5E5E5]">
          {reference}
        </span>

        {/* Badge couleurs */}
        {colors.length > 1 && (
          <span className="absolute top-2 right-2 bg-white text-[#555555] text-[10px] font-[family-name:var(--font-roboto)] px-2 py-0.5 rounded border border-[#E5E5E5]">
            {colors.length} coloris
          </span>
        )}
      </div>

      {/* Infos */}
      <div className="p-3 space-y-2">
        {/* Swatches couleur */}
        {colors.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {colors.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.name}
                onMouseEnter={() => setHoveredColor(c)}
                onMouseLeave={() => setHoveredColor(null)}
                onClick={(e) => e.preventDefault()}
                className={`w-4 h-4 rounded-full border-2 transition-all duration-100 ${
                  (hoveredColor?.id ?? primaryColor?.id) === c.id
                    ? "border-[#1A1A1A] scale-110"
                    : "border-[#E5E5E5] hover:border-[#999999]"
                }`}
                style={{ backgroundColor: c.hex ?? "#CCCCCC" }}
              />
            ))}
          </div>
        )}

        {/* Nom */}
        <p className="font-[family-name:var(--font-roboto)] font-medium text-sm text-[#1A1A1A] line-clamp-2 leading-snug">
          {name}
        </p>

        {/* Catégorie */}
        <p className="text-xs text-[#999999] font-[family-name:var(--font-roboto)]">
          {category}{subCategory && <> · {subCategory}</>}
        </p>

        {/* Prix */}
        <div className="flex items-baseline gap-1 pt-0.5">
          <p className="font-[family-name:var(--font-roboto)] font-semibold text-sm text-[#1A1A1A]">
            {minPrice.toFixed(2)} €
          </p>
          <span className="text-[10px] text-[#999999] font-[family-name:var(--font-roboto)]">/ unité</span>
        </div>
      </div>
    </Link>
  );
}
