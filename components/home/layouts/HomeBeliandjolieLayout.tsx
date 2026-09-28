import { getTranslations } from "next-intl/server";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import HeroInfoFaq from "@/components/home/HeroInfoFaq";
import ProductCarousel from "@/components/home/ProductCarousel";
import CategoryGrid from "@/components/home/CategoryGrid";
import CollectionsGrid from "@/components/home/CollectionsGrid";
import TrustBand from "@/components/home/TrustBand";
import ReviewsSection from "@/components/home/ReviewsSection";
import MaterialQualitySection from "@/components/home/MaterialQualitySection";
import CtaBanner from "@/components/home/CtaBanner";
import ShowroomSection from "@/components/home/ShowroomSection";
import type { HomeLayoutProps } from "./HomeLayoutProps";

export default async function HomeBeliandjolieLayout({
  shopName,
  productCount,
  clientDiscount,
  favoriteIds,
  newCards,
  bestSellerCards,
  categories,
  collections,
  reviews,
  faqItems,
  jsonLdBlocks,
  companyPhone,
  companyWhatsapp,
}: HomeLayoutProps) {
  const t = await getTranslations("home");

  return (
    <div className="min-h-screen bg-bg-secondary relative">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBlocks) }} />
      <PublicSidebar shopName={shopName} tenantSlug="beliandjolie" />

      <main className="relative z-10">
        {/* 1. Hero refondu 2026-09-28 — bloc info navy à gauche, FAQ blanche à
              droite. Remplace l'ancienne bannière image + la section FAQ du bas
              de page. L'adresse + les horaires du showroom viennent des mêmes
              clés i18n que la section ShowroomSection plus bas (pas de
              doublonnage), le nombre de références vient de la BDD (cache
              tenant scopé) et le nombre de catégories = celles avec au moins
              un produit vendable. */}
        <HeroInfoFaq
          productCount={productCount}
          categoryCount={categories.length}
          showroomAddress={`${t("showroomAddressLine1")}, ${t("showroomAddressLine2")}`}
          showroomHours={t("showroomHoursValue")}
          faqItems={faqItems}
          companyPhone={companyPhone}
          companyWhatsapp={companyWhatsapp}
        />

        {/* 2. Nouveautés — 8 max + CTA « Voir toutes les nouveautés → » */}
        {newCards.length > 0 && (
          <ProductCarousel
            title={t("newProducts")}
            eyebrow={t("newProductsEyebrow")}
            products={newCards}
            viewMoreHref="/produits?new=1"
            viewMoreLabel={t("newProductsMore")}
            variant="white"
            clientDiscount={clientDiscount}
            favoriteIds={favoriteIds}
          />
        )}

        {/* 2b. Section pédagogique matériaux (déplacée après les nouveautés
             le 2026-09-28 sur demande cliente) : explique en clair « Acier
             304L · Placage PVD 14K » et les avantages pour les clientes
             finales, juste après avoir montré les produits frais du moment. */}
        <MaterialQualitySection />

        {/* 3. Catégories */}
        {categories.length > 0 && (
          <CategoryGrid categories={categories} />
        )}

        {/* 4. Collections du moment (3 max) */}
        {collections.length > 0 && (
          <CollectionsGrid collections={collections} />
        )}

        {/* 5. Best Sellers — 8 max + CTA « Voir tous les best sellers → » */}
        {bestSellerCards.length > 0 && (
          <ProductCarousel
            title={t("bestsellers")}
            eyebrow={t("bestsellersEyebrow")}
            products={bestSellerCards}
            viewMoreHref="/produits?bestseller=1"
            viewMoreLabel={t("bestsellersMore")}
            variant="gray"
            clientDiscount={clientDiscount}
            favoriteIds={favoriteIds}
          />
        )}

        {/* 6. Réassurance numérotée 01-04 */}
        <TrustBand />

        {/* 7. Avis clients (3-5, éditables depuis l'admin, masqué si vide) */}
        {reviews.length > 0 && (
          <ReviewsSection
            reviews={reviews}
            eyebrow={t("reviewsEyebrow")}
            title={t("reviewsTitle")}
          />
        )}

        {/* La FAQ a migré tout en haut de page (colonne droite du hero
             refondu). Le JSON-LD FAQPage reste injecté par HomePage — aucun
             changement SEO côté rich results. */}

        {/* 9. Showroom — adresse + carte OpenStreetMap + CTA itinéraire.
             Coordonnées : 90 rue de la Haie Coq, 93300 Aubervilliers. */}
        <ShowroomSection
          variant="beliandjolie"
          shopName={shopName}
          eyebrow={t("showroomEyebrow")}
          titleLine1={t("showroomTitle1")}
          titleLine2={t("showroomTitle2")}
          addressLine1={t("showroomAddressLine1")}
          addressLine2={t("showroomAddressLine2")}
          welcomeLabel={t("showroomWelcomeLabel")}
          welcomeValue={t("showroomWelcomeValue")}
          hoursLabel={t("showroomHoursLabel")}
          hoursValue={t("showroomHoursValue")}
          description={t("showroomDescription")}
          ctaDirections={t("showroomCtaDirections")}
          ctaContact={t("showroomCtaContact")}
          lat={48.9134}
          lon={2.3765}
          mapsQuery={t("showroomMapsQuery")}
          pinLabel={t("showroomPinLabel")}
        />

        {/* 10. CTA final « Inscription pro » */}
        <CtaBanner />
      </main>

      <Footer shopName={shopName} />
    </div>
  );
}
