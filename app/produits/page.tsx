import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import SearchFilters from "@/components/produits/SearchFilters";
import ProductCard from "@/components/produits/ProductCard";

export const metadata: Metadata = {
  title: "Produits — Beli & Jolie",
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
        category:    { select: { name: true } },
        subCategory: { select: { name: true } },
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
      <main className="min-h-screen bg-[#F7F3EC]">
        <div className="container-site py-10 space-y-8">

          {/* En-tête */}
          <div>
            <h1 className="font-[family-name:var(--font-poppins)] text-3xl font-semibold text-[#2C2418]">
              Notre catalogue
            </h1>
            <p className="text-sm text-[#B8A48A] font-[family-name:var(--font-roboto)] mt-1">
              Bijoux en acier inoxydable — tarifs professionnels
            </p>
          </div>

          {/* Filtres */}
          <Suspense>
            <SearchFilters
              categories={categories}
              totalCount={products.length}
            />
          </Suspense>

          {/* Grille */}
          {products.length === 0 ? (
            <div className="text-center py-20">
              <p className="font-[family-name:var(--font-poppins)] text-lg font-semibold text-[#2C2418] mb-2">
                Aucun produit trouvé
              </p>
              <p className="text-sm text-[#B8A48A] font-[family-name:var(--font-roboto)]">
                Essayez de modifier vos critères de recherche.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  id={product.id}
                  name={product.name}
                  reference={product.reference}
                  category={product.category.name}
                  subCategory={product.subCategory?.name ?? null}
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
