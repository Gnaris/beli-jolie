/**
 * Orderchamp Taxonomy Shared — types + helpers purs, safe à importer depuis
 * un Client Component. Aucun import serveur (pas de prisma, pas de logger,
 * pas de `orderchamp-client`). Le fetch + cache 24 h vit dans
 * `lib/orderchamp-taxonomy.ts` (server-only).
 */

/** Une catégorie OC — envoyable directement en `category` sur productCreate/Update. */
export interface OrderchampCategoryLeaf {
  /** Valeur brute de l'enum (ex `JEWELRY_ACCESSORIES_BRACELETS_BANGLE_BRACELETS`). */
  path: string;
  /** Segments prettifiés EN pour affichage cascade
   *  (ex `["Jewelry Accessories", "Bracelets", "Bangle Bracelets"]`). */
  displayPath: string[];
  /** Segments FR (traduction automatique via API PFS). `null` tant que la
   *  traduction n'est pas encore arrivée — le sélecteur retombe alors sur
   *  `displayPath` anglais. Rempli quelques secondes après le 1ᵉʳ chargement. */
  displayPathFr: string[] | null;
  /** `true` si feuille terminale (`ProductCategoryPath`, back-office OC
   *  affiche la « catégorie de marché »). `false` si regroupement (branche
   *  de `CategoryPath` uniquement) — dans ce cas la fiche acheteur peut
   *  afficher un champ « catégorie de marché » vide, cf. warning UI. */
  isLeaf: boolean;
  /** Description brute exposée par le schéma GraphQL (souvent null). */
  description: string | null;
}

/** Renvoie le path localisé (FR si dispo, EN sinon). */
export function localizedOrderchampDisplayPath(leaf: OrderchampCategoryLeaf): string[] {
  return leaf.displayPathFr ?? leaf.displayPath;
}

export interface OrderchampCategoryTreeNode {
  label: string;
  key: string;
  /** Feuille terminale — non-null uniquement sur les nœuds sélectionnables. */
  leaf: OrderchampCategoryLeaf | null;
  children: OrderchampCategoryTreeNode[];
}

/** Construit un arbre racine → branche → feuille à partir des feuilles plates.
 *  L'arbre est trié alphabétiquement (français) à chaque niveau. Utilise le
 *  path FR si dispo, sinon l'EN. */
export function buildOrderchampCategoryTree(
  leaves: readonly OrderchampCategoryLeaf[],
): OrderchampCategoryTreeNode[] {
  const roots: OrderchampCategoryTreeNode[] = [];
  const cache = new Map<string, OrderchampCategoryTreeNode>();
  for (const leaf of leaves) {
    const path = localizedOrderchampDisplayPath(leaf);
    let parent: OrderchampCategoryTreeNode | null = null;
    let cumulativeKey = "";
    path.forEach((segment, idx) => {
      cumulativeKey = cumulativeKey ? `${cumulativeKey} › ${segment}` : segment;
      let node = cache.get(cumulativeKey);
      if (!node) {
        node = { label: segment, key: cumulativeKey, leaf: null, children: [] };
        cache.set(cumulativeKey, node);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      if (idx === path.length - 1) node.leaf = leaf;
      parent = node;
    });
  }
  const sortRec = (nodes: OrderchampCategoryTreeNode[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label, "fr"));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** Recherche plein texte sur les feuilles (matche libellé prettifié FR + EN +
 *  valeur brute). Retourne toutes les feuilles si `query` est vide. */
export function searchOrderchampCategoryLeaves(
  leaves: readonly OrderchampCategoryLeaf[],
  query: string,
): OrderchampCategoryLeaf[] {
  const q = query.trim().toLowerCase();
  if (!q) return leaves.slice();
  return leaves.filter(
    (l) =>
      l.displayPath.join(" ").toLowerCase().includes(q) ||
      (l.displayPathFr?.join(" ").toLowerCase().includes(q) ?? false) ||
      l.path.toLowerCase().includes(q),
  );
}

/** Retourne le libellé humain d'une feuille par son `path` brut, ou `null`
 *  si le path n'est pas dans la taxonomie (obsolète / typo). FR si dispo. */
export function getOrderchampCategoryLabel(
  path: string,
  leaves: readonly OrderchampCategoryLeaf[],
): string | null {
  const match = leaves.find((l) => l.path === path);
  return match ? localizedOrderchampDisplayPath(match).join(" › ") : null;
}
