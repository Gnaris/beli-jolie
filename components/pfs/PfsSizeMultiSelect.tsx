"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface PfsSize {
  reference: string;
}

interface PfsSizeMultiSelectProps {
  pfsSizes: PfsSize[];
  selected: Set<string>;
  onToggle: (ref: string) => void;
  disabled?: boolean;
  className?: string;
}

// ─────────────────────────────────────────────
// Grouping logic (based on PFS size patterns)
// ─────────────────────────────────────────────

const PFS_SIZE_GROUPS: { label: string; test: (ref: string) => boolean }[] = [
  {
    label: "Taille unique",
    test: (r) => r === "TU",
  },
  {
    label: "Standard (XS → XXXL)",
    test: (r) => /^(XS|S|M|L|XL|XXL|XXXL)$/i.test(r),
  },
  {
    label: "T-sizes (T34 → T68)",
    test: (r) => /^T\d{2}$/.test(r),
  },
  {
    label: "Bonnets — Lingerie",
    test: (r) => /^\d{2,3}[A-E]$/.test(r),
  },
  {
    label: "Pointures — Chaussures (20–46)",
    test: (r) => /^\d+$/.test(r) && +r >= 20 && +r <= 46,
  },
  {
    label: "Petites tailles (47+)",
    test: (r) => /^\d+$/.test(r) && +r >= 47,
  },
];
const FALLBACK_GROUP = "Autres";

function getGroupLabel(ref: string): string {
  for (const g of PFS_SIZE_GROUPS) {
    if (g.test(ref)) return g.label;
  }
  return FALLBACK_GROUP;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function PfsSizeMultiSelect({
  pfsSizes,
  selected,
  onToggle,
  disabled = false,
  className = "",
}: PfsSizeMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
    direction: "down" | "up";
  }>({ top: 0, left: 0, width: 0, direction: "down" });

  useEffect(() => { setMounted(true); }, []);

  // Calculate dropdown position
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = 380;
    const spaceBelow = window.innerHeight - rect.bottom;
    const direction = spaceBelow < menuHeight && rect.top > menuHeight ? "up" : "down";
    setMenuPos({
      top: direction === "down" ? rect.bottom + 4 : rect.top - menuHeight - 4,
      left: rect.left,
      width: Math.max(rect.width, 300),
      direction,
    });
  }, [open]);

  // Auto-focus search on open, reset on close
  useEffect(() => {
    if (!open) { setSearch(""); return; }
    const timer = setTimeout(() => searchRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Filter + group sizes
  const filtered = search.trim()
    ? pfsSizes.filter((s) => s.reference.toLowerCase().includes(search.toLowerCase()))
    : pfsSizes;

  const grouped = new Map<string, string[]>();
  for (const s of filtered) {
    const label = getGroupLabel(s.reference);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)!.push(s.reference);
  }

  // Maintain deterministic group order
  const orderedGroups: { label: string; refs: string[] }[] = [];
  for (const g of PFS_SIZE_GROUPS) {
    const refs = grouped.get(g.label);
    if (refs && refs.length > 0) orderedGroups.push({ label: g.label, refs });
  }
  const othersRefs = grouped.get(FALLBACK_GROUP);
  if (othersRefs && othersRefs.length > 0) {
    orderedGroups.push({ label: FALLBACK_GROUP, refs: othersRefs });
  }

  // Trigger label
  const selectedArr = [...selected];
  let triggerLabel = "Choisir des tailles PFS…";
  if (selectedArr.length === 1) triggerLabel = selectedArr[0];
  else if (selectedArr.length === 2) triggerLabel = selectedArr.join(", ");
  else if (selectedArr.length > 2) triggerLabel = `${selectedArr.slice(0, 2).join(", ")} +${selectedArr.length - 2}`;

  const menu = open && mounted && (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[9990]" onClick={() => setOpen(false)} />
      {/* Menu */}
      <div
        className="fixed z-[9991]"
        style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
      >
        <div
          className="bg-bg-primary rounded-xl border border-border overflow-hidden"
          style={{
            boxShadow: "0 12px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)",
            animation:
              menuPos.direction === "down"
                ? "customSelectDown 0.15s ease-out"
                : "customSelectUp 0.15s ease-out",
          }}
        >
          {/* Search bar */}
          <div className="px-2 pt-2 pb-1.5 border-b border-border-light bg-bg-primary sticky top-0 z-10">
            <div className="relative">
              <svg
                className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z"
                />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une taille…"
                className="w-full pl-6 pr-2.5 py-1.5 text-[11px] border border-border rounded-lg focus:outline-none focus:border-[#1A1A1A] bg-bg-secondary font-body text-text-primary placeholder:text-text-muted"
              />
            </div>
          </div>

          {/* Options grouped by category */}
          <div className="py-1 max-h-[320px] overflow-y-auto">
            {orderedGroups.length === 0 ? (
              <p className="px-3.5 py-3 text-[11px] text-text-muted text-center">
                Aucun résultat
              </p>
            ) : (
              orderedGroups.map(({ label, refs }) => (
                <div key={label}>
                  {/* Group subtitle */}
                  <p className="px-3 pt-3 pb-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider font-heading">
                    {label}
                  </p>
                  {/* Size chips with checkboxes */}
                  <div className="px-2 pb-2 flex flex-wrap gap-1.5">
                    {refs.map((ref) => {
                      const isChecked = selected.has(ref);
                      return (
                        <label
                          key={ref}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium cursor-pointer transition-all duration-150 select-none font-body ${
                            isChecked
                              ? "bg-[#22C55E]/10 border-[#22C55E]/40 text-[#15803D]"
                              : "bg-bg-secondary border-border text-text-secondary hover:border-bg-dark hover:text-text-primary"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => onToggle(ref)}
                            className="checkbox-custom"
                          />
                          {ref}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer: count + clear */}
          {selected.size > 0 && (
            <div className="px-3 py-2 border-t border-border-light bg-bg-secondary flex items-center justify-between">
              <span className="text-[10px] text-text-secondary font-body">
                {selected.size} taille{selected.size > 1 ? "s" : ""} liée{selected.size > 1 ? "s" : ""}
              </span>
              <button
                type="button"
                onClick={() => {
                  // Deselect all currently selected
                  for (const ref of [...selected]) {
                    onToggle(ref);
                  }
                }}
                className="text-[10px] text-[#EF4444] hover:text-[#DC2626] font-medium font-body transition-colors"
              >
                Tout désélectionner
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Sélectionner des tailles PFS"
        className={`flex items-center gap-2 w-full text-left font-body transition-all duration-150 cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11px] font-medium text-text-primary bg-bg-primary border-border hover:border-bg-dark disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
      >
        <span className={`flex-1 truncate ${selected.size === 0 ? "opacity-50" : ""}`}>
          {triggerLabel}
        </span>
        {selected.size > 0 && (
          <span className="shrink-0 bg-[#22C55E]/15 text-[#15803D] text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none">
            {selected.size}
          </span>
        )}
        <svg
          className={`shrink-0 opacity-40 transition-transform duration-200 w-3 h-3 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {mounted && createPortal(menu, document.body)}
    </>
  );
}
