"use client";

/**
 * Châssis uniforme d'un tiroir — 2 mises en forme responsive.
 *
 *  ≥ md (tablette + desktop)  : panneau flottant 440 × 760 px ancré au-dessus
 *                               du FAB en bas à droite (façon téléphone). Le
 *                               fond de page reste cliquable — pas de backdrop.
 *                               Dimensions passées de 400×620 à 440×760 le
 *                               2026-07-15 pour aérer marketplaces / eFashion
 *                               / chat / images.
 *  < md (mobile)              : plein écran, header sticky avec flèche back.
 *
 * Header aurora coloré (dégradé foncé + halo flou) — validé par la cliente le
 * 2026-07-13 dans la maquette Downloads/widget-flottant-admin.html.
 */

import { useEffect, useState } from "react";

export interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  accent: "violet" | "sky" | "emerald" | "amber" | "rose" | "indigo" | "fuchsia";
  eyebrow: string;
  title: React.ReactNode;
  icon: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

// Dégradés aurora du header (foncé, texte blanc).
const ACCENT_CLASSES = {
  violet: {
    headerGrad: "from-violet-500 via-purple-600 to-fuchsia-700",
    halo: "bg-fuchsia-300/40",
    eyebrowText: "text-violet-100",
  },
  sky: {
    headerGrad: "from-sky-500 via-blue-600 to-indigo-700",
    halo: "bg-cyan-300/40",
    eyebrowText: "text-sky-100",
  },
  emerald: {
    headerGrad: "from-emerald-500 via-teal-500 to-cyan-600",
    halo: "bg-lime-300/40",
    eyebrowText: "text-emerald-100",
  },
  amber: {
    headerGrad: "from-amber-500 via-orange-500 to-rose-500",
    halo: "bg-yellow-300/40",
    eyebrowText: "text-amber-100",
  },
  rose: {
    headerGrad: "from-rose-500 via-pink-500 to-fuchsia-600",
    halo: "bg-pink-300/40",
    eyebrowText: "text-rose-100",
  },
  indigo: {
    headerGrad: "from-indigo-500 via-indigo-600 to-violet-700",
    halo: "bg-indigo-300/40",
    eyebrowText: "text-indigo-100",
  },
  fuchsia: {
    headerGrad: "from-fuchsia-500 via-pink-600 to-rose-600",
    halo: "bg-fuchsia-300/40",
    eyebrowText: "text-fuchsia-100",
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

  // ESC pour fermer (comportement standard des modales/tiroirs)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const acc = ACCENT_CLASSES[accent];
  const visible = open && mounted;

  return (
    <div
      className={`fixed z-[9000] transition-all duration-300 ease-out
        /* Desktop + tablette ≥ md : panneau flottant 440 × 760 px ancré au-dessus du FAB */
        md:bottom-24 md:right-6 md:w-[440px] md:h-[760px] md:max-h-[calc(100vh-8rem)]
        ${visible ? "md:translate-y-0 md:opacity-100" : "md:translate-y-4 md:opacity-0"}
        /* Mobile < md : plein écran, glisse depuis le bas */
        max-md:inset-x-0 max-md:top-0 max-md:bottom-0
        ${visible ? "max-md:translate-y-0 max-md:opacity-100" : "max-md:translate-y-full max-md:opacity-0"}
        ${visible ? "pointer-events-auto" : "pointer-events-none"}
      `}
      aria-hidden={!open}
      role="dialog"
    >
      <div
        className="h-full bg-white shadow-2xl shadow-slate-900/25 border border-slate-200 overflow-hidden flex flex-col
                      md:rounded-3xl
                      max-md:rounded-none"
      >
        {/* Header aurora coloré */}
        <div className={`relative overflow-hidden bg-gradient-to-br ${acc.headerGrad} flex-shrink-0`}>
          <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full ${acc.halo} blur-3xl pointer-events-none`} />
          <div className="relative px-4 py-3.5 flex items-center justify-between text-white">
            <div className="flex items-center gap-3 min-w-0">
              {/* Bouton back sur mobile */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Retour"
                className="max-md:flex hidden w-9 h-9 rounded-xl bg-white/20 backdrop-blur ring-1 ring-white/30 items-center justify-center text-white flex-shrink-0 hover:bg-white/30 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              {/* Icône (desktop + tablette) */}
              <div className="max-md:hidden w-10 h-10 rounded-xl bg-white/20 backdrop-blur ring-1 ring-white/30 flex items-center justify-center flex-shrink-0">
                {icon}
              </div>
              <div className="min-w-0">
                <p className={`text-[10px] uppercase tracking-[0.2em] ${acc.eyebrowText} font-semibold truncate`}>
                  {eyebrow}
                </p>
                <div className="text-base font-bold truncate">{title}</div>
              </div>
            </div>
            {/* Bouton fermer (desktop + tablette) */}
            <button
              type="button"
              title="Fermer"
              aria-label="Fermer"
              onClick={onClose}
              className="max-md:hidden w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white flex-shrink-0 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto overscroll-contain bg-slate-50/60">{children}</div>

        {/* Footer sticky */}
        {footer && (
          <div className="px-4 py-2.5 bg-white border-t border-slate-200 flex-shrink-0
                          max-md:pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
