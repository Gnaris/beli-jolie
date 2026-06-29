import React from "react";

interface Props {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({ eyebrow, title, subtitle, actions }: Props) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          <span className="w-1 h-1 rounded-full bg-text-muted" aria-hidden />
          {eyebrow}
        </div>
        <h1 className="font-heading text-2xl sm:text-[26px] font-bold text-text-primary leading-tight tracking-tight m-0">
          {title}
        </h1>
        {subtitle && (
          <p className="font-body text-sm text-text-secondary mt-1 max-w-2xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  );
}
