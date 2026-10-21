"use client";

import { useEffect, useRef, useState } from "react";
import { useRightRail, type RailWidgetId } from "./widgets-rail";

type Item = {
  id: RailWidgetId;
  label: string;
  gradient: string;
  icon: React.ReactNode;
};

// Mêmes 9 widgets que l'ancien FAB bottom-right. Chaque entrée réutilise
// `useRightRail` pour ouvrir le même drawer qu'avant.
const ITEMS: Item[] = [
  {
    id: "translation",
    label: "Traductions",
    gradient: "from-violet-500 to-purple-600",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802" />
      </svg>
    ),
  },
  {
    id: "marketplaces",
    label: "Marketplaces",
    gradient: "from-sky-500 to-blue-600",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    id: "orders-import",
    label: "Import commandes marketplaces",
    gradient: "from-indigo-500 to-violet-600",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    ),
  },
  {
    id: "shooting",
    label: "Shooting eFashion",
    gradient: "from-amber-500 to-orange-500",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.822 1.316zM16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
      </svg>
    ),
  },
  {
    id: "images",
    label: "Import masse images",
    gradient: "from-emerald-500 to-teal-600",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25z" />
      </svg>
    ),
  },
  {
    id: "microstore-upload",
    label: "Photos Microstore",
    gradient: "from-cyan-500 to-teal-600",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
  },
  {
    id: "pfs-audit",
    label: "Audit PFS",
    gradient: "from-lime-500 to-emerald-600",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: "bulk-mail",
    label: "Envoi de mails",
    gradient: "from-fuchsia-500 to-pink-600",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline strokeLinecap="round" strokeLinejoin="round" points="22,6 12,13 2,6" />
      </svg>
    ),
  },
  {
    id: "chat",
    label: "Messages clients",
    gradient: "from-rose-500 to-pink-600",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065.75.75 0 01-.62-.75.75.75 0 010-.036c0-.335.043-.663.126-.98A5.997 5.997 0 013 15.75c0-1.043.263-2.023.727-2.884A5.972 5.972 0 013 9.75C3 5.194 7.03 1.5 12 1.5s9 3.694 9 8.25z" />
      </svg>
    ),
  },
];

export default function AdminHeaderWidgetLauncher() {
  const { openWidget, toggle, getBadge } = useRightRail();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const total = ITEMS.reduce((s, i) => s + getBadge(i.id).count, 0);
  const anyPulse = ITEMS.some((i) => getBadge(i.id).pulse);

  // Fermer le menu quand un drawer s'ouvre (expérience : on ne garde pas
  // le dropdown en superposition sur le drawer).
  useEffect(() => {
    if (openWidget) setMenuOpen(false);
  }, [openWidget]);

  // Fermer au clic extérieur
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={menuOpen ? "Fermer les outils rapides" : "Ouvrir les outils rapides"}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="admin-fab-preserve h-full px-4 bg-white border border-zinc-200/80 rounded-2xl shadow-sm flex items-center justify-center group relative"
      >
        {/* Halo pulsant si une file a du travail actif */}
        {anyPulse && !menuOpen && (
          <span className="absolute inset-2 rounded-xl bg-indigo-500/15 animate-ping pointer-events-none" />
        )}
        <span className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-slate-800 via-slate-900 to-black text-white flex items-center justify-center transition-transform group-hover:scale-105">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
            />
          </svg>
          {total > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-br from-rose-500 to-pink-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white shadow"
              aria-label={`${total} tâche${total > 1 ? "s" : ""} en cours`}
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </span>

        {/* Tooltip au survol — identique au tooltip des icônes sidebar */}
        {!menuOpen && (
          <span
            className="absolute left-1/2 -translate-x-1/2 top-[calc(100%+10px)] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-[12.5px] font-semibold font-body rounded-lg px-3 py-1.5 shadow-[0_10px_25px_-5px_rgba(9,9,11,0.45)] whitespace-nowrap z-[60]"
            style={{ background: "#18181B", color: "#ffffff" }}
          >
            Outils rapides
            <span
              aria-hidden
              className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 rotate-45"
              style={{ background: "#18181B" }}
            />
          </span>
        )}
      </button>

      {/* Dropdown : apparaît sous le bouton. Suit le thème admin (clair/sombre) via
          les classes Tailwind standard, overridées par les règles `html.admin-dark`
          de globals.css. */}
      {menuOpen && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-[80] min-w-[280px] bg-white border border-zinc-200 rounded-2xl shadow-[0_18px_40px_-8px_rgba(9,9,11,0.25)] py-2 animate-[tooltipIn_140ms_ease-out]"
          role="menu"
        >
          {ITEMS.map((item, idx) => {
            const badge = getBadge(item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => toggle(item.id)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-zinc-50 transition-colors text-left"
                style={{ animation: `tooltipIn 180ms ease-out ${idx * 20}ms both` }}
              >
                <span className={`admin-fab-preserve relative w-8 h-8 rounded-lg bg-gradient-to-br ${item.gradient} text-white flex items-center justify-center shadow-sm shrink-0`}>
                  {item.icon}
                  {badge.pulse && (
                    <span className={`absolute inset-0 rounded-lg bg-gradient-to-br ${item.gradient} opacity-50 animate-ping pointer-events-none`} />
                  )}
                </span>
                <span className="flex-1 text-[13px] font-body font-medium text-zinc-800 truncate">
                  {item.label}
                </span>
                {badge.count > 0 && (
                  <span className="shrink-0 min-w-[22px] h-[20px] px-1.5 rounded-full bg-zinc-900 text-white text-[10.5px] font-bold flex items-center justify-center">
                    {badge.count > 99 ? "99+" : badge.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
