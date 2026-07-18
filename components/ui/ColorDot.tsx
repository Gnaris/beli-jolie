"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ColorDotProps {
  color: { name: string; hex: string | null; patternImage?: string | null };
  /** Taille en pixels. Par défaut 18. */
  size?: number;
}

/**
 * Pastille de couleur ronde avec légende flottante instantanée au survol.
 * Priorité d'affichage : Color.patternImage > Color.hex (rappel CLAUDE.md).
 * Le tooltip est porté dans document.body pour ne pas être clippé
 * par overflow-hidden sur les containers arrondis.
 */
export default function ColorDot({ color, size = 18 }: ColorDotProps) {
  const [hovered, setHovered] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  const showTip = () => {
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setCoords({ x: r.left + r.width / 2, y: r.top });
    }
    setHovered(true);
  };
  const hideTip = () => setHovered(false);

  const bg: React.CSSProperties = color.patternImage
    ? {
        backgroundImage: `url(${color.patternImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { backgroundColor: color.hex ?? "#9CA3AF" };

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        tabIndex={0}
        aria-label={color.name}
        className="inline-block rounded-full border-[1.5px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.14)] cursor-default outline-none focus:ring-2 focus:ring-text-primary/30 align-middle"
        style={{ width: `${size}px`, height: `${size}px`, ...bg }}
      />
      {hovered && coords && createPortal(
        <div
          role="tooltip"
          className="fixed z-[9999] pointer-events-none px-2 py-1 rounded-md bg-slate-900 text-white text-[11px] font-medium whitespace-nowrap shadow-lg -translate-x-1/2 -translate-y-full"
          style={{ left: coords.x, top: coords.y - 6 }}
        >
          {color.name}
          <span className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-4 border-transparent border-t-slate-900" />
        </div>,
        document.body,
      )}
    </>
  );
}
