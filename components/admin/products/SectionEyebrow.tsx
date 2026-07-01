"use client";

/**
 * Petit eyebrow "Ardoise" : barre verticale + label en majuscules.
 * À placer en haut d'une card pour poser le vocabulaire visuel.
 */
export function SectionEyebrow({
  label,
  hint,
  action,
  tone = "ink",
}: {
  label: string;
  hint?: string;
  action?: React.ReactNode;
  tone?: "ink" | "muted";
}) {
  return (
    <div className="flex items-start gap-3 pb-3 mb-3 border-b border-border">
      <span
        className={
          "w-1 h-4 rounded-sm mt-1 shrink-0 " +
          (tone === "muted" ? "bg-border-dark" : "bg-bg-dark")
        }
      />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-heading font-bold uppercase tracking-[0.12em] text-text-muted">
          {label}
        </div>
        {hint && (
          <div className="text-[11px] text-text-muted font-body mt-0.5">
            {hint}
          </div>
        )}
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}
