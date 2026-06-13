"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getFaireTaxonomyOptions,
} from "@/app/actions/admin/faire";
import {
  searchFaireTaxonomy,
  findFaireTaxonomyById,
  type FaireTaxonomyType,
} from "@/lib/faire-taxonomy-types";

/**
 * Sélecteur pour mapper une catégorie BDD à un `taxonomy_type.id` Faire.
 * Affiche en permanence :
 *  - un select natif compact avec recherche (CustomSelect-like)
 *  - sous le sélecteur, les raccourcis suggérés d'après le nom FR.
 *
 * Calque le pattern visuel de PFS / eFashion : sélecteur visible en haut,
 * chips en dessous, design uniforme.
 */
export default function FaireTaxonomySelect({
  value,
  onSave,
  label,
  helpText,
  suggestionQuery,
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
  label?: string;
  helpText?: string;
  /** Texte utilisé pour proposer 1-3 raccourcis sous le sélecteur (nom FR). */
  suggestionQuery?: string;
}) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [types, setTypes] = useState<FaireTaxonomyType[] | null>(null);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (types !== null || loadingTypes) return;
    setLoadingTypes(true);
    getFaireTaxonomyOptions()
      .then((rows) => setTypes(rows))
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : "Chargement impossible.");
        setTypes([]);
      })
      .finally(() => setLoadingTypes(false));
  }, [types, loadingTypes]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [dropdownOpen]);

  const currentLabel = useMemo(() => {
    if (!value) return "";
    if (!types) return value;
    const hit = findFaireTaxonomyById(types, value);
    if (!hit) return value;
    const trail = hit.categoryBreadcrumb?.join(" > ");
    return trail ? `${hit.name} (${trail})` : hit.name;
  }, [value, types]);

  const results = useMemo(() => {
    if (!types) return [];
    return searchFaireTaxonomy(types, query, 15);
  }, [types, query]);

  const suggestions = useMemo(() => {
    if (!types || !suggestionQuery || suggestionQuery.trim().length < 2) return [];
    return searchFaireTaxonomy(types, suggestionQuery, 3);
  }, [types, suggestionQuery]);

  async function pick(id: string | null) {
    if (id === (value ?? null)) {
      setDropdownOpen(false);
      setQuery("");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await onSave(id);
      setDropdownOpen(false);
      setQuery("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      {label && (
        <p className="font-body text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      )}
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen((v) => !v)}
          disabled={saving}
          title={helpText ?? "Choisir une catégorie Faire"}
          className="w-full flex items-center justify-between gap-2 h-9 px-3 rounded-md border border-border bg-bg-primary text-text-primary text-sm font-body hover:border-text-secondary transition-colors disabled:opacity-50"
        >
          <span className={`truncate text-left ${currentLabel ? "" : "text-text-muted"}`}>
            {currentLabel || "Choisir une catégorie Faire…"}
          </span>
          <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {dropdownOpen && (
          <div className="absolute left-0 right-0 mt-1 z-20 rounded-md border border-border bg-bg-primary shadow-lg overflow-hidden">
            <div className="p-2 border-b border-border">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setDropdownOpen(false);
                    setQuery("");
                  }
                }}
                placeholder="Rechercher (« bracelet », « bague »…)"
                disabled={saving}
                className="w-full h-8 px-2.5 rounded-md border border-border bg-bg-primary text-text-primary text-xs font-body focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 disabled:opacity-50"
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {loadingTypes && (
                <p className="px-3 py-2 text-[11px] text-text-muted font-body">Chargement…</p>
              )}
              {!loadingTypes && types && types.length === 0 && (
                <p className="px-3 py-2 text-[11px] text-text-muted font-body">
                  Taxonomie Faire indisponible. Vérifiez la clé API dans Paramètres.
                </p>
              )}
              {!loadingTypes && results.length === 0 && types && types.length > 0 && (
                <p className="px-3 py-2 text-[11px] text-text-muted font-body">Aucun résultat.</p>
              )}
              {results.map((t) => {
                const trail = t.categoryBreadcrumb?.join(" › ");
                const selected = t.id === value;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void pick(t.id)}
                    disabled={saving}
                    className={`w-full text-left px-3 py-1.5 text-xs font-body transition-colors disabled:opacity-50 ${
                      selected ? "bg-bg-secondary" : "hover:bg-bg-secondary"
                    }`}
                  >
                    <span className="font-semibold text-text-primary">{t.name}</span>
                    {trail && (
                      <span className="block text-[10px] text-text-muted">{trail}</span>
                    )}
                  </button>
                );
              })}
              {value && (
                <button
                  type="button"
                  onClick={() => void pick(null)}
                  disabled={saving}
                  className="w-full text-left px-3 py-1.5 text-xs font-body text-[#DC2626] border-t border-border hover:bg-[#FEF2F2] transition-colors disabled:opacity-50"
                >
                  Retirer le mapping
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10.5px] font-body text-text-muted flex items-center gap-1.5 uppercase tracking-wide">
            <svg className="w-3 h-3 text-[#8B5CF6]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Correspondance Faire suggérée
          </p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => {
              const trail = s.categoryBreadcrumb?.join(" › ");
              const isSelected = s.id === value;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void pick(s.id)}
                  disabled={saving}
                  className={`inline-flex items-center gap-1 text-[11px] font-body rounded-full border px-2.5 py-1 transition-all cursor-pointer hover:shadow-sm disabled:opacity-50 text-left ${
                    isSelected
                      ? "bg-[#DCFCE7] border-[#86EFAC] text-[#14532D]"
                      : "bg-bg-secondary border-border text-text-secondary hover:border-text-primary hover:text-text-primary"
                  }`}
                  title={trail ? `${s.name} — ${trail}` : s.name}
                >
                  {isSelected ? (
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  )}
                  <span className="font-semibold whitespace-normal break-words">{s.name}</span>
                  {trail && <span className="opacity-70 text-[10px] whitespace-normal break-words">({trail})</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {errorMsg && (
        <p className="font-body text-[10px] text-[#EF4444]">{errorMsg}</p>
      )}
    </div>
  );
}
