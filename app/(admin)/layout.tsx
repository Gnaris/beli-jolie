import React from "react";
import { headers, cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ADMIN_THEME_COOKIE, parseAdminTheme, adminThemeBodyClass } from "@/lib/admin-theme";
import { getCachedAdminWarnings, getCachedShopName } from "@/lib/cached-data";
import { isOnboardingCompleted } from "@/lib/onboarding";
import type { Metadata } from "next";
import AdminMobileNav from "@/components/admin/AdminMobileNav";
import AdminDesktopShell from "@/components/admin/AdminDesktopShell";
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

  // Fetch all layout data in parallel
  const [
    shopName,
    warnings,
    pfsCreds,
    autoTranslateConfig,
    microstoreExpirations,
    cookieStore,
  ] = await Promise.all([
    getCachedShopName(),
    getCachedAdminWarnings(),
    getCachedPfsCredentials(),
    getCachedSiteConfig("auto_translate_enabled"),
    getMicrostoreSessionExpirations(),
    cookies(),
  ]);

  const adminTheme = parseAdminTheme(cookieStore.get(ADMIN_THEME_COOKIE)?.value ?? null);
  const themeClass = adminThemeBodyClass(adminTheme);

  const {
    untranslatedCount,
    unusedColorsCount,
    unusedCompositionsCount,
    unusedTagsCount,
    untranslatedCategoriesCount,
    untranslatedSubCategoriesCount,
    pendingOrdersCount,
    pendingUsersCount,
    openClaimsCount,
  } = warnings;

  const translationEnabled = !!(pfsCreds.email && pfsCreds.password);
  const autoTranslateEnabled = translationEnabled && autoTranslateConfig?.value === "true";
  const totalAttributeWarnings = untranslatedCount + unusedColorsCount + unusedCompositionsCount + unusedTagsCount + untranslatedCategoriesCount + untranslatedSubCategoriesCount;

  const warningCounts: Record<string, { count: number; tooltip: string; title?: string; reasons?: string[]; hint?: string } | undefined> = {};

  // ─── Parent Produits : uniquement les traductions manquantes ───────────
  // (le compteur "sans mapping marketplace" a été retiré — trop bruyant et
  // souvent hors sujet, on laisse l'admin voir les alertes sur chaque page.)
  if (totalAttributeWarnings > 0) {
    warningCounts["/admin/produits"] = {
      count: totalAttributeWarnings,
      tooltip: `${totalAttributeWarnings} traduction${totalAttributeWarnings > 1 ? "s" : ""} manquante${totalAttributeWarnings > 1 ? "s" : ""}`,
      title: `${totalAttributeWarnings} traduction${totalAttributeWarnings > 1 ? "s" : ""} à compléter`,
      hint: "Détail par ligne dans le sous-menu.",
    };
  }

  return (
    <DeeplConfigProvider enabled={translationEnabled} autoTranslateEnabled={autoTranslateEnabled}>
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

      <AdminDesktopShell
        shopName={shopName}
        userName={session.user.name ?? "Admin"}
        initials={initials}
        warnings={warningCounts}
        pendingOrdersCount={pendingOrdersCount}
        pendingUsersCount={pendingUsersCount}
        openClaimsCount={openClaimsCount}
      >
        <AdminMobileNav
          userName={session.user.name ?? "Admin"}
          initials={initials}
          warnings={{
            ...Object.fromEntries(
              Object.entries(warningCounts)
                .filter(([, w]) => w && w.count > 0)
                .map(([href, w]) => [href, w!.count]),
            ),
            "/admin/commandes": pendingOrdersCount,
            "/admin/utilisateurs": pendingUsersCount,
            "/admin/reclamations": openClaimsCount,
          }}
          shopName={shopName}
        />

        <main className="flex-1 p-4 md:p-6 lg:p-8 lg:bg-white lg:min-h-screen">
          {children}
        </main>
      </AdminDesktopShell>

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
    </DeeplConfigProvider>
  );
}
