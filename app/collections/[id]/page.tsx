import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import ProductCard from "@/components/produits/ProductCard";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const col = await prisma.collection.findUnique({ where: { id }, select: { name: true } });
  if (!col) return {};
  return { title: `${col.name} — Collections Beli & Jolie` };
}

export default async function CollectionDetailPage({ params }: PageProps) {
  const { id } = await params;

  const collection = await prisma.collection.findUnique({
    where:   { id },
    include: {
      products: {
        orderBy: { position: "asc" },
        include: {
          product: {
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
          },
        },
      },
    },
  });

  if (!collection) notFound();

  return (
    <div className="flex min-h-screen">
      <PublicSidebar />

      <div className="flex-1 lg:ml-60 pt-14 lg:pt-0 min-w-0">
        {/* Header */}
        <div className="bg-white border-b border-[#E5E5E5]">
          {/* Cover image */}
          {collection.image && (
            <div className="h-48 md:h-64 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={collection.image}
                alt={collection.name}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="container-site py-6">
            <div className="flex items-center gap-2 text-xs text-[#999999] font-[family-name:var(--font-roboto)] mb-2">
              <Link href="/collections" className="hover:text-[#1A1A1A] transition-colors">
                Collections
              </Link>
              <span>/</span>
              <span className="text-[#1A1A1A]">{collection.name}</span>
            </div>
            <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#1A1A1A]">
              {collection.name}
            </h1>
            <p className="mt-1 text-sm text-[#999999] font-[family-name:var(--font-roboto)]">
              {collection.products.length} produit{collection.products.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <main className="container-site py-8">
          {collection.products.length === 0 ? (
            <div className="text-center py-20 text-[#999999] font-[family-name:var(--font-roboto)]">
              Cette collection ne contient pas encore de produits.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {collection.products.map((cp) => {
                const p = cp.product;

                // Use the chosen color for this collection, or primary
                const chosenColor = cp.colorId
                  ? p.colors.find((c) => c.id === cp.colorId)
                  : null;

                // Build colors array with chosen color marked as primary
                const colors = p.colors.map((c) => ({
                  id:         c.id,
                  hex:        c.color.hex,
                  name:       c.color.name,
                  firstImage: c.images[0]?.path ?? null,
                  unitPrice:  c.unitPrice,
                  isPrimary:  cp.colorId ? c.id === cp.colorId : c.isPrimary,
                }));

                return (
                  <ProductCard
                    key={cp.productId}
                    id={p.id}
                    name={p.name}
                    reference={p.reference}
                    category={p.category.name}
                    subCategory={p.subCategories[0]?.name ?? null}
                    colors={colors}
                  />
                );
              })}
            </div>
          )}
        </main>

        <Footer />
      </div>
    </div>
  );
}
