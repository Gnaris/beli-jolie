"use client";

import { useRef } from "react";
import Link from "next/link";

interface ColorData {
  id: string;
  hex: string | null;
  name: string;
  firstImage: string | null;
  unitPrice: number;
  isPrimary: boolean;
}

export interface CarouselProduct {
  id: string;
  name: string;
  reference: string;
  category: string;
  colors: ColorData[];
}

interface Props {
  title: string;
  products: CarouselProduct[];
  viewMoreHref: string;
  viewMoreLabel?: string;
}

function CarouselCard({ product }: { product: CarouselProduct }) {
  const primaryColor = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  const image        = primaryColor?.firstImage;
  const minPrice     = Math.min(...product.colors.map((c) => c.unitPrice));

  return (
    <Link
      href={`/produits/${product.id}`}
      className="group shrink-0 w-44 sm:w-52 block bg-white border border-[#E5E5E5] rounded-lg overflow-hidden hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow"
    >
      {/* Image */}
      <div className="aspect-square bg-[#F5F5F5] relative overflow-hidden">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={product.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-8 h-8 text-[#CCCCCC]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
            </svg>
          </div>
        )}

        {/* Ref badge */}
        <span className="absolute top-2 left-2 bg-white text-[#555555] text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#E5E5E5]">
          {product.reference}
        </span>
      </div>

      {/* Info */}
      <div className="p-2.5 space-y-1.5">
        <p className="text-xs font-medium text-[#1A1A1A] line-clamp-2 leading-snug font-[family-name:var(--font-roboto)]">
          {product.name}
        </p>
        <p className="text-[10px] text-[#999999] font-[family-name:var(--font-roboto)]">
          {product.category}
        </p>
        <p className="text-xs font-semibold text-[#1A1A1A] font-[family-name:var(--font-roboto)]">
          {minPrice.toFixed(2)} €
          <span className="font-normal text-[#999999] ml-1">/ u.</span>
        </p>
      </div>
    </Link>
  );
}

export default function ProductCarousel({ title, products, viewMoreHref, viewMoreLabel = "Voir plus" }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function scroll(dir: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? 240 : -240, behavior: "smooth" });
  }

  if (products.length === 0) return null;

  return (
    <section className="py-8">
      <div className="container-site">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#1A1A1A]">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            {/* Scroll buttons */}
            <button
              onClick={() => scroll("left")}
              className="p-1.5 rounded-full border border-[#E5E5E5] bg-white hover:bg-[#F5F5F5] text-[#1A1A1A] transition-colors"
              aria-label="Précédent"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button
              onClick={() => scroll("right")}
              className="p-1.5 rounded-full border border-[#E5E5E5] bg-white hover:bg-[#F5F5F5] text-[#1A1A1A] transition-colors"
              aria-label="Suivant"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
            <Link
              href={viewMoreHref}
              className="text-sm font-medium text-[#1A1A1A] hover:underline font-[family-name:var(--font-roboto)] ml-1"
            >
              {viewMoreLabel} →
            </Link>
          </div>
        </div>

        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-2 scroll-smooth"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {products.map((p) => (
            <CarouselCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  );
}
