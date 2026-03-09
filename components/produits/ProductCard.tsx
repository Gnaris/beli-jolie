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

  const displayed   = hoveredColor ?? primaryColor;
  const image       = displayed?.firstImage;
  const maxPrice    = Math.max(...colors.map((c) => c.unitPrice));

  return (
    <Link
      href={`/produits/${id}`}
      className="group block bg-white border border-[#E2E8F0] hover:border-[#0F3460] transition-colors overflow-hidden"
    >
      {/* Image */}
      <div className="aspect-square bg-[#F1F5F9] relative overflow-hidden">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-12 h-12 text-[#94A3B8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
          </div>
        )}

        {/* Badge référence */}
        <span className="absolute top-2 left-2 bg-[#0F172A]/70 text-white text-[10px] font-mono px-1.5 py-0.5">
          {reference}
        </span>
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
                onClick={(e) => e.preventDefault()} // Laisse le Link gérer la navigation
                className={`w-5 h-5 rounded-full border-2 transition-all ${
                  (hoveredColor?.id ?? primaryColor?.id) === c.id
                    ? "border-[#0F3460] scale-110"
                    : "border-[#E2E8F0]"
                }`}
                style={{ backgroundColor: c.hex ?? "#94A3B8" }}
              />
            ))}
          </div>
        )}

        {/* Nom */}
        <p className="font-[family-name:var(--font-poppins)] font-semibold text-sm text-[#0F172A] line-clamp-2 leading-snug">
          {name}
        </p>

        {/* Catégorie */}
        <p className="text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)]">
          {category}{subCategory && <> · {subCategory}</>}
        </p>

        {/* Prix */}
        <p className="font-[family-name:var(--font-poppins)] font-semibold text-[#0F3460]">
          {maxPrice.toFixed(2)} €
          <span className="text-[10px] text-[#94A3B8] font-normal font-[family-name:var(--font-roboto)] ml-1">/ unité</span>
        </p>
      </div>
    </Link>
  );
}
