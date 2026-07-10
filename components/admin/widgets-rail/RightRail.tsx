"use client";

/**
 * Barre latérale des widgets — 3 mises en forme selon la taille d'écran.
 *
 *  ≥ lg (1024 px) : rail vertical sombre à droite (48 px).
 *  md-lg          : dock horizontal sombre en bas (48 px).
 *  < md           : FAB rond en bas à droite. Clic → éventail des 5 icônes.
 *
 * Un clic sur une icône ouvre/ferme son tiroir (piloté par `useRightRail`).
 * Badge chiffré + halo pulsant si la file du widget a du travail actif.
 * Tooltip stylisé au survol (desktop seulement — les touch devices n'ont pas
 * de hover natif fiable).
 */

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRightRail, type RailWidgetId } from "./RightRailContext";

interface RailItem {
  id: RailWidgetId;
  label: string;
  colorClass: string;
  fillBgClass: string; // fond plein (utilisé sur FAB mobile)
  badgeBgClass: string;
  icon: React.ReactNode;
  separatorAbove?: boolean;
}

const ITEMS: RailItem[] = [
  {
    id: "translation",
    label: "Traductions",
    colorClass: "text-violet-300 hover:text-violet-100",
    fillBgClass: "bg-violet-500",
    badgeBgClass: "bg-violet-500",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802" />
      </svg>
    ),
  },
  {
    id: "marketplaces",
    label: "Synchro marketplaces",
    colorClass: "text-sky-300 hover:text-sky-100",
    fillBgClass: "bg-sky-500",
    badgeBgClass: "bg-sky-500",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
      </svg>
    ),
  },
  {
    id: "images",
    label: "Images produits",
    colorClass: "text-emerald-300 hover:text-emerald-100",
    fillBgClass: "bg-emerald-500",
    badgeBgClass: "bg-emerald-500",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
  },
  {
    id: "shooting",
    label: "Shooting eFashion",
    colorClass: "text-amber-300 hover:text-amber-100",
    fillBgClass: "bg-amber-500",
    badgeBgClass: "bg-amber-500",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.822 1.316zM16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
      </svg>
    ),
  },
  {
    id: "chat",
    label: "Messages clients",
    colorClass: "text-rose-300 hover:text-rose-100",
    fillBgClass: "bg-rose-500",
    badgeBgClass: "bg-rose-500",
    separatorAbove: true,
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065.75.75 0 01-.62-.75.75.75 0 010-.036c0-.335.043-.663.126-.98A5.997 5.997 0 013 15.75c0-1.043.263-2.023.727-2.884A5.972 5.972 0 013 9.75C3 5.194 7.03 1.5 12 1.5s9 3.694 9 8.25z" />
      </svg>
    ),
  },
];

// Position des 5 icônes en éventail autour du FAB mobile.
// Rayon 72 px, arc de 180° au-dessus + à gauche du FAB.
const FAN_POSITIONS = [
  { bottom: 82, right: 6 },   // ↑
  { bottom: 70, right: 46 },  // ↖ haut
  { bottom: 42, right: 72 },  // ← milieu
  { bottom: 6, right: 82 },   // ↙ bas
  { bottom: -26, right: 60 }, // ↙↙ (au-dessus si trop bas, décalé)
];

export function RightRail() {
  const { openWidget, toggle, getBadge } = useRightRail();
  const [fabOpen, setFabOpen] = useState(false);

  const topItems = ITEMS.filter((i) => !i.separatorAbove);
  const bottomItems = ITEMS.filter((i) => i.separatorAbove);

  return (
    <>
      {/* ─────────────────────────────────────────────────────────
          Rail vertical sombre — ≥ lg (Desktop / Laptop)
          ───────────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex fixed top-4 bottom-4 right-4 z-[9001] w-12 flex-col pointer-events-none">
        <div className="flex-1 bg-slate-900/95 backdrop-blur-md rounded-2xl shadow-2xl shadow-slate-900/30 py-3 flex flex-col items-center gap-1.5 pointer-events-auto">
          {topItems.map((item) => (
            <RailButton
              key={item.id}
              item={item}
              active={openWidget === item.id}
              badge={getBadge(item.id)}
              onClick={() => toggle(item.id)}
              orientation="vertical"
            />
          ))}
          {bottomItems.length > 0 && (
            <>
              <div className="mt-auto w-6 h-px bg-white/10 my-1" />
              {bottomItems.map((item) => (
                <RailButton
                  key={item.id}
                  item={item}
                  active={openWidget === item.id}
                  badge={getBadge(item.id)}
                  onClick={() => toggle(item.id)}
                  orientation="vertical"
                />
              ))}
            </>
          )}
        </div>
      </aside>

      {/* ─────────────────────────────────────────────────────────
          Dock horizontal sombre — md → lg (Tablette)
          ───────────────────────────────────────────────────────── */}
      <aside className="hidden md:flex lg:hidden fixed inset-x-4 bottom-4 z-[9001] pointer-events-none">
        <div className="flex-1 h-12 bg-slate-900/95 backdrop-blur-md rounded-2xl shadow-2xl shadow-slate-900/30 flex items-center justify-around px-3 pointer-events-auto">
          {topItems.map((item) => (
            <RailButton
              key={item.id}
              item={item}
              active={openWidget === item.id}
              badge={getBadge(item.id)}
              onClick={() => toggle(item.id)}
              orientation="horizontal"
            />
          ))}
          {bottomItems.length > 0 && <span className="w-px h-6 bg-white/10 mx-1" />}
          {bottomItems.map((item) => (
            <RailButton
              key={item.id}
              item={item}
              active={openWidget === item.id}
              badge={getBadge(item.id)}
              onClick={() => toggle(item.id)}
              orientation="horizontal"
            />
          ))}
        </div>
      </aside>

      {/* ─────────────────────────────────────────────────────────
          FAB + éventail — < md (Mobile)
          ───────────────────────────────────────────────────────── */}
      <div className="md:hidden fixed bottom-4 right-4 z-[9001]">
        {/* Halo qui pulse quand une tâche a du travail — pour attirer l'œil */}
        {ITEMS.some((i) => getBadge(i.id).pulse) && !fabOpen && (
          <span className="absolute inset-0 rounded-full bg-slate-800/40 animate-ping pointer-events-none" />
        )}

        {/* Icônes en éventail (visibles uniquement quand fabOpen) */}
        {fabOpen &&
          ITEMS.map((item, idx) => {
            const pos = FAN_POSITIONS[idx] ?? { bottom: 0, right: 0 };
            const badge = getBadge(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                onClick={() => {
                  setFabOpen(false);
                  toggle(item.id);
                }}
                className={`absolute w-11 h-11 rounded-full ${item.fillBgClass} text-white shadow-xl flex items-center justify-center transition-transform`}
                style={{
                  bottom: pos.bottom,
                  right: pos.right,
                  animation: `fabFanIn 350ms cubic-bezier(.34,1.56,.64,1) ${idx * 40}ms both`,
                }}
              >
                {item.icon}
                {badge.count > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-white text-slate-900 border border-slate-200 text-[9px] font-bold flex items-center justify-center leading-none">
                    {badge.count > 99 ? "99+" : badge.count}
                  </span>
                )}
              </button>
            );
          })}

        {/* Bouton principal FAB */}
        <button
          type="button"
          aria-label={fabOpen ? "Fermer le menu" : "Ouvrir le menu widgets"}
          onClick={() => setFabOpen((v) => !v)}
          className={`relative w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all ${
            fabOpen
              ? "bg-white text-slate-900 rotate-90"
              : "bg-slate-900 text-white hover:scale-105"
          }`}
        >
          {fabOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          )}
        </button>

        {/* Badge cumul sur le FAB fermé — attire l'œil sans ouvrir l'éventail */}
        {!fabOpen &&
          (() => {
            const total = ITEMS.reduce((s, i) => s + getBadge(i.id).count, 0);
            if (total === 0) return null;
            return (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center pointer-events-none">
                {total > 99 ? "99+" : total}
              </span>
            );
          })()}
      </div>

      {/* Backdrop pour fermer le FAB au tap ailleurs */}
      {fabOpen && (
        <div
          className="md:hidden fixed inset-0 z-[9000] bg-slate-900/20"
          onClick={() => setFabOpen(false)}
          aria-hidden
        />
      )}

      {/* Keyframes pour l'éventail */}
      <style jsx global>{`
        @keyframes fabFanIn {
          from {
            opacity: 0;
            transform: scale(.5) translate(20px, 20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translate(0, 0);
          }
        }
      `}</style>
    </>
  );
}

// ────────────────────────────────────────────────────────
// Bouton du rail — utilisé en vertical (desktop) et horizontal (tablette)
// ────────────────────────────────────────────────────────

function RailButton({
  item,
  active,
  badge,
  onClick,
  orientation,
}: {
  item: RailItem;
  active: boolean;
  badge: { count: number; pulse?: boolean };
  onClick: () => void;
  orientation: "vertical" | "horizontal";
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      if (orientation === "vertical") {
        setTooltip({ x: r.left, y: r.top + r.height / 2 });
      } else {
        setTooltip({ x: r.left + r.width / 2, y: r.top });
      }
    }
  };
  const hide = () => setTooltip(null);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={item.label}
        onClick={() => {
          hide();
          onClick();
        }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors outline-none focus:ring-2 focus:ring-white/30 ${
          active ? "bg-white shadow-lg text-slate-800" : `${item.colorClass} hover:bg-white/5`
        }`}
      >
        {item.icon}
        {badge.count > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full ${item.badgeBgClass} text-white text-[9px] font-bold flex items-center justify-center leading-none ${
              badge.pulse ? "animate-pulse" : ""
            }`}
          >
            {badge.count > 99 ? "99+" : badge.count}
          </span>
        )}
        {badge.pulse && badge.count > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full ${item.badgeBgClass} opacity-40 animate-ping pointer-events-none`} />
        )}
      </button>
      {tooltip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            className={`fixed z-[9999] pointer-events-none px-2 py-1 rounded-md bg-slate-900 text-white text-[11px] font-medium whitespace-nowrap shadow-lg ${
              orientation === "vertical"
                ? "-translate-x-full -translate-y-1/2"
                : "-translate-x-1/2 -translate-y-full"
            }`}
            style={
              orientation === "vertical"
                ? { left: tooltip.x - 8, top: tooltip.y }
                : { left: tooltip.x, top: tooltip.y - 8 }
            }
          >
            {item.label}
            {orientation === "vertical" ? (
              <span className="absolute left-full top-1/2 -translate-y-1/2 w-0 h-0 border-4 border-transparent border-l-slate-900" />
            ) : (
              <span className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-4 border-transparent border-t-slate-900" />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
