/**
 * Orderchamp Taxonomy — récupère la liste des feuilles de catégorie standard
 * (`ProductCategoryPath` GraphQL enum) via introspection, avec cache 24 h.
 *
 * Utilisation :
 *   - UI mapping catégories (sélecteur cascade → recherche par libellé).
 *   - Résolution au publish (validation : la valeur mappée existe-t-elle
 *     encore ? Sinon warning).
 *
 * Le cache est global (l'enum GraphQL est identique pour tous les tenants).
 * Il faut néanmoins des credentials OC valides côté tenant courant au 1er
 * appel — sinon la query échoue et on retourne une liste vide (log erreur).
 */

import { unstable_cache } from "next/cache";
import { orderchampGraphQL, OrderchampGraphQLError } from "@/lib/orderchamp-client";
import { logger } from "@/lib/logger";

const ONE_DAY_SECONDS = 24 * 60 * 60;

/** Une feuille de catégorie OC — envoyable directement en `category` sur
 *  productCreate/Update. */
export interface OrderchampCategoryLeaf {
  /** Valeur brute de l'enum (ex `JEWELRY_ACCESSORIES_BRACELETS_BANGLE_BRACELETS`). */
  path: string;
  /** Segments prettifiés pour affichage cascade
   *  (ex `["Jewelry Accessories", "Bracelets", "Bangle Bracelets"]`). */
  displayPath: string[];
  /** Description brute exposée par le schéma GraphQL (souvent null). */
  description: string | null;
}

const INTROSPECT_QUERY = /* GraphQL */ `
  query IntrospectProductCategoryPath {
    __type(name: "ProductCategoryPath") {
      enumValues {
        name
        description
      }
    }
  }
`;

/** "BANGLE_BRACELETS" → "Bangle Bracelets" */
function prettifySegment(segment: string): string {
  const lower = segment.toLowerCase().replace(/_/g, " ");
  return lower.replace(/(^|\s)([a-z])/g, (_, sep, ch) => `${sep}${ch.toUpperCase()}`);
}

/** Décompose un nom d'enum en segments pour l'UI cascade. Si la description
 *  GraphQL contient déjà un chemin structuré avec un séparateur usuel, on
 *  privilégie la version humaine — sinon on splitte par "_". */
function toDisplayPath(rawName: string, description: string | null): string[] {
  if (description) {
    const parts = description
      .split(/[›>»]|\s\/\s|\s>\s/g)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts;
  }
  return rawName.split("_").map(prettifySegment);
}

async function fetchOrderchampTaxonomyRaw(): Promise<OrderchampCategoryLeaf[]> {
  try {
    const data = await orderchampGraphQL<{
      __type: { enumValues: Array<{ name: string; description: string | null }> } | null;
    }>(INTROSPECT_QUERY, {}, "introspectProductCategoryPath");

    const values = data.__type?.enumValues ?? [];
    return values
      .map<OrderchampCategoryLeaf>((v) => ({
        path: v.name,
        displayPath: toDisplayPath(v.name, v.description),
        description: v.description,
      }))
      .sort((a, b) =>
        a.displayPath.join(" ").localeCompare(b.displayPath.join(" "), "en"),
      );
  } catch (err) {
    if (err instanceof OrderchampGraphQLError) {
      logger.error("[Orderchamp Taxonomy] introspection GraphQL a échoué", {
        errors: err.errors,
      });
    } else {
      logger.error("[Orderchamp Taxonomy] fetch a échoué", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return [];
  }
}

const cachedFetch = unstable_cache(
  fetchOrderchampTaxonomyRaw,
  ["orderchamp-taxonomy-v1"],
  { revalidate: ONE_DAY_SECONDS, tags: ["orderchamp-taxonomy"] },
);

/** Renvoie la liste des feuilles OC. Cache 24 h — tag `orderchamp-taxonomy`. */
export async function getCachedOrderchampTaxonomy(): Promise<OrderchampCategoryLeaf[]> {
  try {
    return await cachedFetch();
  } catch (err) {
    // Hors contexte Next (script tsx, worker sans request scope) —
    // unstable_cache jette « incrementalCache missing ». Fallback direct.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("incrementalCache") || msg.includes("unstable_cache")) {
      return fetchOrderchampTaxonomyRaw();
    }
    throw err;
  }
}

export interface OrderchampCategoryTreeNode {
  label: string;
  key: string;
  /** Feuille terminale — non-null uniquement sur les nœuds sélectionnables. */
  leaf: OrderchampCategoryLeaf | null;
  children: OrderchampCategoryTreeNode[];
}

/** Construit un arbre racine → branche → feuille à partir des feuilles plates.
 *  L'arbre est trié alphabétiquement à chaque niveau. */
export function buildOrderchampCategoryTree(
  leaves: readonly OrderchampCategoryLeaf[],
): OrderchampCategoryTreeNode[] {
  const roots: OrderchampCategoryTreeNode[] = [];
  const cache = new Map<string, OrderchampCategoryTreeNode>();
  for (const leaf of leaves) {
    let parent: OrderchampCategoryTreeNode | null = null;
    let cumulativeKey = "";
    leaf.displayPath.forEach((segment, idx) => {
      cumulativeKey = cumulativeKey ? `${cumulativeKey} › ${segment}` : segment;
      let node = cache.get(cumulativeKey);
      if (!node) {
        node = { label: segment, key: cumulativeKey, leaf: null, children: [] };
        cache.set(cumulativeKey, node);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      if (idx === leaf.displayPath.length - 1) node.leaf = leaf;
      parent = node;
    });
  }
  const sortRec = (nodes: OrderchampCategoryTreeNode[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label, "en"));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** Recherche plein texte sur les feuilles (matche libellé prettifié + valeur
 *  brute). Retourne toutes les feuilles si `query` est vide. */
export function searchOrderchampCategoryLeaves(
  leaves: readonly OrderchampCategoryLeaf[],
  query: string,
): OrderchampCategoryLeaf[] {
  const q = query.trim().toLowerCase();
  if (!q) return leaves.slice();
  return leaves.filter(
    (l) =>
      l.displayPath.join(" ").toLowerCase().includes(q) ||
      l.path.toLowerCase().includes(q),
  );
}

/** Retourne le libellé humain d'une feuille par son `path` brut, ou `null`
 *  si le path n'est pas dans la taxonomie (obsolète / typo). */
export function getOrderchampCategoryLabel(
  path: string,
  leaves: readonly OrderchampCategoryLeaf[],
): string | null {
  const match = leaves.find((l) => l.path === path);
  return match ? match.displayPath.join(" › ") : null;
}
