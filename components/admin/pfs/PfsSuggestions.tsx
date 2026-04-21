"use client";

/**
 * Shows clickable suggestion chips that match the user's typed name against
 * known PFS values. Two modes:
 *
 *  - "ref" : flat string list (size, color, composition, country, season).
 *            Pick a chip → calls `onPick(ref: string)` with the exact PFS value.
 *
 *  - "category" : cascade triples (gender, family, category). Each chip renders
 *            as "Femme › Bijoux_Fantaisie › Bague" and calls
 *            `onPickCategory({ gender, family, category })`.
 *
 * Matching is case- and diacritics-insensitive. Exact matches are highlighted
 * green (check icon), partial matches show the substring in neutral.
 * Hidden when the query is shorter than 2 characters or there are no matches.
 */

import { useMemo } from "react";
import { normalizePfsQuery } from "@/lib/marketplace-excel/pfs-color-hex";

export { normalizePfsQuery };

const normalize = normalizePfsQuery;

export interface PfsCategoryTriple {
  gender: string;    // "Femme" | "Homme" | "Enfant" | "Lifestyle_et_Plus"
  family: string;    // "Bijoux_Fantaisie"
  category: string;  // "Bagues"
}

/**
 * An option is either a plain string (value = label) or a `{value, label}`
 * object. Matching runs against the `label` but onPick receives the `value`.
 * Useful when the PFS value is a code (e.g. "PE2026") that's different from
 * the human-readable label ("PE2026 — Printemps/Été 2026").
 */
export type PfsRefOption = string | { value: string; label: string };

interface RefProps {
  mode: "ref";
  query: string;
  options: PfsRefOption[];
  /** Exclude these values from suggestions (e.g. already-mapped values). */
  exclude?: string[];
  onPick: (ref: string) => void;
  /** Current value — if a suggestion matches it, mark it as selected. */
  currentValue?: string | null;
  label?: string;
  maxResults?: number;
}

interface CategoryProps {
  mode: "category";
  query: string;
  triples: PfsCategoryTriple[];
  onPickCategory: (triple: PfsCategoryTriple) => void;
  currentValue?: PfsCategoryTriple | null;
  label?: string;
  maxResults?: number;
}

type Props = RefProps | CategoryProps;

export default function PfsSuggestions(props: Props) {
  const q = normalize(props.query);
  const maxResults = props.maxResults ?? 6;

  const matches = useMemo(() => {
    if (q.length < 2) return [] as ({ value: string; label: string; score: number } | { triple: PfsCategoryTriple; score: number })[];
    if (props.mode === "ref") {
      const excl = new Set((props.exclude ?? []).map(normalize));
      return props.options
        .map((o) => (typeof o === "string" ? { value: o, label: o } : o))
        .filter((o) => !excl.has(normalize(o.value)))
        .map((o) => ({ ...o, score: scoreMatch(normalize(o.label), q) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
    }
    return props.triples
      .map((t) => ({ triple: t, score: scoreMatch(normalize(t.category), q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }, [q, props, maxResults]);

  if (q.length < 2 || matches.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[10.5px] font-body text-text-muted flex items-center gap-1.5 uppercase tracking-wide">
        <svg className="w-3 h-3 text-[#8B5CF6]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        {props.label ?? "Correspondance PFS suggérée"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {props.mode === "ref"
          ? (matches as { value: string; label: string; score: number }[]).map((m) => {
              const isExact = m.score >= 100;
              const isSelected = props.currentValue === m.value;
              return (
                <SuggestionChip
                  key={m.value}
                  label={m.label}
                  isExact={isExact}
                  isSelected={isSelected}
                  onClick={() => props.onPick(m.value)}
                />
              );
            })
          : (matches as { triple: PfsCategoryTriple; score: number }[]).map((m) => {
              const { triple } = m;
              const isExact = m.score >= 100;
              const key = `${triple.gender}|${triple.family}|${triple.category}`;
              const isSelected = props.currentValue
                ? props.currentValue.gender === triple.gender &&
                  props.currentValue.family === triple.family &&
                  props.currentValue.category === triple.category
                : false;
              const label = (
                <span className="inline-flex items-center gap-1">
                  <span className="opacity-70">{triple.gender}</span>
                  <Chevron />
                  <span className="opacity-70">{triple.family.replace(/_/g, " ")}</span>
                  <Chevron />
                  <span className="font-semibold">{triple.category}</span>
                </span>
              );
              return (
                <SuggestionChip
                  key={key}
                  label={label}
                  isExact={isExact}
                  isSelected={isSelected}
                  onClick={() => (props as CategoryProps).onPickCategory(triple)}
                />
              );
            })}
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg className="w-2.5 h-2.5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function SuggestionChip({
  label,
  isExact,
  isSelected,
  onClick,
}: {
  label: React.ReactNode;
  isExact: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const base = "inline-flex items-center gap-1 text-[11px] font-body rounded-full border px-2.5 py-1 transition-all cursor-pointer hover:shadow-sm";
  const variant = isSelected
    ? "bg-[#DCFCE7] border-[#86EFAC] text-[#14532D]"
    : isExact
      ? "bg-[#F3E8FF] border-[#C4B5FD] text-[#5B21B6] hover:bg-[#EDE9FE]"
      : "bg-bg-secondary border-border text-text-secondary hover:border-text-primary hover:text-text-primary";

  return (
    <button type="button" onClick={onClick} className={`${base} ${variant}`} title="Remplir automatiquement">
      {isSelected ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : isExact ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      )}
      {typeof label === "string" ? <span>{label}</span> : label}
    </button>
  );
}

/**
 * Score a candidate PFS value against the user's query. Both inputs are
 * expected to already be normalised via `normalizePfsQuery`.
 * - 100  = exact full match
 * - 40+  = candidate starts with query
 * - 10+  = candidate contains query
 * - 0    = no match
 */
export function scoreMatch(candidate: string, query: string): number {
  if (!candidate || !query) return 0;
  if (candidate === query) return 100;
  if (candidate.startsWith(query)) return 80 - Math.min(candidate.length - query.length, 40);
  if (candidate.includes(query)) return 30 - Math.min(candidate.length - query.length, 20);
  // Query contains candidate (e.g. user typed "Or Rose Doré" and candidate is "Or Rose")
  if (query.includes(candidate) && candidate.length >= 3) return 20;
  return 0;
}
