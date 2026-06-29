"use client";
import React from "react";

export interface StatusPillItem {
  key: string;
  label: string;
  count: number;
  dotColor?: string;
}

interface Props {
  items: StatusPillItem[];
  current: string;
  onChange: (key: string) => void;
}

export default function StatusPills({ items, current, onChange }: Props) {
  return (
    <div className="relative">
      <div className="flex gap-1.5 p-1 bg-bg-primary rounded-xl shadow-[var(--shadow-card)] border border-border w-fit max-w-full overflow-x-auto scrollbar-hide">
        {items.map((item) => {
          const isActive = current === item.key;
          return (
            <button
              key={item.key || "all"}
              type="button"
              onClick={() => onChange(item.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium whitespace-nowrap transition-colors duration-150 ${
                isActive
                  ? "bg-ink text-text-inverse font-semibold shadow-[var(--shadow-pop)]"
                  : "text-text-secondary hover:text-text-primary hover:bg-black/5"
              }`}
            >
              {item.dotColor && (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: item.dotColor }}
                  aria-hidden
                />
              )}
              {item.label}
              <span
                className={`text-[10.5px] px-1.5 py-0.5 rounded-full font-semibold tabular-nums ${
                  isActive ? "bg-white/15 text-white/85" : "bg-black/5 text-text-muted"
                }`}
              >
                {item.count.toLocaleString("fr-FR")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
