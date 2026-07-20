"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES, countryFlagUrl, findCountry } from "@/lib/countries";

interface Props {
  value: string | null;
  onChange: (code: string | null) => void;
  placeholder?: string;
  clearable?: boolean;
  ariaLabel?: string;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function CountryCombobox({
  value,
  onChange,
  placeholder = "Sélectionner un pays…",
  clearable = true,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = findCountry(value);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => normalize(c.name).includes(q) || normalize(c.code).includes(q),
    );
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    setTimeout(() => searchRef.current?.focus(), 10);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function pick(code: string) {
    onChange(code);
    setOpen(false);
    setQuery("");
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
    setQuery("");
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center gap-2 pl-3 py-2 rounded-lg border border-border bg-bg-primary text-left text-sm text-text-primary hover:border-border-strong focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-slate-100 transition-colors ${
          clearable && selected ? "pr-14" : "pr-9"
        }`}
      >
        {selected ? (
          <>
            <img
              src={countryFlagUrl(selected.code)}
              alt=""
              width={22}
              height={16}
              className="rounded-sm shadow-[0_0_0_1px_rgba(15,23,42,0.08)] object-cover shrink-0"
            />
            <span className="flex-1 truncate">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-text-muted">{placeholder}</span>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {clearable && selected && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-8 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-secondary"
          aria-label="Effacer le pays"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}

      {open && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-bg-primary border border-border rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border bg-bg-secondary">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4-4" />
                </svg>
              </span>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un pays…"
                autoComplete="off"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-bg-primary text-sm text-text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-slate-100"
              />
            </div>
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-text-muted">Aucun pays</li>
            ) : (
              filtered.map((c) => {
                const active = c.code === value;
                return (
                  <li
                    key={c.code}
                    role="option"
                    aria-selected={active}
                    onClick={() => pick(c.code)}
                    className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-bg-secondary ${
                      active ? "bg-violet-50 text-violet-800 font-semibold" : "text-text-secondary"
                    }`}
                  >
                    <img
                      src={countryFlagUrl(c.code)}
                      alt=""
                      width={22}
                      height={16}
                      loading="lazy"
                      className="rounded-sm shadow-[0_0_0_1px_rgba(15,23,42,0.08)] object-cover shrink-0"
                    />
                    <span className="flex-1">{c.name}</span>
                    {active && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
