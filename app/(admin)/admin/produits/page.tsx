import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import AdminProductsFilters from "@/components/admin/products/AdminProductsFilters";
import ThemedProductFilters from "@/components/admin/products/ThemedProductFilters";
import AdminProductsTable from "@/components/admin/products/AdminProductsTable";
import { FilterPendingProvider } from "@/components/admin/products/FilterPendingContext";
import { AdminProductsFilterPersistence } from "@/components/admin/products/AdminProductsFilterPersistence";
import { AdminProductsScrollPersistence } from "@/components/admin/products/AdminProductsScrollPersistence";
import AdminPagination from "@/components/admin/products/AdminPagination";
import AdminProductsTabsWrapper from "@/components/admin/products/AdminProductsTabsWrapper";
import ProductTranslateAllButton from "@/components/admin/products/ProductTranslateAllButton";
import PfsStockDeductionButton from "@/components/admin/products/PfsStockDeductionButton";
import PfsAuditButton from "@/components/admin/products/PfsAuditButton";
import LowStockPdfButton from "@/components/admin/products/LowStockPdfButton";
import { countPendingPfsStockDeductions } from "@/lib/pfs-stock-deduction";
import { requireCurrentTenant } from "@/lib/tenant";
import ProductStatusTabs from "@/components/admin/products/ProductStatusTabs";
import { getCachedAdminWarnings, getCachedPfsEnabled, getCachedTags, getCachedCompositions, getCachedHasAnkorstoreConfig, getCachedAnkorstoreEnabled, getCachedHasEfashionConfig, getCachedEfashionEnabled, getCachedHasFaireConfig, getCachedFaireEnabled, getCachedHasOrderchampConfig, getCachedOrderchampEnabled, getCachedHasMicrostoreConfig, getCachedMicrostoreEnabled, getCachedSizes, getCachedProductSectionCounts, getCachedAllCategoriesWithSubs, getCachedAllCollectionsWithProductCount, getCachedAllTags, getCachedHsCodes, getCachedSeasons } from "@/lib/cached-data";
import { getPfsAnnexes } from "@/lib/pfs-annexes";
import { pickFirstImage } from "@/lib/pick-first-image";
import { countColorsMissingImage } from "@/lib/colors-missing-image";
import { computeMissingProductFields } from "@/lib/product-missing-fields";
import {
  buildAdminProductsWhere,
  buildAdminProductsOrderBy,
  findProductIdsWithMissingVariantImages,
  sortProductsByQueryOrder,
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
import { getFaireTaxonomy, findFaireTaxonomyById } from "@/lib/faire-taxonomy";

// Attribute managers
import CategoriesManager from "@/components/admin/categories/SubCategoryList";
import EntityCreateButton from "@/components/admin/EntityCreateButton";
import ColorsManager from "@/components/admin/couleurs/ColorsManager";
import CompositionsManager from "@/components/admin/compositions/CompositionsManager";
import { listManufacturingCountries } from "@/lib/countries";
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
  // Hero sobre Ardoise : pas de dégradé aurore, eyebrow simple en gris muet.
  // Le paramètre `accent` est conservé pour compat mais n'influe plus sur le rendu.
  void a;
  return (
    <div className="py-1">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-1 h-1 rounded-full bg-text-muted" aria-hidden />
            <p className="text-[10.5px] sm:text-[11px] font-body font-semibold uppercase tracking-[0.18em] text-text-muted">
              {eyebrow}
            </p>
          </div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-text-primary leading-tight tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="font-body text-sm sm:text-[14px] text-text-secondary mt-1 max-w-2xl leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-2 md:shrink-0 md:flex-wrap">{actions}</div>
        )}
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
    <Link href={href} className={`inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-body font-medium transition-all w-full md:w-auto ${cls}`}>
      {children}
    </Link>
  );
}

/**
 * Compte le nombre de filtres actifs depuis les searchParams pour afficher
 * un badge sur le bouton « Filtres détaillés » et choisir l'état initial du
 * panneau (auto-déplié si activeCount > 0).
 */
function countActiveFilters(p: Record<string, string | undefined>): number {
  const keys = [
    "q", "exactRef", "cat", "subCat", "tag", "composition", "hsCodeId",
    "minPrice", "maxPrice", "dateFrom", "dateTo", "updatedFrom", "updatedTo", "stockBelow",
    "bestSeller", "important", "createdRecent", "updatedRecent", "refresh", "sort", "locked", "syncRequired", "missingImages", "translationStatus", "pfsVerify",
    "pfsLink", "ankorsLink", "efashionLink", "faireLink", "orderchampLink", "microstoreLink",
    "pfsExportedAt", "ankorstoreExportedAt", "efashionExportedAt", "faireExportedAt", "orderchampExportedAt", "microstoreExportedAt",
  ];
  let n = 0;
  for (const k of keys) {
    const v = p[k];
    if (v && v !== "") n++;
  }
  return n;
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
    important?: string;
    createdRecent?: string;
    updatedRecent?: string;
    refresh?: string;
    sort?: string;
    status?: string;
    minPrice?: string;
    maxPrice?: string;
    dateFrom?: string;
    dateTo?: string;
    updatedFrom?: string;
    updatedTo?: string;
    stockBelow?: string;
    missingImages?: string;
    pfsLink?: string;
    ankorsLink?: string;
    efashionLink?: string;
    faireLink?: string;
    orderchampLink?: string;
    microstoreLink?: string;
    syncRequired?: string;
    hsCodeId?: string;
    locked?: string;
    pfsExportedAt?: string;
    efashionExportedAt?: string;
    microstoreExportedAt?: string;
    ankorstoreExportedAt?: string;
    faireExportedAt?: string;
    orderchampExportedAt?: string;
    translationStatus?: string;
    pfsVerify?: string;
  }>;
}

const VALID_TABS = ["produits", "categories", "couleurs", "compositions", "saisons", "codes-sh", "tailles", "mots-cles"] as const;
type TabKey = (typeof VALID_TABS)[number];

/** Render only the active tab's content server-side (avoids PFS calls + heavy queries for hidden tabs) */
function getActiveTabContent(activeTab: TabKey, params: Record<string, string | undefined>) {
  switch (activeTab) {
    case "produits":     return <ProduitsContent params={params} />;
    case "categories":   return <CategoriesContent />;
    case "couleurs":     return <CouleursContent />;
    case "compositions": return <CompositionsContent />;
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
    important = "",
    createdRecent = "",
    updatedRecent = "",
    refresh = "",
    sort = "",
    status: statusFilter = "",
    minPrice: minPriceParam = "",
    maxPrice: maxPriceParam = "",
    dateFrom = "",
    dateTo = "",
    updatedFrom = "",
    updatedTo = "",
    stockBelow: stockBelowParam = "",
    missingImages = "",
    pfsLink = "",
    ankorsLink = "",
    efashionLink = "",
    faireLink = "",
    orderchampLink = "",
    microstoreLink = "",
    syncRequired = "",
    hsCodeId = "",
    locked = "",
    pfsExportedAt = "",
    efashionExportedAt = "",
    microstoreExportedAt = "",
    ankorstoreExportedAt = "",
    faireExportedAt = "",
    orderchampExportedAt = "",
    translationStatus = "",
    pfsVerify = "",
  } = params;

  const exactRef   = exactRefParam === "1";
  const currentPage = Math.max(1, parseInt(pageParam));
  const perPage     = Math.min(500, Math.max(1, parseInt(perPageParam) || 20));
  const minPrice    = minPriceParam ? parseFloat(minPriceParam) : null;
  const maxPrice    = maxPriceParam ? parseFloat(maxPriceParam) : null;
  const stockBelow  = stockBelowParam ? parseInt(stockBelowParam) : null;

  // Filtre images :
  //   "1" → au moins une variante sans image (intersection sur les IDs trouvés)
  //   "0" → toutes les variantes ont au moins une image (exclusion de ces IDs)
  // Le scan raw SQL ne passe pas par l'extension prisma-tenant-scope — on passe
  // donc le tenantId explicitement pour éviter la fuite cross-tenant.
  const tenantForImages = await requireCurrentTenant();
  const missingImageIds = missingImages === "1" || missingImages === "0"
    ? await findProductIdsWithMissingVariantImages(prisma, tenantForImages.id)
    : null;
  const productIdsIn = missingImages === "1" ? missingImageIds : null;
  const productIdsNotIn = missingImages === "0" ? missingImageIds : null;

  const where = buildAdminProductsWhere({
    q,
    exactRef,
    cat,
    subCat,
    tag,
    composition,
    bestSeller,
    important,
    createdRecent,
    updatedRecent,
    refresh,
    status: statusFilter,
    minPrice,
    maxPrice,
    dateFrom,
    dateTo,
    updatedFrom,
    updatedTo,
    stockBelow,
    pfsLink,
    ankorsLink,
    efashionLink,
    faireLink,
    orderchampLink,
    microstoreLink,
    syncRequired,
    hsCodeId,
    locked,
    pfsExportedAt,
    efashionExportedAt,
    microstoreExportedAt,
    ankorstoreExportedAt,
    faireExportedAt,
    orderchampExportedAt,
    translationStatus,
    pfsVerify,
    productIdsIn,
    productIdsNotIn,
  });

  const [
    productsRaw,
    totalCount,
    categories,
    tags,
    compositions,
    hsCodeRows,
    seasons,
    collectionsList,
    allTagsForBulk,
    sectionCounts,
    hasPfsConfig,
    hasAnkorstoreConfig,
    ankorstoreEnabled,
    hasEfashionConfig,
    efashionEnabled,
    hasFaireConfig,
    faireEnabled,
    hasOrderchampConfig,
    orderchampEnabled,
    hasMicrostoreConfig,
    microstoreEnabled,
    pfsStockPendingCount,
    allSizes,
  ] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: buildAdminProductsOrderBy(refresh, sort, { createdRecent, updatedRecent }),
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
            disabled:            true,
            saleType:            true,
            packQuantity:        true,
            efashionProductId:   true,
            color:               { select: { name: true, hex: true, patternImage: true } },
            // On charge sizeId seulement — le nom est résolu ensuite via
            // getCachedSizes() pour éviter une jointure SQL sur la table Size
            // pour chaque variantSize (30 produits × ~4 couleurs × ~10 tailles).
            variantSizes:        { select: { quantity: true, sizeId: true } },
            // Alimente le check "Tailles manquantes" pour les PACK multi-couleurs
            // (voir computeMissingProductFields — packLines supplante variantSizes).
            // colorId est requis par ProductColorLite (pick-first-image).
            packLines:           { select: { colorId: true, sizes: { select: { sizeId: true } } } },
          },
        },
        compositions: { select: { percentage: true } },
        translations: { select: { locale: true } },
      },
    }),
    prisma.product.count({ where }),
    getCachedAllCategoriesWithSubs(),
    getCachedTags(),
    getCachedCompositions(),
    getCachedHsCodes(),
    getCachedSeasons(),
    getCachedAllCollectionsWithProductCount(),
    getCachedAllTags(),
    getCachedProductSectionCounts(),
    getCachedPfsEnabled(),
    getCachedHasAnkorstoreConfig(),
    getCachedAnkorstoreEnabled(),
    getCachedHasEfashionConfig(),
    getCachedEfashionEnabled(),
    getCachedHasFaireConfig(),
    getCachedFaireEnabled(),
    getCachedHasOrderchampConfig(),
    getCachedOrderchampEnabled(),
    getCachedHasMicrostoreConfig(),
    getCachedMicrostoreEnabled(),
    countPendingPfsStockDeductions(tenantForImages.id),
    // Tailles en cache (60s TTL) — utilisées pour résoudre les noms des
    // variantSizes sans passer par une jointure SQL sur la table Size.
    getCachedSizes(),
  ]);

  const sizeNameById = new Map<string, string>(allSizes.map((s) => [s.id, s.name]));

  // Tri « Personnalisé » : quand la cliente a saisi ≥ 2 références et choisi
  // ce tri, on réordonne la page courante en mémoire pour suivre l'ordre de
  // saisie. Pour un ordre garanti sur toutes les références saisies, elle doit
  // monter le nombre par page (sinon seules celles de la page sont triées).
  const products = sort === "custom"
    ? sortProductsByQueryOrder(productsRaw, q, exactRef)
    : productsRaw;

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
    const rawFirstImage = pickFirstImage({ primaryColorId: p.primaryColorId, colors: p.colors }, colorImagePath);
    const colorsMissingImageCount = countColorsMissingImage({
      status: p.status as "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING",
      productId: p.id,
      colors: p.colors,
      imagesByProductColor,
    });
    const missingFields = computeMissingProductFields({
      status: p.status as "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING",
      reference: p.reference,
      description: p.description,
      categoryId: p.categoryId,
      countryIsoCode: p.countryIsoCode,
      seasonId: p.seasonId,
      compositions: p.compositions,
      colors: p.colors.map((c) => ({
        disabled:     c.disabled,
        unitPrice:    Number(c.unitPrice),
        weight:       c.weight,
        stock:        c.stock,
        variantSizes: c.variantSizes,
        packLines:    c.packLines,
      })),
    });
    return {
    id:              p.id,
    reference:       p.reference,
    name:            p.name,
    status:          p.status as "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING",
    isIncomplete:    p.isIncomplete,
    colorsMissingImageCount,
    missingFields,
    locked:          p.locked,
    important:       p.important,
    categoryName:    p.category.name,
    subCategoryName: p.subCategories[0]?.name ?? null,
    createdAt:       p.createdAt.toISOString(),
    updatedAt:       p.updatedAt.toISOString(),
    lastRefreshedAt: p.lastRefreshedAt ? p.lastRefreshedAt.toISOString() : null,
    firstImage:      rawFirstImage,
    pfsProductId:          p.pfsProductId,
    ankorsProductId:       p.ankorsProductId,
    efashionReferenceBase: p.efashionReferenceBase,
    faireProductId:        p.faireProductId,
    orderchampProductId:   p.orderchampProductId,
    pfsSyncRequired:        p.pfsSyncRequired,
    ankorsSyncRequired:     p.ankorsSyncRequired,
    efashionSyncRequired:   p.efashionSyncRequired,
    faireSyncRequired:      p.faireSyncRequired,
    orderchampSyncRequired: p.orderchampSyncRequired,
    microstoreSyncRequired: p.microstoreSyncRequired,
    microstoreLastPushedAt: p.microstoreLastPushedAt ? p.microstoreLastPushedAt.toISOString() : null,
    pfsEnabled:             p.pfsEnabled,
    ankorsEnabled:          p.ankorsEnabled,
    efashionEnabled:        p.efashionEnabled,
    faireEnabled:           p.faireEnabled,
    orderchampEnabled:      p.orderchampEnabled,
    microstoreEnabled:      p.microstoreEnabled,
    // Résultat de la dernière vérification PFS — alimente la pastille dans la
    // cellule Produit (lib/pfs-verify.ts + app/actions/admin/pfs-verify.ts).
    pfsCheckedAt:   p.pfsCheckedAt   ? p.pfsCheckedAt.toISOString() : null,
    pfsCheckStatus: (p.pfsCheckStatus as "ok" | "diff" | null) ?? null,
    pfsCheckIssues: (p.pfsCheckIssues as unknown) ?? null,
    primaryColorId: p.primaryColorId ?? null,
    pfsLastExportedAt:        p.pfsLastExportedAt        ? p.pfsLastExportedAt.toISOString()        : null,
    efashionLastExportedAt:   p.efashionLastExportedAt   ? p.efashionLastExportedAt.toISOString()   : null,
    microstoreLastExportedAt: p.microstoreLastExportedAt ? p.microstoreLastExportedAt.toISOString() : null,
    ankorstoreLastExportedAt: p.ankorstoreLastExportedAt ? p.ankorstoreLastExportedAt.toISOString() : null,
    faireLastExportedAt:      p.faireLastExportedAt      ? p.faireLastExportedAt.toISOString()      : null,
    orderchampLastExportedAt: p.orderchampLastExportedAt ? p.orderchampLastExportedAt.toISOString() : null,
    discountPercent: p.discountPercent != null ? Number(p.discountPercent) : null,
    colors:          p.colors.map((c) => ({
      id:                c.id,
      colorId:           c.colorId ?? "",
      unitPrice:         Number(c.unitPrice),
      weight:            c.weight,
      stock:             c.stock,
      isPrimary:         c.isPrimary,
      disabled:          c.disabled,
      saleType:          c.saleType as "UNIT" | "PACK",
      packQuantity:      c.packQuantity,
      efashionProductId: c.efashionProductId ?? null,
      // Reconstitue la forme attendue par le client { quantity, size: { name } }
      // à partir du sizeId + du cache getCachedSizes (évite la jointure SQL).
      variantSizes:      c.variantSizes.map((vs) => ({
        quantity: vs.quantity,
        size: { name: sizeNameById.get(vs.sizeId) ?? "—" },
      })),
      color:             c.color ?? { name: "—", hex: null, patternImage: null },
    })),
    translations:    p.translations,
    };
  });

  return (
    <FilterPendingProvider>
    <AdminProductsFilterPersistence />
    <AdminProductsScrollPersistence />
    <div className="space-y-5">
      {/* ─── Carte commune Hero + Onglets + Filtres (look maquette Ardoise) ─── */}
      <div className="bg-bg-primary border border-border rounded-2xl shadow-sm">
        <div className="px-3 sm:px-5 md:px-6 pt-4 sm:pt-5 md:pt-6 pb-3 sm:pb-4">
          <PageHero
            eyebrow="Catalogue"
            title="Produits"
            subtitle={`${totalCount.toLocaleString("fr-FR")} articles${sectionCounts.online > 0 ? ` · ${sectionCounts.online.toLocaleString("fr-FR")} en ligne` : ""}`}
            accent="emerald"
            actions={
              <>
                <PfsStockDeductionButton
                  initialPendingCount={pfsStockPendingCount}
                  hasPfsConfig={hasPfsConfig}
                  hasAnkorstoreConfig={hasAnkorstoreConfig}
                  hasEfashionConfig={hasEfashionConfig}
                  hasFaireConfig={hasFaireConfig}
                  hasOrderchampConfig={hasOrderchampConfig}
                />
                <LowStockPdfButton />
                <PfsAuditButton hasPfsConfig={hasPfsConfig} />
                <PrimaryActionLink href="/admin/produits/importer" variant="secondary">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span>Importer</span>
                </PrimaryActionLink>
                <PrimaryActionLink href="/admin/produits/nouveau" variant="primary">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  <span className="hidden sm:inline">Nouveau produit</span>
                  <span className="sm:hidden">Nouveau</span>
                </PrimaryActionLink>
              </>
            }
          />
        </div>
        <div className="px-3 sm:px-5 md:px-6 pb-3 sm:pb-4">
          <Suspense>
            <ProductStatusTabs counts={sectionCounts} />
          </Suspense>
        </div>
        <div className="px-3 sm:px-5 md:px-6 pb-4 sm:pb-5 border-t border-border-light pt-3 sm:pt-4">
          <Suspense>
            <ThemedProductFilters
              totalCount={totalCount}
              activeCount={countActiveFilters(params)}
              categories={categories}
              tags={tags}
              compositions={compositions}
              hsCodes={hsCodes}
              hasPfsConfig={hasPfsConfig}
              hasAnkorstoreConfig={hasAnkorstoreConfig}
              hasEfashionConfig={hasEfashionConfig}
              hasFaireConfig={hasFaireConfig}
              hasOrderchampConfig={hasOrderchampConfig}
              hasMicrostoreConfig={hasMicrostoreConfig}
            />
          </Suspense>
        </div>
      </div>

      {/* « Tout traduire » a été retiré d'ici et sera intégré dans la barre
          d'actions groupées qui s'affiche au-dessous du tableau quand des
          produits sont sélectionnés (cf. BulkVariantBar / sélection produits). */}

      {/* Tableau */}
      <AdminProductsTable
        products={serializedProducts}
        totalCount={totalCount}
        startIndex={(currentPage - 1) * perPage}
        hasPfsConfig={hasPfsConfig}
        pfsGloballyEnabled={hasPfsConfig}
        hasAnkorstoreConfig={hasAnkorstoreConfig}
        ankorstoreEnabled={ankorstoreEnabled}
        hasEfashionConfig={hasEfashionConfig}
        efashionEnabled={efashionEnabled}
        hasFaireConfig={hasFaireConfig}
        faireEnabled={faireEnabled}
        hasOrderchampConfig={hasOrderchampConfig}
        orderchampEnabled={orderchampEnabled}
        hasMicrostoreConfig={hasMicrostoreConfig}
        microstoreEnabled={microstoreEnabled}
        bulkEditOptions={{
          categories: categories.map((c) => ({
            id: c.id,
            name: c.name,
            subCategories: c.subCategories.map((s) => ({ id: s.id, name: s.name })),
          })),
          hsCodes: hsCodes.map((h) => ({ id: h.id, code: h.code, label: h.label })),
          compositions: compositions.map((c) => ({ id: c.id, name: c.name })),
          manufacturingCountries: listManufacturingCountries().map((c) => ({ id: c.code, name: c.name })),
          seasons: seasons.map((s) => ({ id: s.id, name: s.name })),
        }}
        availableTags={allTagsForBulk.map((t) => ({ id: t.id, name: t.name }))}
        availableCollections={collectionsList.map((c) => ({
          id: c.id,
          name: c.name,
          productCount: c._count.products,
        }))}
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
    </FilterPendingProvider>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Catégories
   ═══════════════════════════════════════════════════════════════════════════ */
async function CategoriesContent() {
  const [categories, efashionLabels, faireTaxonomy] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
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
    getFaireTaxonomy(),
  ]);

  function resolveFaireLabel(taxonomyId: string | null): string | null {
    if (!taxonomyId) return null;
    const hit = findFaireTaxonomyById(faireTaxonomy, taxonomyId);
    return hit?.name ?? null;
  }

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
          faireTaxonomyId: c.faireTaxonomyId,
          faireTaxonomyLabel: resolveFaireLabel(c.faireTaxonomyId),
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
      orderBy: [{ position: "asc" }, { name: "asc" }],
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
      orderBy: [{ position: "asc" }, { name: "asc" }],
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
   TAB: Saisons
   ═══════════════════════════════════════════════════════════════════════════ */
async function SaisonsContent() {
  const [seasons, efashionLabels] = await Promise.all([
    prisma.season.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
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
    orderBy: [{ position: "asc" }, { code: "asc" }],
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
