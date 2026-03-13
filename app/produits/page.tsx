import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import SearchFilters from "@/components/produits/SearchFilters";
import ProductCard from "@/components/produits/ProductCard";

export const metadata: Metadata = {
  title: "Catalogue — Beli & Jolie",
};

interface PageProps {
  searchParams: Promise<{ q?: string; cat?: string }>;
}

export default async function ProduitsPage({ searchParams }: PageProps) {
  const { q = "", cat = "" } = await searchParams;

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: {
        ...(q && {
          OR: [
            { name:      { contains: q } },
            { reference: { contains: q } },
          ],
        }),
        ...(cat && { categoryId: cat }),
      },
      orderBy: { createdAt: "desc" },
      include: {
        category:      { select: { name: true } },
        subCategories: { select: { name: true }, take: 1 },
        colors: {
          select: {
            id:        true,
            unitPrice: true,
            isPrimary: true,
            color:     { select: { name: true, hex: true } },
            images:    { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
          },
        },
      },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <Navbar />
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
          <div className="bg-white border border-[#E5E5E5] rounded-lg px-4 py-3">
            <Suspense>
              <SearchFilters
                categories={categories}
                totalCount={products.length}
              />
            </Suspense>
          </div>

          {/* Grille */}
          {products.length === 0 ? (
            <div className="text-center py-20 bg-white border border-[#E5E5E5] rounded-lg">
              <div className="w-14 h-14 bg-[#F5F5F5] rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-[#CCCCCC]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </div>
              <p className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] mb-1">
                Aucun produit trouvé
              </p>
              <p className="text-sm text-[#999999] font-[family-name:var(--font-roboto)]">
                Essayez de modifier vos critères de recherche.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  id={product.id}
                  name={product.name}
                  reference={product.reference}
                  category={product.category.name}
                  subCategory={product.subCategories[0]?.name ?? null}
                  colors={product.colors.map((c) => ({
                    id:         c.id,
                    hex:        c.color.hex,
                    name:       c.color.name,
                    firstImage: c.images[0]?.path ?? null,
                    unitPrice:  c.unitPrice,
                    isPrimary:  c.isPrimary,
                  }))}
                />
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
