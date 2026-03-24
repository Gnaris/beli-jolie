import { Suspense } from "react";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedCategories, getCachedCollections, getCachedColors, getCachedTags } from "@/lib/cached-data";
import SearchFilters from "@/components/produits/SearchFilters";
import ProductCard from "@/components/produits/ProductCard";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Mes favoris — Beli & Jolie",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{
    q?: string; cat?: string; subcat?: string;
    collection?: string; color?: string; tag?: string;
    bestseller?: string; new?: string;
    minPrice?: string; maxPrice?: string;
    exactRef?: string;
    page?: string;
  }>;
}

const NEW_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export default async function FavorisPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion?callbackUrl=/favoris");

  const [tFav, tProd] = await Promise.all([
    getTranslations("favorites"),
    getTranslations("products"),
  ]);

  const {
    q = "", cat = "", subcat = "",
    collection = "", color: colorId = "", tag: tagId = "",
    bestseller, new: isNewParam,
    minPrice: minPriceParam, maxPrice: maxPriceParam,
    exactRef: exactRefParam,
    page: pageParam,
  } = await searchParams;

  const bestseller_ = bestseller === "1";
  const isNew_      = isNewParam === "1";
  const minPrice    = minPriceParam ? parseFloat(minPriceParam) : null;
  const maxPrice    = maxPriceParam ? parseFloat(maxPriceParam) : null;
  const exactRef    = exactRefParam === "1";
  const page        = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const PAGE_SIZE   = 20;

  // Build the product filter (mirrors /produits logic)
  const productWhere: Record<string, unknown> = {
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
    ...(colorId    && { colors: { some: { colorId } } }),
    ...(tagId      && { tags: { some: { tagId } } }),
    ...(bestseller_ && { isBestSeller: true }),
    ...(isNew_      && { createdAt: { gte: new Date(Date.now() - NEW_THRESHOLD_MS) } }),
    ...((minPrice !== null || maxPrice !== null) && {
      colors: {
        some: {
          unitPrice: {
            ...(minPrice !== null && { gte: minPrice }),
            ...(maxPrice !== null && { lte: maxPrice }),
          },
        },
      },
    }),
  };

  const [rawFavorites, totalCount, categories, collections, colors, tags] = await Promise.all([
    prisma.favorite.findMany({
      where: { userId: session.user.id, product: productWhere },
      include: {
        product: {
          include: {
            category:      { select: { name: true } },
            subCategories: { select: { name: true }, take: 1 },
            tags:          { include: { tag: { select: { id: true, name: true } } } },
            colors: {
              orderBy: { isPrimary: "desc" },
              select: {
                id:           true,
                colorId:      true,
                unitPrice:    true,
                stock:        true,
                isPrimary:    true,
                saleType:     true,
                packQuantity: true,
                color:        { select: { name: true, hex: true, patternImage: true } },
                subColors:    { orderBy: { position: "asc" as const }, select: { color: { select: { name: true, hex: true, patternImage: true } } } },
                variantSizes: { orderBy: { size: { position: "asc" } }, include: { size: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.favorite.count({ where: { userId: session.user.id, product: productWhere } }),
    getCachedCategories(),
    getCachedCollections(),
    getCachedColors(),
    getCachedTags(),
  ]);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Fetch first images per (productId, colorId)
  const favProductIds = rawFavorites.map((f) => f.product.id);
  const favColorImages = favProductIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: favProductIds } }, orderBy: { order: "asc" } })
    : [];
  const favImageMap = new Map<string, Map<string, string>>();
  for (const img of favColorImages) {
    if (!favImageMap.has(img.productId)) favImageMap.set(img.productId, new Map());
    const cm = favImageMap.get(img.productId)!;
    const imgKey = img.productColorId ?? img.colorId;
    if (!cm.has(imgKey)) cm.set(imgKey, img.path);
  }

  function favGroupKey(colorId: string, subColorNames: string[]): string {
    if (subColorNames.length === 0) return colorId;
    return `${colorId}::${subColorNames.join(",")}`;
  }

  // Group variants by color group key (colorId + sub-colors)
  const favorites = rawFavorites.map((fav) => {
    const p = fav.product;
    const colorMap = new Map<string, {
      groupKey: string; colorId: string; name: string; hex: string | null; patternImage?: string | null; subColors?: { name: string; hex: string; patternImage?: string | null }[];
      firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number;
      variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; sizes: {name: string, quantity: number}[]; unitPrice: number; stock: number }[];
    }>();
    for (const v of p.colors) {
      if (!v.colorId) continue;
      const subNames: string[] = (v as any).subColors?.map((sc: { color: { name: string } }) => sc.color.name) ?? [];
      const gk = favGroupKey(v.colorId, subNames);
      if (!colorMap.has(gk)) {
        const subs = (v as any).subColors?.map((sc: { color: { name: string; hex: string | null; patternImage?: string | null } }) => ({ name: sc.color.name, hex: sc.color.hex ?? "#9CA3AF", patternImage: sc.color.patternImage })) ?? [];
        colorMap.set(gk, {
          groupKey: gk, colorId: v.colorId, name: v.color?.name ?? "", hex: v.color?.hex ?? null, patternImage: (v.color as any)?.patternImage ?? null,
          subColors: subs.length > 0 ? subs : undefined,
          firstImage: favImageMap.get(p.id)?.get(v.id) ?? null,
          unitPrice: v.unitPrice, isPrimary: v.isPrimary, totalStock: 0, variants: [],
        });
      }
      const cd = colorMap.get(gk)!;
      if (!cd.firstImage) cd.firstImage = favImageMap.get(p.id)?.get(v.id) ?? null;
      cd.unitPrice = Math.min(cd.unitPrice, v.unitPrice);
      cd.totalStock += v.stock ?? 0;
      if (v.isPrimary) cd.isPrimary = true;
      cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, sizes: ((v as any).variantSizes ?? []).map((vs: any) => ({ name: vs.size.name, quantity: vs.quantity })), unitPrice: v.unitPrice, stock: v.stock ?? 0 });
    }
    return { ...fav, product: { ...p, colors: [...colorMap.values()] } };
  });

  const now = Date.now();

  return (
    <>
      {/* En-tête page */}
      <div className="bg-bg-primary border-b border-border">
        <div className="container-site py-6">
          <h1 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-text-primary">
            {tFav("title")}
          </h1>
          <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
            {totalCount !== 1 ? tFav("count_plural", { count: totalCount }) : tFav("count", { count: totalCount })}
          </p>
        </div>
      </div>

      <div className="py-6 pl-3 pr-4 sm:pl-4 sm:pr-6 lg:pr-8">
        <div className="flex gap-5">
          {/* Sidebar filtres — desktop */}
          <aside className="hidden lg:block w-60 shrink-0">
            <Suspense>
              <SearchFilters
                basePath="/favoris"
                categories={categories}
                collections={collections}
                colors={colors}
                tags={tags}
                totalCount={totalCount}
              />
            </Suspense>
          </aside>

          {/* Contenu principal */}
          <div className="flex-1 min-w-0 space-y-5">
            {/* Barre mobile : filtres + compteur */}
            <div className="lg:hidden">
              <Suspense>
                <SearchFilters
                  basePath="/favoris"
                  categories={categories}
                  collections={collections}
                  colors={colors}
                  tags={tags}
                  totalCount={totalCount}
                  mobileMode
                />
              </Suspense>
            </div>

            {/* Grille produits ou état vide */}
            {favorites.length === 0 ? (
              <div className="bg-white border border-[#E5E5E5] rounded-xl p-12 text-center">
                <svg
                  className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                  />
                </svg>
                {totalCount === 0 && !q && !cat && !subcat && !collection && !colorId && !tagId && !bestseller_ && !isNew_ && minPrice === null && maxPrice === null ? (
                  <>
                    <p className="font-[family-name:var(--font-roboto)] font-medium text-[#6B6B6B] mb-1">
                      {tFav("empty")}
                    </p>
                    <p className="text-sm font-[family-name:var(--font-roboto)] text-[#9CA3AF] mb-6">
                      {tFav("emptyDesc")}
                    </p>
                    <Link
                      href="/produits"
                      className="inline-flex items-center justify-center px-5 py-2.5 bg-[#1A1A1A] text-white text-sm font-[family-name:var(--font-roboto)] font-medium rounded-lg hover:bg-[#333] transition-colors"
                    >
                      {tFav("browseCatalogue")}
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="font-[family-name:var(--font-roboto)] font-medium text-[#6B6B6B] mb-1">
                      {tFav("noResults")}
                    </p>
                    <p className="text-sm font-[family-name:var(--font-roboto)] text-[#9CA3AF] mb-6">
                      {tFav("noResultsDesc")}
                    </p>
                    <Link
                      href="/favoris"
                      className="inline-flex items-center justify-center px-5 py-2.5 bg-[#1A1A1A] text-white text-sm font-[family-name:var(--font-roboto)] font-medium rounded-lg hover:bg-[#333] transition-colors"
                    >
                      {tProd("resetFilters")}
                    </Link>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                {favorites.map(({ product }) => (
                  <ProductCard
                    key={product.id}
                    id={product.id}
                    name={product.name}
                    reference={product.reference}
                    category={product.category.name}
                    subCategory={product.subCategories[0]?.name ?? null}
                    colors={product.colors}
                    tags={product.tags.map((t) => ({ id: t.tag.id, name: t.tag.name }))}
                    isFavorite={true}
                    isBestSeller={product.isBestSeller}
                    isNew={product.createdAt.getTime() > now - NEW_THRESHOLD_MS}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                {page > 1 && (
                  <Link
                    href={`/favoris?${new URLSearchParams({ ...(q && { q }), ...(cat && { cat }), ...(subcat && { subcat }), ...(collection && { collection }), ...(colorId && { color: colorId }), ...(tagId && { tag: tagId }), page: String(page - 1) }).toString()}`}
                    className="px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-text-secondary border border-border rounded-lg hover:bg-bg-secondary transition-colors"
                  >
                    &larr;
                  </Link>
                )}
                <span className="text-sm font-[family-name:var(--font-roboto)] text-text-muted">
                  {page} / {totalPages}
                </span>
                {page < totalPages && (
                  <Link
                    href={`/favoris?${new URLSearchParams({ ...(q && { q }), ...(cat && { cat }), ...(subcat && { subcat }), ...(collection && { collection }), ...(colorId && { color: colorId }), ...(tagId && { tag: tagId }), page: String(page + 1) }).toString()}`}
                    className="px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-text-secondary border border-border rounded-lg hover:bg-bg-secondary transition-colors"
                  >
                    &rarr;
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
