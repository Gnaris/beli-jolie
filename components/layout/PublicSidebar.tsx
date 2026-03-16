"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { disableAdminPreview } from "@/app/actions/admin/preview-mode";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";

/* -- Icons ---------------------------------------- */
function IconCart() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
    </svg>
  );
}
function IconMenu() {
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
function IconLogout() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
  );
}

/* -- Component ------------------------------------ */
interface SearchResult {
  id: string;
  name: string;
  reference: string;
  category: string;
  image: string | null;
  price: number | null;
}

export default function PublicSidebar() {
  const t      = useTranslations("nav");
  const locale = useLocale();

  const [mobileOpen, setMobileOpen]       = useState(false);
  const [cartCount, setCartCount]         = useState(0);
  const [scrolled, setScrolled]           = useState(false);
  const [isAdminPreview, setIsAdminPreview] = useState(false);
  const [previewPending] = useTransition();
  const pathname  = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  // Nav links (labels from translations)
  const NAV_LINKS = [
    { label: t("home"),        href: "/" },
    { label: t("products"),    href: "/produits" },
    { label: t("categories"),  href: "/categories" },
    { label: t("collections"), href: "/collections" },
  ];

  const CLIENT_LINKS = [
    { label: t("orders"),    href: "/commandes" },
    { label: t("favorites"), href: "/favoris" },
  ];

  // Détecte le cookie mode aperçu admin (recalculé à chaque changement de page)
  useEffect(() => {
    setIsAdminPreview(document.cookie.includes("bj_admin_preview=1"));
  }, [pathname]);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
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
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(value.trim())}`);
        const data = await res.json();
        setSearchResults(data.results ?? []);
        setShowResults(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
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

  const isClient     = session?.user?.role === "CLIENT";
  const isAdminMode  = session?.user?.role === "ADMIN" && isAdminPreview;
  const showClientUI = isClient || isAdminMode;
  const company      = (session?.user as { company?: string })?.company ?? session?.user?.name ?? "";
  const initials     = company ? company.slice(0, 2).toUpperCase() : "?";

  useEffect(() => {
    if (showClientUI) {
      fetch("/api/cart/count")
        .then((r) => r.json())
        .then((d) => setCartCount(d.count ?? 0))
        .catch(() => {});
    }
  }, [showClientUI]);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* ===== TOP NAVBAR - fixed ===== */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 bg-bg-primary transition-shadow duration-200 ${
          scrolled ? "shadow-[0_1px_0_var(--color-border),0_4px_16px_rgba(0,0,0,0.04)]" : "border-b border-border"
        }`}
      >
        <div className="container-site h-16 flex items-center gap-6">

          {/* Logo */}
          <Link
            href="/"
            className="font-[family-name:var(--font-poppins)] text-base font-bold text-text-primary tracking-tight shrink-0"
          >
            Beli & Jolie
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 flex-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors font-[family-name:var(--font-roboto)] ${
                  isActive(link.href)
                    ? "bg-bg-tertiary text-text-primary font-medium"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
                }`}
              >
                {link.label}
              </Link>
            ))}
            {showClientUI && CLIENT_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors font-[family-name:var(--font-roboto)] ${
                  isActive(link.href)
                    ? "bg-bg-tertiary text-text-primary font-medium"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Search bar (desktop only) */}
          <div ref={searchRef} className="hidden lg:flex items-center relative w-72 z-20">
            <form onSubmit={handleSearchSubmit} className="w-full">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onFocus={() => { if (searchResults.length > 0) setShowResults(true); }}
                  placeholder={t("search")}
                  className="w-full bg-bg-secondary border border-border-light rounded-lg pl-9 pr-4 py-2 text-sm font-[family-name:var(--font-roboto)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-primary transition-colors"
                />
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                {searchLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <div className="w-4 h-4 border-2 border-border border-t-text-primary rounded-full animate-spin" />
                  </div>
                )}
              </div>
            </form>

            {/* Search results dropdown */}
            {showResults && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-lg overflow-hidden z-50 max-h-96 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)]">
                      {t("searchNoResults")} &quot;{searchQuery}&quot;
                    </p>
                  </div>
                ) : (
                  <>
                    {searchResults.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => handleResultClick(r.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-secondary transition-colors text-left border-b border-border-light last:border-b-0"
                      >
                        <div className="w-11 h-11 bg-bg-tertiary rounded-lg overflow-hidden shrink-0">
                          {r.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.image} alt={r.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary truncate">{r.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-mono text-text-muted">{r.reference}</span>
                            <span className="text-[10px] text-text-muted">·</span>
                            <span className="text-[10px] text-text-muted font-[family-name:var(--font-roboto)]">{r.category}</span>
                          </div>
                        </div>
                        {r.price !== null && (
                          <span className="text-sm font-[family-name:var(--font-poppins)] font-semibold text-text-primary shrink-0">
                            {r.price.toFixed(2)} €
                          </span>
                        )}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        router.push(`/produits?q=${encodeURIComponent(searchQuery.trim())}`);
                        setShowResults(false);
                        setSearchQuery("");
                      }}
                      className="w-full px-4 py-3 text-center text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary hover:bg-bg-secondary transition-colors"
                    >
                      {t("searchResults")} →
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 ml-auto">

            {/* Language switcher */}
            <LanguageSwitcher currentLocale={locale} />

            {/* Cart */}
            {showClientUI && (
              <Link
                href="/panier"
                className="relative flex items-center justify-center w-9 h-9 text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors"
                aria-label={t("cart")}
              >
                <IconCart />
                {cartCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-bg-dark text-text-inverse text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </Link>
            )}

            {/* Logged-in user */}
            {session ? (
              <div className="hidden md:flex items-center gap-2">
                <Link href="/espace-pro" className="flex items-center gap-2.5 px-3 py-1.5 bg-bg-secondary rounded-lg border border-border-light hover:border-border-dark transition-colors">
                  <div className="w-6 h-6 rounded-full bg-bg-dark flex items-center justify-center shrink-0">
                    <span className="text-text-inverse text-[10px] font-bold font-[family-name:var(--font-roboto)]">{initials}</span>
                  </div>
                  <span className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)] max-w-[120px] truncate">
                    {company}
                  </span>
                </Link>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="flex items-center justify-center w-9 h-9 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors"
                  aria-label={t("logout")}
                >
                  <IconLogout />
                </button>
              </div>
            ) : (
              <Link
                href="/connexion"
                className="hidden md:inline-flex btn-primary text-xs py-2 px-4"
              >
                {t("login")}
              </Link>
            )}

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden flex items-center justify-center w-9 h-9 text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors"
              aria-label="Menu"
            >
              <IconMenu />
            </button>
          </div>
        </div>
      </header>

      {/* ===== MOBILE DRAWER ===== */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-50 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 w-72 bg-bg-primary z-50 md:hidden flex flex-col shadow-2xl">

            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className="font-[family-name:var(--font-poppins)] text-base font-bold text-text-primary"
              >
                Beli & Jolie
              </Link>
              <button
                onClick={() => setMobileOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg"
              >
                <IconClose />
              </button>
            </div>

            {/* Links */}
            <nav className="flex-1 px-4 py-4 overflow-y-auto space-y-1">
              <p className="text-[10px] text-text-muted uppercase tracking-[0.15em] font-[family-name:var(--font-roboto)] px-3 pb-1 pt-2">
                Boutique
              </p>
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center px-3 py-2.5 text-sm rounded-lg transition-colors font-[family-name:var(--font-roboto)] ${
                    isActive(link.href)
                      ? "bg-bg-tertiary text-text-primary font-medium"
                      : "text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
                  }`}
                >
                  {link.label}
                </Link>
              ))}

              {showClientUI && (
                <>
                  <p className="text-[10px] text-text-muted uppercase tracking-[0.15em] font-[family-name:var(--font-roboto)] px-3 pb-1 pt-4">
                    {t("account")}
                  </p>
                  {CLIENT_LINKS.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center justify-between px-3 py-2.5 text-sm rounded-lg transition-colors font-[family-name:var(--font-roboto)] ${
                        isActive(link.href)
                          ? "bg-bg-tertiary text-text-primary font-medium"
                          : "text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
                      }`}
                    >
                      {link.label}
                      {link.href === "/panier" && cartCount > 0 && (
                        <span className="w-5 h-5 bg-bg-dark text-text-inverse text-[10px] font-bold rounded-full flex items-center justify-center">
                          {cartCount}
                        </span>
                      )}
                    </Link>
                  ))}
                </>
              )}

              {/* Language switcher in mobile drawer */}
              <div className="px-3 pt-4">
                <p className="text-[10px] text-text-muted uppercase tracking-[0.15em] font-[family-name:var(--font-roboto)] pb-2">
                  Langue / Language
                </p>
                <LanguageSwitcher currentLocale={locale} />
              </div>
            </nav>

            {/* Drawer footer */}
            <div className="px-4 py-4 border-t border-border-light">
              {session ? (
                <>
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-bg-secondary rounded-lg mb-2">
                    <div className="w-8 h-8 rounded-full bg-bg-dark flex items-center justify-center shrink-0">
                      <span className="text-text-inverse text-[11px] font-bold">{initials}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate font-[family-name:var(--font-roboto)]">{company}</p>
                      <p className="text-xs text-text-muted truncate font-[family-name:var(--font-roboto)]">{session.user.email}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setMobileOpen(false); signOut({ callbackUrl: "/" }); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors font-[family-name:var(--font-roboto)]"
                  >
                    <IconLogout />
                    {t("logout")}
                  </button>
                </>
              ) : (
                <Link
                  href="/connexion"
                  onClick={() => setMobileOpen(false)}
                  className="btn-primary w-full justify-center"
                >
                  {t("login")}
                </Link>
              )}
            </div>
          </div>
        </>
      )}

      {/* Spacer for fixed navbar */}
      <div className="h-16" />

      {/* ── Bandeau mode aperçu admin ── */}
      {session?.user?.role === "ADMIN" && isAdminPreview && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#1A1A1A] text-white px-4 py-3 flex items-center justify-between gap-4 shadow-[0_-2px_12px_rgba(0,0,0,0.3)]">
          <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)]">
            <svg className="w-4 h-4 text-[#F59E0B] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span className="font-semibold text-[#F59E0B]">Mode aperçu admin</span>
            <span className="text-white/60 hidden sm:inline">— Vous naviguez comme un client.</span>
          </div>
          <form action={disableAdminPreview}>
            <button
              type="submit"
              disabled={previewPending}
              className="text-xs font-[family-name:var(--font-roboto)] font-semibold bg-white text-[#1A1A1A] px-4 py-1.5 rounded-lg hover:bg-[#F0F0F0] transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {previewPending ? "..." : t("backToAdmin")}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
