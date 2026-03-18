import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseDisplayConfig, fetchCarouselProducts } from "@/lib/product-display";
import { getCachedSiteConfig } from "@/lib/cached-data";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import BrandInfoSection from "@/components/home/BrandInfoSection";
import CollectionsGrid from "@/components/home/CollectionsGrid";
import ProductCarousel, { CarouselProduct } from "@/components/home/ProductCarousel";
import HeroBanner from "@/components/home/HeroBanner";

export const metadata: Metadata = {
  title: "Beli & Jolie — Bijoux Acier Inoxydable BtoB",
  description:
    "Beli & Jolie, votre grossiste BtoB en bijoux acier inoxydable. +500 références tendance pour revendeurs et boutiques.",
  alternates: { canonical: "/" },
};

// ─────────────────────────────────────────────
// Helpers de mise en forme Prisma → CarouselProduct
// ─────────────────────────────────────────────
type PrismaProduct = {
  id: string;
  name: string;
  reference: string;
  category: { name: string };
  colors: {
    id: string;
    colorId: string;
    unitPrice: number;
    isPrimary: boolean;
    discountType: "PERCENT" | "AMOUNT" | null;
    discountValue: number | null;
    color: { name: string; hex: string | null };
  }[];
};

function computeDiscountedPrice(unitPrice: number, discountType: "PERCENT" | "AMOUNT" | null, discountValue: number | null): number {
  if (!discountType || !discountValue) return unitPrice;
  if (discountType === "PERCENT") return Math.max(0, unitPrice * (1 - discountValue / 100));
  return Math.max(0, unitPrice - discountValue);
}

function toCarousel(products: PrismaProduct[], imageMap: Map<string, Map<string, string>>): CarouselProduct[] {
  return products.map((p) => {
    // Deduplicate by colorId, take min price per color
    const colorMap = new Map<string, { id: string; colorId: string; hex: string | null; name: string; unitPrice: number; discountedPrice: number; hasDiscount: boolean; isPrimary: boolean }>();
    for (const c of p.colors) {
      const discounted = computeDiscountedPrice(c.unitPrice, c.discountType, c.discountValue);
      const hasDsc = discounted < c.unitPrice;
      if (!colorMap.has(c.colorId)) {
        colorMap.set(c.colorId, { id: c.colorId, colorId: c.colorId, hex: c.color.hex, name: c.color.name, unitPrice: c.unitPrice, discountedPrice: discounted, hasDiscount: hasDsc, isPrimary: c.isPrimary });
      } else {
        const entry = colorMap.get(c.colorId)!;
        if (discounted < entry.discountedPrice) {
          entry.unitPrice = c.unitPrice;
          entry.discountedPrice = discounted;
          entry.hasDiscount = hasDsc;
        }
        if (c.isPrimary) entry.isPrimary = true;
      }
    }
    return {
      id:        p.id,
      name:      p.name,
      reference: p.reference,
      category:  p.category.name,
      colors:    [...colorMap.values()].map((c) => ({
        id:              c.colorId,
        hex:             c.hex,
        name:            c.name,
        firstImage:      imageMap.get(p.id)?.get(c.colorId) ?? null,
        unitPrice:       c.unitPrice,
        discountedPrice: c.discountedPrice,
        hasDiscount:     c.hasDiscount,
        isPrimary:       c.isPrimary,
      })),
    };
  });
}

const COLOR_INCLUDE = {
  colors: {
    select: {
      id:            true,
      colorId:       true,
      unitPrice:     true,
      isPrimary:     true,
      discountType:  true,
      discountValue: true,
      color:         { select: { name: true, hex: true } },
    },
  },
};

const PRODUCT_SELECT = { id: true, name: true, reference: true, category: { select: { name: true } }, ...COLOR_INCLUDE };

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────
export default async function HomePage() {
  const [session, t] = await Promise.all([
    getServerSession(authOptions),
    getTranslations("home"),
  ]);
  if (!session) redirect("/connexion");
  const userId  = session?.user?.id;

  // ── Load display config ─────────────────────────────────────────────────────
  const configRow = await getCachedSiteConfig("product_display_config");
  const displayConfig = parseDisplayConfig(configRow?.value);
  const useCustomCarousels = displayConfig.homepageCarousels.length > 0;

  // ── Fetch bestseller refs (shared between default and custom modes) ─────────
  const bestsellerStats = await prisma.orderItem.groupBy({
    by:      ["productRef"],
    _sum:    { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take:    30,
  });
  const bestsellerRefs = bestsellerStats.map((s) => s.productRef);

  // ── Fetch client discount ──────────────────────────────────────────────────
  const clientDiscount = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { discountType: true, discountValue: true },
      }).then((u) =>
        u?.discountType && u.discountValue
          ? { discountType: u.discountType as "PERCENT" | "AMOUNT", discountValue: u.discountValue }
          : null
      )
    : null;

  // ── Fetch data ──────────────────────────────────────────────────────────────
  // Always fetch: collections, reassort, product count, promotions
  const [collections, reassortProducts, productCount] = await Promise.all([
    prisma.collection.findMany({
      orderBy: { createdAt: "desc" },
      take:    4,
      select:  { id: true, name: true, image: true },
    }),

    // Réassort — produits déjà commandés par l'utilisateur connecté
    userId
      ? prisma.orderItem.findMany({
          where:   { order: { userId } },
          select:  { productRef: true, quantity: true },
          orderBy: { createdAt: "desc" },
        }).then(async (items) => {
          const refCounts = new Map<string, number>();
          for (const item of items) {
            refCounts.set(item.productRef, (refCounts.get(item.productRef) ?? 0) + item.quantity);
          }
          const refs = [...refCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([ref]) => ref);
          if (refs.length === 0) return [];
          const products = await prisma.product.findMany({
            where:  { reference: { in: refs }, status: "ONLINE" },
            select: PRODUCT_SELECT,
          });
          const map = new Map(products.map((p) => [p.reference, p]));
          return refs.map((r) => map.get(r)).filter(Boolean) as typeof products;
        })
      : Promise.resolve([]),

    prisma.product.count({ where: { status: "ONLINE" } }),
  ]);

  // Bonne affaire — produits avec au moins une variante en promotion
  const promoProducts = await prisma.product.findMany({
    where: {
      status: "ONLINE",
      colors: {
        some: {
          discountType: { not: null },
          discountValue: { gt: 0 },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: PRODUCT_SELECT,
  });

  // ── Build carousel data ─────────────────────────────────────────────────────
  type CarouselData = { title: string; products: CarouselProduct[]; bg: string; href: string; label: string };
  const carouselList: CarouselData[] = [];
  let carouselReassort: CarouselProduct[] = [];
  let carouselPromo: CarouselProduct[] = [];

  if (useCustomCarousels) {
    // Custom carousels from config
    const customProducts = await Promise.all(
      displayConfig.homepageCarousels.map(c => fetchCarouselProducts(c, bestsellerRefs))
    );

    // Collect all IDs for image fetching
    const allIds = [...new Set([
      ...reassortProducts.map(p => p.id),
      ...promoProducts.map(p => p.id),
      ...customProducts.flat().map(p => p.id),
    ])];
    const imgRows = allIds.length > 0
      ? await prisma.productColorImage.findMany({ where: { productId: { in: allIds } }, orderBy: { order: "asc" } })
      : [];
    const imageMap = new Map<string, Map<string, string>>();
    for (const img of imgRows) {
      if (!imageMap.has(img.productId)) imageMap.set(img.productId, new Map());
      const cm = imageMap.get(img.productId)!;
      if (!cm.has(img.colorId)) cm.set(img.colorId, img.path);
    }

    // Build custom carousels
    for (let i = 0; i < displayConfig.homepageCarousels.length; i++) {
      const cfg = displayConfig.homepageCarousels[i];
      const prods = customProducts[i];
      if (prods.length === 0) continue;
      carouselList.push({
        title: cfg.title,
        products: toCarousel(prods, imageMap),
        bg: i % 2 === 0 ? "bg-bg-primary" : "bg-bg-secondary",
        href: "/produits",
        label: t("newProductsMore"),
      });
    }

    // Also prepare reassort + promo carousels
    carouselReassort = toCarousel(reassortProducts, imageMap);
    carouselPromo = toCarousel(promoProducts, imageMap);
  } else {
    // Default carousels: Nouveautés + Best Sellers
    const [nouveautes, defaultBestsellers] = await Promise.all([
      prisma.product.findMany({
        where:   { status: "ONLINE" },
        orderBy: { createdAt: "desc" },
        take:    20,
        select:  PRODUCT_SELECT,
      }),

      bestsellerRefs.length > 0
        ? prisma.product.findMany({
            where:  { reference: { in: bestsellerRefs }, status: "ONLINE" },
            select: PRODUCT_SELECT,
          }).then(products => {
            const map = new Map(products.map((p) => [p.reference, p]));
            return bestsellerRefs.map((r) => map.get(r)).filter(Boolean) as typeof products;
          })
        : Promise.resolve([]),
    ]);

    // Fetch images
    const allIds = [...new Set([
      ...nouveautes.map(p => p.id),
      ...defaultBestsellers.map(p => p.id),
      ...reassortProducts.map(p => p.id),
      ...promoProducts.map(p => p.id),
    ])];
    const imgRows = allIds.length > 0
      ? await prisma.productColorImage.findMany({ where: { productId: { in: allIds } }, orderBy: { order: "asc" } })
      : [];
    const imageMap = new Map<string, Map<string, string>>();
    for (const img of imgRows) {
      if (!imageMap.has(img.productId)) imageMap.set(img.productId, new Map());
      const cm = imageMap.get(img.productId)!;
      if (!cm.has(img.colorId)) cm.set(img.colorId, img.path);
    }

    carouselList.push({
      title: t("newProducts"),
      products: toCarousel(nouveautes, imageMap),
      bg: "bg-bg-primary",
      href: "/produits",
      label: t("newProductsMore"),
    });

    if (defaultBestsellers.length > 0) {
      carouselList.push({
        title: t("bestsellers"),
        products: toCarousel(defaultBestsellers, imageMap),
        bg: "bg-bg-secondary",
        href: "/produits",
        label: t("bestsellersMore"),
      });
    }

    carouselReassort = toCarousel(reassortProducts, imageMap);
    carouselPromo = toCarousel(promoProducts, imageMap);
  }

  return (
    <div className="min-h-screen bg-bg-secondary">
      <PublicSidebar />

      <main>
          {/* 1. Hero banner */}
          <HeroBanner isLoggedIn={!!session} productCount={productCount} />

          {/* 2. Reassort — only if logged in */}
          {session && carouselReassort.length > 0 && (
            <div className="bg-bg-secondary">
              <ProductCarousel
                title={t("reassortTitle")}
                products={carouselReassort}
                viewMoreHref="/produits?reassort=1"
                viewMoreLabel={t("reassortMore")}
                clientDiscount={clientDiscount}
              />
            </div>
          )}

          {/* 2b. Bonne affaire — produits en promotion */}
          {carouselPromo.length > 0 && (
            <div className="bg-bg-primary">
              <ProductCarousel
                title={t("deals")}
                products={carouselPromo}
                viewMoreHref="/produits"
                viewMoreLabel={t("dealsMore")}
                clientDiscount={clientDiscount}
                showPromoBadge
              />
            </div>
          )}

          {/* 3. Product carousels (custom or default) */}
          {carouselList.map((carousel, i) => (
            <div key={i} className={carousel.bg}>
              <ProductCarousel
                title={carousel.title}
                products={carousel.products}
                viewMoreHref={carousel.href}
                viewMoreLabel={carousel.label}
                clientDiscount={clientDiscount}
              />
            </div>
          ))}

          {/* 4. Brand info section */}
          <BrandInfoSection />

          {/* 5. Collections */}
          <div className="bg-bg-primary">
            <CollectionsGrid collections={collections} />
          </div>
      </main>

      <Footer />
    </div>
  );
}
