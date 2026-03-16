"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

interface SearchResult {
  id: string;
  name: string;
  reference: string;
  category: string;
  image: string | null;
  price: number | null;
}

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: session } = useSession();
  const router = useRouter();

  const proHref  = session ? (session.user.role === "ADMIN" ? "/admin" : "/espace-pro") : "/connexion";
  const proLabel = session ? "Mon espace" : "Connexion Pro";

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(value.trim())}`);
        const data = await res.json();
        setResults(data.results ?? []);
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/produits?q=${encodeURIComponent(searchQuery.trim())}`);
      setShowResults(false);
      setSearchQuery("");
    }
  }

  function handleResultClick(id: string) {
    setShowResults(false);
    setSearchQuery("");
    router.push(`/produits/${id}`);
  }

  return (
    <header className="sticky top-0 z-50 bg-bg-primary border-b border-border">
      <div className="container-site">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* Logo */}
          <Link href="/" className="font-[family-name:var(--font-poppins)] text-base font-bold text-text-primary tracking-tight shrink-0">
            Beli & Jolie
          </Link>

          {/* Search bar — desktop */}
          <div ref={searchRef} className="hidden md:flex flex-1 max-w-md relative z-20 isolate">
            <form onSubmit={handleSearchSubmit} className="w-full">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onFocus={() => { if (results.length > 0) setShowResults(true); }}
                  placeholder="Rechercher un produit..."
                  className="w-full bg-[#F7F7F8] border border-border rounded-lg pl-9 pr-4 py-2 text-sm font-[family-name:var(--font-roboto)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[#1A1A1A] transition-colors relative z-[1]"
                />
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none z-[2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                {loading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none z-[2]">
                    <div className="w-4 h-4 border-2 border-border border-t-text-primary rounded-full animate-spin" />
                  </div>
                )}
              </div>
            </form>

            {/* Search results dropdown */}
            {showResults && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-lg overflow-hidden z-50 max-h-96 overflow-y-auto">
                {results.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)]">
                      Aucun resultat pour &quot;{searchQuery}&quot;
                    </p>
                  </div>
                ) : (
                  <>
                    {results.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => handleResultClick(r.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F7F7F8] transition-colors text-left border-b border-[#F0F0F0] last:border-b-0"
                      >
                        {/* Image */}
                        <div className="w-12 h-12 bg-[#F0F0F0] rounded-lg overflow-hidden shrink-0">
                          {r.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.image} alt={r.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                              </svg>
                            </div>
                          )}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary truncate">
                            {r.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-mono text-text-muted">{r.reference}</span>
                            <span className="text-[10px] text-text-muted">·</span>
                            <span className="text-[10px] text-text-muted font-[family-name:var(--font-roboto)]">{r.category}</span>
                          </div>
                        </div>
                        {/* Price */}
                        {r.price !== null && (
                          <span className="text-sm font-[family-name:var(--font-poppins)] font-semibold text-text-primary shrink-0">
                            {r.price.toFixed(2)} &euro;
                          </span>
                        )}
                      </button>
                    ))}
                    {/* Voir tous les résultats */}
                    <button
                      type="button"
                      onClick={() => {
                        router.push(`/produits?q=${encodeURIComponent(searchQuery.trim())}`);
                        setShowResults(false);
                        setSearchQuery("");
                      }}
                      className="w-full px-4 py-3 text-center text-sm font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] hover:bg-[#F7F7F8] transition-colors"
                    >
                      Voir tous les resultats →
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/produits" className="text-sm font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary transition-colors">
              Catalogue
            </Link>
            <Link href="/connexion" className="text-sm font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary transition-colors">
              Connexion
            </Link>
            <Link href="/inscription" className="text-sm font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary transition-colors">
              Créer un compte
            </Link>
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            <Link href={proHref} className="btn-primary py-2 px-5 text-xs">
              {proLabel}
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 text-text-primary"
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

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-bg-primary border-t border-border px-4 py-3 space-y-3">
          {/* Mobile search */}
          <form onSubmit={(e) => { handleSearchSubmit(e); setMenuOpen(false); }}>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un produit..."
                className="w-full bg-[#F7F7F8] border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm font-[family-name:var(--font-roboto)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[#1A1A1A] transition-colors"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            </div>
          </form>

          <nav className="flex flex-col gap-0.5">
            {[
              { label: "Catalogue", href: "/produits" },
              { label: "Connexion", href: "/connexion" },
              { label: "Créer un compte", href: "/inscription" },
            ].map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)}
                className="text-sm font-[family-name:var(--font-roboto)] text-text-primary py-2.5 border-b border-border-light hover:text-text-secondary">
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
