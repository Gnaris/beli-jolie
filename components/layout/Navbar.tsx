"use client";

import { useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { data: session } = useSession();

  const isClient = session && session.user.role === "CLIENT";
  const proHref  = session ? (session.user.role === "ADMIN" ? "/admin" : "/espace-pro") : "/connexion";
  const proLabel = session ? "Mon espace" : "Espace Pro";

  return (
    <>
      <header className="sticky top-0 z-50 bg-[#FFFFFF] border-b border-[#E2E8F0]">
        <div className="container-site">
          <div className="flex items-center justify-between h-16 md:h-20">

            {/* Hamburger — mobile */}
            <button
              className="md:hidden flex flex-col gap-1.5 p-2 text-[#0F172A]"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
              aria-expanded={menuOpen}
            >
              <span className={`block w-6 h-0.5 bg-current transition-transform duration-200 ${menuOpen ? "translate-y-2 rotate-45" : ""}`} />
              <span className={`block w-6 h-0.5 bg-current transition-opacity duration-200 ${menuOpen ? "opacity-0" : ""}`} />
              <span className={`block w-6 h-0.5 bg-current transition-transform duration-200 ${menuOpen ? "-translate-y-2 -rotate-45" : ""}`} />
            </button>

            {/* Logo */}
            <Link href="/" className="font-[family-name:var(--font-poppins)] text-xl md:text-2xl font-semibold text-[#0F172A] tracking-wide">
              Beli <span className="text-[#0F3460]">&</span> Jolie
            </Link>

            {/* Navigation desktop */}
            <nav className="hidden md:flex items-center gap-8" aria-label="Navigation principale">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href}
                  className="text-sm font-[family-name:var(--font-roboto)] text-[#475569] hover:text-[#0F3460] transition-colors duration-150 tracking-wide"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            {/* Actions desktop */}
            <div className="hidden md:flex items-center gap-3">
              <Link href={proHref} className="btn-outline py-2 px-4 text-xs">{proLabel}</Link>
              {isClient && (
                <button type="button" onClick={() => setLogoutOpen(true)}
                  className="text-xs font-[family-name:var(--font-roboto)] text-[#94A3B8] hover:text-red-500 transition-colors flex items-center gap-1.5"
                  title="Se déconnecter"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                  </svg>
                  Déconnexion
                </button>
              )}
            </div>

            {/* Icône mobile */}
            <Link href="/panier" className="md:hidden p-2 text-[#475569] hover:text-[#0F3460] transition-colors" aria-label="Panier">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Menu mobile */}
        {menuOpen && (
          <div className="md:hidden bg-[#FFFFFF] border-t border-[#E2E8F0] px-4 py-4">
            <nav className="flex flex-col gap-4" aria-label="Navigation mobile">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)}
                  className="text-base font-[family-name:var(--font-roboto)] text-[#0F172A] hover:text-[#0F3460] transition-colors py-1 border-b border-[#F1F5F9]"
                >
                  {link.label}
                </Link>
              ))}
              <Link href={proHref} onClick={() => setMenuOpen(false)} className="btn-primary text-center mt-2">
                {session ? "Mon espace pro" : "Espace Professionnel"}
              </Link>
              {isClient && (
                <button type="button" onClick={() => { setMenuOpen(false); setLogoutOpen(true); }}
                  className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#94A3B8] hover:text-red-500 transition-colors py-2"
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

      {/* Modal de déconnexion — même design que côté admin */}
      {logoutOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setLogoutOpen(false)}
        >
          <div className="bg-white w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                </svg>
              </div>
              <div>
                <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#0F172A]">
                  Confirmer la déconnexion
                </h3>
                <p className="text-sm text-[#475569] font-[family-name:var(--font-roboto)] mt-1">
                  Voulez-vous vraiment quitter votre session ?
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => signOut({ callbackUrl: "/connexion" })}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-medium py-2 px-4 transition-colors font-[family-name:var(--font-roboto)]"
              >
                Se déconnecter
              </button>
              <button type="button" onClick={() => setLogoutOpen(false)}
                className="flex-1 border border-[#E2E8F0] text-[#475569] hover:border-[#0F3460] hover:text-[#0F172A] text-sm font-medium py-2 px-4 transition-colors font-[family-name:var(--font-roboto)]"
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
