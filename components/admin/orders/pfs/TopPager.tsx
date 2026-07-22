"use client";

interface Props {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  total: number;
  onChange: (page: number) => void;
}

/**
 * Mini pagination locale utilisée sous les tops (clients / produits) — 10 par page.
 * Pas de router : les tops sont peuplés depuis `stats` en mémoire (max 100 lignes
 * capées côté serveur).
 */
export default function TopPager({ page, totalPages, startIndex, endIndex, total, onChange }: Props) {
  if (totalPages <= 1) return null;
  const prev = () => onChange(Math.max(1, page - 1));
  const next = () => onChange(Math.min(totalPages, page + 1));
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-text-muted">
      <span>
        <span className="font-semibold text-text-primary tabular-nums">
          {startIndex}–{endIndex}
        </span>
        {" sur "}
        <span className="font-semibold text-text-primary tabular-nums">{total}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={prev}
          disabled={page <= 1}
          className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-border bg-white hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Page précédente"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="tabular-nums text-text-primary font-medium min-w-[3rem] text-center">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={next}
          disabled={page >= totalPages}
          className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-border bg-white hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Page suivante"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
