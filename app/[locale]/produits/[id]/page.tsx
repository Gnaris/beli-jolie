import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getProductTranslation } from "@/lib/translate";
import { getCachedSiteConfig, getCachedShopName } from "@/lib/cached-data";
import { getImageSrc } from "@/lib/image-utils";
import { buildAlternates, getSiteUrl } from "@/lib/seo";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import ProductDetail from "@/components/produits/ProductDetail";

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

const getProduct = cache(async (id: string) => {
  return prisma.product.findUnique({
    where: { id },
    include: {
      category:      { select: { name: true } },
      subCategories: { select: { name: true } },
      tags:          { include: { tag: { select: { id: true, name: true } } } },
      colors: {
        where: { disabled: false },
        include: {
          color: { select: { name: true, hex: true, patternImage: true } },
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
      bundleChildren: {
        include: {
          child: {
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
      bundleParents: {
        include: {
          parent: {
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
  const { id, locale } = await params;
  const [product, firstImage] = await Promise.all([
    getProduct(id),
    prisma.productColorImage.findFirst({
      where: { productId: id },
      orderBy: { order: "asc" },
      select: { path: true },
    }),
  ]);

  if (!product) return { title: "Produit introuvable" };

  const shopName = await getCachedShopName();
  const title = `${product.name} — ${shopName}`;
  const description = product.description.slice(0, 160).replace(/\n/g, " ");
  const imageUrl = firstImage ? getImageSrc(firstImage.path, "large") : null;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: shopName,
      url: `${getSiteUrl()}/${locale}/produits/${id}`,
      ...(imageUrl && { images: [{ url: imageUrl, width: 800, height: 800, alt: product.name }] }),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(imageUrl && { images: [imageUrl] }),
    },
    alternates: buildAlternates(`/produits/${id}`, locale),
  };
}

export default async function ProduitDetailPage({ params }: PageProps) {
  const { id } = await params;

  // Fetch product, session, config, and locale in parallel
  const [product, session, stockVariantsConfig, locale, shopName] = await Promise.all([
    getProduct(id),
    getServerSession(authOptions),
    getCachedSiteConfig("show_out_of_stock_variants"),
    getLocale(),
    getCachedShopName(),
  ]);

  if (!product) notFound();

  // Product exists but is not online (e.g. OFFLINE during refresh) — show unavailable page
  if (product.status !== "ONLINE") {
    const tProducts = await getTranslations("products");
    return (
      <div className="min-h-screen relative">
        <PublicSidebar shopName={shopName} />
        <div className="min-w-0 relative z-10">
          <main className="min-h-screen bg-bg-secondary relative overflow-hidden">
            <div className="container-site py-10">
              <nav className="flex items-center gap-2 text-sm font-body text-text-muted mb-8">
                <Link href="/produits" className="hover:text-text-primary transition-colors">
                  {tProducts("breadcrumb")}
                </Link>
                <span className="text-border">/</span>
                <span className="text-text-secondary truncate">{product.name}</span>
              </nav>
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-full bg-bg-tertiary flex items-center justify-center mb-6">
                  <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                </div>
                <h1 className="text-2xl font-heading font-semibold text-text-primary mb-2">
                  {tProducts("unavailableTitle")}
                </h1>
                <p className="text-text-muted font-body mb-8 max-w-md">
                  {tProducts("unavailableDescription")}
                </p>
                <Link
                  href="/produits"
                  className="btn-primary px-6 py-3 rounded-xl font-medium"
                >
                  {tProducts("backToProducts")}
                </Link>
              </div>
            </div>
          </main>
          <Footer shopName={shopName} />
        </div>
      </div>
    );
  }

  const similarProductIds = product.similarProducts.map((sp) => sp.similar.id);
  const bundleChildIds = product.bundleChildren.map((b) => b.child.id);
  const bundleParentIds = product.bundleParents.map((b) => b.parent.id);
  const relatedIds = [...new Set([...similarProductIds, ...bundleChildIds, ...bundleParentIds])];

  // Fetch images and client discount in parallel
  const [colorImages, relatedColorImages, clientDiscount] = await Promise.all([
    prisma.productColorImage.findMany({
      where:   { productId: id },
      orderBy: { order: "asc" },
    }),
    relatedIds.length > 0
      ? prisma.productColorImage.findMany({
          where:   { productId: { in: relatedIds } },
          orderBy: { order: "asc" },
        })
      : Promise.resolve([]),
    session?.user?.id
      ? prisma.user.findUnique({
          where: { id: session.user.id },
          select: { discountType: true, discountValue: true },
        }).then((u) =>
          u?.discountType && u.discountValue
            ? { discountType: u.discountType as "PERCENT" | "AMOUNT", discountValue: Number(u.discountValue) }
            : null
        )
      : Promise.resolve(null),
  ]);

  // Filter out OOS variants if config says so
  const showOosVariants = stockVariantsConfig?.value !== "false";
  const filteredColors = showOosVariants
    ? product.colors
    : product.colors.filter((pc) => pc.stock > 0);

  // Build variant group keys: colorId
  const pcGroupKeys = new Map<string, string>();
  for (const pc of filteredColors) {
    const gk = pc.colorId
      ? pc.colorId
      : `pack::${pc.id}`; // PACK variants get a unique key per variant
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

  function toRelated(p: { id: string; name: string; reference: string; colors: { colorId: string | null; unitPrice: any; color: { name: string } | null }[] }) {
    const pc  = p.colors[0];
    const img = relatedColorImages.find(
      (i) => i.productId === p.id && i.colorId === pc?.colorId
    );
    return {
      id:               p.id,
      name:             p.name,
      reference:        p.reference,
      primaryImage:     img?.path ?? null,
      primaryColorName: pc?.color?.name ?? null,
      minPrice:         pc ? Number(pc.unitPrice) : 0,
    };
  }

  // JSON-LD structured data for SEO
  const primaryColor = filteredColors.find((c) => c.isPrimary) ?? filteredColors[0];
  const minPrice = filteredColors.length > 0
    ? Math.min(...filteredColors.map((c) => Number(c.unitPrice)))
    : 0;
  const firstImg = colorImages[0]?.path;
  const siteUrl = process.env.NEXTAUTH_URL || "";
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: translated.name,
    description: translated.description.slice(0, 500),
    sku: product.reference,
    category: product.category.name,
    ...(firstImg && { image: getImageSrc(firstImg, "large") }),
    brand: {
      "@type": "Brand",
      name: shopName,
    },
    offers: {
      "@type": "Offer",
      url: `${siteUrl}/produits/${product.id}`,
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
      { "@type": "ListItem", position: 1, name: "Produits", item: `${process.env.NEXTAUTH_URL || ""}/produits` },
      { "@type": "ListItem", position: 2, name: product.category.name, item: `${process.env.NEXTAUTH_URL || ""}/produits?cat=${product.categoryId}` },
      { "@type": "ListItem", position: 3, name: translated.name },
    ],
  };

  return (
    <div className="min-h-screen relative">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <PublicSidebar shopName={shopName} />
      <div className="min-w-0 relative z-10">
        <main className="min-h-screen bg-bg-secondary relative overflow-hidden">
          <div className="container-site py-10 relative">

            {/* Fil d'Ariane */}
            <nav className="flex items-center gap-2 text-sm font-body text-text-muted mb-8">
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
                unitPrice:     Number(pc.unitPrice),
                weight:        pc.weight,
                stock:         pc.stock,
                isPrimary:     pc.isPrimary,
                saleType:      pc.saleType,
                packQuantity:  pc.packQuantity,
                sizes:         (pc.variantSizes ?? []).map((vs: any) => ({ name: vs.size.name, quantity: vs.quantity, pricePerUnit: vs.pricePerUnit != null ? Number(vs.pricePerUnit) : undefined })),
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
              bundleChildren={product.bundleChildren.map((b) => toRelated(b.child))}
              bundleParents={product.bundleParents.map((b) => toRelated(b.parent))}
              discountPercent={product.discountPercent != null ? Number(product.discountPercent) : null}
              clientDiscount={clientDiscount}
              isAuthenticated={!!session?.user?.id}
            />
          </div>
        </main>
        <Footer shopName={shopName} />
      </div>
    </div>
  );
}
