"use client";
import React from "react";

interface Props {
  logo: string;
  logoKind: "pfs" | "ef" | "ankor" | "faire";
  name: string;
  sub: string;
  linked: boolean;
  selectLabel: string;
  selectSwatch?: string;
  onSelectClick: () => void;
  onClear?: () => void;
}

const LOGO_GRADIENTS: Record<Props["logoKind"], string> = {
  pfs: "from-[#4f46e5] to-[#6366f1]",
  ef: "from-[#db2777] to-[#ec4899]",
  ankor: "from-[#0ea5e9] to-[#38bdf8]",
  faire: "from-[#f59e0b] to-[#fbbf24]",
};

export default function MappingCard({
  logo, logoKind, name, sub, linked, selectLabel, selectSwatch, onSelectClick, onClear,
}: Props) {
  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <div
          className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-extrabold text-white shadow-sm bg-gradient-to-br ${LOGO_GRADIENTS[logoKind]}`}
          aria-hidden
        >
          {logo}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-text-primary">{name}</div>
          <div className="text-[11px] text-text-muted">{sub}</div>
        </div>
        <span
          className={`ml-auto text-[10.5px] px-2.5 py-1 rounded-full font-bold ${
            linked ? "bg-success-bg text-success" : "bg-warning-bg text-warning"
          }`}
        >
          {linked ? "✓ lié" : "non lié"}
        </span>
      </div>
      <div className="flex gap-1.5 items-stretch">
        <button
          type="button"
          onClick={onSelectClick}
          className="flex-1 min-w-0 bg-white border border-border-strong rounded-lg px-3.5 py-2.5 flex items-center gap-2.5 text-[13px] text-text-primary hover:border-ink"
        >
          {selectSwatch && (
            <span className="w-4 h-4 rounded-sm border border-black/5" style={{ backgroundColor: selectSwatch }} aria-hidden />
          )}
          <span className={selectLabel ? "" : "italic text-text-muted"}>
            {selectLabel || "Sélectionner…"}
          </span>
          <span className="ml-auto opacity-45 text-xs">▾</span>
        </button>
        {linked && onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Délier"
            title="Délier"
            className="w-[38px] flex-shrink-0 bg-white border border-border-strong rounded-lg flex items-center justify-center text-error hover:bg-error-bg hover:border-error"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
