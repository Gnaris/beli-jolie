import React from "react";
import { headers, cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ADMIN_THEME_COOKIE, parseAdminTheme, adminThemeBodyClass } from "@/lib/admin-theme";
import { getCachedShopName } from "@/lib/cached-data";
import { fetchAdminWarnings } from "@/lib/admin-warnings";
import { isOnboardingCompleted } from "@/lib/onboarding";
import type { Metadata } from "next";
import AdminShellsLive from "@/components/admin/AdminShellsLive";
import { LiveAdminWarningsProvider } from "@/components/admin/LiveAdminWarningsProvider";
import AdminHtmlThemeSync from "@/components/admin/AdminHtmlThemeSync";

import { DeeplConfigProvider } from "@/components/admin/DeeplConfigContext";
import AdminChatWidgetLoader from "@/components/admin/AdminChatWidgetLoader";
import { MarketplaceRefreshProvider } from "@/components/admin/products/MarketplaceRefreshContext";
import { MappingImpactProvider } from "@/components/admin/mapping/MappingImpactContext";
import { MarketplaceLinkProvider } from "@/components/admin/products/MarketplaceLinkContext";
import { MicrostoreBulkPushProvider } from "@/components/admin/products/MicrostoreBulkPushContext";
import { EfashionShootingBatchProvider } from "@/components/admin/products/EfashionShootingBatchContext";
import { RefreshWarningProvider } from "@/components/admin/products/RecentlyRefreshedWarningModal";
import { IneligibleRefreshProvider } from "@/components/admin/products/IneligibleRefreshModal";
import { RefreshMarketplacePromptProvider } from "@/components/admin/products/RefreshMarketplaceDialog";
import { PfsAuditActiveProvider } from "@/components/admin/products/PfsAuditActiveContext";
import { AdminWidgetsRail } from "@/components/admin/widgets-rail";
import { getCachedSiteConfig, getCachedPfsCredentials } from "@/lib/cached-data";
import { getMicrostoreSessionExpirations } from "@/lib/microstore-session-status";
import MicrostoreSessionAlerts from "@/components/admin/MicrostoreSessionAlerts";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/fr/connexion");

  // Onboarding wizard : redirection auto vers /admin/bienvenue pour les nouvelles
  // boutiques (SiteConfig.onboarding_completed_at absent). Beli & Jolie est
  // seedee comme deja completee — n'est jamais redirigee.
  const h = await headers();
  const currentPath = h.get("x-current-path") ?? "/admin";
  const isOnWizard = currentPath.startsWith("/admin/bienvenue");
  if (!isOnWizard && !(await isOnboardingCompleted())) {
    redirect("/admin/bienvenue");
  }

  // Sur les pages du wizard, on n'affiche PAS le shell admin (sidebar,
  // widgets, providers marketplace). Le wizard a son propre layout minimaliste
  // (app/(admin)/admin/bienvenue/layout.tsx).
  if (isOnWizard) return <>{children}</>;

  const initials = session.user.name
    ? session.user.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : "A";

  // Fetch all layout data in parallel. `fetchAdminWarnings` est LIVE (non cachée) :
  // les pastilles de la navigation sont ensuite rafraîchies toutes les 25 s côté
  // navigateur via `LiveAdminWarningsProvider` + `/api/admin/warnings`.
  const [
    shopName,
    initialWarnings,
    pfsCreds,
    autoTranslateConfig,
    microstoreExpirations,
    cookieStore,
  ] = await Promise.all([
    getCachedShopName(),
    fetchAdminWarnings(),
    getCachedPfsCredentials(),
    getCachedSiteConfig("auto_translate_enabled"),
    getMicrostoreSessionExpirations(),
    cookies(),
  ]);

  const adminTheme = parseAdminTheme(cookieStore.get(ADMIN_THEME_COOKIE)?.value ?? null);
  const themeClass = adminThemeBodyClass(adminTheme);

  const translationEnabled = !!(pfsCreds.email && pfsCreds.password);
  const autoTranslateEnabled = translationEnabled && autoTranslateConfig?.value === "true";

  return (
    <DeeplConfigProvider enabled={translationEnabled} autoTranslateEnabled={autoTranslateEnabled}>
    <LiveAdminWarningsProvider initial={initialWarnings}>
    <MarketplaceLinkProvider>
    <MarketplaceRefreshProvider>
    <MicrostoreBulkPushProvider>
    <MappingImpactProvider>
    <EfashionShootingBatchProvider>
    <RefreshWarningProvider>
    <IneligibleRefreshProvider>
    <RefreshMarketplacePromptProvider>
    <PfsAuditActiveProvider>
    <AdminWidgetsRail>
    <MicrostoreSessionAlerts
      bossExpiresAtIso={microstoreExpirations.bossExpiresAtIso}
      pictureStationExpiresAtIso={microstoreExpirations.pictureStationExpiresAtIso}
    />
    <AdminHtmlThemeSync theme={adminTheme} />
    <div id="admin-theme-wrapper" data-admin-theme={adminTheme} className={`min-h-screen flex bg-white pb-24 ${themeClass}`}>

      <AdminShellsLive
        shopName={shopName}
        userName={session.user.name ?? "Admin"}
        initials={initials}
      >
        {children}
      </AdminShellsLive>

      <AdminChatWidgetLoader />
    </div>
    </AdminWidgetsRail>
    </PfsAuditActiveProvider>
    </RefreshMarketplacePromptProvider>
    </IneligibleRefreshProvider>
    </RefreshWarningProvider>
    </EfashionShootingBatchProvider>
    </MappingImpactProvider>
    </MicrostoreBulkPushProvider>
    </MarketplaceRefreshProvider>
    </MarketplaceLinkProvider>
    </LiveAdminWarningsProvider>
    </DeeplConfigProvider>
  );
}
