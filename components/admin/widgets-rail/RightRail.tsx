"use client";

/**
 * Widget flottant unique en bas à droite (tous écrans).
 *
 *  - Un FAB rond (56 px) en bas à droite avec badge total + halo pulsant si
 *    l'une des files a du travail actif.
 *  - Clic → mini-menu vertical qui se déploie AU-DESSUS du FAB. Chaque
 *    mini-bouton = pastille colorée avec badge chiffré + tooltip au survol.
 *  - Clic sur un mini-bouton → ouvre le tiroir correspondant (via useRightRail).
 *  - Un drawer ouvert = le FAB affiche une croix ; clic sur le FAB ferme le
 *    drawer. Un seul tiroir ouvert à la fois (garanti par le contexte).
 *
 * Design validé par la cliente le 2026-07-13 (maquette
 * Downloads/widget-flottant-admin.html) : remplace l'ancien rail vertical à
 * droite + dock horizontal bas + FAB mobile, unifié en un seul motif.
 */

import { useEffect, useState } from "react";
import { useRightRail, type RailWidgetId } from "./RightRailContext";

interface RailItem {
  id: RailWidgetId;
  label: string;
  gradient: string; // dégradé du mini-bouton
  badgeText: string; // couleur du texte du badge sur fond blanc
  ring: string; // couleur du ring du badge sur fond blanc
  icon: React.ReactNode;
}

// Ordre validé : Marketplaces en tête (halo pulse fréquent), Chat en queue
// (accès rapide en bas, juste au-dessus du FAB).
const ITEMS: RailItem[] = [
  {
    id: "translation",
    label: "Traductions",
    gradient: "from-violet-500 to-purple-600",
    badgeText: "text-violet-600",
    ring: "ring-violet-500",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802" />
      </svg>
    ),
  },
  {
    id: "marketplaces",
    label: "Marketplaces",
    gradient: "from-sky-500 to-blue-600",
    badgeText: "text-sky-600",
    ring: "ring-sky-500",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    id: "orders-import",
    label: "Import commandes / clients marketplaces",
    gradient: "from-indigo-500 to-violet-600",
    badgeText: "text-indigo-600",
    ring: "ring-indigo-500",
    icon: (
      // Flèche descendante — un seul bouton pour PFS + eFashion (et à terme
      // Ankorstore/Faire quand on branchera l'import de leurs commandes).
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    ),
  },
  {
    id: "shooting",
    label: "Shooting eFashion",
    gradient: "from-amber-500 to-orange-500",
    badgeText: "text-amber-600",
    ring: "ring-amber-500",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.822 1.316zM16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
      </svg>
    ),
  },
  {
    id: "images",
    label: "Import masse images",
    gradient: "from-emerald-500 to-teal-600",
    badgeText: "text-emerald-600",
    ring: "ring-emerald-500",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25z" />
      </svg>
    ),
  },
  {
    id: "pfs-audit",
    label: "Audit PFS",
    gradient: "from-lime-500 to-emerald-600",
    badgeText: "text-emerald-700",
    ring: "ring-emerald-500",
    icon: (
      // Loupe — cohérent avec la pastille de vérification PFS sur les produits.
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: "emails",
    label: "Emails automatiques",
    gradient: "from-fuchsia-500 to-pink-600",
    badgeText: "text-fuchsia-600",
    ring: "ring-fuchsia-500",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    ),
  },
  {
    id: "chat",
    label: "Messages clients",
    gradient: "from-rose-500 to-pink-600",
    badgeText: "text-rose-600",
    ring: "ring-rose-500",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065.75.75 0 01-.62-.75.75.75 0 010-.036c0-.335.043-.663.126-.98A5.997 5.997 0 013 15.75c0-1.043.263-2.023.727-2.884A5.972 5.972 0 013 9.75C3 5.194 7.03 1.5 12 1.5s9 3.694 9 8.25z" />
      </svg>
    ),
  },
];

export function RightRail() {
  const { openWidget, toggle, close, getBadge } = useRightRail();
  const [menuOpen, setMenuOpen] = useState(false);

  // Total pour le badge cumul sur le FAB fermé
  const total = ITEMS.reduce((s, i) => s + getBadge(i.id).count, 0);
  // Halo pulsant si au moins une file signale du travail actif
  const anyPulse = ITEMS.some((i) => getBadge(i.id).pulse);
  const somethingOpen = openWidget !== null;

  // Ouvrir un tiroir referme le menu de sélection
  useEffect(() => {
    if (openWidget) setMenuOpen(false);
  }, [openWidget]);

  // ESC ferme le menu (les tiroirs gèrent leur propre ESC via DrawerShell)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleFabClick = () => {
    if (somethingOpen) {
      close();
      return;
    }
    setMenuOpen((v) => !v);
  };

  return (
    <>
      {/* Backdrop léger derrière le mini-menu — clic pour fermer.
          Pas de backdrop derrière les tiroirs (comportement voulu : page cliquable
          pendant qu'une tâche tourne). */}
      {menuOpen && (
        <button
          type="button"
          aria-label="Fermer le menu de raccourcis"
          data-testid="rail-backdrop"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-[8998] bg-slate-900/10 backdrop-blur-[2px] cursor-default"
        />
      )}

      {/* Container widget */}
      <div className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-[9001] flex flex-col items-end gap-3">

        {/* Mini-menu (visible uniquement quand menuOpen ET aucun tiroir ouvert) */}
        {menuOpen && !somethingOpen && (
          <div className="flex flex-col items-end gap-3">
            {ITEMS.map((item, idx) => (
              <MiniButton
                key={item.id}
                item={item}
                badge={getBadge(item.id)}
                delay={idx * 40}
                onClick={() => toggle(item.id)}
              />
            ))}
          </div>
        )}

        {/* Bouton principal FAB */}
        <button
          type="button"
          aria-label={
            somethingOpen
              ? "Fermer le panneau"
              : menuOpen
              ? "Fermer le menu"
              : "Ouvrir le menu widgets"
          }
          aria-expanded={menuOpen}
          onClick={handleFabClick}
          className="relative group focus:outline-none"
        >
          {/* Halo qui pulse quand une file a du travail actif — attire l'œil */}
          {anyPulse && !menuOpen && !somethingOpen && (
            <span className="absolute inset-0 rounded-full bg-indigo-500/60 animate-ping pointer-events-none" />
          )}
          <span
            className={`relative w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-200 ring-4 ring-white ${
              somethingOpen || menuOpen
                ? "bg-white text-slate-900 scale-95"
                : "bg-gradient-to-br from-slate-800 via-slate-900 to-black text-white group-hover:scale-105"
            }`}
          >
            {somethingOpen || menuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                />
              </svg>
            )}
          </span>

          {/* Badge cumul — visible uniquement FAB fermé sans tiroir */}
          {total > 0 && !menuOpen && !somethingOpen && (
            <span
              className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1.5 rounded-full bg-gradient-to-br from-rose-500 to-pink-600 text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-white shadow-lg pointer-events-none"
              aria-label={`${total} tâche${total > 1 ? "s" : ""} en cours`}
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </button>
      </div>

      <style jsx global>{`
        @keyframes miniBtnIn {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.85);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </>
  );
}

// ────────────────────────────────────────────────────────
// Mini-bouton du menu déployé — icône ronde colorée + tooltip
// ────────────────────────────────────────────────────────

function MiniButton({
  item,
  badge,
  delay,
  onClick,
}: {
  item: RailItem;
  badge: { count: number; pulse?: boolean };
  delay: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={item.label}
      onClick={onClick}
      className="group flex items-center gap-3 focus:outline-none"
      style={{
        animation: `miniBtnIn 320ms cubic-bezier(.16,1,.3,1) ${delay}ms both`,
      }}
    >
      <span className="px-3 py-1.5 rounded-full bg-white text-slate-900 text-xs font-semibold shadow-lg ring-1 ring-slate-200 whitespace-nowrap group-hover:-translate-x-0.5 transition-transform">
        {item.label}
      </span>
      <span className="relative">
        {/* Halo pulsant sur mini-bouton si sa file a du travail */}
        {badge.pulse && (
          <span
            className={`absolute inset-0 rounded-full bg-gradient-to-br ${item.gradient} opacity-40 animate-ping pointer-events-none`}
          />
        )}
        <span
          className={`relative w-12 h-12 rounded-full bg-gradient-to-br ${item.gradient} text-white shadow-xl flex items-center justify-center ring-2 ring-white group-hover:scale-110 transition-transform`}
        >
          {item.icon}
        </span>
        {badge.count > 0 && (
          <span
            className={`absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-white ${item.badgeText} text-[10px] font-bold flex items-center justify-center ring-2 ${item.ring} shadow pointer-events-none`}
          >
            {badge.count > 99 ? "99+" : badge.count}
          </span>
        )}
      </span>
    </button>
  );
}
