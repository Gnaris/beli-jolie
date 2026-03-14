"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

/* ── Boutique nav items ───────────────────── */
const BOUTIQUE_ITEMS = [
  {
    label: "Accueil",
    href: "/",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    label: "Produits",
    href: "/produits",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    label: "Catégories",
    href: "/categories",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 6h.008v.008H6V6z" />
      </svg>
    ),
  },
  {
    label: "Collections",
    href: "/collections",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
      </svg>
    ),
  },
];

/* ── Mon espace nav items ─────────────────── */
const MON_ESPACE_ITEMS = [
  {
    label: "Tableau de bord",
    href: "/espace-pro",
    badge: false,
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
      </svg>
    ),
  },
  {
    label: "Commandes",
    href: "/commandes",
    badge: false,
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
  },
  {
    label: "Panier",
    href: "/panier",
    badge: true,
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
      </svg>
    ),
  },
  {
    label: "Favoris",
    href: "/favoris",
    badge: false,
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
      </svg>
    ),
  },
];

/* ── SVG icons ────────────────────────────── */
function IconHamburger() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
function IconCart() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
  );
}
function IconLogin() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  );
}

/* ── Nav link style ───────────────────────── */
function navClass(active: boolean) {
  return `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-[family-name:var(--font-roboto)] transition-colors ${
    active
      ? "bg-[#1C1018] text-white"
      : "text-[#555555] hover:bg-[#F5F5F5] hover:text-[#1A1A1A]"
  }`;
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 pt-4 pb-1 text-[10px] font-[family-name:var(--font-roboto)] font-semibold text-[#AAAAAA] uppercase tracking-widest">
      {label}
    </p>
  );
}

/* ── Component ────────────────────────────── */
export default function PublicSidebar() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const pathname = usePathname();
  const { data: session } = useSession();

  const isClient = session?.user?.role === "CLIENT";

  useEffect(() => {
    if (isClient) {
      fetch("/api/cart/count")
        .then((r) => r.json())
        .then((d) => setCartCount(d.count ?? 0))
        .catch(() => {});
    }
  }, [isClient]);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const cartHref = session ? "/panier" : "/connexion";

  /* ── Sidebar content (shared desktop + drawer) ── */
  const SidebarContent = ({ onNav }: { onNav?: () => void }) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-[#E5E5E5]">
        <Link
          href="/"
          onClick={onNav}
          className="font-[family-name:var(--font-poppins)] text-lg font-semibold text-[#1A1A1A] tracking-wide"
        >
          Beli <span className="text-[#999999]">&</span> Jolie
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {/* ── Boutique ── */}
        <SectionLabel label="Boutique" />
        <div className="space-y-0.5">
          {BOUTIQUE_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNav}
              className={navClass(isActive(item.href))}
            >
              <span className={isActive(item.href) ? "text-white" : "text-[#AAAAAA]"}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </div>

        {/* ── Mon espace (CLIENT uniquement) ── */}
        {isClient && (
          <>
            <SectionLabel label="Mon espace" />
            <div className="space-y-0.5">
              {MON_ESPACE_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNav}
                  className={navClass(isActive(item.href))}
                >
                  <span className={isActive(item.href) ? "text-white" : "text-[#AAAAAA]"}>
                    {item.icon}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge && cartCount > 0 && (
                    <span className={`min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold px-1 ${isActive(item.href) ? "bg-white text-[#1C1018]" : "bg-[#1C1018] text-white"}`}>
                      {cartCount > 9 ? "9+" : cartCount}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Bas de sidebar */}
      <div className="px-3 py-4 border-t border-[#E5E5E5] space-y-0.5">
        {session ? (
          <>
            {session.user && (
              <div className="px-3 py-2 mb-1">
                <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#1A1A1A] truncate">
                  {(session.user as { company?: string }).company || session.user.name}
                </p>
                <p className="text-[11px] text-[#999999] font-[family-name:var(--font-roboto)] truncate mt-0.5">
                  {session.user.email}
                </p>
              </div>
            )}
            <button
              onClick={() => { onNav?.(); signOut({ callbackUrl: "/" }); }}
              className={navClass(false) + " w-full text-left"}
            >
              <IconLogout />
              <span>Se déconnecter</span>
            </button>
          </>
        ) : (
          <Link href="/connexion" onClick={onNav} className={navClass(pathname === "/connexion")}>
            <IconLogin />
            <span>Connexion</span>
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* ════════════════════════════════════════
          DESKTOP — sidebar fixe à gauche
      ════════════════════════════════════════ */}
      <aside className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-60 bg-white border-r border-[#E5E5E5] z-40">
        <SidebarContent />
      </aside>

      {/* ════════════════════════════════════════
          MOBILE — en-tête fixe
      ════════════════════════════════════════ */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-[#E5E5E5] h-14 flex items-center px-4">
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-1.5 text-[#1A1A1A]"
          aria-label="Ouvrir le menu"
        >
          <IconHamburger />
        </button>

        <div className="flex-1 flex justify-center">
          <Link
            href="/"
            className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] tracking-wide"
          >
            Beli <span className="text-[#999999]">&</span> Jolie
          </Link>
        </div>

        <div className="flex items-center gap-0.5">
          <Link href={cartHref} className="relative p-1.5 text-[#1A1A1A]" aria-label="Panier">
            <IconCart />
            {cartCount > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-[#1A1A1A] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {cartCount > 9 ? "9+" : cartCount}
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* ════════════════════════════════════════
          MOBILE — drawer latéral
      ════════════════════════════════════════ */}
      {drawerOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/40 z-50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="lg:hidden fixed inset-y-0 left-0 w-64 bg-white z-50 flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-4 border-b border-[#E5E5E5]">
              <Link
                href="/"
                onClick={() => setDrawerOpen(false)}
                className="font-[family-name:var(--font-poppins)] text-lg font-semibold text-[#1A1A1A]"
              >
                Beli <span className="text-[#999999]">&</span> Jolie
              </Link>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1 text-[#555555]"
                aria-label="Fermer"
              >
                <IconClose />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SidebarContent onNav={() => setDrawerOpen(false)} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
