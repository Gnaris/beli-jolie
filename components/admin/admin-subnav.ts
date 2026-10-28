import { ATTRIBUT_TABS, resolveActiveTab } from "./attributs/AttributsTabs";
import { MARKETING_TABS, resolveMarketingTab } from "./contact-client/MarketingTabs";

export type AdminSubnavItem = { label: string; href: string; active: boolean };

export function resolveAdminSubnav(pathname: string, onglet: string | null): AdminSubnavItem[] | null {
  if (pathname === "/admin/produits" || pathname.startsWith("/admin/produits/attributs")) {
    const activeTab = resolveActiveTab(pathname, onglet);
    return ATTRIBUT_TABS.map((t) => ({ label: t.label, href: t.href, active: t.id === activeTab }));
  }
  if (pathname === "/admin/contact-client" || pathname.startsWith("/admin/contact-client/")) {
    const activeTab = resolveMarketingTab(pathname, onglet);
    return MARKETING_TABS.map((t) => ({ label: t.label, href: t.href, active: t.id === activeTab }));
  }
  return null;
}
