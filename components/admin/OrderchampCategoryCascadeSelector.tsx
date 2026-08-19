"use client";

/**
 * Sélecteur en cascade pour mapper une catégorie BJ à une feuille de la
 * taxonomie Orderchamp (`ProductCategoryPath` — 1 382 feuilles).
 *
 * UX cascade : l'admin clique un dropdown, navigue racine → sous-catégorie
 * → feuille. Seule la sélection d'une feuille déclenche la sauvegarde
 * (règle métier OC : les branches parentes ne sont pas acceptées).
 */

import { useEffect, useMemo, useState } from "react";
import { getOrderchampTaxonomyOptions } from "@/app/actions/admin/categories";
import {
  filterLeavesOnly,
  findByPath,
  getChildrenOf,
  type OrderchampCategoryNode,
} from "@/lib/orderchamp-taxonomy";

interface Props {
  value: string | null;
  /** Callback de sauvegarde. Reçoit le path (feuille) + son libellé FR résolu. */
  onSave: (nextPath: string | null, nextLabel: string | null) => Promise<void>;
  label?: string;
  helpText?: string;
}

export default function OrderchampCategoryCascadeSelector({
  value,
  onSave,
  label,
  helpText,
}: Props) {
  const [taxonomy, setTaxonomy] = useState<OrderchampCategoryNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Cascade cursor : path partiel actuellement navigué (null = racines).
  const [cursorPath, setCursorPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (taxonomy !== null || loading) return;
    setLoading(true);
    getOrderchampTaxonomyOptions()
      .then((rows) => setTaxonomy(rows))
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : "Chargement impossible.");
        setTaxonomy([]);
      })
      .finally(() => setLoading(false));
  }, [taxonomy, loading]);

  // Quand on ouvre le picker, on rembobine sur le parent de la valeur actuelle
  // pour que l'admin voie tout de suite le contexte de sa sélection.
  useEffect(() => {
    if (!open || !value || !taxonomy) return;
    const node = findByPath(taxonomy, value);
    if (!node) return;
    const segments = node.path.split("_");
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join("_") : null;
    setCursorPath(parentPath);
  }, [open, value, taxonomy]);

  const currentNode = useMemo(() => {
    if (!value || !taxonomy) return null;
    return findByPath(taxonomy, value) ?? null;
  }, [value, taxonomy]);

  const breadcrumb = useMemo(() => {
    if (!currentNode || !taxonomy) return null;
    const segments = currentNode.path.split("_");
    const trail: OrderchampCategoryNode[] = [];
    for (let i = 1; i <= segments.length; i++) {
      const p = segments.slice(0, i).join("_");
      const n = findByPath(taxonomy, p);
      if (n) trail.push(n);
    }
    return trail;
  }, [currentNode, taxonomy]);

  const children = useMemo(() => {
    if (!taxonomy) return [];
    return getChildrenOf(taxonomy, cursorPath).sort((a, b) => a.nameFr.localeCompare(b.nameFr, "fr"));
  }, [taxonomy, cursorPath]);

  const cursorBreadcrumb = useMemo(() => {
    if (!cursorPath || !taxonomy) return [];
    const segments = cursorPath.split("_");
    const trail: OrderchampCategoryNode[] = [];
    for (let i = 1; i <= segments.length; i++) {
      const p = segments.slice(0, i).join("_");
      const n = findByPath(taxonomy, p);
      if (n) trail.push(n);
    }
    return trail;
  }, [cursorPath, taxonomy]);

  // Recherche globale : quand l'admin tape, on cherche dans les FEUILLES du
  // niveau courant et de tous ses descendants (~15 résultats max).
  const searchResults = useMemo(() => {
    if (!taxonomy || query.trim().length < 2) return null;
    const q = query.trim().toLowerCase();
    const scope = cursorPath
      ? taxonomy.filter((n) => n.path === cursorPath || n.path.startsWith(`${cursorPath}_`))
      : taxonomy;
    const leaves = filterLeavesOnly(scope);
    return leaves
      .filter((n) => n.nameFr.toLowerCase().includes(q) || n.name.toLowerCase().includes(q))
      .slice(0, 15);
  }, [taxonomy, cursorPath, query]);

  function isLeaf(node: OrderchampCategoryNode): boolean {
    if (!taxonomy) return false;
    return getChildrenOf(taxonomy, node.path).length === 0;
  }

  async function pick(node: OrderchampCategoryNode | null) {
    const nextPath = node?.path ?? null;
    if (nextPath === (value ?? null)) {
      setOpen(false);
      setQuery("");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const label = node?.nameFr ?? null;
      await onSave(nextPath, label);
      setOpen(false);
      setQuery("");
      setCursorPath(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  const currentLabel = useMemo(() => {
    if (!currentNode) return "";
    return breadcrumb
      ? breadcrumb.map((n) => n.nameFr).join(" › ")
      : currentNode.nameFr;
  }, [currentNode, breadcrumb]);

  return (
    <div className="space-y-2">
      {label && (
        <p className="font-body text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={saving}
          title={helpText ?? "Choisir une catégorie Orderchamp"}
          className="w-full flex items-center justify-between gap-2 h-9 px-3 rounded-md border border-border bg-bg-primary text-text-primary text-sm font-body hover:border-text-secondary transition-colors disabled:opacity-50"
        >
          <span className={`truncate text-left ${currentLabel ? "" : "text-text-muted"}`}>
            {currentLabel || "Choisir une catégorie Orderchamp…"}
          </span>
          <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full min-w-[340px] rounded-lg border border-border bg-bg-primary shadow-lg overflow-hidden">
            {/* Barre du haut : recherche + breadcrumb cliquable */}
            <div className="p-2 border-b border-border space-y-2">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); setOpen(false); setQuery(""); }
                }}
                placeholder="Rechercher une feuille (« bracelet », « bague »…)"
                disabled={saving}
                className="w-full h-8 px-2.5 rounded-md border border-border bg-bg-primary text-text-primary text-xs font-body focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:opacity-50"
              />
              <div className="flex items-center gap-1 flex-wrap text-[11px]">
                <button
                  type="button"
                  onClick={() => { setCursorPath(null); setQuery(""); }}
                  className={`px-1.5 py-0.5 rounded ${cursorPath === null ? "bg-orange-100 text-orange-700 font-semibold" : "text-text-muted hover:text-text-primary"}`}
                >
                  Racines
                </button>
                {cursorBreadcrumb.map((n) => (
                  <span key={n.path} className="flex items-center gap-1">
                    <span className="text-text-muted">›</span>
                    <button
                      type="button"
                      onClick={() => { setCursorPath(n.path); setQuery(""); }}
                      className="px-1.5 py-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
                    >
                      {n.nameFr}
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Liste : recherche OU cascade */}
            <div className="overflow-y-auto max-h-[280px]">
              {loading && (
                <p className="px-3 py-3 text-[11px] text-text-muted font-body">Chargement de la taxonomie…</p>
              )}
              {!loading && taxonomy && taxonomy.length === 0 && (
                <p className="px-3 py-3 text-[11px] text-text-muted font-body">
                  Taxonomie Orderchamp indisponible. Vérifiez la clé API dans Paramètres.
                </p>
              )}

              {searchResults !== null ? (
                searchResults.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] text-text-muted font-body">Aucune feuille trouvée.</p>
                ) : (
                  searchResults.map((n) => {
                    const selected = n.path === value;
                    return (
                      <button
                        key={n.path}
                        type="button"
                        onClick={() => void pick(n)}
                        disabled={saving}
                        className={`w-full text-left px-3 py-1.5 text-xs font-body transition-colors disabled:opacity-50 ${selected ? "bg-orange-50" : "hover:bg-bg-secondary"}`}
                      >
                        <span className="font-semibold text-text-primary">{n.nameFr}</span>
                        <span className="block text-[10px] text-text-muted">{n.path}</span>
                      </button>
                    );
                  })
                )
              ) : (
                children.map((n) => {
                  const leaf = isLeaf(n);
                  const selected = n.path === value;
                  return (
                    <div
                      key={n.path}
                      className={`flex items-stretch border-b border-border/50 ${selected ? "bg-orange-50" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => leaf ? void pick(n) : setCursorPath(n.path)}
                        disabled={saving}
                        className="flex-1 text-left px-3 py-1.5 text-xs font-body hover:bg-bg-secondary transition-colors disabled:opacity-50"
                      >
                        <span className={`${leaf ? "text-text-primary" : "text-text-primary font-semibold"}`}>
                          {n.nameFr}
                        </span>
                        {leaf && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">
                            Feuille
                          </span>
                        )}
                      </button>
                      {!leaf && (
                        <button
                          type="button"
                          onClick={() => setCursorPath(n.path)}
                          disabled={saving}
                          className="px-2 flex items-center text-text-muted hover:text-text-primary hover:bg-bg-secondary disabled:opacity-50"
                          aria-label="Ouvrir la sous-catégorie"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })
              )}

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

      {errorMsg && (
        <p className="font-body text-[10px] text-[#EF4444]">{errorMsg}</p>
      )}
      <p className="text-[10.5px] text-text-muted leading-snug">
        {helpText ??
          "Orderchamp attend une catégorie feuille (les branches parents sont refusées silencieusement)."}
      </p>
    </div>
  );
}
