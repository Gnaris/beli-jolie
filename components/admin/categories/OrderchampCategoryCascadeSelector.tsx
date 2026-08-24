"use client";

/**
 * OrderchampCategoryCascadeSelector — sélecteur d'une feuille de catégorie
 * Orderchamp (`ProductCategoryPath`). Utilisé dans l'admin catégories pour
 * mapper Category (obligatoire) et SubCategory (facultative) vers OC.
 *
 * UX :
 *   - Recherche plein texte en haut. Vide → arbre hiérarchique (accordéons
 *     `<details>` natifs, rendu paresseux navigateur). Remplie → liste plate
 *     des matches (max 200).
 *   - Cliquer une feuille appelle `onChange(path)`. Le parent gère le save.
 *   - Bouton « Effacer » visible seulement si `canClear` ET une valeur est
 *     posée (sous-catégorie : retombe sur la catégorie parente).
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  buildOrderchampCategoryTree,
  searchOrderchampCategoryLeaves,
  getOrderchampCategoryLabel,
  localizedOrderchampDisplayPath,
  type OrderchampCategoryLeaf,
  type OrderchampCategoryTreeNode,
} from "@/lib/orderchamp-taxonomy-shared";

type Props = {
  leaves: OrderchampCategoryLeaf[];
  value: string | null;
  onChange: (path: string | null) => Promise<void>;
  canClear?: boolean;
  placeholder?: string;
};

const MAX_SEARCH_RESULTS = 200;

export default function OrderchampCategoryCascadeSelector({
  leaves,
  value,
  onChange,
  canClear = true,
  placeholder = "Rechercher une catégorie Orderchamp (ex. bracelet, bague, collier…)",
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  // Statut traduction FR : ready quand toutes les feuilles ont un displayPathFr.
  const translatedCount = useMemo(
    () => leaves.filter((l) => l.displayPathFr !== null).length,
    [leaves],
  );
  const translationReady = leaves.length > 0 && translatedCount === leaves.length;

  // Tant que la traduction n'est pas complète, on auto-refresh la page toutes
  // les 15 s pour remonter les nouvelles FR au fur et à mesure. Stop dès que
  // ready ou si le composant est démonté (drawer fermé).
  useEffect(() => {
    if (translationReady || leaves.length === 0) return;
    const interval = setInterval(() => {
      router.refresh();
    }, 15000);
    return () => clearInterval(interval);
  }, [translationReady, leaves.length, router]);

  const tree = useMemo(() => buildOrderchampCategoryTree(leaves), [leaves]);
  const searchResults = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return searchOrderchampCategoryLeaves(leaves, trimmed).slice(0, MAX_SEARCH_RESULTS);
  }, [leaves, query]);

  const currentLabel = useMemo(
    () => (value ? getOrderchampCategoryLabel(value, leaves) : null),
    [value, leaves],
  );

  const disabled = pending;
  const handlePick = (path: string | null) => {
    if (disabled) return;
    startTransition(async () => {
      await onChange(path);
    });
  };

  if (leaves.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
        Catégories Orderchamp non chargées. Vérifiez que le token Orderchamp est
        bien renseigné dans <em>Paramètres → Marketplaces</em>, puis rechargez la
        page.
      </div>
    );
  }

  // Bloque le sélecteur tant que la traduction FR n'est pas terminée
  // (règle cliente 2026-08-24 — ne pas afficher un mélange EN/FR).
  if (!translationReady) {
    const pct = leaves.length > 0 ? Math.round((translatedCount / leaves.length) * 100) : 0;
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-10 px-6 rounded-xl border border-border bg-bg-secondary text-center">
        <svg className="w-8 h-8 animate-spin text-orange-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
          <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div>
          <p className="text-[14px] font-semibold text-text-primary">
            Traduction des catégories Orderchamp en cours…
          </p>
          <p className="text-[12px] text-text-secondary mt-1.5 leading-relaxed max-w-[380px]">
            Nous traduisons les {leaves.length} catégories Orderchamp en français
            pour vous. Cette étape ne se fait qu'une seule fois — laissez cette
            page ouverte, elle se rafraîchit toute seule.
          </p>
        </div>
        <div className="w-full max-w-[320px] flex flex-col gap-1.5">
          <div className="h-2 rounded-full bg-bg-tertiary overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-text-muted">
            {translatedCount} sur {leaves.length} traduites ({pct} %)
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="text-[11.5px] text-text-secondary hover:text-text-primary underline"
        >
          Rafraîchir maintenant
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Statut actuel */}
      {value ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-[11px] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Actuellement mappée sur
          </span>
          <span className="text-[13px] font-medium text-text-primary">
            {currentLabel ?? value}
          </span>
          {canClear && (
            <button
              type="button"
              onClick={() => handlePick(null)}
              disabled={disabled}
              className="ml-auto text-[11.5px] text-text-secondary hover:text-[#DC2626] disabled:opacity-50"
            >
              Effacer le mapping
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[12px] text-text-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Aucune catégorie Orderchamp mappée pour le moment.
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <svg
          aria-hidden="true"
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none z-[1]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5A6.5 6.5 0 1110.5 4a6.5 6.5 0 016.5 6.5z" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="field-input w-full text-sm"
          style={{ paddingLeft: "2.5rem", paddingRight: query ? "2.25rem" : undefined }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Effacer la recherche"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
          >
            ×
          </button>
        )}
      </div>

      {/* Résultats */}
      <div className="max-h-[380px] overflow-y-auto rounded-xl border border-border bg-bg-primary shadow-[var(--shadow-sm)]">
        {query.trim() ? (
          <SearchResults
            leaves={searchResults}
            value={value}
            disabled={disabled}
            onPick={handlePick}
            total={leaves.length}
          />
        ) : (
          <CascadeTree nodes={tree} value={value} disabled={disabled} onPick={handlePick} />
        )}
      </div>

      {pending && (
        <p className="text-[11.5px] text-text-secondary inline-flex items-center gap-1.5">
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Enregistrement…
        </p>
      )}
    </div>
  );
}

function SearchResults({
  leaves,
  value,
  disabled,
  onPick,
  total,
}: {
  leaves: OrderchampCategoryLeaf[];
  value: string | null;
  disabled: boolean;
  onPick: (path: string | null) => void;
  total: number;
}) {
  if (leaves.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-[12.5px] text-text-muted">
        Aucun résultat parmi {total} catégories. Essayez un autre mot
        (ex : « bracelet », « bague »).
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {leaves.map((l) => {
        const isCurrent = l.path === value;
        const path = localizedOrderchampDisplayPath(l);
        return (
          <li key={l.path}>
            <button
              type="button"
              onClick={() => onPick(l.path)}
              disabled={disabled}
              className={`w-full text-left px-4 py-2.5 hover:bg-bg-secondary transition-colors disabled:opacity-50 ${
                isCurrent ? "bg-emerald-50/50" : ""
              }`}
            >
              <span className="text-[12.5px] text-text-primary font-medium">
                {path[path.length - 1]}
              </span>
              <span className="block text-[11px] text-text-muted mt-0.5">
                {path.slice(0, -1).join(" › ") || "Racine"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CascadeTree({
  nodes,
  value,
  disabled,
  onPick,
}: {
  nodes: OrderchampCategoryTreeNode[];
  value: string | null;
  disabled: boolean;
  onPick: (path: string | null) => void;
}) {
  return (
    <ul className="py-1">
      {nodes.map((n) => (
        <CascadeNode key={n.key} node={n} value={value} disabled={disabled} onPick={onPick} depth={0} />
      ))}
    </ul>
  );
}

function CascadeNode({
  node,
  value,
  disabled,
  onPick,
  depth,
}: {
  node: OrderchampCategoryTreeNode;
  value: string | null;
  disabled: boolean;
  onPick: (path: string | null) => void;
  depth: number;
}) {
  const hasChildren = node.children.length > 0;
  const isCurrentLeaf = !!node.leaf && node.leaf.path === value;
  const paddingLeft = 12 + depth * 16;
  if (!hasChildren && node.leaf) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onPick(node.leaf!.path)}
          disabled={disabled}
          className={`w-full text-left py-1.5 text-[12.5px] hover:bg-bg-secondary transition-colors disabled:opacity-50 ${
            isCurrentLeaf ? "bg-emerald-50/50 text-emerald-700 font-semibold" : "text-text-primary"
          }`}
          style={{ paddingLeft, paddingRight: 12 }}
        >
          {node.label}
        </button>
      </li>
    );
  }
  return (
    <li>
      <details className="group">
        <summary
          className="cursor-pointer select-none py-1.5 flex items-center gap-1.5 hover:bg-bg-secondary transition-colors text-[12.5px] text-text-secondary"
          style={{ paddingLeft, paddingRight: 12 }}
        >
          <svg
            className="w-3 h-3 shrink-0 transition-transform group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-text-primary">{node.label}</span>
          {node.leaf && (
            <span className="ml-auto text-[10px] text-text-muted italic">peut être sélectionnée</span>
          )}
        </summary>
        {node.leaf && (
          <button
            type="button"
            onClick={() => onPick(node.leaf!.path)}
            disabled={disabled}
            className={`w-full text-left py-1.5 text-[12px] hover:bg-bg-secondary transition-colors disabled:opacity-50 italic ${
              value === node.leaf.path ? "bg-emerald-50/50 text-emerald-700 font-semibold" : "text-text-secondary"
            }`}
            style={{ paddingLeft: paddingLeft + 20, paddingRight: 12 }}
          >
            Choisir « {node.label} » (branche parente)
          </button>
        )}
        <ul>
          {node.children.map((child) => (
            <CascadeNode
              key={child.key}
              node={child}
              value={value}
              disabled={disabled}
              onPick={onPick}
              depth={depth + 1}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}
