"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "./LogoutModal";
import AdminClientModeButton from "./AdminClientModeButton";
import AdminSidebarThemeToggle from "./AdminSidebarThemeToggle";
import type { AdminTheme } from "@/lib/admin-theme";
import { AdminWarningTooltip } from "./AdminWarningTooltip";

// ─── Items du menu ──────────────────────────────────────────────────────────
// Plus de sous-items dans la sidebar : les sous-nav (ex. Produits → Catégories/
// Couleurs/…) sont affichées en barre horizontale sur chaque page concernée.
type NavItem = {
  label: string;
  href: string;
  icon: string;
  soon?: boolean;
  external?: boolean;
};
type NavSection = { items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: "Tableau de bord", href: "/admin", icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },
    ],
  },
  {
    items: [
      { label: "Produits", href: "/admin/produits", icon: "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" },
      { label: "Collections", href: "/admin/collections", icon: "M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" },
      { label: "Catalogues", href: "/admin/catalogues", icon: "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" },
    ],
  },
  {
    items: [
      { label: "Commandes", href: "/admin/commandes", icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" },
      { label: "Clients", href: "/admin/clients", icon: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" },
      { label: "Contact Client", href: "/admin/contact-client", icon: "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" },
      { label: "Service Client", href: "/admin/service-client", icon: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" },
      { label: "Avis", href: "/admin/avis", icon: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.322.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" },
      { label: "Promotions", href: "/admin/promotions", icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z" },
    ],
  },
  {
    items: [
      { label: "Documents légaux", href: "/admin/documents-legaux", icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" },
      { label: "Paramètres", href: "/admin/parametres", icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
    ],
  },
];

interface Props {
  adminTheme: AdminTheme;
  warnings: Record<string, { count: number; tooltip: string; title?: string; reasons?: string[]; hint?: string } | undefined>;
  pendingOrdersCount: number;
  pendingUsersCount: number;
  openClaimsCount: number;
  pendingReviewsCount: number;
  sidebarExpanded: boolean;
  onSidebarExpandedChange: (expanded: boolean) => void;
  children: React.ReactNode;
}

function isItemActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// ─────────────────────────────────────────────────────────────────────────
// Lien de navigation sidebar : icône fixe à gauche + label qui s'affiche
// quand la sidebar est expand (survol). Plus de bulle tooltip portal —
// le label vit directement dans la bulle de nav. L'AdminWarningTooltip
// reste pour les détails des pastilles d'alerte (trad. manquante, etc.).
// ─────────────────────────────────────────────────────────────────────────
function AdminNavIconLink({
  item,
  active,
  warning,
  blueCount,
  expanded,
}: {
  item: NavItem;
  active: boolean;
  warning?: { count: number; tooltip: string; title?: string; reasons?: string[]; hint?: string };
  blueCount: number;
  expanded: boolean;
}) {
  const showBlueBadge = blueCount > 0;

  return (
    <AdminWarningTooltip warning={warning}>
      <Link
        href={item.href}
        scroll={item.href !== "/admin/produits"}
        target={item.external ? "_blank" : undefined}
        rel={item.external ? "noopener noreferrer" : undefined}
        title={!expanded ? item.label : undefined}
        className={`relative flex items-center h-9 rounded-xl transition-[padding,gap,background-color,color] duration-200 overflow-hidden ${
          expanded ? "px-3 gap-3" : "px-2 gap-0 justify-center"
        } ${
          active
            ? "bg-zinc-100 text-zinc-900"
            : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
        }`}
      >
        {active && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-zinc-900" />
        )}
        <span className="shrink-0 w-5 h-5 flex items-center justify-center">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d={item.icon} />
          </svg>
        </span>
        <span
          className={`text-[13px] font-body font-medium whitespace-nowrap overflow-hidden transition-[max-width,opacity,flex-grow] duration-300 ${
            expanded ? "max-w-[180px] opacity-100 flex-1 min-w-0 truncate delay-75" : "max-w-0 opacity-0"
          }`}
        >
          {item.label}
        </span>
        {showBlueBadge && (
          <span
            className={`shrink-0 flex items-center justify-center text-[11px] rounded-full h-[22px] font-bold bg-sky-100 text-sky-700 border border-sky-200 overflow-hidden transition-[max-width,opacity,padding] duration-300 ${
              expanded ? "max-w-[48px] opacity-100 px-1.5 min-w-[22px] delay-75" : "max-w-0 opacity-0 px-0"
            }`}
          >
            {blueCount > 99 ? "99+" : blueCount}
          </span>
        )}
        {/* Pastille (dot) collapsed : seule indication quand sidebar fermée.
            Masquée dès que la sidebar s'ouvre (le badge chiffré prend le relais). */}
        {(showBlueBadge || warning) && (
          <span
            className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-white transition-opacity duration-150 ${
              expanded ? "opacity-0" : "opacity-100"
            }`}
            style={{ background: showBlueBadge ? "#3B82F6" : "#F59E0B" }}
            aria-hidden
          />
        )}
      </Link>
    </AdminWarningTooltip>
  );
}

export default function AdminDesktopShell({
  adminTheme,
  warnings,
  pendingOrdersCount,
  pendingUsersCount,
  openClaimsCount,
  pendingReviewsCount,
  sidebarExpanded,
  onSidebarExpandedChange,
  children,
}: Props) {
  const pathname = usePathname() ?? "";

  const blueBadges: Record<string, number> = {
    "/admin/commandes": pendingOrdersCount,
    "/admin/clients": pendingUsersCount,
    "/admin/service-client": openClaimsCount,
    "/admin/avis": pendingReviewsCount,
  };

  return (
    <>
      <aside
        onMouseEnter={() => onSidebarExpandedChange(true)}
        onMouseLeave={() => onSidebarExpandedChange(false)}
        className={`shrink-0 hidden lg:flex flex-col gap-3 fixed z-40 top-[108px] left-3 transition-[width] duration-300 ease-out ${
          sidebarExpanded ? "w-[240px]" : "w-[72px]"
        }`}
      >
        {/* Bulle Thème (clair / sombre) */}
        <AdminSidebarThemeToggle initialTheme={adminTheme} expanded={sidebarExpanded} />

        {/* Bulles de navigation : une par section (hauteur = contenu). */}
        {NAV_SECTIONS.map((section, idx) => (
          <div
            key={idx}
            className="bg-white border border-zinc-200/80 rounded-2xl shadow-sm py-2 px-2 flex flex-col gap-0.5 shrink-0 overflow-hidden"
          >
            {section.items.map((item) => {
              if (item.soon) {
                return (
                  <div
                    key={item.href}
                    className="relative flex items-center justify-center p-2 rounded-xl opacity-40 cursor-not-allowed text-zinc-400"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d={item.icon} />
                    </svg>
                  </div>
                );
              }
              return (
                <AdminNavIconLink
                  key={item.href}
                  item={item}
                  active={isItemActive(pathname, item.href)}
                  warning={warnings[item.href]}
                  blueCount={blueBadges[item.href] ?? 0}
                  expanded={sidebarExpanded}
                />
              );
            })}
          </div>
        ))}

        {/* Bulle Compte : mode client + déconnexion (porte ouverte) */}
        <div className="bg-white border border-zinc-200/80 rounded-2xl shadow-sm py-2 px-2 flex flex-col items-center gap-1 shrink-0">
          <div className="w-full">
            <AdminClientModeButton compact expanded={sidebarExpanded} />
          </div>
          <div className="w-full">
            <LogoutButton compact expanded={sidebarExpanded} />
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {children}
      </div>
    </>
  );
}
