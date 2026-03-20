import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseDisplayConfig, getOrderedProductIds } from "@/lib/product-display";
import { getCachedCategories, getCachedCollections, getCachedColors, getCachedTags, getCachedSiteConfig } from "@/lib/cached-data";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import FloatingShapes from "@/components/ui/FloatingShapes";
import ScatteredDecorations from "@/components/ui/ScatteredDecorations";
import SearchFilters from "@/components/produits/SearchFilters";
import ProductsInfiniteScroll from "@/components/produits/ProductsInfiniteScroll";

export const metadata: Metadata = {
  title: "Catalogue Bijoux Professionnels — Beli & Jolie",
  description: "Parcourez notre catalogue de +78 000 bijoux en acier inoxydable. Prix grossiste, livraison rapide, qualité premium pour revendeurs.",
  alternates: { canonical: "/produits" },
};

const PER_PAGE = 20;

const PRODUCT_INCLUDE = {
  category:      { select: { name: true } },
  subCategories: { select: { name: true }, take: 1 },
  tags:          { include: { tag: { select: { id: true, name: true } } } },
  colors: {
    select: {
      id:            true,
      colorId:       true,
      unitPrice:     true,
      stock:         true,
      isPrimary:     true,
      saleType:      true,
      packQuantity:  true,
      size:          true,
      discountType:  true,
      discountValue: true,
      color:         { select: { name: true, hex: true, patternImage: true } },
      subColors:     { orderBy: { position: "asc" as const }, select: { color: { select: { name: true, hex: true, patternImage: true } } } },
    },
  },
} as const;

interface PageProps {
  searchParams: Promise<{
    q?: string; cat?: string; subcat?: string;
    collection?: string; color?: string; tag?: string;
    bestseller?: string; new?: string;
    promo?: string; ordered?: string; notOrdered?: string;
    hideOos?: string;
    minPrice?: string; maxPrice?: string;
    exactRef?: string;
  }>;
}

// Variant group key: colorId + ordered sub-color names (order matters)
function variantGroupKey(colorId: string, subColorNames: string[]): string {
  if (subColorNames.length === 0) return colorId;
  return `${colorId}::${subColorNames.join(",")}`;
}

// Shape raw Prisma products into ProductCard-friendly format
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeProducts(rawProducts: any[], imageMap: Map<string, Map<string, string>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rawProducts.map((p: any) => {
    const colorMap = new Map<string, {
      groupKey: string; colorId: string; name: string; hex: string | null; patternImage?: string | null; subColors?: { name: string; hex: string; patternImage?: string | null }[];
      firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number;
      variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; size: string | null; unitPrice: number; stock: number; discountType: "PERCENT" | "AMOUNT" | null; discountValue: number | null }[];
    }>();
    for (const v of p.colors) {
      const subNames: string[] = v.subColors?.map((sc: { color: { name: string } }) => sc.color.name) ?? [];
      const gk = variantGroupKey(v.colorId, subNames);
      if (!colorMap.has(gk)) {
        const subs = v.subColors?.map((sc: { color: { name: string; hex: string | null; patternImage?: string | null } }) => ({ name: sc.color.name, hex: sc.color.hex ?? "#9CA3AF", patternImage: sc.color.patternImage })) ?? [];
        colorMap.set(gk, {
          groupKey: gk, colorId: v.colorId, name: v.color.name, hex: v.color.hex, patternImage: v.color.patternImage,
          subColors: subs.length > 0 ? subs : undefined,
          firstImage: imageMap.get(p.id)?.get(v.id) ?? null,
          unitPrice: v.unitPrice, isPrimary: v.isPrimary, totalStock: 0, variants: [],
        });
      }
      const cd = colorMap.get(gk)!;
      // If this variant has an image and the group doesn't yet, use it
      if (!cd.firstImage) cd.firstImage = imageMap.get(p.id)?.get(v.id) ?? null;
      cd.unitPrice = Math.min(cd.unitPrice, v.unitPrice);
      cd.totalStock += v.stock ?? 0;
      if (v.isPrimary) cd.isPrimary = true;
      cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, size: v.size ?? null, unitPrice: v.unitPrice, stock: v.stock ?? 0, discountType: v.discountType ?? null, discountValue: v.discountValue ?? null });
    }
    return { ...p, colors: [...colorMap.values()] };
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
  const [t, session] = await Promise.all([
    getTranslations("products"),
    getServerSession(authOptions),
  ]);

  // Fetch client discount
  const clientDiscount = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { discountType: true, discountValue: true },
      }).then((u) =>
        u?.discountType && u.discountValue
          ? { discountType: u.discountType as "PERCENT" | "AMOUNT", discountValue: u.discountValue }
          : null
      )
    : null;
  const {
    q = "", cat = "", subcat = "",
    collection = "", color: colorParam = "", tag: tagId = "",
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

  const hasFilters = !!(q || cat || subcat || collection || colorIds.length > 0 || tagId || bestseller_ || isNew_ || promo_ || ordered_ || notOrdered_ || hideOos_ || minPrice !== null || maxPrice !== null || exactRef);

  // ─── Fetch filter options + site config (cached — revalidate every hour) ───
  const [categories, collections, colors, tags, stockProductsConfig] = await Promise.all([
    getCachedCategories(),
    getCachedCollections(),
    getCachedColors(),
    getCachedTags(),
    getCachedSiteConfig("show_out_of_stock_products"),
  ]);

  const showOosProducts = stockProductsConfig?.value !== "false"; // default true
  // showOosToggle: only show the toggle if admin allows OOS products by default
  const showOosToggle = showOosProducts;

  // If admin has disabled OOS products OR user toggled hideOos, exclude fully OOS products
  const shouldHideOos = !showOosProducts || hideOos_;

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
          include: PRODUCT_INCLUDE,
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
    if (promo_) andConditions.push({ colors: { some: { discountValue: { gt: 0 } } } });
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
      ...(cat        && { categoryId: cat }),
      ...(subcat     && { subCategories: { some: { id: subcat } } }),
      ...(collection && { collections: { some: { collectionId: collection } } }),
      ...(tagId      && { tags: { some: { tagId } } }),
      ...(bestseller_ && { isBestSeller: true }),
      ...(isNew_      && { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
      ...(ordered_ && userOrderedRefs.length > 0 && { reference: { in: userOrderedRefs } }),
      ...(ordered_ && userOrderedRefs.length === 0 && { id: "___none___" }), // no results if never ordered anything
    };

    const [rawProducts, count] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: PER_PAGE,
        include: PRODUCT_INCLUDE,
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
      <FloatingShapes />
      <PublicSidebar />
      <main className="relative z-10">
      {/* En-tete page */}
      <div className="bg-bg-primary border-b border-border relative overflow-hidden">
        <ScatteredDecorations variant="sparse" seed={1} />
        <div className="container-site py-6 relative">
          <h1 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-text-primary">
            {t("title")}
          </h1>
          <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
            {t("subtitle")}
          </p>
        </div>
      </div>

      <div className="py-6 pl-3 pr-4 sm:pl-4 sm:pr-6 lg:pr-8 relative overflow-hidden">
        <ScatteredDecorations variant="dense" seed={100} />
        <div className="flex gap-5">
          {/* Sidebar filtres — desktop */}
          <aside className="hidden lg:block w-60 shrink-0">
            <Suspense>
              <SearchFilters
                categories={categories}
                collections={collections}
                colors={colors}
                tags={tags}
                totalCount={totalCount}
                showOosToggle={showOosToggle}
              />
            </Suspense>
          </aside>

          {/* Contenu principal */}
          <div className="flex-1 min-w-0 space-y-5">
            {/* Barre mobile : filtres + compteur */}
            <div className="lg:hidden">
              <Suspense>
                <SearchFilters
                  categories={categories}
                  collections={collections}
                  colors={colors}
                  tags={tags}
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
                clientDiscount={clientDiscount}
              />
            </Suspense>
          </div>
        </div>
      </div>
      </main>
      <Footer />
    </div>
  );
}
