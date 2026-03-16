"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

const NAV_ITEMS = [
  {
    label: "Catalogue",
    href: "/produits",
    showBadge: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    label: "Mon panier",
    href: "/panier",
    showBadge: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
      </svg>
    ),
  },
  {
    label: "Mes commandes",
    href: "/commandes",
    showBadge: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
  },
  {
    label: "Mon compte",
    href: "/espace-pro",
    showBadge: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
];

interface SidebarNavProps {
  pathname: string;
  cartCount: number;
  session: { user: { company?: string | null; name?: string | null; email?: string | null } } | null;
  onLogout: () => void;
}

function SidebarNav({ pathname, cartCount, session, onLogout }: SidebarNavProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-border">
        <Link href="/produits" className="font-[family-name:var(--font-poppins)] text-lg font-bold text-text-primary tracking-tight">
          Beli & Jolie
        </Link>
        <p className="text-[10px] text-text-muted font-[family-name:var(--font-roboto)] mt-0.5 uppercase tracking-widest">
          Espace Professionnel
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-[family-name:var(--font-roboto)] transition-colors ${
                active
                  ? "bg-bg-dark text-text-inverse"
                  : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
              }`}
            >
              <span className={active ? "text-text-inverse" : "text-text-muted"}>
                {item.icon}
              </span>
              {item.label}
              {item.showBadge && cartCount > 0 && (
                <span className={`ml-auto min-w-[20px] h-5 ${active ? "bg-white text-text-primary" : "bg-bg-dark text-text-inverse"} text-[10px] font-bold rounded-full flex items-center justify-center px-1`}>
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer sidebar */}
      <div className="px-3 py-4 border-t border-border space-y-0.5">
        {session?.user && (
          <div className="px-3 py-2.5 mb-1">
            <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-primary truncate">
              {(session.user.company as string) || session.user.name}
            </p>
            <p className="text-[11px] text-text-muted font-[family-name:var(--font-roboto)] truncate mt-0.5">
              {session.user.email}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-[family-name:var(--font-roboto)] text-text-muted hover:bg-bg-secondary hover:text-text-primary transition-colors w-full"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
          Déconnexion
        </button>
      </div>
    </div>
  );
}

export default function ClientSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [cartCount, setCartCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  useEffect(() => {
    fetch("/api/cart/count")
      .then((r) => r.json())
      .then((d) => setCartCount(d.count ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mobileOpen) setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const navProps: SidebarNavProps = {
    pathname,
    cartCount,
    session: session as SidebarNavProps["session"],
    onLogout: () => setLogoutOpen(true),
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col fixed left-0 top-0 h-screen w-[260px] bg-bg-primary border-r border-border z-40">
        <SidebarNav {...navProps} />
      </aside>

      {/* Mobile header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-bg-primary border-b border-border h-14 flex items-center justify-between px-4">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="p-2 text-text-primary"
          aria-label="Ouvrir le menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        <Link href="/produits" className="font-[family-name:var(--font-poppins)] text-base font-bold text-text-primary">
          Beli & Jolie
        </Link>

        <Link href="/panier" className="relative p-2 text-text-primary" aria-label="Panier">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
          </svg>
          {cartCount > 0 && (
            <span className="absolute top-0 right-0 min-w-[16px] h-4 bg-bg-dark text-text-inverse text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
              {cartCount > 99 ? "99+" : cartCount}
            </span>
          )}
        </Link>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-50 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="lg:hidden fixed left-0 top-0 h-screen w-[260px] bg-bg-primary z-50 border-r border-border">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-[family-name:var(--font-poppins)] text-base font-bold text-text-primary">Menu</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-1 text-text-muted hover:text-text-primary"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <SidebarNav {...navProps} />
          </aside>
        </>
      )}

      {/* Logout modal */}
      {logoutOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setLogoutOpen(false)}
        >
          <div className="bg-bg-primary w-full max-w-sm p-6 rounded-xl shadow-xl border border-border" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary mb-2">
              Confirmer la déconnexion
            </h3>
            <p className="text-sm text-text-secondary font-[family-name:var(--font-roboto)] mb-5">
              Voulez-vous vraiment quitter votre session ?
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => signOut({ callbackUrl: "/connexion" })}
                className="flex-1 btn-primary justify-center">
                Déconnexion
              </button>
              <button type="button" onClick={() => setLogoutOpen(false)}
                className="flex-1 btn-secondary justify-center">
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
