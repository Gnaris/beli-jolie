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
  const [, startTransition] = useTransition();

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
    <div className="flex items-center justify-end gap-2">
      {/* Aller a la page */}
      <div className="flex items-center gap-1.5 mr-2">
        <span className="text-sm text-text-muted font-body whitespace-nowrap">Page</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={goToValue}
          onChange={(e) => setGoToValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleGoToPage(); }}
          placeholder={String(currentPage)}
          className="w-14 h-8 px-2 text-sm text-center font-body border border-border rounded-lg bg-bg-primary focus:outline-none focus:border-bg-dark transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-sm text-text-muted font-body">/ {totalPages}</span>
      </div>

      {/* Precedent */}
      <button
        type="button"
        disabled={currentPage <= 1}
        onClick={() => goTo(currentPage - 1)}
        className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
            className="px-1.5 text-sm text-text-muted font-body select-none"
          >
            ...
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => goTo(p)}
            className={`min-w-[32px] h-8 px-2 text-sm font-body border rounded-lg transition-colors ${
              p === currentPage
                ? "bg-bg-dark text-text-inverse border-bg-dark font-semibold"
                : "bg-bg-primary text-text-secondary border-border hover:border-bg-dark hover:text-text-primary"
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
        className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Page suivante"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
