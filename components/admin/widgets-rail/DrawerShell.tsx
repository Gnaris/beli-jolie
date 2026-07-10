"use client";

/**
 * Châssis uniforme d'un tiroir — 3 mises en forme responsive.
 *
 *  ≥ lg (1024 px) : tiroir latéral 400 px à droite (rail 48 px à sa droite).
 *  md-lg          : bottom-sheet 60 % de l'écran avec drag handle en haut.
 *  < md           : plein écran, header avec flèche back.
 *
 * Aucun backdrop : le fond de page reste cliquable (comportement voulu pour
 * ne pas bloquer l'utilisatrice pendant qu'une tâche tourne). Cliquer en
 * dehors ne ferme pas — utiliser le bouton fermer ou toucher l'icône du rail.
 */

import { useEffect, useState } from "react";

export interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  accent: "violet" | "sky" | "emerald" | "amber";
  eyebrow: string;
  title: React.ReactNode;
  icon: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

const ACCENT_CLASSES = {
  violet: {
    headerBg: "from-violet-50 via-white to-white",
    halo: "bg-violet-300/30",
    iconBg: "bg-violet-100 ring-violet-200",
    iconText: "text-violet-700",
    eyebrow: "text-violet-700",
  },
  sky: {
    headerBg: "from-sky-50 via-white to-white",
    halo: "bg-sky-300/30",
    iconBg: "bg-sky-100 ring-sky-200",
    iconText: "text-sky-700",
    eyebrow: "text-sky-700",
  },
  emerald: {
    headerBg: "from-emerald-50 via-white to-white",
    halo: "bg-emerald-300/30",
    iconBg: "bg-emerald-100 ring-emerald-200",
    iconText: "text-emerald-700",
    eyebrow: "text-emerald-700",
  },
  amber: {
    headerBg: "from-amber-50 via-white to-white",
    halo: "bg-amber-300/30",
    iconBg: "bg-amber-100 ring-amber-200",
    iconText: "text-amber-700",
    eyebrow: "text-amber-700",
  },
} as const;

export function DrawerShell({
  open,
  onClose,
  accent,
  eyebrow,
  title,
  icon,
  footer,
  children,
}: DrawerShellProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const acc = ACCENT_CLASSES[accent];
  const visible = open && mounted;

  return (
    <div
      className={`fixed z-[9000] transition-all duration-300 ease-out
        /* Desktop ≥ lg : tiroir latéral 400 px à droite, à gauche du rail (60 px) */
        lg:top-4 lg:bottom-4 lg:right-16 lg:w-[400px]
        ${visible ? "lg:translate-x-0" : "lg:translate-x-6"}
        /* Tablette md-lg : bottom-sheet 60 % en bas, au-dessus du dock (68 px) */
        md:max-lg:inset-x-4 md:max-lg:bottom-[68px] md:max-lg:top-[40%]
        ${visible ? "md:max-lg:translate-y-0" : "md:max-lg:translate-y-6"}
        /* Mobile < md : plein écran (avec espace 16 px en bas pour le FAB) */
        max-md:inset-x-0 max-md:top-0 max-md:bottom-0
        ${visible ? "max-md:translate-y-0" : "max-md:translate-y-full"}
        ${visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
      `}
      aria-hidden={!open}
      role="dialog"
    >
      <div className="h-full bg-white shadow-2xl shadow-slate-900/15 border border-slate-200 overflow-hidden flex flex-col
                      lg:rounded-2xl
                      md:max-lg:rounded-t-3xl md:max-lg:rounded-b-none
                      max-md:rounded-none">

        {/* Drag handle (tablette bottom-sheet uniquement) */}
        <div className="hidden md:max-lg:flex justify-center pt-2 pb-1 flex-shrink-0">
          <span className="w-10 h-1 rounded-full bg-slate-300" />
        </div>

        {/* Header */}
        <div className={`relative px-4 py-3 bg-gradient-to-r ${acc.headerBg} border-b border-slate-100 flex-shrink-0`}>
          <div className={`absolute -top-10 -left-10 w-28 h-28 rounded-full ${acc.halo} blur-3xl pointer-events-none`} />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Bouton back sur mobile */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Retour"
                className="max-md:flex hidden w-8 h-8 rounded-lg bg-slate-100 items-center justify-center text-slate-700 flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              {/* Icône colorée (desktop + tablette) */}
              <div className={`max-md:hidden w-9 h-9 rounded-xl ${acc.iconBg} ring-1 flex items-center justify-center flex-shrink-0`}>
                <span className={acc.iconText}>{icon}</span>
              </div>
              <div className="min-w-0">
                <p className={`text-[10px] uppercase tracking-[0.18em] ${acc.eyebrow} font-semibold truncate`}>
                  {eyebrow}
                </p>
                <div className="text-sm font-bold text-slate-800 truncate">{title}</div>
              </div>
            </div>
            {/* Bouton fermer (desktop + tablette) — flèche droite / croix */}
            <button
              type="button"
              title="Fermer"
              onClick={onClose}
              className="max-md:hidden w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>

        {/* Footer sticky */}
        {footer && (
          <div className="px-4 py-2.5 bg-slate-50/60 border-t border-slate-100 flex-shrink-0
                          max-md:pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
