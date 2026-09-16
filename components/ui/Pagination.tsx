"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useTransition } from "react";

interface PaginationProps {
  totalItems: number;
  perPage: number;
  currentPage: number;
  paramKey?: string;
  /** Label used in "Affichage 1–20 sur 248 X". */
  itemLabel?: string;
  /** Affiche un overlay pendant la navigation (feedback utilisateur). Défaut false. */
  showLoadingOverlay?: boolean;
  /** Nombre de pages avant/après à préfetcher (RSC Next.js). Défaut 0 = pas de prefetch. */
  prefetchRange?: number;
  /** URLs d'images à préfetcher en tâche de fond (<link rel="prefetch" as="image">). */
  prefetchImageUrls?: string[];
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
  showLoadingOverlay = false,
  prefetchRange = 0,
  prefetchImageUrls,
}: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const page = Math.min(Math.max(1, currentPage), totalPages);
  const from = totalItems === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, totalItems);

  const buildUrl = useCallback(
    (target: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (target === 1) params.delete(paramKey);
      else params.set(paramKey, String(target));
      const q = params.toString();
      return q ? `${pathname}?${q}` : pathname;
    },
    [pathname, searchParams, paramKey],
  );

  // Prefetch RSC des pages voisines : la navigation devient quasi-instantanée
  // car la data serveur est déjà en cache Next.js quand la cliente clique.
  useEffect(() => {
    if (prefetchRange <= 0) return;
    const start = Math.max(1, page - prefetchRange);
    const end = Math.min(totalPages, page + prefetchRange);
    for (let p = start; p <= end; p++) {
      if (p !== page) router.prefetch(buildUrl(p));
    }
  }, [page, totalPages, prefetchRange, router, buildUrl]);

  // Preload des vignettes produits des pages voisines : le navigateur télécharge
  // les images en priorité basse pendant que la cliente regarde la page en cours.
  useEffect(() => {
    if (!prefetchImageUrls || prefetchImageUrls.length === 0) return;
    const links: HTMLLinkElement[] = [];
    for (const url of prefetchImageUrls) {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.as = "image";
      link.href = url;
      link.setAttribute("fetchpriority", "low");
      document.head.appendChild(link);
      links.push(link);
    }
    return () => {
      for (const l of links) l.remove();
    };
  }, [prefetchImageUrls]);

  function go(next: number) {
    const target = Math.min(Math.max(1, next), totalPages);
    if (target === page) return;
    const url = buildUrl(target);
    if (showLoadingOverlay) {
      startTransition(() => {
        router.replace(url, { scroll: false });
      });
    } else {
      router.replace(url, { scroll: false });
    }
  }

  const range = computePageRange(page, totalPages);

  return (
    <>
      {showLoadingOverlay && isPending && (
        <div
          role="status"
          aria-live="polite"
          aria-label="Chargement de la page"
          className="fixed inset-0 z-50 bg-white/50 backdrop-blur-[2px] pointer-events-none flex items-center justify-center"
        >
          <div className="rounded-full border-4 border-text-primary/20 border-t-text-primary w-12 h-12 animate-spin" />
        </div>
      )}
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
    </>
  );
}
