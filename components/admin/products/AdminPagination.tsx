"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

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

  return (
    <div className="flex items-center justify-end gap-1">
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
            className="px-1.5 text-sm text-text-muted font-[family-name:var(--font-roboto)] select-none"
          >
            ...
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => goTo(p)}
            className={`min-w-[32px] h-8 px-2 text-sm font-[family-name:var(--font-roboto)] border rounded-lg transition-colors ${
              p === currentPage
                ? "bg-bg-dark text-white border-bg-dark font-semibold"
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
