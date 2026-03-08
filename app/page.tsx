import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import HeroSection from "@/components/home/HeroSection";
import TrustBadges from "@/components/home/TrustBadges";
import CategoriesSection from "@/components/home/CategoriesSection";
import FeaturedProducts from "@/components/home/FeaturedProducts";
import PromoSection from "@/components/home/PromoSection";
import NewsletterSection from "@/components/home/NewsletterSection";

/* ─────────────────────────────────────────────
   Métadonnées SEO spécifiques à la page d'accueil
   Surchargent les métadonnées du layout
───────────────────────────────────────────── */
export const metadata: Metadata = {
  title: "Beli & Jolie — Bijoux Acier Inoxydable BtoB",
  description:
    "Beli & Jolie, votre grossiste BtoB en bijoux acier inoxydable. +500 références tendance pour revendeurs et boutiques. Tarifs dégressifs, livraison mondiale en 48h.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Beli & Jolie — Bijoux Acier Inoxydable BtoB",
    description:
      "Grossiste BtoB en bijoux acier inoxydable. Collections élégantes, prix professionnels, livraison rapide.",
    url: "/",
  },
};

/**
 * Page d'accueil — Beli & Jolie
 *
 * Architecture :
 * 1. Navbar            — navigation principale sticky
 * 2. HeroSection       — accroche + CTAs principaux
 * 3. TrustBadges       — 4 arguments de confiance
 * 4. CategoriesSection — grille des 5 catégories
 * 5. FeaturedProducts  — 4 produits vedettes
 * 6. PromoSection      — bannière offres volumes
 * 7. NewsletterSection — inscription newsletter pro
 * 8. Footer            — liens, réseaux, mentions
 */
export default async function HomePage() {
  const session = await getServerSession(authOptions);

  return (
    <>
      <Navbar />
      <main>
        <HeroSection isLoggedIn={!!session} />
        <TrustBadges />
        <CategoriesSection />
        <FeaturedProducts />
        <PromoSection />
        <NewsletterSection />
      </main>
      <Footer />
    </>
  );
}
