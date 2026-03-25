"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
  icon?: string;        // SVG path for optional icon
  disabled?: boolean;
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
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; direction: "down" | "up" }>({ top: 0, left: 0, width: 0, direction: "down" });

  useEffect(() => { setMounted(true); }, []);

  const selected = options.find((o) => o.value === value);

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

  // Auto-focus search input + reset query on open/close
  useEffect(() => {
    if (!open) { setSearchQuery(""); return; }
    if (searchable) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    }
  }, [open, searchable]);

  // Close on escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Filter options by search query
  const displayedOptions = searchable && searchQuery.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : options;

  // Size classes
  const isSm = size === "sm";
  const isDark = variant === "dark";

  const triggerClasses = isDark
    ? `flex items-center gap-2 w-full text-left font-[family-name:var(--font-roboto)] transition-all duration-150 cursor-pointer rounded-lg border ${
        isSm ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-xs"
      } font-medium text-white bg-white/[0.12] border-white/20 hover:bg-white/[0.18] hover:border-white/30 disabled:opacity-40 disabled:cursor-not-allowed`
    : `flex items-center gap-2 w-full text-left font-[family-name:var(--font-roboto)] transition-all duration-150 cursor-pointer rounded-lg border ${
        isSm ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-[9px] text-xs"
      } font-medium text-[#1A1A1A] bg-white border-[#E5E5E5] hover:border-[#1A1A1A] disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_1px_2px_rgba(0,0,0,0.04)]`;

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
          className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden"
          style={{
            boxShadow: "0 12px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)",
            animation: menuPos.direction === "down"
              ? "customSelectDown 0.15s ease-out"
              : "customSelectUp 0.15s ease-out",
          }}
        >
          {searchable && (
            <div className="px-2 pt-2 pb-1.5 border-b border-[#F0F0F0] bg-white sticky top-0 z-10">
              <div className="relative">
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#9CA3AF] pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher…"
                  className="w-full pl-6 pr-2.5 py-1.5 text-[11px] border border-[#E5E5E5] rounded-lg focus:outline-none focus:border-[#1A1A1A] bg-[#F7F7F8] font-[family-name:var(--font-roboto)] text-[#1A1A1A] placeholder:text-[#9CA3AF]"
                />
              </div>
            </div>
          )}
          <div className="py-1 max-h-[268px] overflow-auto">
            {displayedOptions.length === 0 ? (
              <p className="px-3.5 py-3 text-[11px] text-[#9CA3AF] text-center">Aucun résultat</p>
            ) : (
              displayedOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full flex items-center gap-2.5 text-left font-[family-name:var(--font-roboto)] transition-colors duration-100 disabled:opacity-30 disabled:cursor-not-allowed ${
                      isSm ? "px-3 py-2 text-[11px]" : "px-3.5 py-2.5 text-xs"
                    } ${
                      isSelected
                        ? "bg-[#F7F7F8] text-[#1A1A1A] font-semibold"
                        : "text-[#6B6B6B] hover:bg-[#F7F7F8] hover:text-[#1A1A1A]"
                    }`}
                  >
                    {opt.icon && (
                      <svg
                        className={`shrink-0 ${isSm ? "w-3.5 h-3.5" : "w-4 h-4"}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        style={{ color: isSelected ? "#1A1A1A" : "#9CA3AF" }}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d={opt.icon} />
                      </svg>
                    )}
                    <span className="flex-1 truncate">{opt.label}</span>
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
