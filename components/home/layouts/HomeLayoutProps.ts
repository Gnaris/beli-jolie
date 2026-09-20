import type { CarouselProduct, ClientDiscountInfo } from "@/components/home/ProductCarousel";
import type { HeroOverlaySettings } from "@/lib/hero-overlay";
import type { HomeReview } from "@/lib/customer-reviews";
import type { HomeFaqItem } from "@/lib/home-faq";

export interface HomeCategoryItem {
  id: string;
  slug: string;
  name: string;
  /** Nom localisé pour l'affichage (fallback = name FR). */
  displayName?: string;
  image: string | null;
  _count: { products: number };
}

export interface HomeCollectionItem {
  id: string;
  slug: string | null;
  name: string;
  /** Nom localisé pour l'affichage (fallback = name FR). */
  displayName?: string;
  image: string | null;
  _count: { products: number };
}

export interface HomeHeroOverrides {
  heroEyebrow?: string;
  heroTitleLine1?: string;
  heroTitleLine2?: string;
  heroDescription?: string;
  heroCtaSecondaryLabel?: string;
  heroCtaSecondaryHref?: string;
  overlay: HeroOverlaySettings;
}

/**
 * Contrat partagé par tous les layouts de home (un par tenant).
 * Les données sont fetchées **une seule fois** dans `app/[locale]/page.tsx`
 * puis passées au layout choisi selon le slug du tenant courant.
 * Chaque layout peut ignorer les champs qui ne l'intéressent pas.
 */
export interface HomeLayoutProps {
  shopName: string;
  bannerImage: string | null;
  heroOverrides: HomeHeroOverrides;
  productCount: number;
  clientDiscount: ClientDiscountInfo | null;
  favoriteIds: string[];
  newCards: CarouselProduct[];
  bestSellerCards: CarouselProduct[];
  categories: HomeCategoryItem[];
  collections: HomeCollectionItem[];
  reviews: HomeReview[];
  faqItems: HomeFaqItem[];
  jsonLdBlocks: object[];
  /** Session autorisée à voir les prix (ADMIN ou CLIENT APPROVED). Utilisé
   *  pour masquer les prix aux visiteurs anonymes sur la home Issyma. */
  canSeePrices: boolean;
}
