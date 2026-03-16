"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";

const PRESET_PER_PAGE = [20, 30, 40, 50, 100];

interface Props {
  totalCount: number;
}

export default function AdminProductsFilters({ totalCount }: Props) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const q       = searchParams.get("q")       ?? "";
  const perPage = searchParams.get("perPage") ?? "20";

  const [customValue, setCustomValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const navigate = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      params.delete("page");
      startTransition(() => {
        router.push(`/admin/produits?${params.toString()}`);
      });
    },
    [router, searchParams]
  );

  const isPreset = PRESET_PER_PAGE.map(String).includes(perPage);

  const applyCustom = () => {
    const val = parseInt(customValue);
    if (!isNaN(val) && val > 0) {
      navigate({ perPage: String(val) });
      setCustomValue("");
    }
  };

  return (
    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
      {/* Recherche */}
      <div className="relative flex-1 max-w-sm">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="search"
          defaultValue={q}
          onChange={(e) => navigate({ q: e.target.value })}
          placeholder="Rechercher un produit, une reference..."
          className="w-full pl-9 pr-3 py-2 border border-border bg-bg-primary text-sm font-[family-name:var(--font-roboto)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-bg-dark transition-colors rounded-lg"
        />
      </div>

      {/* Separateur */}
      <div className="hidden sm:block h-5 w-px bg-border" />

      {/* Quantite par page */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-text-muted font-[family-name:var(--font-roboto)] whitespace-nowrap">
          Afficher
        </span>
        <div className="flex items-center gap-1">
          {PRESET_PER_PAGE.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => navigate({ perPage: String(n) })}
              className={`px-2.5 py-1 text-xs font-[family-name:var(--font-roboto)] border rounded-lg transition-colors ${
                String(n) === perPage
                  ? "bg-bg-dark text-white border-bg-dark"
                  : "bg-bg-primary text-text-secondary border-border hover:border-bg-dark hover:text-text-primary"
              }`}
            >
              {n}
            </button>
          ))}
          {/* Custom input */}
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="number"
              min={1}
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyCustom(); }}
              placeholder={!isPreset ? perPage : "..."}
              className={`w-16 px-2 py-1 text-xs border rounded-lg font-[family-name:var(--font-roboto)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-bg-dark transition-colors ${
                !isPreset ? "border-bg-dark bg-bg-secondary" : "border-border bg-bg-primary"
              }`}
            />
            {customValue && (
              <button
                type="button"
                onClick={applyCustom}
                className="px-2 py-1 text-xs bg-bg-dark text-white font-[family-name:var(--font-roboto)] rounded-lg hover:bg-neutral-800 transition-colors"
              >
                OK
              </button>
            )}
          </div>
        </div>
        <span className="text-xs text-text-muted font-[family-name:var(--font-roboto)] whitespace-nowrap">
          / {totalCount} produit{totalCount > 1 ? "s" : ""}
        </span>
      </div>

      {/* Reset */}
      {q && (
        <button
          type="button"
          onClick={() => navigate({ q: null })}
          className="text-xs text-text-muted hover:text-text-primary font-[family-name:var(--font-roboto)] underline shrink-0 transition-colors"
        >
          Reinitialiser
        </button>
      )}
    </div>
  );
}
