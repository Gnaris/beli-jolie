import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import PublicSidebar from "@/components/layout/PublicSidebar";
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
      category:      { select: { name: true } },
      subCategories: { select: { name: true } },
      tags:          { include: { tag: { select: { id: true, name: true } } } },
      colors: {
        include: {
          color:       { select: { name: true, hex: true } },
          images:      { orderBy: { order: "asc" } },
          saleOptions: { orderBy: { saleType: "asc" } },
        },
        orderBy: { isPrimary: "desc" },
      },
      compositions: {
        include: { composition: { select: { name: true } } },
        orderBy:  { percentage: "desc" },
      },
      similarProducts: {
        include: {
          similar: {
            include: {
              colors: {
                orderBy: { isPrimary: "desc" },
                include: { images: { orderBy: { order: "asc" }, take: 1 }, color: { select: { name: true } } },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!product) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function toRelated(p: any) {
    const pc = p.colors[0];
    return {
      id:               p.id,
      name:             p.name,
      reference:        p.reference,
      primaryImage:     pc?.images[0]?.path ?? null,
      primaryColorName: pc?.color.name ?? null,
      minPrice:         pc?.unitPrice ?? 0,
    };
  }

  return (
    <div className="min-h-screen">
      <PublicSidebar />
      <div className="min-w-0">
        <main className="min-h-screen bg-bg-secondary">
          <div className="container-site py-10">

            {/* Fil d'Ariane */}
            <nav className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-text-muted mb-8">
              <Link href="/produits" className="hover:text-text-primary transition-colors">
                Produits
              </Link>
              <span className="text-border">/</span>
              <Link href={`/produits?cat=${product.categoryId}`} className="hover:text-text-primary transition-colors">
                {product.category.name}
              </Link>
              <span className="text-border">/</span>
              <span className="text-text-secondary truncate">{product.name}</span>
            </nav>

            <ProductDetail
            name={product.name}
            reference={product.reference}
            description={product.description}
            category={product.category.name}
            subCategories={product.subCategories.map((sc) => sc.name)}
            colors={product.colors.map((pc) => ({
              id:         pc.id,
              name:       pc.color.name,
              hex:        pc.color.hex,
              unitPrice:  pc.unitPrice,
              weight:     pc.weight,
              stock:      (pc as unknown as { stock?: number }).stock ?? 0,
              isPrimary:  pc.isPrimary,
              images:     pc.images.map((img) => ({ path: img.path, order: img.order })),
              saleOptions: pc.saleOptions.map((opt) => ({
                id:            opt.id,
                saleType:      opt.saleType,
                packQuantity:  opt.packQuantity,
                size:          opt.size ?? null,
                discountType:  opt.discountType,
                discountValue: opt.discountValue,
              })),
            }))}
            compositions={product.compositions.map((c) => ({
              name:       c.composition.name,
              percentage: c.percentage,
            }))}
            dimensions={{
              length:        product.dimensionLength,
              width:         product.dimensionWidth,
              height:        product.dimensionHeight,
              diameter:      product.dimensionDiameter,
              circumference: product.dimensionCircumference,
            }}
            tags={product.tags.map((t) => ({ id: t.tag.id, name: t.tag.name }))}
            similarProducts={product.similarProducts.map((sp) => toRelated(sp.similar))}
          />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
