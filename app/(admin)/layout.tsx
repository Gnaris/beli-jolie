import React from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCachedAdminWarnings, getCachedShopName } from "@/lib/cached-data";
import type { Metadata } from "next";
import AdminMobileNav from "@/components/admin/AdminMobileNav";
import AdminDesktopShell from "@/components/admin/AdminDesktopShell";

import { DeeplConfigProvider } from "@/components/admin/DeeplConfigContext";
import AdminChatWidgetLoader from "@/components/admin/AdminChatWidgetLoader";
import { MarketplaceRefreshProvider } from "@/components/admin/products/MarketplaceRefreshContext";
import { MarketplaceRefreshWidget } from "@/components/admin/products/MarketplaceRefreshWidget";
import { EfashionShootingBatchProvider } from "@/components/admin/products/EfashionShootingBatchContext";
import { EfashionShootingBatchWidget } from "@/components/admin/products/EfashionShootingBatchWidget";
import ImportProgressWidget from "@/components/admin/products/ImportProgressWidget";
import { RefreshWarningProvider } from "@/components/admin/products/RecentlyRefreshedWarningModal";
import { IneligibleRefreshProvider } from "@/components/admin/products/IneligibleRefreshModal";
import { getCachedSiteConfig, getCachedPfsCredentials } from "@/lib/cached-data";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/fr/connexion");

  const initials = session.user.name
    ? session.user.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : "A";

  // Fetch all layout data in parallel
  const [
    shopName,
    warnings,
    pfsCreds,
    autoTranslateConfig,
  ] = await Promise.all([
    getCachedShopName(),
    getCachedAdminWarnings(),
    getCachedPfsCredentials(),
    getCachedSiteConfig("auto_translate_enabled"),
  ]);

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

  const warningCounts: Record<string, { count: number; tooltip: string } | undefined> = {
    "/admin/produits": totalAttributeWarnings > 0 ? { count: totalAttributeWarnings, tooltip: `${totalAttributeWarnings} élément${totalAttributeWarnings > 1 ? "s" : ""} nécessitant attention` } : undefined,
  };

  return (
    <DeeplConfigProvider enabled={translationEnabled} autoTranslateEnabled={autoTranslateEnabled}>
    <MarketplaceRefreshProvider>
    <EfashionShootingBatchProvider>
    <RefreshWarningProvider>
    <IneligibleRefreshProvider>
    <div id="admin-theme-wrapper" className="min-h-screen bg-bg-secondary flex">

      <AdminDesktopShell
        shopName={shopName}
        userName={session.user.name ?? "Admin"}
        initials={initials}
        warnings={warningCounts}
        pendingOrdersCount={pendingOrdersCount}
      >
        <AdminMobileNav
          userName={session.user.name ?? "Admin"}
          initials={initials}
          warnings={{
            "/admin/produits":     totalAttributeWarnings > 0 ? totalAttributeWarnings : 0,
            "/admin/commandes":    pendingOrdersCount,
          }}
          shopName={shopName}
        />

        <main className="flex-1 p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </AdminDesktopShell>

      <AdminChatWidgetLoader />
      <MarketplaceRefreshWidget />
      <EfashionShootingBatchWidget />
      <ImportProgressWidget />
    </div>
    </IneligibleRefreshProvider>
    </RefreshWarningProvider>
    </EfashionShootingBatchProvider>
    </MarketplaceRefreshProvider>
    </DeeplConfigProvider>
  );
}
