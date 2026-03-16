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
  variant?: "white" | "gray";
}

function CarouselCard({ product }: { product: CarouselProduct }) {
  const primaryColor =
    product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  const image = primaryColor?.firstImage;
  const minPrice = Math.min(...product.colors.map((c) => c.unitPrice));

  return (
    <article className="group shrink-0 w-52 sm:w-60 card card-hover overflow-hidden flex flex-col">
      <Link href={`/produits/${product.id}`} className="block">
        {/* Image */}
        <div className="aspect-square bg-bg-secondary relative overflow-hidden">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={product.name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg
                className="w-10 h-10 text-text-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z"
                />
              </svg>
            </div>
          )}
          {/* Ref badge */}
          <span className="absolute top-2.5 left-2.5 bg-bg-primary text-text-muted text-[10px] font-mono px-2 py-0.5 rounded-full border border-border">
            {product.reference}
          </span>
          {/* Coloris badge */}
          {product.colors.length > 1 && (
            <span className="absolute top-2.5 right-2.5 bg-bg-primary text-text-muted text-[10px] font-[family-name:var(--font-roboto)] px-2 py-0.5 rounded-full border border-border">
              {product.colors.length} coloris
            </span>
          )}
        </div>
      </Link>

      {/* Info */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        {/* Color swatches */}
        {product.colors.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {product.colors.slice(0, 6).map((c) => (
              <span
                key={c.id}
                title={c.name}
                className="w-[18px] h-[18px] rounded-full border border-border"
                style={{ backgroundColor: c.hex ?? "#9CA3AF" }}
              />
            ))}
          </div>
        )}

        <Link href={`/produits/${product.id}`}>
          <p className="font-[family-name:var(--font-roboto)] font-semibold text-sm text-text-primary line-clamp-2 leading-snug hover:text-text-secondary transition-colors">
            {product.name}
          </p>
        </Link>

        <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
          {product.category}
        </p>

        <div className="flex items-baseline gap-1 mt-auto">
          <span className="font-[family-name:var(--font-poppins)] font-semibold text-base text-text-primary">
            {minPrice.toFixed(2)} &euro;
          </span>
          <span className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
            / unite
          </span>
        </div>
      </div>
    </article>
  );
}

export default function ProductCarousel({
  title,
  products,
  viewMoreHref,
  viewMoreLabel = "Voir plus",
  variant = "white",
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function scroll(dir: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? 280 : -280, behavior: "smooth" });
  }

  if (products.length === 0) return null;

  return (
    <section
      className={`py-12 ${variant === "gray" ? "bg-bg-secondary" : "bg-bg-primary"}`}
    >
      <div className="container-site">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-text-primary">
              {title}
            </h2>
            <div className="h-px w-12 bg-border mt-2" />
          </div>
          <div className="flex items-center gap-2">
            {/* Scroll buttons */}
            <button
              onClick={() => scroll("left")}
              className="p-1.5 rounded-full border border-border bg-bg-primary hover:bg-bg-dark hover:border-bg-dark hover:text-text-inverse text-text-secondary transition-colors"
              aria-label="Precedent"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </button>
            <button
              onClick={() => scroll("right")}
              className="p-1.5 rounded-full border border-border bg-bg-primary hover:bg-bg-dark hover:border-bg-dark hover:text-text-inverse text-text-secondary transition-colors"
              aria-label="Suivant"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
              </svg>
            </button>
            <Link
              href={viewMoreHref}
              className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors font-[family-name:var(--font-roboto)] ml-1"
            >
              {viewMoreLabel} &rarr;
            </Link>
          </div>
        </div>

        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-2 scroll-smooth no-scrollbar"
        >
          {products.map((p) => (
            <CarouselCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  );
}
