import React from "react";

interface Props {
  children: React.ReactNode;
  number?: number;
  actions?: React.ReactNode;
}

export default function SectionHeader({ children, number, actions }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <h3 className="flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-text-muted m-0">
        <span className="inline-block w-[3px] h-3.5 rounded-sm bg-ink" aria-hidden />
        {number !== undefined ? `${number} · ${children}` : children}
      </h3>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
