import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  getCachedShopName, getCachedHasAnkorstoreConfig, getCachedAnkorstoreEnabled,
  getCachedSiteConfig, getCachedPfsBrand, getCachedHasEfashionConfig, getCachedEfashionEnabled,
  getCachedHasFaireConfig, getCachedFaireEnabled,
} from "@/lib/cached-data";
import { getStripeAccountInfo, getStripeConfigStatus } from "@/lib/stripe";
import { parseDisplayConfig } from "@/lib/product-display";
import { settingsTabMetadata, isSettingsTab, type SettingsTab } from "@/lib/settings-tabs";
import SettingsPageTabs from "@/components/admin/settings/SettingsPageTabs";
import { SettingCard, CardsStack } from "@/components/admin/settings/SettingCard";

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
import StripeSettingsForm from "@/components/admin/settings/StripeSettingsForm";
import StripeAccountStatusCard from "@/components/admin/onboarding/StripeAccountStatusCard";
import MarketplaceConfig from "@/components/admin/settings/MarketplaceConfig";
import AutoTranslateConfig from "@/components/admin/settings/AutoTranslateConfig";
import TranslationProviderStatus from "@/components/admin/settings/TranslationProviderStatus";
import BusinessHoursConfig from "@/components/admin/settings/BusinessHoursConfig";
import AnnouncementBannerConfig from "@/components/admin/settings/AnnouncementBannerConfig";
import SeoTextsConfig from "@/components/admin/settings/SeoTextsConfig";
import MailNotifyForm from "@/components/admin/settings/MailNotifyForm";
import MailboxPasswordResetCard from "@/components/admin/settings/MailboxPasswordResetCard";
import PersonalEmailCard from "@/components/admin/settings/PersonalEmailCard";
import { getMailNotifySettings } from "@/app/actions/admin/mail-notify";
import { getAdminPersonalEmailState } from "@/app/actions/admin/admin-personal-email";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Paramètres — ${shopName} Admin` };
}

/* ── Icônes réutilisées dans les headers de cartes ─────────────────────── */
const Ico = {
  megaphone: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-7v16L3 13z"/><path d="M11 8v10a2 2 0 0 1-4 0v-1"/></svg>,
  image:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>,
  favicon:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>,
  minOrder:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/></svg>,
  lock:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  building:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15"/></svg>,
  grid:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3.75" y="3.75" width="6.75" height="6.75" rx="1.5"/><rect x="13.5" y="3.75" width="6.75" height="6.75" rx="1.5"/><rect x="3.75" y="13.5" width="6.75" height="6.75" rx="1.5"/><rect x="13.5" y="13.5" width="6.75" height="6.75" rx="1.5"/></svg>,
  refresh:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>,
  slides:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 6v12M16 6v12"/></svg>,
  box:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5"/><path d="M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/></svg>,
  warning:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v3.75m0 3.75h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>,
  clock:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z"/></svg>,
  truck:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 4v4h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  margin:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>,
  translate: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h7M9 3v2M4 9c0 5 4 8 8 8M9 9c-2 4 0 8 4 8M14 5l6 14M17 15h6"/></svg>,
  sparkles:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.7h6L15 12.4l1.9 5.7L12 14.3l-4.9 3.8L9 12.4 4.1 8.7h6z"/></svg>,
  search:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>,
  card:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>,
  bell:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
};

/* ─────────────────────────────────────────────────────────────────────────
   PAGE PRINCIPALE
   ───────────────────────────────────────────────────────────────────────── */
export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rawTab = typeof sp.tab === "string" ? sp.tab : "general";
  const activeTab: SettingsTab = isSettingsTab(rawTab) ? rawTab : "general";
  const meta = settingsTabMetadata(activeTab);

  // Compte de marketplaces configurées pour le badge du menu
  const [hasPfs, hasAnkor, hasEfashion, hasFaire] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "pfs_email" }, select: { key: true } }).then(Boolean),
    getCachedHasAnkorstoreConfig(),
    getCachedHasEfashionConfig(),
    getCachedHasFaireConfig(),
  ]);
  const mpConnected = [hasPfs, hasAnkor, hasEfashion, hasFaire].filter(Boolean).length;
  const mpBadge = `${mpConnected}/4`;

  return (
    <div className="space-y-6">
      {/* ══════════════ HERO ══════════════ */}
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full blur-3xl bg-slate-300/30 pointer-events-none" />
        <div className="absolute -bottom-20 left-1/4 w-64 h-64 rounded-full blur-3xl bg-zinc-200/40 pointer-events-none" />

        <div className="relative p-5 sm:p-6 lg:p-8">
          {/* Breadcrumb */}
          <div className="text-[12px] text-text-muted mb-2 flex items-center gap-1.5">
            <Link href="/admin/parametres" className="hover:text-text-primary transition-colors">Paramètres</Link>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6"/></svg>
            <span className="text-text-secondary">{meta.label}</span>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-text-primary shadow-[0_0_0_3px_rgba(24,24,27,0.14)]" />
                Configuration › {meta.label}
              </span>
              <h1 className="page-title mt-3">{meta.label}</h1>
              <p className="page-subtitle font-body max-w-2xl">{meta.description}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════ LAYOUT ══════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
        <aside className="hidden lg:block lg:sticky lg:top-6">
          <SettingsPageTabs activeTab={activeTab} variant="desktop" badges={{ marketplaces: mpBadge }} />
        </aside>

        <div className="min-w-0">
          <div className="lg:hidden mb-5">
            <SettingsPageTabs activeTab={activeTab} variant="mobile" badges={{ marketplaces: mpBadge }} />
          </div>

          {activeTab === "general"      && <GeneralTab />}
          {activeTab === "societe"      && <SocieteTab />}
          {activeTab === "catalogue"    && <CatalogueTab />}
          {activeTab === "carrousels"   && <CarrouselsTab />}
          {activeTab === "stock"        && <StockTab />}
          {activeTab === "maintenance"  && <MaintenanceTab />}
          {activeTab === "livraison"    && <LivraisonTab />}
          {activeTab === "paiement"     && <PaiementTab />}
          {activeTab === "marketplaces" && <MarketplacesTab />}
          {activeTab === "horaires"     && <HorairesTab />}
          {activeTab === "traduction"   && <TraductionTab />}
          {activeTab === "seo"          && <SeoTab />}
          {activeTab === "messagerie"   && <MessagerieTab />}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Général
   ═══════════════════════════════════════════════════════════════════════════ */
async function GeneralTab() {
  const [minConfig, bannerImageConfig, announcementConfig, faviconConfig] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "min_order_ht" } }),
    prisma.siteConfig.findFirst({ where: { key: "banner_image" } }),
    prisma.siteConfig.findFirst({ where: { key: "announcement_banner" } }),
    prisma.siteConfig.findFirst({ where: { key: "site_favicon" } }),
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
    <CardsStack>
      <SettingCard
        icon={Ico.megaphone}
        title="Bandeau d'annonces"
        description="Messages défilants en haut du site (soldes, livraison offerte, promo du moment…)"
        accent="dark"
        status={announcementMessages.length > 0
          ? { tone: "ok", label: `${announcementMessages.length} message${announcementMessages.length > 1 ? "s" : ""}` }
          : { tone: "off", label: "Aucun" }}
      >
        <AnnouncementBannerConfig
          initialMessages={announcementMessages}
          initialBgColor={announcementBgColor}
          initialTextColor={announcementTextColor}
          initialSpeed={announcementSpeed}
        />
      </SettingCard>

      <SettingCard
        icon={Ico.image}
        title="Bannière d'accueil"
        description="Grande image en haut de la page d'accueil du site"
      >
        <BannerImageConfig currentImage={bannerImageConfig?.value ?? null} />
      </SettingCard>

      <SettingCard
        icon={Ico.favicon}
        title="Icône du site"
        description="Petite image affichée dans l'onglet du navigateur et à côté du site dans les résultats Google"
      >
        <FaviconConfig currentFavicon={currentFavicon} />
      </SettingCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SettingCard
          icon={Ico.minOrder}
          title="Commande minimum"
          description="Empêche la commande sous ce seuil (0 pour désactiver)"
        >
          <SettingsMinOrderForm currentValue={currentMinHT} />
        </SettingCard>

        <SettingCard
          icon={Ico.lock}
          title="Mot de passe admin"
          description="Recevez un email pour le réinitialiser en toute sécurité"
        >
          <AdminPasswordResetButton />
        </SettingCard>
      </div>
    </CardsStack>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Société
   ═══════════════════════════════════════════════════════════════════════════ */
async function SocieteTab() {
  const [companyInfo, smtpFromEmailRow] = await Promise.all([
    prisma.companyInfo.findFirst(),
    prisma.siteConfig.findFirst({ where: { key: "smtp_from_email" }, select: { value: true } }),
  ]);
  const { decryptIfSensitive } = await import("@/lib/encryption");
  const proEmail = smtpFromEmailRow?.value
    ? decryptIfSensitive("smtp_from_email", smtpFromEmailRow.value).trim() || null
    : null;

  return (
    <SettingCard
      icon={Ico.building}
      title="Informations société"
      description="Nom de la boutique, raison sociale, coordonnées et adresse expéditeur Easy-Express"
      accent="dark"
    >
      <CompanyInfoForm proEmail={proEmail} initialData={companyInfo ? {
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
    </SettingCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Catalogue
   ═══════════════════════════════════════════════════════════════════════════ */
async function CatalogueTab() {
  const [displayConfigRow, categories, dbCollections, dbTags, refreshWarnEnabledRow, refreshWarnDaysRow] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "product_display_config" } }),
    prisma.category.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.collection.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.siteConfig.findFirst({ where: { key: "refresh_warning_enabled" } }),
    prisma.siteConfig.findFirst({ where: { key: "refresh_warning_days" } }),
  ]);

  const displayConfig = parseDisplayConfig(displayConfigRow?.value ?? null);
  const refreshWarnEnabled = refreshWarnEnabledRow?.value === "true";
  const parsedRefreshDays = refreshWarnDaysRow ? parseInt(refreshWarnDaysRow.value, 10) : NaN;
  const refreshWarnDays = Number.isFinite(parsedRefreshDays) && parsedRefreshDays > 0 ? parsedRefreshDays : 7;

  return (
    <CardsStack>
      <SettingCard
        icon={Ico.grid}
        title="Affichage catalogue"
        description="Ordre et visibilité des sections (catégories, collections, tags) sur /produits"
        accent="dark"
      >
        <CatalogDisplayConfig
          initialMode={displayConfig.catalogMode}
          initialSections={displayConfig.sections}
          categories={categories}
          collections={dbCollections}
          tags={dbTags}
        />
      </SettingCard>

      <SettingCard
        icon={Ico.refresh}
        title="Garde-fou rafraîchissement"
        description="Évite de rafraîchir un produit qui vient déjà d'être mis en avant récemment"
      >
        <RefreshWarningConfig initialEnabled={refreshWarnEnabled} initialDays={refreshWarnDays} />
      </SettingCard>
    </CardsStack>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Carrousels
   ═══════════════════════════════════════════════════════════════════════════ */
async function CarrouselsTab() {
  const [displayConfigRow, categories, dbSubCategories, dbCollections, dbTags] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "product_display_config" } }),
    prisma.category.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.subCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, category: { select: { name: true } } } }),
    prisma.collection.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const displayConfig = parseDisplayConfig(displayConfigRow?.value ?? null);
  const activeCount = displayConfig.homepageCarousels.filter((c) => c.visible).length;

  return (
    <SettingCard
      icon={Ico.slides}
      title="Carrousels d'accueil"
      description="Bandes de produits sur la page d'accueil — glissez-déposez pour réorganiser"
      accent="dark"
      status={activeCount > 0
        ? { tone: "ok", label: `${activeCount} actif${activeCount > 1 ? "s" : ""}` }
        : { tone: "off", label: "Aucun" }}
    >
      <HomepageCarouselsConfig
        initialCarousels={displayConfig.homepageCarousels}
        categories={categories}
        subCategories={dbSubCategories.map(s => ({ id: s.id, name: s.name, categoryName: s.category.name }))}
        collections={dbCollections}
        tags={dbTags}
      />
    </SettingCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Stock
   ═══════════════════════════════════════════════════════════════════════════ */
async function StockTab() {
  const stockVariantsConfig = await prisma.siteConfig.findFirst({
    where: { key: "show_out_of_stock_variants" },
  });
  const showOutOfStockVariants = stockVariantsConfig?.value !== "false";

  return (
    <CardsStack>
      <SettingCard
        icon={Ico.box}
        title="Ruptures de stock côté client"
        description="Choisissez si les variantes vides restent visibles ou disparaissent de la fiche produit"
        accent="dark"
      >
        <StockDisplayConfig showOutOfStockVariants={showOutOfStockVariants} />
      </SettingCard>

      <SettingCard
        icon={Ico.grid}
        title="Aperçu"
        description="À quoi ressemble le sélecteur de taille sur une fiche produit selon votre choix"
      >
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-[13px] font-body font-medium text-text-secondary mr-2">Taille :</span>
          <button type="button" className="px-3 py-1.5 rounded-lg border border-border-strong text-[13px] font-medium">50</button>
          <button type="button" className="px-3 py-1.5 rounded-lg bg-text-primary text-white text-[13px] font-semibold">52</button>
          <button type="button" className="px-3 py-1.5 rounded-lg border border-border-strong text-[13px] font-medium">54</button>
          <span className={`relative inline-block ${showOutOfStockVariants ? "" : "hidden"}`}>
            <button type="button" className="px-3 py-1.5 rounded-lg border border-border-strong text-[13px] font-medium opacity-50" disabled>56</button>
            <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="w-full h-px bg-text-muted rotate-[-8deg]" />
            </span>
          </span>
        </div>
        <p className="text-[11.5px] text-text-muted font-body mt-3">
          {showOutOfStockVariants
            ? "La taille 56 est en rupture — reste visible mais grisée et non sélectionnable."
            : "Les tailles en rupture sont masquées : le client ne voit que ce qui est disponible."}
        </p>
      </SettingCard>
    </CardsStack>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Maintenance
   ═══════════════════════════════════════════════════════════════════════════ */
async function MaintenanceTab() {
  const maintenanceConfig = await prisma.siteConfig.findFirst({ where: { key: "maintenance_mode" } });

  const maintenanceValue = maintenanceConfig?.value ?? "false";
  const inMaintenance = maintenanceValue === "true" || maintenanceValue === "auto";
  const isAutoMaintenance = maintenanceValue === "auto";

  const cardStatus = isAutoMaintenance
    ? { tone: "danger" as const, label: "Automatique" }
    : inMaintenance
      ? { tone: "warn" as const, label: "Actif" }
      : { tone: "ok" as const, label: "Site en ligne" };

  return (
    <SettingCard
      icon={Ico.warning}
      title="Mode maintenance"
      description="Bloque temporairement l'accès à votre boutique. 3 modes possibles."
      accent="dark"
      status={cardStatus}
    >
      {inMaintenance && (
        <div className={`mb-4 rounded-xl px-4 py-3 flex items-start gap-2 text-sm ${
          isAutoMaintenance
            ? "bg-red-50 border border-red-200 text-red-800"
            : "bg-amber-50 border border-amber-200 text-amber-800"
        }`}>
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isAutoMaintenance ? "text-red-600" : "text-amber-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
    </SettingCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Livraison
   ═══════════════════════════════════════════════════════════════════════════ */
async function LivraisonTab() {
  const [eeApiKeyConfig, marginTypeRow, marginValueRow] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "easy_express_api_key" }, select: { key: true } }),
    prisma.siteConfig.findFirst({ where: { key: "shipping_margin_type" } }),
    prisma.siteConfig.findFirst({ where: { key: "shipping_margin_value" } }),
  ]);

  const marginType = (marginTypeRow?.value as "fixed" | "percent") || "fixed";
  const marginValue = Number(marginValueRow?.value) || 0;
  const eeConnected = !!eeApiKeyConfig;

  return (
    <CardsStack>
      <SettingCard
        icon={Ico.truck}
        title="Easy-Express"
        description="Clé API pour les expéditions — l'adresse expéditeur utilise les infos de l'onglet Société"
        accent="dark"
        status={eeConnected ? { tone: "ok", label: "Connectée" } : { tone: "off", label: "Non configurée" }}
      >
        <EasyExpressApiKeyConfig hasKey={eeConnected} />
      </SettingCard>

      <SettingCard
        icon={Ico.margin}
        title="Marge sur les frais de port"
        description="Différence entre le coût réel Easy-Express et le prix facturé au client"
      >
        <ShippingMarginConfig initialType={marginType} initialValue={marginValue} />

        {/* Aperçu du calcul avec un colis exemple à 6,80 € */}
        <div className="mt-5 rounded-2xl border border-border bg-bg-secondary/40 p-4">
          <p className="text-[10px] font-body font-bold uppercase tracking-[0.14em] text-text-muted mb-2.5">
            Exemple pour un colis à 6,80 €
          </p>
          <div className="text-[13px] space-y-1.5 font-body">
            <div className="flex justify-between">
              <span className="text-text-muted">Coût Easy-Express</span>
              <span className="tabular-nums font-semibold">6,80 €</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">
                + Marge {marginType === "percent" ? `${marginValue} %` : `${marginValue.toFixed(2).replace(".", ",")} €`}
              </span>
              <span className="tabular-nums font-semibold">
                +{(marginType === "percent" ? 6.80 * (marginValue / 100) : marginValue).toFixed(2).replace(".", ",")} €
              </span>
            </div>
            <div className="flex justify-between pt-1.5 border-t border-border">
              <span className="font-semibold">Facturé au client</span>
              <span className="tabular-nums font-heading font-bold text-base">
                {(6.80 + (marginType === "percent" ? 6.80 * (marginValue / 100) : marginValue)).toFixed(2).replace(".", ",")} €
              </span>
            </div>
          </div>
        </div>
      </SettingCard>
    </CardsStack>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Paiement
   ═══════════════════════════════════════════════════════════════════════════ */
async function PaiementTab() {
  const [status, publishableRow, accountInfo] = await Promise.all([
    getStripeConfigStatus(),
    prisma.siteConfig.findFirst({ where: { key: "stripe_publishable_key" } }),
    // Interroge Stripe pour récupérer le nom du compte/société branché.
    // Sans cette carte, la cliente ne voyait que « Mode LIVE/TEST » et ne
    // savait pas à quel compte Stripe le site était relié.
    getStripeAccountInfo(),
  ]);
  const publishable =
    publishableRow?.value?.trim() ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    "";

  const cardStatus = status.ready
    ? { tone: "ok" as const, label: status.testMode ? "Mode TEST" : "Mode LIVE" }
    : { tone: "off" as const, label: "Non configuré" };

  return (
    <CardsStack>
      <StripeAccountStatusCard info={accountInfo} />
      <SettingCard
        icon={Ico.card}
        title="Stripe"
        description="Les 3 clés Stripe nécessaires pour encaisser les paiements en ligne. Modifiez-les à tout moment — les valeurs sensibles sont chiffrées en base."
        accent="dark"
        status={cardStatus}
      >
        {status.source === "env" && (
          <div className="mb-5 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            💡 Configuration actuelle lue dans le fichier <code>.env</code> du serveur.
            Renseignez les clés ci-dessous pour les migrer en base (chiffrées).
          </div>
        )}
        <StripeSettingsForm
          initialHasSecret={status.hasSecret}
          initialHasWebhook={status.hasWebhook}
          initialPublishable={publishable}
        />
      </SettingCard>
    </CardsStack>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Marketplaces (inchangé — MarketplaceConfig gère son propre visuel)
   ═══════════════════════════════════════════════════════════════════════════ */
async function MarketplacesTab() {
  const [
    pfsConfig, markupRows, pfsBrand,
    pfsOutOfStockDeactivateRow, pfsOutOfStockActionRow,
    hasAnkorstoreConfig, ankorstoreEnabled,
    ankorstoreWholesaleType, ankorstoreWholesaleValue, ankorstoreWholesaleRounding,
    ankorstoreRetailType, ankorstoreRetailValue, ankorstoreRetailRounding,
    ankorstoreVatRateRaw,
    hasEfashionConfig, efashionEnabled,
    efashionMarkupType, efashionMarkupValue, efashionMarkupRounding,
    microstoreMarkupType, microstoreMarkupValue, microstoreMarkupRounding,
    hasFaireConfig, faireEnabled,
    faireWholesaleType, faireWholesaleValue, faireWholesaleRounding,
    faireRetailType, faireRetailValue, faireRetailRounding,
    pfsPublished, pfsToSync, pfsLast,
    ankPublished, ankToSync, ankLast,
    efaPublished, efaToSync, efaLast,
    faiPublished, faiToSync, faiLast,
  ] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "pfs_email" }, select: { key: true } }),
    prisma.siteConfig.findMany({
      where: { key: { in: ["pfs_price_markup_type", "pfs_price_markup_value", "pfs_price_markup_rounding"] } },
    }),
    getCachedPfsBrand(),
    getCachedSiteConfig("pfs_out_of_stock_deactivate_variant"),
    getCachedSiteConfig("pfs_out_of_stock_product_action"),
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
    pfs:        { published: pfsPublished, toSync: pfsToSync, lastSyncAt: pfsLast?.updatedAt?.toISOString() ?? null },
    ankorstore: { published: ankPublished, toSync: ankToSync, lastSyncAt: ankLast?.ankorsLastRefreshedAt?.toISOString() ?? null },
    efashion:   { published: efaPublished, toSync: efaToSync, lastSyncAt: efaLast?.efashionLastRefreshedAt?.toISOString() ?? null },
    faire:      { published: faiPublished, toSync: faiToSync, lastSyncAt: faiLast?.faireLastRefreshedAt?.toISOString() ?? null },
  };

  return (
    <MarketplaceConfig
      hasPfsConfig={!!pfsConfig}
      pfsBrand={pfsBrand}
      pfsOutOfStock={{
        deactivateVariant: pfsOutOfStockDeactivateRow?.value === "false" ? false : true,
        productAction:
          pfsOutOfStockActionRow?.value === "deleted" ||
          pfsOutOfStockActionRow?.value === "draft"
            ? pfsOutOfStockActionRow.value
            : "archived",
      }}
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
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Horaires
   ═══════════════════════════════════════════════════════════════════════════ */
async function HorairesTab() {
  const row = await prisma.siteConfig.findFirst({ where: { key: "business_hours" } });
  let schedule = null;
  if (row?.value) {
    try { schedule = JSON.parse(row.value); } catch { /* ignore */ }
  }

  return (
    <SettingCard
      icon={Ico.clock}
      title="Horaires d'ouverture"
      description="Jours et heures d'ouverture affichés sur la page contact"
      accent="dark"
    >
      <BusinessHoursConfig initialSchedule={schedule} />
    </SettingCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Traduction
   ═══════════════════════════════════════════════════════════════════════════ */
async function TraductionTab() {
  const [pfsEmailRow, autoTranslateConfig] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "pfs_email" }, select: { key: true } }),
    prisma.siteConfig.findFirst({ where: { key: "auto_translate_enabled" }, select: { value: true } }),
  ]);

  const hasPfs = !!pfsEmailRow;

  return (
    <CardsStack>
      <SettingCard
        icon={Ico.translate}
        title="Service de traduction"
        description="La traduction passe par votre compte Paris Fashion Shop — pas de clé séparée à configurer ici"
        accent="dark"
        status={hasPfs ? { tone: "ok", label: "PFS connecté" } : { tone: "off", label: "PFS requis" }}
      >
        <TranslationProviderStatus configured={hasPfs} />
      </SettingCard>

      {hasPfs && (
        <SettingCard
          icon={Ico.sparkles}
          title="Traduction automatique"
          description="Traduit noms de produits, descriptions et attributs (catégories, couleurs, tags…) à la création"
        >
          <AutoTranslateConfig enabled={autoTranslateConfig?.value === "true"} />

          {/* Aperçu FR → EN */}
          <div className="mt-5 rounded-2xl border border-border bg-bg-secondary/40 p-4">
            <p className="text-[10px] font-body font-bold uppercase tracking-[0.14em] text-text-muted mb-3">
              Aperçu d'une traduction
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-body text-text-muted mb-1.5">🇫🇷 Français</p>
                <div className="bg-bg-primary rounded-xl p-3 border border-border text-[13px] leading-relaxed">
                  Bague en acier inoxydable avec motif floral doré
                </div>
              </div>
              <div>
                <p className="text-[11px] font-body text-text-muted mb-1.5">🇬🇧 Anglais (auto)</p>
                <div className="bg-bg-primary rounded-xl p-3 border border-border text-[13px] leading-relaxed">
                  Stainless steel ring with golden floral pattern
                </div>
              </div>
            </div>
          </div>
        </SettingCard>
      )}
    </CardsStack>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Référencement (SEO)
   ═══════════════════════════════════════════════════════════════════════════ */
async function SeoTab() {
  const [homeRow, produitsRow] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "home_seo_text" } }),
    prisma.siteConfig.findFirst({ where: { key: "produits_seo_text" } }),
  ]);

  const shopName = await getCachedShopName();
  const homeText = homeRow?.value?.trim() ?? "";
  const previewSnippet = homeText
    ? (homeText.length > 160 ? homeText.slice(0, 158).trimEnd() + "…" : homeText)
    : "Ajoutez un texte SEO pour la page d'accueil ci-dessus — il apparaîtra dans les résultats Google.";

  return (
    <CardsStack>
      <SettingCard
        icon={Ico.search}
        title="Textes pour Google"
        description="Petits paragraphes affichés en bas de la page d'accueil et de /produits — ils aident Google à mieux référencer le site."
        accent="dark"
      >
        <SeoTextsConfig
          initialHomeText={homeRow?.value ?? ""}
          initialProduitsText={produitsRow?.value ?? ""}
        />
      </SettingCard>

      <SettingCard
        icon={Ico.search}
        title="Aperçu Google"
        description="À quoi ressemblera votre site dans les résultats de recherche"
      >
        <div className="rounded-2xl border border-border p-5 bg-bg-primary max-w-2xl">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-zinc-800 to-black flex items-center justify-center">
              <span className="font-heading text-white text-[10px] font-bold">
                {shopName?.charAt(0).toUpperCase() ?? "B"}
              </span>
            </div>
            <div>
              <div className="text-[13px] leading-tight" style={{ color: "#202124" }}>{shopName}</div>
              <div className="text-[11px]" style={{ color: "#5F6368" }}>https://beliandjolie.com</div>
            </div>
          </div>
          <div className="text-[18px] mt-1 leading-tight" style={{ color: "#1A0DAB" }}>
            {shopName} — Grossiste bijoux en acier inoxydable
          </div>
          <div className="text-[13px] mt-1" style={{ color: "#4D5156", lineHeight: 1.5 }}>
            {previewSnippet}
          </div>
        </div>
        <p className="text-[11.5px] text-text-muted font-body mt-3">
          L'aperçu est indicatif — Google peut choisir d'afficher d'autres extraits selon la recherche du visiteur.
        </p>
      </SettingCard>
    </CardsStack>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB : Messagerie — notifications mail non lus + reset mdp boîte pro
   ═══════════════════════════════════════════════════════════════════════════ */
async function MessagerieTab() {
  const [settings, persoState, smtpFromEmailRow, smtpUserRow] = await Promise.all([
    getMailNotifySettings(),
    getAdminPersonalEmailState(),
    prisma.siteConfig.findFirst({ where: { key: "smtp_from_email" }, select: { value: true } }),
    prisma.siteConfig.findFirst({ where: { key: "smtp_user" }, select: { value: true } }),
  ]);
  const { decryptIfSensitive } = await import("@/lib/encryption");
  const proEmail = smtpFromEmailRow?.value
    ? decryptIfSensitive("smtp_from_email", smtpFromEmailRow.value).trim() || null
    : null;
  const mailboxUser = smtpUserRow?.value
    ? decryptIfSensitive("smtp_user", smtpUserRow.value).trim() || null
    : null;

  const verifiedEmail = persoState.verifiedEmail;
  const verifiedAt = persoState.verifiedAt;

  return (
    <CardsStack>
      {verifiedEmail ? (
        <PersonalEmailCard verifiedEmail={verifiedEmail} verifiedAt={verifiedAt} />
      ) : (
        <SettingCard
          icon={Ico.bell}
          title="Adresse e-mail où recevoir"
          description="Vous n'avez pas encore vérifié d'adresse perso. Terminez le wizard d'accueil pour la configurer."
          accent="dark"
        >
          <Link
            href="/admin/bienvenue/email"
            className="inline-flex items-center rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2 transition"
          >
            Configurer maintenant
          </Link>
        </SettingCard>
      )}

      <SettingCard
        icon={Ico.bell}
        title="Notifications sur votre mail perso"
        description={
          proEmail
            ? `Envoyées depuis votre boîte pro ${proEmail}. Choisissez entre résumé périodique et transfert instantané.`
            : "Configurez d'abord votre boîte mail pro avant d'activer les notifications."
        }
        accent="dark"
      >
        <MailNotifyForm initialSettings={settings} />
      </SettingCard>

      <SettingCard
        icon={Ico.lock}
        title="Sécurité — mot de passe boîte pro"
        description="Réinitialisation protégée par un code de sécurité envoyé à votre adresse perso."
        accent="dark"
      >
        <MailboxPasswordResetCard persoEmail={verifiedEmail} mailboxUser={mailboxUser} />
      </SettingCard>
    </CardsStack>
  );
}
