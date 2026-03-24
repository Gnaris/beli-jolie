import { cache } from "react";
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
import FloatingShapes from "@/components/ui/FloatingShapes";
import ScatteredDecorations from "@/components/ui/ScatteredDecorations";
import ProductDetail from "@/components/produits/ProductDetail";

interface PageProps {
  params: Promise<{ id: string }>;
}

const getProduct = cache(async (id: string) => {
  return prisma.product.findUnique({
    where: { id },
    include: {
      category:      { select: { name: true } },
      subCategories: { select: { name: true } },
      tags:          { include: { tag: { select: { id: true, name: true } } } },
      colors: {
        include: {
          color: { select: { name: true, hex: true, patternImage: true } },
          subColors: {
            orderBy: { position: "asc" },
            include: { color: { select: { name: true, hex: true, patternImage: true } } },
          },
          variantSizes: {
            orderBy: { size: { position: "asc" } },
            include: { size: true },
          },
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
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const [product, firstImage] = await Promise.all([
    getProduct(id),
    prisma.productColorImage.findFirst({
      where: { productId: id },
      orderBy: { order: "asc" },
      select: { path: true },
    }),
  ]);

  if (!product) return { title: "Produit introuvable" };

  const title = `${product.name} — Beli & Jolie`;
  const description = product.description.slice(0, 160).replace(/\n/g, " ");

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Beli & Jolie",
      ...(firstImage && { images: [{ url: firstImage.path, width: 800, height: 800, alt: product.name }] }),
    },
    alternates: { canonical: `/produits/${id}` },
  };
}

export default async function ProduitDetailPage({ params }: PageProps) {
  const { id } = await params;

  // Fetch product, session, config, and locale in parallel
  const [product, session, stockVariantsConfig, locale] = await Promise.all([
    getProduct(id),
    getServerSession(authOptions),
    getCachedSiteConfig("show_out_of_stock_variants"),
    getLocale(),
  ]);

  if (!product || product.status !== "ONLINE") notFound();

  const similarProductIds = product.similarProducts.map((sp) => sp.similar.id);

  // Fetch images and client discount in parallel
  const [colorImages, similarColorImages, clientDiscount] = await Promise.all([
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
    session?.user?.id
      ? prisma.user.findUnique({
          where: { id: session.user.id },
          select: { discountType: true, discountValue: true },
        }).then((u) =>
          u?.discountType && u.discountValue
            ? { discountType: u.discountType as "PERCENT" | "AMOUNT", discountValue: u.discountValue }
            : null
        )
      : Promise.resolve(null),
  ]);

  // Filter out OOS variants if config says so
  const showOosVariants = stockVariantsConfig?.value !== "false";
  const filteredColors = showOosVariants
    ? product.colors
    : product.colors.filter((pc) => pc.stock > 0);

  // Build variant group keys: colorId + ordered sub-color names (order matters)
  function variantGroupKey(colorId: string, subColorNames: string[]): string {
    if (subColorNames.length === 0) return colorId;
    return `${colorId}::${subColorNames.join(",")}`;
  }
  const pcGroupKeys = new Map<string, string>();
  for (const pc of filteredColors) {
    if (!pc.colorId) continue;
    const gk = variantGroupKey(pc.colorId, pc.subColors.map(sc => sc.color.name));
    pcGroupKeys.set(pc.id, gk);
  }

  // Group images by variant group key (variants with same color+sub-colors share images)
  const imagesByGroup = new Map<string, { path: string; order: number }[]>();
  for (const img of colorImages) {
    const gk = pcGroupKeys.get(img.productColorId ?? "") ?? img.colorId;
    if (!imagesByGroup.has(gk)) imagesByGroup.set(gk, []);
    imagesByGroup.get(gk)!.push({ path: img.path, order: img.order });
  }
  for (const imgs of imagesByGroup.values()) imgs.sort((a, b) => a.order - b.order);
  // Deduplicate images with same path across variants in the same group
  const colorImagesForDetail = [...imagesByGroup.entries()].map(([gk, imgs]) => {
    const seen = new Set<string>();
    return { groupKey: gk, images: imgs.filter(img => { if (seen.has(img.path)) return false; seen.add(img.path); return true; }) };
  });
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
      primaryColorName: pc?.color?.name ?? null,
      minPrice:         pc?.unitPrice ?? 0,
    };
  }

  // JSON-LD structured data for SEO
  const primaryColor = filteredColors.find((c) => c.isPrimary) ?? filteredColors[0];
  const minPrice = filteredColors.length > 0
    ? Math.min(...filteredColors.map((c) => c.unitPrice))
    : 0;
  const firstImg = colorImages[0]?.path;
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: translated.name,
    description: translated.description.slice(0, 500),
    sku: product.reference,
    category: product.category.name,
    ...(firstImg && { image: firstImg }),
    offers: {
      "@type": "Offer",
      priceCurrency: "EUR",
      price: minPrice.toFixed(2),
      availability: primaryColor && primaryColor.stock > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Produits", item: "https://beli-jolie.fr/produits" },
      { "@type": "ListItem", position: 2, name: product.category.name, item: `https://beli-jolie.fr/produits?cat=${product.categoryId}` },
      { "@type": "ListItem", position: 3, name: translated.name },
    ],
  };

  return (
    <div className="min-h-screen relative">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <FloatingShapes />
      <PublicSidebar />
      <div className="min-w-0 relative z-10">
        <main className="min-h-screen bg-bg-secondary relative overflow-hidden">
          <ScatteredDecorations variant="sparse" seed={200} />
          <div className="container-site py-10 relative">

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
              productId={product.id}
              name={translated.name}
              reference={product.reference}
              description={translated.description}
              category={product.category.name}
              subCategories={product.subCategories.map((sc) => sc.name)}
              variants={filteredColors.map((pc) => ({
                id:            pc.id,
                groupKey:      pcGroupKeys.get(pc.id)!,
                colorId:       pc.colorId,
                colorName:     pc.color?.name,
                colorHex:      pc.color?.hex,
                patternImage:  pc.color?.patternImage,
                subColors:     pc.subColors.length > 0
                  ? pc.subColors.map((sc) => ({ name: sc.color.name, hex: sc.color.hex ?? "#9CA3AF", patternImage: sc.color.patternImage }))
                  : undefined,
                unitPrice:     pc.unitPrice,
                weight:        pc.weight,
                stock:         pc.stock,
                isPrimary:     pc.isPrimary,
                saleType:      pc.saleType,
                packQuantity:  pc.packQuantity,
                sizes:         (pc.variantSizes ?? []).map((vs: any) => ({ name: vs.size.name, quantity: vs.quantity })),
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
              isAuthenticated={!!session?.user?.id}
            />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
