"use client";

import type { PfsPeriodKey } from "@/app/actions/admin/pfs-orders";

const OPTIONS: Array<{ key: PfsPeriodKey; label: string }> = [
  { key: "today", label: "Aujourd'hui" },
  { key: "3d", label: "3 j" },
  { key: "week", label: "Semaine" },
  { key: "15d", label: "15 j" },
  { key: "month", label: "Ce mois-ci" },
  { key: "3m", label: "3 mois" },
  { key: "6m", label: "6 mois" },
  { key: "year", label: "Année" },
  { key: "all", label: "Tout" },
];

interface Props {
  value: PfsPeriodKey;
  onChange: (v: PfsPeriodKey) => void;
}

export default function PfsPeriodBar({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs uppercase tracking-[0.2em] text-text-muted mr-2">Période</span>
      {OPTIONS.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`rounded-full px-3 py-1 text-sm border transition-colors ${
              active
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-text-secondary border-border hover:bg-bg-secondary"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
