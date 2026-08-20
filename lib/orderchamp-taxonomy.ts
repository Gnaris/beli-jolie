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
 *
 * ⚠️ Types et helpers purs déplacés dans `orderchamp-taxonomy-shared.ts` pour
 * pouvoir être importés depuis un composant client sans tirer prisma / next
 * headers via `tenantScopedCacheWithTid`.
 */

import { orderchampGraphQL } from "@/lib/orderchamp-client";
import { tenantScopedCacheWithTid } from "@/lib/cached-data";
import type { OrderchampCategoryNode } from "@/lib/orderchamp-taxonomy-shared";

export type { OrderchampCategoryNode } from "@/lib/orderchamp-taxonomy-shared";
export {
  filterLeavesOnly,
  getChildrenOf,
  findByPath,
} from "@/lib/orderchamp-taxonomy-shared";

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
