import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import ProductDetail from "@/components/produits/ProductDetail";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id }, select: { name: true } });
  return { title: product ? `${product.name} — Beli & Jolie` : "Produit" };
}

export default async function ProduitDetailPage({ params }: PageProps) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category:    { select: { name: true } },
      subCategory: { select: { name: true } },
      colors: {
        include: {
          color:       { select: { name: true, hex: true } },
          images:      { orderBy: { order: "asc" } },
          saleOptions: { orderBy: { saleType: "asc" } },
        },
        orderBy: { isPrimary: "desc" },
      },
    },
  });

  if (!product) notFound();

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F7F3EC]">
        <div className="container-site py-10">

          {/* Fil d'Ariane */}
          <nav className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#B8A48A] mb-8">
            <Link href="/produits" className="hover:text-[#8B7355] transition-colors">
              Produits
            </Link>
            <span>/</span>
            <Link href={`/produits?cat=${product.categoryId}`} className="hover:text-[#8B7355] transition-colors">
              {product.category.name}
            </Link>
            <span>/</span>
            <span className="text-[#6B5B45] truncate">{product.name}</span>
          </nav>

          <ProductDetail
            name={product.name}
            reference={product.reference}
            description={product.description}
            composition={product.composition}
            category={product.category.name}
            subCategory={product.subCategory?.name ?? null}
            colors={product.colors.map((pc) => ({
              id:         pc.id,
              name:       pc.color.name,
              hex:        pc.color.hex,
              unitPrice:  pc.unitPrice,
              weight:     pc.weight,
              isPrimary:  pc.isPrimary,
              images:     pc.images.map((img) => ({ path: img.path, order: img.order })),
              saleOptions: pc.saleOptions.map((opt) => ({
                id:            opt.id,
                saleType:      opt.saleType,
                packQuantity:  opt.packQuantity,
                stock:         opt.stock,
                discountType:  opt.discountType,
                discountValue: opt.discountValue,
              })),
            }))}
          />
        </div>
      </main>
      <Footer />
    </>
  );
}
