import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import BrandInfoSection from "@/components/home/BrandInfoSection";
import CollectionsGrid from "@/components/home/CollectionsGrid";
import ProductCarousel, { CarouselProduct } from "@/components/home/ProductCarousel";
import JewelrySceneLoader from "@/components/home/JewelrySceneLoader";

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
function HeroBanner({ isLoggedIn, productCount }: { isLoggedIn: boolean; productCount: number }) {
  return (
    <section className="bg-bg-dark relative overflow-hidden min-h-[600px] md:min-h-[650px]">
      {/* Three.js 3D jewelry animation — behind everything */}
      <div className="absolute inset-0">
        <JewelrySceneLoader />
      </div>

      {/* Dark overlay — pointer-events-none so hover reaches the canvas */}
      <div className="absolute inset-0 bg-[#1A1A1A]/70 pointer-events-none" />

      <div className="container-site py-24 md:py-32 relative z-10 pointer-events-none">
        <div className="grid md:grid-cols-2 gap-12 items-center">

          {/* Text */}
          <div className="pointer-events-auto">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm text-white/80 text-[11px] font-medium uppercase tracking-[0.2em] px-3 py-1.5 rounded-full mb-8 font-[family-name:var(--font-roboto)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]" />
              Grossiste B2B — Bijoux acier inoxydable
            </div>
            <h1 className="font-[family-name:var(--font-poppins)] text-4xl md:text-5xl font-semibold leading-[1.1] text-text-inverse mb-6 drop-shadow-lg">
              Des bijoux tendance<br />
              pour votre boutique
            </h1>
            <p className="text-white/70 text-base leading-relaxed font-[family-name:var(--font-roboto)] mb-10 max-w-md">
              +{productCount} references en acier inoxydable. Tarifs professionnels, livraison rapide, service apres-vente reactif.
            </p>
            <div className="flex flex-wrap gap-3">
              {isLoggedIn ? (
                <Link href="/produits" className="inline-flex items-center gap-2 bg-bg-primary text-text-primary text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors font-[family-name:var(--font-roboto)] shadow-lg">
                  Voir le catalogue
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                </Link>
              ) : (
                <>
                  <Link href="/connexion" className="inline-flex items-center gap-2 bg-bg-primary text-text-primary text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors font-[family-name:var(--font-roboto)] shadow-lg">
                    Accès espace pro
                  </Link>
                  <Link href="/inscription" className="inline-flex items-center gap-2 border border-white/25 text-text-inverse text-sm px-6 py-2.5 rounded-lg hover:bg-white/10 backdrop-blur-sm transition-colors font-[family-name:var(--font-roboto)]">
                    Créer un compte
                  </Link>
                </>
              )}
            </div>

            {/* Quick stats */}
            <div className="flex flex-wrap gap-6 mt-10 pt-10 border-t border-white/10">
              {[
                { value: `+${productCount}`, label: "References" },
                { value: "J+1",  label: "Livraison France" },
                { value: "B2B",  label: "Professionnel" },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="font-[family-name:var(--font-poppins)] text-xl font-bold text-text-inverse">{stat.value}</p>
                  <p className="text-white/50 text-xs font-[family-name:var(--font-roboto)] mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right panel — glass cards over 3D scene */}
          <div className="hidden md:flex flex-col gap-3 pointer-events-auto">
            <div className="bg-white/[0.07] backdrop-blur-md border border-white/15 rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/20 flex items-center justify-center text-[#D4AF37]">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>
                </div>
                <div>
                  <p className="text-text-inverse text-sm font-medium font-[family-name:var(--font-roboto)]">Catalogue exclusif</p>
                  <p className="text-white/50 text-xs font-[family-name:var(--font-roboto)]">Acier inoxydable premium</p>
                </div>
              </div>
              <div className="h-px bg-white/5" />
              {["Colliers & Pendentifs", "Bracelets & Joncs", "Bagues & Anneaux", "Boucles d'oreilles"].map((cat) => (
                <div key={cat} className="flex items-center justify-between">
                  <span className="text-white/60 text-sm font-[family-name:var(--font-roboto)]">{cat}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]/40" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/[0.07] backdrop-blur-md border border-white/15 rounded-xl p-4">
                <p className="text-text-inverse text-lg font-bold font-[family-name:var(--font-poppins)]">{productCount}+</p>
                <p className="text-white/50 text-xs font-[family-name:var(--font-roboto)] mt-0.5">Produits disponibles</p>
              </div>
              <div className="bg-white/[0.07] backdrop-blur-md border border-white/15 rounded-xl p-4">
                <p className="text-text-inverse text-lg font-bold font-[family-name:var(--font-poppins)]">100%</p>
                <p className="text-white/50 text-xs font-[family-name:var(--font-roboto)] mt-0.5">Acier chirurgical</p>
              </div>
            </div>
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
                title="Besoin de réassort ?"
                products={carouselReassort}
                viewMoreHref="/produits?reassort=1"
                viewMoreLabel="Voir plus"
              />
            </div>
          )}

          {/* 3. Nouveautés */}
          <div className="bg-bg-primary">
            <ProductCarousel
              title="Nouveautés"
              products={carouselNouveautes}
              viewMoreHref="/produits"
              viewMoreLabel="Voir tout le catalogue"
            />
          </div>

          {/* 4. Brand info section */}
          <BrandInfoSection />

          {/* 5. Best Sellers */}
          {carouselBestsellers.length > 0 && (
            <div className="bg-bg-secondary">
              <ProductCarousel
                title="Best Sellers"
                products={carouselBestsellers}
                viewMoreHref="/produits"
                viewMoreLabel="Voir plus"
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
