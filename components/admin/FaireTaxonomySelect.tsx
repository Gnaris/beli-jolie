"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  /**
   * Callback de sauvegarde. Reçoit l'ID Faire ET le nom lisible déjà
   * résolu (ex: « Bracelets ») — évite au parent de devoir recharger la
   * taxonomie juste pour afficher le label dans son tableau.
   */
  onSave: (next: string | null, nextLabel: string | null) => Promise<void>;
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
  const [mounted, setMounted] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
    /** Hauteur max du bloc résultats — laisse toujours une marge sous la fenêtre. */
    maxListHeight: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Recalcule la position du menu (rendu via portail) à l'ouverture ET au
  // resize/scroll de la page — sinon le menu resterait figé pendant que la
  // modale scrolle.
  useLayoutEffect(() => {
    if (!dropdownOpen) return;
    const update = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const MARGIN = 12; // marge minimale pour ne pas coller aux bords
      const SEARCH_HEIGHT = 56; // input + padding ≈ 56 px (mesuré)
      const IDEAL_LIST_HEIGHT = 240; // ~10 lignes de résultats

      // ── Largeur : recentre si le trigger est près du bord droit ────────
      const maxWidth = window.innerWidth - MARGIN * 2;
      const width = Math.min(rect.width, maxWidth);
      const rawLeft = rect.left;
      const left = Math.max(MARGIN, Math.min(rawLeft, window.innerWidth - MARGIN - width));

      // ── Hauteur : ouvre au-dessus si pas assez de place en dessous ─────
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
      const spaceAbove = rect.top - MARGIN;
      const needed = SEARCH_HEIGHT + IDEAL_LIST_HEIGHT;
      const openAbove = spaceBelow < needed && spaceAbove > spaceBelow;
      const availableForMenu = openAbove ? spaceAbove : spaceBelow;
      // Cap la hauteur des résultats pour ne jamais toucher la barre des tâches.
      const maxListHeight = Math.max(96, Math.min(IDEAL_LIST_HEIGHT, availableForMenu - SEARCH_HEIGHT));
      const totalMenuHeight = SEARCH_HEIGHT + maxListHeight;
      const top = openAbove ? rect.top - totalMenuHeight - 4 : rect.bottom + 4;

      setMenuPos({ top, left, width, maxListHeight });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [dropdownOpen]);

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
      const target = e.target as Node;
      // Le menu est rendu via portail, donc "cliquer sur le menu" n'est pas
      // capté par containerRef — on autorise aussi menuRef.
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setDropdownOpen(false);
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
      const nextLabel = id && types ? (findFaireTaxonomyById(types, id)?.name ?? null) : null;
      await onSave(id, nextLabel);
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
          ref={triggerRef}
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
        {mounted && dropdownOpen && menuPos && createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: menuPos.width, zIndex: 10000 }}
            className="rounded-md border border-border bg-bg-primary shadow-lg overflow-hidden"
          >
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
            <div
              className="overflow-y-auto"
              style={{ maxHeight: menuPos.maxListHeight }}
            >
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
          </div>,
          document.body,
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
