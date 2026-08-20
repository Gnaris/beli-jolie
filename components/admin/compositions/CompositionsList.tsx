"use client";

import { useState, useMemo } from "react";
import {
  matchesSearch,
  matchesFilters,
  countMissing,
  compositionInitials,
  type CompositionForFilters,
  type CompositionFilterKey,
} from "@/lib/composition-filters";
import { useDragReorder, DragHandle, dropIndicatorClass } from "@/components/admin/shared/useDragReorder";

type Comp = CompositionForFilters & {
  productCount: number;
  position: number;
};

type Props = {
  compositions: Comp[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  hasPfsConfig: boolean;
  hasEfashionConfig: boolean;
  onReorder: (newOrderedIds: string[]) => void;
};

export default function CompositionsList({
  compositions,
  selectedId,
  onSelect,
  hasPfsConfig,
  hasEfashionConfig,
  onReorder,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<CompositionFilterKey>>(new Set());

  // Ordre fourni par le parent (position asc) — on s'y fie.
  const sorted = useMemo(() => compositions, [compositions]);

  const filtered = useMemo(
    () => sorted.filter((c) => matchesSearch(c, query) && matchesFilters(c, activeFilters)),
    [sorted, query, activeFilters],
  );

  const dragDisabled = query.trim().length > 0 || activeFilters.size > 0;
  const sortedIds = useMemo(() => sorted.map((c) => c.id), [sorted]);

  const { dragId, overId, overPos, bind } = useDragReorder({
    orderedIds: sortedIds,
    onReorder: (ids) => onReorder(ids),
  });

  const productSum = filtered.reduce((acc, c) => acc + c.productCount, 0);

  function toggleFilter(key: CompositionFilterKey) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const FILTERS: { key: CompositionFilterKey; label: string; show: boolean }[] = (
    [
      { key: "missingTranslation", label: "Sans traduction", show: true },
      { key: "missingPfs", label: "Sans PFS", show: hasPfsConfig },
      { key: "missingEfashion", label: "Sans eFashion", show: hasEfashionConfig },
    ] satisfies { key: CompositionFilterKey; label: string; show: boolean }[]
  ).filter((f) => f.show);

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
            placeholder="Rechercher une composition…"
            className="w-full bg-bg-secondary border border-transparent rounded-xl pl-9 pr-3 py-2.5 text-[13px] text-text-primary focus:bg-bg-primary focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink/8 transition-all shadow-[var(--shadow-inset)]"
          />
        </div>
      </div>

      {/* Quick filters */}
      <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5 bg-bg-primary border-b border-border">
        {FILTERS.map((f) => {
          const active = activeFilters.has(f.key);
          const count = countMissing(compositions, f.key);
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

      {/* Hint drag & drop désactivé */}
      {dragDisabled && filtered.length > 1 && (
        <div className="px-3.5 py-2 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-800 flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Effacez la recherche et les filtres pour réorganiser à la souris.
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {filtered.map((c) => {
          const isActive = c.id === selectedId;
          const missingTr = !(c.translations.fr && c.translations.fr.trim() && c.translations.en && c.translations.en.trim());
          const drag = dragDisabled ? null : bind(c.id);
          const isDragging = dragId === c.id;
          const indicator = dropIndicatorClass(overId, overPos, c.id);
          return (
            <div
              key={c.id}
              draggable={drag?.draggable ?? false}
              onDragStart={drag?.onDragStart}
              onDragEnd={drag?.onDragEnd}
              onDragOver={drag?.onDragOver}
              onDragLeave={drag?.onDragLeave}
              onDrop={drag?.onDrop}
              className={`relative flex w-full items-center gap-1 px-1 mb-0.5 ${isDragging ? "opacity-40" : ""} ${indicator}`}
            >
              {!dragDisabled && <DragHandle />}
              <button
                type="button"
                data-composition-id={c.id}
                data-active={isActive}
                onClick={() => onSelect(c.id)}
                className={`relative flex flex-1 items-center gap-3 px-3.5 py-2.5 rounded-xl cursor-pointer transition-all text-left ${
                  isActive
                    ? "bg-gradient-to-b from-[#27272A] to-[#18181B] text-text-inverse shadow-[var(--shadow-pop)]"
                    : "hover:bg-bg-tertiary text-text-primary"
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r"
                    style={{ background: "#FBBF24" }}
                  />
                )}
                <span
                  aria-hidden
                  className={`w-8 h-8 rounded-[10px] shrink-0 inline-flex items-center justify-center text-[12px] font-bold ${
                    isActive ? "ring-1 ring-white/25" : ""
                  }`}
                  style={{
                    background: "linear-gradient(135deg, #FDE68A 0%, #F59E0B 100%)",
                    color: "#78350F",
                    boxShadow: "0 1px 3px rgba(180, 83, 9, 0.28), inset 0 1px 0 rgba(255,255,255,0.4)",
                  }}
                >
                  {compositionInitials(c.name)}
                </span>
                <span className={`flex-1 text-[13.5px] truncate ${isActive ? "font-semibold" : "font-medium"}`}>{c.name}</span>
                {missingTr && (
                  <span
                    aria-hidden
                    className="w-[7px] h-[7px] rounded-full bg-amber-300 shadow-[0_0_0_2.5px_rgba(255,251,235,1)]"
                    title="Sans traduction"
                  />
                )}
                <span className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold ${isActive ? "bg-white/15" : "bg-bg-tertiary"}`}>
                  {c.productCount}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Total */}
      <div className="px-3.5 py-3 bg-bg-primary border-t border-border text-[11px] text-text-muted text-center font-medium">
        {filtered.length} composition{filtered.length > 1 ? "s" : ""} · {productSum.toLocaleString("fr-FR")} produit{productSum > 1 ? "s" : ""}
      </div>
    </div>
  );
}
