"use client";

import { ReactNode } from "react";

// ─────────────────────────────────────────────
// ColorSwatch — pastille couleur (hex ou motif)
// ─────────────────────────────────────────────

export function ColorSwatch({
  hex,
  patternImage,
  size,
}: {
  hex: string | null;
  patternImage: string | null;
  size: number;
}) {
  const style: React.CSSProperties = patternImage
    ? {
        width: size,
        height: size,
        backgroundImage: `url(${patternImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : {
        width: size,
        height: size,
        backgroundColor: hex ?? "#E5E7EB",
      };
  return (
    <span
      className="inline-block rounded-full border border-border shrink-0"
      style={style}
      aria-hidden
    />
  );
}

// ─────────────────────────────────────────────
// SearchField — input recherche avec icône + bouton
// ─────────────────────────────────────────────

export function SearchField({
  label,
  helper,
  value,
  onChange,
  onSubmit,
  placeholder,
  loading,
  disabled,
  rightSlot,
}: {
  label: string;
  helper?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  rightSlot?: ReactNode;
}) {
  return (
    <div>
      <label className="block font-body text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">
        {label}
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onSubmit) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-bg-dark/15 focus:border-bg-dark/30 disabled:opacity-60"
          />
        </div>
        {onSubmit && (
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled || loading || !value.trim()}
            className="h-10 px-5 rounded-lg bg-bg-dark text-text-inverse text-xs font-body font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {loading ? "Recherche…" : "Rechercher"}
          </button>
        )}
        {rightSlot}
      </div>
      {helper && (
        <p className="mt-2 font-body text-[11px] text-text-muted leading-relaxed">{helper}</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// CalloutCard — bloc info / avertissement / erreur / succès
// ─────────────────────────────────────────────

type CalloutTone = "info" | "success" | "warning" | "danger" | "neutral";

const CALLOUT_TONES: Record<
  CalloutTone,
  { wrap: string; iconBg: string; iconColor: string; title: string; body: string }
> = {
  info: {
    wrap: "bg-sky-50 border-sky-200",
    iconBg: "bg-sky-100",
    iconColor: "text-sky-700",
    title: "text-sky-900",
    body: "text-sky-800/85",
  },
  success: {
    wrap: "bg-emerald-50 border-emerald-200",
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-700",
    title: "text-emerald-900",
    body: "text-emerald-800/85",
  },
  warning: {
    wrap: "bg-amber-50 border-amber-200",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-800",
    title: "text-amber-900",
    body: "text-amber-900/85",
  },
  danger: {
    wrap: "bg-rose-50 border-rose-200",
    iconBg: "bg-rose-100",
    iconColor: "text-rose-700",
    title: "text-rose-900",
    body: "text-rose-800/85",
  },
  neutral: {
    wrap: "bg-bg-secondary border-border-light",
    iconBg: "bg-bg-tertiary",
    iconColor: "text-text-secondary",
    title: "text-text-primary",
    body: "text-text-secondary",
  },
};

export function Callout({
  tone = "info",
  icon,
  title,
  children,
}: {
  tone?: CalloutTone;
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  const t = CALLOUT_TONES[tone];
  return (
    <div className={`rounded-xl border ${t.wrap} px-4 py-3`}>
      <div className="flex items-start gap-3">
        {icon && (
          <span
            className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${t.iconBg} ${t.iconColor}`}
          >
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className={`font-body text-sm font-semibold ${t.title}`}>{title}</p>
          {children && <div className={`font-body text-xs mt-1 ${t.body}`}>{children}</div>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// IconBank — petits SVG factorisés
// ─────────────────────────────────────────────

export const ModalIcons = {
  Check: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  Warning: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  ),
  Info: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  ),
  Sparkles: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  ),
  Block: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  ),
  Search: (
    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
    </svg>
  ),
  Arrow: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
    </svg>
  ),
  Image: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  ),
};

// ─────────────────────────────────────────────
// EmptyState — état vide standardisé
// ─────────────────────────────────────────────

export function EmptyState({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-bg-primary px-6 py-12 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-bg-secondary text-text-muted mb-3">
        {ModalIcons.Search}
      </div>
      <p className="font-body text-sm font-semibold text-text-primary mb-1">{title}</p>
      {description && (
        <p className="font-body text-xs text-text-muted max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// LoadingState — bloc chargement standardisé
// ─────────────────────────────────────────────

export function LoadingState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-3">
      <svg className="w-8 h-8 text-text-primary animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <p className="font-body text-sm text-text-secondary">{children}</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// MappingProgress — pastille « 3/5 liées »
// ─────────────────────────────────────────────

export function MappingProgress({
  current,
  total,
  done,
}: {
  current: number;
  total: number;
  done: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold font-body ${
        done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${done ? "bg-emerald-500" : "bg-amber-500"}`} />
      {current}/{total} liée{current > 1 ? "s" : ""}
    </span>
  );
}

// ─────────────────────────────────────────────
// FooterButtons — boutons standardisés du footer
// ─────────────────────────────────────────────

export function ModalButton({
  children,
  onClick,
  disabled,
  variant = "secondary",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  title?: string;
}) {
  const base =
    "h-10 px-5 rounded-lg text-sm font-body font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-bg-dark text-text-inverse hover:bg-primary-hover"
      : "border border-border text-text-secondary bg-bg-primary hover:bg-bg-secondary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${styles}`}
    >
      {children}
    </button>
  );
}
