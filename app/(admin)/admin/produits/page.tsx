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
import { getCachedAdminWarnings, getCachedPfsEnabled, getCachedSiteConfig, getCachedTags, getCachedCompositions, getCachedHasAnkorstoreConfig, getCachedAnkorstoreEnabled, getCachedHasEfashionConfig, getCachedEfashionEnabled, getCachedHasFaireConfig, getCachedFaireEnabled } from "@/lib/cached-data";
import { getPfsAnnexes } from "@/lib/pfs-annexes";
import { pickFirstImage } from "@/lib/pick-first-image";
import {
  buildAdminProductsWhere,
  buildAdminProductsOrderBy,
  findProductIdsWithMissingVariantImages,
} from "@/lib/admin-products-filter";
import { withProtectedSizeItem, type SizeManagerItem } from "@/lib/protected-sizes";
import {
  getEfashionLabelMaps,
  resolveCategoryLabel,
  resolveColorLabel,
  resolveCompositionLabel,
  resolveProvenanceLabel,
  resolveCollectionLabel,
} from "@/lib/efashion-labels";

// Attribute managers
import CategoriesManager from "@/components/admin/categories/SubCategoryList";
import EntityCreateButton from "@/components/admin/EntityCreateButton";
import ColorsManager from "@/components/admin/couleurs/ColorsManager";
import CompositionsManager from "@/components/admin/compositions/CompositionsManager";
import ManufacturingCountriesManager from "@/components/admin/manufacturing-countries/ManufacturingCountriesManager";
import SeasonsManager from "@/components/admin/seasons/SeasonsManager";
import HsCodesManager from "@/components/admin/codes-sh/HsCodesManager";
import SizesManager from "@/components/admin/tailles/SizesManager";
import TagsManager from "@/app/(admin)/admin/mots-cles/TagsManager";

export const metadata: Metadata = {
  title: "Produits",
};

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS UI partagés entre les tabs (style cockpit cohérent avec dashboard)
   ═══════════════════════════════════════════════════════════════════════════ */

type HeroAccent = "emerald" | "sky" | "violet" | "amber" | "rose" | "slate";

const HERO_ACCENTS: Record<HeroAccent, { aurora: string; chipBg: string; chipText: string; chipDot: string }> = {
  emerald: {
    aurora: "from-emerald-50 via-bg-primary to-bg-primary",
    chipBg: "bg-emerald-100/80 backdrop-blur-sm border-emerald-200",
    chipText: "text-emerald-800",
    chipDot: "bg-emerald-500",
  },
  sky: {
    aurora: "from-sky-50 via-bg-primary to-bg-primary",
    chipBg: "bg-sky-100/80 backdrop-blur-sm border-sky-200",
    chipText: "text-sky-800",
    chipDot: "bg-sky-500",
  },
  violet: {
    aurora: "from-violet-50 via-bg-primary to-bg-primary",
    chipBg: "bg-violet-100/80 backdrop-blur-sm border-violet-200",
    chipText: "text-violet-800",
    chipDot: "bg-violet-500",
  },
  amber: {
    aurora: "from-amber-50 via-bg-primary to-bg-primary",
    chipBg: "bg-amber-100/80 backdrop-blur-sm border-amber-200",
    chipText: "text-amber-800",
    chipDot: "bg-amber-500",
  },
  rose: {
    aurora: "from-rose-50 via-bg-primary to-bg-primary",
    chipBg: "bg-rose-100/80 backdrop-blur-sm border-rose-200",
    chipText: "text-rose-800",
    chipDot: "bg-rose-500",
  },
  slate: {
    aurora: "from-bg-secondary via-bg-primary to-bg-primary",
    chipBg: "bg-bg-secondary border-border",
    chipText: "text-text-secondary",
    chipDot: "bg-text-secondary",
  },
};

function PageHero({
  eyebrow, title, subtitle, accent = "emerald", actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  accent?: HeroAccent;
  actions?: React.ReactNode;
}) {
  const a = HERO_ACCENTS[accent];
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
      <div className={`absolute inset-0 bg-gradient-to-br ${a.aurora}`} />
      <div className="absolute inset-0 opacity-[0.035] pointer-events-none" style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, #1A1A1A 1px, transparent 0)",
        backgroundSize: "16px 16px",
      }} />
      <div className="relative p-5 sm:p-6 md:p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] sm:text-[11px] font-body font-semibold uppercase tracking-[0.18em] ${a.chipBg} ${a.chipText}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${a.chipDot}`} />
              {eyebrow}
            </span>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-text-primary leading-tight tracking-tight mt-3">
              {title}
            </h1>
            {subtitle && (
              <p className="font-body text-sm sm:text-[15px] text-text-secondary mt-1.5 max-w-2xl leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label, value, accent, sub, dot,
}: {
  label: string;
  value: number | string;
  accent: "neutral" | "emerald" | "sky" | "amber" | "rose" | "violet";
  sub?: string;
  dot?: boolean;
}) {
  const styles = {
    neutral: { cardBg: "bg-bg-primary", border: "border-border", valueText: "text-text-primary", dotBg: "bg-text-secondary", halo: "" },
    emerald: { cardBg: "bg-gradient-to-br from-emerald-50 via-bg-primary to-bg-primary", border: "border-emerald-200", valueText: "text-emerald-700", dotBg: "bg-emerald-500", halo: "bg-emerald-300/30" },
    sky:     { cardBg: "bg-gradient-to-br from-sky-50 via-bg-primary to-bg-primary",     border: "border-sky-200",     valueText: "text-sky-700",     dotBg: "bg-sky-500",     halo: "bg-sky-300/30" },
    amber:   { cardBg: "bg-gradient-to-br from-amber-50 via-bg-primary to-bg-primary",   border: "border-amber-200",   valueText: "text-amber-700",   dotBg: "bg-amber-500",   halo: "bg-amber-300/30" },
    rose:    { cardBg: "bg-gradient-to-br from-rose-50 via-bg-primary to-bg-primary",    border: "border-rose-200",    valueText: "text-rose-700",    dotBg: "bg-rose-500",    halo: "bg-rose-300/30" },
    violet:  { cardBg: "bg-gradient-to-br from-violet-50 via-bg-primary to-bg-primary",  border: "border-violet-200",  valueText: "text-violet-700",  dotBg: "bg-violet-500",  halo: "bg-violet-300/30" },
  }[accent];
  return (
    <div className={`relative overflow-hidden ${styles.cardBg} border ${styles.border} rounded-2xl px-4 py-3.5 sm:px-5 sm:py-4 shadow-sm`}>
      {styles.halo && <div className={`absolute -top-10 -right-10 w-24 h-24 rounded-full blur-3xl ${styles.halo} pointer-events-none`} />}
      <div className="relative flex items-center gap-1.5 mb-1">
        {dot && <span className={`w-2 h-2 rounded-full ${styles.dotBg}`} />}
        <p className="text-[10px] sm:text-[11px] font-body uppercase tracking-wider text-text-muted font-semibold">{label}</p>
      </div>
      <p className={`relative font-heading text-xl sm:text-2xl font-bold tabular-nums leading-none ${styles.valueText}`}>{value}</p>
      {sub && <p className="relative text-[11px] font-body text-text-muted mt-1">{sub}</p>}
    </div>
  );
}

function PrimaryActionLink({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const cls = variant === "primary"
    ? "bg-bg-dark text-text-inverse hover:bg-primary-hover shadow-sm"
    : "bg-white/80 backdrop-blur-sm text-text-primary border border-border hover:bg-white";
  return (
    <Link href={href} className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-body font-medium transition-all ${cls}`}>
      {children}
    </Link>
  );
}

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    q?: string;
    exactRef?: string;
    page?: string;
    perPage?: string;
    cat?: string;
    subCat?: string;
    tag?: string;
    composition?: string;
    bestSeller?: string;
    refresh?: string;
    status?: string;
    minPrice?: string;
    maxPrice?: string;
    dateFrom?: string;
    dateTo?: string;
    stockBelow?: string;
    missingImages?: string;
    pfsLink?: string;
    ankorsLink?: string;
    syncRequired?: string;
    hsCodeId?: string;
  }>;
}

const VALID_TABS = ["produits", "categories", "couleurs", "compositions", "pays", "saisons", "codes-sh", "tailles", "mots-cles"] as const;
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
    case "codes-sh":     return <CodesShContent />;
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
    subCat = "",
    tag = "",
    composition = "",
    bestSeller = "",
    refresh = "",
    status: statusFilter = "",
    minPrice: minPriceParam = "",
    maxPrice: maxPriceParam = "",
    dateFrom = "",
    dateTo = "",
    stockBelow: stockBelowParam = "",
    missingImages = "",
    pfsLink = "",
    ankorsLink = "",
    efashionLink = "",
    syncRequired = "",
    hsCodeId = "",
  } = params;

  const exactRef   = exactRefParam === "1";
  const currentPage = Math.max(1, parseInt(pageParam));
  const perPage     = Math.min(500, Math.max(1, parseInt(perPageParam) || 20));
  const minPrice    = minPriceParam ? parseFloat(minPriceParam) : null;
  const maxPrice    = maxPriceParam ? parseFloat(maxPriceParam) : null;
  const stockBelow  = stockBelowParam ? parseInt(stockBelowParam) : null;

  // Filtre « au moins une variante sans image » : précalculer les productId
  // côté SQL puis les passer au where builder en restriction d'IDs.
  const productIdsIn = missingImages === "1"
    ? await findProductIdsWithMissingVariantImages(prisma)
    : null;

  const where = buildAdminProductsWhere({
    q,
    exactRef,
    cat,
    subCat,
    tag,
    composition,
    bestSeller,
    refresh,
    status: statusFilter,
    minPrice,
    maxPrice,
    dateFrom,
    dateTo,
    stockBelow,
    pfsLink,
    ankorsLink,
    efashionLink,
    syncRequired,
    hsCodeId,
    productIdsIn,
  });

  const [
    products,
    totalCount,
    categories,
    tags,
    compositions,
    hsCodeRows,
    manufacturingCountries,
    seasons,
    sectionCounts,
    hasPfsConfig,
    hasAnkorstoreConfig,
    ankorstoreEnabled,
    hasEfashionConfig,
    efashionEnabled,
    hasFaireConfig,
    faireEnabled,
  ] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: buildAdminProductsOrderBy(refresh),
      skip:    (currentPage - 1) * perPage,
      take:    perPage,
      include: {
        category:      { select: { name: true } },
        subCategories: { select: { name: true }, take: 1 },
        colors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: {
            id:                  true,
            colorId:             true,
            unitPrice:           true,
            weight:              true,
            stock:               true,
            isPrimary:           true,
            saleType:            true,
            packQuantity:        true,
            efashionProductId:   true,
            color:               { select: { name: true, hex: true, patternImage: true } },
            variantSizes:        { select: { quantity: true, size: { select: { name: true } } } },
          },
        },
        translations: { select: { locale: true } },
      },
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        subCategories: { orderBy: { name: "asc" }, select: { id: true, name: true } },
      },
    }),
    getCachedTags(),
    getCachedCompositions(),
    // Bibliothèque des codes SH (pour le filtre dédié)
    prisma.hsCode.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, label: true },
    }),
    // Bibliothèque pays + saisons (pour la modale d'édition en masse)
    prisma.manufacturingCountry.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.season.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Section counts for tabs (lightweight parallel queries)
    Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: { status: "ONLINE" } }),
      prisma.product.count({ where: { status: "OFFLINE", isIncomplete: false } }),
      prisma.product.count({ where: { status: "OFFLINE", isIncomplete: true } }),
      prisma.product.count({ where: { status: "ARCHIVED" } }),
    ]).then(([all, online, offline, draft, archived]) => ({ all, online, offline, draft, archived })),
    getCachedPfsEnabled(),
    getCachedHasAnkorstoreConfig(),
    getCachedAnkorstoreEnabled(),
    getCachedHasEfashionConfig(),
    getCachedEfashionEnabled(),
    getCachedHasFaireConfig(),
    getCachedFaireEnabled(),
  ]);

  const totalPages = Math.ceil(totalCount / perPage);

  const hsCodes = hsCodeRows;

  // Images chargées en une seule requête, indexées par (productId, colorId).
  // L'image étant rattachée au couple Produit × Couleur (et pas à une variante
  // spécifique), toutes les variantes qui partagent la même couleur la verront.
  const productIds = products.map((p) => p.id);
  const allImages = productIds.length > 0
    ? await prisma.productColorImage.findMany({
        where:   { productId: { in: productIds } },
        orderBy: { order: "asc" },
        select:  { productId: true, colorId: true, path: true },
      })
    : [];
  const imagesByProductColor = new Map<string, string>();
  for (const img of allImages) {
    const key = `${img.productId}::${img.colorId}`;
    if (!imagesByProductColor.has(key)) imagesByProductColor.set(key, img.path);
  }

  const serializedProducts = products.map((p) => {
    const colorImagePath = (colorId: string | null) =>
      colorId ? imagesByProductColor.get(`${p.id}::${colorId}`) ?? null : null;
    return {
    id:              p.id,
    reference:       p.reference,
    name:            p.name,
    status:          p.status as "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING",
    isIncomplete:    p.isIncomplete,
    categoryName:    p.category.name,
    subCategoryName: p.subCategories[0]?.name ?? null,
    createdAt:       p.createdAt.toISOString(),
    updatedAt:       p.updatedAt.toISOString(),
    lastRefreshedAt: p.lastRefreshedAt ? p.lastRefreshedAt.toISOString() : null,
    firstImage:      pickFirstImage({ primaryColorId: p.primaryColorId, colors: p.colors }, colorImagePath),
    pfsProductId:    p.pfsProductId,
    ankorsProductId: p.ankorsProductId,
    faireProductId:  p.faireProductId,
    pfsSyncRequired:      p.pfsSyncRequired,
    ankorsSyncRequired:   p.ankorsSyncRequired,
    efashionSyncRequired: p.efashionSyncRequired,
    faireSyncRequired:    p.faireSyncRequired,
    colors:          p.colors.map((c) => ({
      id:                c.id,
      colorId:           c.colorId ?? "",
      unitPrice:         Number(c.unitPrice),
      weight:            c.weight,
      stock:             c.stock,
      isPrimary:         c.isPrimary,
      saleType:          c.saleType as "UNIT" | "PACK",
      packQuantity:      c.packQuantity,
      efashionProductId: c.efashionProductId ?? null,
      variantSizes:      c.variantSizes,
      color:             c.color ?? { name: "—", hex: null, patternImage: null },
    })),
    translations:    p.translations,
    };
  });

  return (
    <div className="space-y-5">
      {/* ─── Hero ────────────────────────────────────────────────── */}
      <PageHero
        eyebrow="Catalogue · Produits"
        title="Produits"
        subtitle={`${totalCount.toLocaleString("fr-FR")} produit${totalCount > 1 ? "s" : ""} au catalogue — gérez photos, prix, sync marketplaces.`}
        accent="emerald"
        actions={
          <>
            <PrimaryActionLink href="/admin/produits/importer" variant="secondary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Importer
            </PrimaryActionLink>
            <PrimaryActionLink href="/admin/produits/nouveau" variant="primary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Nouveau produit
            </PrimaryActionLink>
          </>
        }
      />

      {/* ─── Stats bento ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Total catalogue" value={sectionCounts.all.toLocaleString("fr-FR")} accent="neutral" sub="produits enregistrés" />
        <StatTile label="En ligne" value={sectionCounts.online.toLocaleString("fr-FR")} accent="emerald" dot sub="visibles côté boutique" />
        <StatTile label="Hors ligne" value={sectionCounts.offline.toLocaleString("fr-FR")} accent="sky" dot sub="prêts à publier" />
        <StatTile label="Brouillons" value={sectionCounts.draft.toLocaleString("fr-FR")} accent="violet" dot sub="à compléter" />
      </div>

      {/* ─── Onglets de section ───────────────────────────────────── */}
      <div>
        <Suspense>
          <ProductStatusTabs counts={sectionCounts} />
        </Suspense>
      </div>

      {/* ─── Filtres ──────────────────────────────────────────────── */}
      <div className="bg-bg-primary border border-border rounded-2xl px-5 sm:px-6 py-5 shadow-sm">
        <Suspense>
          <AdminProductsFilters
            totalCount={totalCount}
            categories={categories}
            tags={tags}
            compositions={compositions}
            hsCodes={hsCodes}
            hasPfsConfig={hasPfsConfig}
            hasAnkorstoreConfig={hasAnkorstoreConfig}
            hasEfashionConfig={hasEfashionConfig}
          />
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
      <AdminProductsTable
        products={serializedProducts}
        totalCount={totalCount}
        startIndex={(currentPage - 1) * perPage}
        hasPfsConfig={hasPfsConfig}
        hasAnkorstoreConfig={hasAnkorstoreConfig}
        ankorstoreEnabled={ankorstoreEnabled}
        hasEfashionConfig={hasEfashionConfig}
        efashionEnabled={efashionEnabled}
        hasFaireConfig={hasFaireConfig}
        faireEnabled={faireEnabled}
        bulkEditOptions={{
          categories: categories.map((c) => ({
            id: c.id,
            name: c.name,
            subCategories: c.subCategories.map((s) => ({ id: s.id, name: s.name })),
          })),
          hsCodes: hsCodes.map((h) => ({ id: h.id, code: h.code, label: h.label })),
          compositions: compositions.map((c) => ({ id: c.id, name: c.name })),
          manufacturingCountries: manufacturingCountries.map((c) => ({ id: c.id, name: c.name })),
          seasons: seasons.map((s) => ({ id: s.id, name: s.name })),
        }}
      />

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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Catégories
   ═══════════════════════════════════════════════════════════════════════════ */
async function CategoriesContent() {
  const [categories, efashionLabels] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        subCategories: {
          orderBy: { name: "asc" },
          include: { translations: true },
        },
        translations: true,
        _count: { select: { products: true } },
      },
    }),
    getEfashionLabelMaps(),
  ]);

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="Bibliothèques · Catalogue"
        title="Catégories & sous-catégories"
        subtitle="Organisez votre catalogue par grandes familles et sous-familles."
        accent="emerald"
        actions={<EntityCreateButton type="category" label="+ Créer une catégorie" />}
      />

      <CategoriesManager
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          pfsGender: c.pfsGender,
          pfsFamilyName: c.pfsFamilyName,
          pfsCategoryName: c.pfsCategoryName,
          efashionCategorieId: c.efashionCategorieId,
          efashionCategorieLabel: resolveCategoryLabel(efashionLabels, c.efashionCategorieId),
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
  const [colors, pfsEnabled, ankorstoreEnabled, efashionLabels] = await Promise.all([
    prisma.color.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { productColors: true } },
        translations: true,
      },
    }),
    getCachedPfsEnabled(),
    getCachedAnkorstoreEnabled(),
    getEfashionLabelMaps(),
  ]);

  const colorItems = colors.map((c) => ({
    id: c.id,
    name: c.name,
    hex: c.hex,
    patternImage: c.patternImage,
    pfsColorRef: c.pfsColorRef ?? null,
    efashionColorId: c.efashionColorId,
    efashionColorLabel: resolveColorLabel(efashionLabels, c.efashionColorId),
    productCount: c._count.productColors,
    translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="Bibliothèques · Visuel"
        title="Bibliothèque de couleurs"
        subtitle={`${colors.length} couleur${colors.length > 1 ? "s" : ""} créée${colors.length > 1 ? "s" : ""}. Réutilisables sur tous vos produits.`}
        accent="rose"
        actions={<EntityCreateButton type="color" label="+ Créer une couleur" />}
      />

      <ColorsManager
        initialColors={colorItems}
        pfsEnabled={pfsEnabled}
        ankorstoreEnabled={ankorstoreEnabled}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Compositions
   ═══════════════════════════════════════════════════════════════════════════ */
async function CompositionsContent() {
  const [compositions, efashionLabels] = await Promise.all([
    prisma.composition.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: true } },
        translations: true,
      },
    }),
    getEfashionLabelMaps(),
  ]);

  const compositionItems = compositions.map((c) => ({
    id: c.id,
    name: c.name,
    pfsCompositionRef: c.pfsCompositionRef,
    efashionId: c.efashionId,
    efashionLabel: resolveCompositionLabel(efashionLabels, c.efashionId),
    productCount: c._count.products,
    translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="Bibliothèques · Matériaux"
        title="Compositions"
        subtitle="Créez les matériaux — ils seront assignables aux produits avec un pourcentage."
        accent="amber"
        actions={<EntityCreateButton type="composition" label="+ Créer une composition" />}
      />

      <CompositionsManager initialCompositions={compositionItems} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Pays de fabrication
   ═══════════════════════════════════════════════════════════════════════════ */
async function PaysContent() {
  const [countries, efashionLabels] = await Promise.all([
    prisma.manufacturingCountry.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: true } },
        translations: true,
      },
    }),
    getEfashionLabelMaps(),
  ]);

  const countryItems = countries.map((c) => ({
    id: c.id,
    name: c.name,
    isoCode: c.isoCode,
    pfsCountryRef: c.pfsCountryRef,
    efashionProvenanceId: c.efashionProvenanceId,
    efashionProvenanceLabel: resolveProvenanceLabel(efashionLabels, c.efashionProvenanceId),
    productCount: c._count.products,
    translations: Object.fromEntries(c.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="Bibliothèques · Provenance"
        title="Pays de fabrication"
        subtitle="Origine déclarée des produits — utilisée pour les étiquettes douane et marketplaces."
        accent="sky"
        actions={<EntityCreateButton type="country" label="+ Créer un pays" />}
      />

      <ManufacturingCountriesManager initialCountries={countryItems} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Saisons
   ═══════════════════════════════════════════════════════════════════════════ */
async function SaisonsContent() {
  const [seasons, efashionLabels] = await Promise.all([
    prisma.season.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: true } },
        translations: true,
      },
    }),
    getEfashionLabelMaps(),
  ]);

  const seasonItems = seasons.map((s) => ({
    id: s.id,
    name: s.name,
    pfsRef: s.pfsRef,
    efashionCollectionId: s.efashionCollectionId,
    efashionCollectionLabel: resolveCollectionLabel(efashionLabels, s.efashionCollectionId),
    productCount: s._count.products,
    translations: Object.fromEntries(s.translations.map((t) => [t.locale, t.name])),
  }));

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="Bibliothèques · Collections"
        title="Saisons"
        subtitle="Regroupez vos produits par collection (ex: Printemps / Été 2026)."
        accent="violet"
        actions={<EntityCreateButton type="season" label="+ Créer une saison" />}
      />

      <SeasonsManager initialSeasons={seasonItems} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Codes SH
   ═══════════════════════════════════════════════════════════════════════════ */
async function CodesShContent() {
  const rows = await prisma.hsCode.findMany({
    orderBy: { code: "asc" },
    include: { _count: { select: { products: true } } },
  });

  const items = rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    productCount: r._count.products,
  }));

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="Bibliothèques · Douanes"
        title="Codes SH"
        subtitle="Codes douaniers (Système Harmonisé) attribués aux produits — obligatoires à l'export."
        accent="slate"
      />

      <HsCodesManager initialItems={items} />
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

  const sizeItems: SizeManagerItem[] = withProtectedSizeItem(
    sizes.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      variantCount: s._count.variantSizes,
      pfsSizeRef: s.pfsSizeRef,
    })),
  );

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="Bibliothèques · Tailles"
        title="Gestion des tailles"
        subtitle="Créez une taille une fois — elle devient disponible pour tous vos produits."
        accent="amber"
      />

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
    <div className="space-y-5">
      <PageHero
        eyebrow="Bibliothèques · Tags"
        title="Mots clés"
        subtitle="Étiquettes réutilisables pour regrouper des produits par thème, occasion ou propriété."
        accent="violet"
      />

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
