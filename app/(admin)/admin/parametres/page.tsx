import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getCachedShopName, getCachedHasAnkorstoreConfig, getCachedAnkorstoreEnabled, getCachedSiteConfig, getCachedPfsBrand, getCachedHasEfashionConfig, getCachedEfashionEnabled, getCachedHasFaireConfig, getCachedFaireEnabled } from "@/lib/cached-data";
import { parseDisplayConfig } from "@/lib/product-display";
import SettingsPageTabs from "@/components/admin/settings/SettingsPageTabs";
import SettingsMinOrderForm from "@/components/admin/settings/SettingsMinOrderForm";
import AdminPasswordResetButton from "@/components/admin/settings/AdminPasswordResetButton";
import MaintenanceModeToggle from "@/components/admin/settings/MaintenanceModeToggle";
import CatalogDisplayConfig from "@/components/admin/settings/CatalogDisplayConfig";
import RefreshWarningConfig from "@/components/admin/settings/RefreshWarningConfig";
import HomepageCarouselsConfig from "@/components/admin/settings/HomepageCarouselsConfig";
import StockDisplayConfig from "@/components/admin/settings/StockDisplayConfig";
import CompanyInfoForm from "@/components/admin/settings/CompanyInfoForm";
import BannerImageConfig from "@/components/admin/settings/BannerImageConfig";
import FaviconConfig from "@/components/admin/settings/FaviconConfig";
import EasyExpressApiKeyConfig from "@/components/admin/settings/EasyExpressApiKeyConfig";
import ShippingMarginConfig from "@/components/admin/settings/ShippingMarginConfig";
import MarketplaceConfig from "@/components/admin/settings/MarketplaceConfig";
import AutoTranslateConfig from "@/components/admin/settings/AutoTranslateConfig";
import TranslationProviderStatus from "@/components/admin/settings/TranslationProviderStatus";
import BusinessHoursConfig from "@/components/admin/settings/BusinessHoursConfig";
import AnnouncementBannerConfig from "@/components/admin/settings/AnnouncementBannerConfig";
import SeoTextsConfig from "@/components/admin/settings/SeoTextsConfig";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Paramètres — ${shopName} Admin` };
}

const VALID_TABS = ["general", "societe", "catalogue", "carrousels", "stock", "maintenance", "livraison", "marketplaces", "horaires", "traduction", "seo"] as const;
type Tab = (typeof VALID_TABS)[number];

export default async function ParametresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rawTab = typeof sp.tab === "string" ? sp.tab : "general";
  const activeTab: Tab = VALID_TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "general";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Paramètres</h1>
        <p className="page-subtitle">Configuration générale du site.</p>
      </div>

      <div className="flex gap-8">
        <aside className="hidden lg:block w-60 shrink-0">
          <div className="sticky top-6">
            <SettingsPageTabs activeTab={activeTab} variant="desktop" />
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <div className="lg:hidden mb-6">
            <SettingsPageTabs activeTab={activeTab} variant="mobile" />
          </div>

          {activeTab === "general" && <GeneralTab />}
          {activeTab === "societe" && <SocieteTab />}
          {activeTab === "catalogue" && <CatalogueTab />}
          {activeTab === "carrousels" && <CarrouselsTab />}
          {activeTab === "stock" && <StockTab />}
          {activeTab === "maintenance" && <MaintenanceTab />}
          {activeTab === "livraison" && <LivraisonTab />}
          {activeTab === "marketplaces" && <MarketplacesTab />}
          {activeTab === "horaires" && <HorairesTab />}
          {activeTab === "traduction" && <TraductionTab />}
          {activeTab === "seo" && <SeoTab />}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Général — Bannière, commande min, mot de passe, apparence
   ═══════════════════════════════════════════════════════════════════════════ */
async function GeneralTab() {
  const [minConfig, bannerImageConfig, announcementConfig, faviconConfig] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "min_order_ht" } }),
    prisma.siteConfig.findUnique({ where: { key: "banner_image" } }),
    prisma.siteConfig.findUnique({ where: { key: "announcement_banner" } }),
    prisma.siteConfig.findUnique({ where: { key: "site_favicon" } }),
  ]);

  let currentFavicon: { icon: string; appleIcon: string } | null = null;
  if (faviconConfig?.value) {
    try {
      const parsed = JSON.parse(faviconConfig.value);
      if (parsed && typeof parsed.icon === "string" && typeof parsed.appleIcon === "string") {
        currentFavicon = { icon: parsed.icon, appleIcon: parsed.appleIcon };
      }
    } catch { /* ignore */ }
  }

  const currentMinHT = minConfig ? parseFloat(minConfig.value) : 0;

  // Parse announcement config
  let announcementMessages: string[] = [];
  let announcementBgColor = "#0F0F0F";
  let announcementTextColor = "#F5F1EA";
  let announcementSpeed = 8;
  if (announcementConfig?.value) {
    try {
      const parsed = JSON.parse(announcementConfig.value);
      announcementMessages = parsed.messages || [];
      announcementBgColor = parsed.bgColor || "#0F0F0F";
      announcementTextColor = parsed.textColor || "#F5F1EA";
      announcementSpeed = parsed.speed || 8;
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Bandeau d&apos;annonces</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Messages defilants en haut du site.</p>
        <AnnouncementBannerConfig
          initialMessages={announcementMessages}
          initialBgColor={announcementBgColor}
          initialTextColor={announcementTextColor}
          initialSpeed={announcementSpeed}
        />
      </div>

      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Bannière d&apos;accueil</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Image en haut de la page d&apos;accueil.</p>
        <BannerImageConfig currentImage={bannerImageConfig?.value ?? null} />
      </div>

      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Icône du site</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Petite image affichée dans l&apos;onglet du navigateur et à côté du site dans les résultats Google.</p>
        <FaviconConfig currentFavicon={currentFavicon} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
          <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Commande minimum</h3>
          <p className="text-sm text-text-secondary font-body mb-4"><strong>0</strong> pour désactiver.</p>
          <SettingsMinOrderForm currentValue={currentMinHT} />
        </div>
        <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
          <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Mot de passe admin</h3>
          <p className="text-sm text-text-secondary font-body mb-4">Réinitialisation par email.</p>
          <AdminPasswordResetButton />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Société — Informations société
   ═══════════════════════════════════════════════════════════════════════════ */
async function SocieteTab() {
  const companyInfo = await prisma.companyInfo.findFirst();

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
      <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Informations société</h3>
      <p className="text-sm text-text-secondary font-body mb-4">Nom de la boutique, raison sociale et coordonnées. Également utilisé comme adresse expéditeur Easy-Express.</p>
      <CompanyInfoForm initialData={companyInfo ? {
        shopName: companyInfo.shopName ?? undefined,
        name: companyInfo.name,
        legalForm: companyInfo.legalForm ?? undefined,
        capital: companyInfo.capital ?? undefined,
        siret: companyInfo.siret ?? undefined,
        rcs: companyInfo.rcs ?? undefined,
        tvaNumber: companyInfo.tvaNumber ?? undefined,
        address: companyInfo.address ?? undefined,
        city: companyInfo.city ?? undefined,
        postalCode: companyInfo.postalCode ?? undefined,
        country: companyInfo.country ?? undefined,
        phone: companyInfo.phone ?? undefined,
        email: companyInfo.email ?? undefined,
        website: companyInfo.website ?? undefined,
        director: companyInfo.director ?? undefined,
        hostName: companyInfo.hostName ?? undefined,
        hostAddress: companyInfo.hostAddress ?? undefined,
        hostPhone: companyInfo.hostPhone ?? undefined,
        hostEmail: companyInfo.hostEmail ?? undefined,
      } : null} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Catalogue — Affichage catalogue
   ═══════════════════════════════════════════════════════════════════════════ */
async function CatalogueTab() {
  const [displayConfigRow, categories, dbCollections, dbTags, refreshWarnEnabledRow, refreshWarnDaysRow] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "product_display_config" } }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.collection.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.siteConfig.findUnique({ where: { key: "refresh_warning_enabled" } }),
    prisma.siteConfig.findUnique({ where: { key: "refresh_warning_days" } }),
  ]);

  const displayConfig = parseDisplayConfig(displayConfigRow?.value ?? null);
  const refreshWarnEnabled = refreshWarnEnabledRow?.value === "true";
  const parsedRefreshDays = refreshWarnDaysRow ? parseInt(refreshWarnDaysRow.value, 10) : NaN;
  const refreshWarnDays = Number.isFinite(parsedRefreshDays) && parsedRefreshDays > 0 ? parsedRefreshDays : 7;

  return (
    <div className="space-y-6">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Affichage catalogue</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Ordre d&apos;affichage sur la page produits.</p>
        <CatalogDisplayConfig
          initialMode={displayConfig.catalogMode}
          initialSections={displayConfig.sections}
          categories={categories}
          collections={dbCollections}
          tags={dbTags}
        />
      </div>

      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Garde-fou rafraîchissement</h3>
        <p className="text-sm text-text-secondary font-body mb-4">
          Évite de rafraîchir un produit qui vient déjà d&apos;être mis en avant récemment.
        </p>
        <RefreshWarningConfig initialEnabled={refreshWarnEnabled} initialDays={refreshWarnDays} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Carrousels — Carrousels d'accueil
   ═══════════════════════════════════════════════════════════════════════════ */
async function CarrouselsTab() {
  const [displayConfigRow, categories, dbSubCategories, dbCollections, dbTags] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "product_display_config" } }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.subCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, category: { select: { name: true } } } }),
    prisma.collection.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const displayConfig = parseDisplayConfig(displayConfigRow?.value ?? null);

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
      <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Carrousels d&apos;accueil</h3>
      <p className="text-sm text-text-secondary font-body mb-4">Ordre et visibilité des carrousels de la page d&apos;accueil.</p>
      <HomepageCarouselsConfig
        initialCarousels={displayConfig.homepageCarousels}
        categories={categories}
        subCategories={dbSubCategories.map(s => ({ id: s.id, name: s.name, categoryName: s.category.name }))}
        collections={dbCollections}
        tags={dbTags}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Stock — Ruptures de stock
   ═══════════════════════════════════════════════════════════════════════════ */
async function StockTab() {
  const stockVariantsConfig = await prisma.siteConfig.findUnique({
    where: { key: "show_out_of_stock_variants" },
  });
  const showOutOfStockVariants = stockVariantsConfig?.value !== "false";

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
      <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Ruptures de stock</h3>
      <p className="text-sm text-text-secondary font-body mb-4">Visibilité côté client.</p>
      <StockDisplayConfig showOutOfStockVariants={showOutOfStockVariants} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Maintenance
   ═══════════════════════════════════════════════════════════════════════════ */
async function MaintenanceTab() {
  const maintenanceConfig = await prisma.siteConfig.findUnique({ where: { key: "maintenance_mode" } });

  const maintenanceValue = maintenanceConfig?.value ?? "false";
  const inMaintenance = maintenanceValue === "true" || maintenanceValue === "auto";
  const isAutoMaintenance = maintenanceValue === "auto";

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
      <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Mode maintenance</h3>
      <p className="text-sm text-text-secondary font-body mb-4">Redirige les clients vers une page d&apos;information.</p>
      {inMaintenance && (
        <div className={`mb-4 rounded-lg px-4 py-3 flex items-start gap-2 text-sm ${
          isAutoMaintenance
            ? "bg-red-50 border border-red-200 text-red-800"
            : "bg-amber-50 border border-amber-200 text-amber-800"
        }`}>
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isAutoMaintenance ? "text-error" : "text-warning"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <p className="font-body">
            {isAutoMaintenance
              ? <><strong>Maintenance automatique</strong> — Erreurs critiques détectées.</>
              : <><strong>Maintenance active</strong> — Site inaccessible aux clients.</>
            }
          </p>
        </div>
      )}
      <MaintenanceModeToggle currentValue={inMaintenance} isAuto={isAutoMaintenance} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Livraison — Easy-Express
   ═══════════════════════════════════════════════════════════════════════════ */
async function LivraisonTab() {
  const [eeApiKeyConfig, marginTypeRow, marginValueRow] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "easy_express_api_key" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "shipping_margin_type" } }),
    prisma.siteConfig.findUnique({ where: { key: "shipping_margin_value" } }),
  ]);

  const marginType = (marginTypeRow?.value as "fixed" | "percent") || "fixed";
  const marginValue = Number(marginValueRow?.value) || 0;

  return (
    <div className="space-y-6">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Easy-Express</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Clé API pour les expéditions. L&apos;adresse expéditeur utilise les infos société.</p>
        <EasyExpressApiKeyConfig hasKey={!!eeApiKeyConfig} />
      </div>

      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Marge sur les frais de port</h3>
        <ShippingMarginConfig initialType={marginType} initialValue={marginValue} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Marketplaces — PFS + Ankorstore
   ═══════════════════════════════════════════════════════════════════════════ */
async function MarketplacesTab() {
  const [
    pfsConfig,
    markupRows,
    pfsBrand,
    hasAnkorstoreConfig,
    ankorstoreEnabled,
    ankorstoreWholesaleType,
    ankorstoreWholesaleValue,
    ankorstoreWholesaleRounding,
    ankorstoreRetailType,
    ankorstoreRetailValue,
    ankorstoreRetailRounding,
    ankorstoreVatRateRaw,
    hasEfashionConfig,
    efashionEnabled,
    efashionMarkupType,
    efashionMarkupValue,
    efashionMarkupRounding,
    microstoreMarkupType,
    microstoreMarkupValue,
    microstoreMarkupRounding,
    hasFaireConfig,
    faireEnabled,
    faireWholesaleType,
    faireWholesaleValue,
    faireWholesaleRounding,
    faireRetailType,
    faireRetailValue,
    faireRetailRounding,
    pfsPublished, pfsToSync, pfsLast,
    ankPublished, ankToSync, ankLast,
    efaPublished, efaToSync, efaLast,
    faiPublished, faiToSync, faiLast,
  ] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "pfs_email" }, select: { key: true } }),
    prisma.siteConfig.findMany({
      where: {
        key: {
          in: [
            "pfs_price_markup_type", "pfs_price_markup_value", "pfs_price_markup_rounding",
          ],
        },
      },
    }),
    getCachedPfsBrand(),
    getCachedHasAnkorstoreConfig(),
    getCachedAnkorstoreEnabled(),
    getCachedSiteConfig("ankorstore_wholesale_markup_type"),
    getCachedSiteConfig("ankorstore_wholesale_markup_value"),
    getCachedSiteConfig("ankorstore_wholesale_markup_rounding"),
    getCachedSiteConfig("ankorstore_retail_markup_type"),
    getCachedSiteConfig("ankorstore_retail_markup_value"),
    getCachedSiteConfig("ankorstore_retail_markup_rounding"),
    getCachedSiteConfig("ankorstore_default_vat_rate"),
    getCachedHasEfashionConfig(),
    getCachedEfashionEnabled(),
    getCachedSiteConfig("efashion_price_markup_type"),
    getCachedSiteConfig("efashion_price_markup_value"),
    getCachedSiteConfig("efashion_price_markup_rounding"),
    getCachedSiteConfig("microstore_price_markup_type"),
    getCachedSiteConfig("microstore_price_markup_value"),
    getCachedSiteConfig("microstore_price_markup_rounding"),
    getCachedHasFaireConfig(),
    getCachedFaireEnabled(),
    getCachedSiteConfig("faire_wholesale_markup_type"),
    getCachedSiteConfig("faire_wholesale_markup_value"),
    getCachedSiteConfig("faire_wholesale_markup_rounding"),
    getCachedSiteConfig("faire_retail_markup_type"),
    getCachedSiteConfig("faire_retail_markup_value"),
    getCachedSiteConfig("faire_retail_markup_rounding"),
    // ── KPIs marketplaces ──
    prisma.product.count({ where: { pfsProductId: { not: null } } }),
    prisma.product.count({ where: { pfsSyncRequired: true } }),
    prisma.product.findFirst({ where: { pfsProductId: { not: null } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.product.count({ where: { ankorsProductId: { not: null } } }),
    prisma.product.count({ where: { ankorsSyncRequired: true } }),
    prisma.product.findFirst({ where: { ankorsProductId: { not: null } }, orderBy: { ankorsLastRefreshedAt: "desc" }, select: { ankorsLastRefreshedAt: true } }),
    prisma.product.count({ where: { efashionReferenceBase: { not: null } } }),
    prisma.product.count({ where: { efashionSyncRequired: true } }),
    prisma.product.findFirst({ where: { efashionReferenceBase: { not: null } }, orderBy: { efashionLastRefreshedAt: "desc" }, select: { efashionLastRefreshedAt: true } }),
    prisma.product.count({ where: { faireProductId: { not: null } } }),
    prisma.product.count({ where: { faireSyncRequired: true } }),
    prisma.product.findFirst({ where: { faireProductId: { not: null } }, orderBy: { faireLastRefreshedAt: "desc" }, select: { faireLastRefreshedAt: true } }),
  ]);

  const markupMap = new Map(markupRows.map((r) => [r.key, r.value]));

  const stats = {
    pfs: { published: pfsPublished, toSync: pfsToSync, lastSyncAt: pfsLast?.updatedAt?.toISOString() ?? null },
    ankorstore: { published: ankPublished, toSync: ankToSync, lastSyncAt: ankLast?.ankorsLastRefreshedAt?.toISOString() ?? null },
    efashion: { published: efaPublished, toSync: efaToSync, lastSyncAt: efaLast?.efashionLastRefreshedAt?.toISOString() ?? null },
    faire: { published: faiPublished, toSync: faiToSync, lastSyncAt: faiLast?.faireLastRefreshedAt?.toISOString() ?? null },
  };

  return (
    <div>
      <MarketplaceConfig
        hasPfsConfig={!!pfsConfig}
        pfsBrand={pfsBrand}
        hasAnkorstoreConfig={hasAnkorstoreConfig}
        ankorstoreEnabled={ankorstoreEnabled}
        hasEfashionConfig={hasEfashionConfig}
        efashionEnabled={efashionEnabled}
        hasFaireConfig={hasFaireConfig}
        faireEnabled={faireEnabled}
        stats={stats}
        markupSettings={{
          pfs: {
            type: (markupMap.get("pfs_price_markup_type") as "percent" | "fixed" | "multiplier") || "percent",
            value: Number(markupMap.get("pfs_price_markup_value")) || 0,
            rounding: (markupMap.get("pfs_price_markup_rounding") as "none" | "down" | "up") || "none",
          },
          ankorstoreWholesale: {
            type: (ankorstoreWholesaleType?.value as "percent" | "fixed" | "multiplier") || "percent",
            value: Number(ankorstoreWholesaleValue?.value) || 0,
            rounding: (ankorstoreWholesaleRounding?.value as "none" | "down" | "up") || "none",
          },
          ankorstoreRetail: {
            type: (ankorstoreRetailType?.value as "percent" | "fixed" | "multiplier") || "multiplier",
            value: Number(ankorstoreRetailValue?.value) || 2.5,
            rounding: (ankorstoreRetailRounding?.value as "none" | "down" | "up") || "up",
          },
          ankorstoreVatRate: Number(ankorstoreVatRateRaw?.value) || 20,
          efashion: {
            type: (efashionMarkupType?.value as "percent" | "fixed" | "multiplier") || "percent",
            value: Number(efashionMarkupValue?.value) || 0,
            rounding: (efashionMarkupRounding?.value as "none" | "down" | "up") || "none",
          },
          microstore: {
            type: (microstoreMarkupType?.value as "percent" | "fixed" | "multiplier") || "percent",
            value: Number(microstoreMarkupValue?.value) || 0,
            rounding: (microstoreMarkupRounding?.value as "none" | "down" | "up") || "none",
          },
          faireWholesale: {
            type: (faireWholesaleType?.value as "percent" | "fixed" | "multiplier") || "percent",
            value: Number(faireWholesaleValue?.value) || 0,
            rounding: (faireWholesaleRounding?.value as "none" | "down" | "up") || "none",
          },
          faireRetail: {
            type: (faireRetailType?.value as "percent" | "fixed" | "multiplier") || "multiplier",
            value: Number(faireRetailValue?.value) || 2.5,
            rounding: (faireRetailRounding?.value as "none" | "down" | "up") || "up",
          },
        }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Horaires — Business hours
   ═══════════════════════════════════════════════════════════════════════════ */
async function HorairesTab() {
  const row = await prisma.siteConfig.findUnique({ where: { key: "business_hours" } });
  let schedule = null;
  if (row?.value) {
    try { schedule = JSON.parse(row.value); } catch { /* ignore */ }
  }

  return (
    <BusinessHoursConfig initialSchedule={schedule} />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Traduction — fournie par le compte Paris Fashion Shop
   ═══════════════════════════════════════════════════════════════════════════ */
async function TraductionTab() {
  const [pfsEmailRow, autoTranslateConfig] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "pfs_email" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "auto_translate_enabled" }, select: { value: true } }),
  ]);

  const hasPfs = !!pfsEmailRow;

  return (
    <div className="space-y-6">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Service de traduction</h3>
        <p className="text-sm text-text-secondary font-body mb-4">
          La traduction passe désormais par votre compte Paris Fashion Shop (français → anglais).
          Aucune clé séparée à configurer ici : il suffit d&apos;avoir vos identifiants PFS renseignés dans
          l&apos;onglet « Marketplaces ».
        </p>
        <TranslationProviderStatus configured={hasPfs} />
      </div>

      {hasPfs && (
        <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
          <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Traduction automatique</h3>
          <p className="text-sm text-text-secondary font-body mb-4">
            Traduit automatiquement les noms et descriptions des produits, ainsi que les attributs
            (catégories, couleurs, compositions, pays, saisons, tags) lors de leur création.
          </p>
          <AutoTranslateConfig enabled={autoTranslateConfig?.value === "true"} />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Référencement — textes SEO
   ═══════════════════════════════════════════════════════════════════════════ */
async function SeoTab() {
  const [homeRow, produitsRow] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "home_seo_text" } }),
    prisma.siteConfig.findUnique({ where: { key: "produits_seo_text" } }),
  ]);

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
      <h3 className="font-heading text-base font-semibold text-text-primary mb-1">
        Textes pour Google
      </h3>
      <p className="text-sm text-text-secondary font-body mb-5">
        Petits textes affichés sur la page d&apos;accueil et sur la page de tous les produits. Ils aident Google à comprendre ce que vous vendez et à mieux référencer le site.
      </p>
      <SeoTextsConfig
        initialHomeText={homeRow?.value ?? ""}
        initialProduitsText={produitsRow?.value ?? ""}
      />
    </div>
  );
}

