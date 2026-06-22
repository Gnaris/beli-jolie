import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { getTranslations, getLocale } from "next-intl/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseDisplayConfig, getOrderedProductIds } from "@/lib/product-display";
import { getCachedCategories, getCachedCollections, getCachedColors, getCachedTags, getCachedSiteConfig, getCachedShopName, getCachedCompositions } from "@/lib/cached-data";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import SearchFilters from "@/components/produits/SearchFilters";
import ProductsInfiniteScroll from "@/components/produits/ProductsInfiniteScroll";
import { getProductPrimaryColorId } from "@/lib/product-primary-color";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tMeta] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
  ]);
  return {
    title: tMeta("productsTitle", { shopName }),
    description: tMeta("productsDescription"),
    alternates: { canonical: "/produits" },
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
        colorMap.set(gk, {
          groupKey: gk, colorId: v.colorId, name: v.color?.name, hex: v.color?.hex, patternImage: v.color?.patternImage,
          firstImage: imageMap.get(p.id)?.get(v.id) ?? imageMap.get(p.id)?.get(v.colorId) ?? null,
          unitPrice: Number(v.unitPrice),
          isPrimary: primaryColorId != null && v.colorId === primaryColorId,
          totalStock: 0,
          variants: [],
        });
      }
      const cd = colorMap.get(gk)!;
      // If this variant has an image and the group doesn't yet, use it
      if (!cd.firstImage) cd.firstImage = imageMap.get(p.id)?.get(v.id) ?? imageMap.get(p.id)?.get(v.colorId) ?? null;
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
  const [t, session, shopName, locale] = await Promise.all([
    getTranslations("products"),
    getServerSession(authOptions),
    getCachedShopName(),
    getLocale(),
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

  const hasFilters = !!(q || cat || subcat || collection || colorIds.length > 0 || tagId || compositionId || bestseller_ || isNew_ || promo_ || ordered_ || notOrdered_ || hideOos_ || minPrice !== null || maxPrice !== null || exactRef);

  // ─── Fetch filter options + site config (cached — revalidate every hour) ───
  // Note : l'ancien reglage global "show_out_of_stock_products" a ete retire —
  // les produits dont toutes les variantes sont a 0 sont desormais archives
  // automatiquement et donc deja masques par le filtre status. On garde
  // uniquement le filtre per-request hideOos (toggle utilisateur).
  const [categories, collections, colors, tags, compositions, seoTextRow] = await Promise.all([
    getCachedCategories(),
    getCachedCollections(),
    getCachedColors(),
    getCachedTags(),
    getCachedCompositions(),
    getCachedSiteConfig("produits_seo_text"),
  ]);
  const produitsSeoText = !hasFilters ? (seoTextRow?.value?.trim() ?? "") : "";

  // Le toggle "Masquer les ruptures" reste affiche cote UI catalogue.
  const showOosToggle = true;
  const shouldHideOos = hideOos_;

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
          where: { id: { in: pageIds } },
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
    const andConditions: Record<string, unknown>[] = [];
    if (shouldHideOos) andConditions.push({ NOT: { colors: { every: { stock: { equals: 0 } } } } });
    if (notOrdered_ && userOrderedRefs.length > 0) andConditions.push({ NOT: { reference: { in: userOrderedRefs } } });
    if (colorIds.length === 1) andConditions.push({ colors: { some: { colorId: colorIds[0] } } });
    else if (colorIds.length > 1) andConditions.push({ colors: { some: { colorId: { in: colorIds } } } });
    if (promo_) andConditions.push({ discountPercent: { gt: 0 } });
    if (minPrice !== null || maxPrice !== null) {
      andConditions.push({ colors: { some: { unitPrice: { ...(minPrice !== null && { gte: minPrice }), ...(maxPrice !== null && { lte: maxPrice }) } } } });
    }

    const where: Record<string, unknown> = {
      status: "ONLINE",
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

    const [rawProducts, count] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: isNew_
          ? [{ lastRefreshedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
          : { createdAt: "desc" },
        take: PER_PAGE,
        include: productInclude,
      }),
      prisma.product.count({ where }),
    ]);

    const imageMap = await fetchImages(rawProducts.map(p => p.id));
    products = shapeProducts(rawProducts, imageMap);
    totalCount = count;
    initialHasMore = rawProducts.length === PER_PAGE && rawProducts.length < count;
  }

  return (
    <div className="min-h-screen bg-bg-secondary relative">
      <PublicSidebar shopName={shopName} />
      <main className="relative z-10">
      {/* En-tete page */}
      <div className="bg-bg-primary border-b border-border relative overflow-hidden">
        <div className="container-site py-6 relative">
          <h1 className="font-heading text-xl font-semibold text-text-primary">
            {t("title")}
          </h1>
          <p className="text-sm text-text-muted font-body mt-0.5">
            {t("subtitle")}
          </p>
          {produitsSeoText && (
            <div className="mt-4 max-w-3xl text-sm font-body text-text-secondary leading-relaxed whitespace-pre-line">
              {produitsSeoText}
            </div>
          )}
        </div>
      </div>

      <div className="relative flex">
        {/* Sidebar filtres — desktop (sticky, s'arrête au footer) */}
        <aside className="hidden lg:block w-64 shrink-0">
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

        {/* Contenu principal */}
        <div className="flex-1 min-w-0 p-4 sm:p-6 lg:py-6 lg:px-8 space-y-5">
          {/* Barre mobile : filtres + compteur */}
          <div className="lg:hidden">
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
      </main>
      <Footer shopName={shopName} />
    </div>
  );
}
