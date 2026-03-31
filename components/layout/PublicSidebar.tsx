"use client";

import { useState, useEffect, useRef, useTransition, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
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

interface PublicSidebarProps {
  shopName: string;
}

export default function PublicSidebar({ shopName }: PublicSidebarProps) {
  const t      = useTranslations("nav");
  const locale = useLocale();

  const [mobileOpen, setMobileOpen]       = useState(false);
  const [cartCount, setCartCount]         = useState(0);
  const [prevCount, setPrevCount]         = useState(0);
  const [badgeBounce, setBadgeBounce]     = useState(false);
  const [scrolled, setScrolled]           = useState(false);
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

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchAbortRef = useRef<AbortController | null>(null);

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
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(value.trim())}`, { signal: controller.signal });
        const data = await res.json();
        setSearchResults(data.results ?? []);
        setShowResults(true);
      } catch {
        if (!controller.signal.aborted) setSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
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
  const isAdmin      = session?.user?.role === "ADMIN";
  const showClientUI = isClient || isAdmin;
  const company      = (session?.user as { company?: string })?.company ?? session?.user?.name ?? "";
  const initials     = company ? company.slice(0, 2).toUpperCase() : "?";

  useEffect(() => {
    if (!showClientUI) return;
    const controller = new AbortController();
    fetch("/api/cart/count", { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        const newCount = d.count ?? 0;
        setCartCount(newCount);
        if (newCount !== prevCount && newCount > 0) {
          setBadgeBounce(true);
          setTimeout(() => setBadgeBounce(false), 500);
          setPrevCount(newCount);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showClientUI]);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  // ── Sliding bubble indicator ──
  const navContainerRef = useRef<HTMLElement>(null);
  const [bubble, setBubble] = useState<{ left: number; width: number } | null>(null);
  const bubbleInitRef = useRef(false);

  const allLinks = showClientUI ? [...NAV_LINKS, ...CLIENT_LINKS] : NAV_LINKS;

  const updateBubble = useCallback(() => {
    const container = navContainerRef.current;
    if (!container) return;
    const activeLink = container.querySelector<HTMLElement>("[data-nav-active='true']");
    if (activeLink) {
      const containerRect = container.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      // Skip if nav is hidden (mobile)
      if (containerRect.width === 0) return;
      setBubble({
        left: linkRect.left - containerRect.left,
        width: linkRect.width,
      });
    } else {
      setBubble(null);
    }
  }, []);

  // Recalculate bubble on pathname change and on mount
  useEffect(() => {
    // Use rAF to ensure DOM has painted with correct active states
    const raf = requestAnimationFrame(() => {
      updateBubble();
      bubbleInitRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname, updateBubble, showClientUI]);

  useEffect(() => {
    window.addEventListener("resize", updateBubble);
    return () => window.removeEventListener("resize", updateBubble);
  }, [updateBubble]);

  return (
    <>
      {/* ===== TOP NAVBAR - fixed ===== */}
      <header
        className="fixed top-3 left-4 right-4 z-50 bg-white/85 backdrop-blur-xl rounded-2xl border border-white/60 shadow-[8px_8px_20px_rgba(26,86,219,0.1),-6px_-6px_16px_rgba(255,255,255,0.85)] transition-all duration-200"
      >
        <div className="container-site h-16 flex items-center gap-6">

          {/* Mobile hamburger — LEFT on mobile */}
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden flex items-center justify-center w-9 h-9 text-text-secondary hover:text-text-primary bg-bg-secondary shadow-[inset_2px_2px_5px_rgba(0,0,0,0.05),inset_-1px_-1px_3px_rgba(255,255,255,0.8)] hover:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.07),inset_-2px_-2px_4px_rgba(255,255,255,0.7)] rounded-[10px] transition-colors"
            aria-label="Menu"
          >
            <IconMenu />
          </button>

          {/* Logo — centered on mobile, left on desktop */}
          <Link
            href="/"
            className="relative font-heading text-base font-bold text-text-primary tracking-tight shrink-0 group shimmer-overlay overflow-hidden lg:mr-0 max-lg:absolute max-lg:left-1/2 max-lg:-translate-x-1/2"
          >
            {shopName}
          </Link>

          {/* Desktop nav */}
          <nav ref={navContainerRef} className="hidden lg:flex items-center gap-1 flex-1 relative">
            {/* Sliding bubble indicator */}
            <span
              className="absolute top-0 h-full bg-bg-secondary/80 rounded-md pointer-events-none z-0"
              style={{
                left: bubble?.left ?? 0,
                width: bubble?.width ?? 0,
                opacity: bubble ? 1 : 0,
                transition: bubbleInitRef.current
                  ? "left 0.35s cubic-bezier(0.4, 0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease"
                  : "opacity 0.3s ease",
              }}
            />
            {allLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                data-nav-active={isActive(link.href) ? "true" : undefined}
                className={`relative z-10 px-3 py-1.5 text-sm rounded-md transition-colors duration-200 font-body ${
                  isActive(link.href)
                    ? "text-text-primary font-medium"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {link.label}
                {isActive(link.href) && (
                  <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-text-primary rounded-full animate-slide-in" />
                )}
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
                  aria-expanded={showResults}
                  aria-autocomplete="list"
                  role="combobox"
                  className="w-full bg-bg-secondary border-none rounded-xl shadow-[inset_3px_3px_8px_rgba(0,0,0,0.06),inset_-2px_-2px_6px_rgba(255,255,255,0.8)] focus:ring-2 focus:ring-accent/30 pl-9 pr-4 py-2 text-sm font-body text-text-primary placeholder:text-text-muted focus:outline-none transition-colors"
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
              <div role="listbox" aria-label={t("searchResults")} className="absolute top-full left-0 right-0 mt-2 bg-bg-primary/95 backdrop-blur-lg border border-white/60 rounded-2xl shadow-[8px_8px_20px_rgba(26,86,219,0.1),-6px_-6px_16px_rgba(255,255,255,0.85)] overflow-hidden z-50 max-h-96 overflow-y-auto animate-fadeIn">
                {searchResults.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-text-muted font-body">
                      {t("searchNoResults")} &quot;{searchQuery}&quot;
                    </p>
                  </div>
                ) : (
                  <>
                    {searchResults.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        role="option"
                        onClick={() => handleResultClick(r.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-secondary transition-colors text-left border-b border-border-light last:border-b-0"
                      >
                        <div className="w-11 h-11 bg-bg-tertiary rounded-lg overflow-hidden shrink-0">
                          {r.image ? (
                            <Image src={r.image} alt={r.name} width={80} height={80} unoptimized className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-body font-medium text-text-primary truncate">{r.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-mono text-text-muted">{r.reference}</span>
                            <span className="text-[10px] text-text-muted">·</span>
                            <span className="text-[10px] text-text-muted font-body">{r.category}</span>
                          </div>
                        </div>
                        {r.price !== null && (
                          <span className="text-sm font-heading font-semibold text-text-primary shrink-0">
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
                      className="w-full px-4 py-3 text-center text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors"
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
                className="relative flex items-center justify-center w-9 h-9 text-text-secondary hover:text-text-primary bg-bg-secondary shadow-[inset_2px_2px_5px_rgba(0,0,0,0.05),inset_-1px_-1px_3px_rgba(255,255,255,0.8)] hover:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.07),inset_-2px_-2px_4px_rgba(255,255,255,0.7)] rounded-[10px] transition-colors"
                aria-label={t("cart")}
              >
                <IconCart />
                {cartCount > 0 && (
                  <span className={`absolute top-1 right-1 w-4 h-4 bg-bg-dark text-text-inverse text-[9px] font-bold rounded-full flex items-center justify-center leading-none${badgeBounce ? " animate-cart-bounce" : ""}`}>
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </Link>
            )}

            {/* Logged-in user */}
            {session ? (
              <div className="hidden lg:flex items-center gap-2">
                <Link href="/espace-pro" className="flex items-center gap-2.5 px-3 py-1.5 bg-bg-secondary rounded-lg border border-border-light hover:border-border-dark transition-colors">
                  <div className="w-6 h-6 rounded-full bg-bg-dark flex items-center justify-center shrink-0">
                    <span className="text-text-inverse text-[10px] font-bold font-body">{initials}</span>
                  </div>
                  <span className="text-sm font-medium text-text-primary font-body max-w-[120px] truncate">
                    {company}
                  </span>
                </Link>
                <button
                  onClick={async () => {
                    try { await fetch("/api/heartbeat/disconnect", { method: "POST" }); } catch {}
                    signOut({ callbackUrl: "/" });
                  }}
                  className="flex items-center justify-center w-9 h-9 text-text-muted hover:text-text-primary bg-bg-secondary shadow-[inset_2px_2px_5px_rgba(0,0,0,0.05),inset_-1px_-1px_3px_rgba(255,255,255,0.8)] hover:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.07),inset_-2px_-2px_4px_rgba(255,255,255,0.7)] rounded-[10px] transition-colors"
                  aria-label={t("logout")}
                >
                  <IconLogout />
                </button>
              </div>
            ) : (
              <Link
                href="/connexion"
                className="hidden lg:inline-flex btn-primary text-xs py-2 px-4"
              >
                {t("login")}
              </Link>
            )}

          </div>
        </div>
      </header>

      {/* ===== MOBILE DRAWER ===== */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-md z-50 lg:hidden animate-fadeIn"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-[calc(100%-3rem)] max-w-72 bg-bg-primary/95 backdrop-blur-xl z-50 lg:hidden flex flex-col rounded-r-2xl shadow-[8px_8px_20px_rgba(26,86,219,0.1),-6px_-6px_16px_rgba(255,255,255,0.85)]">

            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className="font-heading text-base font-bold text-text-primary"
              >
                {shopName}
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
              <p className="text-[10px] text-text-muted uppercase tracking-[0.15em] font-body px-3 pb-1 pt-2">
                {t("shop")}
              </p>
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center px-3 py-2.5 text-sm rounded-lg transition-colors font-body ${
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
                  <p className="text-[10px] text-text-muted uppercase tracking-[0.15em] font-body px-3 pb-1 pt-4">
                    {t("account")}
                  </p>
                  {CLIENT_LINKS.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center justify-between px-3 py-2.5 text-sm rounded-lg transition-colors font-body ${
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
                <p className="text-[10px] text-text-muted uppercase tracking-[0.15em] font-body pb-2">
                  {t("language")}
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
                      <p className="text-sm font-medium text-text-primary truncate font-body">{company}</p>
                      <p className="text-xs text-text-muted truncate font-body">{session.user.email}</p>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      try { await fetch("/api/heartbeat/disconnect", { method: "POST" }); } catch {}
                      setMobileOpen(false);
                      signOut({ callbackUrl: "/" });
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors font-body"
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
      {session?.user?.role === "ADMIN" && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0F172A] text-white px-4 py-3 flex items-center justify-between gap-4 shadow-[0_-2px_12px_rgba(0,0,0,0.3)]">
          <div className="flex items-center gap-2 text-sm font-body">
            <svg className="w-4 h-4 text-warning shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span className="font-semibold text-warning">{t("adminPreview")}</span>
            <span className="text-text-inverse/60 hidden sm:inline">— {t("adminPreviewDesc")}</span>
          </div>
          <form action={disableAdminPreview}>
            <button
              type="submit"
              disabled={previewPending}
              className="text-xs font-body font-semibold bg-bg-primary text-text-primary px-4 py-1.5 rounded-lg hover:bg-border-light transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {previewPending ? "..." : t("backToAdmin")}
            </button>
          </form>
        </div>
      )}
      {/* Spacer for fixed admin preview banner */}
      {session?.user?.role === "ADMIN" && <div className="h-14" />}
    </>
  );
}
