"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

// Variante multi-sélection du CustomSelect : reste ouvert après clic, coche/
// décoche à chaque option, expose un compteur et un « Tout effacer » interne.
// Style aligné (dropdown desktop ancré / modal plein écran mobile) pour ne pas
// dépayser côté UX. Utilisé par les filtres Catalogue de /admin/produits
// (Catégorie, Sous-catégorie, Composition, Mot-clé, Code SH).

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface MultiSelectProps {
  values: string[];
  onChange: (next: string[]) => void;
  options: MultiSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
  id?: string;
  "aria-label"?: string;
  searchable?: boolean;
  emptyMessage?: string;
  title?: string;
  /** Suffixe pour le compteur trigger : « 3 sélectionnées » vs « 3 sélectionnés ». */
  pluralLabel?: string;
}

export default function MultiSelect({
  values,
  onChange,
  options,
  placeholder = "Sélectionner…",
  disabled = false,
  className = "",
  size = "md",
  id,
  "aria-label": ariaLabel,
  searchable = false,
  emptyMessage,
  title,
  pluralLabel = "sélectionnés",
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const highlightSourceRef = useRef<"keyboard" | "mouse">("keyboard");

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!open || !isDesktop) return;
    const measure = () => {
      if (triggerRef.current) setTriggerRect(triggerRef.current.getBoundingClientRect());
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, isDesktop]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open || isDesktop) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open, isDesktop]);

  useEffect(() => {
    if (!open || !isDesktop) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open, isDesktop]);

  const selectedSet = new Set(values);
  const displayedOptions = searchable && searchQuery.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) { setSearchQuery(""); setHighlightedIndex(-1); return; }
    setHighlightedIndex(displayedOptions.length > 0 ? 0 : -1);
    if (searchable) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    setHighlightedIndex(displayedOptions.length > 0 ? 0 : -1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  useEffect(() => {
    if (highlightedIndex < 0) return;
    if (highlightSourceRef.current !== "keyboard") return;
    const el = optionRefs.current.get(highlightedIndex);
    if (!el) return;
    const listbox = el.parentElement;
    if (!listbox) return;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const viewTop = listbox.scrollTop;
    const viewBottom = viewTop + listbox.clientHeight;
    if (elTop < viewTop) {
      listbox.scrollTop = elTop;
    } else if (elBottom > viewBottom) {
      listbox.scrollTop = elBottom - listbox.clientHeight;
    }
  }, [highlightedIndex]);

  const findNextEnabledIndex = useCallback((startIndex: number, direction: 1 | -1): number => {
    const len = displayedOptions.length;
    if (len === 0) return -1;
    let idx = startIndex;
    for (let i = 0; i < len; i++) {
      idx = ((idx + direction) % len + len) % len;
      if (!displayedOptions[idx].disabled) return idx;
    }
    return -1;
  }, [displayedOptions]);

  function toggle(val: string) {
    if (selectedSet.has(val)) {
      onChange(values.filter((v) => v !== val));
    } else {
      onChange([...values, val]);
    }
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          setOpen(false);
          triggerRef.current?.focus({ preventScroll: true });
          break;
        case "ArrowDown": {
          e.preventDefault();
          highlightSourceRef.current = "keyboard";
          setHighlightedIndex((prev) => findNextEnabledIndex(prev, 1));
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          highlightSourceRef.current = "keyboard";
          setHighlightedIndex((prev) => findNextEnabledIndex(prev, -1));
          break;
        }
        case " ":
        case "Enter": {
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < displayedOptions.length) {
            const opt = displayedOptions[highlightedIndex];
            if (!opt.disabled) toggle(opt.value);
          }
          break;
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, highlightedIndex, displayedOptions, findNextEnabledIndex, values]);

  const isSm = size === "sm";

  const triggerClasses = `flex items-center gap-2 w-full text-left font-body transition-all duration-150 cursor-pointer rounded-lg border ${
    isSm
      ? "px-4 py-3 text-[14px] md:px-2.5 md:py-1.5 md:text-[11px]"
      : "px-4 py-3 text-[14px] md:px-3 md:py-[9px] md:text-xs"
  } font-medium text-text-primary bg-bg-primary border-border hover:border-bg-dark disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_1px_2px_rgba(0,0,0,0.04)]`;

  const pickerTitle = title ?? ariaLabel ?? placeholder ?? "Sélectionner";

  const triggerLabel = (() => {
    if (values.length === 0) return placeholder;
    if (values.length === 1) {
      const opt = options.find((o) => o.value === values[0]);
      return opt?.label ?? placeholder;
    }
    return `${values.length} ${pluralLabel}`;
  })();

  const clearAll = () => onChange([]);

  const listContent = (
    <div className="flex-1 overflow-y-auto" role="listbox" aria-multiselectable="true">
      {emptyMessage && displayedOptions.length === 0 ? (
        <p className="px-4 py-6 text-[14px] text-text-muted text-center">{emptyMessage}</p>
      ) : displayedOptions.length === 0 ? (
        <p className="px-4 py-6 text-[14px] text-text-muted text-center">Aucun résultat</p>
      ) : (
        displayedOptions.map((opt, idx) => {
          const isSelected = selectedSet.has(opt.value);
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
              onClick={() => toggle(opt.value)}
              onMouseEnter={() => { highlightSourceRef.current = "mouse"; setHighlightedIndex(idx); }}
              className={`w-full ${isDesktop ? "min-h-9 px-3 py-2" : "min-h-[56px] px-4"} flex items-center gap-3 border-b border-border-light text-left transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                isHighlighted
                  ? "bg-bg-secondary"
                  : "hover:bg-bg-secondary active:bg-bg-secondary"
              }`}
            >
              <span
                aria-hidden="true"
                className={`shrink-0 flex items-center justify-center rounded border transition-colors ${
                  isDesktop ? "w-4 h-4" : "w-5 h-5"
                } ${
                  isSelected
                    ? "bg-emerald-600 border-emerald-600 text-white"
                    : "bg-bg-primary border-border-dark"
                }`}
              >
                {isSelected && (
                  <svg className={isDesktop ? "w-3 h-3" : "w-3.5 h-3.5"} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              <span
                className={`${isDesktop ? "text-[13px]" : "text-[15px]"} truncate flex-1 ${
                  isSelected ? "font-semibold text-text-primary" : "text-text-secondary"
                }`}
              >
                {opt.label}
              </span>
            </button>
          );
        })
      )}
    </div>
  );

  const headerBar = values.length > 0 && (
    <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-bg-secondary border-b border-border-light text-[11.5px]">
      <span className="text-text-secondary font-medium">
        <span className="text-text-primary font-semibold tabular-nums">{values.length}</span> {pluralLabel}
      </span>
      <button
        type="button"
        onClick={clearAll}
        className="text-text-muted hover:text-error transition-colors font-medium"
      >
        Tout effacer
      </button>
    </div>
  );

  const dropdownDesktop = open && mounted && isDesktop && triggerRect && (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label={pickerTitle}
      aria-multiselectable="true"
      className="fixed z-[10500] bg-bg-primary border border-border rounded-lg shadow-[0_10px_28px_rgba(15,23,42,0.18)] overflow-hidden"
      style={{
        top: triggerRect.bottom + 4,
        left: triggerRect.left,
        minWidth: Math.max(triggerRect.width, 200),
        maxWidth: Math.min(460, window.innerWidth - triggerRect.left - 8),
        maxHeight: Math.min(400, window.innerHeight - triggerRect.bottom - 16),
        display: "flex",
        flexDirection: "column",
      }}
    >
      {searchable && (
        <div className="shrink-0 border-b border-border-light p-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher…"
              className="w-full h-8 pl-8 pr-2 rounded-md border border-border bg-bg-primary text-[12.5px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-primary"
            />
          </div>
        </div>
      )}
      {headerBar}
      {listContent}
    </div>
  );

  const pickerModal = open && mounted && !isDesktop && (
    <div
      className="fixed inset-0 z-[10500] flex"
      role="dialog"
      aria-modal="true"
      aria-label={pickerTitle}
    >
      <div
        ref={modalRef}
        className="relative w-full h-full flex flex-col bg-bg-primary"
      >
        <div className="shrink-0 border-b border-border bg-bg-primary px-4 pb-3 pt-[max(env(safe-area-inset-top),16px)]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Retour"
              className="w-11 h-11 rounded-full bg-bg-secondary hover:bg-bg-tertiary text-text-primary flex items-center justify-center shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Choisir</p>
              <h3 className="font-heading text-lg font-bold text-text-primary truncate">{pickerTitle}</h3>
            </div>
            {values.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="shrink-0 h-9 px-3 rounded-lg bg-bg-secondary hover:bg-bg-tertiary text-text-secondary text-[13px] font-medium"
              >
                Tout effacer
              </button>
            )}
          </div>
          {searchable && (
            <div className="relative mt-3">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher…"
                className="w-full h-12 pl-11 pr-3 rounded-xl border border-border bg-bg-primary text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-primary"
              />
            </div>
          )}
        </div>

        {listContent}

        <div className="shrink-0 border-t border-border bg-bg-primary px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full h-12 rounded-xl bg-ink text-white text-[15px] font-bold hover:bg-primary-hover transition-colors"
          >
            {values.length > 0
              ? `Valider (${values.length} ${pluralLabel})`
              : "Valider"}
          </button>
        </div>
      </div>
    </div>
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
        <span className={`flex-1 truncate ${values.length === 0 ? "opacity-50" : "font-semibold"}`}>
          {triggerLabel}
        </span>
        {values.length > 0 && (
          <span
            aria-hidden="true"
            className="shrink-0 min-w-[20px] h-5 inline-flex items-center justify-center px-1.5 rounded-full bg-emerald-600 text-white text-[10.5px] font-bold tabular-nums"
          >
            {values.length}
          </span>
        )}
        <svg
          className={`shrink-0 opacity-40 transition-transform duration-200 ${open ? "rotate-180" : ""} ${
            isSm ? "w-4 h-4 md:w-3 md:h-3" : "w-4 h-4 md:w-3.5 md:h-3.5"
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {mounted && createPortal(<>{dropdownDesktop}{pickerModal}</>, document.body)}
    </>
  );
}
