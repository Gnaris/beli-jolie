import type { CarouselProduct, ClientDiscountInfo } from "@/components/home/ProductCarousel";
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

/**
 * Contrat partagé par tous les layouts de home (un par tenant).
 * Les données sont fetchées **une seule fois** dans `app/[locale]/page.tsx`
 * puis passées au layout choisi selon le slug du tenant courant.
 * Chaque layout peut ignorer les champs qui ne l'intéressent pas.
 */
export interface HomeLayoutProps {
  shopName: string;
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
  /** Téléphone entreprise (CompanyInfo.phone), utilisé pour construire les
   *  liens `tel:` / `wa.me` du hero BJ. null si non renseigné. */
  companyPhone: string | null;
  /** Numéro WhatsApp entreprise (CompanyInfo.whatsapp) — fallback sur
   *  companyPhone si null côté consommateur. */
  companyWhatsapp: string | null;
  /** Paths d'images produit à afficher en fond décoratif du hero BJ.
   *  Tirés au hasard une fois par jour (cache 24 h tenant-scopé). Vide
   *  sur Issyma (le layout Issyma ne l'utilise pas). */
  heroImages: string[];
}
