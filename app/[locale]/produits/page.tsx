import { Suspense } from "react";
import { permanentRedirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { getTranslations, getLocale } from "next-intl/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseDisplayConfig, getOrderedProductIds } from "@/lib/product-display";
import { getCachedCategories, getCachedCollections, getCachedColors, getCachedTags, getCachedSiteConfig, getCachedShopName, getCachedCompositions, getCachedProductCount } from "@/lib/cached-data";
import { getCurrentTenantId, getCurrentTenantSlug } from "@/lib/tenant";
import { buildAlternates } from "@/lib/seo";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import SearchFilters from "@/components/produits/SearchFilters";
import ProductsInfiniteScroll from "@/components/produits/ProductsInfiniteScroll";
import { getProductPrimaryColorId } from "@/lib/product-primary-color";
import { enrichProductsWithBestPromoPercent } from "@/lib/enrich-products-promos";
import { PUBLIC_SELLABLE_COLORS_CLAUSE } from "@/lib/public-product-visibility";
import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import ProduitsIssymaLayout from "@/components/issyma/ProduitsIssymaLayout";
import type { CarouselProduct } from "@/components/home/ProductCarousel";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  await getCurrentTenantId(); // bind ALS avant les caches tenant-scopés
  const { locale } = await params;
  const [shopName, tMeta, alternates] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
    // Canonical explicite vers /fr|en/produits sans query params : tue les
    // doublons Search Console causés par les filtres (?cat=, ?color=, ?page=)
    // qui étaient tous indexés séparément.
    buildAlternates("/produits", locale),
  ]);
  return {
    title: tMeta("productsTitle", { shopName }),
    description: tMeta("productsDescription"),
    alternates,
  };
}

const PER_PAGE = 20;

function buildProductInclude(locale: string) {
  return {
    category:      { select: { name: true } },
    subCategories: { select: { name: true }, take: 1 },
    tags:          { include: { tag: { select: { id: true, name: true } } } },
    colors: {
      where: { disabled: false },
      select: {
        id:            true,
        colorId:       true,
        unitPrice:     true,
        stock:         true,
        isPrimary:     true,
        saleType:      true,
        packQuantity:  true,
        color:         { select: { name: true, hex: true, patternImage: true } },
        variantSizes:  { orderBy: { size: { position: "asc" } }, include: { size: true } },
      },
    },
    ...(locale !== "fr" && {
      translations: { where: { locale }, select: { name: true }, take: 1 },
    }),
  } as const;
}

interface PageProps {
  searchParams: Promise<{
    q?: string; cat?: string; subcat?: string;
    collection?: string; color?: string; tag?: string;
    composition?: string;
    bestseller?: string; new?: string;
    promo?: string; ordered?: string; notOrdered?: string;
    hideOos?: string;
    minPrice?: string; maxPrice?: string;
    exactRef?: string;
  }>;
}

// Shape raw Prisma products into ProductCard-friendly format
// Le badge « Réf » n'est plus injecté sur la boutique publique — seuls PFS et
// eFashion continuent de le recevoir (voir SiteConfig
// "branded_reference_badge_enabled").
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeProducts(rawProducts: any[], imageMap: Map<string, Map<string, string>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rawProducts.map((p: any) => {
    // Si une traduction existe pour la locale demandée, on remplace `name`.
    const translatedName: string | undefined = p.translations?.[0]?.name;
    if (translatedName) p = { ...p, name: translatedName };
    // Couleur principale via helper (Product.primaryColorId + fallback isPrimary).
    const primaryColorId = getProductPrimaryColorId({
      primaryColorId: p.primaryColorId,
      colors: p.colors,
    });
    const colorMap = new Map<string, {
      groupKey: string; colorId: string; name: string; hex: string | null; patternImage?: string | null;
      firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number;
      variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; sizes: {name: string, quantity: number}[]; unitPrice: number; stock: number }[];
    }>();
    for (const v of p.colors) {
      if (!v.colorId) continue;
      const gk = v.colorId;
      if (!colorMap.has(gk)) {
        const rawFirst = imageMap.get(p.id)?.get(v.id) ?? imageMap.get(p.id)?.get(v.colorId) ?? null;
        colorMap.set(gk, {
          groupKey: gk, colorId: v.colorId, name: v.color?.name, hex: v.color?.hex, patternImage: v.color?.patternImage,
          firstImage: rawFirst,
          unitPrice: Number(v.unitPrice),
          isPrimary: primaryColorId != null && v.colorId === primaryColorId,
          totalStock: 0,
          variants: [],
        });
      }
      const cd = colorMap.get(gk)!;
      // If this variant has an image and the group doesn't yet, use it
      if (!cd.firstImage) {
        const rawFirst = imageMap.get(p.id)?.get(v.id) ?? imageMap.get(p.id)?.get(v.colorId) ?? null;
        cd.firstImage = rawFirst;
      }
      cd.unitPrice = Math.min(cd.unitPrice, Number(v.unitPrice));
      cd.totalStock += v.stock ?? 0;
      if (primaryColorId != null && v.colorId === primaryColorId) cd.isPrimary = true;
      cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, sizes: (v.variantSizes ?? []).map((vs: any) => ({ name: vs.size.name, quantity: vs.quantity })), unitPrice: Number(v.unitPrice), stock: v.stock ?? 0 });
    }
    // Masque les couleurs sans aucune image — cohérent avec la fiche produit
    // et le push marketplaces : une variante sans photo n'est jamais montrée.
    const visibleColors = [...colorMap.values()].filter((cd) => cd.firstImage != null);
    return { ...p, colors: visibleColors };
  });
}

async function fetchImages(productIds: string[]) {
  const colorImages = productIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: productIds } }, orderBy: { order: "asc" } })
    : [];
  // Key by productColorId (variant-level) instead of colorId to distinguish multi-color variants
  const imageMap = new Map<string, Map<string, string>>();
  for (const img of colorImages) {
    if (!imageMap.has(img.productId)) imageMap.set(img.productId, new Map());
    const cm = imageMap.get(img.productId)!;
    const key = img.productColorId ?? img.colorId;
    if (!cm.has(key)) cm.set(key, img.path);
  }
  return imageMap;
}

export default async function ProduitsPage({ searchParams }: PageProps) {
  await getCurrentTenantId(); // bind ALS avant Prisma + caches tenant-scopés
  const [t, session, shopName, locale, tenantSlug] = await Promise.all([
    getTranslations("products"),
    getServerSession(authOptions),
    getCachedShopName(),
    getLocale(),
    getCurrentTenantSlug(),
  ]);
  const productInclude = buildProductInclude(locale);

  // Fetch client discount + IDs des produits favoris (en parallèle).
  // On lit les favoris côté serveur pour que les cœurs soient déjà bien
  // affichés au tout premier rendu — pas de "flash" où ils paraissent vides
  // pendant que le navigateur appelle /api/favorites.
  const [clientDiscount, favoriteIdsArr] = await Promise.all([
    session?.user?.id
      ? prisma.user.findUnique({
          where: { id: session.user.id },
          select: { discountType: true, discountValue: true },
        }).then((u) =>
          u?.discountType && u.discountValue
            ? { discountType: u.discountType as "PERCENT" | "AMOUNT", discountValue: Number(u.discountValue) }
            : null
        )
      : Promise.resolve(null),
    session?.user?.id
      ? prisma.favorite.findMany({
          where: { userId: session.user.id },
          select: { productId: true },
        }).then((rows) => rows.map((r) => r.productId))
      : Promise.resolve([]),
  ]);
  const {
    q = "", cat = "", subcat = "",
    collection = "", color: colorParam = "", tag: tagId = "",
    composition: compositionId = "",
    bestseller, new: isNewParam,
    promo: promoParam, ordered: orderedParam, notOrdered: notOrderedParam,
    hideOos: hideOosParam,
    minPrice: minPriceParam, maxPrice: maxPriceParam,
    exactRef: exactRefParam,
  } = await searchParams;

  const colorIds    = colorParam ? colorParam.split(",").filter(Boolean) : [];
  const bestseller_ = bestseller === "1";
  const isNew_      = isNewParam === "1";
  const promo_      = promoParam === "1";
  const ordered_    = orderedParam === "1";
  const notOrdered_ = notOrderedParam === "1";
  const hideOos_    = hideOosParam === "1";
  const minPrice    = minPriceParam ? parseFloat(minPriceParam) : null;
  const maxPrice    = maxPriceParam ? parseFloat(maxPriceParam) : null;
  const exactRef    = exactRefParam === "1";

  // Redirection SEO : ancien lien /produits?cat=X (sans autre filtre) →
  // /categories/{slug}. Préserve le référencement Google acquis sur les
  // anciennes URLs pendant que les liens internes migrent vers la nouvelle
  // page catégorie. Ne redirige que si `cat` est le SEUL filtre : combiné
  // à un color/composition/etc., on garde le filtre catalogue.
  const onlyCatFilter =
    !!cat &&
    !q && !subcat && !collection && colorIds.length === 0 && !tagId && !compositionId &&
    !bestseller_ && !isNew_ && !promo_ && !ordered_ && !notOrdered_ && !hideOos_ &&
    minPrice === null && maxPrice === null && !exactRef;
  if (onlyCatFilter) {
    const target = await prisma.category.findFirst({
      where: { id: cat },
      select: { slug: true },
    });
    if (target?.slug) permanentRedirect(`/${locale}/categories/${target.slug}`);
  }

  const hasFilters = !!(q || cat || subcat || collection || colorIds.length > 0 || tagId || compositionId || bestseller_ || isNew_ || promo_ || ordered_ || notOrdered_ || hideOos_ || minPrice !== null || maxPrice !== null || exactRef);

  // ─── Fetch filter options + site config (cached — revalidate every hour) ───
  // Note : l'ancien reglage global "show_out_of_stock_products" a ete retire —
  // les produits dont toutes les variantes sont a 0 sont desormais archives
  // automatiquement et donc deja masques par le filtre status. On garde
  // uniquement le filtre per-request hideOos (toggle utilisateur).
  // Deux textes distincts, éditables dans Admin → Paramètres → SEO :
  //  - `produits_seo_intro` : phrase courte en haut de page (au-dessus des filtres)
  //  - `produits_seo_text` : paragraphe long affiché en bas (utile pour Google)
  // Chacun a sa variante `_en` saisie par l'admin. Locale visiteur `en` →
  // lit d'abord `_en`, fallback FR si vide (évite qu'une boutique partiellement
  // traduite affiche du vide).
  const wantEn = locale === "en";
  const [categories, collections, colors, tags, compositions, seoTextRow, seoIntroRow, seoTextRowEn, seoIntroRowEn] = await Promise.all([
    getCachedCategories(),
    getCachedCollections(),
    getCachedColors(),
    getCachedTags(),
    getCachedCompositions(),
    getCachedSiteConfig("produits_seo_text"),
    getCachedSiteConfig("produits_seo_intro"),
    wantEn ? getCachedSiteConfig("produits_seo_text_en") : Promise.resolve(null),
    wantEn ? getCachedSiteConfig("produits_seo_intro_en") : Promise.resolve(null),
  ]);
  const seoIntroSource =
    (wantEn && seoIntroRowEn?.value?.trim()) || seoIntroRow?.value?.trim() || "";
  const seoTextSource =
    (wantEn && seoTextRowEn?.value?.trim()) || seoTextRow?.value?.trim() || "";
  // Les textes ne s'affichent qu'en l'absence de filtres — évite de polluer
  // les pages de résultats filtrées.
  const produitsSeoIntro = !hasFilters ? seoIntroSource : "";
  const produitsSeoText = !hasFilters ? seoTextSource : "";

  // Le toggle "Masquer les ruptures" reste affiche cote UI catalogue.
  const showOosToggle = true;

  // Fetch ordered product references for the current user (for ordered/notOrdered filters)
  let userOrderedRefs: string[] = [];
  if ((ordered_ || notOrdered_) && session?.user?.id) {
    const orderItems = await prisma.orderItem.findMany({
      where: { order: { userId: session.user.id } },
      select: { productRef: true },
      distinct: ["productRef"],
    });
    userOrderedRefs = orderItems.map((oi) => oi.productRef);
  }

  let products: ReturnType<typeof shapeProducts> = [];
  let totalCount = 0;
  let initialHasMore = false;
  let usedCustom = false;

  // ─── Custom ordering (no filters) ──────────────────────────────────────────
  if (!hasFilters) {
    const configRow = await getCachedSiteConfig("product_display_config");
    const displayConfig = parseDisplayConfig(configRow?.value);

    if (displayConfig.catalogMode === "custom" && displayConfig.sections.length > 0) {
      usedCustom = true;
      const orderedIds = await getOrderedProductIds(displayConfig);
      totalCount = orderedIds.length;
      const pageIds = orderedIds.slice(0, PER_PAGE);

      if (pageIds.length > 0) {
        const rawProducts = await prisma.product.findMany({
          where: {
            id: { in: pageIds },
            status: "ONLINE",
            colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
          },
          include: productInclude,
        });
        // Re-sort to match ordered IDs
        const idOrder = new Map(pageIds.map((id, i) => [id, i]));
        rawProducts.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

        const imageMap = await fetchImages(pageIds);
        products = shapeProducts(rawProducts, imageMap);
      }
      initialHasMore = PER_PAGE < totalCount;
    }
  }

  // ─── Default / filtered ordering (fallback) ────────────────────────────────
  if (!usedCustom) {
    // Use AND array to avoid key collisions (colors, NOT, etc.)
    // `shouldHideOos` reste accepté (URL param) mais est désormais couvert par
    // le filtre visibilité publique posé dans le `where` racine.
    const andConditions: Record<string, unknown>[] = [];
    if (notOrdered_ && userOrderedRefs.length > 0) andConditions.push({ NOT: { reference: { in: userOrderedRefs } } });
    if (colorIds.length === 1) andConditions.push({ colors: { some: { colorId: colorIds[0] } } });
    else if (colorIds.length > 1) andConditions.push({ colors: { some: { colorId: { in: colorIds } } } });
    if (promo_) andConditions.push({ discountPercent: { gt: 0 } });
    if (minPrice !== null || maxPrice !== null) {
      andConditions.push({ colors: { some: { unitPrice: { ...(minPrice !== null && { gte: minPrice }), ...(maxPrice !== null && { lte: maxPrice }) } } } });
    }

    const where: Record<string, unknown> = {
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
      ...(collection     && { collections: { some: { collectionId: collection } } }),
      ...(tagId          && { tags: { some: { tagId } } }),
      ...(compositionId  && { compositions: { some: { compositionId } } }),
      ...(bestseller_ && { isBestSeller: true }),
      ...(isNew_      && {
        OR: [
          { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          { lastRefreshedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        ],
      }),
      ...(ordered_ && userOrderedRefs.length > 0 && { reference: { in: userOrderedRefs } }),
      ...(ordered_ && userOrderedRefs.length === 0 && { id: "___none___" }), // no results if never ordered anything
    };

    // Compteur : sans filtre on partage le cache "product-count" pour rester
    // aligné avec le hero et la page inscription (sinon les 3 pages affichent
    // des nombres qui divergent selon la fraîcheur de leur cache respectif).
    // Avec filtres, on re-compte à chaque requête (résultat filtré uniquement).
    const [rawProducts, count] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: isNew_
          ? [{ lastRefreshedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
          : { createdAt: "desc" },
        take: PER_PAGE,
        include: productInclude,
      }),
      hasFilters
        ? prisma.product.count({ where })
        : getCachedProductCount(),
    ]);

    const imageMap = await fetchImages(rawProducts.map(p => p.id));
    products = shapeProducts(rawProducts, imageMap);
    totalCount = count;
    initialHasMore = rawProducts.length === PER_PAGE && rawProducts.length < count;
  }

  // Enrichit avec le meilleur % promo AUTO applicable à chaque produit
  // (override du discountPercent manuel si une promo est plus forte).
  products = await enrichProductsWithBestPromoPercent(products);

  // Dispatch tenant : Issyma reçoit son propre layout bordeaux (grille + sidebar
  // bordeaux + hero avec CTA "Créer mon compte pro" + tuiles réassurance).
  // Infinite scroll BJ-only pour l'instant (Issyma affiche la 1re page seulement).
  const effectiveSlug = await getEffectiveTenantSlug();
  if (effectiveSlug === "issyma") {
    // Traduction des noms de filtres (Categories, Collections, Colors,
    // Compositions, Tags). En locale FR, on ne fait rien (map vide) ;
    // en EN, on charge en parallèle les traductions des lignes concernées.
    let catTr = new Map<string, string>();
    let colTr = new Map<string, string>();
    let colorTr = new Map<string, string>();
    let compTr = new Map<string, string>();
    let tagTr = new Map<string, string>();
    if (locale !== "fr") {
      const [catRows, colRows, colorRows, compRows, tagRows] = await Promise.all([
        prisma.categoryTranslation.findMany({
          where: { locale, categoryId: { in: categories.map((c) => c.id) } },
          select: { categoryId: true, name: true },
        }),
        prisma.collectionTranslation.findMany({
          where: { locale, collectionId: { in: collections.map((c) => c.id) } },
          select: { collectionId: true, name: true },
        }),
        prisma.colorTranslation.findMany({
          where: { locale, colorId: { in: colors.map((c) => c.id) } },
          select: { colorId: true, name: true },
        }),
        prisma.compositionTranslation.findMany({
          where: { locale, compositionId: { in: compositions.map((c) => c.id) } },
          select: { compositionId: true, name: true },
        }),
        prisma.tagTranslation.findMany({
          where: { locale, tagId: { in: tags.map((t) => t.id) } },
          select: { tagId: true, name: true },
        }),
      ]);
      for (const r of catRows) if (r.name) catTr.set(r.categoryId, r.name);
      for (const r of colRows) if (r.name) colTr.set(r.collectionId, r.name);
      for (const r of colorRows) if (r.name) colorTr.set(r.colorId, r.name);
      for (const r of compRows) if (r.name) compTr.set(r.compositionId, r.name);
      for (const r of tagRows) if (r.name) tagTr.set(r.tagId, r.name);
    }

    const issymaProducts: CarouselProduct[] = products.map((p) => ({
      id: p.id,
      name: p.name,
      reference: p.reference,
      category: p.category?.name ?? "",
      subCategory: p.subCategories?.[0]?.name ?? null,
      colors: p.colors,
      tags: (p.tags ?? []).map((tt: { tag: { id: string; name: string } }) => ({ id: tt.tag.id, name: tt.tag.name })),
      isBestSeller: !!p.isBestSeller,
      isNew: false,
      discountPercent: p.discountPercent ?? null,
    }));
    return (
      <ProduitsIssymaLayout
        shopName={shopName}
        products={issymaProducts}
        totalCount={totalCount}
        categories={categories.map((c) => ({ id: c.id, name: catTr.get(c.id) ?? c.name }))}
        collections={collections.map((c) => ({ id: c.id, name: colTr.get(c.id) ?? c.name }))}
        colors={colors.map((c) => ({ id: c.id, name: colorTr.get(c.id) ?? c.name, hex: c.hex ?? null }))}
        compositions={compositions.map((c) => ({ id: c.id, name: compTr.get(c.id) ?? c.name }))}
        tags={tags.map((tg) => ({ id: tg.id, name: tagTr.get(tg.id) ?? tg.name }))}
        selectedFilters={{
          q: q || undefined,
          cat: cat || undefined,
          collection: collection || undefined,
          color: colorIds[0] || undefined,
          composition: compositionId || undefined,
          tag: tagId || undefined,
          bestseller: bestseller_,
          isNew: isNew_,
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white relative">
      <PublicSidebar shopName={shopName} tenantSlug={tenantSlug ?? undefined} />
      <main className="relative z-10">

      {/* Hero éditorial */}
      <section className="bg-gradient-to-b from-[#fafaf7] to-white">
        <div className="max-w-[1500px] mx-auto px-6 lg:px-10 pt-14 pb-12 lg:pt-24 lg:pb-20">
          <div className="animate-fadeIn">
            <div className="flex items-center gap-4 mb-6 lg:mb-8">
              <span className="inline-block w-10 h-px bg-black" />
              <span className="text-[11px] font-medium uppercase tracking-[0.32em] text-neutral-500 font-body">
                {t("heroEyebrow")}
              </span>
            </div>
            <h1 className="font-heading font-light text-4xl md:text-6xl lg:text-[84px] leading-[0.95] tracking-tight text-black max-w-4xl">
              {t("title")}
            </h1>
            <p className="mt-6 lg:mt-8 text-neutral-600 max-w-lg leading-relaxed text-[15px] font-body">
              {t("subtitle")}
            </p>
            {produitsSeoIntro && (
              <div className="mt-6 max-w-2xl text-[14px] font-body text-neutral-500 leading-relaxed whitespace-pre-line">
                {produitsSeoIntro}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Contenu principal */}
      <section className="max-w-[1500px] mx-auto px-6 lg:px-10 pt-6 lg:pt-10 pb-24">
        <div className="lg:flex lg:gap-12">
          {/* Sidebar filtres desktop */}
          <aside className="hidden lg:block w-60 shrink-0">
            <Suspense>
              <SearchFilters
                categories={categories}
                collections={collections}
                colors={colors}
                tags={tags}
                compositions={compositions}
                totalCount={totalCount}
                showOosToggle={showOosToggle}
              />
            </Suspense>
          </aside>

          {/* Grille */}
          <div className="flex-1 min-w-0">
            {/* Barre mobile filtres */}
            <div className="lg:hidden mb-6">
              <Suspense>
                <SearchFilters
                  categories={categories}
                  collections={collections}
                  colors={colors}
                  tags={tags}
                  compositions={compositions}
                  totalCount={totalCount}
                  showOosToggle={showOosToggle}
                  mobileMode
                />
              </Suspense>
            </div>

            {/* Compteur discret desktop */}
            <div className="hidden lg:flex items-baseline justify-between mb-10">
              <div className="text-[13px] text-neutral-500 font-body">
                <span className="text-black font-medium">{totalCount}</span> {totalCount > 1 ? t("productsCounterPlural") : t("productsCounterSingular")}
              </div>
            </div>

            {/* Grille + infinite scroll */}
            <Suspense>
              <ProductsInfiniteScroll
                initialProducts={products}
                initialHasMore={initialHasMore}
                totalCount={totalCount}
                clientDiscount={clientDiscount}
                initialFavoriteIds={favoriteIdsArr}
              />
            </Suspense>
          </div>
        </div>
      </section>

      {/* Texte SEO long — affiché sous la grille pour ne pas noyer les filtres */}
      {produitsSeoText && (
        <section className="border-t border-neutral-200 bg-neutral-50 py-12 lg:py-16">
          <div className="max-w-[900px] mx-auto px-6 lg:px-10">
            <div className="prose prose-sm sm:prose-base max-w-none font-body text-neutral-600 leading-relaxed whitespace-pre-line">
              {produitsSeoText}
            </div>
          </div>
        </section>
      )}

      </main>
      <Footer shopName={shopName} />
    </div>
  );
}
