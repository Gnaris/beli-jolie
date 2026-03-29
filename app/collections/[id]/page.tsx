import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
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
  const shopName = await getCachedShopName();
  return { title: `${col.name} — Collections ${shopName}` };
}

export default async function CollectionDetailPage({ params }: PageProps) {
  const [t, shopName] = await Promise.all([
    getTranslations("collectionDetail"),
    getCachedShopName(),
  ]);
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
                  color:        { select: { name: true, hex: true, patternImage: true } },
                  subColors:    { orderBy: { position: "asc" as const }, select: { color: { select: { name: true, hex: true, patternImage: true } } } },
                  variantSizes: { orderBy: { size: { position: "asc" } }, include: { size: true } },
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
    const imgKey = img.productColorId ?? img.colorId;
    if (!cm.has(imgKey)) cm.set(imgKey, img.path);
  }

  return (
    <div className="min-h-screen">
      <PublicSidebar shopName={shopName} />

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
            <div className="flex items-center gap-2 text-xs text-text-muted font-body mb-2">
              <Link href="/collections" className="hover:text-text-primary transition-colors">
                {t("breadcrumb")}
              </Link>
              <span>/</span>
              <span className="text-text-primary">{collection.name}</span>
            </div>
            <h1 className="font-heading text-2xl font-semibold text-text-primary">
              {collection.name}
            </h1>
            <p className="mt-1 text-sm text-text-muted font-body">
              {collection.products.length <= 1
                ? t("products", { count: collection.products.length })
                : t("products_plural", { count: collection.products.length })}
            </p>
          </div>
        </div>

        <main className="container-site py-8">
          {collection.products.length === 0 ? (
            <div className="text-center py-20 text-text-muted font-body">
              {t("empty")}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {collection.products.map((cp) => {
                const p = cp.product;

                // Group variants by color group key (colorId + sub-colors)
                const colorMap = new Map<string, {
                  groupKey: string; colorId: string; name: string; hex: string | null; patternImage?: string | null; subColors?: { name: string; hex: string; patternImage?: string | null }[];
                  firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number;
                  variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; sizes: {name: string, quantity: number}[]; unitPrice: number; stock: number }[];
                }>();
                for (const v of p.colors) {
                  if (!v.colorId) continue;
                  const subNames: string[] = (v as any).subColors?.map((sc: { color: { name: string } }) => sc.color.name) ?? [];
                  const gk = subNames.length === 0 ? v.colorId : `${v.colorId}::${subNames.join(",")}`;
                  if (!colorMap.has(gk)) {
                    const subs = (v as any).subColors?.map((sc: { color: { name: string; hex: string | null; patternImage?: string | null } }) => ({ name: sc.color.name, hex: sc.color.hex ?? "#9CA3AF", patternImage: sc.color.patternImage })) ?? [];
                    colorMap.set(gk, {
                      groupKey: gk, colorId: v.colorId, name: v.color?.name ?? "", hex: v.color?.hex ?? null, patternImage: (v.color as any)?.patternImage,
                      subColors: subs.length > 0 ? subs : undefined,
                      firstImage: colImageMap.get(p.id)?.get(v.id) ?? null,
                      unitPrice: Number(v.unitPrice),
                      isPrimary: cp.colorId ? v.colorId === cp.colorId : v.isPrimary,
                      totalStock: 0,
                      variants: [],
                    });
                  }
                  const cd = colorMap.get(gk)!;
                  if (!cd.firstImage) cd.firstImage = colImageMap.get(p.id)?.get(v.id) ?? null;
                  cd.unitPrice = Math.min(cd.unitPrice, Number(v.unitPrice));
                  cd.totalStock += v.stock ?? 0;
                  if (cp.colorId ? v.colorId === cp.colorId : v.isPrimary) cd.isPrimary = true;
                  cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, sizes: ((v as any).variantSizes ?? []).map((vs: any) => ({ name: vs.size.name, quantity: vs.quantity })), unitPrice: Number(v.unitPrice), stock: v.stock ?? 0 });
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

        <Footer shopName={shopName} />
      </div>
    </div>
  );
}
