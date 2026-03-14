import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import BrandInfoSection from "@/components/home/BrandInfoSection";
import CollectionsGrid from "@/components/home/CollectionsGrid";
import ProductCarousel, { CarouselProduct } from "@/components/home/ProductCarousel";

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
// Hero Banner
// ─────────────────────────────────────────────
function HeroBanner({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <section className="bg-[#1A1A1A] text-white">
      <div className="container-site py-16 md:py-20">
        <div className="max-w-xl">
          <p className="text-xs uppercase tracking-widest text-[#999999] font-[family-name:var(--font-roboto)] mb-3">
            Grossiste B2B — Bijoux acier inoxydable
          </p>
          <h1 className="font-[family-name:var(--font-poppins)] text-3xl md:text-4xl font-semibold leading-tight mb-4">
            Des bijoux tendance pour votre boutique
          </h1>
          <p className="text-[#AAAAAA] text-sm leading-relaxed font-[family-name:var(--font-roboto)] mb-8">
            +500 références en acier inoxydable. Tarifs professionnels, livraison rapide,
            service après-vente réactif.
          </p>
          <div className="flex flex-wrap gap-3">
            {isLoggedIn ? (
              <Link href="/produits" className="btn-primary">
                Voir le catalogue
              </Link>
            ) : (
              <>
                <Link href="/connexion" className="btn-primary">
                  Accès espace pro
                </Link>
                <Link
                  href="/inscription"
                  className="inline-flex items-center gap-2 bg-transparent text-white border border-white/30 text-sm font-medium px-6 py-3 rounded-md hover:bg-white/10 transition-colors font-[family-name:var(--font-roboto)]"
                >
                  Créer un compte
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────
export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const userId  = session?.user?.id;

  // ── Fetch data in parallel ────────────────────────────────────────────────
  const [nouveautes, bestsellers, collections, reassortProducts] = await Promise.all([
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
  ]);

  const carouselNouveautes  = toCarousel(nouveautes);
  const carouselBestsellers = toCarousel(bestsellers);
  const carouselReassort    = toCarousel(reassortProducts);

  return (
    <div className="flex min-h-screen">
      <PublicSidebar />

      <div className="flex-1 lg:ml-60 pt-14 lg:pt-0 min-w-0">
        <main>
          {/* 1. Bannière hero */}
          <HeroBanner isLoggedIn={!!session} />

          {/* 2. Réassort — uniquement si connecté */}
          {session && carouselReassort.length > 0 && (
            <div className="bg-[#F5F5F5]">
              <ProductCarousel
                title="Besoin de réassort ?"
                products={carouselReassort}
                viewMoreHref="/produits?reassort=1"
                viewMoreLabel="Voir plus"
              />
            </div>
          )}

          {/* 3. Nouveautés */}
          <div className="bg-white">
            <ProductCarousel
              title="Nouveautés"
              products={carouselNouveautes}
              viewMoreHref="/produits"
              viewMoreLabel="Voir tout le catalogue"
            />
          </div>

          {/* 4. Section marque */}
          <BrandInfoSection />

          {/* 5. Best Sellers */}
          {carouselBestsellers.length > 0 && (
            <div className="bg-[#F5F5F5]">
              <ProductCarousel
                title="Best Sellers"
                products={carouselBestsellers}
                viewMoreHref="/produits"
                viewMoreLabel="Voir plus"
              />
            </div>
          )}

          {/* 6. Nos collections */}
          <div className="bg-white">
            <CollectionsGrid collections={collections} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
