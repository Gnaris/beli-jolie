import React from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCachedAdminWarnings, getCachedShopName } from "@/lib/cached-data";
import Link from "next/link";
import type { Metadata } from "next";
import LogoutButton from "@/components/admin/LogoutModal";
import AdminMobileNav from "@/components/admin/AdminMobileNav";
import AdminClientModeButton from "@/components/admin/AdminClientModeButton";

import LiveCountBadge from "@/components/admin/LiveCountBadge";
import AdminChatBadge from "@/components/admin/AdminChatBadge";
import { DeeplConfigProvider } from "@/components/admin/DeeplConfigContext";
import { PfsRefreshProvider } from "@/components/admin/pfs/PfsRefreshContext";
import PfsRefreshWidget from "@/components/admin/pfs/PfsRefreshWidget";
import { getCachedSiteConfig, getCachedPfsEnabled } from "@/lib/cached-data";
import { getAdminUnreadCount } from "@/app/actions/admin/messages";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const initials = session.user.name
    ? session.user.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : "A";

  const shopName = await getCachedShopName();

  // Warning counts for sidebar badges (cached 5min)
  const {
    untranslatedCount,
    unusedColorsCount,
    unusedCompositionsCount,
    unusedTagsCount,
    untranslatedCategoriesCount,
    untranslatedSubCategoriesCount,
    pendingOrdersCount,
  } = await getCachedAdminWarnings();

  const deeplConfig = await getCachedSiteConfig("deepl_api_key");
  const deeplEnabled = !!deeplConfig?.value;
  const autoTranslateConfig = await getCachedSiteConfig("auto_translate_enabled");
  const autoTranslateEnabled = deeplEnabled && autoTranslateConfig?.value === "true";

  const [pfsEnabled, unreadMessageCount] = await Promise.all([
    getCachedPfsEnabled(),
    getAdminUnreadCount(),
  ]);
  const totalAttributeWarnings = untranslatedCount + unusedColorsCount + unusedCompositionsCount + unusedTagsCount + untranslatedCategoriesCount + untranslatedSubCategoriesCount;

  const warningCounts: Record<string, { count: number; tooltip: string } | undefined> = {
    "/admin/produits": totalAttributeWarnings > 0 ? { count: totalAttributeWarnings, tooltip: `${totalAttributeWarnings} élément${totalAttributeWarnings > 1 ? "s" : ""} nécessitant attention` } : undefined,
  };

  const PfsWrapper = pfsEnabled ? PfsRefreshProvider : React.Fragment;

  return (
    <DeeplConfigProvider enabled={deeplEnabled} autoTranslateEnabled={autoTranslateEnabled}>
    <PfsWrapper>
    <div id="admin-theme-wrapper" className="min-h-screen bg-bg-secondary flex">

      {/* ===== SIDEBAR - fixed left (desktop) ===== */}
      <aside className="w-[260px] shrink-0 bg-bg-primary border-r border-border hidden lg:flex flex-col fixed top-0 left-0 h-screen z-40">

        {/* Logo */}
        <div className="px-6 py-5 border-b border-border">
          <Link href="/" className="font-heading text-lg font-bold text-text-primary tracking-tight">
            {shopName}
          </Link>
          <p className="text-[10px] text-text-muted mt-0.5 font-body uppercase tracking-wider">
            Administration
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto" aria-label="Navigation admin">
          {getAdminNavSections().map((section, sectionIdx) => (
            <div key={section.title}>
              <p className={`text-[10px] uppercase tracking-widest text-text-muted font-medium px-4 mb-2 ${sectionIdx === 0 ? "mt-1" : "mt-6"}`}>
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const warning = warningCounts[item.href];
                  if (item.soon) {
                    return (
                      <div
                        key={item.href}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm font-body text-text-muted rounded-lg cursor-not-allowed opacity-60"
                      >
                        <span aria-hidden="true">{item.icon}</span>
                        <span className="flex-1">{item.label}</span>
                        <span className="text-[10px] font-semibold bg-bg-secondary text-text-muted border border-border rounded-full px-2 py-0.5 uppercase tracking-wide leading-none shrink-0">
                          Bientôt
                        </span>
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-3 px-3 py-2.5 text-sm font-body text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-[10px] transition-all group"
                    >
                      <span className="text-text-muted group-hover:text-text-secondary transition-colors" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="flex-1">{item.label}</span>
                      {item.href === "/admin/utilisateurs" && <LiveCountBadge />}
                      {item.href === "/admin/messages" && <AdminChatBadge initialCount={unreadMessageCount} />}
                      {item.href === "/admin/commandes" && pendingOrdersCount > 0 && (
                        <span className="relative group/tooltip">
                          <span className="flex items-center justify-center text-[11px] bg-blue-100 text-blue-700 border border-blue-200 rounded-full min-w-[22px] h-[22px] px-1.5 font-semibold">
                            {pendingOrdersCount}
                          </span>
                          <span className="absolute right-0 bottom-full mb-2 hidden group-hover/tooltip:block w-48 bg-bg-dark text-text-inverse text-xs rounded-lg px-3 py-2 z-50 pointer-events-none shadow-lg">
                            {pendingOrdersCount} commande{pendingOrdersCount > 1 ? "s" : ""} en attente
                            <span className="absolute top-full right-3 border-4 border-transparent border-t-[#1A1A1A]" />
                          </span>
                        </span>
                      )}
                      {warning && (
                        <span className="relative group/tooltip">
                          <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-medium">
                            ⚠ {warning.count}
                          </span>
                          <span className="absolute right-0 bottom-full mb-2 hidden group-hover/tooltip:block w-52 bg-bg-dark text-text-inverse text-xs rounded-lg px-3 py-2 z-50 pointer-events-none shadow-lg">
                            {warning.tooltip}
                            <span className="absolute top-full right-3 border-4 border-transparent border-t-[#1A1A1A]" />
                          </span>
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="border-t border-border pt-2 mt-6">
            <AdminClientModeButton />
          </div>
        </nav>

        {/* User / Logout */}
        <div className="px-3 py-4 border-t border-border">
          <div className="flex items-center gap-3 px-3 py-2.5 mb-1 bg-bg-secondary rounded-lg">
            <div className="w-8 h-8 rounded-full bg-bg-dark flex items-center justify-center shrink-0">
              <span className="text-text-inverse text-[11px] font-bold font-body">{initials}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary truncate font-body leading-tight">
                {session.user.name}
              </p>
              <p className="text-[11px] text-text-muted font-body leading-tight truncate">
                Administrateur
              </p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </aside>

      {/* ===== MAIN CONTENT ===== */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-[260px]">

        {/* Mobile header + slide-in drawer */}
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
      </div>

      {pfsEnabled && <PfsRefreshWidget />}
    </div>
    </PfsWrapper>
    </DeeplConfigProvider>
  );
}

/* --- Admin navigation (grouped by section) --------------------------- */
type NavSection = { title: string; items: { label: string; href: string; icon: React.ReactNode; soon?: boolean }[] };

function getAdminNavSections(): NavSection[] {
  return [...ADMIN_NAV_SECTIONS_BASE];
}

const ADMIN_NAV_SECTIONS_BASE: NavSection[] = [
  {
    title: "Principal",
    items: [
      {
        label: "Tableau de bord",
        href: "/admin",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Catalogue",
    items: [
      {
        label: "Produits",
        href: "/admin/produits",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
        ),
      },
      {
        label: "Collections",
        href: "/admin/collections",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
          </svg>
        ),
      },
      {
        label: "Catalogues",
        href: "/admin/catalogues",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Ventes",
    items: [
      {
        label: "Commandes",
        href: "/admin/commandes",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
          </svg>
        ),
      },
      {
        label: "Clients",
        href: "/admin/utilisateurs",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
        ),
      },
      {
        label: "Messages",
        href: "/admin/messages",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        ),
      },
      {
        label: "Réclamations",
        href: "/admin/reclamations",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        ),
      },
      {
        label: "Promotions",
        href: "/admin/promotions",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Accès",
    items: [
      {
        label: "Codes d'accès",
        href: "/admin/codes-acces",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Système",
    items: [
      {
        label: "Documents légaux",
        href: "/admin/documents-legaux",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        ),
      },
      {
        label: "Paramètres",
        href: "/admin/parametres",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
];
