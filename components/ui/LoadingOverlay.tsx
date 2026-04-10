"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────

interface LoadingOverlayContextValue {
  showLoading: (message?: string) => void;
  hideLoading: () => void;
}

const LoadingOverlayContext = createContext<LoadingOverlayContextValue | null>(null);

export function useLoadingOverlay(): LoadingOverlayContextValue {
  const ctx = useContext(LoadingOverlayContext);
  if (!ctx) throw new Error("useLoadingOverlay must be used within <LoadingOverlayProvider>");
  return ctx;
}

// ─────────────────────────────────────────────
// Spinner loading indicator
// ─────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center gap-3 bg-bg-primary border border-border rounded-2xl px-6 py-4 shadow-lg">
      <svg className="w-5 h-5 animate-spin text-bg-dark" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm font-medium font-body text-text-primary">Chargement…</span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Navigation loader — detects route changes
// ─────────────────────────────────────────────

function NavigationLoader() {
  const pathname = usePathname();
  const prevPathname = useRef(pathname);
  const { showLoading, hideLoading } = useLoadingOverlay();
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevPathname.current !== pathname) {
      // Route changed — hide any previous overlay
      if (navigationTimer.current) {
        clearTimeout(navigationTimer.current);
        navigationTimer.current = null;
      }
      hideLoading();
      prevPathname.current = pathname;
    }
  }, [pathname, hideLoading]);

  // Intercept <a> clicks for Next.js navigation
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (anchor.getAttribute("target") === "_blank") return;
      if (anchor.hasAttribute("download")) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;

      // API routes / file downloads — not a page navigation
      if (href.startsWith("/api/")) return;

      // Extract pathname part (strip query string and hash)
      const hrefPathname = href.split("?")[0].split("#")[0];
      const normalizedCurrent = pathname.endsWith("/") ? pathname : pathname + "/";
      const normalizedHref = hrefPathname.endsWith("/") ? hrefPathname : hrefPathname + "/";

      // Same pathname (only query/hash changed) — no overlay
      if (normalizedHref === normalizedCurrent) return;

      showLoading();

      // Safety net: hide overlay after 8s if pathname never changed
      // (navigation failed, interrupted, or took too long)
      if (navigationTimer.current) clearTimeout(navigationTimer.current);
      navigationTimer.current = setTimeout(() => {
        hideLoading();
        navigationTimer.current = null;
      }, 8000);
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [pathname, showLoading, hideLoading]);

  return null;
}

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

export function LoadingOverlayProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [mounted, setMounted] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const showLoading = useCallback((msg?: string) => {
    setMessage(msg);
    setVisible(true);
    // Trigger fade-in on next frame
    requestAnimationFrame(() => setFadeIn(true));
  }, []);

  const hideLoading = useCallback(() => {
    setFadeIn(false);
    // Wait for fade-out animation then unmount
    setTimeout(() => {
      setVisible(false);
      setMessage(undefined);
    }, 250);
  }, []);

  const ctx: LoadingOverlayContextValue = { showLoading, hideLoading };

  return (
    <LoadingOverlayContext.Provider value={ctx}>
      <NavigationLoader />
      {children}

      {mounted && visible && createPortal(
        <div
          className={`fixed inset-0 z-[9998] flex items-center justify-center transition-all duration-250 ${
            fadeIn
              ? "bg-white/60 backdrop-blur-[1px] opacity-100"
              : "bg-white/0 backdrop-blur-0 opacity-0"
          }`}
          style={{ pointerEvents: fadeIn ? "auto" : "none" }}
        >
          <div
            className={`flex flex-col items-center gap-3 transition-transform duration-250 ${
              fadeIn ? "scale-100" : "scale-90"
            }`}
          >
            <LoadingSpinner />
            {message && (
              <p className="text-sm font-body text-text-secondary mt-1 max-w-xs text-center">
                {message}
              </p>
            )}
          </div>
        </div>,
        document.body
      )}
    </LoadingOverlayContext.Provider>
  );
}
