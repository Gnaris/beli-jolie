/**
 * Orderchamp Taxonomy Shared — types + helpers purs, safe à importer depuis
 * un Client Component. Aucun import serveur (pas de prisma, pas de logger,
 * pas de `orderchamp-client`). Le fetch + cache 24 h vit dans
 * `lib/orderchamp-taxonomy.ts` (server-only).
 */

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
