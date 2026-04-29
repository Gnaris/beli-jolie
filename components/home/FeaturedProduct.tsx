"use client";

import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import type { CarouselProduct, ClientDiscountInfo } from "./ProductCarousel";

interface Props {
  products: CarouselProduct[];
  clientDiscount?: ClientDiscountInfo | null;
}

function applyClientDiscount(price: number, discount: ClientDiscountInfo | null | undefined): number {
  if (!discount) return price;
  if (discount.discountType === "PERCENT") return Math.max(0, price * (1 - discount.discountValue / 100));
  return Math.max(0, price - discount.discountValue);
}

function getProductImage(product: CarouselProduct): string | null {
  const primary = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  return primary?.firstImage ?? null;
}

function getMinPrice(product: CarouselProduct, clientDiscount?: ClientDiscountInfo | null) {
  const minBase = Math.min(...product.colors.map((c) => c.unitPrice));
  const minDiscounted = Math.min(...product.colors.map((c) => c.discountedPrice ?? c.unitPrice));
  const hasProductDiscount = minDiscounted < minBase;
  const finalPrice = applyClientDiscount(minDiscounted, clientDiscount);
  const hasAnyDiscount = hasProductDiscount || (!!clientDiscount && finalPrice < minDiscounted);
  return { minBase, minDiscounted, finalPrice, hasAnyDiscount };
}

function CompactCard({ product, clientDiscount }: { product: CarouselProduct; clientDiscount?: ClientDiscountInfo | null }) {
  const { tp, tc } = useProductTranslation();
  const image = getProductImage(product);
  const { finalPrice, hasAnyDiscount, minBase } = getMinPrice(product, clientDiscount);
  const tProduct = useTranslations("product");

  return (
    <Link href={`/produits/${product.id}`} className="group block">
      <article className="bg-bg-primary rounded-xl border border-border overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
        <div className="aspect-square relative overflow-hidden bg-bg-secondary">
          {image ? (
            <Image src={image} alt={product.name} fill sizes="280px" className="object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
              </svg>
            </div>
          )}
        </div>
        <div className="p-3">
          <p className="font-body font-medium text-sm text-text-primary line-clamp-1">{tp(product.name)}</p>
          <p className="text-xs text-text-muted font-body mt-0.5">{tc(product.category)}</p>
          <div className="flex items-baseline gap-1.5 mt-1.5">
            {hasAnyDiscount && <span className="text-xs text-text-muted line-through font-body">{minBase.toFixed(2)} &euro;</span>}
            <span className={`font-heading font-semibold text-sm ${hasAnyDiscount ? "text-[#EF4444]" : "text-text-primary"}`}>{finalPrice.toFixed(2)} &euro;</span>
            <span className="text-[10px] text-text-muted font-body">{tProduct("htUnit")}</span>
          </div>
        </div>
      </article>
    </Link>
  );
}

export default function FeaturedProduct({ products, clientDiscount }: Props) {
  const t = useTranslations("home");
  const { tp, tc } = useProductTranslation();
  const tProduct = useTranslations("product");
  const sectionRef = useScrollReveal();

  if (products.length === 0) return null;

  const hero = products[0];
  const companions = products.slice(1, 3);
  const heroImage = getProductImage(hero);
  const { finalPrice, hasAnyDiscount, minBase } = getMinPrice(hero, clientDiscount);

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-primary py-16 lg:py-20">
      <div className="container-site" style={{ maxWidth: "1200px" }}>
        {/* Editorial header */}
        <div className="flex items-center gap-4 justify-center mb-10">
          <div className="h-px flex-1 max-w-[80px] bg-border" />
          <h2 className="font-heading text-lg font-semibold text-text-primary tracking-wide uppercase">{t("featuredTitle")}</h2>
          <div className="h-px flex-1 max-w-[80px] bg-border" />
        </div>

        {/* Asymmetric grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Hero product */}
          <Link href={`/produits/${hero.id}`} className="lg:col-span-3 group block">
            <article className="relative rounded-2xl overflow-hidden shadow-md">
              <div className="aspect-[3/4] relative bg-bg-secondary">
                {heroImage ? (
                  <Image src={heroImage} alt={hero.name} fill sizes="(min-width: 1024px) 60vw, 100vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" priority />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-bg-secondary">
                    <svg className="w-16 h-16 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                    </svg>
                  </div>
                )}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-5">
                  <p className="font-heading font-semibold text-white text-lg">{tp(hero.name)}</p>
                  <p className="font-body text-white/70 text-sm mt-0.5">{tc(hero.category)}</p>
                  <div className="flex items-baseline gap-2 mt-1.5">
                    {hasAnyDiscount && <span className="text-sm text-white/50 line-through">{minBase.toFixed(2)} &euro;</span>}
                    <span className={`font-heading font-bold text-lg ${hasAnyDiscount ? "text-[#EF4444]" : "text-white"}`}>{finalPrice.toFixed(2)} &euro;</span>
                    <span className="text-xs text-white/50">{tProduct("htUnit")}</span>
                  </div>
                  {hero.colors.length > 1 && (
                    <div className="flex gap-1.5 mt-2">
                      {hero.colors.slice(0, 6).map((c) => (
                        <span key={c.id} className="w-4 h-4 rounded-full border border-white/30" style={{ backgroundColor: c.hex ?? "#9CA3AF" }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </article>
          </Link>

          {/* Companion products */}
          <div className="lg:col-span-2 grid grid-cols-2 lg:grid-cols-1 gap-5">
            {companions.map((product) => (
              <CompactCard key={product.id} product={product} clientDiscount={clientDiscount} />
            ))}
            <div className="col-span-2 lg:col-span-1 flex justify-center">
              <Link href="/produits" className="text-sm font-body text-text-secondary hover:text-text-primary transition-colors">
                {t("featuredViewAll")} &rarr;
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
