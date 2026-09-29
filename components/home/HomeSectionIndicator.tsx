"use client";

import { useEffect, useState } from "react";

type Section = {
  id: string;
  label: string;
  /** Détermine la palette de l'indicateur quand cette section est active :
   *  - "light" (défaut) → texte navy sur halo blanc (pour fond clair).
   *  - "dark" → texte blanc sur halo navy (pour fond bleu marine). */
  tone?: "light" | "dark";
};

type Props = {
  sections: Section[];
};

export default function HomeSectionIndicator({ sections }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (sections.length === 0) return;

    const elements = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    // La section « active » est celle dont le haut est le plus proche du tiers
    // supérieur du viewport (ligne fictive à ~35 % de la hauteur). Approche
    // manuelle plutôt qu'IntersectionObserver : plus précise quand deux
    // sections courtes tiennent ensemble à l'écran et évite les sauts
    // erratiques quand une section entre/sort.
    const computeActive = () => {
      const anchorY = window.innerHeight * 0.35;
      let bestIdx = 0;
      let bestDist = Infinity;
      elements.forEach((el, i) => {
        const rect = el.getBoundingClientRect();
        const dist = Math.abs(rect.top - anchorY);
        if (rect.top <= anchorY + 1 && dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      });
      setActiveIdx(bestIdx);
    };

    computeActive();
    window.addEventListener("scroll", computeActive, { passive: true });
    window.addEventListener("resize", computeActive);
    return () => {
      window.removeEventListener("scroll", computeActive);
      window.removeEventListener("resize", computeActive);
    };
  }, [sections]);

  if (sections.length === 0) return null;

  const current = sections[activeIdx];
  const next = sections[activeIdx + 1] ?? null;
  const isDark = current.tone === "dark";

  // Palette pré-calculée pour éviter Tailwind class purge sur des noms
  // interpolés (`bg-${x}` ne serait pas généré par le JIT).
  const palette = isDark
    ? {
        railTrack: "bg-white/20",
        railFill: "bg-white",
        counter: "text-white/50",
        current: "text-white",
        next: "text-white/30",
        textShadow: "[text-shadow:0_1px_10px_rgba(11,27,52,0.6)]",
      }
    : {
        railTrack: "bg-slate-900/15",
        railFill: "bg-slate-900",
        counter: "text-slate-900/40",
        current: "text-slate-900",
        next: "text-slate-900/25",
        textShadow: "[text-shadow:0_1px_10px_rgba(255,255,255,0.6)]",
      };

  return (
    <aside
      aria-hidden="true"
      className="pointer-events-none fixed left-6 top-1/2 z-30 hidden -translate-y-1/2 select-none lg:block"
    >
      <div className="flex items-start gap-4">
        <div
          className={`relative h-40 w-px overflow-hidden transition-colors duration-500 ${palette.railTrack}`}
        >
          <div
            className={`absolute inset-x-0 top-0 transition-[height,background-color] duration-500 ease-out ${palette.railFill}`}
            style={{
              height: `${
                sections.length > 1
                  ? (activeIdx / (sections.length - 1)) * 100
                  : 100
              }%`,
            }}
          />
        </div>

        <div
          className={`flex max-w-[180px] flex-col gap-1 pt-1 ${palette.textShadow}`}
        >
          <span
            className={`text-[10px] font-medium uppercase tracking-[0.3em] transition-colors duration-500 ${palette.counter}`}
          >
            {String(activeIdx + 1).padStart(2, "0")} /{" "}
            {String(sections.length).padStart(2, "0")}
          </span>
          <span
            key={current.id}
            className={`font-heading text-sm font-semibold leading-tight transition-all duration-500 ease-out ${palette.current}`}
          >
            {current.label}
          </span>
          {next && (
            <span
              key={next.id}
              className={`font-heading text-xs leading-tight transition-all duration-500 ease-out ${palette.next}`}
            >
              {next.label}
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
