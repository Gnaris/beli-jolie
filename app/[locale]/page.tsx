import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "@/i18n/navigation";
import { getServerSession } from "next-auth";
import { getTranslations, getLocale } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseDisplayConfig, fetchCarouselProducts, type HomepageCarousel } from "@/lib/product-display";
import { getCachedSiteConfig, getCachedBestsellerRefs, getCachedShopName } from "@/lib/cached-data";
import { buildAlternates, buildWebsiteSchema, getSiteUrl } from "@/lib/seo";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import CollectionsGrid from "@/components/home/CollectionsGrid";
import ProductCarousel, { CarouselProduct } from "@/components/home/ProductCarousel";
import HeroBanner from "@/components/home/HeroBanner";
import FeaturedProduct from "@/components/home/FeaturedProduct";
import TrustBand from "@/components/home/TrustBand";
import CategoryGrid from "@/components/home/CategoryGrid";
import CtaBanner from "@/components/home/CtaBanner";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const shopName = await getCachedShopName();
  return {
    title: `${shopName} — Grossiste B2B`,
    description:
      `${shopName}, votre plateforme grossiste B2B. Catalogue complet pour revendeurs et professionnels.`,
    alternates: buildAlternates("/", locale),
    openGraph: {
      type: "website",
      siteName: shopName,
      title: `${shopName} — Grossiste B2B`,
      description: `Catalogue ${shopName}. Tarifs grossiste pour revendeurs et professionnels.`,
      url: `${getSiteUrl()}/${locale}`,
    },
  };
}

// ─────────────────────────────────────────────
// Helpers de mise en forme Prisma → CarouselProduct
// ─────────────────────────────────────────────
type PrismaProduct = {
  id: string;
  name: string;
  reference: string;
  discountPercent: number | null;
  category: { name: string };
  colors: {
    id: string;
    colorId: string | null;
    unitPrice: number;
    isPrimary: boolean;
    saleType: string;
    packQuantity: number | null;
    stock: number;
    color: { name: string; hex: string | null; patternImage?: string | null } | null;
    variantSizes: { size: { name: string }; quantity: number }[];
  }[];
};

function computeDiscountedPrice(unitPrice: number, discountPercent: number | null): number {
  if (!discountPercent || discountPercent <= 0) return unitPrice;
  return Math.max(0, unitPrice * (1 - discountPercent / 100));
}

function toCarousel(products: PrismaProduct[], imageMap: Map<string, Map<string, string>>): CarouselProduct[] {
  return products.map((p) => {
    const productDiscountPercent = p.discountPercent != null ? Number(p.discountPercent) : null;

    // Group variants by color (using colorId as groupKey)
    const colorMap = new Map<string, {
      colorId: string; groupKey: string; hex: string | null; patternImage: string | null;
      name: string; isPrimary: boolean; unitPrice: number; discountedPrice: number; hasDiscount: boolean;
      variants: { id: string; saleType: string; packQuantity: number | null; unitPrice: number; stock: number; sizes: { name: string; quantity: number }[] }[];
    }>();

    for (const c of p.colors) {
      if (!c.colorId) continue;
      const groupKey = c.colorId;

      const price = Number(c.unitPrice);
      const discounted = computeDiscountedPrice(price, productDiscountPercent);
      const hasDsc = discounted < price;

      const variant = {
        id: c.id,
        saleType: c.saleType ?? "UNIT",
        packQuantity: c.packQuantity ?? null,
        unitPrice: price,
        stock: c.stock ?? 0,
        sizes: (c.variantSizes ?? []).map((vs) => ({ name: vs.size.name, quantity: vs.quantity })),
      };

      const existing = colorMap.get(groupKey);
      if (existing) {
        existing.variants.push(variant);
        if (c.isPrimary) existing.isPrimary = true;
        if (discounted < existing.discountedPrice) {
          existing.unitPrice = price;
          existing.discountedPrice = discounted;
          existing.hasDiscount = hasDsc;
        }
      } else {
        colorMap.set(groupKey, {
          colorId: c.colorId,
          groupKey,
          hex: c.color?.hex ?? null,
          patternImage: c.color?.patternImage ?? null,
          name: c.color?.name ?? "",
          isPrimary: c.isPrimary,
          unitPrice: price,
          discountedPrice: discounted,
          hasDiscount: hasDsc,
          variants: [variant],
        });
      }
    }

    return {
      id:        p.id,
      name:      p.name,
      reference: p.reference,
      category:  p.category.name,
      colors:    [...colorMap.values()].map((c) => ({
        id:              c.colorId,
        groupKey:        c.groupKey,
        hex:             c.hex,
        patternImage:    c.patternImage,
        name:            c.name,
        firstImage:      imageMap.get(p.id)?.get(c.colorId) ?? null,
        unitPrice:       c.unitPrice,
        discountedPrice: c.discountedPrice,
        hasDiscount:     c.hasDiscount,
        isPrimary:       c.isPrimary,
        variants:        c.variants,
      })),
    };
  });
}

/** Convert Prisma Decimal fields to plain numbers so the data matches PrismaProduct */
function serializeProducts(products: Array<Record<string, unknown>>): PrismaProduct[] {
  return products.map((p: any) => ({
    ...p,
    discountPercent: p.discountPercent != null ? Number(p.discountPercent) : null,
    colors: p.colors.map((c: any) => ({
      ...c,
      unitPrice: Number(c.unitPrice),
      stock: Number(c.stock ?? 0),
      packQuantity: c.packQuantity != null ? Number(c.packQuantity) : null,
    })),
  }));
}

const COLOR_INCLUDE = {
  colors: {
    where: { disabled: false },
    select: {
      id:            true,
      colorId:       true,
      unitPrice:     true,
      isPrimary:     true,
      color:         { select: { name: true, hex: true, patternImage: true } },
    },
  },
};

const PRODUCT_SELECT = { id: true, name: true, reference: true, discountPercent: true, category: { select: { name: true } }, ...COLOR_INCLUDE };

// ─────────────────────────────────────────────
// Reassort fetcher (needs userId)
// ─────────────────────────────────────────────
async function fetchReassortProducts(userId: string, quantity: number) {
  const items = await prisma.orderItem.findMany({
    where:   { order: { userId } },
    select:  { productRef: true, quantity: true },
    orderBy: { createdAt: "desc" },
  });
  const refCounts = new Map<string, number>();
  for (const item of items) {
    refCounts.set(item.productRef, (refCounts.get(item.productRef) ?? 0) + item.quantity);
  }
  const refs = [...refCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, quantity)
    .map(([ref]) => ref);
  if (refs.length === 0) return [];
  const products = await prisma.product.findMany({
    where:  { reference: { in: refs }, status: "ONLINE" },
    select: PRODUCT_SELECT,
  });
  const map = new Map(products.map((p) => [p.reference, p]));
  const ordered = refs.map((r) => map.get(r)).filter(Boolean);
  return serializeProducts(ordered as Array<Record<string, unknown>>);
}

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────
export default async function HomePage() {
  const [session, t, cookieStore] = await Promise.all([
    getServerSession(authOptions),
    getTranslations("home"),
    cookies(),
  ]);
  const hasAccessCode = !!cookieStore.get("bj_access_code")?.value;
  const locale = await getLocale();
  if (!session && !hasAccessCode) redirect({href: "/connexion", locale});
  const userId  = session?.user?.id;

  // ── Load banner image + display config + shop name ─────────────────────────
  const [bannerImageRow, configRow, bestsellerRefs, shopName] = await Promise.all([
    getCachedSiteConfig("banner_image"),
    getCachedSiteConfig("product_display_config"),
    getCachedBestsellerRefs(30),
    getCachedShopName(),
  ]);
  const bannerImage = bannerImageRow?.value ?? null;
  const displayConfig = parseDisplayConfig(configRow?.value);

  // ── Fetch client discount ──────────────────────────────────────────────────
  const clientDiscount = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { discountType: true, discountValue: true },
      }).then((u) =>
        u?.discountType && u.discountValue
          ? { discountType: u.discountType as "PERCENT" | "AMOUNT", discountValue: Number(u.discountValue) }
          : null
      )
    : null;

  // ── Fetch collections + counts ─────────────────────────────────────────────
  const [allCollections, productCount, allCategories] = await Promise.all([
    prisma.collection.findMany({
      orderBy: { createdAt: "desc" },
      select:  { id: true, name: true, image: true, _count: { select: { products: { where: { product: { status: "ONLINE" } } } } } },
    }),
    prisma.product.count({ where: { status: "ONLINE" } }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select:  { id: true, name: true, _count: { select: { products: { where: { status: "ONLINE" } } } } },
    }),
  ]);

  // Only keep categories & collections that have at least 1 ONLINE product
  const categories = allCategories.filter(c => c._count.products > 0);
  const collections = allCollections.filter(c => c._count.products > 0).slice(0, 4);

  // ── Build carousel data from config ───────────────────────────────────────
  const visibleCarousels = displayConfig.homepageCarousels.filter(c => c.visible);

  // Fetch products for each visible carousel in parallel
  const carouselProducts = await Promise.all(
    visibleCarousels.map(async (carousel): Promise<{ carousel: HomepageCarousel; products: PrismaProduct[] }> => {
      if (carousel.type === "reassort") {
        // Reassort needs userId — skip if not logged in
        if (!userId) return { carousel, products: [] };
        const products = await fetchReassortProducts(userId, carousel.quantity);
        return { carousel, products };
      }
      const products = await fetchCarouselProducts(carousel, bestsellerRefs);
      return { carousel, products: serializeProducts(products as Array<Record<string, unknown>>) };
    })
  );

  // Collect all product IDs for image fetching
  const allIds = [...new Set(carouselProducts.flatMap(cp => cp.products.map(p => p.id)))];
  const imgRows = allIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: allIds } }, orderBy: { order: "asc" } })
    : [];
  const imageMap = new Map<string, Map<string, string>>();
  for (const img of imgRows) {
    if (!imageMap.has(img.productId)) imageMap.set(img.productId, new Map());
    const cm = imageMap.get(img.productId)!;
    if (!cm.has(img.colorId)) cm.set(img.colorId, img.path);
  }

  // Build final carousel list
  type CarouselData = { id: string; title: string; products: CarouselProduct[]; isPromo: boolean; viewMoreHref: string };

  function buildViewMoreHref(c: HomepageCarousel): string {
    switch (c.type) {
      case "new":         return "/produits?new=1";
      case "bestseller":  return "/produits?bestseller=1";
      case "promo":       return "/produits?promo=1";
      case "category":    return c.categoryId ? `/produits?cat=${c.categoryId}` : "/produits";
      case "subcategory": return c.subCategoryId ? `/produits?subcat=${c.subCategoryId}` : "/produits";
      case "collection":  return c.collectionIds?.[0] ? `/collections/${c.collectionIds[0]}` : "/collections";
      case "tag":         return c.tagId ? `/produits?tag=${c.tagId}` : "/produits";
      default:            return "/produits";
    }
  }

  const carouselList: CarouselData[] = [];
  for (const { carousel, products } of carouselProducts) {
    if (products.length === 0) continue;
    // Skip reassort for guests
    if (carousel.type === "reassort" && !session) continue;
    carouselList.push({
      id: carousel.id,
      title: carousel.title,
      products: toCarousel(products, imageMap),
      isPromo: carousel.type === "promo",
      viewMoreHref: buildViewMoreHref(carousel),
    });
  }

  // JSON-LD WebSite (avec SearchAction). Organization est rendu dans le layout racine, pas de doublon.
  const webSiteJsonLd = buildWebsiteSchema({ name: shopName, url: getSiteUrl() });

  return (
    <div className="min-h-screen bg-bg-secondary relative">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteJsonLd) }} />
      <PublicSidebar shopName={shopName} />

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

      <Footer shopName={shopName} />
    </div>
  );
}
