import type { Metadata } from "next";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { parseDisplayConfig } from "@/lib/product-display";
import SettingsPageTabs from "@/components/admin/settings/SettingsPageTabs";
import SettingsMinOrderForm from "@/components/admin/settings/SettingsMinOrderForm";
import AdminPasswordResetButton from "@/components/admin/settings/AdminPasswordResetButton";
import MaintenanceModeToggle from "@/components/admin/settings/MaintenanceModeToggle";
import CatalogDisplayConfig from "@/components/admin/settings/CatalogDisplayConfig";
import HomepageCarouselsConfig from "@/components/admin/settings/HomepageCarouselsConfig";
import StockDisplayConfig from "@/components/admin/settings/StockDisplayConfig";
import DarkModeToggle from "@/components/admin/settings/DarkModeToggle";
import CompanyInfoForm from "@/components/admin/settings/CompanyInfoForm";
import BannerImageConfig from "@/components/admin/settings/BannerImageConfig";
import EasyExpressApiKeyConfig from "@/components/admin/settings/EasyExpressApiKeyConfig";
import StripeConfig from "@/components/admin/settings/StripeConfig";
import GmailConfig from "@/components/admin/settings/GmailConfig";
import MarketplaceConfig from "@/components/admin/settings/MarketplaceConfig";
import DeeplApiKeyConfig from "@/components/admin/settings/DeeplApiKeyConfig";
import AutoTranslateConfig from "@/components/admin/settings/AutoTranslateConfig";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Paramètres — ${shopName} Admin` };
}

const VALID_TABS = ["general", "societe", "catalogue", "carrousels", "stock", "maintenance", "paiement", "email", "livraison", "marketplaces", "traduction"] as const;
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

      <div className="border-b border-border">
        <SettingsPageTabs activeTab={activeTab} />
      </div>

      {activeTab === "general" && <GeneralTab />}
      {activeTab === "societe" && <SocieteTab />}
      {activeTab === "catalogue" && <CatalogueTab />}
      {activeTab === "carrousels" && <CarrouselsTab />}
      {activeTab === "stock" && <StockTab />}
      {activeTab === "maintenance" && <MaintenanceTab />}
      {activeTab === "paiement" && <PaiementTab />}
      {activeTab === "email" && <EmailTab />}
      {activeTab === "livraison" && <LivraisonTab />}
      {activeTab === "marketplaces" && <MarketplacesTab />}
      {activeTab === "traduction" && <TraductionTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Général — Bannière, commande min, mot de passe, apparence
   ═══════════════════════════════════════════════════════════════════════════ */
async function GeneralTab() {
  const [minConfig, bannerImageConfig] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "min_order_ht" } }),
    prisma.siteConfig.findUnique({ where: { key: "banner_image" } }),
  ]);

  const cookieStore = await cookies();
  const adminTheme = (cookieStore.get("bj_admin_theme")?.value === "dark" ? "dark" : "light") as "light" | "dark";
  const currentMinHT = minConfig ? parseFloat(minConfig.value) : 0;

  return (
    <div className="space-y-6">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Bannière d&apos;accueil</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Image en haut de la page d&apos;accueil.</p>
        <BannerImageConfig currentImage={bannerImageConfig?.value ?? null} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Commande minimum</h3>
          <p className="text-sm text-text-secondary font-body mb-4"><strong>0</strong> pour désactiver.</p>
          <SettingsMinOrderForm currentValue={currentMinHT} />
        </div>
        <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Mot de passe admin</h3>
          <p className="text-sm text-text-secondary font-body mb-4">Réinitialisation par email.</p>
          <AdminPasswordResetButton />
        </div>
        <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Apparence</h3>
          <p className="text-sm text-text-secondary font-body mb-4">Mode jour / nuit admin.</p>
          <DarkModeToggle currentTheme={adminTheme} />
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
    <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
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
  const [displayConfigRow, categories, dbCollections, dbTags] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "product_display_config" } }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.collection.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const displayConfig = parseDisplayConfig(displayConfigRow?.value ?? null);

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
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
    <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
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
  const [stockVariantsConfig, stockProductsConfig] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "show_out_of_stock_variants" } }),
    prisma.siteConfig.findUnique({ where: { key: "show_out_of_stock_products" } }),
  ]);

  const showOutOfStockVariants = stockVariantsConfig?.value !== "false";
  const showOutOfStockProducts = stockProductsConfig?.value !== "false";

  return (
    <div className="max-w-lg">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Ruptures de stock</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Visibilité côté client.</p>
        <StockDisplayConfig showOutOfStockVariants={showOutOfStockVariants} showOutOfStockProducts={showOutOfStockProducts} />
      </div>
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
    <div className="max-w-lg">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Mode maintenance</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Redirige les clients vers une page d&apos;information.</p>
        {inMaintenance && (
          <div className={`mb-4 rounded-lg px-4 py-3 flex items-start gap-2 text-sm ${
            isAutoMaintenance
              ? "bg-[#FEE2E2] border border-[#FECACA] text-[#B91C1C]"
              : "bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E]"
          }`}>
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isAutoMaintenance ? "text-[#EF4444]" : "text-[#D97706]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Paiement — Stripe
   ═══════════════════════════════════════════════════════════════════════════ */
async function PaiementTab() {
  const [stripeKeyConfig, stripeConnectConfig] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "stripe_secret_key" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "stripe_connect_account_id" }, select: { key: true } }),
  ]);

  const { isConnectEnabled } = await import("@/lib/stripe");
  const connectEnabled = isConnectEnabled();

  return (
    <div className="max-w-xl">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Paiement Stripe</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Connectez votre compte Stripe pour accepter les paiements.</p>
        <StripeConfig
          hasKeys={!!stripeKeyConfig}
          hasConnect={!!stripeConnectConfig}
          connectEnabled={connectEnabled}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Email — Gmail
   ═══════════════════════════════════════════════════════════════════════════ */
async function EmailTab() {
  const gmailConfig = await prisma.siteConfig.findUnique({ where: { key: "gmail_user" }, select: { key: true } });

  return (
    <div className="max-w-xl">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Notifications email</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Identifiants Gmail pour l&apos;envoi d&apos;emails (inscriptions, commandes, alertes).</p>
        <GmailConfig hasConfig={!!gmailConfig} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Livraison — Easy-Express
   ═══════════════════════════════════════════════════════════════════════════ */
async function LivraisonTab() {
  const eeApiKeyConfig = await prisma.siteConfig.findUnique({ where: { key: "easy_express_api_key" }, select: { key: true } });

  return (
    <div className="max-w-xl">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Easy-Express</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Clé API pour les expéditions. L&apos;adresse expéditeur utilise les infos société.</p>
        <EasyExpressApiKeyConfig hasKey={!!eeApiKeyConfig} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Marketplaces — PFS + eFashion
   ═══════════════════════════════════════════════════════════════════════════ */
async function MarketplacesTab() {
  const [pfsConfig, pfsEnabledRow, efashionConfig, efashionEnabledRow, ankorstoreConfig, ankorstoreEnabledRow] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "pfs_email" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "pfs_enabled" }, select: { value: true } }),
    prisma.siteConfig.findUnique({ where: { key: "efashion_email" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "efashion_enabled" }, select: { value: true } }),
    prisma.siteConfig.findUnique({ where: { key: "ankorstore_client_id" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "ankorstore_enabled" }, select: { value: true } }),
  ]);

  return (
    <div className="max-w-xl">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Marketplaces</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Identifiants de connexion aux plateformes B2B.</p>
        <MarketplaceConfig
          hasPfsConfig={!!pfsConfig}
          pfsEnabled={pfsEnabledRow?.value === "true"}
          hasEfashionConfig={!!efashionConfig}
          efashionEnabled={efashionEnabledRow?.value === "true"}
          hasAnkorstoreConfig={!!ankorstoreConfig}
          ankorstoreEnabled={ankorstoreEnabledRow?.value === "true"}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Traduction — DeepL
   ═══════════════════════════════════════════════════════════════════════════ */
async function TraductionTab() {
  const [deeplKeyConfig, autoTranslateConfig] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "deepl_api_key" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "auto_translate_enabled" }, select: { value: true } }),
  ]);

  const hasDeeplKey = !!deeplKeyConfig;

  return (
    <div className="max-w-xl space-y-6">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Traduction DeepL</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Clé API pour la traduction automatique des fiches produit.</p>
        <DeeplApiKeyConfig hasKey={hasDeeplKey} />
      </div>

      {hasDeeplKey && (
        <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Traduction automatique</h3>
          <p className="text-sm text-text-secondary font-body mb-4">
            Traduit automatiquement en 6 langues lors de la création de produits, attributs et imports PFS.
          </p>
          <AutoTranslateConfig enabled={autoTranslateConfig?.value === "true"} />
        </div>
      )}
    </div>
  );
}
