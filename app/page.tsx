import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseDisplayConfig, fetchCarouselProducts, type HomepageCarousel } from "@/lib/product-display";
import { getCachedSiteConfig, getCachedBestsellerRefs, getCachedShopName } from "@/lib/cached-data";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import FloatingShapes from "@/components/ui/FloatingShapes";
import ScatteredDecorations from "@/components/ui/ScatteredDecorations";
import BrandInfoSection from "@/components/home/BrandInfoSection";
import CollectionsGrid from "@/components/home/CollectionsGrid";
import ProductCarousel, { CarouselProduct } from "@/components/home/ProductCarousel";
import HeroBanner from "@/components/home/HeroBanner";
import MarqueeBand from "@/components/home/MarqueeBand";
import StatsStrip from "@/components/home/StatsStrip";
import SectionDivider from "@/components/home/SectionDivider";
import CtaBanner from "@/components/home/CtaBanner";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: `${shopName} — Grossiste B2B`,
    description:
      `${shopName}, votre plateforme grossiste B2B. Catalogue complet pour revendeurs et professionnels.`,
    alternates: { canonical: "/" },
  };
}

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
    colorId: string | null;
    unitPrice: number;
    isPrimary: boolean;
    discountType: "PERCENT" | "AMOUNT" | null;
    discountValue: number | null;
    color: { name: string; hex: string | null } | null;
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
      if (!c.colorId) continue;
      const discounted = computeDiscountedPrice(c.unitPrice, c.discountType, c.discountValue);
      const hasDsc = discounted < c.unitPrice;
      if (!colorMap.has(c.colorId)) {
        colorMap.set(c.colorId, { id: c.colorId, colorId: c.colorId, hex: c.color?.hex ?? null, name: c.color?.name ?? "", unitPrice: c.unitPrice, discountedPrice: discounted, hasDiscount: hasDsc, isPrimary: c.isPrimary });
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
  return refs.map((r) => map.get(r)).filter(Boolean) as PrismaProduct[];
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
  if (!session && !hasAccessCode) redirect("/connexion");
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
          ? { discountType: u.discountType as "PERCENT" | "AMOUNT", discountValue: u.discountValue }
          : null
      )
    : null;

  // ── Fetch collections + counts ─────────────────────────────────────────────
  const [collections, productCount, collectionCount] = await Promise.all([
    prisma.collection.findMany({
      orderBy: { createdAt: "desc" },
      take:    4,
      select:  { id: true, name: true, image: true },
    }),
    prisma.product.count({ where: { status: "ONLINE" } }),
    prisma.collection.count(),
  ]);

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
      return { carousel, products: products as PrismaProduct[] };
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
  type CarouselData = { id: string; title: string; products: CarouselProduct[]; isPromo: boolean };
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
    });
  }

  return (
    <div className="min-h-screen bg-bg-secondary relative">
      <FloatingShapes />
      <PublicSidebar shopName={shopName} />

      <main className="relative z-10 -mt-16">
          {/* 1. Hero banner */}
          <HeroBanner bannerImage={bannerImage} shopName={shopName} />

          {/* 2. Marquee band */}
          <MarqueeBand />

          {/* 3. Stats strip */}
          <StatsStrip productCount={productCount} collectionCount={collectionCount} />

          {/* 4. Carousels — rendered in config order */}
          {carouselList.map((carousel, i) => (
            <div key={carousel.id} className="relative overflow-hidden">
              {i === 0 && <SectionDivider from="var(--color-bg-secondary)" to={i % 2 === 0 ? "var(--color-bg-secondary)" : "var(--color-bg-primary)"} />}
              <div className={`${i % 2 === 0 ? "bg-bg-secondary" : "bg-bg-primary"}`}>
                <ScatteredDecorations variant={i % 3 === 0 ? "dense" : "sparse"} seed={i + 1} />
                <ProductCarousel
                  title={carousel.title}
                  products={carousel.products}
                  viewMoreHref="/produits"
                  viewMoreLabel={t("newProductsMore")}
                  clientDiscount={clientDiscount}
                  showPromoBadge={carousel.isPromo}
                />
              </div>
            </div>
          ))}

          {/* 5. Brand info section */}
          <SectionDivider from="var(--color-bg-primary)" to="var(--color-bg-secondary)" />
          <div className="relative overflow-hidden">
            <ScatteredDecorations variant="dense" seed={200} />
            <BrandInfoSection />
          </div>

          {/* 6. Collections */}
          <SectionDivider from="var(--color-bg-secondary)" to="var(--color-bg-primary)" />
          <div className="bg-bg-primary relative overflow-hidden">
            <ScatteredDecorations variant="sparse" seed={3} />
            <CollectionsGrid collections={collections} />
          </div>

          {/* 7. CTA banner before footer */}
          <CtaBanner />
      </main>

      <Footer shopName={shopName} />
    </div>
  );
}
