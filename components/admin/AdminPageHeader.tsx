"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import AdminHeaderWidgetLauncher from "./AdminHeaderWidgetLauncher";
import { ATTRIBUT_TABS, resolveActiveTab } from "./attributs/AttributsTabs";
import { MARKETING_TABS, resolveMarketingTab } from "./marketing/MarketingTabs";

type SubItem = { label: string; href: string; active?: boolean };

function resolveSubnav(pathname: string, onglet: string | null): SubItem[] | null {
  // Section produits (listing + attributs fusionnés)
  if (pathname === "/admin/produits" || pathname.startsWith("/admin/produits/attributs")) {
    const activeTab = resolveActiveTab(pathname, onglet);
    return ATTRIBUT_TABS.map((t) => ({
      label: t.label,
      href: t.href,
      active: t.id === activeTab,
    }));
  }
  // Section marketing (envoi + 6 sous-pages fusionnées)
  if (pathname === "/admin/marketing" || pathname.startsWith("/admin/marketing/")) {
    const activeTab = resolveMarketingTab(pathname, onglet);
    return MARKETING_TABS.map((t) => ({
      label: t.label,
      href: t.href,
      active: t.id === activeTab,
    }));
  }
  return null;
}

interface Props {
  shopName: string;
  userName: string;
  initials: string;
}

export default function AdminPageHeader({ shopName, userName, initials }: Props) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const onglet = searchParams?.get("onglet") ?? null;
  const subnav = resolveSubnav(pathname, onglet);

  return (
    <div className="hidden lg:flex items-stretch gap-3 h-[72px]">
      {/* ─── Brand card (coin haut-gauche, w = largeur sidebar + espacement) ── */}
      <Link
        href="/fr"
        title={shopName}
        className="w-[260px] shrink-0 bg-white border border-zinc-200/80 rounded-2xl shadow-sm px-3 flex items-center gap-3"
      >
        <div
          className="relative w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm overflow-hidden shrink-0"
          style={{ background: "linear-gradient(135deg, #27272A 0%, #18181B 100%)", border: "1px solid #27272A" }}
        >
          <span className="font-heading text-base font-bold text-white">
            {shopName.charAt(0).toUpperCase()}
          </span>
          <span className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-amber-300/50 blur-xl" />
        </div>
        <span className="font-heading text-[15px] font-bold text-zinc-900 truncate leading-tight">
          {shopName}
        </span>
      </Link>

      {/* ─── Sous-navigation (flex-1 : remplit tout l'espace libre) ─ */}
      <nav
        aria-label="Sous-navigation"
        className="flex-1 min-w-0 bg-white border border-zinc-200/80 rounded-2xl shadow-sm px-3 flex items-center overflow-x-auto scrollbar-light"
      >
        {subnav ? (
          <div className="flex items-center gap-1.5 w-max mx-auto">
            {subnav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                scroll={false}
                className={`inline-flex items-center px-3.5 py-1.5 rounded-full text-[13px] font-body font-medium transition-colors whitespace-nowrap ${
                  item.active
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ) : (
          /* Barre blanche vide — maintient le rythme visuel sur les pages
             qui n'ont pas de sous-nav dédiée. */
          <span className="sr-only">Aucune sous-navigation sur cette page</span>
        )}
      </nav>

      {/* ─── Widget étoile (menu raccourcis) ──────────────────── */}
      <AdminHeaderWidgetLauncher />

      {/* ─── Compte admin (avatar + nom) ──────────────────────── */}
      <div className="bg-white border border-zinc-200/80 rounded-2xl shadow-sm pl-2 pr-3 flex items-center gap-2.5 shrink-0">
        <div
          title={`${userName} — Administrateur`}
          className="relative w-9 h-9 rounded-full flex items-center justify-center shadow-sm"
          style={{ background: "#18181B", border: "1px solid #27272A" }}
        >
          <span className="text-white text-[11px] font-bold font-body">{initials}</span>
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        </div>
        <div className="min-w-0 flex flex-col leading-tight pr-1">
          <span className="font-heading text-[13px] font-bold text-zinc-900 truncate max-w-[180px]">
            {userName}
          </span>
          <span className="text-[10.5px] font-body uppercase tracking-[0.14em] text-zinc-500">
            Administrateur
          </span>
        </div>
      </div>
    </div>
  );
}
