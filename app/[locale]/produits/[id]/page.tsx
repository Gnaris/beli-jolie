import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { notFound, permanentRedirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getProductTranslation } from "@/lib/translate";
import { getCachedSiteConfig, getCachedShopName } from "@/lib/cached-data";
import { getCurrentTenantId, getCurrentTenantSlug } from "@/lib/tenant";
import { getImageSrc } from "@/lib/image-utils";
import { buildAlternates, buildMerchantOfferExtras, getSiteUrl } from "@/lib/seo";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { canSeePrices } from "@/lib/price-visibility";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import ProductDetail from "@/components/produits/ProductDetail";
import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import ProductDetailIssymaLayout from "@/components/issyma/ProductDetailIssymaLayout";
import { loadActivePromotions } from "@/lib/promotions";
import { resolveBestPercentForProductBadge } from "@/lib/promotion-engine";
import { getProductPrimaryColorId } from "@/lib/product-primary-color";
import { buildProductHandle, parseProductHandle } from "@/lib/product-url";

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

// Résolution nom traduit → fallback FR. Fonctionne aussi bien pour `color`
// que pour `composition` (structure identique : { name, translations?[] }).
function resolveTranslatedName<T extends { name: string; translations?: { name: string }[] } | null | undefined>(
  entity: T,
): string | null {
  if (!entity) return null;
  const t = entity.translations?.[0]?.name;
  if (t && t.trim() !== "") return t;
  return entity.name;
}

const getProduct = cache(async (handle: string, locale: string) => {
  const withTranslations = locale !== "fr";
  const categorySelect = withTranslations
    ? { name: true, slug: true, translations: { where: { locale }, select: { name: true }, take: 1 } }
    : { name: true, slug: true };
  const colorSelect = withTranslations
    ? { name: true, hex: true, patternImage: true, translations: { where: { locale }, select: { name: true }, take: 1 } }
    : { name: true, hex: true, patternImage: true };
  const compositionSelect = withTranslations
    ? { name: true, translations: { where: { locale }, select: { name: true }, take: 1 } }
    : { name: true };
  const relatedColorSelect = withTranslations
    ? { name: true, translations: { where: { locale }, select: { name: true }, take: 1 } }
    : { name: true };
  const parsed = parseProductHandle(handle);
  const where = parsed.legacyCuid
    ? { id: parsed.legacyCuid }
    : parsed.referenceCandidates.length > 0
      ? { reference: { in: parsed.referenceCandidates } }
      : null;
  if (!where) return null;
  const matches = await prisma.product.findMany({
    where,
    take: 5,
    include: {
      category:      { select: categorySelect },
      subCategories: { select: { name: true } },
      tags:          { include: { tag: { select: { id: true, name: true } } } },
      colors: {
        where: { disabled: false },
        include: {
          color: { select: colorSelect },
          variantSizes: {
            orderBy: { size: { position: "asc" } },
            include: { size: true },
          },
        },
        orderBy: { isPrimary: "desc" },
      },
      compositions: {
        include: { composition: { select: compositionSelect } },
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
                select:  { colorId: true, unitPrice: true, color: { select: relatedColorSelect } },
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
                select:  { colorId: true, unitPrice: true, color: { select: relatedColorSelect } },
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
                select:  { colorId: true, unitPrice: true, color: { select: relatedColorSelect } },
              },
            },
          },
        },
      },
    },
  });
  if (matches.length <= 1) return matches[0] ?? null;
  // Ambiguïté : plusieurs refs candidates ont matché (ex `BRACELET33` et
  // `PRT-BRACELET33` existent tous deux). Préfère celui dont le handle
  // canonique correspond exactement au handle demandé ; sinon la ref la plus
  // longue (la plus spécifique).
  const exact = matches.find((p) => buildProductHandle(p.name, p.reference) === handle);
  if (exact) return exact;
  return [...matches].sort((a, b) => b.reference.length - a.reference.length)[0]!;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  await getCurrentTenantId(); // bind ALS avant Prisma / caches
  const { id: handle, locale } = await params;
  const product = await getProduct(handle, locale);
  if (!product || product.status === "ARCHIVED") {
    return { title: "Produit introuvable", robots: { index: false, follow: false } };
  }

  const firstImage = await prisma.productColorImage.findFirst({
    where: { productId: product.id },
    orderBy: { order: "asc" },
    select: { path: true },
  });

  const canonicalHandle = buildProductHandle(product.name, product.reference);
  const [shopName, siteUrl, alternates] = await Promise.all([
    getCachedShopName(),
    getSiteUrl(),
    buildAlternates(`/produits/${canonicalHandle}`, locale),
  ]);
  const title = product.name;
  const description = product.description.slice(0, 160).replace(/\n/g, " ");
  const imageUrl = firstImage ? getImageSrc(firstImage.path, "large") : null;

  // OFFLINE / SYNCING : page servie mais Google ne doit pas l'indexer
  // (état transitoire — la fiche reviendra ONLINE ou basculera ARCHIVED)
  const isIndexable = product.status === "ONLINE";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: shopName,
      url: `${siteUrl}/${locale}/produits/${canonicalHandle}`,
      ...(imageUrl && { images: [{ url: imageUrl, width: 800, height: 800, alt: product.name }] }),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(imageUrl && { images: [imageUrl] }),
    },
    alternates,
    ...(isIndexable ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function ProduitDetailPage({ params }: PageProps) {
  await getCurrentTenantId(); // bind ALS avant Prisma / caches
  const { id: handle, locale: routeLocale } = await params;

  // Fetch product, session, config, and locale in parallel
  const [product, session, stockVariantsConfig, locale, shopName, tenantSlug] = await Promise.all([
    getProduct(handle, routeLocale),
    getServerSession(authOptions),
    getCachedSiteConfig("show_out_of_stock_variants"),
    getLocale(),
    getCachedShopName(),
    getCurrentTenantSlug(),
  ]);

  // Produit introuvable ou définitivement supprimé (ARCHIVED). On tente un
  // dernier lookup dans l'historique OrderItem : si un client a acheté ce
  // produit avant sa suppression, on lui affiche un layout dédié « n'est
  // plus disponible » (avec les infos snapshot copiées lors de la commande)
  // au lieu d'un 404 sec. La page reste noindex (cf. generateMetadata) pour
  // ne pas polluer Google.
  if (!product || product.status === "ARCHIVED") {
    const refCandidates = product
      ? [product.reference]
      : parseProductHandle(handle).referenceCandidates;

    const historicItem = refCandidates.length > 0
      ? await prisma.orderItem.findFirst({
          where: { productRef: { in: refCandidates } },
          orderBy: { createdAt: "desc" },
          select: {
            productName: true,
            productRef: true,
            imagePath: true,
            colorName: true,
          },
        })
      : null;

    if (!historicItem) notFound();

    const tProducts = await getTranslations("products");
    return (
      <div className="min-h-screen relative">
        <PublicSidebar shopName={shopName} tenantSlug={tenantSlug ?? undefined} />
        <div className="min-w-0 relative z-10">
          <main className="min-h-screen bg-bg-secondary relative overflow-hidden">
            <div className="container-site py-10">
              <nav className="flex items-center gap-2 text-sm font-body text-text-muted mb-8">
                <Link href="/produits" className="hover:text-text-primary transition-colors">
                  {tProducts("breadcrumb")}
                </Link>
                <span className="text-border">/</span>
                <span className="text-text-secondary truncate">{historicItem.productName}</span>
              </nav>
              <div className="max-w-2xl mx-auto py-16">
                <div className="bg-bg-primary border border-border rounded-3xl shadow-sm p-8 sm:p-10">
                  <div className="flex flex-col sm:flex-row items-start gap-6">
                    {historicItem.imagePath ? (
                      // Miniature copiée dans le dossier de la commande —
                      // survit à la suppression de la fiche produit.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={historicItem.imagePath}
                        alt={historicItem.productName}
                        className="w-32 h-32 rounded-2xl object-cover border border-border shrink-0"
                      />
                    ) : (
                      <div className="w-32 h-32 rounded-2xl bg-bg-tertiary border border-border flex items-center justify-center text-text-muted text-xs shrink-0">
                        —
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted mb-2">
                        Produit archivé
                      </p>
                      <h1 className="text-2xl font-heading font-semibold text-text-primary mb-1">
                        {historicItem.productName}
                      </h1>
                      <p className="text-xs font-mono text-text-muted mb-4">
                        Référence : {historicItem.productRef}
                      </p>
                      <p className="text-sm text-text-secondary mb-6">
                        Ce produit a été retiré du catalogue et n'est plus
                        disponible à la vente. Les informations restent
                        conservées pour vos commandes passées.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <Link
                          href="/produits"
                          className="btn-primary px-5 py-2.5 rounded-xl font-medium text-sm"
                        >
                          {tProducts("backToProducts")}
                        </Link>
                        <Link
                          href="/commandes"
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium border border-border text-text-primary hover:bg-bg-secondary transition-colors"
                        >
                          Mes commandes
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
          <Footer shopName={shopName} />
        </div>
      </div>
    );
  }

  // Meilleur % de remise applicable au produit (manuel vs promos AUTO ciblantes)
  const [activePromos, productCollections] = await Promise.all([
    loadActivePromotions(),
    prisma.collectionProduct.findMany({
      where: { productId: product.id },
      select: { collectionId: true },
    }),
  ]);
  const manualDiscountPercent = product.discountPercent != null ? Number(product.discountPercent) : 0;
  const bestDiscountPercent = resolveBestPercentForProductBadge(
    {
      productId: product.id,
      categoryId: product.categoryId,
      collectionIds: productCollections.map((c) => c.collectionId),
      productDiscountPercent: manualDiscountPercent,
    },
    activePromos,
  );

  // Redirection 301 permanente vers l'URL canonique (slug + reference) :
  // - cuid legacy `/produits/{cuid}` posé par l'ancien schéma → nouvel URL SEO
  // - slug obsolète (produit renommé) → nouveau slug pour ne pas cannibaliser
  //   les positions Google entre 2 URLs qui pointent la même fiche.
  const canonicalHandle = buildProductHandle(product.name, product.reference);
  if (handle !== canonicalHandle) {
    permanentRedirect(`/${routeLocale}/produits/${canonicalHandle}`);
  }

  // Product exists but is not online (e.g. OFFLINE during refresh) — show unavailable page
  if (product.status !== "ONLINE") {
    const tProducts = await getTranslations("products");
    return (
      <div className="min-h-screen relative">
        <PublicSidebar shopName={shopName} tenantSlug={tenantSlug ?? undefined} />
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
      where:   { productId: product.id },
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

  // Build variant group keys: colorId (sur TOUTES les variantes — sert au
  // filtrage "couleur sans image" ci-dessous).
  const pcGroupKeys = new Map<string, string>();
  for (const pc of product.colors) {
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

  // Masquage automatique des couleurs sans aucune image — côté visiteur, une
  // variante sans photo n'a pas de carte à afficher. Cohérent avec les push
  // marketplaces qui ignorent aussi ces couleurs (lib/variant-image-coverage).
  const colorsWithImages = product.colors.filter((pc) => {
    const gk = pcGroupKeys.get(pc.id);
    return gk ? imagesByGroup.has(gk) : false;
  });

  // Filter out OOS variants if config says so
  const showOosVariants = stockVariantsConfig?.value !== "false";
  const filteredColors = showOosVariants
    ? colorsWithImages
    : colorsWithImages.filter((pc) => pc.stock > 0);

  // Couleur principale via helper (Product.primaryColorId + fallback isPrimary).
  const primaryColorIdResolved = getProductPrimaryColorId({
    primaryColorId: product.primaryColorId,
    colors: product.colors,
  });

  for (const imgs of imagesByGroup.values()) imgs.sort((a, b) => a.order - b.order);
  // Le badge « Réf » n'est plus affiché sur la boutique publique — seuls PFS
  // et eFashion continuent de le recevoir (voir SiteConfig
  // "branded_reference_badge_enabled").
  const colorImagesForDetail = [...imagesByGroup.entries()].map(([gk, imgs]) => {
    const seen = new Set<string>();
    const unique = imgs.filter((img) => {
      if (seen.has(img.path)) return false;
      seen.add(img.path);
      return true;
    });
    return { groupKey: gk, images: unique };
  });
  const translated = await getProductTranslation(product.id, locale as "fr" | "en", {
    name: product.name,
    description: product.description,
  });
  const tProducts = await getTranslations("products");

  // Catégorie : si une traduction existe pour la locale courante, on l'utilise (fil d'Ariane + JSON-LD)
  const categoryRaw = product.category as { name: string; translations?: { name: string }[] };
  const translatedCategoryName = categoryRaw.translations?.[0]?.name ?? categoryRaw.name;

  function toRelated(p: { id: string; name: string; reference: string; colors: { colorId: string | null; unitPrice: any; color: ({ name: string; translations?: { name: string }[] }) | null }[] }) {
    const pc  = p.colors[0];
    const img = relatedColorImages.find(
      (i) => i.productId === p.id && i.colorId === pc?.colorId
    );
    return {
      id:               p.id,
      name:             p.name,
      reference:        p.reference,
      primaryImage:     img?.path ?? null,
      primaryColorName: resolveTranslatedName(pc?.color ?? null),
      minPrice:         pc ? Number(pc.unitPrice) : 0,
    };
  }

  // JSON-LD structured data for SEO
  const primaryColor = (primaryColorIdResolved
    ? filteredColors.find((c) => c.colorId === primaryColorIdResolved)
    : null) ?? filteredColors.find((c) => c.isPrimary) ?? filteredColors[0];
  const minPrice = filteredColors.length > 0
    ? Math.min(...filteredColors.map((c) => Number(c.unitPrice)))
    : 0;
  const firstImg = colorImages[0]?.path;
  const siteUrl = await getCurrentTenantBaseUrl();
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: translated.name,
    description: translated.description.slice(0, 500),
    sku: product.reference,
    category: translatedCategoryName,
    ...(firstImg && { image: getImageSrc(firstImg, "large") }),
    brand: {
      "@type": "Brand",
      name: shopName,
    },
    offers: {
      "@type": "Offer",
      url: `${siteUrl}/${routeLocale}/produits/${canonicalHandle}`,
      priceCurrency: "EUR",
      price: minPrice.toFixed(2),
      ...buildMerchantOfferExtras(),
      availability: primaryColor && primaryColor.stock > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Produits", item: `${siteUrl}/produits` },
      { "@type": "ListItem", position: 2, name: translatedCategoryName, item: `${siteUrl}/${locale}/categories/${product.category.slug}` },
      { "@type": "ListItem", position: 3, name: translated.name },
    ],
  };

  // Le composant interactif ProductDetail est partagé entre les deux tenants —
  // seul l'habillage (header, breadcrumb, fond, footer) change.
  const productDetailNode = (
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
        colorName:     resolveTranslatedName(pc.color ?? null) ?? undefined,
        colorHex:      pc.color?.hex,
        patternImage:  pc.color?.patternImage,
        unitPrice:     Number(pc.unitPrice),
        weight:        pc.weight,
        stock:         pc.stock,
        isPrimary:     primaryColorIdResolved != null && pc.colorId === primaryColorIdResolved,
        saleType:      pc.saleType,
        packQuantity:  pc.packQuantity,
        sizes:         (pc.variantSizes ?? []).map((vs: any) => ({ name: vs.size.name, quantity: vs.quantity, pricePerUnit: vs.pricePerUnit != null ? Number(vs.pricePerUnit) : undefined })),
      }))}
      colorImages={colorImagesForDetail}
      compositions={product.compositions.map((c) => ({
        name:       resolveTranslatedName(c.composition) ?? c.composition.name,
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
      sizeDetailsTu={product.sizeDetailsTu}
      discountPercent={bestDiscountPercent > 0 ? bestDiscountPercent : (manualDiscountPercent > 0 ? manualDiscountPercent : null)}
      clientDiscount={clientDiscount}
      isAuthenticated={!!session?.user?.id}
      showPrices={canSeePrices(session)}
      isRevoked={session?.user?.status === "REJECTED"}
    />
  );

  // Dispatch tenant : Issyma reçoit un rendu complètement custom (gallery,
  // accordions, produits similaires) matchant le visuel Issyma. BJ inchangé.
  const effectiveSlug = await getEffectiveTenantSlug();
  if (effectiveSlug === "issyma") {
    const issymaVariants = filteredColors.map((pc) => ({
      id: pc.id,
      groupKey: pcGroupKeys.get(pc.id)!,
      colorId: pc.colorId,
      colorName: resolveTranslatedName(pc.color ?? null),
      hex: pc.color?.hex ?? null,
      patternImage: pc.color?.patternImage ?? null,
      unitPrice: Number(pc.unitPrice),
      stock: pc.stock,
      saleType: pc.saleType as "UNIT" | "PACK",
      packQuantity: pc.packQuantity,
      sizes: (pc.variantSizes ?? []).map((vs: any) => ({
        name: vs.size.name,
        quantity: vs.quantity,
      })),
    }));
    const issymaImageGroups = colorImagesForDetail.map((g) => ({
      groupKey: g.groupKey,
      images: g.images.map((i) => i.path),
    }));
    const compositionsText = product.compositions
      .map((c) => `${resolveTranslatedName(c.composition) ?? c.composition.name} ${c.percentage}%`)
      .join(" · ");
    return (
      <ProductDetailIssymaLayout
        shopName={shopName}
        categorySlug={product.category.slug ?? ""}
        categoryName={translatedCategoryName}
        productId={product.id}
        productName={translated.name}
        reference={product.reference}
        description={translated.description}
        compositionsText={compositionsText}
        variants={issymaVariants}
        imageGroups={issymaImageGroups}
        similarProducts={product.similarProducts.map((sp) => toRelated(sp.similar))}
        showPrices={canSeePrices(session)}
        isAuthenticated={!!session?.user?.id}
        isRevoked={session?.user?.status === "REJECTED"}
        jsonLdBlocks={[productJsonLd, breadcrumbJsonLd]}
      />
    );
  }

  return (
    <div className="min-h-screen relative">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <PublicSidebar shopName={shopName} tenantSlug={tenantSlug ?? undefined} />
      <div className="min-w-0 relative z-10">
        <main className="min-h-screen bg-bg-secondary relative overflow-hidden">
          <div className="container-site py-10 relative">

            {/* Fil d'Ariane */}
            <nav className="flex items-center gap-2 text-sm font-body text-text-muted mb-8">
              <Link href="/produits" className="hover:text-text-primary transition-colors">
                {tProducts("breadcrumb")}
              </Link>
              <span className="text-border">/</span>
              <Link href={`/categories/${product.category.slug}`} className="hover:text-text-primary transition-colors">
                {translatedCategoryName}
              </Link>
              <span className="text-border">/</span>
              <span className="text-text-secondary truncate">{translated.name}</span>
            </nav>

            {productDetailNode}
          </div>
        </main>
        <Footer shopName={shopName} />
      </div>
    </div>
  );
}
