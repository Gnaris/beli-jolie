import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import SearchFilters from "@/components/produits/SearchFilters";
import ProductsInfiniteScroll from "@/components/produits/ProductsInfiniteScroll";

export const metadata: Metadata = {
  title: "Catalogue — Beli & Jolie",
};

const PER_PAGE = 20;

interface PageProps {
  searchParams: Promise<{
    q?: string; cat?: string; subcat?: string;
    collection?: string; color?: string; tag?: string;
    bestseller?: string; new?: string;
    minPrice?: string; maxPrice?: string;
  }>;
}

export default async function ProduitsPage({ searchParams }: PageProps) {
  const {
    q = "", cat = "", subcat = "",
    collection = "", color: colorId = "", tag: tagId = "",
    bestseller, new: isNewParam,
    minPrice: minPriceParam, maxPrice: maxPriceParam,
  } = await searchParams;

  const bestseller_ = bestseller === "1";
  const isNew_      = isNewParam === "1";
  const minPrice    = minPriceParam ? parseFloat(minPriceParam) : null;
  const maxPrice    = maxPriceParam ? parseFloat(maxPriceParam) : null;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const where: Record<string, unknown> = {
    ...(q && {
      OR: [
        { name:      { contains: q } },
        { reference: { contains: q } },
        { tags: { some: { tag: { name: { contains: q.toLowerCase() } } } } },
      ],
    }),
    ...(cat        && { categoryId: cat }),
    ...(subcat     && { subCategories: { some: { id: subcat } } }),
    ...(collection && { collections: { some: { collectionId: collection } } }),
    ...(colorId    && { colors: { some: { colorId } } }),
    ...(tagId      && { tags: { some: { tagId } } }),
    ...(bestseller_ && { isBestSeller: true }),
    ...(isNew_      && { createdAt: { gte: thirtyDaysAgo } }),
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

  const [products, totalCount, categories, collections, colors, tags] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take:    PER_PAGE,
      include: {
        category:      { select: { name: true } },
        subCategories: { select: { name: true }, take: 1 },
        tags:          { include: { tag: { select: { id: true, name: true } } } },
        colors: {
          select: {
            id:        true,
            unitPrice: true,
            isPrimary: true,
            color:     { select: { name: true, hex: true } },
            images:    { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
            saleOptions: {
              select: { id: true, saleType: true, packQuantity: true, size: true },
            },
          },
        },
      },
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { subCategories: { orderBy: { name: "asc" } } },
    }),
    prisma.collection.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.color.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, hex: true } }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const initialHasMore = products.length === PER_PAGE && products.length < totalCount;

  return (
    <div className="flex min-h-screen">
      <PublicSidebar />
      <div className="flex-1 lg:ml-60 pt-14 lg:pt-0 min-w-0">
        <main className="min-h-screen bg-[#F5F5F5]">
          {/* En-tête page */}
          <div className="bg-white border-b border-[#E5E5E5]">
            <div className="container-site py-6">
              <h1 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#1A1A1A]">
                Catalogue
              </h1>
              <p className="text-sm text-[#999999] font-[family-name:var(--font-roboto)] mt-0.5">
                Bijoux en acier inoxydable — tarifs professionnels
              </p>
            </div>
          </div>

          <div className="container-site py-6 space-y-5">
            {/* Filtres */}
            <Suspense>
              <SearchFilters
                categories={categories}
                collections={collections}
                colors={colors}
                tags={tags}
                totalCount={totalCount}
              />
            </Suspense>

            {/* Grille + infinite scroll */}
            <Suspense>
              <ProductsInfiniteScroll
                initialProducts={products}
                initialHasMore={initialHasMore}
              />
            </Suspense>
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
