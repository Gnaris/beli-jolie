"use client";

import { useState, useMemo } from "react";
import {
  matchesSearch,
  matchesFilters,
  countMissing,
  type HsCodeForFilters,
  type HsCodeFilterKey,
} from "@/lib/hs-code-filters";
import { useDragReorder, DragHandle, dropIndicatorClass } from "@/components/admin/shared/useDragReorder";

type Item = HsCodeForFilters & {
  position: number;
};

type Props = {
  items: Item[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (newOrderedIds: string[]) => void;
};

function prefix(code: string): string {
  return code.slice(0, 4).padEnd(4, " ").trim();
}

function formatCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += 2) groups.push(code.slice(i, i + 2));
  return groups.join(" ");
}

export default function HsCodesList({ items, selectedId, onSelect, onReorder }: Props) {
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<HsCodeFilterKey>>(new Set());

  // Ordre fourni par le parent (position asc) — on s'y fie.
  const sorted = useMemo(() => items, [items]);

  const filtered = useMemo(
    () => sorted.filter((i) => matchesSearch(i, query) && matchesFilters(i, activeFilters)),
    [sorted, query, activeFilters],
  );

  const dragDisabled = query.trim().length > 0 || activeFilters.size > 0;
  const sortedIds = useMemo(() => sorted.map((i) => i.id), [sorted]);

  const { dragId, overId, overPos, bind } = useDragReorder({
    orderedIds: sortedIds,
    onReorder: (ids) => onReorder(ids),
  });

  const productSum = filtered.reduce((acc, i) => acc + i.productCount, 0);

  function toggleFilter(key: HsCodeFilterKey) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const FILTERS: { key: HsCodeFilterKey; label: string }[] = [
    { key: "unused", label: "Inutilisés" },
    { key: "lowUsage", label: "Peu utilisés" },
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
            placeholder="Rechercher un code…"
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

      {/* Hint drag & drop désactivé */}
      {dragDisabled && filtered.length > 1 && (
        <div className="px-3.5 py-2 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-800 flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Effacez la recherche et les filtres pour réorganiser à la souris.
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted font-body text-center py-8 px-4">
            Aucun code SH ne correspond.
          </p>
        ) : (
          filtered.map((item) => {
            const isActive = item.id === selectedId;
            const isUnused = item.productCount === 0;
            const drag = dragDisabled ? null : bind(item.id);
            const isDragging = dragId === item.id;
            const indicator = dropIndicatorClass(overId, overPos, item.id);
            return (
              <div
                key={item.id}
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
                  data-hscode-id={item.id}
                  data-active={isActive}
                  onClick={() => onSelect(item.id)}
                  className={`relative flex flex-1 items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all text-left ${
                    isActive
                      ? "bg-gradient-to-b from-[#27272A] to-[#18181B] text-text-inverse shadow-[var(--shadow-pop)]"
                      : "hover:bg-bg-tertiary text-text-primary"
                  }`}
                >
                  {isActive && <span aria-hidden className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-ink rounded-r" />}
                  <span
                    aria-hidden
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-mono font-bold text-[10.5px] tracking-tight ${
                      isActive
                        ? "bg-white/10 text-white"
                        : "bg-bg-tertiary text-text-secondary"
                    }`}
                  >
                    {prefix(item.code)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[13.5px] truncate ${isActive ? "font-semibold" : "font-medium"}`}>
                      {item.label}
                    </span>
                    <span
                      className={`block text-[10.5px] font-mono truncate ${
                        isActive ? "opacity-70" : "text-text-muted"
                      }`}
                    >
                      {formatCode(item.code)}
                    </span>
                  </span>
                  {isUnused && !isActive && (
                    <span
                      aria-hidden
                      className="w-[7px] h-[7px] rounded-full bg-rose-400 shadow-[0_0_0_2.5px_rgba(255,241,242,1)]"
                      title="Inutilisé"
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
              </div>
            );
          })
        )}
      </div>

      {/* Total */}
      <div className="px-3.5 py-3 bg-bg-primary border-t border-border text-[11px] text-text-muted text-center font-medium">
        {filtered.length} code{filtered.length > 1 ? "s" : ""} · {productSum.toLocaleString("fr-FR")} produit{productSum > 1 ? "s" : ""}
      </div>
    </div>
  );
}
