"use client";

/**
 * MappingModalShell — coque commune des mini-modals de mapping marketplace
 * (une carte marketplace de la fiche attribut = un mini-modal dédié).
 *
 * Fournit : backdrop + portal + header aurora + footer (bouton fermer +
 * bouton principal optionnel). Le corps est libre.
 */

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Titre principal (ex : "Paris Fashion Shop") */
  title: string;
  /** Sur-titre uppercase (ex : "Mapping · Catégorie « Bague »") */
  eyebrow: string;
  /** Sous-titre discret sous le titre */
  subtitle?: string;
  /** Avatar/initiales à gauche du titre. Utiliser <AvatarBadge /> ci-dessous. */
  avatar?: ReactNode;
  /** Couleur d'accent (halo aurora + barre eyebrow). Ex : "#10b981" */
  accentColor?: string;
  /** Corps du modal (scrollable). */
  children: ReactNode;
  /** Contenu personnalisé du footer (remplace les boutons par défaut). */
  footer?: ReactNode;
  /** Bouton principal (défaut : "Enregistrer"). Ignoré si `footer` fourni. */
  primaryAction?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
    disabled?: boolean;
  };
  /** Message d'erreur affiché à gauche du footer. */
  error?: string | null;
  /** Largeur max Tailwind (défaut lg). */
  maxWidth?: "md" | "lg" | "xl" | "2xl";
}

export default function MappingModalShell({
  open,
  onClose,
  title,
  eyebrow,
  subtitle,
  avatar,
  accentColor = "#10b981",
  children,
  footer,
  primaryAction,
  error,
  maxWidth = "lg",
}: Props) {
  const backdrop = useBackdropClose(onClose);
  // Garde SSR : createPortal a besoin de document.body. Ce composant est
  // "use client" donc on est côté navigateur au 2e render, mais on protège
  // contre un éventuel prérender.
  if (!open || typeof document === "undefined") return null;

  const widthClass = {
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
  }[maxWidth];

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className={`w-full ${widthClass} bg-bg-primary rounded-[28px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)] flex flex-col max-h-[92vh] overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header aurora */}
        <div className="relative overflow-hidden border-b border-border shrink-0">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                `radial-gradient(60% 80% at 10% 0%, ${accentColor}1a, transparent 60%),` +
                "radial-gradient(50% 70% at 90% 10%, rgba(148,163,184,0.10), transparent 60%)",
            }}
          />
          <div className="relative px-7 pt-6 pb-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                {avatar}
                <div className="min-w-0">
                  <span
                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[10.5px] font-bold uppercase tracking-[0.14em]"
                    style={{
                      background: `${accentColor}12`,
                      borderColor: `${accentColor}33`,
                      color: accentColor,
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: accentColor }} />
                    {eyebrow}
                  </span>
                  <h3 className="font-heading text-[20px] font-bold text-text-primary leading-tight mt-2 truncate">
                    {title}
                  </h3>
                  {subtitle && (
                    <p className="text-[12.5px] text-text-secondary mt-1 leading-relaxed">{subtitle}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-7">{children}</div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-7 py-4 border-t border-border shrink-0 bg-bg-primary">
          {footer ? (
            footer
          ) : (
            <>
              <div className="flex-1 min-w-0">
                {error && (
                  <p className="inline-flex items-center gap-1.5 text-xs text-[#DC2626] font-medium">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                    {error}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center justify-center h-10 px-4 border border-border text-text-secondary hover:border-ink hover:text-text-primary text-sm font-medium rounded-lg transition-colors"
                >
                  {primaryAction ? "Annuler" : "Fermer"}
                </button>
                {primaryAction && (
                  <button
                    type="button"
                    onClick={primaryAction.onClick}
                    disabled={primaryAction.loading || primaryAction.disabled}
                    className="inline-flex items-center justify-center gap-2 h-10 px-5 bg-bg-dark hover:bg-black text-text-inverse text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {primaryAction.loading ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                          <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        Enregistrement…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        {primaryAction.label}
                      </>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Petit avatar coloré (initiales) — utilisé dans le slot `avatar`. */
export function AvatarBadge({ gradient, text }: { gradient: string; text: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 text-white shadow-sm"
      style={{ background: gradient }}
    >
      <span className="font-heading font-bold text-[13px]">{text}</span>
    </span>
  );
}
