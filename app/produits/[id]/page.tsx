import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getProductTranslation } from "@/lib/translate";
import { getCachedSiteConfig } from "@/lib/cached-data";
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
    where: { id, status: "ONLINE" },
    include: {
      category:      { select: { name: true } },
      subCategories: { select: { name: true } },
      tags:          { include: { tag: { select: { id: true, name: true } } } },
      colors: {
        include: {
          color: { select: { name: true, hex: true } },
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
            select: {
              id:        true,
              name:      true,
              reference: true,
              colors: {
                orderBy: { isPrimary: "desc" },
                take:    1,
                select:  { colorId: true, unitPrice: true, color: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!product) notFound();

  const similarProductIds = product.similarProducts.map((sp) => sp.similar.id);

  const [colorImages, similarColorImages] = await Promise.all([
    prisma.productColorImage.findMany({
      where:   { productId: id },
      orderBy: { order: "asc" },
    }),
    similarProductIds.length > 0
      ? prisma.productColorImage.findMany({
          where:   { productId: { in: similarProductIds } },
          orderBy: { order: "asc" },
        })
      : Promise.resolve([]),
  ]);

  // Group colorImages by colorId for ProductDetail
  const colorImageMap = new Map<string, { path: string; order: number }[]>();
  for (const img of colorImages) {
    if (!colorImageMap.has(img.colorId)) colorImageMap.set(img.colorId, []);
    colorImageMap.get(img.colorId)!.push({ path: img.path, order: img.order });
  }
  const colorImagesForDetail = [...colorImageMap.entries()].map(([colorId, images]) => ({
    colorId,
    images,
  }));

  // Stock display config
  const stockVariantsConfig = await getCachedSiteConfig("show_out_of_stock_variants");
  const showOosVariants = stockVariantsConfig?.value !== "false";

  // Filter out OOS variants if config says so
  const filteredColors = showOosVariants
    ? product.colors
    : product.colors.filter((pc) => pc.stock > 0);

  // Fetch client discount
  const session = await getServerSession(authOptions);
  const clientDiscount = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { discountType: true, discountValue: true },
      }).then((u) =>
        u?.discountType && u.discountValue
          ? { discountType: u.discountType as "PERCENT" | "AMOUNT", discountValue: u.discountValue }
          : null
      )
    : null;

  // Auto-translate product name & description
  const locale = await getLocale();
  const translated = await getProductTranslation(product.id, locale as "fr" | "en" | "ar", {
    name: product.name,
    description: product.description,
  });
  const tProducts = await getTranslations("products");

  function toRelated(p: NonNullable<typeof product>["similarProducts"][0]["similar"]) {
    const pc  = p.colors[0];
    const img = similarColorImages.find(
      (i) => i.productId === p.id && i.colorId === pc?.colorId
    );
    return {
      id:               p.id,
      name:             p.name,
      reference:        p.reference,
      primaryImage:     img?.path ?? null,
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
                {tProducts("breadcrumb")}
              </Link>
              <span className="text-border">/</span>
              <Link href={`/produits?cat=${product.categoryId}`} className="hover:text-text-primary transition-colors">
                {product.category.name}
              </Link>
              <span className="text-border">/</span>
              <span className="text-text-secondary truncate">{translated.name}</span>
            </nav>

            <ProductDetail
              name={translated.name}
              reference={product.reference}
              description={translated.description}
              category={product.category.name}
              subCategories={product.subCategories.map((sc) => sc.name)}
              variants={filteredColors.map((pc) => ({
                id:            pc.id,
                colorId:       pc.colorId,
                colorName:     pc.color.name,
                colorHex:      pc.color.hex,
                unitPrice:     pc.unitPrice,
                weight:        pc.weight,
                stock:         pc.stock,
                isPrimary:     pc.isPrimary,
                saleType:      pc.saleType,
                packQuantity:  pc.packQuantity,
                size:          pc.size ?? null,
                discountType:  pc.discountType,
                discountValue: pc.discountValue,
              }))}
              colorImages={colorImagesForDetail}
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
              clientDiscount={clientDiscount}
            />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
