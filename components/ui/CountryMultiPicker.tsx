"use client";

import { useMemo, useState } from "react";
import { COUNTRIES, countryFlagUrl, findCountry } from "@/lib/countries";

interface Props {
  value: readonly string[];
  onChange: (codes: string[]) => void;
  placeholder?: string;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function CountryMultiPicker({
  value,
  onChange,
  placeholder = "Rechercher un pays…",
}: Props) {
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(
    () => new Set(value.map((c) => c.toUpperCase())),
    [value],
  );

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => normalize(c.name).includes(q) || normalize(c.code).includes(q),
    );
  }, [query]);

  function toggle(code: string) {
    const up = code.toUpperCase();
    const next = new Set(selectedSet);
    if (next.has(up)) next.delete(up);
    else next.add(up);
    onChange(Array.from(next).sort());
  }

  function removeOne(code: string) {
    const next = new Set(selectedSet);
    next.delete(code.toUpperCase());
    onChange(Array.from(next).sort());
  }

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((code) => {
            const c = findCountry(code);
            const label = c?.name ?? code;
            return (
              <span
                key={code}
                className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium"
              >
                <img
                  src={countryFlagUrl(code)}
                  alt=""
                  width={16}
                  height={12}
                  className="rounded-[2px] shadow-[0_0_0_1px_rgba(15,23,42,0.08)] object-cover"
                />
                <span>{label}</span>
                <button
                  type="button"
                  onClick={() => removeOne(code)}
                  aria-label={`Retirer ${label}`}
                  className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-bg-primary text-sm text-text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-slate-100"
        />
      </div>

      <ul className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border bg-bg-primary">
        {filtered.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-text-muted">Aucun pays</li>
        ) : (
          filtered.map((c) => {
            const active = selectedSet.has(c.code);
            return (
              <li key={c.code}>
                <label className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-bg-secondary">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggle(c.code)}
                    className="w-4 h-4 rounded border-border text-slate-700 focus:ring-slate-300"
                  />
                  <img
                    src={countryFlagUrl(c.code)}
                    alt=""
                    width={22}
                    height={16}
                    loading="lazy"
                    className="rounded-sm shadow-[0_0_0_1px_rgba(15,23,42,0.08)] object-cover shrink-0"
                  />
                  <span className={`flex-1 ${active ? "font-medium text-text-primary" : "text-text-secondary"}`}>
                    {c.name}
                  </span>
                </label>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
