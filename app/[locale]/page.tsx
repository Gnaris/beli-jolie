import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { getTranslations, getLocale } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedSiteConfig, getCachedShopName, getCachedProductCount } from "@/lib/cached-data";
import { buildAlternates, buildWebsiteSchema, buildSiteNavigationSchema, getSiteUrl } from "@/lib/seo";
import { getPublishedCustomerReviews } from "@/lib/customer-reviews";
import { parseHomeFaq, resolveHomeFaqForLocale, buildFaqJsonLd } from "@/lib/home-faq";
import { CarouselProduct } from "@/components/home/ProductCarousel";
import { enrichProductsWithBestPromoPercent } from "@/lib/enrich-products-promos";
import { parseHeroOverlay } from "@/lib/hero-overlay";
import { getProductPrimaryColorId } from "@/lib/product-primary-color";
import { canSeePrices } from "@/lib/price-visibility";
import { PUBLIC_SELLABLE_COLORS_CLAUSE } from "@/lib/public-product-visibility";
import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import {
  loadHomeTranslationLookups,
  translateCategoryLike,
  translateCollectionName,
  translateProductName,
} from "@/lib/home-translations";
import HomeBeliandjolieLayout from "@/components/home/layouts/HomeBeliandjolieLayout";
import HomeIssymaLayout from "@/components/home/layouts/HomeIssymaLayout";
import type { HomeLayoutProps } from "@/components/home/layouts/HomeLayoutProps";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const wantEn = locale === "en";
  const [shopName, tMeta, siteUrl, alternates, taglineRow, taglineRowEn] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
    getSiteUrl(),
    buildAlternates("/", locale),
    getCachedSiteConfig("seo_tagline"),
    wantEn ? getCachedSiteConfig("seo_tagline_en") : Promise.resolve(null),
  ]);
  // Le title de la home = tagline configurable par tenant (Paramètres SEO).
  // Locale EN : priorité à la version anglaise si saisie, sinon fallback FR.
  // Fallback ultime = message i18n générique. Le template `%s | shopName` du
  // layout racine ajoute automatiquement le suffixe — on ne le réécrit pas ici.
  const tagline =
    (wantEn && taglineRowEn?.value?.trim()) || taglineRow?.value?.trim() || "";
  const homeTitle = tagline || tMeta("homeTitle");
  return {
    title: homeTitle,
    description: tMeta("homeDescription", { shopName }),
    alternates,
    openGraph: {
      type: "website",
      siteName: shopName,
      title: homeTitle,
      description: tMeta("homeOgDescription", { shopName }),
      url: `${siteUrl}/${locale}`,
    },
  };
}

// ─────────────────────────────────────────────
// Helpers de mise en forme Prisma → CarouselProduct
// (même shape que la card /fr/produits — voir components/produits/ProductCard.tsx)
// ─────────────────────────────────────────────
type PrismaProduct = {
  id: string;
  name: string;
  reference: string;
  discountPercent: number | null;
  categoryId: string | null;
  primaryColorId: string | null;
  isBestSeller: boolean;
  createdAt: Date;
  lastRefreshedAt: Date | null;
  category: { name: string };
  subCategories: { name: string }[];
  tags: { tag: { id: string; name: string } }[];
  colors: {
    id: string;
    colorId: string | null;
    unitPrice: number;
    isPrimary: boolean;
    saleType: string;
    packQuantity: number | null;
    stock: number;
    color: { name: string; hex: string | null; patternImage?: string | null } | null;
    variantSizes: { size: { name: string }; quantity: number }[];
  }[];
};

function toCarousel(products: PrismaProduct[], imageMap: Map<string, Map<string, string>>): CarouselProduct[] {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return products.map((p) => {
    const primaryColorId = getProductPrimaryColorId({
      primaryColorId: p.primaryColorId,
      colors: p.colors,
    });

    // Groupement par couleur (groupKey = colorId), même logique que /fr/produits.
    const colorMap = new Map<string, {
      colorId: string; groupKey: string; hex: string | null; patternImage: string | null;
      name: string; isPrimary: boolean; unitPrice: number; totalStock: number;
      firstImage: string | null;
      variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; sizes: { name: string; quantity: number }[]; unitPrice: number; stock: number }[];
    }>();

    for (const c of p.colors) {
      if (!c.colorId) continue;
      const groupKey = c.colorId;
      const price = Number(c.unitPrice);
      const isPrimaryColor = primaryColorId != null && c.colorId === primaryColorId;
      const variant = {
        id: c.id,
        saleType: (c.saleType === "PACK" ? "PACK" : "UNIT") as "UNIT" | "PACK",
        packQuantity: c.packQuantity ?? null,
        unitPrice: price,
        stock: c.stock ?? 0,
        sizes: (c.variantSizes ?? []).map((vs) => ({ name: vs.size.name, quantity: vs.quantity })),
      };

      const existing = colorMap.get(groupKey);
      if (existing) {
        existing.variants.push(variant);
        existing.unitPrice = Math.min(existing.unitPrice, price);
        existing.totalStock += c.stock ?? 0;
        if (isPrimaryColor) existing.isPrimary = true;
        if (!existing.firstImage) {
          existing.firstImage = imageMap.get(p.id)?.get(c.id) ?? imageMap.get(p.id)?.get(c.colorId) ?? null;
        }
      } else {
        colorMap.set(groupKey, {
          colorId: c.colorId,
          groupKey,
          hex: c.color?.hex ?? null,
          patternImage: c.color?.patternImage ?? null,
          name: c.color?.name ?? "",
          isPrimary: isPrimaryColor,
          unitPrice: price,
          totalStock: c.stock ?? 0,
          firstImage: imageMap.get(p.id)?.get(c.id) ?? imageMap.get(p.id)?.get(c.colorId) ?? null,
          variants: [variant],
        });
      }
    }

    const createdMs = p.createdAt ? new Date(p.createdAt).getTime() : 0;
    const refreshedMs = p.lastRefreshedAt ? new Date(p.lastRefreshedAt).getTime() : 0;

    return {
      id:              p.id,
      name:            p.name,
      reference:       p.reference,
      category:        p.category.name,
      subCategory:     p.subCategories[0]?.name ?? null,
      tags:            (p.tags ?? []).map((t) => ({ id: t.tag.id, name: t.tag.name })),
      isBestSeller:    p.isBestSeller,
      isNew:           Math.max(createdMs, refreshedMs) > thirtyDaysAgo,
      discountPercent: p.discountPercent != null ? Number(p.discountPercent) : null,
      // Masque les couleurs sans image — cohérent avec fiche produit + push marketplaces.
      colors: [...colorMap.values()]
        .filter((c) => c.firstImage != null)
        .map((c) => ({
          groupKey:     c.groupKey,
          colorId:      c.colorId,
          hex:          c.hex,
          patternImage: c.patternImage,
          name:         c.name,
          firstImage:   c.firstImage,
          unitPrice:    c.unitPrice,
          isPrimary:    c.isPrimary,
          totalStock:   c.totalStock,
          variants:     c.variants,
        })),
    };
  });
}

/** Convert Prisma Decimal fields to plain numbers so the data matches PrismaProduct */
function serializeProducts(products: Array<Record<string, unknown>>): PrismaProduct[] {
  return products.map((p: any) => ({
    ...p,
    discountPercent: p.discountPercent != null ? Number(p.discountPercent) : null,
    categoryId: p.categoryId ?? null,
    primaryColorId: p.primaryColorId ?? null,
    isBestSeller: !!p.isBestSeller,
    subCategories: p.subCategories ?? [],
    tags: p.tags ?? [],
    colors: p.colors.map((c: any) => ({
      ...c,
      unitPrice: Number(c.unitPrice),
      stock: Number(c.stock ?? 0),
      packQuantity: c.packQuantity != null ? Number(c.packQuantity) : null,
    })),
  }));
}

const PRODUCT_SELECT = {
  id: true,
  name: true,
  reference: true,
  discountPercent: true,
  categoryId: true,
  primaryColorId: true,
  isBestSeller: true,
  createdAt: true,
  lastRefreshedAt: true,
  category: { select: { name: true } },
  subCategories: { select: { name: true }, take: 1 },
  tags: { include: { tag: { select: { id: true, name: true } } } },
  colors: {
    where: { disabled: false },
    select: {
      id:            true,
      colorId:       true,
      unitPrice:     true,
      isPrimary:     true,
      saleType:      true,
      packQuantity:  true,
      stock:         true,
      color:         { select: { name: true, hex: true, patternImage: true } },
      variantSizes:  { orderBy: { size: { position: "asc" as const } }, select: { size: { select: { name: true } }, quantity: true } },
    },
  },
} as const;

// Nombre d'items affichés sur la homepage — le catalogue complet reste
// accessible via les CTA « Voir toutes les nouveautés → » et « Voir tous les
// best sellers → ». Choix commercial : page plus courte, feeling premium.
const HOME_PRODUCTS_LIMIT = 8;
const HOME_COLLECTIONS_LIMIT = 3;
const HOME_CATEGORIES_LIMIT = 6;

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────
export default async function HomePage() {
  const [session, t] = await Promise.all([
    getServerSession(authOptions),
    getTranslations("home"),
  ]);
  const userId  = session?.user?.id;

  // ── Load site config (bannière + hero éditable + FAQ) + avis clients DB ──
  const [
    bannerImageRow,
    shopName,
    heroEyebrowRow,
    heroTitle1Row,
    heroTitle2Row,
    heroDescRow,
    heroCta2LabelRow,
    heroCta2HrefRow,
    homeFaqRow,
    reviews,
    overlayTypeRow,
    overlayDirectionRow,
    overlayColorRow,
    overlayOpacityRow,
  ] = await Promise.all([
    getCachedSiteConfig("banner_image"),
    getCachedShopName(),
    getCachedSiteConfig("home_hero_eyebrow"),
    getCachedSiteConfig("home_hero_title_line1"),
    getCachedSiteConfig("home_hero_title_line2"),
    getCachedSiteConfig("home_hero_description"),
    getCachedSiteConfig("home_hero_cta_secondary_label"),
    getCachedSiteConfig("home_hero_cta_secondary_href"),
    getCachedSiteConfig("home_faq"),
    getPublishedCustomerReviews(6),
    getCachedSiteConfig("home_hero_overlay_type"),
    getCachedSiteConfig("home_hero_overlay_direction"),
    getCachedSiteConfig("home_hero_overlay_color"),
    getCachedSiteConfig("home_hero_overlay_opacity"),
  ]);
  const bannerImage = bannerImageRow?.value ?? null;
  const heroOverlay = parseHeroOverlay({
    type: overlayTypeRow?.value ?? null,
    direction: overlayDirectionRow?.value ?? null,
    color: overlayColorRow?.value ?? null,
    opacity: overlayOpacityRow?.value ?? null,
  });
  const heroOverrides = {
    heroEyebrow: heroEyebrowRow?.value ?? undefined,
    heroTitleLine1: heroTitle1Row?.value ?? undefined,
    heroTitleLine2: heroTitle2Row?.value ?? undefined,
    heroDescription: heroDescRow?.value ?? undefined,
    heroCtaSecondaryLabel: heroCta2LabelRow?.value ?? undefined,
    heroCtaSecondaryHref: heroCta2HrefRow?.value ?? undefined,
    overlay: heroOverlay,
  } as const;
  const faqItems = parseHomeFaq(homeFaqRow?.value);

  // ── Fetch client discount + favoris (pour cœurs déjà remplis au 1er rendu) ─
  const [clientDiscount, favoriteIds] = await Promise.all([
    userId
      ? prisma.user.findUnique({
          where: { id: userId },
          select: { discountType: true, discountValue: true },
        }).then((u) =>
          u?.discountType && u.discountValue
            ? { discountType: u.discountType as "PERCENT" | "AMOUNT", discountValue: Number(u.discountValue) }
            : null
        )
      : Promise.resolve(null),
    userId
      ? prisma.favorite.findMany({
          where: { userId },
          select: { productId: true },
        }).then((rows) => rows.map((r) => r.productId))
      : Promise.resolve([] as string[]),
  ]);

  // ── Fetch collections + counts + catégories ────────────────────────────────
  // Le compteur produits partage le CACHE avec la page inscription et le hero :
  // `getCachedProductCount()` (5min, tag "products", scopé tenant). Sans ça,
  // le nombre affiché divergeait entre home (frais) et /inscription (caché).
  const [allCollections, productCount, allCategories] = await Promise.all([
    prisma.collection.findMany({
      orderBy: { createdAt: "desc" },
      select:  { id: true, slug: true, name: true, image: true, _count: { select: { products: { where: { product: { status: "ONLINE" } } } } } },
    }),
    getCachedProductCount(),
    prisma.category.findMany({
      // Ordre pilotable par le drag & drop de /admin/categories. `name` en
      // second critère pour rester déterministe quand plusieurs positions
      // valent 0 (catégories jamais réordonnées).
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select:  { id: true, slug: true, name: true, image: true, _count: { select: { products: { where: { status: "ONLINE" } } } } },
    }),
  ]);

  // Ne garder que catégories & collections avec ≥ 1 produit ONLINE ; on limite
  // catégories à 6 et collections à 3 pour rester dans l'esprit « sélections du
  // moment » (page plus courte + plus premium). Les listes complètes restent
  // accessibles depuis /categories et /collections.
  const categories = allCategories
    .filter(c => c._count.products > 0)
    .slice(0, HOME_CATEGORIES_LIMIT);
  const collections = allCollections
    .filter(c => c._count.products > 0)
    .slice(0, HOME_COLLECTIONS_LIMIT);

  // ── Fetch produits homepage : 8 nouveautés + 8 best sellers ────────────────
  // Ces 2 listes sont figées (plus de mécanisme configurable). Le catalogue
  // complet reste accessible via les CTA « Voir toutes… → ».
  const commonProductWhere = {
    status: "ONLINE" as const,
    colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
  };

  const [newProductsRaw, bestSellerProductsRaw] = await Promise.all([
    prisma.product.findMany({
      where:   commonProductWhere,
      orderBy: { createdAt: "desc" },
      take:    HOME_PRODUCTS_LIMIT,
      select:  PRODUCT_SELECT,
    }),
    prisma.product.findMany({
      // « Les plus récents ajoutés en best-seller » — tri par date de bascule
      // en best-seller si dispo, sinon par createdAt (choix cliente).
      where:   { ...commonProductWhere, isBestSeller: true },
      orderBy: { createdAt: "desc" },
      take:    HOME_PRODUCTS_LIMIT,
      select:  PRODUCT_SELECT,
    }),
  ]);

  const newProducts = serializeProducts(newProductsRaw as Array<Record<string, unknown>>);
  const bestSellerProducts = serializeProducts(bestSellerProductsRaw as Array<Record<string, unknown>>);

  // Images de tous les produits chargés en une seule requête
  const allIds = [...new Set([...newProducts, ...bestSellerProducts].map(p => p.id))];
  const imgRows = allIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: allIds } }, orderBy: { order: "asc" } })
    : [];
  const imageMap = new Map<string, Map<string, string>>();
  for (const img of imgRows) {
    if (!imageMap.has(img.productId)) imageMap.set(img.productId, new Map());
    const cm = imageMap.get(img.productId)!;
    if (!cm.has(img.colorId)) cm.set(img.colorId, img.path);
  }

  // Enrichit chaque produit avec le meilleur % promo AUTO applicable (override
  // du discountPercent manuel). Une seule passe sur les 2 listes.
  const enrichedFlat = await enrichProductsWithBestPromoPercent([...newProducts, ...bestSellerProducts]);
  const enrichedById = new Map(enrichedFlat.map((p) => [p.id, p]));
  const applyEnrichment = (list: PrismaProduct[]) => list.map((p) => enrichedById.get(p.id) ?? p);

  const newCards = toCarousel(applyEnrichment(newProducts), imageMap);
  const bestSellerCards = toCarousel(applyEnrichment(bestSellerProducts), imageMap);

  // ── Pré-traduction des noms catalog pour la locale courante ────────────────
  // Le layout Issyma est un Server Component qui inline le rendu (pas de hook
  // client `useProductTranslation`). On résout donc ici, une fois pour toutes,
  // les noms de catégories / collections / produits — DB > dictionnaire > FR.
  // On **n'écrase pas** `name` (utilisé pour construire les URLs produit) : les
  // valeurs traduites sont posées dans `displayName` / `displayCategory` etc.
  // Locale par défaut (fr) → aucune requête, aucun coût.
  const currentLocaleForTranslate = await getLocale();
  const productNamesForTranslate = [...newCards, ...bestSellerCards].map((p) => p.name);
  const categoryNamesForTranslate = [
    ...categories.map((c) => c.name),
    ...newCards.map((p) => p.category),
    ...bestSellerCards.map((p) => p.category),
  ];
  const subCategoryNamesForTranslate = [...newCards, ...bestSellerCards]
    .map((p) => p.subCategory)
    .filter((s): s is string => Boolean(s));
  const collectionNamesForTranslate = collections.map((c) => c.name);
  const translationLookups = await loadHomeTranslationLookups(currentLocaleForTranslate, {
    categoryNames: categoryNamesForTranslate,
    subCategoryNames: subCategoryNamesForTranslate,
    collectionNames: collectionNamesForTranslate,
    productNames: productNamesForTranslate,
  });

  const translatedCategories = categories.map((c) => ({
    ...c,
    displayName: translateCategoryLike(c.name, currentLocaleForTranslate, translationLookups),
  }));
  const translatedCollections = collections.map((c) => ({
    ...c,
    displayName: translateCollectionName(c.name, currentLocaleForTranslate, translationLookups),
  }));
  const translateCard = (p: CarouselProduct): CarouselProduct => ({
    ...p,
    displayName: translateProductName(p.name, currentLocaleForTranslate, translationLookups),
    displayCategory: translateCategoryLike(p.category, currentLocaleForTranslate, translationLookups),
    displaySubCategory: p.subCategory
      ? translateCategoryLike(p.subCategory, currentLocaleForTranslate, translationLookups)
      : p.subCategory,
  });
  const translatedNewCards = newCards.map(translateCard);
  const translatedBestSellerCards = bestSellerCards.map(translateCard);

  // ── FAQ localisée ─────────────────────────────────────────────────────────
  // Si la cliente a saisi une version EN (Paramètres → Vitrine, onglet 🇬🇧)
  // et qu'on est en /en, on l'affiche. Sinon fallback FR — comme ça la FAQ ne
  // devient jamais vide sur /en même sans traduction.
  const localizedFaqItems = resolveHomeFaqForLocale(faqItems, currentLocaleForTranslate);

  // JSON-LD WebSite (avec SearchAction). Organization est rendu dans le layout
  // racine, pas de doublon. SiteNavigationElement = signal explicite à Google
  // des pages principales, pour maximiser les chances d'affichage de
  // sitelinks. Miroir de la nav du header.
  const siteUrl = await getSiteUrl();
  const webSiteJsonLd = buildWebsiteSchema({ name: shopName, url: siteUrl });
  const currentLocale = currentLocaleForTranslate;
  const navJsonLd = buildSiteNavigationSchema({
    baseUrl: siteUrl,
    locale: currentLocale,
    links: [
      { name: t("newProducts"), path: "/produits" },
      { name: t("collections"), path: "/collections" },
      { name: t("categoriesTitle"), path: "/categories" },
      { name: "À propos", path: "/a-propos" },
      { name: "Nous contacter", path: "/nous-contacter" },
    ],
  });
  // JSON-LD FAQPage — donne à Google le contexte pour afficher les Q&R en
  // rich results directement dans la SERP. Omis si aucune FAQ saisie.
  const jsonLdBlocks: object[] = [webSiteJsonLd, navJsonLd];
  if (localizedFaqItems.length > 0) jsonLdBlocks.push(buildFaqJsonLd(localizedFaqItems));

  // ── Dispatch vers le layout du tenant courant ──────────────────────────────
  // Chaque boutique a son propre fichier dans `components/home/layouts/`.
  // Fallback = layout Beliandjolie (design d'origine) pour tout tenant inconnu.
  const layoutProps: HomeLayoutProps = {
    shopName,
    bannerImage,
    heroOverrides,
    productCount,
    clientDiscount,
    favoriteIds,
    newCards: translatedNewCards,
    bestSellerCards: translatedBestSellerCards,
    categories: translatedCategories,
    collections: translatedCollections,
    reviews,
    faqItems: localizedFaqItems,
    jsonLdBlocks,
    canSeePrices: canSeePrices(session),
  };

  // Résolution unifiée : slug résolu par middleware + override dev-only via
  // cookie `bj_home_preview` (posé par TenantDevSwitcher). Voir lib/tenant-preview.
  const layoutChoice = await getEffectiveTenantSlug();

  return layoutChoice === "issyma" ? (
    <HomeIssymaLayout {...layoutProps} />
  ) : (
    <HomeBeliandjolieLayout {...layoutProps} />
  );
}
