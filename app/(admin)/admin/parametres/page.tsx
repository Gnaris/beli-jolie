import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import {
  getCachedShopName, getCachedHasAnkorstoreConfig, getCachedAnkorstoreEnabled,
  getCachedSiteConfig, getCachedPfsBrand, getCachedPfsEnabled,
  getCachedHasEfashionConfig, getCachedEfashionEnabled,
  getCachedHasFaireConfig, getCachedFaireEnabled,
  getCachedHasOrderchampConfig, getCachedOrderchampEnabled,
  getCachedFaireMadeInExcluded,
  getCachedHasMicrostoreConfig,
} from "@/lib/cached-data";
import { getStripeAccountInfo, getStripeConfigStatus } from "@/lib/stripe";
import { parseDisplayConfig } from "@/lib/product-display";
import { getStoredPictureStation } from "@/lib/microstore-picture-station";
import { resolveOpenTile, type TileStatus } from "@/lib/settings-tiles";
import type { BusinessHoursSchedule } from "@/lib/business-hours";
import { readMinOrderConfig } from "@/lib/min-order";
import SettingsDashboard, { type DashboardTile } from "@/components/admin/settings/SettingsDashboard";
import { CardsStack, SettingCard } from "@/components/admin/settings/SettingCard";

import SettingsMinOrderForm from "@/components/admin/settings/SettingsMinOrderForm";
import AdminPasswordResetButton from "@/components/admin/settings/AdminPasswordResetButton";
import MaintenanceModeToggle from "@/components/admin/settings/MaintenanceModeToggle";
import CatalogDisplayConfig from "@/components/admin/settings/CatalogDisplayConfig";
import RefreshWarningConfig from "@/components/admin/settings/RefreshWarningConfig";
import BrandedReferenceBadgeConfig from "@/components/admin/settings/BrandedReferenceBadgeConfig";
import HomeFaqConfig from "@/components/admin/settings/HomeFaqConfig";
import SettingsTabs from "@/components/admin/settings/SettingsTabs";
import StockDisplayConfig from "@/components/admin/settings/StockDisplayConfig";
import CompanyInfoForm from "@/components/admin/settings/CompanyInfoForm";
import BannerImageConfig from "@/components/admin/settings/BannerImageConfig";
import FaviconConfig from "@/components/admin/settings/FaviconConfig";
import EasyExpressApiKeyConfig from "@/components/admin/settings/EasyExpressApiKeyConfig";
import Smarty365ApiKeyConfig from "@/components/admin/settings/Smarty365ApiKeyConfig";
import ActiveShippingProviderSelect from "@/components/admin/settings/ActiveShippingProviderSelect";
import ShippingMarginConfig from "@/components/admin/settings/ShippingMarginConfig";
import StripeSettingsForm from "@/components/admin/settings/StripeSettingsForm";
import StripeAccountStatusCard from "@/components/admin/onboarding/StripeAccountStatusCard";
import BankTransferSettingsForm from "@/components/admin/settings/BankTransferSettingsForm";
import { getBankTransferConfigFresh } from "@/lib/bank-transfer-config";
import MarketplaceConfig from "@/components/admin/settings/MarketplaceConfig";
import AutoTranslateConfig from "@/components/admin/settings/AutoTranslateConfig";
import TranslationProviderStatus from "@/components/admin/settings/TranslationProviderStatus";
import BusinessHoursConfig from "@/components/admin/settings/BusinessHoursConfig";
import AnnouncementBannerConfig from "@/components/admin/settings/AnnouncementBannerConfig";
import SeoTextsConfig from "@/components/admin/settings/SeoTextsConfig";
import BrandBrandingConfig from "@/components/admin/settings/BrandBrandingConfig";
import { SEO_CONFIG_KEYS } from "@/lib/seo";
import HomeHeroConfig from "@/components/admin/settings/HomeHeroConfig";
import HeroOverlayConfig from "@/components/admin/settings/HeroOverlayConfig";
import { parseHeroOverlay } from "@/lib/hero-overlay";
import { parseHomeFaq } from "@/lib/home-faq";
import { getPendingReviewsCount } from "@/app/actions/admin/customer-reviews";
import AboutPageConfig from "@/components/admin/settings/AboutPageConfig";
import AboutPhotosConfig from "@/components/admin/settings/AboutPhotosConfig";
import MailForwardStatusCard from "@/components/admin/settings/MailForwardStatusCard";
import GmailSetupTutorialCard from "@/components/admin/settings/GmailSetupTutorialCard";
import MailboxPasswordResetCard from "@/components/admin/settings/MailboxPasswordResetCard";
import PersonalEmailCard from "@/components/admin/settings/PersonalEmailCard";
import AdminThemeToggle from "@/components/admin/settings/AdminThemeToggle";
import { getMailForwardStatus, getSmtpPublicConfig } from "@/app/actions/admin/mail-notify";
import { getAdminPersonalEmailState } from "@/app/actions/admin/admin-personal-email";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { requireCurrentTenant } from "@/lib/tenant";
import { cookies } from "next/headers";
import { ADMIN_THEME_COOKIE, parseAdminTheme } from "@/lib/admin-theme";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Paramètres — ${shopName} Admin` };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Icônes réutilisées dans les headers de cartes internes aux modales
   ═══════════════════════════════════════════════════════════════════════════ */
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
  tag:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13 21l-9-9V4h8l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>,
  moon:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>,
};

const nf = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE PRINCIPALE — dashboard 12 tuiles, une modale par clic
   ═══════════════════════════════════════════════════════════════════════════ */
export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const initialOpen = resolveOpenTile(sp);

  const tiles = await Promise.all([
    buildVitrineTile(),
    buildSocieteTile(),
    buildHorairesTile(),
    buildPaiementTile(),
    buildLivraisonTile(),
    buildReglesTile(),
    buildMarketplacesTile(),
    buildContenuTile(),
    buildMessagerieTile(),
    buildTraductionTile(),
    buildCompteTile(),
    buildMaintenanceTile(),
  ]);

  return <SettingsDashboard tiles={tiles} initialOpen={initialOpen} />;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 1 — Vitrine : bandeau annonces + bannière + favicon
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildVitrineTile(): Promise<DashboardTile> {
  const [
    bannerImageConfig,
    announcementConfig,
    faviconConfig,
    heroEyebrowRow,
    heroTitle1Row,
    heroTitle2Row,
    heroDescRow,
    heroCta2LabelRow,
    heroCta2HrefRow,
    homeFaqRow,
    aboutIntroRow,
    aboutHistoryRow,
    aboutShowroomRow,
    aboutTeamRow,
    aboutNewnessRow,
    aboutDeliveryRow,
    aboutPhoto1Row,
    aboutPhoto2Row,
    aboutPhoto3Row,
    aboutPhoto4Row,
    aboutPhoto5Row,
    aboutPhoto6Row,
    tAbout,
    pendingReviewsCount,
    heroOverlayTypeRow,
    heroOverlayDirectionRow,
    heroOverlayColorRow,
    heroOverlayOpacityRow,
  ] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "banner_image" } }),
    prisma.siteConfig.findFirst({ where: { key: "announcement_banner" } }),
    prisma.siteConfig.findFirst({ where: { key: "site_favicon" } }),
    prisma.siteConfig.findFirst({ where: { key: "home_hero_eyebrow" } }),
    prisma.siteConfig.findFirst({ where: { key: "home_hero_title_line1" } }),
    prisma.siteConfig.findFirst({ where: { key: "home_hero_title_line2" } }),
    prisma.siteConfig.findFirst({ where: { key: "home_hero_description" } }),
    prisma.siteConfig.findFirst({ where: { key: "home_hero_cta_secondary_label" } }),
    prisma.siteConfig.findFirst({ where: { key: "home_hero_cta_secondary_href" } }),
    prisma.siteConfig.findFirst({ where: { key: "home_faq" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_intro" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_history_body" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_showroom_body" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_team_body" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_newness_body" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_delivery_body" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_photo_1_url" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_photo_2_url" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_photo_3_url" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_photo_4_url" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_photo_5_url" } }),
    prisma.siteConfig.findFirst({ where: { key: "about_photo_6_url" } }),
    getTranslations("about"),
    getPendingReviewsCount().catch(() => 0),
    prisma.siteConfig.findFirst({ where: { key: "home_hero_overlay_type" } }),
    prisma.siteConfig.findFirst({ where: { key: "home_hero_overlay_direction" } }),
    prisma.siteConfig.findFirst({ where: { key: "home_hero_overlay_color" } }),
    prisma.siteConfig.findFirst({ where: { key: "home_hero_overlay_opacity" } }),
  ]);
  const heroOverlay = parseHeroOverlay({
    type: heroOverlayTypeRow?.value ?? null,
    direction: heroOverlayDirectionRow?.value ?? null,
    color: heroOverlayColorRow?.value ?? null,
    opacity: heroOverlayOpacityRow?.value ?? null,
  });
  const faqItems = parseHomeFaq(homeFaqRow?.value);
  const aboutPhotos: (string | null)[] = [
    aboutPhoto1Row?.value ?? null,
    aboutPhoto2Row?.value ?? null,
    aboutPhoto3Row?.value ?? null,
    aboutPhoto4Row?.value ?? null,
    aboutPhoto5Row?.value ?? null,
    aboutPhoto6Row?.value ?? null,
  ];

  let currentFavicon: { icon: string; appleIcon: string } | null = null;
  if (faviconConfig?.value) {
    try {
      const parsed = JSON.parse(faviconConfig.value);
      if (parsed && typeof parsed.icon === "string" && typeof parsed.appleIcon === "string") {
        currentFavicon = { icon: parsed.icon, appleIcon: parsed.appleIcon };
      }
    } catch { /* ignore */ }
  }

  let announcementMessages: string[] = [];
  let announcementBgColor = "#0F0F0F";
  let announcementTextColor = "#F5F1EA";
  let announcementSpeed = 8;
  let announcementMode: "scroll" | "static" = "scroll";
  if (announcementConfig?.value) {
    try {
      const parsed = JSON.parse(announcementConfig.value);
      announcementMessages = parsed.messages || [];
      announcementBgColor = parsed.bgColor || "#0F0F0F";
      announcementTextColor = parsed.textColor || "#F5F1EA";
      announcementSpeed = parsed.speed || 8;
      announcementMode = parsed.mode === "static" ? "static" : "scroll";
    } catch { /* ignore */ }
  }

  const bits: string[] = [];
  if (announcementMessages.length > 0) bits.push(`${announcementMessages.length} annonce${announcementMessages.length > 1 ? "s" : ""}`);
  if (bannerImageConfig?.value) bits.push("bannière définie");
  if (currentFavicon) bits.push("favicon en place");

  const anyConfigured = announcementMessages.length > 0 || !!bannerImageConfig?.value || !!currentFavicon;
  const status: TileStatus = anyConfigured
    ? { tone: "ok", label: bits.length === 3 ? "Complète" : "Partielle" }
    : { tone: "off", label: "À personnaliser" };

  return {
    key: "vitrine",
    status,
    summary: bits.join(" · ") || "Aucun élément personnalisé pour l'instant",
    content: (
      <SettingsTabs
        tabs={[
          {
            key: "general",
            label: "Général",
            content: (
              <CardsStack>
                <SettingCard
                  icon={Ico.favicon}
                  title="Icône du site (favicon)"
                  description="Petite image affichée dans l'onglet du navigateur et à côté du site dans les résultats Google"
                >
                  <FaviconConfig currentFavicon={currentFavicon} />
                </SettingCard>
              </CardsStack>
            ),
          },
          {
            key: "accueil",
            label: "Accueil",
            content: (
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
                    initialMode={announcementMode}
                  />
                </SettingCard>

                <SettingCard
                  icon={Ico.slides}
                  title="Bloc d'accueil (grand bandeau noir)"
                  description="Textes visibles tout en haut de la page d'accueil — surtitre, titre en 2 lignes, description et 2ᵉ bouton."
                  accent="dark"
                >
                  <HomeHeroConfig
                    initialEyebrow={heroEyebrowRow?.value ?? ""}
                    initialTitleLine1={heroTitle1Row?.value ?? ""}
                    initialTitleLine2={heroTitle2Row?.value ?? ""}
                    initialDescription={heroDescRow?.value ?? ""}
                    initialCtaSecondaryLabel={heroCta2LabelRow?.value ?? ""}
                    initialCtaSecondaryHref={heroCta2HrefRow?.value ?? ""}
                  />
                </SettingCard>

                <SettingCard
                  icon={Ico.image}
                  title="Bannière d'accueil"
                  description="Grande image en haut de la page d'accueil du site, avec un voile pour garder les textes lisibles."
                >
                  <div className="space-y-6">
                    <BannerImageConfig currentImage={bannerImageConfig?.value ?? null} />
                    <div className="border-t border-border pt-6">
                      <p className="text-sm font-heading font-semibold text-text-primary mb-1">
                        Voile posé sur la bannière
                      </p>
                      <p className="text-xs text-text-secondary font-body mb-4">
                        Réglez la couleur, le type d'ombre et l'intensité pour que vos titres restent bien lisibles par-dessus l'image.
                      </p>
                      <HeroOverlayConfig
                        initial={heroOverlay}
                        bannerImage={bannerImageConfig?.value ?? null}
                      />
                    </div>
                  </div>
                </SettingCard>

                <SettingCard
                  icon={Ico.slides}
                  title="Questions fréquentes (FAQ)"
                  description="Section « FAQ » en bas de la page d'accueil — jusqu'à 8 questions. Aussi injectée en JSON-LD (schema.org FAQPage) pour les rich results Google. Vide = section masquée."
                  accent="dark"
                  status={faqItems.length > 0
                    ? { tone: "ok", label: `${faqItems.length} question${faqItems.length > 1 ? "s" : ""}` }
                    : { tone: "off", label: "Aucune" }}
                >
                  <HomeFaqConfig initialItems={faqItems} />
                </SettingCard>

                <SettingCard
                  icon={Ico.slides}
                  title="Avis clients"
                  description="Les clients qui ont déjà commandé peuvent déposer un avis depuis leur espace pro. Vous les validez avant qu'ils apparaissent sur la page d'accueil."
                  accent="dark"
                  status={pendingReviewsCount > 0
                    ? { tone: "warn", label: `${pendingReviewsCount} à modérer` }
                    : { tone: "ok", label: "Tout est modéré" }}
                >
                  <div className="space-y-4">
                    <p className="text-sm font-body text-text-secondary leading-relaxed">
                      La modération se fait sur la page dédiée. Vous recevez également un mail sur votre boîte pro à chaque nouvel avis déposé.
                    </p>
                    <Link
                      href="/admin/avis"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-bg-dark text-white text-sm font-heading font-semibold hover:bg-bg-darker transition"
                    >
                      Ouvrir la modération des avis
                      {pendingReviewsCount > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-amber-400 text-slate-900 text-[10px] font-bold tabular-nums">
                          {pendingReviewsCount}
                        </span>
                      )}
                    </Link>
                  </div>
                </SettingCard>
              </CardsStack>
            ),
          },
          {
            key: "about",
            label: "Qui sommes-nous",
            content: (
              <CardsStack>
                <SettingCard
                  icon={Ico.slides}
                  title="Textes de la page « Qui sommes-nous »"
                  description="6 sections éditables affichées sur /a-propos — laissez vide pour utiliser le texte par défaut."
                  accent="dark"
                >
                  <AboutPageConfig
                    initialIntro={aboutIntroRow?.value ?? ""}
                    initialHistoryBody={aboutHistoryRow?.value ?? ""}
                    initialShowroomBody={aboutShowroomRow?.value ?? ""}
                    initialTeamBody={aboutTeamRow?.value ?? ""}
                    initialNewnessBody={aboutNewnessRow?.value ?? ""}
                    initialDeliveryBody={aboutDeliveryRow?.value ?? ""}
                    placeholders={{
                      intro: tAbout("intro"),
                      historyBody: tAbout("historyBody"),
                      showroomBody: tAbout("showroomBody"),
                      teamBody: tAbout("teamBody"),
                      newnessBody: tAbout("newnessBody"),
                      deliveryBody: tAbout("deliveryBody"),
                    }}
                  />
                </SettingCard>

                <SettingCard
                  icon={Ico.image}
                  title="Photos de la page « Qui sommes-nous »"
                  description="Jusqu'à 6 photos — largeur idéale 1200 px, format 4/5 conseillé."
                  accent="dark"
                >
                  <AboutPhotosConfig initialPhotos={aboutPhotos} />
                </SettingCard>
              </CardsStack>
            ),
          },
        ]}
      />
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 2 — Société & mentions
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildSocieteTile(): Promise<DashboardTile> {
  const [companyInfo, smtpFromEmailRow] = await Promise.all([
    prisma.companyInfo.findFirst(),
    prisma.siteConfig.findFirst({ where: { key: "smtp_from_email" }, select: { value: true } }),
  ]);
  const { decryptIfSensitive } = await import("@/lib/encryption");
  const proEmail = smtpFromEmailRow?.value
    ? decryptIfSensitive("smtp_from_email", smtpFromEmailRow.value).trim() || null
    : null;

  const requiredKeys: (keyof NonNullable<typeof companyInfo>)[] = ["name", "siret", "address", "city", "postalCode"];
  const missing = companyInfo ? requiredKeys.filter((k) => !companyInfo[k]).length : requiredKeys.length;
  const status: TileStatus = !companyInfo
    ? { tone: "off", label: "À configurer" }
    : missing > 0
      ? { tone: "warn", label: `${missing} champ${missing > 1 ? "s" : ""} manquant${missing > 1 ? "s" : ""}` }
      : { tone: "ok", label: "Complet" };

  const summaryBits: string[] = [];
  if (companyInfo?.name) summaryBits.push(companyInfo.name);
  if (companyInfo?.city) summaryBits.push(companyInfo.city);

  return {
    key: "societe",
    status,
    summary: summaryBits.join(" · ") || "Aucune info renseignée",
    content: (
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
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 3 — Horaires
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildHorairesTile(): Promise<DashboardTile> {
  const row = await prisma.siteConfig.findFirst({ where: { key: "business_hours" } });
  let schedule: BusinessHoursSchedule | null = null;
  if (row?.value) {
    try { schedule = JSON.parse(row.value) as BusinessHoursSchedule; } catch { /* ignore */ }
  }

  const status: TileStatus = schedule
    ? { tone: "ok", label: "Défini" }
    : { tone: "off", label: "Non défini" };

  return {
    key: "horaires",
    status,
    summary: schedule ? "Horaires publiés sur la page contact" : "Aucun horaire renseigné",
    content: (
      <SettingCard
        icon={Ico.clock}
        title="Horaires d'ouverture"
        description="Jours et heures d'ouverture affichés sur la page contact"
        accent="dark"
      >
        <BusinessHoursConfig initialSchedule={schedule} />
      </SettingCard>
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 4 — Paiement Stripe
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildPaiementTile(): Promise<DashboardTile> {
  const [status, publishableRow, accountInfo, bankTransfer] = await Promise.all([
    getStripeConfigStatus(),
    prisma.siteConfig.findFirst({ where: { key: "stripe_publishable_key" } }),
    getStripeAccountInfo(),
    getBankTransferConfigFresh(),
  ]);
  const publishable = publishableRow?.value?.trim() || "";

  const tileStatus: TileStatus = status.ready
    ? { tone: "ok", label: status.testMode ? "Mode TEST" : "Mode LIVE" }
    : { tone: "off", label: "Non configuré" };

  const paymentModesLabel: string[] = [];
  if (status.ready) paymentModesLabel.push(status.testMode ? "Carte (TEST)" : "Carte");
  if (bankTransfer.enabled) paymentModesLabel.push("Virement");
  const summary = paymentModesLabel.length > 0
    ? paymentModesLabel.join(" · ")
    : "Renseignez les 3 clés Stripe pour encaisser";

  return {
    key: "paiement",
    status: tileStatus,
    summary,
    content: (
      <CardsStack>
        <StripeAccountStatusCard info={accountInfo} />
        <SettingCard
          icon={Ico.card}
          title="Stripe"
          description="Les 3 clés Stripe nécessaires pour encaisser les paiements en ligne. Modifiez-les à tout moment — les valeurs sensibles sont chiffrées en base."
          accent="dark"
          status={status.ready
            ? { tone: "ok", label: status.testMode ? "Mode TEST" : "Mode LIVE" }
            : { tone: "off", label: "Non configuré" }}
        >
          <StripeSettingsForm
            initialHasSecret={status.hasSecret}
            initialHasWebhook={status.hasWebhook}
            initialPublishable={publishable}
          />
        </SettingCard>
        <SettingCard
          icon={Ico.card}
          title="Virement bancaire"
          description="Proposez le virement comme alternative à la carte au checkout. Vous recevrez chaque commande en « En attente de paiement » — cliquez « Marquer virement reçu » depuis la fiche commande une fois le virement crédité sur votre banque."
          accent="dark"
          status={bankTransfer.enabled
            ? { tone: "ok", label: "Activé" }
            : { tone: "off", label: "Désactivé" }}
        >
          <BankTransferSettingsForm
            initialEnabled={bankTransfer.enabled}
            initialHolder={bankTransfer.holder}
            initialIban={bankTransfer.iban}
          />
        </SettingCard>
      </CardsStack>
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 5 — Mode de livraison (Easy-Express + Smarty365) + marge
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildLivraisonTile(): Promise<DashboardTile> {
  const [eeApiKeyConfig, smartyApiKeyConfig, activeProviderRow, marginTypeRow, marginValueRow] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "easy_express_api_key" }, select: { key: true } }),
    prisma.siteConfig.findFirst({ where: { key: "smarty365_api_key" }, select: { key: true } }),
    prisma.siteConfig.findFirst({ where: { key: "active_shipping_provider" }, select: { value: true } }),
    prisma.siteConfig.findFirst({ where: { key: "shipping_margin_type" } }),
    prisma.siteConfig.findFirst({ where: { key: "shipping_margin_value" } }),
  ]);
  const marginType = (marginTypeRow?.value as "fixed" | "percent") || "fixed";
  const marginValue = Number(marginValueRow?.value) || 0;
  const eeConnected = !!eeApiKeyConfig;
  const smartyConnected = !!smartyApiKeyConfig;
  const activeProvider: "easy_express" | "smarty365" =
    activeProviderRow?.value === "smarty365" ? "smarty365" : "easy_express";
  const anyConnected = eeConnected || smartyConnected;
  const providerLabel = activeProvider === "smarty365" ? "Smarty365" : "Easy-Express";

  const tileStatus: TileStatus = anyConnected
    ? { tone: "ok", label: `Actif : ${providerLabel}` }
    : { tone: "off", label: "Non configurée" };

  const marginLabel = marginType === "percent" ? `+${marginValue} %` : `+${nf.format(marginValue)} €`;
  const summary = anyConnected
    ? `${providerLabel} actif · Marge ${marginLabel}`
    : "Aucun fournisseur configuré";

  return {
    key: "livraison",
    status: tileStatus,
    summary,
    content: (
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
          icon={Ico.truck}
          title="Smarty365"
          description="Fournisseur alternatif — utilise vos contrats négociés en direct (Colissimo, Chronopost, Mondial Relay, GLS, GPX)"
          status={smartyConnected ? { tone: "ok", label: "Connectée" } : { tone: "off", label: "Non configurée" }}
        >
          <Smarty365ApiKeyConfig hasKey={smartyConnected} />
        </SettingCard>

        <SettingCard
          icon={Ico.truck}
          title="Fournisseur actif"
          description="Choisissez lequel des deux propose ses tarifs aux clientes et génère les bordereaux par défaut"
          accent="dark"
          status={{ tone: "ok", label: providerLabel }}
        >
          <ActiveShippingProviderSelect
            initialProvider={activeProvider}
            hasEasyExpressKey={eeConnected}
            hasSmarty365Key={smartyConnected}
          />
        </SettingCard>

        <SettingCard
          icon={Ico.margin}
          title="Marge sur les frais de port"
          description="Différence entre le coût réel du fournisseur et le prix facturé au client"
        >
          <ShippingMarginConfig initialType={marginType} initialValue={marginValue} />

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
                  + Marge {marginType === "percent" ? `${marginValue} %` : `${nf.format(marginValue)} €`}
                </span>
                <span className="tabular-nums font-semibold">
                  +{nf.format(marginType === "percent" ? 6.80 * (marginValue / 100) : marginValue)} €
                </span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-border">
                <span className="font-semibold">Facturé au client</span>
                <span className="tabular-nums font-heading font-bold text-base">
                  {nf.format(6.80 + (marginType === "percent" ? 6.80 * (marginValue / 100) : marginValue))} €
                </span>
              </div>
            </div>
          </div>
        </SettingCard>
      </CardsStack>
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 6 — Règles de vente (commande mini + stock + catalogue + badge + garde-fou)
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildReglesTile(): Promise<DashboardTile> {
  const [minOrderConfig, stockVariantsConfig, displayConfigRow, categories, dbCollections, dbTags, refreshWarnEnabledRow, refreshWarnDaysRow, brandedBadgeRow] = await Promise.all([
    readMinOrderConfig(),
    prisma.siteConfig.findFirst({ where: { key: "show_out_of_stock_variants" } }),
    prisma.siteConfig.findFirst({ where: { key: "product_display_config" } }),
    prisma.category.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.collection.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.siteConfig.findFirst({ where: { key: "refresh_warning_enabled" } }),
    prisma.siteConfig.findFirst({ where: { key: "refresh_warning_days" } }),
    prisma.siteConfig.findFirst({ where: { key: "branded_reference_badge_enabled" } }),
  ]);

  const showOutOfStockVariants = stockVariantsConfig?.value !== "false";
  const displayConfig = parseDisplayConfig(displayConfigRow?.value ?? null);
  const refreshWarnEnabled = refreshWarnEnabledRow?.value === "true";
  const parsedRefreshDays = refreshWarnDaysRow ? parseInt(refreshWarnDaysRow.value, 10) : NaN;
  const refreshWarnDays = Number.isFinite(parsedRefreshDays) && parsedRefreshDays > 0 ? parsedRefreshDays : 7;
  const brandedBadgeEnabled = brandedBadgeRow?.value === "true";

  const minOrderSummary = (() => {
    switch (minOrderConfig.mode) {
      case "none":
        return "Aucun minimum";
      case "all":
        return `Min ${nf.format(minOrderConfig.valueAll)} € HT`;
      case "first_only":
        return `Min 1ʳᵉ commande ${nf.format(minOrderConfig.valueFirst)} € HT`;
      case "first_then_rest":
        return `1ʳᵉ ${nf.format(minOrderConfig.valueFirst)} € · suivantes ${nf.format(minOrderConfig.valueRest)} € HT`;
    }
  })();

  const status: TileStatus = { tone: "ok", label: "Actives" };
  const summary = `${minOrderSummary} · Ruptures ${showOutOfStockVariants ? "visibles" : "masquées"}`;

  return {
    key: "regles",
    status,
    summary,
    content: (
      <CardsStack>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <SettingCard
            icon={Ico.minOrder}
            title="Commande minimum"
            description="Choisissez si un montant minimum s'applique à toutes les commandes, à la 1ʳᵉ seulement, ou différemment pour la 1ʳᵉ et les suivantes"
            accent="dark"
          >
            <SettingsMinOrderForm initialConfig={minOrderConfig} />
          </SettingCard>

          <SettingCard
            icon={Ico.box}
            title="Ruptures de stock côté client"
            description="Choisissez si les variantes vides restent visibles ou disparaissent de la fiche"
            accent="dark"
          >
            <StockDisplayConfig showOutOfStockVariants={showOutOfStockVariants} />
          </SettingCard>
        </div>

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
          icon={Ico.tag}
          title="Marquer la référence sur la 1ʳᵉ image"
          description="Ajoute automatiquement un badge « Réf » en haut à droite de la 1ère photo — PFS et eFashion uniquement"
        >
          <BrandedReferenceBadgeConfig initialEnabled={brandedBadgeEnabled} />
        </SettingCard>

        <SettingCard
          icon={Ico.refresh}
          title="Garde-fou rafraîchissement"
          description="Évite de rafraîchir un produit qui vient déjà d'être mis en avant récemment"
        >
          <RefreshWarningConfig initialEnabled={refreshWarnEnabled} initialDays={refreshWarnDays} />
        </SettingCard>
      </CardsStack>
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 7 — Marketplaces (grande tuile)
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildMarketplacesTile(): Promise<DashboardTile> {
  const [
    pfsConfig, markupRows, pfsBrand, pfsEnabled,
    hasAnkorstoreConfig, ankorstoreEnabled,
    ankorstoreWholesaleType, ankorstoreWholesaleValue, ankorstoreWholesaleRounding,
    ankorstoreRetailType, ankorstoreRetailValue, ankorstoreRetailRounding,
    ankorstoreVatRateRaw,
    hasEfashionConfig, efashionEnabled,
    efashionMarkupType, efashionMarkupValue, efashionMarkupRounding,
    microstoreMarkupType, microstoreMarkupValue, microstoreMarkupRounding,
    hasMicrostoreConfig, microstoreEnabledRow, microstoreExpiresRow,
    microstorePictureStation,
    hasFaireConfig, faireEnabled,
    faireWholesaleType, faireWholesaleValue, faireWholesaleRounding,
    faireRetailType, faireRetailValue, faireRetailRounding,
    faireMadeInExcluded,
    hasOrderchampConfig, orderchampEnabled,
    orderchampWholesaleType, orderchampWholesaleValue, orderchampWholesaleRounding,
    orderchampRetailType, orderchampRetailValue, orderchampRetailRounding,
    pfsPublished, pfsToSync, pfsLast,
    ankPublished, ankToSync, ankLast,
    efaPublished, efaToSync, efaLast,
    faiPublished, faiToSync, faiLast,
    ocPublished, ocToSync, ocLast,
    ordersEnabledRows,
  ] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "pfs_email" }, select: { key: true } }),
    prisma.siteConfig.findMany({
      where: { key: { in: ["pfs_price_markup_type", "pfs_price_markup_value", "pfs_price_markup_rounding"] } },
    }),
    getCachedPfsBrand(),
    getCachedPfsEnabled(),
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
    getCachedHasMicrostoreConfig(),
    prisma.siteConfig.findFirst({ where: { key: "microstore_products_management_enabled" }, select: { value: true } }),
    prisma.siteConfig.findFirst({ where: { key: "microstore_expires_at" }, select: { value: true } }),
    getStoredPictureStation(),
    getCachedHasFaireConfig(),
    getCachedFaireEnabled(),
    getCachedSiteConfig("faire_wholesale_markup_type"),
    getCachedSiteConfig("faire_wholesale_markup_value"),
    getCachedSiteConfig("faire_wholesale_markup_rounding"),
    getCachedSiteConfig("faire_retail_markup_type"),
    getCachedSiteConfig("faire_retail_markup_value"),
    getCachedSiteConfig("faire_retail_markup_rounding"),
    getCachedFaireMadeInExcluded(),
    getCachedHasOrderchampConfig(),
    getCachedOrderchampEnabled(),
    getCachedSiteConfig("orderchamp_wholesale_markup_type"),
    getCachedSiteConfig("orderchamp_wholesale_markup_value"),
    getCachedSiteConfig("orderchamp_wholesale_markup_rounding"),
    getCachedSiteConfig("orderchamp_retail_markup_type"),
    getCachedSiteConfig("orderchamp_retail_markup_value"),
    getCachedSiteConfig("orderchamp_retail_markup_rounding"),
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
    prisma.product.count({ where: { orderchampProductId: { not: null } } }),
    prisma.product.count({ where: { orderchampSyncRequired: true } }),
    prisma.product.findFirst({ where: { orderchampProductId: { not: null } }, orderBy: { orderchampLastRefreshedAt: "desc" }, select: { orderchampLastRefreshedAt: true } }),
    prisma.siteConfig.findMany({
      where: { key: { in: ["pfs_orders_worker_enabled", "ankorstore_orders_worker_enabled", "efashion_orders_worker_enabled", "faire_orders_worker_enabled", "orderchamp_orders_worker_enabled", "microstore_orders_worker_enabled"] } },
      select: { key: true, value: true },
    }),
  ]);

  const ordersEnabledMap = new Map(ordersEnabledRows.map((r) => [r.key, r.value]));
  const readOrdersEnabled = (key: string) => (ordersEnabledMap.get(key) ?? "true") !== "false";
  const pfsOrdersEnabled = readOrdersEnabled("pfs_orders_worker_enabled");
  const ankorstoreOrdersEnabled = readOrdersEnabled("ankorstore_orders_worker_enabled");
  const efashionOrdersEnabled = readOrdersEnabled("efashion_orders_worker_enabled");
  const faireOrdersEnabled = readOrdersEnabled("faire_orders_worker_enabled");
  const orderchampOrdersEnabled = readOrdersEnabled("orderchamp_orders_worker_enabled");
  const microstoreOrdersEnabled = readOrdersEnabled("microstore_orders_worker_enabled");

  const markupMap = new Map(markupRows.map((r) => [r.key, r.value]));

  const microstoreEnabled = microstoreEnabledRow?.value !== "false";
  const microstoreExpiresSec = microstoreExpiresRow?.value ? Number(microstoreExpiresRow.value) : null;
  const microstoreExpiresAtIso =
    microstoreExpiresSec && Number.isFinite(microstoreExpiresSec)
      ? new Date(microstoreExpiresSec * 1000).toISOString()
      : null;

  const connected = [!!pfsConfig, hasAnkorstoreConfig, hasEfashionConfig, hasFaireConfig, hasMicrostoreConfig].filter(Boolean).length;
  const tileStatus: TileStatus = connected === 0
    ? { tone: "off", label: "Aucun connecté" }
    : connected < 5
      ? { tone: "warn", label: `${connected} / 5 connectés` }
      : { tone: "ok", label: "5 / 5 connectés" };

  const stats = {
    pfs:        { published: pfsPublished, toSync: pfsToSync, lastSyncAt: pfsLast?.updatedAt?.toISOString() ?? null },
    ankorstore: { published: ankPublished, toSync: ankToSync, lastSyncAt: ankLast?.ankorsLastRefreshedAt?.toISOString() ?? null },
    efashion:   { published: efaPublished, toSync: efaToSync, lastSyncAt: efaLast?.efashionLastRefreshedAt?.toISOString() ?? null },
    faire:      { published: faiPublished, toSync: faiToSync, lastSyncAt: faiLast?.faireLastRefreshedAt?.toISOString() ?? null },
    orderchamp: { published: ocPublished, toSync: ocToSync, lastSyncAt: ocLast?.orderchampLastRefreshedAt?.toISOString() ?? null },
  };

  return {
    key: "marketplaces",
    status: tileStatus,
    summary: `PFS · Ankor · eFashion · Faire · Microstore — ${connected} connecté${connected > 1 ? "s" : ""}`,
    content: (
      <MarketplaceConfig
        hasPfsConfig={!!pfsConfig}
        pfsEnabled={pfsEnabled}
        pfsOrdersEnabled={pfsOrdersEnabled}
        pfsBrand={pfsBrand}
        hasAnkorstoreConfig={hasAnkorstoreConfig}
        ankorstoreEnabled={ankorstoreEnabled}
        ankorstoreOrdersEnabled={ankorstoreOrdersEnabled}
        hasEfashionConfig={hasEfashionConfig}
        efashionEnabled={efashionEnabled}
        efashionOrdersEnabled={efashionOrdersEnabled}
        hasFaireConfig={hasFaireConfig}
        faireEnabled={faireEnabled}
        faireOrdersEnabled={faireOrdersEnabled}
        faireMadeInExcluded={faireMadeInExcluded}
        hasOrderchampConfig={hasOrderchampConfig}
        orderchampEnabled={orderchampEnabled}
        orderchampOrdersEnabled={orderchampOrdersEnabled}
        hasMicrostoreConfig={hasMicrostoreConfig}
        microstoreEnabled={microstoreEnabled}
        microstoreOrdersEnabled={microstoreOrdersEnabled}
        microstoreExpiresAtIso={microstoreExpiresAtIso}
        microstorePictureStation={
          microstorePictureStation
            ? {
                configured: true,
                expiresAtIso: microstorePictureStation.expiresAt.toISOString(),
                shortUrl: microstorePictureStation.shortUrl,
              }
            : { configured: false, expiresAtIso: null, shortUrl: null }
        }
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
          orderchampWholesale: {
            type: (orderchampWholesaleType?.value as "percent" | "fixed" | "multiplier") || "percent",
            value: Number(orderchampWholesaleValue?.value) || 0,
            rounding: (orderchampWholesaleRounding?.value as "none" | "down" | "up") || "none",
          },
          orderchampRetail: {
            type: (orderchampRetailType?.value as "percent" | "fixed" | "multiplier") || "multiplier",
            value: Number(orderchampRetailValue?.value) || 2.5,
            rounding: (orderchampRetailRounding?.value as "none" | "down" | "up") || "up",
          },
        }}
      />
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 8 — Contenu & Google (carrousels + SEO)
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildContenuTile(): Promise<DashboardTile> {
  const { getSiteUrl } = await import("@/lib/seo");
  const brandingKeys = [SEO_CONFIG_KEYS.logo, SEO_CONFIG_KEYS.ogImage, ...SEO_CONFIG_KEYS.socials];
  const [
    homeRow,
    produitsRow,
    produitsIntroRow,
    taglineRow,
    shopName,
    siteUrl,
    brandingRows,
  ] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "home_seo_text" } }),
    prisma.siteConfig.findFirst({ where: { key: "produits_seo_text" } }),
    prisma.siteConfig.findFirst({ where: { key: "produits_seo_intro" } }),
    prisma.siteConfig.findFirst({ where: { key: "seo_tagline" } }),
    getCachedShopName(),
    getSiteUrl(),
    prisma.siteConfig.findMany({
      where: { key: { in: brandingKeys } },
      select: { key: true, value: true },
    }),
  ]);
  const brandingMap = new Map(brandingRows.map((r) => [r.key, r.value ?? ""]));
  const initialSocials: Record<string, string> = {};
  for (const k of SEO_CONFIG_KEYS.socials) {
    const v = brandingMap.get(k);
    if (v) initialSocials[k] = v;
  }

  const homeText = homeRow?.value?.trim() ?? "";
  const tagline = taglineRow?.value?.trim() || "Grossiste B2B";
  const previewSnippet = homeText
    ? (homeText.length > 160 ? homeText.slice(0, 158).trimEnd() + "…" : homeText)
    : "Ajoutez un texte SEO pour la page d'accueil ci-dessus — il apparaîtra dans les résultats Google.";
  const displayUrl = siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

  const seoConfigured = !!(homeText || produitsRow?.value?.trim());
  const summaryBits: string[] = [];
  summaryBits.push(seoConfigured ? "SEO en place" : "SEO vide");

  const status: TileStatus = seoConfigured
    ? { tone: "ok", label: "Configurés" }
    : { tone: "warn", label: "À compléter" };

  return {
    key: "contenu",
    status,
    summary: summaryBits.join(" · "),
    content: (
      <CardsStack>
        <SettingCard
          icon={Ico.search}
          title="Textes pour Google"
          description="Baseline courte + paragraphes affichés en bas de la page d'accueil et de /produits — ils aident Google à mieux référencer le site."
          accent="dark"
        >
          <SeoTextsConfig
            initialHomeText={homeRow?.value ?? ""}
            initialProduitsText={produitsRow?.value ?? ""}
            initialProduitsIntroText={produitsIntroRow?.value ?? ""}
            initialTagline={taglineRow?.value ?? ""}
          />
        </SettingCard>

        <SettingCard
          icon={Ico.image}
          title="Logo & réseaux sociaux"
          description="Logo de marque envoyé à Google (vignette dans les résultats) + comptes officiels affichés sous votre fiche marque."
        >
          <BrandBrandingConfig
            initialLogoUrl={brandingMap.get(SEO_CONFIG_KEYS.logo) ?? ""}
            initialOgImageUrl={brandingMap.get(SEO_CONFIG_KEYS.ogImage) ?? ""}
            initialSocials={initialSocials}
          />
        </SettingCard>

        <SettingCard
          icon={Ico.search}
          title="Aperçu Google"
          description="À quoi ressemblera votre site dans les résultats de recherche"
        >
          <div
            className="rounded-2xl p-5 max-w-2xl"
            style={{ backgroundColor: "#ffffff", border: "1px solid #dadce0" }}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-zinc-800 to-black flex items-center justify-center">
                <span className="font-heading text-white text-[10px] font-bold">
                  {shopName?.charAt(0).toUpperCase() ?? "B"}
                </span>
              </div>
              <div>
                <div className="text-[13px] leading-tight" style={{ color: "#202124" }}>{shopName}</div>
                <div className="text-[11px]" style={{ color: "#5F6368" }}>{displayUrl}</div>
              </div>
            </div>
            <div className="text-[18px] mt-1 leading-tight" style={{ color: "#1A0DAB" }}>
              {shopName} — {tagline}
            </div>
            <div className="text-[13px] mt-1" style={{ color: "#4D5156", lineHeight: 1.5 }}>
              {previewSnippet}
            </div>
          </div>
          <p className="text-[11.5px] text-text-muted font-body mt-3">
            L&apos;aperçu est indicatif — Google peut choisir d&apos;afficher d&apos;autres extraits selon la recherche du visiteur.
          </p>
        </SettingCard>
      </CardsStack>
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 9 — Messagerie
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildMessagerieTile(): Promise<DashboardTile> {
  const [forwardStatus, smtpPublic, persoState] = await Promise.all([
    getMailForwardStatus(),
    getSmtpPublicConfig(),
    getAdminPersonalEmailState(),
  ]);

  const verifiedEmail = persoState.verifiedEmail;
  const verifiedAt = persoState.verifiedAt;

  const status: TileStatus = verifiedEmail
    ? { tone: "ok", label: "Transfert actif" }
    : { tone: "warn", label: "Perso non vérifiée" };

  const summary = verifiedEmail
    ? `${smtpPublic.fromEmail ?? "boîte pro"} → ${verifiedEmail}`
    : "Ajoutez votre adresse perso pour recevoir vos mails pro";

  return {
    key: "messagerie",
    status,
    summary,
    content: (
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
            <a
              href="/admin/bienvenue/email"
              className="inline-flex items-center rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2 transition"
            >
              Configurer maintenant
            </a>
          </SettingCard>
        )}

        <SettingCard
          icon={Ico.bell}
          title="Où vos mails pro arrivent"
          description="Chaque mail reçu sur la boîte pro est transféré instantanément dans votre boîte perso."
          accent="dark"
        >
          <MailForwardStatusCard status={forwardStatus} />
        </SettingCard>

        <SettingCard
          icon={Ico.card}
          title="Envoyer depuis Gmail comme votre adresse pro"
          description="Configurez Gmail une seule fois pour que vos réponses partent depuis votre adresse pro, pas depuis votre Gmail perso."
          accent="dark"
        >
          <GmailSetupTutorialCard
            smtpHost={smtpPublic.host || "mail.beliandjolie.com"}
            smtpPort={smtpPublic.port}
            smtpUser={smtpPublic.user}
            proEmail={smtpPublic.fromEmail}
            shopName={smtpPublic.shopName}
          />
        </SettingCard>

        <SettingCard
          icon={Ico.lock}
          title="Sécurité — mot de passe boîte pro"
          description="C'est ce mot de passe qui vous sera demandé par Gmail à l'étape 2 du tutoriel. Réinitialisation protégée par un code envoyé à votre adresse perso."
          accent="dark"
        >
          <MailboxPasswordResetCard persoEmail={verifiedEmail} mailboxUser={smtpPublic.user || null} />
        </SettingCard>
      </CardsStack>
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 10 — Traduction automatique
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildTraductionTile(): Promise<DashboardTile> {
  const [pfsEmailRow, autoTranslateConfig] = await Promise.all([
    prisma.siteConfig.findFirst({ where: { key: "pfs_email" }, select: { key: true } }),
    prisma.siteConfig.findFirst({ where: { key: "auto_translate_enabled" }, select: { value: true } }),
  ]);

  const hasPfs = !!pfsEmailRow;
  const autoTranslateEnabled = autoTranslateConfig?.value === "true";

  const status: TileStatus = !hasPfs
    ? { tone: "off", label: "PFS requis" }
    : autoTranslateEnabled
      ? { tone: "ok", label: "Actif via PFS" }
      : { tone: "warn", label: "PFS OK · toggle éteint" };

  const summary = hasPfs
    ? (autoTranslateEnabled ? "Traduction FR → EN automatique" : "Compte PFS OK — activez le toggle pour lancer")
    : "Connectez PFS d'abord dans Marketplaces";

  return {
    key: "traduction",
    status,
    summary,
    content: (
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
            <AutoTranslateConfig enabled={autoTranslateEnabled} />

            <div className="mt-5 rounded-2xl border border-border bg-bg-secondary/40 p-4">
              <p className="text-[10px] font-body font-bold uppercase tracking-[0.14em] text-text-muted mb-3">
                Aperçu d&apos;une traduction
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
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 11 — Compte admin (mot de passe + thème)
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildCompteTile(): Promise<DashboardTile> {
  const store = await cookies();
  const currentTheme = parseAdminTheme(store.get(ADMIN_THEME_COOKIE)?.value ?? null);

  const status: TileStatus = { tone: "ok", label: currentTheme === "dark" ? "Sombre" : "Clair" };

  return {
    key: "compte",
    status,
    summary: `Thème ${currentTheme === "dark" ? "sombre" : "clair"} · Mot de passe protégé`,
    content: (
      <CardsStack>
        <SettingCard
          icon={Ico.lock}
          title="Mot de passe admin"
          description="Recevez un email pour le réinitialiser en toute sécurité"
          accent="dark"
        >
          <AdminPasswordResetButton />
        </SettingCard>

        <SettingCard
          icon={Ico.moon}
          title="Mode d'affichage"
          description="Bascule l'interface d'administration entre un fond clair ou un fond sombre. Uniquement pour vous — la boutique publique reste inchangée."
          accent="dark"
          status={currentTheme === "dark"
            ? { tone: "ok", label: "Sombre" }
            : { tone: "off", label: "Clair" }}
        >
          <AdminThemeToggle initialTheme={currentTheme} />
        </SettingCard>
      </CardsStack>
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TUILE 12 — Maintenance
   ═══════════════════════════════════════════════════════════════════════════ */
async function buildMaintenanceTile(): Promise<DashboardTile> {
  const maintenanceConfig = await prisma.siteConfig.findFirst({ where: { key: "maintenance_mode" } });
  const maintenanceValue = maintenanceConfig?.value ?? "false";
  const inMaintenance = maintenanceValue === "true" || maintenanceValue === "auto";
  const isAutoMaintenance = maintenanceValue === "auto";

  const status: TileStatus = isAutoMaintenance
    ? { tone: "danger", label: "Automatique" }
    : inMaintenance
      ? { tone: "warn", label: "Actif" }
      : { tone: "ok", label: "Site en ligne" };

  const summary = isAutoMaintenance
    ? "Maintenance déclenchée par une erreur critique"
    : inMaintenance
      ? "Site inaccessible aux clients"
      : "3 modes possibles (off / auto / on)";

  return {
    key: "maintenance",
    status,
    summary,
    content: (
      <SettingCard
        icon={Ico.warning}
        title="Mode maintenance"
        description="Bloque temporairement l'accès à votre boutique. 3 modes possibles."
        accent="dark"
        status={status.tone === "danger"
          ? { tone: "danger", label: "Automatique" }
          : status.tone === "warn"
            ? { tone: "warn", label: "Actif" }
            : { tone: "ok", label: "Site en ligne" }}
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
    ),
  };
}
