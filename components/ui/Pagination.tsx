"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface PaginationProps {
  totalItems: number;
  perPage: number;
  currentPage: number;
  paramKey?: string;
  /** Label used in "Affichage 1–20 sur 248 X". */
  itemLabel?: string;
}

export function computePageRange(currentPage: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: (number | "…")[] = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  if (start > 2) pages.push("…");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages - 1) pages.push("…");
  pages.push(totalPages);
  return pages;
}

export default function Pagination({
  totalItems,
  perPage,
  currentPage,
  paramKey = "page",
  itemLabel = "éléments",
}: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const page = Math.min(Math.max(1, currentPage), totalPages);
  const from = totalItems === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, totalItems);

  function go(next: number) {
    const target = Math.min(Math.max(1, next), totalPages);
    const params = new URLSearchParams(searchParams.toString());
    if (target === 1) params.delete(paramKey);
    else params.set(paramKey, String(target));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const range = computePageRange(page, totalPages);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 border-t border-border bg-bg-secondary/40">
      <p className="text-[12.5px] font-body text-text-muted">
        Affichage{" "}
        <span className="font-semibold text-text-primary tabular-nums">
          {from}–{to}
        </span>{" "}
        sur{" "}
        <span className="font-semibold text-text-primary tabular-nums">{totalItems}</span>{" "}
        {itemLabel}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          aria-label="Page précédente"
          className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
            page <= 1
              ? "border-border text-text-muted/40 cursor-not-allowed"
              : "border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-border-strong"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {range.map((p, i) =>
          p === "…" ? (
            <span key={`sep-${i}`} className="px-2 text-text-muted text-sm">…</span>
          ) : p === page ? (
            <button
              key={p}
              type="button"
              aria-current="page"
              className="inline-flex items-center justify-center min-w-[36px] h-9 px-3 rounded-lg bg-gradient-to-br from-text-primary to-text-secondary text-white text-[13px] font-semibold shadow-sm"
            >
              {p}
            </button>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              className="inline-flex items-center justify-center min-w-[36px] h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-border-strong text-[13px] font-medium"
            >
              {p}
            </button>
          )
        )}

        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page >= totalPages}
          aria-label="Page suivante"
          className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
            page >= totalPages
              ? "border-border text-text-muted/40 cursor-not-allowed"
              : "border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-border-strong"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
