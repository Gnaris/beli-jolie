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
  iconUrl?: string;     // Image URL (e.g. country flag). Takes precedence over icon.
  iconNode?: React.ReactNode; // Arbitrary React node (e.g. <span className="fi fi-fr">). Takes precedence over iconUrl and icon.
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
  /** Titre du picker (plein écran mobile / modal centré desktop) */
  title?: string;
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
  title,
}: CustomSelectProps) {
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

  // Mode d'affichage : « dropdown » (desktop ≥ 768 px, ancré sous le bouton
  // trigger) ou « modal » (mobile, plein écran). Réévalué à chaque ouverture
  // via matchMedia — permet une bascule propre au resize.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Position absolue du trigger (recalculée à l'ouverture + au resize/scroll).
  // Utilisée pour ancrer le dropdown desktop juste sous le bouton.
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

  // Verrouille le scroll de la page — UNIQUEMENT en mode modal (mobile).
  // En mode dropdown desktop la page reste défilable (comme un select natif).
  useEffect(() => {
    if (!open || isDesktop) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open, isDesktop]);

  // Ferme au clic extérieur — mode dropdown desktop uniquement.
  useEffect(() => {
    if (!open || !isDesktop) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    // On écoute sur le prochain tick pour laisser le clic d'ouverture passer.
    const t = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open, isDesktop]);

  const selected = options.find((o) => o.value === value);

  // Filter options by search query
  const displayedOptions = searchable && searchQuery.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : options;

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

  // Scroll highlighted option into view — SEULEMENT si l'utilisateur navigue
  // au clavier. Sur `onMouseEnter`, on met à jour l'index visuel mais on ne
  // scrolle pas : sinon la ligne pointée se déplace sous le curseur et cascade
  // vers le bas du modal.
  // On scrolle manuellement l'intérieur du listbox (jamais `scrollIntoView`)
  // pour éviter le bug macOS où un ancêtre position:fixed provoque le scroll
  // de la page principale jusqu'en haut.
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

  // Keyboard navigation
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

  // Trigger : gros et touchable sur mobile (< 768 px), compact sur desktop.
  // Les classes `md:*` rétablissent la taille d'origine au-dessus de 768 px.
  const triggerClasses = isDark
    ? `flex items-center gap-2 w-full text-left font-body transition-all duration-150 cursor-pointer rounded-lg border ${
        isSm
          ? "px-4 py-3 text-[14px] md:px-2.5 md:py-1.5 md:text-[11px]"
          : "px-4 py-3 text-[14px] md:px-3 md:py-2 md:text-xs"
      } font-medium text-white bg-white/[0.12] border-white/20 hover:bg-white/[0.18] hover:border-white/30 disabled:opacity-40 disabled:cursor-not-allowed`
    : `flex items-center gap-2 w-full text-left font-body transition-all duration-150 cursor-pointer rounded-lg border ${
        isSm
          ? "px-4 py-3 text-[14px] md:px-2.5 md:py-1.5 md:text-[11px]"
          : "px-4 py-3 text-[14px] md:px-3 md:py-[9px] md:text-xs"
      } font-medium text-text-primary bg-bg-primary border-border hover:border-bg-dark disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_1px_2px_rgba(0,0,0,0.04)]`;

  function handleSelect(val: string) {
    onChange(val);
    setOpen(false);
    setSearchQuery("");
    triggerRef.current?.focus({ preventScroll: true });
  }

  // Titre affiché dans le header du picker (mobile plein écran / desktop modal centré).
  const pickerTitle = title ?? ariaLabel ?? placeholder ?? "Sélectionner";

  // Contenu partagé (liste des options + éventuelle recherche + loader) —
  // rendu identique en mode dropdown (desktop) et modal (mobile).
  const listContent = (
    <div className="flex-1 overflow-y-auto" role="listbox">
      {loading ? (
        <div className="flex items-center justify-center gap-2 px-4 py-6">
          <svg className="w-5 h-5 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-[14px] text-text-muted font-body">Chargement…</span>
        </div>
      ) : emptyMessage && displayedOptions.filter((o) => o.value !== "").length === 0 ? (
        <p className="px-4 py-6 text-[14px] text-text-muted text-center">{emptyMessage}</p>
      ) : displayedOptions.length === 0 ? (
        <p className="px-4 py-6 text-[14px] text-text-muted text-center">Aucun résultat</p>
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
              onMouseEnter={() => { highlightSourceRef.current = "mouse"; setHighlightedIndex(idx); }}
              className={`w-full ${isDesktop ? "min-h-9 px-3 py-2" : "min-h-[56px] px-4"} flex items-center justify-between gap-3 border-b border-border-light text-left transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                isSelected
                  ? "bg-emerald-50"
                  : isHighlighted
                    ? "bg-bg-secondary"
                    : "hover:bg-bg-secondary active:bg-bg-secondary"
              }`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {opt.iconNode ? (
                  <span className="shrink-0 flex items-center">{opt.iconNode}</span>
                ) : opt.iconUrl ? (
                  <img
                    src={opt.iconUrl}
                    alt=""
                    loading="lazy"
                    className="w-6 h-[18px] rounded-sm object-cover shadow-[0_0_0_1px_rgba(15,23,42,0.08)] shrink-0"
                  />
                ) : opt.icon ? (
                  <svg
                    className="w-5 h-5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    style={{ color: isSelected ? "var(--color-text-primary)" : "var(--color-text-muted)" }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={opt.icon} />
                  </svg>
                ) : null}
                <span
                  className={`${isDesktop ? "text-[13px]" : "text-[15px]"} truncate ${
                    isSelected ? "font-semibold text-text-primary" : "text-text-secondary"
                  } ${opt.className ?? ""}`}
                >
                  {opt.label}
                </span>
              </div>
              {isSelected && (
                <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })
      )}
    </div>
  );

  // ─── DROPDOWN desktop ≥ 768 px — ancré sous le trigger via position fixed ──
  // Pas de voile (comme un select natif). Fermeture au clic extérieur ou ESC.
  const dropdownDesktop = open && mounted && isDesktop && triggerRect && (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label={pickerTitle}
      className="fixed z-[10500] bg-bg-primary border border-border rounded-lg shadow-[0_10px_28px_rgba(15,23,42,0.18)] overflow-hidden"
      style={{
        top: triggerRect.bottom + 4,
        left: triggerRect.left,
        // Largeur : au moins celle du trigger, avec plancher raisonnable pour
        // les triggers très étroits. Plafond pour listes très larges.
        minWidth: Math.max(triggerRect.width, 180),
        maxWidth: Math.min(420, window.innerWidth - triggerRect.left - 8),
        maxHeight: Math.min(360, window.innerHeight - triggerRect.bottom - 16),
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
      {listContent}
    </div>
  );

  // ─── MODAL mobile < 768 px — plein écran, header retour + footer valider ──
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
        {/* Header */}
        <div
          className="shrink-0 border-b border-border md:border-border-light bg-bg-primary px-4 pb-3 md:px-5 md:pt-5 pt-[max(env(safe-area-inset-top),16px)]"
        >
          <div className="flex items-center gap-3 md:items-start">
            {/* Mobile : flèche retour */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Retour"
              className="md:hidden w-11 h-11 rounded-full bg-bg-secondary hover:bg-bg-tertiary text-text-primary flex items-center justify-center shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Choisir</p>
              <h3 className="font-heading text-lg font-bold text-text-primary truncate">{pickerTitle}</h3>
            </div>
            {/* Desktop : croix fermer */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer"
              className="hidden md:flex shrink-0 w-9 h-9 rounded-full bg-bg-secondary hover:bg-bg-tertiary text-text-secondary items-center justify-center text-xl leading-none"
            >
              ×
            </button>
          </div>
          {searchable && (
            <div className="relative mt-3">
              <svg
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher…"
                className="w-full h-12 md:h-11 pl-11 pr-3 rounded-xl border border-border bg-bg-primary text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-primary"
              />
            </div>
          )}
        </div>

        {/* Liste scrollable — partagée avec le dropdown desktop */}
        {listContent}

        {/* Footer sticky avec bouton Valider (mobile). */}
        <div
          className="shrink-0 border-t border-border bg-bg-primary px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full h-12 rounded-xl bg-ink text-white text-[15px] font-bold hover:bg-primary-hover transition-colors"
          >
            Valider
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
        {selected?.iconNode ? (
          <span className="shrink-0 flex items-center">{selected.iconNode}</span>
        ) : selected?.iconUrl ? (
          <img
            src={selected.iconUrl}
            alt=""
            className={`shrink-0 rounded-sm object-cover shadow-[0_0_0_1px_rgba(15,23,42,0.08)] ${
              isSm ? "w-5 h-[14px] md:w-4 md:h-3" : "w-6 h-[18px] md:w-5 md:h-[14px]"
            }`}
          />
        ) : selected?.icon ? (
          <svg
            className={`shrink-0 opacity-60 ${
              isSm ? "w-4 h-4 md:w-3 md:h-3" : "w-4 h-4 md:w-3.5 md:h-3.5"
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d={selected.icon} />
          </svg>
        ) : null}
        <span className={`flex-1 truncate ${!selected ? "opacity-50" : ""}`}>
          {selected?.label ?? placeholder}
        </span>
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
