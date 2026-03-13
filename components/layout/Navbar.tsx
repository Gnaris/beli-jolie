"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: session } = useSession();

  const proHref  = session ? (session.user.role === "ADMIN" ? "/admin" : "/espace-pro") : "/connexion";
  const proLabel = session ? "Mon espace" : "Connexion Pro";

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[#E5E5E5]">
      <div className="container-site">
        <div className="flex items-center justify-between h-14">

          {/* Logo */}
          <Link href="/" className="font-[family-name:var(--font-poppins)] text-lg font-semibold text-[#1A1A1A] tracking-wide">
            Beli <span className="text-[#999999]">&</span> Jolie
          </Link>

          {/* Nav desktop */}
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/produits" className="text-sm font-[family-name:var(--font-roboto)] text-[#555555] hover:text-[#1A1A1A] transition-colors">
              Catalogue
            </Link>
            <Link href="/connexion" className="text-sm font-[family-name:var(--font-roboto)] text-[#555555] hover:text-[#1A1A1A] transition-colors">
              Connexion
            </Link>
            <Link href="/inscription" className="text-sm font-[family-name:var(--font-roboto)] text-[#555555] hover:text-[#1A1A1A] transition-colors">
              Créer un compte
            </Link>
          </nav>

          {/* CTA desktop */}
          <div className="hidden md:flex items-center gap-3">
            <Link href={proHref} className="btn-primary py-2 px-5 text-xs">
              {proLabel}
            </Link>
          </div>

          {/* Hamburger mobile */}
          <button
            className="md:hidden p-2 text-[#1A1A1A]"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Fermer" : "Menu"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Menu mobile */}
      {menuOpen && (
        <div className="md:hidden bg-white border-t border-[#E5E5E5] px-4 py-3">
          <nav className="flex flex-col gap-0.5">
            {[
              { label: "Catalogue", href: "/produits" },
              { label: "Connexion", href: "/connexion" },
              { label: "Créer un compte", href: "/inscription" },
            ].map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)}
                className="text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] py-2.5 border-b border-[#F5F5F5] hover:text-[#555555]">
                {link.label}
              </Link>
            ))}
            <Link href={proHref} onClick={() => setMenuOpen(false)} className="btn-primary text-center mt-3 justify-center">
              {proLabel}
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
