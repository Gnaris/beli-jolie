"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "./LogoutModal";
import AdminClientModeButton from "./AdminClientModeButton";
import AdminSidebarThemeToggle from "./AdminSidebarThemeToggle";
import type { AdminTheme } from "@/lib/admin-theme";

type NavItem = {
  label: string;
  href: string;
  icon: string;
  soon?: boolean;
  external?: boolean;
};

// Groupes synchronisés avec AdminDesktopShell (sidebar en bulles).
// Plus de sous-items ni de titres de section : la sous-nav Produits/
// Marketing s'affiche en pastilles sur la page via AdminMobileSubnav.
const NAV_SECTIONS: NavItem[][] = [
  [
    { label: "Tableau de bord", href: "/admin", icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },
  ],
  [
    { label: "Produits", href: "/admin/produits", icon: "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" },
    { label: "Collections", href: "/admin/collections", icon: "M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" },
    { label: "Catalogues", href: "/admin/catalogues", icon: "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" },
  ],
  [
    { label: "Commandes", href: "/admin/commandes", icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" },
    { label: "Clients", href: "/admin/clients", icon: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" },
    { label: "Marketing", href: "/admin/marketing", icon: "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" },
    { label: "Service Client", href: "/admin/service-client", icon: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" },
    { label: "Avis", href: "/admin/avis", icon: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.322.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" },
    { label: "Promotions", href: "/admin/promotions", icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z" },
  ],
  [
    { label: "Documents légaux", href: "/admin/documents-legaux", icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" },
    { label: "Paramètres", href: "/admin/parametres", icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  ],
];

interface Props {
  userName: string;
  initials: string;
  warnings?: Record<string, number>;
  shopName: string;
  adminTheme: AdminTheme;
}

const BLUE_BADGE_HREFS = new Set([
  "/admin/commandes",
  "/admin/clients",
  "/admin/service-client",
  "/admin/avis",
]);

function isItemActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminMobileNav({ userName, initials, warnings = {}, shopName, adminTheme }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";

  return (
    <>
      {/* ─── Top bar mobile : blanche & sobre ─────────────────────── */}
      <header className="lg:hidden relative h-14 sticky top-0 z-30 bg-white border-b border-zinc-200 shadow-sm">
        <div className="relative h-full flex items-center justify-between px-3">
          <button
            onClick={() => setOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 transition-colors text-zinc-700"
            aria-label="Ouvrir le menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>

          <Link href="/admin" className="flex items-center gap-2">
            <div
              className="relative w-8 h-8 rounded-xl flex items-center justify-center shadow-sm overflow-hidden"
              style={{ background: "linear-gradient(135deg, #27272A 0%, #18181B 100%)", border: "1px solid #27272A" }}
            >
              <span className="font-heading text-xs font-bold text-white">
                {shopName.charAt(0).toUpperCase()}
              </span>
              <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-amber-300/60 blur-md" />
            </div>
            <span className="font-heading text-sm font-bold text-zinc-900 truncate max-w-[140px]">
              {shopName}
            </span>
          </Link>

          <div
            className="relative w-9 h-9 rounded-full flex items-center justify-center shadow-sm"
            style={{ background: "#18181B", border: "1px solid #27272A" }}
          >
            <span className="text-white text-[11px] font-bold">{initials}</span>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
          </div>
        </div>
      </header>

      {/* ─── Backdrop ─────────────────────── */}
      {open && (
        <div
          data-admin-mobile-backdrop
          className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-40 lg:hidden animate-[fadeIn_120ms_ease-out]"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ─── Slide-in drawer (groupes en bulles comme la sidebar desktop)
          `h-[100dvh]` : barres Safari iPad/Android gérées proprement.
          `min-h-0` sur la zone scrollable évite que le contenu pousse
          le footer sous le viewport sur les écrans plus courts. ─── */}
      <nav
        data-admin-mobile-drawer
        className={`fixed top-0 left-0 h-[100dvh] w-[calc(100%-3rem)] max-w-[300px] z-50 transform transition-transform duration-200 ease-out lg:hidden flex flex-col rounded-r-2xl bg-[#F1F1F3] border-r border-zinc-200 shadow-[0_25px_60px_-10px_rgba(9,9,11,0.25)] ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header drawer */}
        <div className="relative flex items-center justify-between px-5 py-4 bg-white border-b border-zinc-200 rounded-tr-2xl">
          <Link href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-3 min-w-0">
            <div
              className="relative w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm overflow-hidden shrink-0"
              style={{ background: "linear-gradient(135deg, #27272A 0%, #18181B 100%)", border: "1px solid #27272A" }}
            >
              <span className="font-heading text-base font-bold text-white">
                {shopName.charAt(0).toUpperCase()}
              </span>
              <span className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-amber-300/50 blur-xl" />
            </div>
            <div className="min-w-0">
              <p className="font-heading text-base font-bold text-zinc-900 truncate leading-tight">{shopName}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-[10px] uppercase tracking-[0.18em] font-body font-semibold text-zinc-500">
                  Administration
                </p>
              </div>
            </div>
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors shrink-0 ml-2 bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 text-zinc-700"
            aria-label="Fermer le menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation : groupes séparés en bulles (match sidebar desktop) */}
        <div className="relative flex-1 min-h-0 px-3 py-3 overflow-y-auto scrollbar-light space-y-3">
          {/* Toggle thème (clair / sombre) — version horizontale pleine
              largeur, cohérente avec la bulle verticale de la sidebar desktop. */}
          <AdminSidebarThemeToggle initialTheme={adminTheme} layout="drawer" />

          {NAV_SECTIONS.map((items, idx) => (
            <div
              key={idx}
              className="bg-white border border-zinc-200/80 rounded-2xl shadow-sm p-2 space-y-0.5"
            >
              {items.map((item) => {
                if (item.soon) return null;
                const warningCount = warnings[item.href] ?? 0;
                const active = isItemActive(pathname, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    scroll={item.href !== "/admin/produits"}
                    onClick={() => setOpen(false)}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noopener noreferrer" : undefined}
                    className={`relative flex items-center gap-3 px-3 py-2.5 text-[13.5px] font-body rounded-xl transition-colors ${
                      active
                        ? "bg-zinc-100 text-zinc-900 font-semibold"
                        : "text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-zinc-900" />
                    )}
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d={item.icon} />
                    </svg>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.external && (
                      <svg className="w-3 h-3 shrink-0 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    )}
                    {BLUE_BADGE_HREFS.has(item.href) && warningCount > 0 && (
                      <span className="flex items-center justify-center text-[11px] rounded-full min-w-[22px] h-[22px] px-1.5 font-bold bg-sky-100 text-sky-700 border border-sky-200">
                        {warningCount}
                      </span>
                    )}
                    {!BLUE_BADGE_HREFS.has(item.href) && warningCount > 0 && (
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        <span className="text-[11.5px] font-semibold text-amber-700">{warningCount}</span>
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* User / Logout */}
        <div className="relative px-3 py-3 border-t border-zinc-200 bg-white rounded-br-2xl">
          <div className="mb-2">
            <AdminClientModeButton />
          </div>
          <div
            className="relative overflow-hidden flex items-center gap-3 px-3 py-2.5 mb-2 rounded-2xl bg-zinc-50 border border-zinc-200"
          >
            <div
              className="relative w-9 h-9 rounded-full flex items-center justify-center shadow-sm shrink-0"
              style={{ background: "#18181B", border: "1px solid #27272A" }}
            >
              <span className="text-white text-[11px] font-bold font-body">{initials}</span>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 truncate font-body leading-tight">
                {userName}
              </p>
              <p className="text-[11px] font-body leading-tight uppercase tracking-wider font-medium text-zinc-500">
                Administrateur
              </p>
            </div>
          </div>
          <LogoutButton />
        </div>
        <style>{`
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        `}</style>
      </nav>
    </>
  );
}
