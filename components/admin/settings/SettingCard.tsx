import type { ReactNode } from "react";

/**
 * Enveloppe visuelle standard des sections dans /admin/parametres.
 * Header sombre avec icône carrée + titre Playfair + description,
 * puis corps blanc pour le composant fonctionnel.
 */

type Accent = "dark" | "subtle";

type StatusTone = "ok" | "warn" | "off" | "danger";

export function SettingCard({
  icon, title, description, children, accent = "subtle", status,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  accent?: Accent;
  status?: { tone: StatusTone; label: string };
}) {
  const iconClass = accent === "dark"
    ? "bg-gradient-to-br from-text-primary to-text-secondary text-white border border-text-primary shadow-md"
    : "bg-bg-secondary text-text-primary border border-border-strong";

  return (
    <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
      <div className="relative flex items-start gap-3 sm:gap-4 px-4 sm:px-5 py-4 border-b border-border bg-gradient-to-b from-bg-secondary/40 to-bg-primary">
        <div className={`inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${iconClass}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-heading text-[15px] sm:text-base font-bold text-text-primary leading-tight">{title}</h3>
          {description && (
            <p className="text-[12.5px] text-text-muted font-body mt-1 leading-snug">{description}</p>
          )}
        </div>
        {status && <StatusChip tone={status.tone} label={status.label} />}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  const toneMap: Record<StatusTone, { chip: string; dot: string; pulse: boolean }> = {
    ok:     { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500", pulse: true },
    warn:   { chip: "bg-amber-50 text-amber-800 border-amber-200",       dot: "bg-amber-500",   pulse: false },
    off:    { chip: "bg-bg-secondary text-text-muted border-border-strong", dot: "bg-text-muted/60", pulse: false },
    danger: { chip: "bg-red-50 text-red-800 border-red-200",             dot: "bg-red-500",     pulse: true },
  };
  const t = toneMap[tone];
  return (
    <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-body font-bold uppercase tracking-[0.05em] border ${t.chip}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot} ${t.pulse ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

export function CardsStack({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}
