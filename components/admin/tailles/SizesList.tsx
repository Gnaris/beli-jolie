"use client";

import { useState, useMemo } from "react";
import { matchesSearch, matchesFilters, countMissing, type SizeForFilters, type SizeFilterKey } from "@/lib/size-filters";
import { isProtectedSizeName, PROTECTED_SIZE_VIRTUAL_ID } from "@/lib/protected-sizes";
import { useDragReorder, DragHandle, dropIndicatorClass } from "@/components/admin/shared/useDragReorder";

type Size = SizeForFilters & { position: number };

type Props = {
  sizes: Size[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  pfsEnabled: boolean;
  onReorder: (newSortedIds: string[]) => void;
};

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (trimmed.length <= 2) return trimmed.toUpperCase();
  const parts = trimmed.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

export default function SizesList({ sizes, selectedId, onSelect, pfsEnabled, onReorder }: Props) {
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<SizeFilterKey>>(new Set());

  const sorted = useMemo(() => {
    const out = [...sizes];
    if (pfsEnabled) {
      // Orphelins PFS remontés en tête, puis ordre position.
      out.sort((a, b) => {
        const ao = a.pfsSizeRef == null ? 0 : 1;
        const bo = b.pfsSizeRef == null ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return a.position - b.position;
      });
    } else {
      out.sort((a, b) => a.position - b.position);
    }
    return out;
  }, [sizes, pfsEnabled]);

  const filtered = useMemo(
    () => sorted.filter((s) => matchesSearch(s, query) && matchesFilters(s, activeFilters)),
    [sorted, query, activeFilters],
  );

  const dragDisabled = query.trim().length > 0 || activeFilters.size > 0;
  const sortedIds = useMemo(() => sorted.map((s) => s.id), [sorted]);
  const orphanById = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const s of sorted) map.set(s.id, s.pfsSizeRef == null);
    return map;
  }, [sorted]);

  const { dragId, overId, overPos, bind } = useDragReorder({
    orderedIds: sortedIds,
    isLocked: (id) => id === PROTECTED_SIZE_VIRTUAL_ID,
    // Cross-groupe (orphelin ↔ mappé) bloqué pour préserver la lisibilité :
    // les orphelins restent en tête, sinon leur position se noierait.
    canDropOn: pfsEnabled ? (a, b) => orphanById.get(a) === orphanById.get(b) : undefined,
    onReorder: (newIds) => onReorder(newIds.filter((id) => id !== PROTECTED_SIZE_VIRTUAL_ID)),
  });

  const variantSum = filtered.reduce((acc, s) => acc + s.variantCount, 0);

  function toggleFilter(key: SizeFilterKey) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const FILTERS: { key: SizeFilterKey; label: string; show: boolean }[] = (
    [
      { key: "missingPfs", label: "Sans PFS", show: pfsEnabled },
      { key: "unused", label: "Inutilisées", show: true },
    ] satisfies { key: SizeFilterKey; label: string; show: boolean }[]
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
            placeholder="Rechercher une taille…"
            className="w-full bg-bg-secondary border border-transparent rounded-xl pl-9 pr-3 py-2.5 text-[13px] text-text-primary focus:bg-bg-primary focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink/8 transition-all shadow-[var(--shadow-inset)]"
          />
        </div>
      </div>

      {/* Quick filters */}
      {FILTERS.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5 bg-bg-primary border-b border-border">
          {FILTERS.map((f) => {
            const active = activeFilters.has(f.key);
            const count = countMissing(sizes, f.key);
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
      )}

      {/* Hint drag & drop désactivé quand un filtre ou une recherche est actif */}
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
            Aucune taille ne correspond.
          </p>
        ) : (
          filtered.map((s) => {
            const isActive = s.id === selectedId;
            const isOrphan = pfsEnabled && s.pfsSizeRef == null;
            const isProtected = isProtectedSizeName(s.name);
            const drag = dragDisabled ? null : bind(s.id);
            const isDragging = dragId === s.id;
            const indicator = dropIndicatorClass(overId, overPos, s.id);
            return (
              <div
                key={s.id}
                draggable={drag?.draggable ?? false}
                onDragStart={drag?.onDragStart}
                onDragEnd={drag?.onDragEnd}
                onDragOver={drag?.onDragOver}
                onDragLeave={drag?.onDragLeave}
                onDrop={drag?.onDrop}
                className={`relative flex w-full items-center gap-1 px-1 mb-0.5 ${isDragging ? "opacity-40" : ""} ${indicator}`}
              >
                {!dragDisabled && (
                  <DragHandle disabled={isProtected} />
                )}
                <button
                  type="button"
                  data-size-id={s.id}
                  data-active={isActive}
                  onClick={() => onSelect(s.id)}
                  className={`relative flex flex-1 items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all text-left ${
                    isActive
                      ? "bg-gradient-to-b from-[#27272A] to-[#18181B] text-text-inverse shadow-[var(--shadow-pop)]"
                      : "hover:bg-bg-tertiary text-text-primary"
                  }`}
                >
                  {isActive && <span aria-hidden className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-ink rounded-r" />}
                  <span
                    aria-hidden
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold font-heading shrink-0 ${
                      isActive
                        ? "bg-white/10 text-white"
                        : "bg-bg-tertiary text-text-secondary"
                    }`}
                  >
                    {initials(s.name)}
                  </span>
                  <span className={`flex-1 text-[13.5px] truncate ${isActive ? "font-semibold" : "font-medium"}`}>
                    {s.name}
                  </span>
                  {isOrphan && (
                    <span
                      aria-hidden
                      className="w-[7px] h-[7px] rounded-full bg-rose-400 shadow-[0_0_0_2.5px_rgba(255,241,242,1)]"
                      title="Sans référence PFS"
                    />
                  )}
                  {isProtected && !isActive && (
                    <span className="px-1.5 py-px rounded text-[9px] font-bold bg-bg-tertiary text-text-muted uppercase tracking-wider">
                      Verr.
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold ${
                      isActive ? "bg-white/15" : "bg-bg-tertiary text-text-secondary"
                    }`}
                    title={`${s.variantCount} variante${s.variantCount > 1 ? "s" : ""}`}
                  >
                    {s.variantCount}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Total */}
      <div className="px-3.5 py-3 bg-bg-primary border-t border-border text-[11px] text-text-muted text-center font-medium">
        {filtered.length} taille{filtered.length > 1 ? "s" : ""} · {variantSum.toLocaleString("fr-FR")} variante{variantSum > 1 ? "s" : ""}
      </div>
    </div>
  );
}
