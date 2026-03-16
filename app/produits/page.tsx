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


  const where: Record<string, unknown> = {
    // Cacher les produits entièrement hors-stock (toutes couleurs à stock 0)
    NOT: { colors: { every: { stock: { equals: 0 } } } },
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
    // Nouveautés : produits créés dans les 30 derniers jours
    ...(isNew_      && { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
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
    <div className="min-h-screen bg-bg-secondary">
      <PublicSidebar />
      <main>
      {/* En-tete page */}
      <div className="bg-bg-primary border-b border-border">
        <div className="container-site py-6">
          <h1 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-text-primary">
            Catalogue
          </h1>
          <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
            Bijoux en acier inoxydable — tarifs professionnels
          </p>
        </div>
      </div>

      <div className="py-6 pl-3 pr-4 sm:pl-4 sm:pr-6 lg:pr-8">
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
                  mobileMode
                />
              </Suspense>
            </div>

            {/* Grille + infinite scroll */}
            <Suspense>
              <ProductsInfiniteScroll
                initialProducts={products}
                initialHasMore={initialHasMore}
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
