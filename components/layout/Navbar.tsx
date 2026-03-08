"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

/**
 * Liens de navigation principale
 */
const NAV_LINKS = [
  { label: "Accueil", href: "/" },
  { label: "Produits", href: "/produits" },
  { label: "Collections", href: "/collections" },
  { label: "À propos", href: "/a-propos" },
  { label: "Contact", href: "/contact" },
];

/**
 * Navbar principale — responsive mobile-first
 * - Logo centré sur mobile, à gauche sur desktop
 * - Menu hamburger sur mobile
 * - CTA "Espace Pro" visible sur desktop
 */
export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: session } = useSession();

  // Lien CTA selon l'état de connexion
  const proHref = session
    ? session.user.role === "ADMIN" ? "/admin" : "/espace-pro"
    : "/connexion";
  const proLabel = session ? "Mon espace" : "Espace Pro";

  return (
    <header className="sticky top-0 z-50 bg-[#FDFAF6] border-b border-[#D4CCBE]">
      <div className="container-site">
        <div className="flex items-center justify-between h-16 md:h-20">

          {/* Hamburger — mobile uniquement */}
          <button
            className="md:hidden flex flex-col gap-1.5 p-2 text-[#2C2418]"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={menuOpen}
          >
            <span className={`block w-6 h-0.5 bg-current transition-transform duration-200 ${menuOpen ? "translate-y-2 rotate-45" : ""}`} />
            <span className={`block w-6 h-0.5 bg-current transition-opacity duration-200 ${menuOpen ? "opacity-0" : ""}`} />
            <span className={`block w-6 h-0.5 bg-current transition-transform duration-200 ${menuOpen ? "-translate-y-2 -rotate-45" : ""}`} />
          </button>

          {/* Logo */}
          <Link
            href="/"
            className="font-[family-name:var(--font-poppins)] text-xl md:text-2xl font-semibold text-[#2C2418] tracking-wide"
          >
            Beli <span className="text-[#8B7355]">&</span> Jolie
          </Link>

          {/* Navigation desktop */}
          <nav className="hidden md:flex items-center gap-8" aria-label="Navigation principale">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-[family-name:var(--font-roboto)] text-[#6B5B45] hover:text-[#8B7355] transition-colors duration-150 tracking-wide"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Actions desktop */}
          <div className="hidden md:flex items-center gap-4">
            <Link href={proHref} className="btn-outline py-2 px-4 text-xs">
              {proLabel}
            </Link>
          </div>

          {/* Icône panier — mobile */}
          <Link
            href="/panier"
            className="md:hidden p-2 text-[#6B5B45] hover:text-[#8B7355] transition-colors"
            aria-label="Panier"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Menu mobile déroulant */}
      {menuOpen && (
        <div className="md:hidden bg-[#FDFAF6] border-t border-[#D4CCBE] px-4 py-4">
          <nav className="flex flex-col gap-4" aria-label="Navigation mobile">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-base font-[family-name:var(--font-roboto)] text-[#2C2418] hover:text-[#8B7355] transition-colors py-1 border-b border-[#EDE8DF]"
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href={proHref}
              className="btn-primary text-center mt-2"
              onClick={() => setMenuOpen(false)}
            >
              {session ? "Mon espace pro" : "Espace Professionnel"}
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
