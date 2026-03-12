"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

const NAV_LINKS = [
  { label: "Accueil", href: "/" },
  { label: "Produits", href: "/produits" },
  { label: "Collections", href: "/collections" },
  { label: "À propos", href: "/a-propos" },
  { label: "Contact", href: "/contact" },
];

export default function Navbar() {
  const [menuOpen, setMenuOpen]   = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const { data: session }         = useSession();

  const isClient = session && session.user.role === "CLIENT";
  const proHref  = session ? (session.user.role === "ADMIN" ? "/admin" : "/espace-pro") : "/connexion";
  const proLabel = session ? "Mon espace" : "Espace Pro";

  // Récupération du nombre d'articles du panier
  useEffect(() => {
    if (!isClient) return;
    fetch("/api/cart/count")
      .then((r) => r.json())
      .then((d) => setCartCount(d.count ?? 0))
      .catch(() => {});
  }, [isClient]);

  return (
    <>
      <header className="sticky top-0 z-50 bg-[#FEFAF6] border-b border-[#EDD5DC]" style={{ boxShadow: "0 1px 8px rgba(194,81,106,0.06)" }}>
        <div className="container-site">
          <div className="flex items-center justify-between h-16 md:h-20">

            {/* Hamburger — mobile */}
            <button
              className="md:hidden flex flex-col gap-1.5 p-2 text-[#1C1018]"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
              aria-expanded={menuOpen}
            >
              <span className={`block w-6 h-0.5 bg-current transition-transform duration-200 ${menuOpen ? "translate-y-2 rotate-45" : ""}`} />
              <span className={`block w-6 h-0.5 bg-current transition-opacity duration-200 ${menuOpen ? "opacity-0" : ""}`} />
              <span className={`block w-6 h-0.5 bg-current transition-transform duration-200 ${menuOpen ? "-translate-y-2 -rotate-45" : ""}`} />
            </button>

            {/* Logo */}
            <Link href="/" className="font-[family-name:var(--font-poppins)] text-xl md:text-2xl font-semibold text-[#1C1018] tracking-wide">
              Beli <span className="text-[#C2516A]">&</span> Jolie
            </Link>

            {/* Navigation desktop */}
            <nav className="hidden md:flex items-center gap-8" aria-label="Navigation principale">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href}
                  className="text-sm font-[family-name:var(--font-roboto)] text-[#6B4F5C] hover:text-[#C2516A] transition-colors duration-150 tracking-wide"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            {/* Actions desktop */}
            <div className="hidden md:flex items-center gap-3">
              {isClient && (
                <Link href="/panier" className="relative p-2 text-[#6B4F5C] hover:text-[#C2516A] transition-colors" aria-label="Panier">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                  </svg>
                  {cartCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-[#C2516A] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                      {cartCount > 99 ? "99+" : cartCount}
                    </span>
                  )}
                </Link>
              )}
              <Link href={proHref} className="btn-outline py-2 px-4 text-xs">{proLabel}</Link>
              {isClient && (
                <button type="button" onClick={() => setLogoutOpen(true)}
                  className="text-xs font-[family-name:var(--font-roboto)] text-[#B89AA6] hover:text-[#C2516A] transition-colors flex items-center gap-1.5"
                  title="Se déconnecter"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                  </svg>
                  Déconnexion
                </button>
              )}
            </div>

            {/* Icône panier mobile */}
            <Link href="/panier" className="md:hidden relative p-2 text-[#6B4F5C] hover:text-[#C2516A] transition-colors" aria-label="Panier">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              {cartCount > 0 && (
                <span className="absolute top-0 right-0 min-w-[16px] h-[16px] bg-[#C2516A] text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* Menu mobile */}
        {menuOpen && (
          <div className="md:hidden bg-[#FEFAF6] border-t border-[#EDD5DC] px-4 py-4">
            <nav className="flex flex-col gap-1" aria-label="Navigation mobile">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)}
                  className="text-base font-[family-name:var(--font-roboto)] text-[#1C1018] hover:text-[#C2516A] transition-colors py-2.5 border-b border-[#FDF0F4]"
                >
                  {link.label}
                </Link>
              ))}
              <Link href={proHref} onClick={() => setMenuOpen(false)} className="btn-primary text-center mt-3">
                {session ? "Mon espace pro" : "Espace Professionnel"}
              </Link>
              {isClient && (
                <button type="button" onClick={() => { setMenuOpen(false); setLogoutOpen(true); }}
                  className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#B89AA6] hover:text-[#C2516A] transition-colors py-2 mt-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                  </svg>
                  Déconnexion
                </button>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Modal de déconnexion */}
      {logoutOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#1C1018]/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLogoutOpen(false)}
        >
          <div className="bg-white w-full max-w-sm p-6 space-y-4 rounded-2xl shadow-spring" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FDF0F4] flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-[#C2516A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                </svg>
              </div>
              <div>
                <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1C1018]">
                  Confirmer la déconnexion
                </h3>
                <p className="text-sm text-[#6B4F5C] font-[family-name:var(--font-roboto)] mt-1">
                  Voulez-vous vraiment quitter votre session ?
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => signOut({ callbackUrl: "/connexion" })}
                className="flex-1 bg-[#C2516A] hover:bg-[#A8405A] text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-colors font-[family-name:var(--font-roboto)]"
              >
                Se déconnecter
              </button>
              <button type="button" onClick={() => setLogoutOpen(false)}
                className="flex-1 border border-[#EDD5DC] text-[#6B4F5C] hover:border-[#C2516A] hover:text-[#1C1018] text-sm font-medium py-2.5 px-4 rounded-lg transition-colors font-[family-name:var(--font-roboto)]"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
