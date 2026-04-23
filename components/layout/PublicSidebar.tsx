"use client";

import { useState, useEffect, useRef, useTransition, useCallback } from "react";
import { createPortal } from "react-dom";
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
  const [flyItems, setFlyItems]           = useState<{ id: number; src: string; style: React.CSSProperties }[]>([]);
  const cartIconRef                       = useRef<HTMLAnchorElement>(null);
  const flyIdRef                          = useRef(0);
  const [previewPending, startPreviewTransition] = useTransition();
  const pathname  = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  // Nav links (labels from translations)
  const NAV_LINKS = [
    { label: t("home"),        href: "/" },
    { label: t("products"),    href: "/produits" },
    { label: t("categories"),  href: "/categories" },
    { label: t("collections"), href: "/collections" },
    { label: t("contact"),     href: "/nous-contacter" },
  ];

  const CLIENT_LINKS = [
    { label: t("favorites"), href: "/favoris" },
  ];

  const PROFILE_LINKS = [
    { label: t("profile"),   href: "/espace-pro" },
    { label: t("orders"),    href: "/commandes" },
    { label: t("claims"),    href: "/espace-pro/reclamations" },
  ];

  // Profile dropdown state
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
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

  // Listen for fly-to-cart events from product cards
  useEffect(() => {
    function handleFlyToCart(e: Event) {
      const detail = (e as CustomEvent).detail as {
        imageSrc: string;
        rect: { top: number; left: number; width: number; height: number };
        quantity?: number;
      };
      const cartEl = cartIconRef.current;
      if (!cartEl || !detail.rect) return;

      const cartRect = cartEl.getBoundingClientRect();
      const dx = cartRect.left + cartRect.width / 2 - (detail.rect.left + detail.rect.width / 2);
      const dy = cartRect.top + cartRect.height / 2 - (detail.rect.top + detail.rect.height / 2);

      const id = ++flyIdRef.current;
      const style: React.CSSProperties = {
        position: "fixed",
        top: detail.rect.top,
        left: detail.rect.left,
        width: detail.rect.width,
        height: detail.rect.height,
        zIndex: 9999,
        pointerEvents: "none",
        objectFit: "cover",
        "--fly-dx": `${dx}px`,
        "--fly-dy": `${dy}px`,
      } as React.CSSProperties;

      setFlyItems((prev) => [...prev, { id, src: detail.imageSrc, style }]);

      // After animation ends, remove element & bump count
      setTimeout(() => {
        setFlyItems((prev) => prev.filter((f) => f.id !== id));
        setCartCount((c) => c + (detail.quantity ?? 1));
        setBadgeBounce(true);
        setTimeout(() => setBadgeBounce(false), 500);
      }, 650);
    }

    window.addEventListener("cart:item-added", handleFlyToCart);
    return () => window.removeEventListener("cart:item-added", handleFlyToCart);
  }, []);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Close profile dropdown on route change
  useEffect(() => {
    setProfileOpen(false);
  }, [pathname]);

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
        className="fixed left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-border shadow-sm transition-all duration-200"
        style={{ top: "var(--announcement-height, 0px)" }}
      >
        {/* Row 1: Logo — Search — Actions */}
        <div className="container-site h-16 flex lg:grid lg:grid-cols-[1fr_minmax(0,2fr)_1fr] items-center gap-4">

          {/* Mobile hamburger — LEFT on mobile */}
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden flex items-center justify-center w-9 h-9 text-text-secondary hover:text-text-primary bg-bg-secondary border border-border hover:bg-bg-tertiary rounded-[10px] transition-colors"
            aria-label="Menu"
          >
            <IconMenu />
          </button>

          {/* Logo */}
          <Link
            href="/"
            className="relative font-heading text-base font-bold text-text-primary tracking-tight shrink-0 group shimmer-overlay overflow-hidden max-lg:absolute max-lg:left-1/2 max-lg:-translate-x-1/2 lg:justify-self-start"
          >
            {shopName}
          </Link>

          {/* Search bar — centered and expanded (desktop) */}
          <div ref={searchRef} className="hidden lg:flex items-center relative justify-self-center w-full max-w-2xl z-20">
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
                  className="w-full bg-bg-secondary border border-border rounded-xl focus:ring-2 focus:ring-accent/30 pl-10 pr-4 py-2.5 text-sm font-body text-text-primary placeholder:text-text-muted focus:outline-none transition-colors"
                />
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              <div role="listbox" aria-label={t("searchResults")} className="absolute top-full left-0 right-0 mt-2 bg-bg-primary/95 backdrop-blur-lg border border-border rounded-2xl shadow-sm overflow-hidden z-50 max-h-96 overflow-y-auto animate-fadeIn">
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
          <div className="flex items-center gap-2 ml-auto lg:ml-0 lg:justify-self-end">

            {/* Language switcher */}
            <LanguageSwitcher currentLocale={locale} />

            {/* Cart */}
            {showClientUI && (
              <Link
                ref={cartIconRef}
                href="/panier"
                className="relative flex items-center justify-center w-9 h-9 text-text-secondary hover:text-text-primary bg-bg-secondary border border-border hover:bg-bg-tertiary rounded-[10px] transition-colors"
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

            {/* Logged-in user — profile dropdown */}
            {session ? (
              <div ref={profileRef} className="hidden lg:block relative">
                <button
                  onClick={() => setProfileOpen((v) => !v)}
                  className="flex items-center gap-2.5 px-3 py-1.5 bg-bg-secondary rounded-lg border border-border-light hover:border-border-dark transition-colors"
                >
                  <div className="w-6 h-6 rounded-full bg-bg-dark flex items-center justify-center shrink-0">
                    <span className="text-text-inverse text-[10px] font-bold font-body">{initials}</span>
                  </div>
                  <span className="text-sm font-medium text-text-primary font-body max-w-[120px] truncate">
                    {company}
                  </span>
                  <svg className={`w-3.5 h-3.5 text-text-muted transition-transform duration-200 ${profileOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {profileOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-bg-primary/95 backdrop-blur-xl border border-border rounded-2xl shadow-sm overflow-hidden z-50 animate-fadeIn">
                    {/* User info */}
                    <div className="px-4 py-3 border-b border-border-light">
                      <p className="text-sm font-medium text-text-primary font-body truncate">{company}</p>
                      <p className="text-xs text-text-muted font-body truncate">{session.user.email}</p>
                    </div>

                    {/* Profile links */}
                    <div className="py-1.5">
                      {PROFILE_LINKS.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setProfileOpen(false)}
                          className={`flex items-center px-4 py-2.5 text-sm font-body transition-colors ${
                            isActive(link.href)
                              ? "bg-bg-tertiary text-text-primary font-medium"
                              : "text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
                          }`}
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>

                    {/* Back to admin (preview mode) */}
                    {session.user.role === "ADMIN" && (
                      <div className="border-t border-border-light py-1.5">
                        <button
                          type="button"
                          disabled={previewPending}
                          onClick={() => {
                            setProfileOpen(false);
                            startPreviewTransition(() => disableAdminPreview());
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-warning hover:text-text-primary hover:bg-bg-secondary transition-colors font-body font-medium disabled:opacity-60"
                        >
                          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                          </svg>
                          {previewPending ? "..." : t("backToAdmin")}
                        </button>
                      </div>
                    )}

                    {/* Logout */}
                    <div className="border-t border-border-light py-1.5">
                      <button
                        onClick={async () => {
                          setProfileOpen(false);
                          signOut({ callbackUrl: "/" });
                        }}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors font-body"
                      >
                        <IconLogout />
                        {t("logout")}
                      </button>
                    </div>
                  </div>
                )}
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

        {/* Row 2: Navigation links — centered (desktop only) */}
        <nav ref={navContainerRef} className="hidden lg:flex items-center justify-center gap-1 py-1.5 border-t border-border-light relative">
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
              className={`relative z-10 px-4 py-2 text-sm rounded-md transition-colors duration-200 font-body ${
                isActive(link.href)
                  ? "text-text-primary font-medium"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {link.label}
              {isActive(link.href) && (
                <span className="absolute bottom-0 left-4 right-4 h-[2px] bg-text-primary rounded-full animate-slide-in" />
              )}
            </Link>
          ))}
        </nav>
      </header>

      {/* ===== MOBILE DRAWER ===== */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-md z-50 lg:hidden animate-fadeIn"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-[calc(100%-3rem)] max-w-72 bg-bg-primary/95 backdrop-blur-xl z-50 lg:hidden flex flex-col rounded-r-2xl shadow-sm">

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
                    {t("shop")}
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
                    </Link>
                  ))}
                  <p className="text-[10px] text-text-muted uppercase tracking-[0.15em] font-body px-3 pb-1 pt-4">
                    {t("account")}
                  </p>
                  {PROFILE_LINKS.map((link) => (
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
                  {session.user.role === "ADMIN" && (
                    <button
                      type="button"
                      disabled={previewPending}
                      onClick={() => {
                        setMobileOpen(false);
                        startPreviewTransition(() => disableAdminPreview());
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-warning hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors font-body font-medium disabled:opacity-60 mb-1"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                      </svg>
                      {previewPending ? "..." : t("backToAdmin")}
                    </button>
                  )}
                  <button
                    onClick={async () => {
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

      {/* Spacer for fixed navbar (row1 h-16 + row2 nav ~40px on desktop) */}
      <div className="h-16 lg:h-[116px]" />

      {/* Flying product images for add-to-cart animation */}
      {flyItems.length > 0 &&
        createPortal(
          <>
            {flyItems.map((item) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={item.id}
                src={item.src}
                alt=""
                className="animate-fly-to-cart shadow-lg"
                style={item.style}
              />
            ))}
          </>,
          document.body
        )}

    </>
  );
}
