"use client";

import { useEffect, useState } from "react";
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
  { key: "custom", label: "Personnalisée" },
];

interface Props {
  value: PfsPeriodKey;
  onChange: (v: PfsPeriodKey) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
}

export default function PfsPeriodBar({
  value,
  onChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
}: Props) {
  // Drafts locaux : la recherche n'est déclenchée que sur clic « Rechercher ».
  const [draftFrom, setDraftFrom] = useState<string>(customFrom);
  const [draftTo, setDraftTo] = useState<string>(customTo);

  useEffect(() => {
    setDraftFrom(customFrom);
  }, [customFrom]);
  useEffect(() => {
    setDraftTo(customTo);
  }, [customTo]);

  const invalidRange = value === "custom" && draftFrom && draftTo && draftTo < draftFrom;
  const bothEmpty = !draftFrom && !draftTo;
  const canSearch =
    value === "custom" &&
    !invalidRange &&
    !bothEmpty &&
    (draftFrom !== customFrom || draftTo !== customTo);

  const applySearch = () => {
    if (invalidRange || bothEmpty) return;
    // Propager les 2 valeurs dans le même tick → React batch → 1 seul refresh parent.
    if (draftFrom !== customFrom) onCustomFromChange(draftFrom);
    if (draftTo !== customTo) onCustomToChange(draftTo);
  };

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
      {value === "custom" && (
        <div className="basis-full flex items-center gap-2 mt-2 flex-nowrap overflow-x-auto whitespace-nowrap">
          <label className="inline-flex items-center gap-1.5 text-xs text-text-muted shrink-0">
            <span>Du</span>
            <input
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(e) => setDraftFrom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
              className="w-[10.5rem] shrink-0 rounded-lg border border-border bg-white px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-text-muted shrink-0">
            <span>au</span>
            <input
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(e) => setDraftTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
              className="w-[10.5rem] shrink-0 rounded-lg border border-border bg-white px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </label>
          <button
            type="button"
            onClick={applySearch}
            disabled={!canSearch}
            className="shrink-0 rounded-full px-3 py-1 text-sm bg-slate-900 text-white border border-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Rechercher
          </button>
          {invalidRange && (
            <span className="text-xs text-error shrink-0">Date de fin avant date de début.</span>
          )}
          {!invalidRange && bothEmpty && (
            <span className="text-xs text-text-muted italic shrink-0">Choisissez au moins une date.</span>
          )}
        </div>
      )}
    </div>
  );
}
