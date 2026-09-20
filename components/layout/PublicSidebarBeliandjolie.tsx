"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { createPortal } from "react-dom";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { useSession, signOut } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { disableAdminPreview } from "@/app/actions/admin/preview-mode";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";
import { buildProductHandle } from "@/lib/product-url";
import { getVerifiedBadgeState } from "@/lib/verified-badge-state";

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
  /** Slug du tenant courant, résolu côté serveur (fiable en dev + prod +
   *  preview cookie). Sert notamment à afficher le CTA « Créer mon compte
   *  pro » uniquement sur Issyma. Optionnel pour ne pas casser l'existant. */
  tenantSlug?: string;
}

export default function PublicSidebarBeliandjolie({ shopName, tenantSlug }: PublicSidebarProps) {
  const t      = useTranslations("nav");
  const locale = useLocale();

  const [mobileOpen, setMobileOpen]       = useState(false);
  const [searchOpen, setSearchOpen]       = useState(false);
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
    { label: t("about"),       href: "/a-propos" },
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

  // Détection tenant Issyma. Priorité 1 : prop `tenantSlug` (résolu serveur,
  // fiable en dev + prod + cookie preview). Fallback : hostname si le prop
  // n'est pas fourni (compat callers non migrés). Sert à afficher le bouton
  // « Créer mon compte pro » dans le header UNIQUEMENT sur Issyma.
  const [isIssyma, setIsIssyma] = useState(tenantSlug === "issyma");
  useEffect(() => {
    if (tenantSlug) {
      setIsIssyma(tenantSlug === "issyma");
      return;
    }
    if (typeof window === "undefined") return;
    setIsIssyma(/(^|\.)issyma\./i.test(window.location.hostname));
  }, [tenantSlug]);

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
      const target = e.target as Node;
      // Le bouton loupe (identifié par aria-label = t("search")) déclenche déjà
      // setSearchOpen(v => !v). Si le clic vient de lui, on laisse passer sans
      // fermer, sinon la logique toggle ne fonctionnera pas correctement.
      const isSearchToggle = (e.target as HTMLElement)?.closest?.("[data-search-toggle]");
      if (!isSearchToggle && searchRef.current && !searchRef.current.contains(target)) {
        setShowResults(false);
        setSearchOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(target)) {
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

  function handleResultClick(result: SearchResult) {
    setShowResults(false);
    setSearchQuery("");
    router.push(`/produits/${buildProductHandle(result.name, result.reference)}`);
  }

  const isClient     = session?.user?.role === "CLIENT";
  const isAdmin      = session?.user?.role === "ADMIN";
  const showClientUI = isClient || isAdmin;
  const company      = (session?.user as { company?: string })?.company ?? session?.user?.name ?? "";
  const initials     = company ? company.slice(0, 2).toUpperCase() : "?";
  const verifiedBadge = getVerifiedBadgeState(session);
  const showVerifiedBadge = verifiedBadge.show;
  const badgeVariant = verifiedBadge.show ? verifiedBadge.variant : null;
  const isVerified = badgeVariant === "verified";
  const isRevoked = badgeVariant === "revoked";
  const badgeLabel = isVerified
    ? t("verifiedBadge")
    : isRevoked
      ? t("revokedBadge")
      : t("unverifiedBadge");
  const badgeTooltip = isVerified
    ? t("verifiedTooltip")
    : isRevoked
      ? t("revokedTooltip")
      : t("unverifiedTooltip");

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

  const navContainerRef = useRef<HTMLElement>(null);
  const allLinks = showClientUI ? [...NAV_LINKS, ...CLIENT_LINKS] : NAV_LINKS;

  return (
    <>
      {/* ===== TOP NAVBAR - fixed ===== */}
      <header
        className={`fixed left-0 right-0 z-50 border-b transition-all duration-300 ${
          scrolled
            ? "bg-white/92 backdrop-blur-md border-neutral-200"
            : "bg-white border-transparent"
        }`}
        style={{ top: "var(--announcement-height, 0px)" }}
      >
        {/* Mobile : bande dédiée au nom de boutique (toute la largeur) */}
        <div className="lg:hidden border-b border-neutral-100">
          <div className="container-site h-10 flex items-center justify-center">
            <Link
              href="/"
              className="font-heading font-light text-base text-black tracking-tight truncate max-w-[80vw]"
            >
              {shopName}
            </Link>
          </div>
        </div>

        {/* Row unique : Logo — Nav — Actions (une seule ligne comme la maquette) */}
        <div className="container-site h-16 flex items-center gap-6 lg:gap-8">

          {/* Mobile hamburger — LEFT on mobile */}
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden flex items-center justify-center w-9 h-9 text-text-primary hover:text-black transition-colors -ml-1"
            aria-label="Menu"
          >
            <IconMenu />
          </button>

          {/* Logo (desktop only — mobile a sa propre bande au-dessus) */}
          <Link
            href="/"
            className="hidden lg:block font-heading font-light text-xl text-black tracking-tight shrink-0 hover:text-neutral-700 transition-colors"
          >
            {shopName}
          </Link>

          {/* Navigation links — INLINE avec le logo (desktop only) */}
          <nav ref={navContainerRef} className="hidden lg:flex items-center gap-7">
            {allLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                data-nav-active={isActive(link.href) ? "true" : undefined}
                className={`py-1 text-[13px] font-body whitespace-nowrap transition-colors duration-200 ${
                  isActive(link.href)
                    ? "text-black font-medium"
                    : "text-neutral-600 hover:text-black"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-3 ml-auto text-neutral-700">

            {/* Sélecteur de langue — extrait du dropdown profil */}
            <div className="hidden lg:block shrink-0">
              <LanguageSwitcher currentLocale={locale} />
            </div>

            {/* Search — icône qui ouvre un panneau */}
            <button
              data-search-toggle
              onClick={() => {
                setSearchOpen((v) => !v);
                setTimeout(() => {
                  const input = document.querySelector<HTMLInputElement>("input[data-header-search]");
                  input?.focus();
                }, 50);
              }}
              className="hidden sm:flex items-center justify-center w-9 h-9 text-neutral-700 hover:text-black transition-colors"
              aria-label={t("search")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>

            {/* Badge statut — Admin (rouge) > Vérifié / Non vérifié (sky / neutre) / Révoqué (rouge)
                Tooltip stylisé sous le badge au survol (label + mini-description). */}
            {isAdmin ? (
              <div className="hidden lg:block relative group shrink-0" tabIndex={0}>
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-body font-medium border bg-red-50 border-red-200 text-red-700 whitespace-nowrap"
                >
                  <svg className="w-3.5 h-3.5 text-red-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l8 4v5c0 4.5-3.4 8.7-8 9-4.6-.3-8-4.5-8-9V7l8-4z" />
                  </svg>
                  <span>Admin</span>
                </span>
                <div className="absolute top-full right-0 mt-2 w-60 bg-slate-900 text-white rounded-lg shadow-lg px-3 py-2 opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 z-50">
                  <p className="text-[12px] font-body font-semibold">{t("adminPreview")}</p>
                  <p className="text-[11px] font-body text-slate-300 mt-0.5 leading-snug">{t("adminPreviewDesc")}</p>
                </div>
              </div>
            ) : showVerifiedBadge ? (
              <div className="hidden lg:block relative group shrink-0" tabIndex={0}>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-body font-medium border transition-colors whitespace-nowrap ${
                    isVerified
                      ? "bg-sky-50 border-sky-200 text-sky-700"
                      : isRevoked
                        ? "bg-red-50 border-red-200 text-red-700"
                        : "bg-white border-neutral-300 text-neutral-500"
                  }`}
                >
                  {isVerified ? (
                    <svg className="w-3.5 h-3.5 text-sky-600 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 2l2.09 2.26 3.05-.53.53 3.05L20.94 8.83 19.4 11.6l1.54 2.77-2.77 1.53-.53 3.05-3.05-.53L12 20.94l-2.09-2.26-3.05.53-.53-3.05L3.06 14.4 4.6 11.63 3.06 8.86l2.77-1.53.53-3.05 3.05.53L12 2zm-1.15 13.15l5.66-5.66-1.41-1.41-4.24 4.24-1.83-1.83-1.41 1.41 3.24 3.25z" />
                    </svg>
                  ) : isRevoked ? (
                    <svg className="w-3.5 h-3.5 text-red-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path strokeLinecap="round" d="M8 12h8" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path strokeLinecap="round" d="M12 8v4m0 3.5v.5" />
                    </svg>
                  )}
                  <span>{badgeLabel}</span>
                </span>
                <div className="absolute top-full right-0 mt-2 w-60 bg-slate-900 text-white rounded-lg shadow-lg px-3 py-2 opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 z-50">
                  <p className="text-[12px] font-body font-semibold">{badgeLabel}</p>
                  <p className="text-[11px] font-body text-slate-300 mt-0.5 leading-snug">{badgeTooltip}</p>
                </div>
              </div>
            ) : null}

            {/* Profil : icône seule, dropdown si connectée / lien connexion sinon */}
            {session ? (
              <div ref={profileRef} className="hidden lg:block relative shrink-0">
                <button
                  onClick={() => setProfileOpen((v) => !v)}
                  className="flex items-center justify-center w-9 h-9 text-neutral-700 hover:text-black transition-colors"
                  aria-label={company || t("profile")}
                  title={company}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
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
                            startPreviewTransition(async () => {
                              await disableAdminPreview();
                              // Full reload obligatoire : le soft nav RSC depuis
                              // /fr/... vers /admin (non-localisée) affiche une
                              // page blanche jusqu'au refresh (surtout Issyma).
                              window.location.href = "/admin";
                            });
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
              <>
                {isIssyma && (
                  <Link
                    href="/inscription"
                    className="hidden lg:inline-flex items-center px-3 h-9 rounded-full bg-black text-white text-[11px] tracking-[0.18em] uppercase font-semibold hover:bg-neutral-800 transition-colors"
                  >
                    {t("register")}
                  </Link>
                )}
                <Link
                  href="/connexion"
                  className="hidden lg:flex items-center justify-center w-9 h-9 text-neutral-700 hover:text-black transition-colors"
                  aria-label={t("login")}
                  title={t("login")}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
                  </svg>
                </Link>
              </>
            )}

            {/* Favoris — icône (clientes connectées uniquement) */}
            {showClientUI && (
              <Link
                href="/favoris"
                className="hidden sm:flex items-center justify-center w-9 h-9 text-neutral-700 hover:text-black transition-colors"
                aria-label={t("favorites")}
                title={t("favorites")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
                </svg>
              </Link>
            )}

            {/* Panier */}
            {showClientUI && (
              <Link
                ref={cartIconRef}
                href="/panier"
                className="relative flex items-center justify-center w-9 h-9 text-neutral-700 hover:text-black transition-colors"
                aria-label={t("cart")}
              >
                <IconCart />
                {cartCount > 0 && (
                  <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-black text-white text-[10px] font-medium rounded-full flex items-center justify-center leading-none${badgeBounce ? " animate-cart-bounce" : ""}`}>
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </Link>
            )}

          </div>
        </div>

        {/* Panneau de recherche déroulant (déclenché par l'icône) */}
        {searchOpen && (
          <div
            ref={searchRef}
            className="border-t border-neutral-100 bg-white animate-fadeIn"
          >
            <div className="container-site py-4">
              <form onSubmit={handleSearchSubmit}>
                <div className="relative">
                  <svg className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                  <input
                    data-header-search
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onFocus={() => { if (searchResults.length > 0) setShowResults(true); }}
                    placeholder={t("search")}
                    aria-expanded={showResults}
                    aria-autocomplete="list"
                    role="combobox"
                    className="w-full bg-transparent border-b border-neutral-300 pl-8 pr-10 py-3 text-base font-body text-text-primary placeholder:text-neutral-400 focus:outline-none focus:border-black transition-colors"
                  />
                  {searchLoading ? (
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
                      <div className="w-4 h-4 border border-neutral-300 border-t-black rounded-full animate-spin" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchOpen(false);
                        setSearchQuery("");
                        setShowResults(false);
                      }}
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-neutral-500 hover:text-black transition-colors"
                      aria-label="Fermer"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="m6 6 12 12M6 18 18 6" />
                      </svg>
                    </button>
                  )}
                </div>
              </form>

              {showResults && (
                <div role="listbox" aria-label={t("searchResults")} className="mt-4 max-h-80 overflow-y-auto">
                  {searchResults.length === 0 ? (
                    <p className="text-sm text-text-muted font-body py-6 text-center">
                      {t("searchNoResults")} &quot;{searchQuery}&quot;
                    </p>
                  ) : (
                    <>
                      {searchResults.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          role="option"
                          onClick={() => { handleResultClick(r); setSearchOpen(false); }}
                          className="w-full flex items-center gap-4 py-3 hover:bg-neutral-50 transition-colors text-left border-b border-neutral-100 last:border-b-0"
                        >
                          <div className="w-12 h-12 bg-neutral-100 overflow-hidden shrink-0">
                            {r.image ? (
                              <Image src={r.image} alt={r.name} width={80} height={80} unoptimized className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-text-primary truncate">{r.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-400">{r.reference}</span>
                              <span className="text-[10px] text-neutral-400">·</span>
                              <span className="text-[10px] text-neutral-500">{r.category}</span>
                            </div>
                          </div>
                          {r.price !== null && (
                            <span className="text-sm text-text-primary shrink-0">
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
                          setSearchOpen(false);
                        }}
                        className="w-full py-4 text-center text-[11px] tracking-[0.24em] uppercase text-text-primary hover:text-black transition-colors"
                      >
                        {t("searchResults")} →
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ===== MOBILE DRAWER ===== */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-md z-[70] lg:hidden animate-fadeIn"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-[calc(100%-3rem)] max-w-72 bg-bg-primary/95 backdrop-blur-xl z-[70] lg:hidden flex flex-col shadow-sm">

            {/* Drawer header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-100">
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className="font-heading font-light text-lg text-black tracking-tight"
              >
                {shopName}
              </Link>
              <button
                onClick={() => setMobileOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-neutral-500 hover:text-black transition-colors"
              >
                <IconClose />
              </button>
            </div>

            {/* Links */}
            <nav className="flex-1 px-6 py-6 overflow-y-auto space-y-6">
              <div>
                <p className="text-[10px] text-neutral-400 uppercase tracking-[0.28em] font-body pb-3">
                  {t("shop")}
                </p>
                <div className="space-y-1">
                  {NAV_LINKS.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center py-2.5 text-[13px] tracking-[0.08em] uppercase transition-colors font-body ${
                        isActive(link.href)
                          ? "text-black font-medium"
                          : "text-neutral-600 hover:text-black"
                      }`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>

              {showClientUI && (
                <>
                  <div>
                    <p className="text-[10px] text-neutral-400 uppercase tracking-[0.28em] font-body pb-3">
                      {t("account")}
                    </p>
                    <div className="space-y-1">
                      {CLIENT_LINKS.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setMobileOpen(false)}
                          className={`flex items-center py-2.5 text-[13px] tracking-[0.08em] uppercase transition-colors font-body ${
                            isActive(link.href)
                              ? "text-black font-medium"
                              : "text-neutral-600 hover:text-black"
                          }`}
                        >
                          {link.label}
                        </Link>
                      ))}
                      {PROFILE_LINKS.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setMobileOpen(false)}
                          className={`flex items-center py-2.5 text-[13px] tracking-[0.08em] uppercase transition-colors font-body ${
                            isActive(link.href)
                              ? "text-black font-medium"
                              : "text-neutral-600 hover:text-black"
                          }`}
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Language switcher in mobile drawer */}
              <div>
                <p className="text-[10px] text-neutral-400 uppercase tracking-[0.28em] font-body pb-3">
                  {t("language")}
                </p>
                <LanguageSwitcher currentLocale={locale} />
              </div>
            </nav>

            {/* Drawer footer */}
            <div className="px-6 py-5 border-t border-neutral-100">
              {session ? (
                <>
                  <div className="flex items-center gap-3 py-3 mb-3">
                    <div className="w-9 h-9 rounded-full bg-black flex items-center justify-center shrink-0">
                      <span className="text-white text-[11px] font-medium tracking-wide">{initials}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-text-primary truncate font-body">{company}</p>
                      <p className="text-[11px] text-neutral-500 truncate font-body">{session.user.email}</p>
                    </div>
                    {showVerifiedBadge && (
                      <span
                        title={badgeTooltip}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-body font-medium border shrink-0 ${
                          isVerified
                            ? "bg-sky-50 border-sky-200 text-sky-700"
                            : isRevoked
                              ? "bg-red-50 border-red-200 text-red-700"
                              : "bg-bg-primary border-border text-text-muted"
                        }`}
                      >
                        {isVerified ? (
                          <svg className="w-3 h-3 text-sky-600" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12 2l2.09 2.26 3.05-.53.53 3.05L20.94 8.83 19.4 11.6l1.54 2.77-2.77 1.53-.53 3.05-3.05-.53L12 20.94l-2.09-2.26-3.05.53-.53-3.05L3.06 14.4 4.6 11.63 3.06 8.86l2.77-1.53.53-3.05 3.05.53L12 2zm-1.15 13.15l5.66-5.66-1.41-1.41-4.24 4.24-1.83-1.83-1.41 1.41 3.24 3.25z" />
                          </svg>
                        ) : isRevoked ? (
                          <svg className="w-3 h-3 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                            <circle cx="12" cy="12" r="9" />
                            <path strokeLinecap="round" d="M8 12h8" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                            <circle cx="12" cy="12" r="9" />
                            <path strokeLinecap="round" d="M12 8v4m0 3.5v.5" />
                          </svg>
                        )}
                        {badgeLabel}
                      </span>
                    )}
                  </div>
                  {session.user.role === "ADMIN" && (
                    <button
                      type="button"
                      disabled={previewPending}
                      onClick={() => {
                        setMobileOpen(false);
                        startPreviewTransition(async () => {
                          await disableAdminPreview();
                          window.location.href = "/admin";
                        });
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
                    className="w-full flex items-center justify-center gap-2 py-3 border border-neutral-300 text-[11px] tracking-[0.24em] uppercase text-text-primary hover:bg-black hover:text-white hover:border-black transition-all duration-300"
                  >
                    <IconLogout />
                    {t("logout")}
                  </button>
                </>
              ) : (
                <>
                  {isIssyma && (
                    <Link
                      href="/inscription"
                      onClick={() => setMobileOpen(false)}
                      className="w-full flex items-center justify-center py-3 bg-black text-white text-[11px] tracking-[0.24em] uppercase font-medium"
                    >
                      {t("register")}
                    </Link>
                  )}
                  <Link
                    href="/connexion"
                    onClick={() => setMobileOpen(false)}
                    className={`w-full flex items-center justify-center py-3 text-[11px] tracking-[0.24em] uppercase font-medium ${
                      isIssyma
                        ? "border border-neutral-300 text-text-primary hover:bg-black hover:text-white hover:border-black transition-all duration-300"
                        : "bg-black text-white"
                    }`}
                  >
                    {t("login")}
                  </Link>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Spacer for fixed navbar (mobile : bande nom h-10 + row1 h-16 = 104px ; desktop : row unique h-16 = 64px) */}
      <div className="h-[104px] lg:h-[64px]" />

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
