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
// Animated hourglass SVG
// ─────────────────────────────────────────────

function AnimatedHourglass() {
  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        width="64"
        height="64"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ animation: "hourglassFlip 2.4s ease-in-out infinite" }}
      >
        {/* Top frame */}
        <rect x="20" y="8" width="60" height="6" rx="3" fill="var(--color-text-primary)" opacity="0.8" />
        {/* Bottom frame */}
        <rect x="20" y="86" width="60" height="6" rx="3" fill="var(--color-text-primary)" opacity="0.8" />

        {/* Glass body */}
        <path
          d="M28 14 C28 14 28 38 50 50 C72 38 72 14 72 14"
          stroke="var(--color-text-primary)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          opacity="0.3"
        />
        <path
          d="M28 86 C28 86 28 62 50 50 C72 62 72 86 72 86"
          stroke="var(--color-text-primary)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          opacity="0.3"
        />

        {/* Top sand (shrinking) */}
        <path
          d="M34 20 C34 20 34 36 50 46 C66 36 66 20 66 20 Z"
          fill="var(--color-accent, #E8A87C)"
          opacity="0.7"
          style={{ animation: "sandTop 2.4s ease-in-out infinite" }}
        />

        {/* Bottom sand (growing) */}
        <path
          d="M34 80 C34 80 34 68 50 58 C66 68 66 80 66 80 Z"
          fill="var(--color-accent, #E8A87C)"
          opacity="0.7"
          style={{ animation: "sandBottom 2.4s ease-in-out infinite" }}
        />

        {/* Falling stream */}
        <line
          x1="50" y1="46" x2="50" y2="58"
          stroke="var(--color-accent, #E8A87C)"
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ animation: "sandStream 2.4s ease-in-out infinite" }}
        />

        {/* Tiny floating particles */}
        <circle cx="47" cy="50" r="1.2" fill="var(--color-accent, #E8A87C)" style={{ animation: "particle1 2.4s ease-in-out infinite" }} />
        <circle cx="53" cy="52" r="1" fill="var(--color-accent, #E8A87C)" style={{ animation: "particle2 2.4s ease-in-out infinite" }} />
        <circle cx="50" cy="48" r="0.8" fill="var(--color-accent, #E8A87C)" style={{ animation: "particle3 2.4s ease-in-out infinite" }} />
      </svg>

      {/* Pulsing dots below */}
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-text-secondary" style={{ animation: "loadingDot 1.4s ease-in-out infinite", animationDelay: "0s" }} />
        <span className="w-2 h-2 rounded-full bg-text-secondary" style={{ animation: "loadingDot 1.4s ease-in-out infinite", animationDelay: "0.2s" }} />
        <span className="w-2 h-2 rounded-full bg-text-secondary" style={{ animation: "loadingDot 1.4s ease-in-out infinite", animationDelay: "0.4s" }} />
      </div>
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
              ? "bg-black/30 backdrop-blur-[2px] opacity-100"
              : "bg-black/0 backdrop-blur-0 opacity-0"
          }`}
          style={{ pointerEvents: fadeIn ? "auto" : "none" }}
        >
          <div
            className={`flex flex-col items-center gap-3 transition-transform duration-250 ${
              fadeIn ? "scale-100" : "scale-90"
            }`}
          >
            <AnimatedHourglass />
            {message && (
              <p className="text-sm font-body text-text-secondary mt-1 max-w-xs text-center">
                {message}
              </p>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Keyframes */}
      <style jsx global>{`
        @keyframes hourglassFlip {
          0%   { transform: rotate(0deg); }
          40%  { transform: rotate(0deg); }
          50%  { transform: rotate(180deg); }
          90%  { transform: rotate(180deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes sandTop {
          0%   { transform: scaleY(1); transform-origin: top; opacity: 0.7; }
          45%  { transform: scaleY(0.1); transform-origin: top; opacity: 0.3; }
          50%  { transform: scaleY(1); transform-origin: top; opacity: 0.7; }
          95%  { transform: scaleY(0.1); transform-origin: top; opacity: 0.3; }
          100% { transform: scaleY(1); transform-origin: top; opacity: 0.7; }
        }
        @keyframes sandBottom {
          0%   { transform: scaleY(0.1); transform-origin: bottom; opacity: 0.3; }
          45%  { transform: scaleY(1); transform-origin: bottom; opacity: 0.7; }
          50%  { transform: scaleY(0.1); transform-origin: bottom; opacity: 0.3; }
          95%  { transform: scaleY(1); transform-origin: bottom; opacity: 0.7; }
          100% { transform: scaleY(0.1); transform-origin: bottom; opacity: 0.3; }
        }
        @keyframes sandStream {
          0%   { opacity: 0.8; }
          45%  { opacity: 0.8; }
          48%  { opacity: 0; }
          52%  { opacity: 0; }
          55%  { opacity: 0.8; }
          95%  { opacity: 0.8; }
          98%  { opacity: 0; }
          100% { opacity: 0; }
        }
        @keyframes particle1 {
          0%, 100% { transform: translate(0, 0); opacity: 0.6; }
          25% { transform: translate(-3px, 2px); opacity: 0.9; }
          50% { transform: translate(0, 0); opacity: 0.6; }
          75% { transform: translate(3px, -2px); opacity: 0.9; }
        }
        @keyframes particle2 {
          0%, 100% { transform: translate(0, 0); opacity: 0.5; }
          33% { transform: translate(2px, -3px); opacity: 0.8; }
          66% { transform: translate(-2px, 3px); opacity: 0.8; }
        }
        @keyframes particle3 {
          0%, 100% { transform: translate(0, 0); opacity: 0.4; }
          50% { transform: translate(-2px, -2px); opacity: 0.7; }
        }
        @keyframes loadingDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </LoadingOverlayContext.Provider>
  );
}
