"use client";
import React from "react";

export interface EntityBadge {
  label: string;
  kind: "neutral" | "ok" | "warn" | "err" | "info";
}

interface Props {
  visual: React.ReactNode;
  name: string;
  sub: string;
  badges: EntityBadge[];
  onClick: () => void;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  onMore?: () => void;
  warn?: boolean;
}

const BADGE_CLS: Record<EntityBadge["kind"], string> = {
  neutral: "bg-bg-tertiary text-text-secondary border-border",
  ok: "bg-success-bg text-success border-[#bbf7d0]",
  warn: "bg-warning-bg text-warning border-[#fde68a]",
  err: "bg-error-bg text-error border-[#fecaca]",
  info: "bg-info-bg text-info border-[#bfdbfe]",
};

export default function EntityCard({
  visual,
  name,
  sub,
  badges,
  onClick,
  selected,
  onSelect,
  onMore,
  warn,
}: Props) {
  const ringCls = selected
    ? "ring-2 ring-ink shadow-[var(--shadow-pop)]"
    : "hover:-translate-y-0.5 hover:border-text-primary hover:shadow-[var(--shadow-pop)]";
  const warnCls = warn
    ? "border-[#fde68a] bg-gradient-to-t from-[#fffbeb] to-white"
    : "border-border bg-bg-primary";

  return (
    <div
      onClick={onClick}
      className={`group relative rounded-2xl overflow-hidden border shadow-[var(--shadow-card)] cursor-pointer transition-all flex flex-col ${ringCls} ${warnCls}`}
    >
      <div className="relative">
        {visual}
        {onSelect && (
          <button
            type="button"
            aria-label="Sélectionner"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(!selected);
            }}
            className={`absolute top-2 left-2 w-[18px] h-[18px] rounded border-[1.5px] bg-white/85 backdrop-blur-sm cursor-pointer transition-opacity ${
              selected
                ? "opacity-100 bg-ink border-ink"
                : "opacity-0 group-hover:opacity-100 border-white/90"
            }`}
          >
            {selected && (
              <span className="absolute left-[3px] top-px text-white text-[10px] font-bold">
                ✓
              </span>
            )}
          </button>
        )}
        {onMore && (
          <button
            type="button"
            aria-label="Plus d'actions"
            onClick={(e) => {
              e.stopPropagation();
              onMore();
            }}
            className="absolute top-1.5 right-1.5 w-[26px] h-[26px] rounded-md bg-white/85 backdrop-blur-sm text-text-primary text-base flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer"
          >
            ⋯
          </button>
        )}
      </div>
      <div className="px-3.5 py-3 flex flex-col gap-1.5">
        <p className="text-[13.5px] font-bold text-text-primary m-0 truncate">
          {name}
        </p>
        {sub && (
          <span className="text-[11px] text-text-muted font-mono tabular-nums">
            {sub}
          </span>
        )}
        {badges.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mt-1.5">
            {badges.map((b, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] font-semibold ${BADGE_CLS[b.kind]}`}
              >
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
