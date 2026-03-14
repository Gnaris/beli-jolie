"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface Props {
  currentPage: number;
  totalPages:  number;
}

function getPageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "…")[] = [];
  const left  = Math.max(2, current - 2);
  const right = Math.min(total - 1, current + 2);

  pages.push(1);
  if (left > 2)           pages.push("…");
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1)  pages.push("…");
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
      {/* Précédent */}
      <button
        type="button"
        disabled={currentPage <= 1}
        onClick={() => goTo(currentPage - 1)}
        className="p-1.5 text-[#94A3B8] hover:text-[#0F3460] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Page précédente"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Numéros */}
      {pages.map((p, i) =>
        p === "…" ? (
          <span
            key={`ellipsis-${i}`}
            className="px-1.5 text-sm text-[#94A3B8] font-[family-name:var(--font-roboto)] select-none"
          >
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => goTo(p)}
            className={`min-w-[32px] h-8 px-2 text-sm font-[family-name:var(--font-roboto)] border transition-colors ${
              p === currentPage
                ? "bg-[#0F3460] text-white border-[#0F3460] font-semibold"
                : "bg-white text-[#475569] border-[#E2E8F0] hover:border-[#0F3460] hover:text-[#0F3460]"
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
        className="p-1.5 text-[#94A3B8] hover:text-[#0F3460] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Page suivante"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
