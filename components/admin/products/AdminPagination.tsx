"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  currentPage: number;
  totalPages:  number;
}

function getPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "...")[] = [];
  const left  = Math.max(2, current - 2);
  const right = Math.min(total - 1, current + 2);

  pages.push(1);
  if (left > 2)           pages.push("...");
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1)  pages.push("...");
  pages.push(total);

  return pages;
}

export default function AdminPagination({ currentPage, totalPages }: Props) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (totalPages <= 1) return null;

  const goTo = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    startTransition(() => {
      router.push(`/admin/produits?${params.toString()}`);
    });
  };

  const pages = getPageNumbers(currentPage, totalPages);

  const [goToValue, setGoToValue] = useState("");

  const handleGoToPage = () => {
    const page = parseInt(goToValue, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      goTo(page);
      setGoToValue("");
    }
  };

  return (
    <>
      {/* Loading overlay */}
      {isPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
          <div className="flex items-center gap-3 bg-bg-primary border border-border rounded-2xl px-6 py-4 shadow-lg">
            <svg className="w-5 h-5 animate-spin text-bg-dark" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium font-body text-text-primary">Chargement…</span>
          </div>
        </div>
      )}
    <div className="flex items-center justify-end gap-1.5">
      {/* Aller a la page */}
      <div className="flex items-center gap-1.5 mr-3 bg-bg-primary border border-border rounded-xl px-3 py-1.5">
        <span className="text-[11px] text-text-muted font-body whitespace-nowrap">Page</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={goToValue}
          onChange={(e) => setGoToValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleGoToPage(); }}
          placeholder={String(currentPage)}
          className="w-10 h-7 px-1.5 text-[12px] text-center font-body font-medium border border-border rounded-lg bg-bg-secondary focus:outline-none focus:border-bg-dark transition-colors tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[11px] text-text-muted font-body tabular-nums">/ {totalPages}</span>
        {goToValue && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleGoToPage}
            className="h-7 px-2.5 text-[11px] font-body font-semibold bg-bg-dark text-text-inverse rounded-lg hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            OK
          </button>
        )}
      </div>

      {/* Precedent */}
      <button
        type="button"
        disabled={currentPage <= 1}
        onClick={() => goTo(currentPage - 1)}
        className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all rounded-lg"
        aria-label="Page precedente"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Numeros */}
      {pages.map((p, i) =>
        p === "..." ? (
          <span
            key={`ellipsis-${i}`}
            className="px-1 text-[11px] text-text-muted font-body select-none"
          >
            ...
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => goTo(p)}
            className={`min-w-[32px] h-8 px-2 text-[12px] font-body border rounded-xl transition-all tabular-nums ${
              p === currentPage
                ? "bg-bg-dark text-text-inverse border-bg-dark font-bold shadow-sm"
                : "bg-bg-primary text-text-secondary border-border hover:border-border-dark hover:text-text-primary hover:shadow-sm"
            }`}
          >
            {p}
          </button>
        )
      )}

      {/* Suivant */}
      <button
        type="button"
        disabled={currentPage >= totalPages}
        onClick={() => goTo(currentPage + 1)}
        className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all rounded-lg"
        aria-label="Page suivante"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
    </>
  );
}
