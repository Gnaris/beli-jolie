import { getTranslations } from "next-intl/server";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import HeroBanner from "@/components/home/HeroBanner";
import ProductCarousel from "@/components/home/ProductCarousel";
import CategoryGrid from "@/components/home/CategoryGrid";
import CollectionsGrid from "@/components/home/CollectionsGrid";
import TrustBand from "@/components/home/TrustBand";
import ReviewsSection from "@/components/home/ReviewsSection";
import FaqSection from "@/components/home/FaqSection";
import CtaBanner from "@/components/home/CtaBanner";
import ShowroomSection from "@/components/home/ShowroomSection";
import type { HomeLayoutProps } from "./HomeLayoutProps";

export default async function HomeBeliandjolieLayout({
  shopName,
  bannerImage,
  heroOverrides,
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
}: HomeLayoutProps) {
  const t = await getTranslations("home");

  return (
    <div className="min-h-screen bg-bg-secondary relative">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBlocks) }} />
      <PublicSidebar shopName={shopName} tenantSlug="beliandjolie" />

      <main className="relative z-10 -mt-16">
        {/* 1. Hero éditable */}
        <HeroBanner
          bannerImage={bannerImage}
          shopName={shopName}
          productCount={productCount}
          {...heroOverrides}
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

        {/* 8. FAQ (jusqu'à 8, éditables depuis l'admin + JSON-LD FAQPage
             injecté en haut de page pour les rich results Google). */}
        {faqItems.length > 0 && (
          <FaqSection
            items={faqItems}
            eyebrow={t("faqEyebrow")}
            title={t("faqTitle")}
            contactTitle={t("faqContactTitle")}
            contactDesc={t("faqContactDesc")}
            contactCta={t("faqContactCta")}
            contactHref="/nous-contacter"
          />
        )}

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
