"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
  icon?: string;        // SVG path for optional icon
  disabled?: boolean;
  className?: string;   // Extra class on label (e.g. line-through)
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Small variant for inline/table use */
  size?: "sm" | "md";
  /** Dark variant (white text on dark bg) */
  variant?: "default" | "dark";
  id?: string;
  "aria-label"?: string;
  /** Show a search input inside the dropdown */
  searchable?: boolean;
  /** Show a loading spinner inside the dropdown when opened */
  loading?: boolean;
  /** Message shown when there are no options (excluding placeholder) */
  emptyMessage?: string;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Sélectionner…",
  disabled = false,
  className = "",
  size = "md",
  variant = "default",
  id,
  "aria-label": ariaLabel,
  searchable = false,
  loading = false,
  emptyMessage,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; direction: "down" | "up" }>({ top: 0, left: 0, width: 0, direction: "down" });

  useEffect(() => { setMounted(true); }, []);

  const selected = options.find((o) => o.value === value);

  // Filter options by search query
  const displayedOptions = searchable && searchQuery.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : options;

  // Calculate position when opening
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const menuHeight = Math.min(options.length * 40 + 12, 280);
    const direction = spaceBelow < menuHeight && rect.top > menuHeight ? "up" : "down";

    setMenuPos({
      top: direction === "down" ? rect.bottom + 4 : rect.top - menuHeight - 4,
      left: rect.left,
      width: Math.max(rect.width, 180),
      direction,
    });
  }, [open, options.length]);

  // Auto-focus search input + reset query on open/close, set initial highlighted index
  useEffect(() => {
    if (!open) { setSearchQuery(""); setHighlightedIndex(-1); return; }
    // Set highlighted to current selected item's index
    const selectedIdx = displayedOptions.findIndex((o) => o.value === value);
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : -1);
    if (searchable) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchable]);

  // Reset highlighted index when search query changes
  useEffect(() => {
    if (!open) return;
    const selectedIdx = displayedOptions.findIndex((o) => o.value === value);
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : (displayedOptions.length > 0 ? 0 : -1));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightedIndex >= 0) {
      const el = optionRefs.current.get(highlightedIndex);
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  // Find next non-disabled index in a given direction
  const findNextEnabledIndex = useCallback((startIndex: number, direction: 1 | -1): number => {
    const len = displayedOptions.length;
    if (len === 0) return -1;
    let idx = startIndex;
    for (let i = 0; i < len; i++) {
      idx = ((idx + direction) % len + len) % len;
      if (!displayedOptions[idx].disabled) return idx;
    }
    return -1; // all disabled
  }, [displayedOptions]);

  // Close on page scroll (not inside the dropdown menu itself)
  useEffect(() => {
    if (!open) return;
    function onScroll(e: Event) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          setOpen(false);
          triggerRef.current?.focus();
          break;
        case "ArrowDown": {
          e.preventDefault();
          setHighlightedIndex((prev) => findNextEnabledIndex(prev, 1));
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setHighlightedIndex((prev) => findNextEnabledIndex(prev, -1));
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < displayedOptions.length) {
            const opt = displayedOptions[highlightedIndex];
            if (!opt.disabled) {
              handleSelect(opt.value);
            }
          }
          break;
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, highlightedIndex, displayedOptions, findNextEnabledIndex]);

  // Size classes
  const isSm = size === "sm";
  const isDark = variant === "dark";

  const triggerClasses = isDark
    ? `flex items-center gap-2 w-full text-left font-body transition-all duration-150 cursor-pointer rounded-lg border ${
        isSm ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-xs"
      } font-medium text-white bg-white/[0.12] border-white/20 hover:bg-white/[0.18] hover:border-white/30 disabled:opacity-40 disabled:cursor-not-allowed`
    : `flex items-center gap-2 w-full text-left font-body transition-all duration-150 cursor-pointer rounded-lg border ${
        isSm ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-[9px] text-xs"
      } font-medium text-text-primary bg-bg-primary border-border hover:border-bg-dark disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_1px_2px_rgba(0,0,0,0.04)]`;

  function handleSelect(val: string) {
    onChange(val);
    setOpen(false);
    setSearchQuery("");
    triggerRef.current?.focus();
  }

  const menu = open && mounted && (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[10000]" onClick={() => setOpen(false)} />
      {/* Menu */}
      <div
        ref={menuRef}
        className="fixed z-[10001]"
        style={{
          top: menuPos.top,
          left: menuPos.left,
          width: menuPos.width,
        }}
      >
        <div
          className="bg-bg-primary rounded-xl border border-border overflow-hidden"
          style={{
            boxShadow: "0 12px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)",
            animation: menuPos.direction === "down"
              ? "customSelectDown 0.15s ease-out"
              : "customSelectUp 0.15s ease-out",
          }}
        >
          {searchable && (
            <div className="px-2 pt-2 pb-1.5 border-b border-border-light bg-bg-primary sticky top-0 z-10">
              <div className="relative">
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher…"
                  className="w-full pl-6 pr-2.5 py-1.5 text-[11px] border border-border rounded-lg focus:outline-none focus:border-bg-dark bg-bg-secondary font-body text-text-primary placeholder:text-text-muted"
                />
              </div>
            </div>
          )}
          <div className="py-1 max-h-[268px] overflow-auto" role="listbox">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-3.5 py-4">
                <svg className="w-4 h-4 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-[11px] text-text-muted font-body">Chargement…</span>
              </div>
            ) : !loading && emptyMessage && displayedOptions.filter(o => o.value !== "").length === 0 ? (
              <p className="px-3.5 py-3 text-[11px] text-text-muted text-center">{emptyMessage}</p>
            ) : displayedOptions.length === 0 ? (
              <p className="px-3.5 py-3 text-[11px] text-text-muted text-center">Aucun résultat</p>
            ) : (
              displayedOptions.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isHighlighted = idx === highlightedIndex;
                return (
                  <button
                    key={opt.value}
                    ref={(el) => {
                      if (el) optionRefs.current.set(idx, el);
                      else optionRefs.current.delete(idx);
                    }}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={opt.disabled}
                    onClick={() => handleSelect(opt.value)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`w-full flex items-center gap-2.5 text-left font-body transition-colors duration-100 disabled:opacity-30 disabled:cursor-not-allowed ${
                      isSm ? "px-3 py-2 text-[11px]" : "px-3.5 py-2.5 text-xs"
                    } ${
                      isSelected
                        ? "bg-bg-secondary text-text-primary font-semibold"
                        : isHighlighted
                          ? "bg-bg-secondary text-text-primary"
                          : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
                    }`}
                  >
                    {opt.icon && (
                      <svg
                        className={`shrink-0 ${isSm ? "w-3.5 h-3.5" : "w-4 h-4"}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        style={{ color: isSelected ? "var(--color-text-primary)" : "var(--color-text-muted)" }}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d={opt.icon} />
                      </svg>
                    )}
                    <span className={`flex-1 truncate ${opt.className ?? ""}`}>{opt.label}</span>
                    {isSelected && (
                      <svg className="w-3.5 h-3.5 text-[#22C55E] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={`${triggerClasses} ${className}`}
      >
        {selected?.icon && (
          <svg
            className={`shrink-0 ${isSm ? "w-3 h-3" : "w-3.5 h-3.5"} opacity-60`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d={selected.icon} />
          </svg>
        )}
        <span className={`flex-1 truncate ${!selected ? "opacity-50" : ""}`}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          className={`shrink-0 opacity-40 transition-transform duration-200 ${open ? "rotate-180" : ""} ${isSm ? "w-3 h-3" : "w-3.5 h-3.5"}`}
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
