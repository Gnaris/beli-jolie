import React from "react";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCachedAdminWarnings, getCachedShopName, getCachedUnmappedAttributes } from "@/lib/cached-data";
import { formatAttrLabel, type UnmappedAttributes } from "@/lib/unmapped-attributes";
import { isOnboardingCompleted } from "@/lib/onboarding";
import type { Metadata } from "next";
import AdminMobileNav from "@/components/admin/AdminMobileNav";
import AdminDesktopShell from "@/components/admin/AdminDesktopShell";

import { DeeplConfigProvider } from "@/components/admin/DeeplConfigContext";
import AdminChatWidgetLoader from "@/components/admin/AdminChatWidgetLoader";
import { MarketplaceRefreshProvider } from "@/components/admin/products/MarketplaceRefreshContext";
import { EfashionShootingBatchProvider } from "@/components/admin/products/EfashionShootingBatchContext";
import { RefreshWarningProvider } from "@/components/admin/products/RecentlyRefreshedWarningModal";
import { IneligibleRefreshProvider } from "@/components/admin/products/IneligibleRefreshModal";
import { RefreshMarketplacePromptProvider } from "@/components/admin/products/RefreshMarketplaceDialog";
import { AdminWidgetsRail } from "@/components/admin/widgets-rail";
import { MarketplaceMaintenanceProvider } from "@/components/admin/products/MarketplaceMaintenanceContext";
import { getCachedSiteConfig, getCachedPfsCredentials } from "@/lib/cached-data";
import { getCurrentTenant } from "@/lib/tenant";
import { getMarketplaceMaintenance } from "@/lib/platform-config";

/** Slugs du tenant "maître" — voit l'entrée "Contrôle plateforme" dans la sidebar.
 *  Prod = "beliandjolie", dev-local = "beli-jolie". */
const PLATFORM_ADMIN_TENANT_SLUGS = new Set(["beliandjolie", "beli-jolie"]);

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
    unmapped,
    currentTenant,
    maintenance,
  ] = await Promise.all([
    getCachedShopName(),
    getCachedAdminWarnings(),
    getCachedPfsCredentials(),
    getCachedSiteConfig("auto_translate_enabled"),
    getCachedUnmappedAttributes(),
    getCurrentTenant(),
    getMarketplaceMaintenance(),
  ]);

  const isPlatformAdmin = !!currentTenant && PLATFORM_ADMIN_TENANT_SLUGS.has(currentTenant.slug);

  const {
    untranslatedCount,
    unusedColorsCount,
    unusedCompositionsCount,
    unusedTagsCount,
    untranslatedCategoriesCount,
    untranslatedSubCategoriesCount,
    pendingOrdersCount,
  } = warnings;

  const translationEnabled = !!(pfsCreds.email && pfsCreds.password);
  const autoTranslateEnabled = translationEnabled && autoTranslateConfig?.value === "true";
  const totalAttributeWarnings = untranslatedCount + unusedColorsCount + unusedCompositionsCount + unusedTagsCount + untranslatedCategoriesCount + untranslatedSubCategoriesCount;

  const warningCounts: Record<string, { count: number; tooltip: string; title?: string; reasons?: string[]; hint?: string } | undefined> = {};

  // ─── Sous-items catalogue : alerte mapping marketplaces ────────────────
  const subEntries: Array<[string, keyof Omit<UnmappedAttributes, "totalUnmapped">, string]> = [
    ["/admin/categories", "categories", "Ouvrir la page Catégories pour compléter les liens."],
    ["/admin/couleurs", "colors", "Ouvrir la page Couleurs pour compléter les liens."],
    ["/admin/compositions", "compositions", "Ouvrir la page Compositions pour compléter les liens."],
    ["/admin/saisons", "seasons", "Ouvrir la page Saisons pour compléter les liens."],
    ["/admin/tailles", "sizes", "Ouvrir la page Tailles pour compléter les liens."],
    ["/admin/codes-sh", "shCodes", "Ouvrir la page Codes SH pour compléter les liens."],
  ];
  for (const [href, kind, hint] of subEntries) {
    const attr = unmapped[kind];
    if (attr.total > 0) {
      const title = formatAttrLabel(kind, attr.total);
      warningCounts[href] = { count: attr.total, title, tooltip: title, reasons: attr.reasons, hint };
    }
  }

  // ─── Parent Produits : cumul traductions + mappings ─────────────────────
  const totalCombined = totalAttributeWarnings + unmapped.totalUnmapped;
  if (totalCombined > 0) {
    const parentReasons: string[] = [];
    if (totalAttributeWarnings > 0) parentReasons.push(`${totalAttributeWarnings} traduction${totalAttributeWarnings > 1 ? "s" : ""} manquante${totalAttributeWarnings > 1 ? "s" : ""}`);
    if (unmapped.totalUnmapped > 0) parentReasons.push(`${unmapped.totalUnmapped} attribut${unmapped.totalUnmapped > 1 ? "s" : ""} sans mapping`);
    warningCounts["/admin/produits"] = {
      count: totalCombined,
      tooltip: `${totalCombined} élément${totalCombined > 1 ? "s" : ""} nécessitant attention`,
      title: `${totalCombined} élément${totalCombined > 1 ? "s" : ""} à traiter`,
      reasons: parentReasons,
      hint: "Détail par ligne dans le sous-menu.",
    };
  }

  return (
    <DeeplConfigProvider enabled={translationEnabled} autoTranslateEnabled={autoTranslateEnabled}>
    <MarketplaceMaintenanceProvider value={maintenance}>
    <MarketplaceRefreshProvider>
    <EfashionShootingBatchProvider>
    <RefreshWarningProvider>
    <IneligibleRefreshProvider>
    <RefreshMarketplacePromptProvider>
    <AdminWidgetsRail>
    <div id="admin-theme-wrapper" className="min-h-screen flex bg-[#EEEEF1] pb-24">

      <AdminDesktopShell
        shopName={shopName}
        userName={session.user.name ?? "Admin"}
        initials={initials}
        warnings={warningCounts}
        pendingOrdersCount={pendingOrdersCount}
        isPlatformAdmin={isPlatformAdmin}
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
          }}
          shopName={shopName}
          isPlatformAdmin={isPlatformAdmin}
        />

        <main className="flex-1 p-4 md:p-6 lg:p-8 lg:my-5 lg:mr-5 lg:rounded-[22px] lg:bg-white lg:border lg:border-zinc-200 lg:shadow-[0_20px_40px_-20px_rgba(9,9,11,0.15),0_6px_16px_-8px_rgba(9,9,11,0.06)] lg:min-h-[calc(100vh-40px)]">
          {children}
        </main>
      </AdminDesktopShell>

      <AdminChatWidgetLoader />
    </div>
    </AdminWidgetsRail>
    </RefreshMarketplacePromptProvider>
    </IneligibleRefreshProvider>
    </RefreshWarningProvider>
    </EfashionShootingBatchProvider>
    </MarketplaceRefreshProvider>
    </MarketplaceMaintenanceProvider>
    </DeeplConfigProvider>
  );
}
