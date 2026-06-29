"use client";
import React, { useRef, useState, useEffect } from "react";

export interface SuggestionChip {
  id: string;
  display: string;
  badge?: string;
  badgeKind?: "pfs" | "ef";
  swatch?: string;
  ref?: string;
  applied?: boolean;
}

export interface SuggestionLine {
  label: string;
  chips: SuggestionChip[];
}

interface Props {
  forName: string;
  lines: SuggestionLine[];
  onApply: (lineLabel: string, chipId: string) => void;
}

export default function SuggestionsPanel({ forName, lines, onApply }: Props) {
  if (lines.every((l) => l.chips.length === 0)) return null;

  return (
    <div className="relative flex flex-col gap-3 p-3.5 rounded-[11px] border border-[#e0e7ff] bg-gradient-to-b from-[#fafaff] to-white">
      <span className="absolute -top-2.5 left-3.5 bg-white px-1.5 text-sm" aria-hidden>💡</span>
      <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#4338ca]">
        Suggestions pour{" "}
        <span className="text-text-primary font-semibold normal-case tracking-normal text-[11.5px]">
          « {forName} »
        </span>
      </div>
      {lines.map((line) => (
        <SuggestionLineRow key={line.label} line={line} onApply={onApply} />
      ))}
    </div>
  );
}

function SuggestionLineRow({
  line, onApply,
}: { line: SuggestionLine; onApply: (l: string, id: string) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = () => {
    const el = trackRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 0);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    update();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [line.chips]);

  const scrollBy = (delta: number) => {
    trackRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  if (line.chips.length === 0) return null;

  return (
    <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: "60px 28px 1fr 28px" }}>
      <div className="text-[10.5px] font-bold text-text-muted whitespace-nowrap">{line.label}</div>
      <ArrowBtn dir="left" disabled={!canLeft} onClick={() => scrollBy(-160)} />
      <div className="relative overflow-hidden min-w-0">
        <div
          ref={trackRef}
          className="flex gap-1.5 items-center flex-nowrap overflow-x-auto scroll-smooth scrollbar-hide py-0.5"
        >
          {line.chips.map((c) => (
            <SuggestionChipView key={c.id} chip={c} onClick={() => onApply(line.label, c.id)} />
          ))}
        </div>
      </div>
      <ArrowBtn dir="right" disabled={!canRight} onClick={() => scrollBy(160)} />
    </div>
  );
}

function ArrowBtn({ dir, disabled, onClick }: { dir: "left" | "right"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "left" ? "Défiler à gauche" : "Défiler à droite"}
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
        disabled
          ? "bg-bg-tertiary text-border-dark border border-border opacity-55 cursor-not-allowed"
          : "bg-white text-[#4f46e5] border border-[#c7d2fe] shadow-[0_2px_6px_rgba(79,70,229,0.12)] hover:bg-[#4f46e5] hover:text-white hover:scale-110"
      }`}
    >
      {dir === "left" ? "◀" : "▶"}
    </button>
  );
}

function SuggestionChipView({ chip, onClick }: { chip: SuggestionChip; onClick: () => void }) {
  const appliedCls = chip.applied
    ? "bg-success-bg border-[#86efac] text-success"
    : "bg-white border-[#c7d2fe] text-text-primary hover:border-[#4f46e5] hover:bg-[#f0f0ff]";
  return (
    <button
      type="button"
      onClick={onClick}
      data-applied={chip.applied ? "true" : "false"}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11.5px] font-semibold cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,0.04)] flex-shrink-0 whitespace-nowrap transition-all ${appliedCls}`}
    >
      {chip.badge && (
        <span
          className={`text-[9px] font-bold uppercase tracking-[0.08em] px-1 py-px rounded text-white ${
            chip.badgeKind === "pfs" ? "bg-gradient-to-br from-[#4f46e5] to-[#6366f1]" : "bg-gradient-to-br from-[#db2777] to-[#ec4899]"
          }`}
        >
          {chip.badge}
        </span>
      )}
      {chip.swatch && (
        <span
          className="w-3 h-3 rounded-sm border border-black/10"
          style={{ backgroundColor: chip.swatch }}
          aria-hidden
        />
      )}
      <span>{chip.display}</span>
      {chip.ref && <span className="font-mono text-[11px]">{chip.ref}</span>}
      {chip.applied && <span aria-label="appliqué">✓</span>}
    </button>
  );
}
