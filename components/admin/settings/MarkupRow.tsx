"use client";

import type { MarkupType, RoundingMode } from "@/lib/marketplace-pricing-shared";

export interface MarkupState {
  type: MarkupType;
  value: number;
  rounding: RoundingMode;
}

export function MarkupRow({
  label,
  state,
  onChange,
}: {
  label: string;
  state: MarkupState;
  onChange: (s: MarkupState) => void;
}) {
  const typeOptions: { value: MarkupType; label: string }[] = [
    { value: "percent", label: "%" },
    { value: "fixed", label: "€" },
    { value: "multiplier", label: "×" },
  ];
  const roundingOptions: { value: RoundingMode; label: string }[] = [
    { value: "none", label: "Aucun" },
    { value: "down", label: "↓" },
    { value: "up", label: "↑" },
  ];

  return (
    <div className="rounded-xl border border-border-light bg-bg-secondary/40 p-3.5">
      <p className="font-body text-xs font-medium text-text-primary mb-3">{label}</p>
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="sm:w-24">
          <label className="font-body text-[10px] text-text-muted mb-1 block uppercase tracking-wider">Valeur</label>
          <input
            type="number"
            step="0.01"
            value={state.value}
            onChange={(e) => onChange({ ...state, value: Number(e.target.value) || 0 })}
            className="w-full h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-bg-dark/15 transition-shadow"
          />
        </div>
        <div className="flex-1">
          <label className="font-body text-[10px] text-text-muted mb-1 block uppercase tracking-wider">Type</label>
          <div className="flex rounded-lg border border-border overflow-hidden h-9">
            {typeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...state, type: opt.value })}
                className={`flex-1 text-xs font-body font-medium transition-colors ${
                  state.type === opt.value
                    ? "bg-bg-dark text-text-inverse"
                    : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1">
          <label className="font-body text-[10px] text-text-muted mb-1 block uppercase tracking-wider">Arrondi</label>
          <div className="flex rounded-lg border border-border overflow-hidden h-9">
            {roundingOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...state, rounding: opt.value })}
                className={`flex-1 text-xs font-body font-medium transition-colors ${
                  state.rounding === opt.value
                    ? "bg-bg-dark text-text-inverse"
                    : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
