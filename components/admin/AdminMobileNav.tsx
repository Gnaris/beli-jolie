"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "./LogoutModal";
import AdminClientModeButton from "./AdminClientModeButton";

const SUBMENU_KEY = "bj_admin_submenu_open";

type NavItem = {
  label: string;
  href: string;
  icon: string;
  soon?: boolean;
  children?: { label: string; href: string }[];
};
type NavSection = { title: string; items: NavItem[] };

const PRODUCT_SUBNAV: NavItem["children"] = [
  { label: "Tous les produits", href: "/admin/produits" },
  { label: "Catégories", href: "/admin/categories" },
  { label: "Couleurs", href: "/admin/couleurs" },
  { label: "Compositions", href: "/admin/compositions" },
  { label: "Saisons", href: "/admin/saisons" },
  { label: "Tailles", href: "/admin/tailles" },
  { label: "Pays d'origine", href: "/admin/pays" },
  { label: "Codes SH", href: "/admin/codes-sh" },
  { label: "Mots-clés", href: "/admin/mots-cles" },
];

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Principal",
    items: [
      { label: "Tableau de bord", href: "/admin", icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },
    ],
  },
  {
    title: "Catalogue",
    items: [
      { label: "Produits", href: "/admin/produits", icon: "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z", children: PRODUCT_SUBNAV },
      { label: "Collections", href: "/admin/collections", icon: "M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" },
      { label: "Catalogues", href: "/admin/catalogues", icon: "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" },
    ],
  },
  {
    title: "Ventes",
    items: [
      { label: "Commandes", href: "/admin/commandes", icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" },
      { label: "Clients", href: "/admin/utilisateurs", icon: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" },
      { label: "Service Client", href: "/admin/reclamations", icon: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" },
      { label: "Promotions", href: "/admin/promotions", icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" },
    ],
  },
  {
    title: "Système",
    items: [
      { label: "Documents légaux", href: "/admin/documents-legaux", icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" },
      { label: "Paramètres", href: "/admin/parametres", icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
    ],
  },
];

interface Props {
  userName: string;
  initials: string;
  warnings?: Record<string, number>;
  shopName: string;
}

function isItemActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isParentActive(pathname: string, item: NavItem): boolean {
  if (isItemActive(pathname, item.href)) return true;
  return !!item.children?.some((c) => isItemActive(pathname, c.href));
}

export default function AdminMobileNav({ userName, initials, warnings = {}, shopName }: Props) {
  const [open, setOpen] = useState(false);
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
  const pathname = usePathname() ?? "";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUBMENU_KEY);
      if (raw) setOpenMenus(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    NAV_SECTIONS.forEach((s) => {
      s.items.forEach((item) => {
        if (item.children?.some((c) => isItemActive(pathname, c.href))) {
          setOpenMenus((prev) => (prev[item.href] ? prev : { ...prev, [item.href]: true }));
        }
      });
    });
  }, [pathname]);

  function toggleSubmenu(href: string) {
    setOpenMenus((prev) => {
      const next = { ...prev, [href]: !prev[href] };
      try { localStorage.setItem(SUBMENU_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  return (
    <>
      {/* ─── Top bar mobile : sobre + hamburger ─────────────────────── */}
      <header className="lg:hidden relative h-14 sticky top-0 z-30 bg-bg-primary border-b border-border">
        <div className="relative h-full flex items-center justify-between px-3">
          <button
            onClick={() => setOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-bg-secondary border border-border hover:bg-bg-tertiary transition-colors"
            aria-label="Ouvrir le menu"
          >
            <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            </div>
            <span className="font-heading text-sm font-bold text-text-primary truncate max-w-[140px]">
              {shopName}
            </span>
          </Link>

          <div
            className="relative w-9 h-9 rounded-full flex items-center justify-center shadow-sm"
            style={{ background: "#27272A", border: "1px solid #3F3F46" }}
          >
            <span className="text-white text-[11px] font-bold">{initials}</span>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-bg-primary" />
          </div>
        </div>
      </header>

      {/* ─── Backdrop ─────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden animate-[fadeIn_120ms_ease-out]"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ─── Slide-in drawer (thème noir Variante A) ─────────────────────── */}
      <nav
        className={`fixed top-0 left-0 h-full w-[calc(100%-3rem)] max-w-[300px] z-50 transform transition-transform duration-200 ease-out lg:hidden flex flex-col rounded-r-2xl ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "#0A0A0A", color: "#A1A1AA", boxShadow: "0 25px 60px -10px rgba(0,0,0,0.5)" }}
      >
        {/* Header drawer */}
        <div className="relative flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <Link href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-3 min-w-0">
            <div
              className="relative w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm overflow-hidden shrink-0"
              style={{ background: "linear-gradient(135deg, #27272A 0%, #18181B 100%)", border: "1px solid #27272A" }}
            >
              <span className="font-heading text-base font-bold text-white">
                {shopName.charAt(0).toUpperCase()}
              </span>
              <span className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-amber-300/30 blur-xl" />
            </div>
            <div className="min-w-0">
              <p className="font-heading text-base font-bold text-white truncate leading-tight">{shopName}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-[10px] uppercase tracking-[0.18em] font-body font-semibold" style={{ color: "#71717A" }}>
                  Administration
                </p>
              </div>
            </div>
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors shrink-0 ml-2"
            style={{ background: "rgba(255,255,255,0.04)", color: "#A1A1AA" }}
            aria-label="Fermer le menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation links */}
        <div className="relative flex-1 px-3 py-4 overflow-y-auto scrollbar-dark">
          {NAV_SECTIONS.map((section, sectionIdx) => (
            <div key={section.title}>
              <div className={`flex items-center gap-2 px-3 mb-2 ${sectionIdx === 0 ? "mt-1" : "mt-5"}`}>
                <span className="w-1 h-1 rounded-full" style={{ background: "#52525B" }} />
                <p className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: "#52525B" }}>
                  {section.title}
                </p>
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const warningCount = warnings[item.href] ?? 0;
                  const active = isItemActive(pathname, item.href);
                  const parentActive = isParentActive(pathname, item);
                  const hasChildren = !!item.children?.length;
                  const sopen = !!openMenus[item.href];

                  if (item.soon) return null;

                  if (hasChildren) {
                    return (
                      <div key={item.href}>
                        {/* Item parent : Link qui navigue ET ouvre le sous-menu */}
                        <div
                          className="relative w-full flex items-center gap-3 px-3 py-2.5 text-[13.5px] font-body rounded-xl transition-colors pr-1"
                          style={{
                            background: parentActive ? "rgba(255,255,255,0.06)" : "transparent",
                            color: parentActive ? "#fff" : "#A1A1AA",
                            fontWeight: parentActive ? 600 : 500,
                          }}
                        >
                          {parentActive && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-white" />
                          )}
                          <Link
                            href={item.href}
                            onClick={() => {
                              if (!sopen) toggleSubmenu(item.href);
                              setOpen(false);
                            }}
                            className="flex items-center gap-3 flex-1 min-w-0 text-inherit no-underline"
                          >
                            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                            </svg>
                            <span className="flex-1 truncate">{item.label}</span>
                          </Link>
                          {warningCount > 0 && item.href !== "/admin/commandes" && (
                            <span className="flex items-center gap-1 text-[10.5px] rounded-full px-1.5 py-0.5 font-medium"
                              style={{ background: "rgba(245,158,11,0.15)", color: "#FCD34D", border: "1px solid rgba(245,158,11,0.2)" }}
                            >
                              ⚠ {warningCount}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleSubmenu(item.href); }}
                            aria-label={sopen ? "Replier" : "Déplier"}
                            className="w-6 h-6 rounded inline-flex items-center justify-center hover:bg-white/[0.08] transition-colors"
                          >
                            <svg
                              className={`w-3 h-3 opacity-60 transition-transform ${sopen ? "rotate-90" : ""}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                        {sopen && (
                          <div className="relative pl-3 pt-0.5 pb-1">
                            <span className="absolute left-[21px] top-1 bottom-1 w-px" style={{ background: "#27272A" }} />
                            {item.children!.map((c) => {
                              const subActive = isItemActive(pathname, c.href);
                              return (
                                <Link
                                  key={c.href}
                                  href={c.href}
                                  onClick={() => setOpen(false)}
                                  className="relative flex items-center gap-2 pl-8 pr-3 py-1.5 rounded-md text-[12.5px] transition-colors"
                                  style={{
                                    color: subActive ? "#fff" : "#71717A",
                                    background: subActive ? "rgba(255,255,255,0.05)" : "transparent",
                                    fontWeight: subActive ? 600 : 450,
                                  }}
                                >
                                  <span
                                    className="absolute left-[21px] top-1/2 w-2 h-px"
                                    style={{ background: subActive ? "#fff" : "#3F3F46", transform: "translateY(-0.5px)" }}
                                  />
                                  {c.label}
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="relative flex items-center gap-3 px-3 py-2.5 text-[13.5px] font-body rounded-xl transition-colors"
                      style={{
                        background: active ? "rgba(255,255,255,0.06)" : "transparent",
                        color: active ? "#fff" : "#A1A1AA",
                        fontWeight: active ? 600 : 500,
                      }}
                    >
                      {active && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-white" />
                      )}
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                      </svg>
                      <span className="flex-1">{item.label}</span>
                      {item.href === "/admin/commandes" && warningCount > 0 && (
                        <span className="flex items-center justify-center text-[11px] rounded-full min-w-[22px] h-[22px] px-1.5 font-semibold"
                          style={{ background: "rgba(59,130,246,0.15)", color: "#93C5FD", border: "1px solid rgba(59,130,246,0.25)" }}
                        >
                          {warningCount}
                        </span>
                      )}
                      {item.href !== "/admin/commandes" && warningCount > 0 && (
                        <span className="flex items-center gap-1 text-[10.5px] rounded-full px-1.5 py-0.5 font-medium"
                          style={{ background: "rgba(245,158,11,0.15)", color: "#FCD34D", border: "1px solid rgba(245,158,11,0.2)" }}
                        >
                          ⚠ {warningCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* User / Logout */}
        <div className="relative px-3 py-4 border-t border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="mb-2">
            <AdminClientModeButton />
          </div>
          <div
            className="relative overflow-hidden flex items-center gap-3 px-3 py-2.5 mb-2 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1F1F22" }}
          >
            <div
              className="relative w-9 h-9 rounded-full flex items-center justify-center shadow-sm shrink-0"
              style={{ background: "#27272A", border: "1px solid #3F3F46" }}
            >
              <span className="text-white text-[11px] font-bold font-body">{initials}</span>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500" style={{ boxShadow: "0 0 0 2px #0A0A0A" }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate font-body leading-tight">
                {userName}
              </p>
              <p className="text-[11px] font-body leading-tight uppercase tracking-wider font-medium" style={{ color: "#71717A" }}>
                Administrateur
              </p>
            </div>
          </div>
          <LogoutButton dark />
        </div>
        <style>{`
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        `}</style>
      </nav>
    </>
  );
}
