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

function PhotoTile({
  product,
  className,
  sizes,
}: {
  product: CarouselProduct;
  className: string;
  sizes: string;
}) {
  const { tp, tc } = useProductTranslation();
  const image = getProductImage(product);

  return (
    <Link href={`/produits/${buildProductHandle(product.name, product.reference)}`} className={`group relative block overflow-hidden ${className}`}>
      <div className="absolute inset-0 bg-bg-secondary">
        {image ? (
          <Image
            src={image}
            alt={product.name}
            fill
            sizes={sizes}
            className="object-cover transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
            </svg>
          </div>
        )}
      </div>
      {/* Étiquette catégorie + nom en overlay bas, discret */}
      <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/60 via-black/10 to-transparent">
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/70">{tc(product.category)}</p>
        <p className="font-heading font-medium text-white text-sm leading-tight mt-1 line-clamp-1">{tp(product.name)}</p>
      </div>
    </Link>
  );
}

export default function FeaturedProduct({ products, shopName }: Props) {
  const t = useTranslations("home");
  const sectionRef = useScrollReveal();

  if (products.length < 3) return null;

  const [main, side1, side2] = products;

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-primary py-24 lg:py-32">
      <div className="container-site max-w-[1400px] mx-auto px-6 lg:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center">
        {/* Texte éditorial à gauche */}
        <div className="lg:col-span-5">
          <p className="text-[11px] uppercase tracking-[0.22em] text-text-muted font-medium mb-5">
            {t("featuredEyebrow")}
          </p>
          <h2
            className="font-heading font-bold text-text-primary leading-tight mb-6"
            style={{ fontSize: "clamp(2rem, 3.5vw, 3rem)", letterSpacing: "-0.01em" }}
          >
            {t("featuredHeading")}
          </h2>
          <p className="font-body text-text-secondary text-lg leading-relaxed mb-6">
            {t("featuredBody1", { shopName })}
          </p>
          <p className="font-body text-text-secondary leading-relaxed mb-8">
            {t("featuredBody2")}
          </p>
          <Link
            href="/produits"
            className="inline-flex items-center gap-2 text-text-primary font-heading font-medium border-b border-text-primary pb-1 hover:gap-3 transition-all"
          >
            {t("featuredCta")} <span aria-hidden>→</span>
          </Link>
        </div>

        {/* Grille photos asymétrique à droite */}
        <div className="lg:col-span-7 grid grid-cols-6 gap-3 lg:gap-4">
          <PhotoTile
            product={main}
            className="col-span-4 aspect-[4/5] rounded-3xl"
            sizes="(min-width: 1024px) 40vw, 66vw"
          />
          <div className="col-span-2 flex flex-col gap-3 lg:gap-4">
            <PhotoTile
              product={side1}
              className="aspect-square rounded-2xl"
              sizes="(min-width: 1024px) 20vw, 33vw"
            />
            <PhotoTile
              product={side2}
              className="aspect-[4/5] rounded-2xl flex-1"
              sizes="(min-width: 1024px) 20vw, 33vw"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
