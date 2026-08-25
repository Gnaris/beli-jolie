"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TileAccent } from "@/lib/settings-tiles";

/**
 * Rendu du header : classes marqueur `settings-modal-header--<accent>` +
 * `settings-modal-halo`. Le style clair vient de Tailwind (via `bgGradient`),
 * le style sombre vient de règles CSS scopées `html.admin-dark` dans
 * globals.css (dégradé neutre foncé + halos éteints).
 */
const ACCENT_STYLES: Record<TileAccent, { bgGradient: string; halo: string; eyebrow: string }> = {
  slate:   { bgGradient: "bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950",     halo: "bg-slate-400/30",   eyebrow: "text-slate-200/80" },
  sky:     { bgGradient: "bg-gradient-to-br from-sky-700 via-sky-800 to-sky-950",           halo: "bg-sky-300/30",     eyebrow: "text-sky-100/80" },
  emerald: { bgGradient: "bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-950", halo: "bg-emerald-300/30", eyebrow: "text-emerald-100/80" },
  violet:  { bgGradient: "bg-gradient-to-br from-violet-700 via-violet-800 to-violet-950",  halo: "bg-violet-300/30",  eyebrow: "text-violet-100/80" },
  rose:    { bgGradient: "bg-gradient-to-br from-rose-700 via-rose-800 to-rose-950",        halo: "bg-rose-300/30",    eyebrow: "text-rose-100/80" },
  amber:   { bgGradient: "bg-gradient-to-br from-amber-600 via-amber-700 to-amber-900",     halo: "bg-amber-300/30",   eyebrow: "text-amber-100/80" },
};

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon: ReactNode;
  accent: TileAccent;
  children: ReactNode;
  /** Facultatif : chip d'état affiché à droite du titre dans le header. */
  headerRight?: ReactNode;
}

export default function SettingsModal({ open, onClose, title, description, icon, accent, children, headerRight }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const style = ACCENT_STYLES[accent];
  // Portail rendu uniquement après l'hydratation client : évite le mismatch SSR (createPortal ne rend rien
  // côté serveur) quand la modale est ouverte au 1er rendu via ?open=... dans l'URL.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ESC ferme la modale + verrou du scroll body pendant l'ouverture
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Remonte le scroll du body à chaque ouverture (sinon on reste au fond du contenu précédent)
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm cursor-default"
      />

      {/* Fenêtre */}
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-3xl bg-bg-primary shadow-2xl border border-border overflow-hidden">
        {/* Header aurora coloré — classes marqueur pour override dark mode dans globals.css */}
        <div className={`settings-modal-header settings-modal-header--${accent} relative overflow-hidden ${style.bgGradient} text-white shrink-0`}>
          <div className={`settings-modal-halo absolute -top-16 -right-12 w-56 h-56 rounded-full blur-3xl pointer-events-none ${style.halo}`} />
          <div className={`settings-modal-halo absolute -bottom-20 left-1/4 w-64 h-64 rounded-full blur-3xl pointer-events-none ${style.halo}`} />
          <div className="relative z-[1] flex items-start gap-4 p-5 sm:p-6">
            <div className="settings-modal-icon inline-flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-2xl border border-white/16 bg-white/12 text-white shrink-0">
              {icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-[10.5px] font-body font-bold uppercase tracking-[0.18em] ${style.eyebrow}`}>
                Paramètres
              </div>
              <h2 className="font-heading text-xl sm:text-2xl font-bold leading-tight mt-0.5">{title}</h2>
              {description && (
                <p className="text-[13px] text-white/80 font-body mt-1 leading-snug">{description}</p>
              )}
            </div>
            {headerRight && <div className="shrink-0 hidden sm:block">{headerRight}</div>}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer la modale"
              className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 border border-white/16 text-white transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body scrollable */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto bg-bg-secondary/30">
          <div className="p-5 sm:p-6">{children}</div>
        </div>

        {/* Footer minimal (juste Fermer — les composants gardent leurs propres boutons Enregistrer) */}
        <div className="shrink-0 border-t border-border bg-bg-primary px-5 sm:px-6 py-3 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center px-4 py-2 rounded-lg text-[13px] font-semibold border border-border text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
