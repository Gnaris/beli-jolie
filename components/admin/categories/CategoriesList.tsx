"use client";

import { useState, useMemo } from "react";
import { matchesSearch, matchesFilters, countMissing, type CategoryForFilters, type FilterKey } from "@/lib/category-filters";

type Cat = CategoryForFilters & { productCount: number };

type Props = {
  categories: Cat[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  hasPfsConfig: boolean;
  hasEfashionConfig: boolean;
  hasFaireConfig: boolean;
};

export default function CategoriesList({
  categories,
  selectedId,
  onSelect,
  hasPfsConfig,
  hasEfashionConfig,
  hasFaireConfig,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set());

  const filtered = useMemo(
    () => categories.filter((c) => matchesSearch(c, query) && matchesFilters(c, activeFilters)),
    [categories, query, activeFilters],
  );

  const productSum = filtered.reduce((acc, c) => acc + c.productCount, 0);

  function toggleFilter(key: FilterKey) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const FILTERS: { key: FilterKey; label: string; show: boolean }[] = [
    { key: "missingTranslation", label: "Sans traduction", show: true },
    { key: "missingPfs", label: "Sans PFS", show: hasPfsConfig },
    { key: "missingEfashion", label: "Sans eFashion", show: hasEfashionConfig },
    { key: "missingFaire", label: "Sans Faire", show: hasFaireConfig },
  ].filter((f) => f.show);

  return (
    <div className="flex flex-col min-h-[580px] bg-gradient-to-b from-bg-secondary to-bg-primary">
      {/* Search */}
      <div className="px-3.5 py-4 bg-bg-primary border-b border-border">
        <div className="relative">
          <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">⌕</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une catégorie…"
            className="w-full bg-bg-secondary border border-transparent rounded-xl pl-9 pr-3 py-2.5 text-[13px] text-text-primary focus:bg-bg-primary focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink/8 transition-all shadow-[var(--shadow-inset)]"
          />
        </div>
      </div>
      {/* Quick filters */}
      <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5 bg-bg-primary border-b border-border">
        {FILTERS.map((f) => {
          const active = activeFilters.has(f.key);
          const count = countMissing(categories, f.key);
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => toggleFilter(f.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border transition-colors shadow-[var(--shadow-sm)] ${
                active
                  ? "bg-ink text-text-inverse border-ink"
                  : "bg-bg-primary text-text-secondary border-border hover:border-border-dark hover:text-text-primary"
              }`}
            >
              ⚠ {f.label}
              {count > 0 && (
                <span className={`px-1.5 py-px rounded-full text-[10px] font-bold ${active ? "bg-white/15 text-white" : "bg-amber-100 text-amber-700"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* List */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {filtered.map((c) => {
          const isActive = c.id === selectedId;
          const missingTr = !(c.translations.fr && c.translations.fr.trim() && c.translations.en && c.translations.en.trim());
          return (
            <div
              key={c.id}
              data-cat-id={c.id}
              data-active={isActive}
              onClick={() => onSelect(c.id)}
              className={`relative flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer mb-0.5 transition-all ${
                isActive
                  ? "bg-gradient-to-b from-[#2A2D33] to-[#18181B] text-text-inverse shadow-[var(--shadow-pop)]"
                  : "hover:bg-bg-tertiary text-text-primary"
              }`}
            >
              {isActive && <span aria-hidden className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-ink rounded-r" />}
              <span className={`text-[13.5px] ${isActive ? "font-semibold" : "font-medium"}`}>{c.name}</span>
              <div className="flex items-center gap-1.5">
                {missingTr && (
                  <span aria-hidden className="w-[7px] h-[7px] rounded-full bg-amber-300 shadow-[0_0_0_2.5px_rgba(255,251,235,1)]" title="Sans traduction" />
                )}
                <span className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold ${isActive ? "bg-white/15" : "bg-bg-tertiary"}`}>
                  {c.productCount}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {/* Total */}
      <div className="px-3.5 py-3 bg-bg-primary border-t border-border text-[11px] text-text-muted text-center font-medium">
        {filtered.length} catégorie{filtered.length > 1 ? "s" : ""} · {productSum.toLocaleString("fr-FR")} produits
      </div>
    </div>
  );
}
