"use client";

import { useRef, useState, useTransition, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { useScrollReveal } from "./useScrollReveal";
import { addToCart } from "@/app/actions/client/cart";
import ColorSwatch from "@/components/ui/ColorSwatch";

interface ColorData {
  id: string;
  hex: string | null;
  patternImage?: string | null;
  name: string;
  firstImage: string | null;
  unitPrice: number;
  discountedPrice?: number;
  hasDiscount?: boolean;
  isPrimary: boolean;
  variantId: string;
}

export interface CarouselProduct {
  id: string;
  name: string;
  reference: string;
  category: string;
  colors: ColorData[];
}

export interface ClientDiscountInfo {
  discountType: "PERCENT" | "AMOUNT";
  discountValue: number;
}

interface Props {
  title: string;
  subtitle?: string;
  products: CarouselProduct[];
  viewMoreHref: string;
  viewMoreLabel?: string;
  variant?: "white" | "gray";
  size?: "premium" | "standard";
  clientDiscount?: ClientDiscountInfo | null;
  showPromoBadge?: boolean;
}

function applyClientDiscount(price: number, discount: ClientDiscountInfo | null | undefined): number {
  if (!discount) return price;
  if (discount.discountType === "PERCENT") return Math.max(0, price * (1 - discount.discountValue / 100));
  return Math.max(0, price - discount.discountValue);
}

function CarouselCard({
  product,
  clientDiscount,
  showPromoBadge,
  size,
}: {
  product: CarouselProduct;
  clientDiscount?: ClientDiscountInfo | null;
  showPromoBadge?: boolean;
  size: "premium" | "standard";
}) {
  const t = useTranslations("products");
  const tProduct = useTranslations("product");
  const { tp, tc: translateCat } = useProductTranslation();
  const { data: session } = useSession();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const primaryColor = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  const [selectedColorId, setSelectedColorId] = useState<string>(primaryColor?.id ?? "");

  const selectedColor = product.colors.find((c) => c.id === selectedColorId) ?? primaryColor;
  const image = selectedColor?.firstImage;

  // Price for selected color
  const basePrice = selectedColor?.unitPrice ?? 0;
  const discountedPrice = selectedColor?.discountedPrice ?? basePrice;
  const hasProductDiscount = discountedPrice < basePrice;

  const priceBeforeClient = discountedPrice;
  const finalPrice = applyClientDiscount(priceBeforeClient, clientDiscount);
  const hasClientDiscount = !!clientDiscount && finalPrice < priceBeforeClient;

  const showStrikethrough = hasClientDiscount || hasProductDiscount;
  const strikethroughPrice = hasClientDiscount ? priceBeforeClient : basePrice;
  const anyColorHasDiscount = product.colors.some((c) => c.hasDiscount);

  const isPremium = size === "premium";
  const cardWidth = isPremium ? "w-[300px] sm:w-[340px]" : "w-[250px] sm:w-[280px]";
  const imageAspect = isPremium ? "aspect-[3/4]" : "aspect-[4/5]";
  const cardRadius = isPremium ? "rounded-2xl" : "rounded-xl";
  const cardShadow = isPremium ? "shadow-md hover:shadow-lg" : "shadow-sm hover:shadow-md";

  const imageRef = useRef<HTMLDivElement>(null);
  const [addedFeedback, setAddedFeedback] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAddToCart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setErrorMsg(null);

    if (!session?.user) {
      router.push("/connexion");
      return;
    }

    if (!selectedColor?.variantId) return;

    startTransition(async () => {
      try {
        await addToCart(selectedColor.variantId, 1);
        // Fly-to-cart animation
        if (imageRef.current && image) {
          const rect = imageRef.current.getBoundingClientRect();
          window.dispatchEvent(new CustomEvent("cart:item-added", {
            detail: { imageSrc: image, rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }, quantity: 1 },
          }));
        }
        setAddedFeedback(true);
        setTimeout(() => setAddedFeedback(false), 2000);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erreur";
        setErrorMsg(msg);
        setTimeout(() => setErrorMsg(null), 3000);
      }
    });
  }, [session, selectedColor, image, router]);

  return (
    <article className={`group shrink-0 ${cardWidth} ${cardRadius} bg-bg-primary border border-border overflow-hidden flex flex-col transition-shadow duration-300 ${cardShadow}`}>
      <Link href={`/produits/${product.id}`} className="block">
        <div ref={imageRef} className={`${imageAspect} bg-bg-secondary relative overflow-hidden`}>
          {image ? (
            <Image
              src={image}
              alt={product.name}
              fill
              sizes={isPremium ? "340px" : "280px"}
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
              </svg>
            </div>
          )}

          {/* Premium: hover "Voir" button */}
          {isPremium && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <span className="px-5 py-2 bg-white/90 backdrop-blur-sm text-bg-darker font-heading font-medium text-sm rounded-full shadow-md">
                Voir
              </span>
            </div>
          )}

          {/* Promo badge */}
          {(showPromoBadge || anyColorHasDiscount) && hasProductDiscount && (
            <span className="absolute top-2.5 right-2.5 bg-[#EF4444] text-white text-[10px] font-bold font-heading px-2.5 py-0.5 rounded-full shadow-sm uppercase tracking-wide">
              {tProduct("promo")}
            </span>
          )}

          {/* Color count badge — bottom-right with backdrop blur */}
          {product.colors.length > 1 && (
            <span className="absolute bottom-2.5 right-2.5 bg-white/80 backdrop-blur-sm text-text-secondary text-[10px] font-body px-2 py-0.5 rounded-full">
              {t("colors", { count: product.colors.length })}
            </span>
          )}
        </div>
      </Link>

      <div className="p-4 flex flex-col gap-2 flex-1">
        {/* Color swatches — clickable */}
        {product.colors.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {product.colors.slice(0, 5).map((c) => (
              <button
                key={c.id}
                type="button"
                title={tp(c.name)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedColorId(c.id);
                }}
                className={`rounded-full transition-all duration-200 ${
                  c.id === selectedColorId
                    ? "ring-2 ring-accent ring-offset-1 scale-110"
                    : "hover:scale-110"
                }`}
              >
                <ColorSwatch
                  hex={c.hex}
                  patternImage={c.patternImage}
                  size={16}
                  border
                  rounded="full"
                />
              </button>
            ))}
          </div>
        )}

        <Link href={`/produits/${product.id}`}>
          <p className="font-body font-semibold text-sm text-text-primary line-clamp-1 leading-snug hover:text-text-secondary transition-colors">
            {tp(product.name)}
          </p>
        </Link>

        <p className="text-xs text-text-muted font-body">
          {translateCat(product.category)}
        </p>

        <div className="flex items-baseline gap-1.5 mt-auto flex-wrap">
          {showStrikethrough && (
            <span className="font-body text-xs text-text-muted line-through">
              {strikethroughPrice.toFixed(2)} &euro;
            </span>
          )}
          {hasClientDiscount && clientDiscount?.discountType === "PERCENT" && (
            <span className="text-[10px] font-body text-[#EF4444] font-medium">
              -{clientDiscount.discountValue}%
            </span>
          )}
          <span className={`font-heading font-semibold ${isPremium ? "text-base" : "text-sm"} ${showStrikethrough ? "text-[#EF4444]" : "text-text-primary"}`}>
            {(hasClientDiscount ? finalPrice : discountedPrice).toFixed(2)} &euro;
          </span>
          <span className="text-[10px] text-text-muted font-body">
            {tProduct("htUnit")}
          </span>
        </div>

        {/* Add to cart button */}
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={isPending || addedFeedback}
          className={`mt-1 w-full py-2 rounded-lg text-xs font-medium font-body transition-all duration-200 ${
            addedFeedback
              ? "bg-green-500 text-white"
              : errorMsg
                ? "bg-red-50 text-red-600 border border-red-200"
                : "bg-accent text-white hover:bg-accent-dark active:scale-[0.98]"
          } disabled:opacity-70`}
        >
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </span>
          ) : addedFeedback ? (
            <span className="inline-flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {tProduct("addedToCart")}
            </span>
          ) : errorMsg ? (
            errorMsg
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              {tProduct("addToCart")}
            </span>
          )}
        </button>
      </div>
    </article>
  );
}

export default function ProductCarousel({
  title,
  subtitle,
  products,
  viewMoreHref,
  viewMoreLabel = "Voir plus",
  variant = "white",
  size = "standard",
  clientDiscount,
  showPromoBadge,
}: Props) {
  const tCommon = useTranslations("common");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRef = useScrollReveal();

  const isPremium = size === "premium";
  const scrollAmount = isPremium ? 364 : 304;

  function scroll(dir: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? scrollAmount : -scrollAmount, behavior: "smooth" });
  }

  if (products.length === 0) return null;

  return (
    <section
      ref={sectionRef}
      className={`scroll-fade-up py-10 lg:py-14 ${variant === "gray" ? "bg-bg-secondary" : "bg-bg-primary"}`}
    >
      <div className="container-site" style={{ maxWidth: "1440px" }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className={`font-heading font-semibold text-text-primary ${isPremium ? "text-2xl" : "text-xl"}`}>
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-text-muted font-body mt-1">{subtitle}</p>
            )}
            <div className="h-px w-12 bg-border mt-3" />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => scroll("left")}
              className={`hidden sm:flex items-center justify-center rounded-full transition-colors ${
                isPremium
                  ? "w-9 h-9 bg-accent text-white hover:bg-accent-dark"
                  : "w-8 h-8 border border-border bg-bg-primary hover:bg-bg-dark hover:border-bg-dark hover:text-text-inverse text-text-secondary"
              }`}
              aria-label={tCommon("previous")}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button
              onClick={() => scroll("right")}
              className={`hidden sm:flex items-center justify-center rounded-full transition-colors ${
                isPremium
                  ? "w-9 h-9 bg-accent text-white hover:bg-accent-dark"
                  : "w-8 h-8 border border-border bg-bg-primary hover:bg-bg-dark hover:border-bg-dark hover:text-text-inverse text-text-secondary"
              }`}
              aria-label={tCommon("next")}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
            <Link
              href={viewMoreHref}
              className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors font-body ml-1"
            >
              {viewMoreLabel} &rarr;
            </Link>
          </div>
        </div>

        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="flex gap-5 overflow-x-auto pb-2 scroll-smooth no-scrollbar snap-x snap-mandatory"
        >
          {products.map((p) => (
            <div key={p.id} className="snap-start">
              <CarouselCard product={p} clientDiscount={clientDiscount} showPromoBadge={showPromoBadge} size={size} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
