"use client";

import { ReactNode } from "react";

export type MarketplaceKey = "pfs" | "ankorstore" | "efashion";

interface ThemeTokens {
  label: string;
  badgeBg: string;
  badgeText: string;
  ring: string;
}

const THEMES: Record<MarketplaceKey, ThemeTokens> = {
  pfs: {
    label: "Paris Fashion Shop",
    badgeBg: "bg-rose-100",
    badgeText: "text-rose-800",
    ring: "ring-rose-200",
  },
  ankorstore: {
    label: "Ankorstore",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-900",
    ring: "ring-amber-200",
  },
  efashion: {
    label: "eFashion Paris",
    badgeBg: "bg-violet-100",
    badgeText: "text-violet-800",
    ring: "ring-violet-200",
  },
};

interface Props {
  marketplace: MarketplaceKey;
  productName: string;
  reference: string;
  alreadyLinked?: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  searchBar?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

export function LinkModalShell({
  marketplace,
  productName,
  reference,
  alreadyLinked,
  onClose,
  closeDisabled,
  searchBar,
  children,
  footer,
}: Props) {
  const theme = THEMES[marketplace];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4">
      <div className="bg-bg-primary rounded-2xl shadow-xl ring-1 ring-border w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border-light">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${theme.badgeBg} ${theme.badgeText}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${theme.badgeText.replace("text-", "bg-")}`} />
                  {theme.label}
                </span>
                <span className="text-[10px] font-body font-semibold uppercase tracking-wider text-text-muted">
                  · Liaison produit
                </span>
                {alreadyLinked && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-body font-semibold uppercase tracking-wider text-emerald-700">
                    · Déjà lié
                  </span>
                )}
              </div>
              <h2 className="font-heading font-bold text-text-primary text-lg leading-tight truncate">
                {productName}
              </h2>
              <p className="font-body text-xs text-text-muted mt-1">
                Référence interne :{" "}
                <span className="font-mono font-medium text-text-secondary">{reference}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={closeDisabled}
              aria-label="Fermer"
              className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-40"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Optional search bar */}
        {searchBar && (
          <div className="px-6 py-4 border-b border-border-light bg-bg-secondary/30">
            {searchBar}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 bg-bg-secondary/20">{children}</div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-light bg-bg-primary flex items-center justify-between gap-3">
          {footer}
        </div>
      </div>
    </div>
  );
}
