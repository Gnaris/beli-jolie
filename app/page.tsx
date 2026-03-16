import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
    unitPrice: number;
    isPrimary: boolean;
    color: { name: string; hex: string | null };
    images: { path: string }[];
  }[];
};

function toCarousel(products: PrismaProduct[]): CarouselProduct[] {
  return products.map((p) => ({
    id:        p.id,
    name:      p.name,
    reference: p.reference,
    category:  p.category.name,
    colors:    p.colors.map((c) => ({
      id:         c.id,
      hex:        c.color.hex,
      name:       c.color.name,
      firstImage: c.images[0]?.path ?? null,
      unitPrice:  c.unitPrice,
      isPrimary:  c.isPrimary,
    })),
  }));
}

const COLOR_INCLUDE = {
  colors: {
    select: {
      id:        true,
      unitPrice: true,
      isPrimary: true,
      color:     { select: { name: true, hex: true } },
      images:    { select: { path: true }, orderBy: { order: "asc" as const }, take: 1 },
    },
  },
};

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

  // ── Fetch data in parallel ────────────────────────────────────────────────
  const [nouveautes, bestsellers, collections, reassortProducts, productCount] = await Promise.all([
    // Nouveautés — 20 derniers produits
    prisma.product.findMany({
      orderBy: { createdAt: "desc" },
      take:    20,
      select:  { id: true, name: true, reference: true, category: { select: { name: true } }, ...COLOR_INCLUDE },
    }),

    // Best Sellers — produits les plus commandés (par quantité totale vendue)
    prisma.orderItem.groupBy({
      by:      ["productRef"],
      _sum:    { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take:    30,
    }).then(async (stats) => {
      const refs = stats.map((s) => s.productRef);
      if (refs.length === 0) return [];
      const products = await prisma.product.findMany({
        where:  { reference: { in: refs } },
        select: { id: true, name: true, reference: true, category: { select: { name: true } }, ...COLOR_INCLUDE },
      });
      // Preserve bestseller order
      const map = new Map(products.map((p) => [p.reference, p]));
      return refs.map((r) => map.get(r)).filter(Boolean) as typeof products;
    }),

    // Collections — 4 les plus récentes pour la grille
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
          // Regrouper par référence et trier par quantité totale
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
            where:  { reference: { in: refs } },
            select: { id: true, name: true, reference: true, category: { select: { name: true } }, ...COLOR_INCLUDE },
          });
          const map = new Map(products.map((p) => [p.reference, p]));
          return refs.map((r) => map.get(r)).filter(Boolean) as typeof products;
        })
      : Promise.resolve([]),

    // Nombre total de produits
    prisma.product.count(),
  ]);

  const carouselNouveautes  = toCarousel(nouveautes);
  const carouselBestsellers = toCarousel(bestsellers);
  const carouselReassort    = toCarousel(reassortProducts);

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
              />
            </div>
          )}

          {/* 3. Nouveautés */}
          <div className="bg-bg-primary">
            <ProductCarousel
              title={t("newProducts")}
              products={carouselNouveautes}
              viewMoreHref="/produits"
              viewMoreLabel={t("newProductsMore")}
            />
          </div>

          {/* 4. Brand info section */}
          <BrandInfoSection />

          {/* 5. Best Sellers */}
          {carouselBestsellers.length > 0 && (
            <div className="bg-bg-secondary">
              <ProductCarousel
                title={t("bestsellers")}
                products={carouselBestsellers}
                viewMoreHref="/produits"
                viewMoreLabel={t("bestsellersMore")}
              />
            </div>
          )}

          {/* 6. Collections */}
          <div className="bg-bg-primary">
            <CollectionsGrid collections={collections} />
          </div>
      </main>

      <Footer />
    </div>
  );
}
