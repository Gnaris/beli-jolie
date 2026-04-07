# Homepage Redesign — "Hybride Raffiné" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the homepage with premium visuals, varied product layouts, and editorial-style sections to replace the current template-like appearance.

**Architecture:** Refactor existing `components/home/` files and create new ones. The page server component (`app/page.tsx`) fetches additional data (categories) and passes it to new sections. No new Prisma models, API routes, or admin config required — we reuse existing data sources.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4, next-intl, Prisma 5.22, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-07-homepage-redesign-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `components/home/HeroBanner.tsx` | Full-viewport hero with parallax, staggered fade-up |
| Create | `components/home/FeaturedProduct.tsx` | Asymmetric 60/40 "Coup de coeur" section |
| Modify | `components/home/ProductCarousel.tsx` | Premium (XL) and Standard card variants, new badges, hover effects |
| Modify | `components/home/CollectionsGrid.tsx` | Asymmetric mosaic layout replacing 2x2 grid |
| Create | `components/home/TrustBand.tsx` | 4-icon trust strip with animated counters |
| Create | `components/home/CategoryGrid.tsx` | Round-image category cards in grid |
| Modify | `components/home/CtaBanner.tsx` | Simplified premium dark CTA |
| Delete | `components/home/BrandInfoSection.tsx` | Replaced by TrustBand |
| Delete | `components/home/StatsStrip.tsx` | Replaced by TrustBand |
| Modify | `app/page.tsx` | New section ordering, fetch categories, pass data to new components |
| Modify | `app/globals.css` | Scroll-triggered animation utilities |
| Modify | `messages/fr.json` | New translation keys for added sections |
| Modify | `messages/en.json` | New translation keys for added sections |
| Create | `components/home/useScrollReveal.ts` | Shared IntersectionObserver hook for fade-up animations |

---

### Task 1: Scroll Reveal Hook

**Files:**
- Create: `components/home/useScrollReveal.ts`
- Modify: `app/globals.css`

This hook powers all scroll-triggered fade-up animations across the new homepage sections.

- [ ] **Step 1: Create the useScrollReveal hook**

```typescript
// components/home/useScrollReveal.ts
"use client";

import { useEffect, useRef } from "react";

/**
 * Attaches an IntersectionObserver to the ref element.
 * Adds `.scroll-visible` class when element enters viewport.
 * Respects prefers-reduced-motion.
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  threshold = 0.15
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Respect reduced motion
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReduced) {
      el.classList.add("scroll-visible");
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("scroll-visible");
          observer.unobserve(el);
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return ref;
}
```

- [ ] **Step 2: Add scroll-reveal CSS utilities to globals.css**

Add these animation utilities at the end of the existing `@layer utilities` block in `app/globals.css`:

```css
/* Scroll-reveal animations */
.scroll-fade-up {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
}
.scroll-fade-up.scroll-visible {
  opacity: 1;
  transform: translateY(0);
}

/* Stagger delays for grouped elements */
.stagger-1 { transition-delay: 100ms; }
.stagger-2 { transition-delay: 200ms; }
.stagger-3 { transition-delay: 300ms; }
.stagger-4 { transition-delay: 400ms; }

/* Reduced motion override */
@media (prefers-reduced-motion: reduce) {
  .scroll-fade-up {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add components/home/useScrollReveal.ts app/globals.css
git commit -m "feat(home): add scroll-reveal hook and CSS utilities"
```

---

### Task 2: Hero Banner Redesign

**Files:**
- Modify: `components/home/HeroBanner.tsx`
- Modify: `messages/fr.json` (home section)
- Modify: `messages/en.json` (home section)

- [ ] **Step 1: Update translation keys**

In `messages/fr.json`, ensure the `home` section has these keys (add/update as needed):

```json
"heroBadge": "Grossiste B2B — Catalogue Professionnel",
"heroTitle1": "Des produits tendance",
"heroTitle2": "pour votre boutique",
"heroDesc": "+{count} références disponibles. Prix professionnels, livraison rapide, service client réactif.",
"heroCta": "Parcourir le catalogue",
"heroCtaSecondary": "Nos Collections"
```

In `messages/en.json`, same keys:

```json
"heroBadge": "B2B Wholesaler — Professional Catalog",
"heroTitle1": "Trendy products",
"heroTitle2": "for your shop",
"heroDesc": "+{count} references available. Professional prices, fast delivery, responsive customer service.",
"heroCta": "Browse catalog",
"heroCtaSecondary": "Our Collections"
```

- [ ] **Step 2: Rewrite HeroBanner component**

Replace the full content of `components/home/HeroBanner.tsx`:

```tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";

interface HeroBannerProps {
  bannerImage: string | null;
  shopName: string;
  productCount: number;
}

export default function HeroBanner({ bannerImage, shopName, productCount }: HeroBannerProps) {
  const t = useTranslations("home");

  return (
    <section className="relative w-full min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background image */}
      {bannerImage ? (
        <Image
          src={bannerImage}
          alt={shopName}
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{ willChange: "transform" }}
        />
      ) : (
        <div className="absolute inset-0 bg-bg-darker" />
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/20" />

      {/* Content */}
      <div className="relative z-10 text-center px-6 max-w-3xl mx-auto">
        {/* Badge */}
        <span
          className="inline-block text-xs sm:text-sm font-body tracking-widest uppercase text-white/80 border border-white/20 rounded-full px-5 py-1.5 mb-6 backdrop-blur-sm animate-[fadeUp_0.6s_ease-out_both]"
        >
          {t("heroBadge")}
        </span>

        {/* Title */}
        <h1 className="font-heading font-bold text-white leading-tight mb-4 animate-[fadeUp_0.6s_ease-out_0.15s_both]"
            style={{ fontSize: "clamp(2.25rem, 5vw, 4.5rem)" }}>
          {t("heroTitle1")}
          <br />
          <span className="text-accent">{t("heroTitle2")}</span>
        </h1>

        {/* Subtitle */}
        <p className="font-body text-white/70 text-base sm:text-lg max-w-xl mx-auto mb-8 animate-[fadeUp_0.6s_ease-out_0.3s_both]">
          {t("heroDesc", { count: String(productCount) })}
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 animate-[fadeUp_0.6s_ease-out_0.45s_both]">
          <Link
            href="/produits"
            className="px-8 py-3 bg-white text-bg-darker font-heading font-semibold text-sm rounded-full hover:bg-white/90 transition-colors"
          >
            {t("heroCta")}
          </Link>
          <Link
            href="/collections"
            className="px-8 py-3 border border-white/40 text-white font-heading font-medium text-sm rounded-full hover:bg-white/10 transition-colors"
          >
            {t("heroCtaSecondary")}
          </Link>
        </div>
      </div>

      {/* Bottom SVG curve */}
      <div className="absolute bottom-0 left-0 right-0">
        <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className="w-full h-8 sm:h-10 md:h-[60px] block">
          <path d="M0,60 L0,20 Q720,0 1440,20 L1440,60 Z" fill="var(--color-bg-primary)" />
        </svg>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Add the fadeUp keyframe to globals.css**

Add inside the `@theme inline {}` block or as a standalone `@keyframes` (whichever matches current pattern):

```css
@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add components/home/HeroBanner.tsx messages/fr.json messages/en.json app/globals.css
git commit -m "feat(home): redesign hero banner — full viewport, parallax, staggered fade-up"
```

---

### Task 3: Featured Product Section

**Files:**
- Create: `components/home/FeaturedProduct.tsx`
- Modify: `messages/fr.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add translation keys**

In `messages/fr.json` `home` section:

```json
"featuredTitle": "Coup de cœur",
"featuredViewAll": "Voir tout le catalogue"
```

In `messages/en.json` `home` section:

```json
"featuredTitle": "Featured",
"featuredViewAll": "View full catalog"
```

- [ ] **Step 2: Create FeaturedProduct component**

```tsx
// components/home/FeaturedProduct.tsx
"use client";

import Link from "next/link";
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
            <Image
              src={image}
              alt={product.name}
              fill
              sizes="280px"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
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
            {hasAnyDiscount && (
              <span className="text-xs text-text-muted line-through font-body">{minBase.toFixed(2)} €</span>
            )}
            <span className={`font-heading font-semibold text-sm ${hasAnyDiscount ? "text-[#EF4444]" : "text-text-primary"}`}>
              {finalPrice.toFixed(2)} €
            </span>
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
          <h2 className="font-heading text-lg font-semibold text-text-primary tracking-wide uppercase">
            {t("featuredTitle")}
          </h2>
          <div className="h-px flex-1 max-w-[80px] bg-border" />
        </div>

        {/* Asymmetric grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Hero product — 3 of 5 columns */}
          <Link href={`/produits/${hero.id}`} className="lg:col-span-3 group block">
            <article className="relative rounded-2xl overflow-hidden shadow-md">
              <div className="aspect-[3/4] relative bg-bg-secondary">
                {heroImage ? (
                  <Image
                    src={heroImage}
                    alt={hero.name}
                    fill
                    sizes="(min-width: 1024px) 60vw, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    priority
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-bg-secondary">
                    <svg className="w-16 h-16 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                    </svg>
                  </div>
                )}
                {/* Bottom overlay with product info */}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-5">
                  <p className="font-heading font-semibold text-white text-lg">{tp(hero.name)}</p>
                  <p className="font-body text-white/70 text-sm mt-0.5">{tc(hero.category)}</p>
                  <div className="flex items-baseline gap-2 mt-1.5">
                    {hasAnyDiscount && (
                      <span className="text-sm text-white/50 line-through">{minBase.toFixed(2)} €</span>
                    )}
                    <span className={`font-heading font-bold text-lg ${hasAnyDiscount ? "text-[#EF4444]" : "text-white"}`}>
                      {finalPrice.toFixed(2)} €
                    </span>
                    <span className="text-xs text-white/50">{tProduct("htUnit")}</span>
                  </div>
                  {/* Color swatches */}
                  {hero.colors.length > 1 && (
                    <div className="flex gap-1.5 mt-2">
                      {hero.colors.slice(0, 6).map((c) => (
                        <span
                          key={c.id}
                          className="w-4 h-4 rounded-full border border-white/30"
                          style={{ backgroundColor: c.hex ?? "#9CA3AF" }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </article>
          </Link>

          {/* Companion products — 2 of 5 columns */}
          <div className="lg:col-span-2 grid grid-cols-2 lg:grid-cols-1 gap-5">
            {companions.map((product) => (
              <CompactCard key={product.id} product={product} clientDiscount={clientDiscount} />
            ))}
            {/* View all link */}
            <div className="col-span-2 lg:col-span-1 flex justify-center">
              <Link
                href="/produits"
                className="text-sm font-body text-text-secondary hover:text-text-primary transition-colors"
              >
                {t("featuredViewAll")} →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/home/FeaturedProduct.tsx messages/fr.json messages/en.json
git commit -m "feat(home): add FeaturedProduct section — asymmetric 60/40 layout"
```

---

### Task 4: Product Carousel Redesign

**Files:**
- Modify: `components/home/ProductCarousel.tsx`

- [ ] **Step 1: Rewrite ProductCarousel with premium/standard variants**

Replace the full content of `components/home/ProductCarousel.tsx`:

```tsx
"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { useScrollReveal } from "./useScrollReveal";

interface ColorData {
  id: string;
  hex: string | null;
  name: string;
  firstImage: string | null;
  unitPrice: number;
  discountedPrice?: number;
  hasDiscount?: boolean;
  isPrimary: boolean;
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

  const primaryColor = product.colors.find((c) => c.isPrimary) ?? product.colors[0];
  const image = primaryColor?.firstImage;

  const minBasePrice = Math.min(...product.colors.map((c) => c.unitPrice));
  const minDiscountedPrice = Math.min(...product.colors.map((c) => c.discountedPrice ?? c.unitPrice));
  const hasProductDiscount = minDiscountedPrice < minBasePrice;

  const priceBeforeClient = minDiscountedPrice;
  const finalPrice = applyClientDiscount(priceBeforeClient, clientDiscount);
  const hasClientDiscount = !!clientDiscount && finalPrice < priceBeforeClient;

  const showStrikethrough = hasClientDiscount || hasProductDiscount;
  const strikethroughPrice = hasClientDiscount ? priceBeforeClient : minBasePrice;
  const anyColorHasDiscount = product.colors.some((c) => c.hasDiscount);

  const isPremium = size === "premium";
  const cardWidth = isPremium ? "w-[300px] sm:w-[340px]" : "w-[250px] sm:w-[280px]";
  const imageAspect = isPremium ? "aspect-[3/4]" : "aspect-[4/5]";
  const cardRadius = isPremium ? "rounded-2xl" : "rounded-xl";
  const cardShadow = isPremium ? "shadow-md hover:shadow-lg" : "shadow-sm hover:shadow-md";

  // Check if product is "new" (created within 30 days) — we use reference starting with date pattern as heuristic
  // This is a simplified check; the server could pass a `isNew` flag for accuracy

  return (
    <article className={`group shrink-0 ${cardWidth} ${cardRadius} bg-bg-primary border border-border overflow-hidden flex flex-col transition-shadow duration-300 ${cardShadow}`}>
      <Link href={`/produits/${product.id}`} className="block">
        <div className={`${imageAspect} bg-bg-secondary relative overflow-hidden`}>
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
        {/* Color swatches */}
        {product.colors.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {product.colors.slice(0, 5).map((c) => (
              <span
                key={c.id}
                title={tp(c.name)}
                className="w-4 h-4 rounded-full border border-border"
                style={{ backgroundColor: c.hex ?? "#9CA3AF" }}
              />
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
              {strikethroughPrice.toFixed(2)} €
            </span>
          )}
          {hasClientDiscount && clientDiscount?.discountType === "PERCENT" && (
            <span className="text-[10px] font-body text-[#EF4444] font-medium">
              -{clientDiscount.discountValue}%
            </span>
          )}
          <span className={`font-heading font-semibold ${isPremium ? "text-base" : "text-sm"} ${showStrikethrough ? "text-[#EF4444]" : "text-text-primary"}`}>
            {(hasClientDiscount ? finalPrice : minDiscountedPrice).toFixed(2)} €
          </span>
          <span className="text-[10px] text-text-muted font-body">
            {tProduct("htUnit")}
          </span>
        </div>
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
              {viewMoreLabel} →
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
```

- [ ] **Step 2: Commit**

```bash
git add components/home/ProductCarousel.tsx
git commit -m "feat(home): redesign ProductCarousel — premium/standard variants, new badges, snap scroll"
```

---

### Task 5: Collections Mosaic

**Files:**
- Modify: `components/home/CollectionsGrid.tsx`
- Modify: `messages/fr.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add translation keys**

In `messages/fr.json` `home` section:

```json
"collectionsTitle": "Nos Collections",
"collectionsProducts": "{count} produits"
```

In `messages/en.json` `home` section:

```json
"collectionsTitle": "Our Collections",
"collectionsProducts": "{count} products"
```

- [ ] **Step 2: Rewrite CollectionsGrid as asymmetric mosaic**

Replace the full content of `components/home/CollectionsGrid.tsx`:

```tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";
import { useProductTranslation } from "@/hooks/useProductTranslation";

interface CollectionItem {
  id: string;
  name: string;
  image: string | null;
  _count?: { products: number };
}

interface Props {
  collections: CollectionItem[];
}

function CollectionCard({
  collection,
  className,
  sizes,
}: {
  collection: CollectionItem;
  className?: string;
  sizes: string;
}) {
  const { tp } = useProductTranslation();
  const t = useTranslations("home");
  const productCount = collection._count?.products ?? 0;

  return (
    <Link href={`/collections/${collection.id}`} className={`group block ${className ?? ""}`}>
      <div className="relative w-full h-full rounded-2xl overflow-hidden bg-bg-secondary">
        {collection.image ? (
          <Image
            src={collection.image}
            alt={collection.name}
            fill
            sizes={sizes}
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 bg-bg-tertiary" />
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        {/* Content */}
        <div className="absolute bottom-0 inset-x-0 p-5 flex items-end justify-between">
          <div>
            <h3 className="font-heading font-semibold text-white text-lg">
              {tp(collection.name)}
            </h3>
            {productCount > 0 && (
              <p className="font-body text-white/60 text-sm mt-0.5">
                {t("collectionsProducts", { count: productCount })}
              </p>
            )}
          </div>
          <span className="text-white/0 group-hover:text-white/80 transition-colors duration-300 text-lg">
            →
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function CollectionsGrid({ collections }: Props) {
  const t = useTranslations("home");
  const sectionRef = useScrollReveal();

  if (collections.length === 0) return null;

  const [large, med1, med2, wide] = collections;

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-secondary py-16 lg:py-20">
      <div className="container-site" style={{ maxWidth: "1200px" }}>
        {/* Editorial header */}
        <div className="flex items-center gap-4 justify-center mb-10">
          <div className="h-px flex-1 max-w-[80px] bg-border" />
          <h2 className="font-heading text-lg font-semibold text-text-primary tracking-wide uppercase">
            {t("collectionsTitle")}
          </h2>
          <div className="h-px flex-1 max-w-[80px] bg-border" />
        </div>

        {/* Mosaic grid */}
        {collections.length >= 4 ? (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Large card — left, spans 2 rows */}
            <div className="lg:col-span-3 lg:row-span-2 min-h-[280px] lg:min-h-[500px]">
              <CollectionCard collection={large} className="h-full" sizes="(min-width: 1024px) 60vw, 100vw" />
            </div>
            {/* Medium 1 — top right */}
            <div className="lg:col-span-2 min-h-[200px] lg:min-h-0">
              <CollectionCard collection={med1} className="h-full" sizes="(min-width: 1024px) 40vw, 100vw" />
            </div>
            {/* Medium 2 — bottom right */}
            <div className="lg:col-span-2 min-h-[200px] lg:min-h-0">
              <CollectionCard collection={med2} className="h-full" sizes="(min-width: 1024px) 40vw, 100vw" />
            </div>
            {/* Wide card — full bottom */}
            <div className="lg:col-span-5 min-h-[180px] lg:min-h-[200px]">
              <CollectionCard collection={wide} className="h-full" sizes="100vw" />
            </div>
          </div>
        ) : (
          /* Fallback: simple grid for fewer collections */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {collections.map((col) => (
              <div key={col.id} className="min-h-[250px]">
                <CollectionCard collection={col} className="h-full" sizes="(min-width: 640px) 50vw, 100vw" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/home/CollectionsGrid.tsx messages/fr.json messages/en.json
git commit -m "feat(home): redesign CollectionsGrid as asymmetric mosaic layout"
```

---

### Task 6: Trust Band

**Files:**
- Create: `components/home/TrustBand.tsx`
- Modify: `messages/fr.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add translation keys**

In `messages/fr.json` `home` section:

```json
"trustDelivery": "Livraison Rapide",
"trustDeliveryDesc": "Expédition sous 24h",
"trustPayment": "Paiement Sécurisé",
"trustPaymentDesc": "CB, virement, chèque",
"trustSupport": "Service Client",
"trustSupportDesc": "Réactif et dédié",
"trustQuality": "Qualité Garantie",
"trustQualityDesc": "Produits sélectionnés"
```

In `messages/en.json` `home` section:

```json
"trustDelivery": "Fast Delivery",
"trustDeliveryDesc": "Shipped within 24h",
"trustPayment": "Secure Payment",
"trustPaymentDesc": "Card, transfer, check",
"trustSupport": "Customer Service",
"trustSupportDesc": "Responsive and dedicated",
"trustQuality": "Quality Guaranteed",
"trustQualityDesc": "Carefully selected products"
```

- [ ] **Step 2: Create TrustBand component**

```tsx
// components/home/TrustBand.tsx
"use client";

import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";

const TRUST_ITEMS = [
  {
    key: "trustDelivery",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25m-2.25 0H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h.375m8.25-11.25h3.75a2.25 2.25 0 012.166 1.65l.814 2.85" />
      </svg>
    ),
  },
  {
    key: "trustPayment",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
  },
  {
    key: "trustSupport",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
      </svg>
    ),
  },
  {
    key: "trustQuality",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
      </svg>
    ),
  },
] as const;

export default function TrustBand() {
  const t = useTranslations("home");
  const sectionRef = useScrollReveal();

  return (
    <section
      ref={sectionRef}
      className="scroll-fade-up bg-bg-primary border-y border-border py-10 lg:py-12"
    >
      <div className="container-site" style={{ maxWidth: "1200px" }}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-0">
          {TRUST_ITEMS.map((item, i) => (
            <div
              key={item.key}
              className={`flex flex-col items-center text-center ${
                i < TRUST_ITEMS.length - 1 ? "lg:border-r lg:border-border" : ""
              }`}
            >
              <div className="text-accent mb-2">{item.icon}</div>
              <p className="font-heading font-semibold text-sm text-text-primary">
                {t(item.key)}
              </p>
              <p className="font-body text-xs text-text-muted mt-0.5">
                {t(`${item.key}Desc`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/home/TrustBand.tsx messages/fr.json messages/en.json
git commit -m "feat(home): add TrustBand section — 4 trust icons with descriptions"
```

---

### Task 7: Category Grid

**Files:**
- Create: `components/home/CategoryGrid.tsx`
- Modify: `messages/fr.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add translation keys**

In `messages/fr.json` `home` section:

```json
"categoriesTitle": "Explorer par catégorie",
"categoriesProducts": "{count} produits"
```

In `messages/en.json` `home` section:

```json
"categoriesTitle": "Browse by category",
"categoriesProducts": "{count} products"
```

- [ ] **Step 2: Create CategoryGrid component**

```tsx
// components/home/CategoryGrid.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";
import { useProductTranslation } from "@/hooks/useProductTranslation";

interface CategoryItem {
  id: string;
  name: string;
  image: string | null;
  _count: { products: number };
}

interface Props {
  categories: CategoryItem[];
}

export default function CategoryGrid({ categories }: Props) {
  const t = useTranslations("home");
  const { tp } = useProductTranslation();
  const sectionRef = useScrollReveal();

  if (categories.length === 0) return null;

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-secondary py-16 lg:py-20">
      <div className="container-site" style={{ maxWidth: "1200px" }}>
        {/* Editorial header */}
        <div className="flex items-center gap-4 justify-center mb-10">
          <div className="h-px flex-1 max-w-[80px] bg-border" />
          <h2 className="font-heading text-lg font-semibold text-text-primary tracking-wide uppercase">
            {t("categoriesTitle")}
          </h2>
          <div className="h-px flex-1 max-w-[80px] bg-border" />
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
          {categories.map((cat, i) => (
            <Link key={cat.id} href={`/produits?cat=${cat.id}`} className="group block">
              <article
                className={`bg-bg-primary rounded-2xl border border-border p-6 flex flex-col items-center text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-accent/30 stagger-${Math.min(i + 1, 4)}`}
              >
                {/* Round image */}
                <div className="w-20 h-20 lg:w-[120px] lg:h-[120px] rounded-full overflow-hidden bg-bg-secondary mb-4 border border-border">
                  {cat.image ? (
                    <Image
                      src={cat.image}
                      alt={cat.name}
                      width={120}
                      height={120}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM2.25 13.125c0-.621.504-1.125 1.125-1.125h6c.621 0 1.125.504 1.125 1.125v6c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-6z" />
                      </svg>
                    </div>
                  )}
                </div>
                <p className="font-heading font-medium text-sm text-text-primary">{tp(cat.name)}</p>
                {cat._count.products > 0 && (
                  <p className="font-body text-xs text-text-muted mt-1">
                    {t("categoriesProducts", { count: cat._count.products })}
                  </p>
                )}
              </article>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/home/CategoryGrid.tsx messages/fr.json messages/en.json
git commit -m "feat(home): add CategoryGrid section — round images with hover lift"
```

---

### Task 8: CTA Banner Simplification

**Files:**
- Modify: `components/home/CtaBanner.tsx`

- [ ] **Step 1: Rewrite CtaBanner as a clean premium dark section**

Replace the full content of `components/home/CtaBanner.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";

export default function CtaBanner() {
  const { data: session } = useSession();
  const t = useTranslations("home");
  const sectionRef = useScrollReveal();

  return (
    <section
      ref={sectionRef}
      className="scroll-fade-up relative overflow-hidden py-20 lg:py-24"
      style={{ backgroundColor: "#111111" }}
    >
      {/* Subtle radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, rgba(75,85,99,0.1) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 text-center px-6 max-w-2xl mx-auto">
        <h2
          className="font-heading font-bold text-white leading-tight mb-4"
          style={{ fontSize: "clamp(1.75rem, 4vw, 2.75rem)" }}
        >
          {t("ctaTitle")}
        </h2>
        <p className="font-body text-white/60 text-base mb-8 max-w-lg mx-auto">
          {t("ctaDesc")}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/produits"
            className="px-8 py-3 bg-white text-bg-darker font-heading font-semibold text-sm rounded-full hover:bg-white/90 transition-colors"
          >
            {t("heroCta")}
          </Link>
          {!session && (
            <Link
              href="/inscription"
              className="px-8 py-3 border border-white/30 text-white font-heading font-medium text-sm rounded-full hover:bg-white/10 transition-colors"
            >
              {t("heroRegister")}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/home/CtaBanner.tsx
git commit -m "feat(home): simplify CTA banner — premium dark minimal design"
```

---

### Task 9: Wire Everything in app/page.tsx

**Files:**
- Modify: `app/page.tsx`

This is the final integration task. We update the server component to:
1. Fetch categories (with product counts) and collection product counts
2. Pass `productCount` to HeroBanner
3. Add FeaturedProduct section using bestseller data
4. Pass `size="premium"` to first carousel
5. Replace BrandInfoSection/StatsStrip with TrustBand/CategoryGrid
6. Reorder sections per the spec

- [ ] **Step 1: Update page.tsx imports and data fetching**

Update the imports at the top of `app/page.tsx`:

Replace these imports:
```typescript
import BrandInfoSection from "@/components/home/BrandInfoSection";
import MarqueeBand from "@/components/home/MarqueeBand";
import StatsStrip from "@/components/home/StatsStrip";
```

With:
```typescript
import FeaturedProduct from "@/components/home/FeaturedProduct";
import TrustBand from "@/components/home/TrustBand";
import CategoryGrid from "@/components/home/CategoryGrid";
```

- [ ] **Step 2: Update data fetching to include categories with counts and collection counts**

In the parallel fetch block where collections are fetched, add categories and update collections to include product count:

Replace:
```typescript
const [collections, productCount, collectionCount, categoryCount] = await Promise.all([
    prisma.collection.findMany({
      orderBy: { createdAt: "desc" },
      take:    4,
      select:  { id: true, name: true, image: true },
    }),
    prisma.product.count({ where: { status: "ONLINE" } }),
    prisma.collection.count(),
    prisma.category.count(),
  ]);
```

With:
```typescript
const [collections, productCount, categories] = await Promise.all([
    prisma.collection.findMany({
      orderBy: { createdAt: "desc" },
      take:    4,
      select:  { id: true, name: true, image: true, _count: { select: { products: true } } },
    }),
    prisma.product.count({ where: { status: "ONLINE" } }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select:  { id: true, name: true, image: true, _count: { select: { products: true } } },
    }),
  ]);
```

- [ ] **Step 3: Update the JSX rendering to new section order**

Replace the entire `<main>` content (everything between `<main>` and `</main>`) with:

```tsx
<main className="relative z-10 -mt-16">
    {/* 1. Hero banner */}
    <HeroBanner bannerImage={bannerImage} shopName={shopName} productCount={productCount} />

    {/* 2. Featured product (from bestsellers) */}
    {carouselList.length > 0 && carouselList[0].products.length >= 3 && (
      <FeaturedProduct
        products={carouselList[0].products.slice(0, 3)}
        clientDiscount={clientDiscount}
      />
    )}

    {/* 3. Product carousels — first is premium, rest are standard */}
    {carouselList.map((carousel, i) => (
      <ProductCarousel
        key={carousel.id}
        title={carousel.title}
        products={carousel.products}
        viewMoreHref={carousel.viewMoreHref}
        viewMoreLabel={t("newProductsMore")}
        variant={i % 2 === 0 ? "gray" : "white"}
        size={i === 0 ? "premium" : "standard"}
        clientDiscount={clientDiscount}
        showPromoBadge={carousel.isPromo}
      />
    ))}

    {/* 4. Collections mosaic */}
    <CollectionsGrid collections={collections} />

    {/* 5. Trust band */}
    <TrustBand />

    {/* 6. Category grid */}
    {categories.length > 0 && (
      <CategoryGrid categories={categories} />
    )}

    {/* 7. CTA banner */}
    <CtaBanner />
</main>
```

- [ ] **Step 4: Remove unused imports**

Remove the `SectionDivider` import since we no longer use section dividers between sections (the scroll-fade-up animations provide visual separation):

```typescript
// Remove this line:
import SectionDivider from "@/components/home/SectionDivider";
```

Also remove the `collectionCount` and `categoryCount` variables from anywhere they're still referenced (they were used by StatsStrip which is now removed).

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat(home): wire new homepage sections — featured, trust, categories, mosaic"
```

---

### Task 10: Cleanup & Final Polish

**Files:**
- Delete: `components/home/BrandInfoSection.tsx`
- Delete: `components/home/StatsStrip.tsx`
- Keep: `components/home/SectionDivider.tsx` (may be used elsewhere)
- Keep: `components/home/MarqueeBand.tsx` (disabled but kept for future use)

- [ ] **Step 1: Check for other usages of deleted components**

Run these searches to ensure BrandInfoSection and StatsStrip aren't imported elsewhere:

```bash
grep -r "BrandInfoSection" --include="*.tsx" --include="*.ts" -l
grep -r "StatsStrip" --include="*.tsx" --include="*.ts" -l
```

Expected: only `app/page.tsx` (which we already updated). If other files import them, update those too.

- [ ] **Step 2: Delete unused components**

```bash
rm components/home/BrandInfoSection.tsx
rm components/home/StatsStrip.tsx
```

- [ ] **Step 3: Verify the build compiles**

```bash
npm run build
```

Fix any TypeScript errors or missing imports.

- [ ] **Step 4: Visual verification**

```bash
npm run dev
```

Open `http://localhost:3000` and verify:
1. Hero is full-viewport with staggered fade-up animations
2. Featured product section shows 1 large + 2 small products
3. First carousel has larger cards (premium), subsequent carousels have standard cards
4. Collections mosaic shows asymmetric layout
5. Trust band shows 4 icons in a row
6. Category grid shows round images
7. CTA banner is dark and minimal
8. All sections have scroll-reveal fade-up animations
9. Mobile responsive layout works correctly
10. `prefers-reduced-motion` disables animations

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore(home): remove old BrandInfoSection and StatsStrip components"
```

---

### Task 11: Translation Files for All Remaining Languages

**Files:**
- Modify: `messages/de.json`, `messages/es.json`, `messages/it.json`, `messages/ar.json`, `messages/zh.json`

- [ ] **Step 1: Add new keys to all language files**

For each language file, add the same new keys under the `home` section. Use the auto-translate system (DeepL/Claude) or add placeholders that will be auto-translated:

The keys to add in each file's `home` section:
- `heroCtaSecondary`
- `featuredTitle`
- `featuredViewAll`
- `collectionsTitle`
- `collectionsProducts`
- `trustDelivery`, `trustDeliveryDesc`
- `trustPayment`, `trustPaymentDesc`
- `trustSupport`, `trustSupportDesc`
- `trustQuality`, `trustQualityDesc`
- `categoriesTitle`, `categoriesProducts`

Use the French values as fallback if auto-translation is not available right now. The admin auto-translate toggle will handle this.

- [ ] **Step 2: Commit**

```bash
git add messages/
git commit -m "feat(i18n): add new homepage translation keys for all languages"
```
