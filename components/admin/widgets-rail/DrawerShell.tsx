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
  accent: "violet" | "sky" | "emerald" | "amber" | "rose" | "indigo" | "fuchsia" | "cyan";
  eyebrow: string;
  title: React.ReactNode;
  icon: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** "wide" élargit le panneau desktop pour héberger plusieurs colonnes
   *  côte à côte (widget import commandes / clients). "fullscreen" prend
   *  toute la fenêtre (utilisé pour l'audit PFS où il faut voir un maximum
   *  d'écarts d'un coup). Défaut = "default". */
  size?: "default" | "wide" | "fullscreen";
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
  cyan: {
    headerGrad: "from-cyan-500 via-teal-600 to-emerald-700",
    halo: "bg-cyan-300/40",
    eyebrowText: "text-cyan-100",
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
  size = "default",
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

  // Verrouille le scroll de la page en arrière-plan tant que le tiroir est
  // ouvert (demande cliente 2026-07-31). La page reste cliquable — seul le
  // scroll est bloqué. Restaure la valeur précédente à la fermeture pour ne
  // pas écraser un overflow déjà posé par un autre composant.
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previousBody = document.body.style.overflow;
    const previousHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBody;
      document.documentElement.style.overflow = previousHtml;
    };
  }, [open]);

  const acc = ACCENT_CLASSES[accent];
  const visible = open && mounted;
  // "wide" : tiroir calé DANS la zone de contenu de la page — la sidebar
  // admin (≥ lg) et la barre de nav mobile (< lg) restent visibles à côté
  // (demande cliente 2026-08-13 : « je veux au moins la barre de navigation
  // entière visible »). Le contenu du tiroir se cape lui-même (scroll
  // horizontal des colonnes marketplaces).
  // "fullscreen" : quasi plein écran, réservé aux tiroirs qui ont besoin de
  // voir un maximum d'info d'un coup (Audit PFS, Import commandes). Sur ≥ lg
  // on décale de 300 px à gauche pour laisser la sidebar visible + 20 px de
  // marge en haut/bas/droite. Sous lg, sidebar déjà cachée (AdminMobileNav)
  // donc inset-0.
  // Depuis le 2026-08-13, le FAB étoile + le mini-menu restent visibles
  // pendant qu'un tiroir est ouvert (demande cliente). On réserve donc
  // 360 px sur la droite pour laisser respirer le rail (label pill +
  // pastille colorée) même sur les tiroirs `wide` / `fullscreen`. Le
  // tiroir `default` (440 px de large) se cale à gauche du rail plutôt
  // qu'au bord droit.
  const wideClasses =
    size === "fullscreen"
      ? "md:inset-0 lg:inset-auto lg:top-5 lg:right-[360px] lg:bottom-5 lg:left-[300px]"
      : size === "wide"
        ? "md:top-[76px] md:right-[360px] md:bottom-5 md:left-5 lg:top-5 lg:left-[300px]"
        : "md:bottom-6 md:right-[360px] md:w-[440px] md:h-[760px] md:max-h-[calc(100vh-3rem)]";
  const isFullscreen = size === "fullscreen";

  return (
    <div
      className={`fixed z-[9000] transition-all duration-300 ease-out
        /* Desktop + tablette ≥ md : panneau flottant ancré au-dessus du FAB */
        ${wideClasses}
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
        className={`admin-drawer-frame h-full bg-white shadow-2xl shadow-slate-900/25 border border-slate-200 overflow-hidden flex flex-col
                      ${isFullscreen ? "md:rounded-none lg:rounded-3xl" : "md:rounded-3xl"}
                      max-md:rounded-none`}
      >
        {/* Header aurora coloré. `data-drawer-accent` : marqueur utilisé
            par les overrides CSS du mode sombre (globals.css) pour flipper
            le dégradé vers une version « nuit » plus profonde et moins
            criarde, tout en gardant l'identité colorée du widget. */}
        <div data-drawer-accent={accent} className={`relative overflow-hidden bg-gradient-to-br ${acc.headerGrad} flex-shrink-0`}>
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
            {/* Bouton fermer (desktop + tablette) — plus grand et libellé
                visible en mode fullscreen pour aider la cliente à sortir. */}
            <button
              type="button"
              title="Fermer"
              aria-label="Fermer"
              onClick={onClose}
              className={`max-md:hidden inline-flex items-center gap-2 rounded-full bg-white/20 hover:bg-white/30 text-white flex-shrink-0 transition ${
                isFullscreen
                  ? "h-10 pl-4 pr-3 ring-1 ring-white/30 font-semibold text-sm shadow-lg"
                  : "w-8 h-8 justify-center"
              }`}
            >
              {isFullscreen && <span>Fermer</span>}
              <svg className={isFullscreen ? "w-5 h-5" : "w-4 h-4"} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body — pour size="wide" et "fullscreen" on empêche tout scroll
            interne, les enfants doivent se caper eux-mêmes (widget import
            commandes/clients, audit PFS, marketplaces). Pour "default", scroll
            auto comme avant. */}
        <div
          className={`flex-1 bg-slate-50/60 ${size === "wide" || size === "fullscreen" ? "overflow-hidden" : "overflow-y-auto overscroll-contain"}`}
        >
          {children}
        </div>

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

