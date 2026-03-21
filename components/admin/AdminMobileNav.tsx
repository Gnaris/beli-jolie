"use client";

import { useState } from "react";
import Link from "next/link";
import LogoutButton from "./LogoutModal";
import AdminClientModeButton from "./AdminClientModeButton";
import LiveCountBadge from "./LiveCountBadge";

const NAV_SECTIONS = [
  {
    title: "Principal",
    items: [
      { label: "Tableau de bord", href: "/admin", icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },
    ],
  },
  {
    title: "Catalogue",
    items: [
      { label: "Produits", href: "/admin/produits", icon: "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" },
      { label: "Collections", href: "/admin/collections", icon: "M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" },
      { label: "Catalogues", href: "/admin/catalogues", icon: "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" },
      { label: "Catégories", href: "/admin/categories", icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z" },
      { label: "Sync PFS", href: "/admin/pfs", icon: "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" },
    ],
  },
  {
    title: "Attributs",
    items: [
      { label: "Couleurs", href: "/admin/couleurs", icon: "M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" },
      { label: "Compositions", href: "/admin/compositions", icon: "M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" },
      { label: "Mots clés", href: "/admin/mots-cles", icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6 6h.008v.008H6V6z" },
    ],
  },
  {
    title: "Ventes",
    items: [
      { label: "Commandes", href: "/admin/commandes", icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" },
      { label: "Clients", href: "/admin/utilisateurs", icon: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" },
      { label: "Suivi en direct", href: "/admin/suivi", icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" },
    ],
  },
  {
    title: "Accès",
    items: [
      { label: "Codes d'accès", href: "/admin/codes-acces", icon: "M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" },
    ],
  },
  {
    title: "Système",
    items: [
      { label: "Paramètres", href: "/admin/parametres", icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
    ],
  },
];

interface Props {
  userName: string;
  initials: string;
  warnings?: Record<string, number>;
}

export default function AdminMobileNav({ userName, initials, warnings = {} }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile header bar */}
      <header className="lg:hidden bg-bg-primary border-b border-border h-14 flex items-center justify-between px-4 sticky top-0 z-30">
        <button
          onClick={() => setOpen(true)}
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
          aria-label="Ouvrir le menu"
        >
          <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        <Link href="/admin" className="font-[family-name:var(--font-poppins)] text-base font-bold text-text-primary">
          Beli & Jolie
        </Link>

        <div className="w-8 h-8 rounded-full bg-bg-dark flex items-center justify-center">
          <span className="text-text-inverse text-[11px] font-bold">{initials}</span>
        </div>
      </header>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-in drawer */}
      <nav
        className={`fixed top-0 left-0 h-full w-[calc(100%-3rem)] max-w-[280px] bg-bg-primary border-r border-border z-50 transform transition-transform duration-200 ease-out lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="font-[family-name:var(--font-poppins)] text-base font-bold text-text-primary">Beli & Jolie</p>
            <p className="text-[10px] text-text-muted uppercase tracking-wider font-[family-name:var(--font-roboto)]">Administration</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
            aria-label="Fermer le menu"
          >
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation links */}
        <div className="flex-1 px-3 py-4 overflow-y-auto">
          {NAV_SECTIONS.map((section, sectionIdx) => (
            <div key={section.title}>
              <p className={`text-[10px] uppercase tracking-widest text-[#999] font-medium px-3 mb-2 ${sectionIdx === 0 ? "mt-1" : "mt-5"}`}>
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const warningCount = warnings[item.href] ?? 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 text-sm font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors group"
                    >
                      <svg className="w-4 h-4 text-text-muted group-hover:text-text-secondary transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                      </svg>
                      <span className="flex-1">{item.label}</span>
                      {item.href === "/admin/suivi" && <LiveCountBadge />}
                      {item.href === "/admin/commandes" && warningCount > 0 && (
                        <span className="flex items-center justify-center text-[11px] bg-blue-100 text-blue-700 border border-blue-200 rounded-full min-w-[22px] h-[22px] px-1.5 font-semibold shrink-0">
                          {warningCount}
                        </span>
                      )}
                      {item.href !== "/admin/commandes" && warningCount > 0 && (
                        <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-medium shrink-0">
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
        <div className="px-3 py-4 border-t border-border">
          <div className="mb-2">
            <AdminClientModeButton />
          </div>
          <div className="flex items-center gap-3 px-3 py-2.5 mb-1 bg-bg-secondary rounded-lg">
            <div className="w-8 h-8 rounded-full bg-bg-dark flex items-center justify-center shrink-0">
              <span className="text-text-inverse text-[11px] font-bold font-[family-name:var(--font-roboto)]">{initials}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary truncate font-[family-name:var(--font-roboto)] leading-tight">
                {userName}
              </p>
              <p className="text-[11px] text-text-muted font-[family-name:var(--font-roboto)] leading-tight">
                Administrateur
              </p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </nav>
    </>
  );
}
