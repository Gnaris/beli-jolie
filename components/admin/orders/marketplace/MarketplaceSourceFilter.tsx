"use client";

/**
 * Dropdown à cases à cocher pour filtrer les cartes Top clients / Top produits
 * par marketplace(s).
 *
 * Sémantique validée cliente 2026-07-23 :
 *   - Aucune case cochée      → « Tout »   → aucun filtre (comportement par défaut)
 *   - 1 case cochée (ex. PFS) → n'affiche que les entités présentes sur PFS
 *   - 2 cases cochées         → n'affiche que les entités présentes sur PFS **ET** eFashion
 *     (intersection — les clients/produits actifs sur les 2 marketplaces)
 */

import { useEffect, useRef, useState } from "react";
import type { MarketplaceSource } from "@/app/actions/admin/marketplace-orders";
import { MARKETPLACE_META } from "./MarketplaceBadge";

const ALL_SOURCES: MarketplaceSource[] = ["PFS", "EFASHION", "ANKORSTORE", "FAIRE"];

interface Props {
  selected: MarketplaceSource[];
  onChange: (next: MarketplaceSource[]) => void;
  label?: string;
}

export default function MarketplaceSourceFilter({
  selected,
  onChange,
  label = "Marketplaces",
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (source: MarketplaceSource) => {
    if (selected.includes(source)) {
      onChange(selected.filter((s) => s !== source));
    } else {
      onChange([...selected, source]);
    }
  };

  const summary = (() => {
    if (selected.length === 0) return "Tout";
    if (selected.length === 1) return MARKETPLACE_META[selected[0]].label;
    return `${selected.length} marketplaces (intersection)`;
  })();

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs rounded-full px-3 py-1 border border-border bg-white text-text-secondary hover:bg-bg-secondary inline-flex items-center gap-1.5"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="opacity-60">{label} :</span>
        <span className="font-semibold text-text-primary">{summary}</span>
        <svg
          className="w-3 h-3 opacity-60"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1.5 z-20 w-64 rounded-xl border border-border bg-white shadow-lg py-2"
          role="listbox"
        >
          <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-[0.14em] text-text-muted font-semibold">
            Filtrer par marketplace
          </div>
          <div className="px-1.5 space-y-0.5">
            <button
              type="button"
              onClick={() => onChange([])}
              className={`w-full text-left rounded-lg px-2.5 py-2 text-sm flex items-center gap-2 ${
                selected.length === 0
                  ? "bg-slate-100 text-text-primary font-medium"
                  : "hover:bg-bg-secondary text-text-secondary"
              }`}
            >
              <span className="w-4 h-4 rounded-md border border-border bg-white flex items-center justify-center shrink-0">
                {selected.length === 0 && (
                  <svg className="w-3 h-3 text-slate-900" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" />
                  </svg>
                )}
              </span>
              <span>Tout (par défaut)</span>
            </button>

            <div className="my-1 border-t border-border/50" />

            {ALL_SOURCES.map((s) => {
              const checked = selected.includes(s);
              const meta = MARKETPLACE_META[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(s)}
                  className={`w-full text-left rounded-lg px-2.5 py-2 text-sm flex items-center gap-2 ${
                    checked
                      ? "bg-slate-100 text-text-primary font-medium"
                      : "hover:bg-bg-secondary text-text-secondary"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                      checked ? "border-slate-900 bg-slate-900" : "border-border bg-white"
                    }`}
                  >
                    {checked && (
                      <svg
                        className="w-3 h-3 text-white"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" />
                      </svg>
                    )}
                  </span>
                  <span
                    className="w-5 h-5 rounded-md text-white font-heading font-bold text-[11px] flex items-center justify-center shrink-0"
                    style={{ background: meta.gradient }}
                    aria-hidden
                  >
                    {meta.letter}
                  </span>
                  <span className="flex-1">{meta.label}</span>
                </button>
              );
            })}
          </div>

          {selected.length === ALL_SOURCES.length && (
            <div className="mx-2 mt-2 px-2 py-1.5 text-[11px] text-text-muted bg-bg-secondary/60 rounded-lg leading-snug">
              Affiche uniquement les entités présentes sur toutes les marketplaces cochées (intersection).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
