import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
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
  const t = await getTranslations("collectionDetail");
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
                  id:           true,
                  colorId:      true,
                  unitPrice:    true,
                  stock:        true,
                  isPrimary:    true,
                  saleType:     true,
                  packQuantity: true,
                  size:         true,
                  color:        { select: { name: true, hex: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!collection) notFound();

  // Fetch images for all products in collection
  const colProductIds = collection.products.map((cp) => cp.product.id);
  const colColorImages = colProductIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: colProductIds } }, orderBy: { order: "asc" } })
    : [];
  const colImageMap = new Map<string, Map<string, string>>();
  for (const img of colColorImages) {
    if (!colImageMap.has(img.productId)) colImageMap.set(img.productId, new Map());
    const cm = colImageMap.get(img.productId)!;
    if (!cm.has(img.colorId)) cm.set(img.colorId, img.path);
  }

  return (
    <div className="min-h-screen">
      <PublicSidebar />

      <div className="min-w-0">
        {/* Header */}
        <div className="bg-bg-primary border-b border-border">
          {/* Cover image */}
          {collection.image && (
            <div className="h-48 md:h-64 overflow-hidden relative">
              <Image
                src={collection.image}
                alt={collection.name}
                fill
                sizes="100vw"
                className="object-cover"
                priority
              />
            </div>
          )}
          <div className="container-site py-6">
            <div className="flex items-center gap-2 text-xs text-text-muted font-[family-name:var(--font-roboto)] mb-2">
              <Link href="/collections" className="hover:text-text-primary transition-colors">
                {t("breadcrumb")}
              </Link>
              <span>/</span>
              <span className="text-text-primary">{collection.name}</span>
            </div>
            <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-text-primary">
              {collection.name}
            </h1>
            <p className="mt-1 text-sm text-text-muted font-[family-name:var(--font-roboto)]">
              {collection.products.length <= 1
                ? t("products", { count: collection.products.length })
                : t("products_plural", { count: collection.products.length })}
            </p>
          </div>
        </div>

        <main className="container-site py-8">
          {collection.products.length === 0 ? (
            <div className="text-center py-20 text-text-muted font-[family-name:var(--font-roboto)]">
              {t("empty")}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {collection.products.map((cp) => {
                const p = cp.product;

                // Group variants by colorId
                const colorMap = new Map<string, {
                  colorId: string; name: string; hex: string | null;
                  firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number;
                  variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; size: string | null; unitPrice: number; stock: number }[];
                }>();
                for (const v of p.colors) {
                  if (!colorMap.has(v.colorId)) {
                    colorMap.set(v.colorId, {
                      colorId: v.colorId, name: v.color.name, hex: v.color.hex,
                      firstImage: colImageMap.get(p.id)?.get(v.colorId) ?? null,
                      unitPrice: v.unitPrice,
                      isPrimary: cp.colorId ? v.colorId === cp.colorId : v.isPrimary,
                      totalStock: 0,
                      variants: [],
                    });
                  }
                  const cd = colorMap.get(v.colorId)!;
                  cd.unitPrice = Math.min(cd.unitPrice, v.unitPrice);
                  cd.totalStock += v.stock ?? 0;
                  if (cp.colorId ? v.colorId === cp.colorId : v.isPrimary) cd.isPrimary = true;
                  cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, size: v.size ?? null, unitPrice: v.unitPrice, stock: v.stock ?? 0 });
                }
                const colors = [...colorMap.values()];

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
