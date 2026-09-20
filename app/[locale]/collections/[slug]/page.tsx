import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import Image from "@/components/ui/SmartImage";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { getCurrentTenantSlug } from "@/lib/tenant";
import { buildAlternates, getSiteUrl } from "@/lib/seo";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import ProductCard from "@/components/produits/ProductCard";
import { getProductPrimaryColorId } from "@/lib/product-primary-color";
import { PUBLIC_SELLABLE_COLORS_CLAUSE } from "@/lib/public-product-visibility";
import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import CollectionDetailIssymaLayout from "@/components/issyma/CollectionDetailIssymaLayout";
import type { CarouselProduct } from "@/components/home/ProductCarousel";

interface PageProps {
  params: Promise<{ slug: string; locale: string }>;
}

/**
 * Résout une collection à partir du segment URL. Priorité au slug (URL propre
 * `/collections/eclat-automne-2026`) ; fallback sur l'ancien cuid → 301 vers
 * la version slug (préserve le SEO acquis + backlinks).
 */
async function resolveCollectionHandle(handle: string) {
  const bySlug = await prisma.collection.findFirst({
    where: { slug: handle },
    select: { id: true, slug: true },
  });
  if (bySlug) return { kind: "slug" as const, id: bySlug.id, slug: bySlug.slug };

  // Cuids : `cm...` — on tente une résolution par id uniquement si l'aspect
  // colle, pour éviter un findFirst inutile sur des slugs random.
  if (/^c[a-z0-9]{20,}$/i.test(handle)) {
    const byId = await prisma.collection.findFirst({
      where: { id: handle },
      select: { id: true, slug: true },
    });
    if (byId?.slug) return { kind: "legacyId" as const, id: byId.id, slug: byId.slug };
  }
  return null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, locale } = await params;

  const resolved = await resolveCollectionHandle(slug);
  if (!resolved) return {};

  const col = await prisma.collection.findFirst({
    where: { id: resolved.id },
    select: {
      name: true,
      image: true,
      slug: true,
      translations: { where: { locale }, select: { name: true }, take: 1 },
    },
  });
  if (!col || !col.slug) return {};
  const [shopName, siteUrl, alternates] = await Promise.all([
    getCachedShopName(),
    getSiteUrl(),
    buildAlternates(`/collections/${col.slug}`, locale),
  ]);
  const localizedName = col.translations[0]?.name ?? col.name;
  const title = `${localizedName} — Collections ${shopName}`;
  const description = `Découvrez la collection ${localizedName} sur ${shopName}. Sélection grossiste pour professionnels.`;
  const imageUrl = col.image ? (col.image.startsWith("http") ? col.image : `${siteUrl}${col.image}`) : null;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: shopName,
      url: `${siteUrl}/${locale}/collections/${col.slug}`,
      ...(imageUrl && { images: [{ url: imageUrl, alt: localizedName }] }),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(imageUrl && { images: [imageUrl] }),
    },
    alternates,
  };
}

export default async function CollectionDetailPage({ params }: PageProps) {
  const [t, shopName, tenantSlug, resolvedParams] = await Promise.all([
    getTranslations("collectionDetail"),
    getCachedShopName(),
    getCurrentTenantSlug(),
    params,
  ]);
  const { slug, locale } = resolvedParams;

  const resolved = await resolveCollectionHandle(slug);
  if (!resolved) notFound();

  // Ancien lien basé sur le cuid : on redirige vers l'URL slug canonique.
  if (resolved.kind === "legacyId") {
    permanentRedirect(`/${locale}/collections/${resolved.slug}`);
  }

  const collection = await prisma.collection.findFirst({
    where:   { id: resolved.id },
    include: {
      translations: { where: { locale }, select: { name: true }, take: 1 },
      products: {
        where: {
          product: {
            status: "ONLINE",
            colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
          },
        },
        orderBy: { position: "asc" },
        include: {
          product: {
            include: {
              category:      { select: { name: true } },
              subCategories: { select: { name: true }, take: 1 },
              ...(locale !== "fr" && {
                translations: { where: { locale }, select: { name: true }, take: 1 },
              }),
              colors: {
                where: { disabled: false },
                select: {
                  id:           true,
                  colorId:      true,
                  unitPrice:    true,
                  stock:        true,
                  isPrimary:    true,
                  saleType:     true,
                  packQuantity: true,
                  color:        { select: { name: true, hex: true, patternImage: true } },
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

  // Nom collection localisé (fallback FR si aucune CollectionTranslation).
  const localizedCollectionName = collection.translations[0]?.name ?? collection.name;

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

  // Dispatch tenant : Issyma reçoit son propre layout bordeaux.
  const effectiveSlug = await getEffectiveTenantSlug();
  if (effectiveSlug === "issyma") {
    const issymaProducts: CarouselProduct[] = collection.products.map((cp) => {
      const p = cp.product;
      const productPrimaryColorId = getProductPrimaryColorId({
        primaryColorId: p.primaryColorId,
        colors: p.colors,
      });
      const effectivePrimaryColorId = cp.colorId ?? productPrimaryColorId;
      const colorMap = new Map<string, {
        groupKey: string; colorId: string; name: string; hex: string | null; patternImage?: string | null;
        firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number;
        variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; sizes: {name: string, quantity: number}[]; unitPrice: number; stock: number }[];
      }>();
      for (const v of p.colors) {
        if (!v.colorId) continue;
        const gk = v.colorId;
        const isPrimaryColor = effectivePrimaryColorId != null && v.colorId === effectivePrimaryColorId;
        if (!colorMap.has(gk)) {
          colorMap.set(gk, {
            groupKey: gk, colorId: v.colorId, name: v.color?.name ?? "", hex: v.color?.hex ?? null,
            patternImage: (v.color as { patternImage?: string | null } | null)?.patternImage,
            firstImage: colImageMap.get(p.id)?.get(v.id) ?? colImageMap.get(p.id)?.get(v.colorId) ?? null,
            unitPrice: Number(v.unitPrice),
            isPrimary: isPrimaryColor,
            totalStock: 0,
            variants: [],
          });
        }
        const cd = colorMap.get(gk)!;
        if (!cd.firstImage) cd.firstImage = colImageMap.get(p.id)?.get(v.id) ?? colImageMap.get(p.id)?.get(v.colorId) ?? null;
        cd.unitPrice = Math.min(cd.unitPrice, Number(v.unitPrice));
        cd.totalStock += v.stock ?? 0;
        if (isPrimaryColor) cd.isPrimary = true;
        cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, sizes: (v.variantSizes ?? []).map((vs) => ({ name: vs.size.name, quantity: vs.quantity })), unitPrice: Number(v.unitPrice), stock: v.stock ?? 0 });
      }
      const visibleColors = [...colorMap.values()].filter((cd) => cd.firstImage != null);
      // Cohérent avec /produits : si une traduction produit existe pour la
      // locale demandée, on remplace le nom source par la traduction.
      const translatedProductName = (p as { translations?: { name: string }[] }).translations?.[0]?.name;
      return {
        id: p.id,
        name: translatedProductName ?? p.name,
        reference: p.reference,
        category: p.category.name,
        subCategory: p.subCategories[0]?.name ?? null,
        colors: visibleColors,
        tags: [],
        isBestSeller: false,
        isNew: false,
        discountPercent: null,
      };
    });
    return (
      <CollectionDetailIssymaLayout
        shopName={shopName}
        collectionName={localizedCollectionName}
        collectionImage={collection.image}
        products={issymaProducts}
      />
    );
  }

  return (
    <div className="min-h-screen">
      <PublicSidebar shopName={shopName} tenantSlug={tenantSlug ?? undefined} />

      <div className="min-w-0">
        {/* Header */}
        <div className="bg-bg-primary border-b border-border">
          {/* Cover image */}
          {collection.image && (
            <div className="h-48 md:h-64 overflow-hidden relative">
              <Image
                src={collection.image}
                alt={localizedCollectionName}
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
              <span className="text-text-primary">{localizedCollectionName}</span>
            </div>
            <h1 className="font-heading text-2xl font-semibold text-text-primary">
              {localizedCollectionName}
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 md:gap-5">
              {collection.products.map((cp) => {
                const p = cp.product;
                const productPrimaryColorId = getProductPrimaryColorId({
                  primaryColorId: p.primaryColorId,
                  colors: p.colors,
                });
                const effectivePrimaryColorId = cp.colorId ?? productPrimaryColorId;

                const colorMap = new Map<string, {
                  groupKey: string; colorId: string; name: string; hex: string | null; patternImage?: string | null;
                  firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number;
                  variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; sizes: {name: string, quantity: number}[]; unitPrice: number; stock: number }[];
                }>();
                for (const v of p.colors) {
                  if (!v.colorId) continue;
                  const gk = v.colorId;
                  const isPrimaryColor = effectivePrimaryColorId != null && v.colorId === effectivePrimaryColorId;
                  if (!colorMap.has(gk)) {
                    colorMap.set(gk, {
                      groupKey: gk, colorId: v.colorId, name: v.color?.name ?? "", hex: v.color?.hex ?? null, patternImage: (v.color as { patternImage?: string | null } | null)?.patternImage,
                      firstImage: colImageMap.get(p.id)?.get(v.id) ?? colImageMap.get(p.id)?.get(v.colorId) ?? null,
                      unitPrice: Number(v.unitPrice),
                      isPrimary: isPrimaryColor,
                      totalStock: 0,
                      variants: [],
                    });
                  }
                  const cd = colorMap.get(gk)!;
                  if (!cd.firstImage) cd.firstImage = colImageMap.get(p.id)?.get(v.id) ?? colImageMap.get(p.id)?.get(v.colorId) ?? null;
                  cd.unitPrice = Math.min(cd.unitPrice, Number(v.unitPrice));
                  cd.totalStock += v.stock ?? 0;
                  if (isPrimaryColor) cd.isPrimary = true;
                  cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, sizes: (v.variantSizes ?? []).map((vs) => ({ name: vs.size.name, quantity: vs.quantity })), unitPrice: Number(v.unitPrice), stock: v.stock ?? 0 });
                }
                const colors = [...colorMap.values()].filter((cd) => cd.firstImage != null);
                const translatedProductName = (p as { translations?: { name: string }[] }).translations?.[0]?.name;

                return (
                  <ProductCard
                    key={cp.productId}
                    id={p.id}
                    name={translatedProductName ?? p.name}
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
