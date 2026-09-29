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
import HomeSectionIndicator from "@/components/home/HomeSectionIndicator";
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
  heroImages,
}: HomeLayoutProps) {
  const t = await getTranslations("home");

  // Construction de la liste des ancres pour l'indicateur flottant de gauche.
  // On ne référence que les sections effectivement rendues, dans l'ordre du
  // DOM — sinon la barre de progression saute et affiche des noms de sections
  // absentes de la page. `tone: "dark"` demande à l'indicateur de basculer
  // en palette blanche (fond bleu marine des avis + du CTA final).
  const sections: { id: string; label: string; tone?: "light" | "dark" }[] = [
    { id: "home-hero", label: t("heroInfo.eyebrow") },
    ...(newCards.length > 0
      ? [{ id: "home-nouveautes", label: t("newProducts") }]
      : []),
    { id: "home-materiaux", label: t("materialQuality.eyebrow") },
    ...(categories.length > 0
      ? [{ id: "home-categories", label: t("categoriesTitle") }]
      : []),
    ...(collections.length > 0
      ? [{ id: "home-collections", label: t("collections") }]
      : []),
    ...(bestSellerCards.length > 0
      ? [{ id: "home-bestsellers", label: t("bestsellers") }]
      : []),
    { id: "home-engagements", label: t("trustEyebrow") },
    ...(reviews.length > 0
      ? [{ id: "home-avis", label: t("reviewsEyebrow"), tone: "dark" as const }]
      : []),
    { id: "home-showroom", label: t("showroomEyebrow") },
    { id: "home-rejoindre", label: t("ctaEyebrow"), tone: "dark" as const },
  ];

  return (
    <div className="min-h-screen bg-bg-secondary relative">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBlocks) }} />
      <PublicSidebar shopName={shopName} tenantSlug="beliandjolie" />
      <HomeSectionIndicator sections={sections} />

      <main className="relative z-10">
        {/* 1. Hero refondu 2026-09-28 — bloc info navy à gauche, FAQ blanche à
              droite. Remplace l'ancienne bannière image + la section FAQ du bas
              de page. L'adresse + les horaires du showroom viennent des mêmes
              clés i18n que la section ShowroomSection plus bas (pas de
              doublonnage), le nombre de références vient de la BDD (cache
              tenant scopé) et le nombre de catégories = celles avec au moins
              un produit vendable. */}
        <div id="home-hero" className="scroll-mt-20">
          <HeroInfoFaq
            productCount={productCount}
            categoryCount={categories.length}
            showroomAddress={`${t("showroomAddressLine1")}, ${t("showroomAddressLine2")}`}
            showroomHours={t("showroomHoursValue")}
            faqItems={faqItems}
            companyPhone={companyPhone}
            companyWhatsapp={companyWhatsapp}
            heroImages={heroImages}
          />
        </div>

        {/* 2. Nouveautés — 8 max + CTA « Voir toutes les nouveautés → » */}
        {newCards.length > 0 && (
          <div id="home-nouveautes" className="scroll-mt-20">
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
          </div>
        )}

        {/* 2b. Section pédagogique matériaux (déplacée après les nouveautés
             le 2026-09-28 sur demande cliente) : explique en clair « Acier
             304L · Placage PVD 14K » et les avantages pour les clientes
             finales, juste après avoir montré les produits frais du moment. */}
        <div id="home-materiaux" className="scroll-mt-20">
          <MaterialQualitySection />
        </div>

        {/* 3. Catégories */}
        {categories.length > 0 && (
          <div id="home-categories" className="scroll-mt-20">
            <CategoryGrid categories={categories} />
          </div>
        )}

        {/* 4. Collections du moment (3 max) */}
        {collections.length > 0 && (
          <div id="home-collections" className="scroll-mt-20">
            <CollectionsGrid collections={collections} />
          </div>
        )}

        {/* 5. Best Sellers — 8 max + CTA « Voir tous les best sellers → » */}
        {bestSellerCards.length > 0 && (
          <div id="home-bestsellers" className="scroll-mt-20">
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
          </div>
        )}

        {/* 6. Réassurance numérotée 01-04 */}
        <div id="home-engagements" className="scroll-mt-20">
          <TrustBand />
        </div>

        {/* 7. Avis clients (3-5, éditables depuis l'admin, masqué si vide) */}
        {reviews.length > 0 && (
          <div id="home-avis" className="scroll-mt-20">
            <ReviewsSection
              reviews={reviews}
              eyebrow={t("reviewsEyebrow")}
              title={t("reviewsTitle")}
            />
          </div>
        )}

        {/* La FAQ a migré tout en haut de page (colonne droite du hero
             refondu). Le JSON-LD FAQPage reste injecté par HomePage — aucun
             changement SEO côté rich results. */}

        {/* 9. Showroom — adresse + carte OpenStreetMap + CTA itinéraire.
             Coordonnées : 90 rue de la Haie Coq, 93300 Aubervilliers. */}
        <div id="home-showroom" className="scroll-mt-20">
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
        </div>

        {/* 10. CTA final « Inscription pro » */}
        <div id="home-rejoindre" className="scroll-mt-20">
          <CtaBanner />
        </div>
      </main>

      <Footer shopName={shopName} />
    </div>
  );
}
