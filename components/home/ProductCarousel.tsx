"use client";

import { useRef } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";
import ProductCard from "@/components/produits/ProductCard";

interface VariantData {
  id: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizes: { name: string; quantity: number }[];
  unitPrice: number;
  stock: number;
}

interface ColorData {
  groupKey: string;
  colorId: string;
  hex: string | null;
  patternImage?: string | null;
  name: string;
  firstImage: string | null;
  unitPrice: number;
  isPrimary: boolean;
  totalStock: number;
  variants: VariantData[];
}

export interface CarouselProduct {
  id: string;
  name: string;
  reference: string;
  category: string;
  subCategory: string | null;
  colors: ColorData[];
  tags: { id: string; name: string }[];
  isBestSeller: boolean;
  isNew: boolean;
  discountPercent: number | null;
  hasAutoPromotion?: boolean;
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
  favoriteIds?: string[];
}

export default function ProductCarousel({
  title,
  eyebrow,
  products,
  viewMoreHref,
  viewMoreLabel = "Voir plus",
  variant = "white",
  size = "standard",
  clientDiscount,
  favoriteIds,
}: Props) {
  const tCommon = useTranslations("common");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRef = useScrollReveal();

  const isPremium = size === "premium";
  const cardWidth = isPremium ? "w-[280px] sm:w-[320px]" : "w-[240px] sm:w-[280px]";
  const scrollAmount = isPremium ? 344 : 304;
  const favSet = favoriteIds ? new Set(favoriteIds) : null;

  function scroll(dir: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? scrollAmount : -scrollAmount, behavior: "smooth" });
  }

  if (products.length === 0) return null;

  return (
    <section
      ref={sectionRef}
      className={`scroll-fade-up py-20 lg:py-24 ${variant === "gray" ? "bg-bg-secondary" : "bg-bg-primary"}`}
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* Header éditorial sobre */}
        <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
          <div>
            {eyebrow && (
              <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-2">
                {eyebrow}
              </p>
            )}
            <h2
              className="font-heading font-bold text-text-primary"
              style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)", letterSpacing: "-0.02em" }}
            >
              {title}
            </h2>
          </div>
          <Link
            href={viewMoreHref}
            className="hidden sm:inline-flex items-center gap-2 text-sm font-heading font-medium text-text-primary border-b border-text-primary pb-1 hover:gap-3 transition-all"
          >
            {viewMoreLabel} <span aria-hidden>→</span>
          </Link>
        </div>

        <div className="relative">
          <button
            onClick={() => scroll("left")}
            className="hidden sm:flex items-center justify-center rounded-full w-9 h-9 bg-bg-darker text-white hover:bg-gold hover:text-bg-darker transition-colors absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 shadow-md"
            aria-label={tCommon("previous")}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>

          <button
            onClick={() => scroll("right")}
            className="hidden sm:flex items-center justify-center rounded-full w-9 h-9 bg-bg-darker text-white hover:bg-gold hover:text-bg-darker transition-colors absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 shadow-md"
            aria-label={tCommon("next")}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>

          <div
            ref={scrollRef}
            className="flex items-stretch gap-5 overflow-x-auto pb-2 scroll-smooth no-scrollbar snap-x snap-mandatory"
          >
            {products.map((p) => (
              <div key={p.id} className={`snap-start h-full shrink-0 ${cardWidth}`}>
                <ProductCard
                  id={p.id}
                  name={p.name}
                  reference={p.reference}
                  category={p.category}
                  subCategory={p.subCategory}
                  colors={p.colors}
                  tags={p.tags}
                  isBestSeller={p.isBestSeller}
                  isNew={p.isNew}
                  discountPercent={p.discountPercent}
                  hasAutoPromotion={p.hasAutoPromotion ?? false}
                  clientDiscount={clientDiscount}
                  isFavorite={favSet?.has(p.id) ?? false}
                  hideStatusBadges
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
