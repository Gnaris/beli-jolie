/**
 * Orderchamp Taxonomy — pull des 1 382 catégories marketplace + cache 24h.
 *
 * Query GraphQL : `categories { id name path depth translations { fr { name } } }`.
 * Renvoie l'arbre complet à plat (chaque node a son `path` enum + `depth` +
 * les traductions dans 8 langues, dont FR utilisé côté admin BJ).
 *
 * ⚠️ 2 enums différents chez Orderchamp :
 *  - `CategoryPath` (1 639 valeurs) : accepté à l'input (product.category)
 *  - `ProductCategoryPath` (1 382 valeurs) : les FEUILLES uniquement
 *
 * Le back-office UI n'affiche le champ « Catégorie de marché » que si on lui
 * envoie une valeur qui existe aussi dans `ProductCategoryPath` (les feuilles).
 * Donc côté UI admin BJ, le sélecteur ne doit permettre de choisir que des
 * feuilles — ce module expose `filterLeavesOnly()` pour ça.
 */

import { orderchampGraphQL } from "@/lib/orderchamp-client";
import { tenantScopedCacheWithTid } from "@/lib/cached-data";

export interface OrderchampCategoryNode {
  /** ID GraphQL Base64 côté OC. */
  id: string;
  /** Enum path (ex "JEWELRY_ACCESSORIES_BRACELETS_BANGLE_BRACELETS"). */
  path: string;
  /** Nom en anglais. */
  name: string;
  /** Profondeur dans l'arbre (0 = racine). */
  depth: number;
  /** Nom traduit en français si dispo, sinon fallback anglais. */
  nameFr: string;
}

const TAXONOMY_QUERY = /* GraphQL */ `
  query Taxonomy {
    categories {
      id
      path
      name
      depth
      translations {
        fr {
          name
        }
      }
    }
  }
`;

interface RawCategory {
  id: string;
  path: string;
  name: string;
  depth: number;
  translations?: { fr?: { name?: string } | null } | null;
}

async function fetchOrderchampTaxonomy(): Promise<OrderchampCategoryNode[]> {
  const data = await orderchampGraphQL<{ categories: RawCategory[] }>(
    TAXONOMY_QUERY,
    undefined,
    "taxonomy",
  );
  return data.categories.map((c) => ({
    id: c.id,
    path: c.path,
    name: c.name,
    depth: c.depth,
    nameFr: c.translations?.fr?.name?.trim() || c.name,
  }));
}

/**
 * Cache tenant-scopé 24h. La taxonomie change très rarement côté Orderchamp,
 * refetch peu coûteux via bouton « Rafraîchir taxonomie » dans les Paramètres.
 */
export const getCachedOrderchampTaxonomy = tenantScopedCacheWithTid(
  "orderchamp-taxonomy",
  async () => fetchOrderchampTaxonomy(),
  ["orderchamp-taxonomy"],
  { revalidate: 86_400, tags: ["orderchamp-taxonomy"] },
);

/**
 * Retourne uniquement les feuilles de l'arbre (nodes qui n'ont pas d'enfant).
 * Utilisé par le sélecteur admin pour forcer une catégorie feuille (règle OC).
 */
export function filterLeavesOnly(all: OrderchampCategoryNode[]): OrderchampCategoryNode[] {
  const parentPaths = new Set<string>();
  for (const c of all) {
    // Le parent d'un node X_Y_Z est X_Y. On enregistre chaque préfixe possible.
    const segments = c.path.split("_");
    for (let i = 1; i < segments.length; i++) {
      parentPaths.add(segments.slice(0, i).join("_"));
    }
  }
  return all.filter((c) => !parentPaths.has(c.path));
}

/**
 * Récupère les enfants directs d'un node parent (pour un dropdown en cascade).
 * Passer `null` pour obtenir les racines.
 */
export function getChildrenOf(
  all: OrderchampCategoryNode[],
  parentPath: string | null,
): OrderchampCategoryNode[] {
  if (parentPath === null) {
    return all.filter((c) => c.depth === 0);
  }
  const targetDepth = parentPath.split("_").length; // parent depth + 1
  return all.filter(
    (c) => c.depth === targetDepth && c.path.startsWith(`${parentPath}_`),
  );
}

/**
 * Trouve un node par son enum path. Utilisé côté publish pour valider qu'un
 * `Category.orderchampCategoryId` mappé existe toujours dans la taxonomie.
 */
export function findByPath(
  all: OrderchampCategoryNode[],
  path: string,
): OrderchampCategoryNode | undefined {
  return all.find((c) => c.path === path);
}
