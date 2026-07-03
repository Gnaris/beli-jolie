"use client";

import { useState, useMemo } from "react";
import {
  matchesSearch,
  matchesFilters,
  countMissing,
  type CountryForFilters,
  type CountryFilterKey,
} from "@/lib/country-filters";

type Item = CountryForFilters & { productCount: number };

type Props = {
  items: Item[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function isoToFlag(iso: string | null | undefined): string {
  if (!iso || !/^[A-Za-z]{2}$/.test(iso)) return "🏳️";
  const A = 0x1f1e6;
  const up = iso.toUpperCase();
  return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65);
}

export default function CountriesList({ items, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<CountryFilterKey>>(new Set());

  const filtered = useMemo(
    () => items.filter((c) => matchesSearch(c, query) && matchesFilters(c, activeFilters)),
    [items, query, activeFilters],
  );

  const productSum = filtered.reduce((acc, c) => acc + c.productCount, 0);

  function toggleFilter(key: CountryFilterKey) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const FILTERS: { key: CountryFilterKey; label: string }[] = [
    { key: "missingIso", label: "Sans ISO" },
    { key: "missingTranslation", label: "Sans traduction" },
    { key: "missingMapping", label: "Sans mapping" },
    { key: "unused", label: "Inutilisés" },
  ];

  return (
    <div className="flex flex-col min-h-[580px] md:min-h-0 md:h-full bg-gradient-to-b from-bg-secondary to-bg-primary">
      {/* Search */}
      <div className="px-3.5 py-4 bg-bg-primary border-b border-border">
        <div className="relative">
          <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">⌕</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un pays ou un code ISO…"
            className="w-full bg-bg-secondary border border-transparent rounded-xl pl-9 pr-3 py-2.5 text-[13px] text-text-primary focus:bg-bg-primary focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink/8 transition-all shadow-[var(--shadow-inset)]"
          />
        </div>
      </div>

      {/* Quick filters */}
      <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5 bg-bg-primary border-b border-border">
        {FILTERS.map((f) => {
          const active = activeFilters.has(f.key);
          const count = countMissing(items, f.key);
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
              {f.label}
              {count > 0 && (
                <span className={`px-1.5 py-px rounded-full text-[10px] font-bold ${active ? "bg-white/15 text-white" : "bg-bg-tertiary text-text-secondary"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted font-body text-center py-8 px-4">
            Aucun pays ne correspond.
          </p>
        ) : (
          filtered.map((item) => {
            const isActive = item.id === selectedId;
            const missingTr = Object.keys(item.translations).length === 0;
            const enName = item.translations["en"];
            return (
              <button
                key={item.id}
                type="button"
                data-country-id={item.id}
                data-active={isActive}
                onClick={() => onSelect(item.id)}
                className={`relative flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer mb-0.5 transition-all text-left ${
                  isActive
                    ? "bg-gradient-to-b from-[#27272A] to-[#18181B] text-text-inverse shadow-[var(--shadow-pop)]"
                    : "hover:bg-bg-tertiary text-text-primary"
                }`}
              >
                {isActive && <span aria-hidden className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-ink rounded-r" />}
                <span
                  aria-hidden
                  className={`w-9 h-9 rounded-lg flex items-center justify-center text-[20px] leading-none shrink-0 ${
                    isActive
                      ? "bg-white/10"
                      : "bg-bg-tertiary"
                  }`}
                >
                  {isoToFlag(item.isoCode)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-[13.5px] truncate ${isActive ? "font-semibold" : "font-medium"}`}>
                    {item.name}
                  </span>
                  <span
                    className={`block text-[10.5px] truncate ${
                      isActive ? "opacity-70" : "text-text-muted"
                    }`}
                  >
                    {item.isoCode ? (
                      <span className="font-mono">{item.isoCode}</span>
                    ) : (
                      <span>ISO à compléter</span>
                    )}
                    {enName && <span> · {enName}</span>}
                  </span>
                </span>
                {missingTr && !isActive && (
                  <span
                    aria-hidden
                    className="w-[7px] h-[7px] rounded-full bg-amber-300 shadow-[0_0_0_2.5px_rgba(255,251,235,1)]"
                    title="Sans traduction"
                  />
                )}
                <span
                  className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold tabular-nums ${
                    isActive ? "bg-white/15" : "bg-bg-tertiary text-text-secondary"
                  }`}
                  title={`${item.productCount} produit${item.productCount > 1 ? "s" : ""}`}
                >
                  {item.productCount}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Total */}
      <div className="px-3.5 py-3 bg-bg-primary border-t border-border text-[11px] text-text-muted text-center font-medium">
        {filtered.length} pays · {productSum.toLocaleString("fr-FR")} produit{productSum > 1 ? "s" : ""}
      </div>
    </div>
  );
}
