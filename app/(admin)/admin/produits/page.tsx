import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import AdminProductsFilters from "@/components/admin/products/AdminProductsFilters";
import AdminProductsTable from "@/components/admin/products/AdminProductsTable";
import AdminPagination from "@/components/admin/products/AdminPagination";
import AdminProductsTabsWrapper from "@/components/admin/products/AdminProductsTabsWrapper";
import ProductTranslateAllButton from "@/components/admin/products/ProductTranslateAllButton";
import ProductStatusTabs from "@/components/admin/products/ProductStatusTabs";
import { getCachedAdminWarnings, getCachedSiteConfig } from "@/lib/cached-data";
import { getPfsAnnexes } from "@/lib/marketplace-excel/pfs-annexes";

// Attribute managers
import CategoriesManager from "@/components/admin/categories/SubCategoryList";
import EntityCreateButton from "@/components/admin/EntityCreateButton";
import ColorsManager from "@/components/admin/couleurs/ColorsManager";
import CompositionsManager from "@/components/admin/compositions/CompositionsManager";
import ManufacturingCountriesManager from "@/components/admin/manufacturing-countries/ManufacturingCountriesManager";
import SeasonsManager from "@/components/admin/seasons/SeasonsManager";
import SizesManager from "@/components/admin/tailles/SizesManager";
import TagsManager from "@/app/(admin)/admin/mots-cles/TagsManager";

export const metadata: Metadata = {
  title: "Produits",
};

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    q?: string;
    exactRef?: string;
    page?: string;
    perPage?: string;
    cat?: string;
    status?: string;
    syncStatus?: string;
    minPrice?: string;
    maxPrice?: string;
    dateFrom?: string;
    dateTo?: string;
    stockBelow?: string;
  }>;
}

const VALID_TABS = ["produits", "categories", "couleurs", "compositions", "pays", "saisons", "tailles", "mots-cles"] as const;
type TabKey = (typeof VALID_TABS)[number];

/** Render only the active tab's content server-side (avoids PFS calls + heavy queries for hidden tabs) */
function getActiveTabContent(activeTab: TabKey, params: Record<string, string | undefined>) {
  switch (activeTab) {
    case "produits":     return <ProduitsContent params={params} />;
    case "categories":   return <CategoriesContent />;
    case "couleurs":     return <CouleursContent />;
    case "compositions": return <CompositionsContent />;
    case "pays":         return <PaysContent />;
    case "saisons":      return <SaisonsContent />;
    case "tailles":      return <TaillesContent />;
    case "mots-cles":    return <MotsClesContent />;
  }
}

export default async function ProduitsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const activeTab = (VALID_TABS.includes(params.tab as TabKey) ? params.tab : "produits") as TabKey;

  return (
    <div className="space-y-6">
      <Suspense fallback={
        <AdminProductsTabsWrapper initialTab={activeTab}>
          <Suspense>{getActiveTabContent(activeTab, params)}</Suspense>
        </AdminProductsTabsWrapper>
      }>
        <TabsWithWarnings activeTab={activeTab} params={params} />
      </Suspense>
    </div>
  );
}

/** Async wrapper that loads tab warnings without blocking the page render */
async function TabsWithWarnings({ activeTab, params }: { activeTab: TabKey; params: Record<string, string | undefined> }) {
  const {
    untranslatedCount,
    unusedColorsCount,
    unusedCompositionsCount,
    unusedTagsCount,
    untranslatedCategoriesCount,
    untranslatedSubCategoriesCount,
  } = await getCachedAdminWarnings();

  const tabWarnings: Record<string, number> = {};
  if (untranslatedCount > 0) tabWarnings["produits"] = untranslatedCount;
  if (unusedColorsCount > 0) tabWarnings["couleurs"] = unusedColorsCount;
  if (unusedCompositionsCount > 0) tabWarnings["compositions"] = unusedCompositionsCount;
  if (unusedTagsCount > 0) tabWarnings["mots-cles"] = unusedTagsCount;
  if (untranslatedCategoriesCount + untranslatedSubCategoriesCount > 0) tabWarnings["categories"] = untranslatedCategoriesCount + untranslatedSubCategoriesCount;

  return (
    <AdminProductsTabsWrapper initialTab={activeTab} warnings={tabWarnings}>
      <Suspense>{getActiveTabContent(activeTab, params)}</Suspense>
    </AdminProductsTabsWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Produits
   ═══════════════════════════════════════════════════════════════════════════ */
async function ProduitsContent({ params }: { params: Record<string, string | undefined> }) {
  const {
    q = "",
    exactRef: exactRefParam,
    page: pageParam = "1",
    perPage: perPageParam = "20",
    cat = "",
    status: statusFilter = "",
    syncStatus: syncStatusFilter = "",
    minPrice: minPriceParam = "",
    maxPrice: maxPriceParam = "",
    dateFrom = "",
    dateTo = "",
    stockBelow: stockBelowParam = "",
  } = params;

  const exactRef   = exactRefParam === "1";
  const currentPage = Math.max(1, parseInt(pageParam));
  const perPage     = Math.max(1, parseInt(perPageParam) || 20);
  const minPrice    = minPriceParam ? parseFloat(minPriceParam) : null;
  const maxPrice    = maxPriceParam ? parseFloat(maxPriceParam) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};

  if (q) {
    if (exactRef) {
      where.reference = { equals: q.toUpperCase() };
    } else {
      where.OR = [
        { name:      { contains: q } },
        { reference: { contains: q } },
      ];
    }
  }

  if (cat) where.categoryId = cat;
  if (statusFilter === "DRAFT") {
    where.status = "OFFLINE";
    where.isIncomplete = true;
  } else if (statusFilter === "OFFLINE") {
    where.status = "OFFLINE";
    where.isIncomplete = false;
  } else if (statusFilter === "ONLINE" || statusFilter === "ARCHIVED" || statusFilter === "SYNCING" || statusFilter === "IMPORTED") {
    where.status = statusFilter;
  }

  // Sync marketplace filter removed — marketplaces are now populated via Excel export.
  void syncStatusFilter;

  if (minPrice !== null || maxPrice !== null) {
    where.colors = {
      some: {
        unitPrice: {
          ...(minPrice !== null && { gte: minPrice }),
          ...(maxPrice !== null && { lte: maxPrice }),
        },
      },
    };
  }

  if (dateFrom) where.createdAt = { ...where.createdAt, gte: new Date(dateFrom) };
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    where.createdAt = { ...where.createdAt, lte: end };
  }

  const stockBelow = stockBelowParam ? parseInt(stockBelowParam) : null;
  if (stockBelow !== null && !isNaN(stockBelow)) {
    where.colors = { ...where.colors, some: { ...where.colors?.some, stock: { lte: stockBelow } } };
  }

  const [products, totalCount, categories, sectionCounts] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (currentPage - 1) * perPage,
      take:    perPage,
      include: {
        category:      { select: { name: true } },
        subCategories: { select: { name: true }, take: 1 },
        colors: {
          select: {
            id:            true,
            colorId:       true,
            unitPrice:     true,
            weight:        true,
            stock:         true,
            isPrimary:     true,
            saleType:      true,
            packQuantity:  true,
            color:         { select: { name: true, hex: true, patternImage: true } },
            subColors:     { orderBy: { position: "asc" }, select: { color: { select: { name: true, hex: true, patternImage: true } } } },
            variantSizes:  { select: { quantity: true, size: { select: { name: true } } } },
          },
        },
        translations: { select: { locale: true } },
      },
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // Section counts for tabs (lightweight parallel queries)
    Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: { status: "ONLINE" } }),
      prisma.product.count({ where: { status: "OFFLINE", isIncomplete: false } }),
      prisma.product.count({ where: { status: "OFFLINE", isIncomplete: true } }),
      prisma.product.count({ where: { status: "ARCHIVED" } }),
    ]).then(([all, online, offline, draft, archived]) => ({ all, online, offline, draft, archived })),
  ]);

  const productIds = products.map((p) => p.id);
  const firstImages = productIds.length > 0
    ? await prisma.productColorImage.findMany({
        where:   { productId: { in: productIds } },
        orderBy: { order: "asc" },
        select:  { productId: true, path: true },
      })
    : [];
  const firstImageMap = new Map<string, string>();
  for (const img of firstImages) {
    if (!firstImageMap.has(img.productId)) firstImageMap.set(img.productId, img.path);
  }

  const totalPages = Math.ceil(totalCount / perPage);

  const serializedProducts = products.map((p) => ({
    id:              p.id,
    reference:       p.reference,
    name:            p.name,
    status:          p.status as "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING" | "IMPORTED",
    isIncomplete:    p.isIncomplete,
    categoryName:    p.category.name,
    subCategoryName: p.subCategories[0]?.name ?? null,
    createdAt:       p.createdAt.toISOString(),
    firstImage:      firstImageMap.get(p.id) ?? null,
    colors:          p.colors.map((c) => ({
      id:            c.id,
      colorId:       c.colorId ?? "",
      unitPrice:     Number(c.unitPrice),
      weight:        c.weight,
      stock:         c.stock,
      isPrimary:     c.isPrimary,
      saleType:      c.saleType as "UNIT" | "PACK",
      packQuantity:  c.packQuantity,
      variantSizes:  c.variantSizes,
      color:         c.color ?? { name: "—", hex: null, patternImage: null },
      subColors:     c.subColors,
    })),
    translations:    p.translations,
  }));

  return (
    <>
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Produits</h1>
          <p className="page-subtitle font-body mt-1">
            {totalCount} produit{totalCount > 1 ? "s" : ""} au catalogue
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/produits/importer" className="btn-secondary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Importer
          </Link>
          <Link href="/admin/produits/nouveau" className="btn-primary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nouveau produit
          </Link>
        </div>
      </div>

      {/* Stats rapides */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        <div className="bg-bg-primary border border-border rounded-xl px-4 py-3">
          <p className="text-[11px] font-body text-text-muted uppercase tracking-wider font-medium">Total</p>
          <p className="text-xl font-heading font-bold text-text-primary mt-0.5 tabular-nums">{sectionCounts.all}</p>
        </div>
        <div className="bg-bg-primary border border-border rounded-xl px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
            <p className="text-[11px] font-body text-text-muted uppercase tracking-wider font-medium">En ligne</p>
          </div>
          <p className="text-xl font-heading font-bold text-[#15803D] mt-0.5 tabular-nums">{sectionCounts.online}</p>
        </div>
        <div className="bg-bg-primary border border-border rounded-xl px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#9CA3AF]" />
            <p className="text-[11px] font-body text-text-muted uppercase tracking-wider font-medium">Hors ligne</p>
          </div>
          <p className="text-xl font-heading font-bold text-text-secondary mt-0.5 tabular-nums">{sectionCounts.offline}</p>
        </div>
        <div className="bg-bg-primary border border-border rounded-xl px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
            <p className="text-[11px] font-body text-text-muted uppercase tracking-wider font-medium">Brouillons</p>
          </div>
          <p className="text-xl font-heading font-bold text-[#7C3AED] mt-0.5 tabular-nums">{sectionCounts.draft}</p>
        </div>
      </div>

      {/* Onglets de section */}
      <div className="mt-5">
        <Suspense>
          <ProductStatusTabs counts={sectionCounts} />
        </Suspense>
      </div>

      {/* Filtres */}
      <div className="bg-bg-primary border border-border rounded-2xl px-6 py-5 mt-4 shadow-sm">
        <Suspense>
          <AdminProductsFilters totalCount={totalCount} categories={categories} />
        </Suspense>
      </div>

      {/* Tout traduire */}
      <div className="py-2 flex items-center justify-end">
        <ProductTranslateAllButton
          products={serializedProducts.map((p) => ({
            id: p.id,
            name: p.name,
            translationLocales: p.translations.map((t) => t.locale),
          }))}
        />
      </div>

      {/* Tableau */}
      <AdminProductsTable products={serializedProducts} totalCount={totalCount} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-2">
          <p className="text-[11px] text-text-muted font-body tabular-nums">
            Affichage de <span className="font-semibold text-text-secondary">{(currentPage - 1) * perPage + 1}–{Math.min(currentPage * perPage, totalCount)}</span> sur {totalCount}
          </p>
          <Suspense>
            <AdminPagination currentPage={currentPage} totalPages={totalPages} />
          </Suspense>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Catégories
   ═══════════════════════════════════════════════════════════════════════════ */
async function CategoriesContent() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      subCategories: {
        orderBy: { name: "asc" },
        include: { translations: true },
      },
      translations: true,
      _count: { select: { products: true } },
    },
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="page-title">Catégories &amp; sous-catégories</h1>
        <p className="page-subtitle font-body">
          Organisez votre catalogue produits
        </p>
      </div>

      <div className="bg-bg-primary border border-border rounded-xl p-5 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary font-heading">Nouvelle catégorie</p>
          <p className="text-xs text-text-muted font-body mt-0.5">
            Saisissez le nom dans toutes les langues souhaitées.
          </p>
        </div>
        <EntityCreateButton type="category" label="+ Créer une catégorie" />
      </div>

      <CategoriesManager
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          pfsGender: c.pfsGender,
          pfsFamilyName: c.pfsFamilyName,
          pfsCategoryName: c.pfsCategoryName,
          productCount: c._count.products,
          translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
          subCategories: c.subCategories.map((s) => ({
            id: s.id,
            name: s.name,
            translations: Object.fromEntries(s.translations.map((t) => [t.locale, t.name])),
          })),
        }))}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Couleurs
   ═══════════════════════════════════════════════════════════════════════════ */
async function CouleursContent() {
  const colors = await prisma.color.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { productColors: true } },
      translations: true,
    },
  });

  const colorItems = colors.map((c) => ({
    id: c.id,
    name: c.name,
    hex: c.hex,
    patternImage: c.patternImage,
    pfsColorRef: null,
    productCount: c._count.productColors,
    translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title">Bibliothèque de couleurs</h1>
          <p className="page-subtitle">
            Créez les couleurs ici, puis assignez-les à vos produits.
          </p>
        </div>
        <EntityCreateButton type="color" label="+ Créer une couleur" />
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-sm font-semibold text-text-secondary uppercase tracking-wider border-b border-border pb-2">
          Couleurs ({colors.length})
        </h2>
        <ColorsManager initialColors={colorItems} />
      </section>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Compositions
   ═══════════════════════════════════════════════════════════════════════════ */
async function CompositionsContent() {
  const compositions = await prisma.composition.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
      translations: true,
    },
  });

  const compositionItems = compositions.map((c) => ({
    id: c.id,
    name: c.name,
    pfsCompositionRef: c.pfsCompositionRef,
    productCount: c._count.products,
    translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title">Bibliothèque de compositions</h1>
          <p className="page-subtitle">
            Créez les matériaux et compositions — ils seront assignables aux produits avec un pourcentage.
          </p>
        </div>
        <EntityCreateButton type="composition" label="+ Créer une composition" />
      </div>

      <CompositionsManager initialCompositions={compositionItems} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Pays de fabrication
   ═══════════════════════════════════════════════════════════════════════════ */
async function PaysContent() {
  const countries = await prisma.manufacturingCountry.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
      translations: true,
    },
  });

  const countryItems = countries.map((c) => ({
    id: c.id,
    name: c.name,
    isoCode: c.isoCode,
    pfsCountryRef: c.pfsCountryRef,
    productCount: c._count.products,
    translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title">Pays de fabrication</h1>
          <p className="page-subtitle">
            Gérez les pays de fabrication de vos produits.
          </p>
        </div>
        <EntityCreateButton type="country" label="+ Créer un pays" />
      </div>

      <ManufacturingCountriesManager initialCountries={countryItems} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Saisons
   ═══════════════════════════════════════════════════════════════════════════ */
async function SaisonsContent() {
  const seasons = await prisma.season.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
      translations: true,
    },
  });

  const seasonItems = seasons.map((s) => ({
    id: s.id,
    name: s.name,
    pfsRef: s.pfsRef,
    productCount: s._count.products,
    translations: Object.fromEntries(s.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title">Saisons</h1>
          <p className="page-subtitle">
            Gérez les saisons / collections de vos produits (ex: Printemps/Été 2026).
          </p>
        </div>
        <EntityCreateButton type="season" label="+ Créer une saison" />
      </div>

      <SeasonsManager initialSeasons={seasonItems} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Tailles
   ═══════════════════════════════════════════════════════════════════════════ */
async function TaillesContent() {
  const [sizes, annexes] = await Promise.all([
    prisma.size.findMany({
      orderBy: { position: "asc" },
      include: {
        _count: { select: { variantSizes: true } },
      },
    }),
    getPfsAnnexes().catch(() => null),
  ]);

  const pfsSizes = (annexes?.sizes ?? []).map((ref) => ({ reference: ref, label: ref }));

  const sizeItems = sizes.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    variantCount: s._count.variantSizes,
    pfsSizeRef: s.pfsSizeRef,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Gestion des tailles</h1>
        <p className="page-subtitle">
          Bibliothèque de tailles : créez-les une fois, elles sont disponibles pour tous les produits.
        </p>
      </div>

      <SizesManager initialSizes={sizeItems} pfsSizes={pfsSizes} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Mots clés
   ═══════════════════════════════════════════════════════════════════════════ */
async function MotsClesContent() {
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
      translations: true,
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Mots clés</h1>
        <p className="page-subtitle">
          Gérez les mots clés réutilisables sur plusieurs produits.
        </p>
      </div>

      <TagsManager
        initialTags={tags.map((t) => ({
          id: t.id,
          name: t.name,
          productCount: t._count.products,
          translations: Object.fromEntries(t.translations.map((tr) => [tr.locale, tr.name])),
        }))}
      />
    </div>
  );
}
