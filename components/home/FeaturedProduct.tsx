"use client";

import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import type { CarouselProduct, ClientDiscountInfo } from "./ProductCarousel";
import { buildProductHandle } from "@/lib/product-url";

interface Props {
  products: CarouselProduct[];
  clientDiscount?: ClientDiscountInfo | null;
  shopName: string;
}

function getProductImage(product: CarouselProduct): string | null {
  const primary = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  return primary?.firstImage ?? null;
}

function getBadge(product: CarouselProduct): { label: string; className: string } | null {
  if (product.isBestSeller) return { label: "Best", className: "bg-gold text-bg-darker" };
  if (product.discountPercent) return { label: `-${Math.round(product.discountPercent)}%`, className: "bg-white text-bg-darker" };
  if (product.isNew) return { label: "Nouveau", className: "bg-white text-bg-darker" };
  return null;
}

function ProductTile({ product, offsetTop = false }: { product: CarouselProduct; offsetTop?: boolean }) {
  const { tp, tc } = useProductTranslation();
  const image = getProductImage(product);
  const badge = getBadge(product);
  const primaryColor = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  const price = primaryColor?.unitPrice ?? 0;

  return (
    <Link
      href={`/produits/${buildProductHandle(product.name, product.reference)}`}
      className={`group block ${offsetTop ? "sm:mt-8" : ""}`}
    >
      <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-bg-darker">
        {badge && (
          <span className={`absolute top-3 left-3 z-10 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.className}`}>
            {badge.label}
          </span>
        )}
        {image ? (
          <Image
            src={image}
            alt={product.name}
            fill
            sizes="(min-width: 1024px) 22vw, 100vw"
            className="object-cover transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-white/15">
            <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted">{tc(product.category)}</p>
        <p className="font-heading font-semibold text-text-primary mt-0.5 line-clamp-1">{tp(product.name)}</p>
        <p className="text-text-primary mt-1">
          <span className="font-bold">{price.toFixed(2).replace(".", ",")} €</span>
          <span className="text-text-muted text-sm ml-1">/ unité</span>
        </p>
      </div>
    </Link>
  );
}

export default function FeaturedProduct({ products }: Props) {
  const t = useTranslations("home");
  const sectionRef = useScrollReveal();

  if (products.length < 3) return null;
  const [p1, p2, p3] = products;

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-primary py-20 lg:py-28">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 grid lg:grid-cols-12 gap-10">
        {/* Colonne texte "manifeste" */}
        <div className="lg:col-span-4 lg:sticky lg:top-24 self-start">
          <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-4">{t("featuredEyebrow")}</p>
          <h2
            className="font-heading font-bold text-text-primary leading-[1]"
            style={{ fontSize: "clamp(2rem, 3.5vw, 3rem)", letterSpacing: "-0.02em" }}
          >
            {t("featuredHeading")}
          </h2>
          <p className="mt-5 text-text-secondary text-[15px] leading-relaxed">
            {t("featuredBody2")}
          </p>
          <Link
            href="/produits"
            className="mt-6 inline-flex items-center gap-2 text-sm font-heading font-medium text-text-primary border-b border-text-primary pb-1 hover:gap-3 transition-all"
          >
            {t("featuredCta")} <span aria-hidden>→</span>
          </Link>
        </div>

        {/* 3 produits */}
        <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ProductTile product={p1} />
          <ProductTile product={p2} offsetTop />
          <ProductTile product={p3} />
        </div>
      </div>
    </section>
  );
}
