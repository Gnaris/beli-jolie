import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import Image from "@/components/ui/SmartImage";
import { prisma } from "@/lib/prisma";
import {
  getCachedShopName,
  getCachedPublicCategories,
  getCachedPublicColors,
  getCachedPublicTags,
  getCachedPublicCompositions,
} from "@/lib/cached-data";
import { getCurrentTenantSlug } from "@/lib/tenant";
import { buildAlternates, getSiteUrl } from "@/lib/seo";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import ProductCard from "@/components/produits/ProductCard";
import SearchFilters from "@/components/produits/SearchFilters";
import { getProductPrimaryColorId } from "@/lib/product-primary-color";
import { PUBLIC_SELLABLE_COLORS_CLAUSE } from "@/lib/public-product-visibility";
import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import CollectionDetailIssymaLayout from "@/components/issyma/CollectionDetailIssymaLayout";
import type { CarouselProduct } from "@/components/home/ProductCarousel";
import CollectionVisitTracker from "@/components/collections/CollectionVisitTracker";
import { computeFilterCounts, type ProductFilterSummary, type FilterState } from "@/lib/public-filter-counts";

interface PageProps {
  params: Promise<{ slug: string; locale: string }>;
  searchParams: Promise<{
    q?: string; cat?: string; subcat?: string;
    color?: string; tag?: string; composition?: string;
    bestseller?: string; trending?: string; new?: string;
    promo?: string; ordered?: string; notOrdered?: string;
    hideOos?: string;
    minPrice?: string; maxPrice?: string;
    exactRef?: string;
  }>;
}

/**
 * Résout une collection à partir du segment URL. Priorité au slug (URL propre
 * `/collections/eclat-automne-2026`) ; fallback sur l'ancien cuid → 301 vers
 * la version slug (préserve le SEO acquis + backlinks).
 */
async function resolveCollectionHandle(handle: string) {
  // Collections masquées : 404 sur la page détail (parité avec /collections
  // qui ne les liste pas). `visible: true` filtre les deux lookups.
  const bySlug = await prisma.collection.findFirst({
    where: { slug: handle, visible: true },
    select: { id: true, slug: true },
  });
  if (bySlug) return { kind: "slug" as const, id: bySlug.id, slug: bySlug.slug };

  // Cuids : `cm...` — on tente une résolution par id uniquement si l'aspect
  // colle, pour éviter un findFirst inutile sur des slugs random.
  if (/^c[a-z0-9]{20,}$/i.test(handle)) {
    const byId = await prisma.collection.findFirst({
      where: { id: handle, visible: true },
      select: { id: true, slug: true },
    });
    if (byId?.slug) return { kind: "legacyId" as const, id: byId.id, slug: byId.slug };
  }
  return null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, locale } = await params;

  const resolved = await resolveCollectionHandle(slug);
  if (!resolved) return {};

  const col = await prisma.collection.findFirst({
    where: { id: resolved.id },
    select: {
      name: true,
      image: true,
      imageBanner: true,
      slug: true,
      translations: { where: { locale }, select: { name: true }, take: 1 },
    },
  });
  if (!col || !col.slug) return {};
  const [shopName, siteUrl, alternates] = await Promise.all([
    getCachedShopName(),
    getSiteUrl(),
    buildAlternates(`/collections/${col.slug}`, locale),
  ]);
  const localizedName = col.translations[0]?.name ?? col.name;
  const title = `${localizedName} — Collections ${shopName}`;
  const description = `Découvrez la collection ${localizedName} sur ${shopName}. Sélection grossiste pour professionnels.`;
  // Priorité à la bannière pour OG (format paysage plus proche de ce que Twitter/FB
  // attendent) ; sinon fallback sur l'image de carte.
  const ogSource = col.imageBanner ?? col.image;
  const imageUrl = ogSource ? (ogSource.startsWith("http") ? ogSource : `${siteUrl}${ogSource}`) : null;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: shopName,
      url: `${siteUrl}/${locale}/collections/${col.slug}`,
      ...(imageUrl && { images: [{ url: imageUrl, alt: localizedName }] }),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(imageUrl && { images: [imageUrl] }),
    },
    alternates,
  };
}

export default async function CollectionDetailPage({ params, searchParams }: PageProps) {
  const [t, shopName, tenantSlug, resolvedParams, sp] = await Promise.all([
    getTranslations("collectionDetail"),
    getCachedShopName(),
    getCurrentTenantSlug(),
    params,
    searchParams,
  ]);
  const { slug, locale } = resolvedParams;

  const resolved = await resolveCollectionHandle(slug);
  if (!resolved) notFound();

  // Ancien lien basé sur le cuid : on redirige vers l'URL slug canonique.
  if (resolved.kind === "legacyId") {
    permanentRedirect(`/${locale}/collections/${resolved.slug}`);
  }

  // ─── Parse search params (mêmes filtres que /produits, hors « collection ») ─
  const {
    q = "", cat = "", subcat = "",
    color: colorParam = "", tag: tagId = "",
    composition: compositionId = "",
    bestseller, trending: trendingParam, new: isNewParam,
    promo: promoParam, ordered: orderedParam, notOrdered: notOrderedParam,
    minPrice: minPriceParam, maxPrice: maxPriceParam,
    exactRef: exactRefParam,
  } = sp;

  const colorIds    = colorParam ? colorParam.split(",").filter(Boolean) : [];
  const bestseller_ = bestseller === "1";
  const trending_   = trendingParam === "1";
  const isNew_      = isNewParam === "1";
  const promo_      = promoParam === "1";
  const ordered_    = orderedParam === "1";
  const notOrdered_ = notOrderedParam === "1";
  const minPrice    = minPriceParam ? parseFloat(minPriceParam) : null;
  const maxPrice    = maxPriceParam ? parseFloat(maxPriceParam) : null;
  const exactRef    = exactRefParam === "1";

  const hasFilters = !!(q || cat || subcat || colorIds.length > 0 || tagId || compositionId ||
    bestseller_ || trending_ || isNew_ || promo_ || ordered_ || notOrdered_ ||
    minPrice !== null || maxPrice !== null || exactRef);

  // Références déjà commandées (pour ordered/notOrdered)
  let userOrderedRefs: string[] = [];
  if (ordered_ || notOrdered_) {
    // Session nécessaire pour ces filtres — récupérée à la volée uniquement si demandée.
    const { getServerSession } = await import("next-auth");
    const { authOptions } = await import("@/lib/auth");
    const session = await getServerSession(authOptions);
    if (session?.user?.id) {
      const orderItems = await prisma.orderItem.findMany({
        where: { order: { userId: session.user.id } },
        select: { productRef: true },
        distinct: ["productRef"],
      });
      userOrderedRefs = orderItems.map((oi) => oi.productRef);
    }
  }

  // ─── Where clause (nested sur CollectionProduct.product) ──────────────────
  const andConditions: Record<string, unknown>[] = [];
  if (notOrdered_ && userOrderedRefs.length > 0) andConditions.push({ NOT: { reference: { in: userOrderedRefs } } });
  if (colorIds.length === 1) andConditions.push({ colors: { some: { colorId: colorIds[0] } } });
  else if (colorIds.length > 1) andConditions.push({ colors: { some: { colorId: { in: colorIds } } } });
  if (promo_) andConditions.push({ discountPercent: { gt: 0 } });
  if (minPrice !== null || maxPrice !== null) {
    andConditions.push({ colors: { some: { unitPrice: { ...(minPrice !== null && { gte: minPrice }), ...(maxPrice !== null && { lte: maxPrice }) } } } });
  }

  const productWhere: Record<string, unknown> = {
    status: "ONLINE",
    colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
    ...(andConditions.length > 0 && { AND: andConditions }),
    ...(q && exactRef
      ? { reference: { equals: q.toUpperCase() } }
      : q
        ? {
            OR: [
              { name:      { contains: q } },
              { reference: { contains: q } },
              { tags: { some: { tag: { name: { contains: q.toLowerCase() } } } } },
            ],
          }
        : {}),
    ...(cat            && { categoryId: cat }),
    ...(subcat         && { subCategories: { some: { id: subcat } } }),
    ...(tagId          && { tags: { some: { tagId } } }),
    ...(compositionId  && { compositions: { some: { compositionId } } }),
    ...(bestseller_ && { isBestSeller: true }),
    ...(trending_   && { isTrending: true }),
    ...(isNew_      && {
      OR: [
        { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        { lastRefreshedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      ],
    }),
    ...(ordered_ && userOrderedRefs.length > 0 && { reference: { in: userOrderedRefs } }),
    ...(ordered_ && userOrderedRefs.length === 0 && { id: "___none___" }),
  };

  // ─── Options filtres (catalogues globaux, cachés 60 min) + projection
  // légère de TOUS les produits visibles de la collection pour les counts
  // facettés (grise les options qui donneraient 0 avec les filtres actuels).
  const [categories, colors, tags, compositions, collection, summaryRows] = await Promise.all([
    getCachedPublicCategories(),
    getCachedPublicColors(),
    getCachedPublicTags(),
    getCachedPublicCompositions(),
    prisma.collection.findFirst({
      where:   { id: resolved.id },
      include: {
        translations: { where: { locale }, select: { name: true }, take: 1 },
        products: {
          where: { product: productWhere },
          orderBy: { position: "asc" },
          include: {
            product: {
              include: {
                category:      { select: { name: true } },
                subCategories: { select: { name: true }, take: 1 },
                ...(locale !== "fr" && {
                  translations: { where: { locale }, select: { name: true }, take: 1 },
                }),
                colors: {
                  where: { disabled: false },
                  select: {
                    id:           true,
                    colorId:      true,
                    unitPrice:    true,
                    stock:        true,
                    isPrimary:    true,
                    saleType:     true,
                    packQuantity: true,
                    color:        { select: { name: true, hex: true, patternImage: true } },
                    variantSizes: { orderBy: { size: { position: "asc" } }, include: { size: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.product.findMany({
      where: {
        status: "ONLINE",
        colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
        collections: { some: { collectionId: resolved.id } },
      },
      select: {
        id:               true,
        reference:        true,
        name:             true,
        categoryId:       true,
        isBestSeller:     true,
        isTrending:       true,
        discountPercent:  true,
        createdAt:        true,
        lastRefreshedAt:  true,
        subCategories:    { select: { id: true } },
        tags:             { select: { tagId: true } },
        compositions:     { select: { compositionId: true } },
        colors: {
          where:  { disabled: false, stock: { gt: 0 } },
          select: { colorId: true, unitPrice: true },
        },
      },
    }),
  ]);

  if (!collection) notFound();

  // Projection → ProductFilterSummary (utilisé par computeFilterCounts).
  const productSummaries: ProductFilterSummary[] = summaryRows.map((p) => {
    const colorIds = Array.from(new Set(p.colors.map((c) => c.colorId).filter((cid): cid is string => !!cid)));
    const prices = p.colors.map((c) => Number(c.unitPrice)).filter((n) => !Number.isNaN(n));
    const minUnitPrice = prices.length > 0 ? Math.min(...prices) : 0;
    return {
      id: p.id,
      reference: p.reference,
      name: p.name,
      categoryId: p.categoryId,
      subCategoryIds: p.subCategories.map((sc) => sc.id),
      tagIds: p.tags.map((t) => t.tagId),
      compositionIds: p.compositions.map((c) => c.compositionId),
      colorIds,
      minUnitPrice,
      isBestSeller: p.isBestSeller,
      isTrending: p.isTrending,
      discountPercent: p.discountPercent != null ? Number(p.discountPercent) : 0,
      createdAt: p.createdAt,
      lastRefreshedAt: p.lastRefreshedAt,
    };
  });

  const filterState: FilterState = {
    q, exactRef,
    cat, subcat,
    colorIds,
    tagId, compositionId,
    minPrice, maxPrice,
    bestseller: bestseller_,
    trending: trending_,
    isNew: isNew_,
    promo: promo_,
    ordered: ordered_,
    notOrdered: notOrdered_,
  };
  const filterCounts = computeFilterCounts(productSummaries, filterState, userOrderedRefs);

  // Nom collection localisé (fallback FR si aucune CollectionTranslation).
  const localizedCollectionName = collection.translations[0]?.name ?? collection.name;

  // Bannière hero : priorité à `imageBanner` (format paysage prévu pour ça) ;
  // fallback sur `image` (miniature carte) pour rester compatible avec les
  // collections créées avant l'introduction du champ dédié (2026-09-23).
  const heroImage = collection.imageBanner ?? collection.image;

  // Fetch images for all products in collection
  const colProductIds = collection.products.map((cp) => cp.product.id);
  const colColorImages = colProductIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: colProductIds } }, orderBy: { order: "asc" } })
    : [];
  const colImageMap = new Map<string, Map<string, string>>();
  for (const img of colColorImages) {
    if (!colImageMap.has(img.productId)) colImageMap.set(img.productId, new Map());
    const cm = colImageMap.get(img.productId)!;
    const imgKey = img.productColorId ?? img.colorId;
    if (!cm.has(imgKey)) cm.set(imgKey, img.path);
  }

  // Dispatch tenant : Issyma reçoit son propre layout bordeaux.
  const effectiveSlug = await getEffectiveTenantSlug();
  if (effectiveSlug === "issyma") {
    const issymaProducts: CarouselProduct[] = collection.products.map((cp) => {
      const p = cp.product;
      const productPrimaryColorId = getProductPrimaryColorId({
        primaryColorId: p.primaryColorId,
        colors: p.colors,
      });
      const effectivePrimaryColorId = cp.colorId ?? productPrimaryColorId;
      const colorMap = new Map<string, {
        groupKey: string; colorId: string; name: string; hex: string | null; patternImage?: string | null;
        firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number;
        variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; sizes: {name: string, quantity: number}[]; unitPrice: number; stock: number }[];
      }>();
      for (const v of p.colors) {
        if (!v.colorId) continue;
        const gk = v.colorId;
        const isPrimaryColor = effectivePrimaryColorId != null && v.colorId === effectivePrimaryColorId;
        if (!colorMap.has(gk)) {
          colorMap.set(gk, {
            groupKey: gk, colorId: v.colorId, name: v.color?.name ?? "", hex: v.color?.hex ?? null,
            patternImage: (v.color as { patternImage?: string | null } | null)?.patternImage,
            firstImage: colImageMap.get(p.id)?.get(v.id) ?? colImageMap.get(p.id)?.get(v.colorId) ?? null,
            unitPrice: Number(v.unitPrice),
            isPrimary: isPrimaryColor,
            totalStock: 0,
            variants: [],
          });
        }
        const cd = colorMap.get(gk)!;
        if (!cd.firstImage) cd.firstImage = colImageMap.get(p.id)?.get(v.id) ?? colImageMap.get(p.id)?.get(v.colorId) ?? null;
        cd.unitPrice = Math.min(cd.unitPrice, Number(v.unitPrice));
        cd.totalStock += v.stock ?? 0;
        if (isPrimaryColor) cd.isPrimary = true;
        cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, sizes: (v.variantSizes ?? []).map((vs) => ({ name: vs.size.name, quantity: vs.quantity })), unitPrice: Number(v.unitPrice), stock: v.stock ?? 0 });
      }
      const visibleColors = [...colorMap.values()].filter((cd) => cd.firstImage != null);
      // Cohérent avec /produits : si une traduction produit existe pour la
      // locale demandée, on remplace le nom source par la traduction.
      const translatedProductName = (p as { translations?: { name: string }[] }).translations?.[0]?.name;
      return {
        id: p.id,
        name: translatedProductName ?? p.name,
        reference: p.reference,
        category: p.category.name,
        subCategory: p.subCategories[0]?.name ?? null,
        colors: visibleColors,
        tags: [],
        isBestSeller: false,
        isNew: false,
        discountPercent: null,
      };
    });
    return (
      <>
        <CollectionVisitTracker collectionId={collection.id} />
        <CollectionDetailIssymaLayout
          shopName={shopName}
          collectionName={localizedCollectionName}
          collectionImage={heroImage}
          products={issymaProducts}
          linkQuery={`via=collection:${collection.id}`}
        />
      </>
    );
  }

  // Dropdown « Collection » masqué (on est déjà dans une collection).
  const sidebarCollections: { id: string; name: string }[] = [];
  const totalCount = collection.products.length;

  return (
    <div className="min-h-screen">
      <CollectionVisitTracker collectionId={collection.id} />
      <PublicSidebar shopName={shopName} tenantSlug={tenantSlug ?? undefined} />

      <div className="min-w-0">
        {/* Header */}
        <div className="bg-bg-primary border-b border-border">
          {/* Cover banner (priorité imageBanner, fallback image de carte) */}
          {heroImage && (
            <div className="h-48 md:h-64 overflow-hidden relative">
              <Image
                src={heroImage}
                alt={localizedCollectionName}
                fill
                sizes="100vw"
                className="object-cover"
                priority
              />
            </div>
          )}
          <div className="container-site py-6">
            <div className="flex items-center gap-2 text-xs text-text-muted font-body mb-2">
              <Link href="/collections" className="hover:text-text-primary transition-colors">
                {t("breadcrumb")}
              </Link>
              <span>/</span>
              <span className="text-text-primary">{localizedCollectionName}</span>
            </div>
            <h1 className="font-heading text-2xl font-semibold text-text-primary">
              {localizedCollectionName}
            </h1>
            <p className="mt-1 text-sm text-text-muted font-body">
              {totalCount <= 1
                ? t("products", { count: totalCount })
                : t("products_plural", { count: totalCount })}
            </p>
          </div>
        </div>

        {/* Contenu principal — sidebar filtres collée à gauche + grille 4 cols xl */}
        <section className="pt-6 lg:pt-10 pb-24">
          <div className="lg:flex lg:gap-10">
            {/* Sidebar filtres desktop — flush left (padding interne minimal) */}
            <aside className="hidden lg:block w-60 shrink-0 pl-4 pr-4">
              <Suspense>
                <SearchFilters
                  categories={categories}
                  collections={sidebarCollections}
                  colors={colors}
                  tags={tags}
                  compositions={compositions}
                  totalCount={totalCount}
                  showOosToggle
                  basePath={`/collections/${resolved.slug}`}
                  counts={filterCounts}
                />
              </Suspense>
            </aside>

            {/* Grille */}
            <div className="flex-1 min-w-0 px-6 lg:pl-0 lg:pr-10">
              {/* Barre mobile filtres */}
              <div className="lg:hidden mb-6">
                <Suspense>
                  <SearchFilters
                    categories={categories}
                    collections={sidebarCollections}
                    colors={colors}
                    tags={tags}
                    compositions={compositions}
                    totalCount={totalCount}
                    showOosToggle
                    basePath={`/collections/${resolved.slug}`}
                    counts={filterCounts}
                    mobileMode
                  />
                </Suspense>
              </div>

              {totalCount === 0 ? (
                <div className="text-center py-20 text-text-muted font-body">
                  {t("empty")}
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
                  {collection.products.map((cp) => {
                    const p = cp.product;
                    const productPrimaryColorId = getProductPrimaryColorId({
                      primaryColorId: p.primaryColorId,
                      colors: p.colors,
                    });
                    const effectivePrimaryColorId = cp.colorId ?? productPrimaryColorId;

                    const colorMap = new Map<string, {
                      groupKey: string; colorId: string; name: string; hex: string | null; patternImage?: string | null;
                      firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number;
                      variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; sizes: {name: string, quantity: number}[]; unitPrice: number; stock: number }[];
                    }>();
                    for (const v of p.colors) {
                      if (!v.colorId) continue;
                      const gk = v.colorId;
                      const isPrimaryColor = effectivePrimaryColorId != null && v.colorId === effectivePrimaryColorId;
                      if (!colorMap.has(gk)) {
                        colorMap.set(gk, {
                          groupKey: gk, colorId: v.colorId, name: v.color?.name ?? "", hex: v.color?.hex ?? null, patternImage: (v.color as { patternImage?: string | null } | null)?.patternImage,
                          firstImage: colImageMap.get(p.id)?.get(v.id) ?? colImageMap.get(p.id)?.get(v.colorId) ?? null,
                          unitPrice: Number(v.unitPrice),
                          isPrimary: isPrimaryColor,
                          totalStock: 0,
                          variants: [],
                        });
                      }
                      const cd = colorMap.get(gk)!;
                      if (!cd.firstImage) cd.firstImage = colImageMap.get(p.id)?.get(v.id) ?? colImageMap.get(p.id)?.get(v.colorId) ?? null;
                      cd.unitPrice = Math.min(cd.unitPrice, Number(v.unitPrice));
                      cd.totalStock += v.stock ?? 0;
                      if (isPrimaryColor) cd.isPrimary = true;
                      cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, sizes: (v.variantSizes ?? []).map((vs) => ({ name: vs.size.name, quantity: vs.quantity })), unitPrice: Number(v.unitPrice), stock: v.stock ?? 0 });
                    }
                    const productColors = [...colorMap.values()].filter((cd) => cd.firstImage != null);
                    const translatedProductName = (p as { translations?: { name: string }[] }).translations?.[0]?.name;

                    return (
                      <ProductCard
                        key={cp.productId}
                        id={p.id}
                        name={translatedProductName ?? p.name}
                        reference={p.reference}
                        category={p.category.name}
                        subCategory={p.subCategories[0]?.name ?? null}
                        colors={productColors}
                        linkQuery={`via=collection:${collection.id}`}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        <Footer shopName={shopName} />
      </div>
    </div>
  );
}
