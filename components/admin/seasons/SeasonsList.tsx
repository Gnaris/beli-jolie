"use client";

import { useState, useMemo } from "react";
import {
  matchesSearch,
  matchesFilters,
  countMissing,
  extractYear,
  seasonEmoji,
  seasonGradient,
  type SeasonForFilters,
  type SeasonFilterKey,
} from "@/lib/season-filters";

type Season = SeasonForFilters & {
  productCount: number;
};

type Props = {
  seasons: Season[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  hasPfsConfig: boolean;
  hasEfashionConfig: boolean;
};

type SeasonGroup = {
  key: string;
  label: string;
  accent: string;
  seasons: Season[];
};

function groupSeasons(list: Season[]): SeasonGroup[] {
  const buckets = new Map<string, Season[]>();
  for (const s of list) {
    const y = extractYear(s.name);
    const key = y == null ? "intemporel" : String(y);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(s);
  }
  const years = [...buckets.keys()]
    .filter((k) => k !== "intemporel")
    .sort((a, b) => Number(b) - Number(a));
  const groups: SeasonGroup[] = years.map((k) => ({
    key: k,
    label: k,
    accent: "bg-sky-500",
    seasons: buckets.get(k)!,
  }));
  if (buckets.has("intemporel")) {
    groups.push({
      key: "intemporel",
      label: "Intemporel",
      accent: "bg-emerald-400",
      seasons: buckets.get("intemporel")!,
    });
  }
  return groups;
}

export default function SeasonsList({
  seasons,
  selectedId,
  onSelect,
  hasPfsConfig,
  hasEfashionConfig,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<SeasonFilterKey>>(new Set());

  const filtered = useMemo(
    () => seasons.filter((s) => matchesSearch(s, query) && matchesFilters(s, activeFilters)),
    [seasons, query, activeFilters],
  );

  const groups = useMemo(() => groupSeasons(filtered), [filtered]);

  const productSum = filtered.reduce((acc, s) => acc + s.productCount, 0);

  function toggleFilter(key: SeasonFilterKey) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const FILTERS: { key: SeasonFilterKey; label: string; show: boolean }[] = (
    [
      { key: "missingTranslation", label: "Sans traduction", show: true },
      { key: "missingPfs", label: "Sans PFS", show: hasPfsConfig },
      { key: "missingEfashion", label: "Sans eFashion", show: hasEfashionConfig },
    ] satisfies { key: SeasonFilterKey; label: string; show: boolean }[]
  ).filter((f) => f.show);

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
            placeholder="Rechercher une saison…"
            className="w-full bg-bg-secondary border border-transparent rounded-xl pl-9 pr-3 py-2.5 text-[13px] text-text-primary focus:bg-bg-primary focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink/8 transition-all shadow-[var(--shadow-inset)]"
          />
        </div>
      </div>

      {/* Quick filters */}
      <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5 bg-bg-primary border-b border-border">
        {FILTERS.map((f) => {
          const active = activeFilters.has(f.key);
          const count = countMissing(seasons, f.key);
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

      {/* Groupes par année */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="flex items-center gap-2 px-3 pt-1 pb-1.5">
              <span aria-hidden className={`w-[3px] h-[12px] rounded-full ${group.accent}`} />
              <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-text-secondary">
                {group.label}
              </span>
              <span className="ml-auto text-[10.5px] font-medium text-text-muted">
                {group.seasons.length} saison{group.seasons.length > 1 ? "s" : ""}
              </span>
            </div>

            {group.seasons.map((s) => {
              const isActive = s.id === selectedId;
              const missingTr = !(s.translations.fr && s.translations.fr.trim() && s.translations.en && s.translations.en.trim());
              return (
                <button
                  key={s.id}
                  type="button"
                  data-season-id={s.id}
                  data-active={isActive}
                  onClick={() => onSelect(s.id)}
                  className={`relative flex w-full items-center gap-3 px-3.5 py-2.5 rounded-xl cursor-pointer mb-0.5 transition-all text-left ${
                    isActive
                      ? "bg-gradient-to-b from-[#27272A] to-[#18181B] text-text-inverse shadow-[var(--shadow-pop)]"
                      : "hover:bg-bg-tertiary text-text-primary"
                  }`}
                >
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r"
                      style={{ background: "#38BDF8" }}
                    />
                  )}
                  <span
                    aria-hidden
                    className={`w-8 h-8 rounded-[10px] shrink-0 inline-flex items-center justify-center text-[14px] ${
                      isActive ? "ring-1 ring-white/25" : ""
                    }`}
                    style={{
                      background: seasonGradient(s.name),
                      boxShadow: "0 1px 3px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.4)",
                    }}
                  >
                    {seasonEmoji(s.name)}
                  </span>
                  <span className={`flex-1 text-[13.5px] truncate ${isActive ? "font-semibold" : "font-medium"}`}>
                    {s.name}
                  </span>
                  {missingTr && (
                    <span
                      aria-hidden
                      className="w-[7px] h-[7px] rounded-full bg-amber-300 shadow-[0_0_0_2.5px_rgba(255,251,235,1)]"
                      title="Sans traduction"
                    />
                  )}
                  <span className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold ${isActive ? "bg-white/15" : "bg-bg-tertiary"}`}>
                    {s.productCount}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="px-3.5 py-3 bg-bg-primary border-t border-border text-[11px] text-text-muted text-center font-medium">
        {filtered.length} saison{filtered.length > 1 ? "s" : ""} · {productSum.toLocaleString("fr-FR")} produit{productSum > 1 ? "s" : ""}
      </div>
    </div>
  );
}
