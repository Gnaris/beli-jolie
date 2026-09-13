import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { buildAlternates, getSiteUrl } from "@/lib/seo";
import { getCurrentTenantId } from "@/lib/tenant";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import ProductCard from "@/components/produits/ProductCard";
import { getProductPrimaryColorId } from "@/lib/product-primary-color";
import {
  resolveCategorySeo,
  buildFaqJsonLd,
  buildBreadcrumbJsonLd,
} from "@/lib/category-seo";
import CategoryFaq from "@/components/categories/CategoryFaq";

const MAX_PRODUCTS_ON_PAGE = 40;

interface PageProps {
  params: Promise<{ slug: string; locale: string }>;
}

async function loadCategoryBySlug(slug: string, locale: string) {
  return prisma.category.findFirst({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      seoTitle: true,
      seoIntro: true,
      seoSecondary: true,
      seoFaq: true,
      translations: {
        where: { locale },
        select: {
          name: true,
          seoTitle: true,
          seoIntro: true,
          seoSecondary: true,
          seoFaq: true,
        },
        take: 1,
      },
      subCategories: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          translations: {
            where: { locale },
            select: { name: true },
            take: 1,
          },
        },
      },
      _count: { select: { products: { where: { status: "ONLINE" } } } },
    },
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  await getCurrentTenantId();
  const { slug, locale } = await params;

  const [category, shopName, tMeta, alternates] = await Promise.all([
    loadCategoryBySlug(slug, locale),
    getCachedShopName(),
    getTranslations({ locale, namespace: "categoryDetail" }),
    buildAlternates(`/categories/${slug}`, locale),
  ]);

  if (!category) return { title: tMeta("notFoundTitle") };

  const localizedName = category.translations[0]?.name ?? category.name;
  const seo = resolveCategorySeo({
    categoryName: category.name,
    categoryNameLocalized: localizedName,
    shopName,
    productCount: category._count.products,
    locale: (locale === "en" ? "en" : "fr"),
    overridesBase: {
      seoTitle: category.seoTitle,
      seoIntro: category.seoIntro,
      seoSecondary: category.seoSecondary,
      seoFaq: category.seoFaq,
    },
    overridesTranslation: category.translations[0]
      ? {
          seoTitle: category.translations[0].seoTitle,
          seoIntro: category.translations[0].seoIntro,
          seoSecondary: category.translations[0].seoSecondary,
          seoFaq: category.translations[0].seoFaq,
        }
      : null,
  });

  return {
    title: seo.title,
    description: seo.intro,
    openGraph: {
      title: seo.title,
      description: seo.intro,
      type: "website",
      siteName: shopName,
    },
    alternates,
  };
}

export default async function CategoryDetailPage({ params }: PageProps) {
  await getCurrentTenantId();
  const { slug, locale } = await params;

  const [t, tCommon, shopName, siteUrl, category] = await Promise.all([
    getTranslations({ locale, namespace: "categoryDetail" }),
    getTranslations({ locale, namespace: "nav" }),
    getCachedShopName(),
    getSiteUrl(),
    loadCategoryBySlug(slug, locale),
  ]);

  if (!category) notFound();

  // ── Produits de la catégorie ──────────────────────────────────────────
  const rawProducts = await prisma.product.findMany({
    where: { status: "ONLINE", categoryId: category.id },
    orderBy: [
      { lastRefreshedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    take: MAX_PRODUCTS_ON_PAGE,
    select: {
      id: true,
      name: true,
      reference: true,
      primaryColorId: true,
      category: { select: { name: true } },
      subCategories: { select: { name: true }, take: 1 },
      colors: {
        where: { disabled: false },
        select: {
          id: true,
          colorId: true,
          unitPrice: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          color: { select: { name: true, hex: true, patternImage: true } },
          variantSizes: {
            orderBy: { size: { position: "asc" } },
            include: { size: true },
          },
        },
      },
      ...(locale !== "fr" && {
        translations: { where: { locale }, select: { name: true }, take: 1 },
      }),
    },
  });

  // ── Images des produits ────────────────────────────────────────────────
  const productIds = rawProducts.map((p) => p.id);
  const colorImages =
    productIds.length > 0
      ? await prisma.productColorImage.findMany({
          where: { productId: { in: productIds } },
          orderBy: { order: "asc" },
        })
      : [];
  const imageMap = new Map<string, Map<string, string>>();
  for (const img of colorImages) {
    if (!imageMap.has(img.productId)) imageMap.set(img.productId, new Map());
    const cm = imageMap.get(img.productId)!;
    const imgKey = img.productColorId ?? img.colorId;
    if (!cm.has(imgKey)) cm.set(imgKey, img.path);
  }

  const products = rawProducts.map((p) => {
    const translatedName = (p as { translations?: { name: string }[] }).translations?.[0]?.name;
    const productName = translatedName ?? p.name;
    const primaryColorId = getProductPrimaryColorId({
      primaryColorId: p.primaryColorId,
      colors: p.colors,
    });

    const colorMap = new Map<string, {
      groupKey: string;
      colorId: string;
      name: string;
      hex: string | null;
      patternImage?: string | null;
      firstImage: string | null;
      unitPrice: number;
      isPrimary: boolean;
      totalStock: number;
      variants: {
        id: string;
        saleType: "UNIT" | "PACK";
        packQuantity: number | null;
        sizes: { name: string; quantity: number }[];
        unitPrice: number;
        stock: number;
      }[];
    }>();

    for (const v of p.colors) {
      if (!v.colorId) continue;
      const gk = v.colorId;
      const isPrimaryColor = primaryColorId != null && v.colorId === primaryColorId;
      if (!colorMap.has(gk)) {
        colorMap.set(gk, {
          groupKey: gk,
          colorId: v.colorId,
          name: v.color?.name ?? "",
          hex: v.color?.hex ?? null,
          patternImage: v.color?.patternImage,
          firstImage: imageMap.get(p.id)?.get(v.id) ?? imageMap.get(p.id)?.get(v.colorId) ?? null,
          unitPrice: Number(v.unitPrice),
          isPrimary: isPrimaryColor,
          totalStock: 0,
          variants: [],
        });
      }
      const cd = colorMap.get(gk)!;
      if (!cd.firstImage) {
        cd.firstImage = imageMap.get(p.id)?.get(v.id) ?? imageMap.get(p.id)?.get(v.colorId) ?? null;
      }
      cd.unitPrice = Math.min(cd.unitPrice, Number(v.unitPrice));
      cd.totalStock += v.stock ?? 0;
      if (isPrimaryColor) cd.isPrimary = true;
      cd.variants.push({
        id: v.id,
        saleType: v.saleType,
        packQuantity: v.packQuantity,
        sizes: (v.variantSizes ?? []).map((vs) => ({
          name: vs.size.name,
          quantity: vs.quantity,
        })),
        unitPrice: Number(v.unitPrice),
        stock: v.stock ?? 0,
      });
    }

    const visibleColors = [...colorMap.values()].filter((cd) => cd.firstImage != null);
    return {
      id: p.id,
      name: productName,
      reference: p.reference,
      category: p.category.name,
      subCategory: p.subCategories[0]?.name ?? null,
      colors: visibleColors,
    };
  });

  // Hero mosaic : les 4 premières images des 4 premiers produits avec image.
  const heroMosaic = products
    .flatMap((p) => p.colors.map((c) => c.firstImage))
    .filter((x): x is string => !!x)
    .slice(0, 4);

  // ── Catégories liées (mesh interne) ────────────────────────────────────
  const relatedCategories = await prisma.category.findMany({
    where: { id: { not: category.id } },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    take: 6,
    select: {
      id: true,
      name: true,
      slug: true,
      translations: {
        where: { locale },
        select: { name: true },
        take: 1,
      },
      _count: { select: { products: { where: { status: "ONLINE" } } } },
    },
  });
  const relatedWithProducts = relatedCategories.filter((r) => r._count.products > 0).slice(0, 4);

  // ── SEO résolu ─────────────────────────────────────────────────────────
  const localizedName = category.translations[0]?.name ?? category.name;
  const seo = resolveCategorySeo({
    categoryName: category.name,
    categoryNameLocalized: localizedName,
    shopName,
    productCount: category._count.products,
    locale: (locale === "en" ? "en" : "fr"),
    overridesBase: {
      seoTitle: category.seoTitle,
      seoIntro: category.seoIntro,
      seoSecondary: category.seoSecondary,
      seoFaq: category.seoFaq,
    },
    overridesTranslation: category.translations[0]
      ? {
          seoTitle: category.translations[0].seoTitle,
          seoIntro: category.translations[0].seoIntro,
          seoSecondary: category.translations[0].seoSecondary,
          seoFaq: category.translations[0].seoFaq,
        }
      : null,
  });

  // JSON-LD schema.org
  const breadcrumbJsonLd = buildBreadcrumbJsonLd({
    siteUrl,
    locale,
    categoryName: localizedName,
    slug: category.slug,
    labels: {
      home: tCommon("home"),
      categories: tCommon("categories"),
    },
  });
  const faqJsonLd = buildFaqJsonLd(seo.faq);

  return (
    <div className="min-h-screen">
      <PublicSidebar shopName={shopName} />

      <div className="min-w-0">
        {/* Fil d'ariane */}
        <div className="container-site pt-6">
          <nav className="text-xs text-text-muted flex items-center gap-2 font-body">
            <Link href="/" className="hover:text-text-secondary transition-colors">
              {tCommon("home")}
            </Link>
            <span>/</span>
            <Link href="/categories" className="hover:text-text-secondary transition-colors">
              {tCommon("categories")}
            </Link>
            <span>/</span>
            <span className="text-text-secondary">{localizedName}</span>
          </nav>
        </div>

        {/* Hero SEO */}
        <section className="container-site pt-6 pb-10">
          <div className="rounded-3xl overflow-hidden border border-border bg-gradient-to-br from-bg-secondary to-bg-tertiary">
            <div className={`grid ${heroMosaic.length >= 4 ? "md:grid-cols-[1.4fr_1fr]" : "grid-cols-1"} gap-0`}>
              <div className="p-8 md:p-12 flex flex-col justify-center">
                <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium mb-3">
                  {t("eyebrow", { count: category._count.products })}
                </div>
                <h1 className="font-heading text-3xl md:text-4xl font-bold leading-tight mb-4 text-text-primary">
                  {seo.title}
                </h1>
                <p className="text-text-secondary leading-relaxed mb-4 font-body">
                  {seo.intro}
                </p>
                <p className="text-sm text-text-muted leading-relaxed font-body">
                  {seo.secondary}
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs rounded-full bg-bg-primary border border-border px-3 py-1.5 text-text-secondary font-body">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    {t("badgeStock")}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs rounded-full bg-bg-primary border border-border px-3 py-1.5 text-text-secondary font-body">
                    {t("badgeShipping")}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs rounded-full bg-bg-primary border border-border px-3 py-1.5 text-text-secondary font-body">
                    {t("badgeMinimum")}
                  </span>
                </div>
              </div>
              {heroMosaic.length >= 4 && (
                <div className="hidden md:grid grid-cols-2 gap-1 p-2">
                  {heroMosaic.map((src, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={`${src}-${i}`}
                      src={src}
                      alt=""
                      className="aspect-square rounded-2xl object-cover w-full h-full"
                      loading="lazy"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Chips sous-catégories */}
        {category.subCategories.length > 0 && (
          <section className="container-site pb-6">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium mr-2 font-body">
                {t("filterByType")}
              </span>
              {category.subCategories.map((sub) => (
                <Link
                  key={sub.id}
                  href={`/produits?cat=${category.id}&subcat=${sub.id}`}
                  className="text-xs rounded-full border border-border bg-bg-primary px-3 py-1.5 text-text-secondary hover:border-text-primary hover:text-text-primary transition-colors font-body"
                >
                  {sub.translations[0]?.name ?? sub.name}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Grille produits */}
        <section className="container-site pb-12">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-heading text-xl font-semibold text-text-primary">
              {t("productsHeading", { name: localizedName })}
            </h2>
            <div className="text-xs text-text-muted font-body">
              {t("productsCount", { count: category._count.products })}
            </div>
          </div>
          {products.length === 0 ? (
            <div className="text-center py-16 text-text-muted font-body">{t("empty")}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 md:gap-5">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  reference={p.reference}
                  category={p.category}
                  subCategory={p.subCategory}
                  colors={p.colors}
                />
              ))}
            </div>
          )}
          {category._count.products > products.length && (
            <div className="mt-8 text-center">
              <Link
                href={`/produits?cat=${category.id}`}
                className="inline-flex items-center gap-2 text-sm font-medium text-text-primary border-b border-text-primary hover:opacity-70 transition-opacity font-body"
              >
                {t("seeAllInCatalog", { count: category._count.products })}
              </Link>
            </div>
          )}
        </section>

        {/* FAQ */}
        {seo.faq.length > 0 && (
          <section className="container-site pb-12">
            <div className="max-w-3xl">
              <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium mb-3 font-body">
                {t("faqEyebrow")}
              </div>
              <h2 className="font-heading text-2xl font-semibold mb-6 text-text-primary">
                {t("faqHeading", { name: localizedName })}
              </h2>
              <CategoryFaq items={seo.faq} />
            </div>
          </section>
        )}

        {/* Catégories liées */}
        {relatedWithProducts.length > 0 && (
          <section className="container-site pb-16">
            <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium mb-3 font-body">
              {t("relatedEyebrow")}
            </div>
            <h2 className="font-heading text-xl font-semibold mb-4 text-text-primary">
              {t("relatedHeading")}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {relatedWithProducts.map((rc) => (
                <Link
                  key={rc.id}
                  href={`/categories/${rc.slug}`}
                  className="rounded-2xl border border-border bg-bg-primary p-4 hover:border-border-strong transition-colors"
                >
                  <div className="text-sm font-medium text-text-primary font-body">
                    {rc.translations[0]?.name ?? rc.name}
                  </div>
                  <div className="text-xs text-text-muted mt-1 font-body">
                    {t("productsCount", { count: rc._count.products })}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <Footer shopName={shopName} />
      </div>

      {/* JSON-LD schema.org */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}
    </div>
  );
}
