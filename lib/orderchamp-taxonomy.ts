/**
 * Orderchamp Taxonomy — server-only : récupère la liste des feuilles de
 * catégorie standard (`ProductCategoryPath` GraphQL enum) via introspection,
 * avec cache in-memory 24 h.
 *
 * Les helpers purs (build tree, search, label) et les types sont dans
 * `lib/orderchamp-taxonomy-shared.ts` — safe à importer depuis un Client
 * Component. Ce fichier-ci embarque prisma/logger/client GraphQL et ne doit
 * jamais être importé d'un composant client.
 *
 * Pourquoi cache in-memory et pas `unstable_cache` (Next 16) :
 *   1. `unstable_cache` casse l'AsyncLocalStorage — le callback tournait sans
 *      tenant, donc `getOrderchampApiKey()` retournait null même quand un
 *      token était bien posé côté BJ → cache poisonné à `[]` pour 24 h.
 *   2. On ne veut pas cacher un résultat vide (retry au prochain call si
 *      l'appel a foiré). `unstable_cache` cache tout, y compris `[]`.
 *   3. La taxonomie OC est identique pour tous les tenants (enum du schéma
 *      GraphQL global) → un cache process partagé est correct.
 */

import { orderchampGraphQL, OrderchampGraphQLError } from "@/lib/orderchamp-client";
import { logger } from "@/lib/logger";
import type { OrderchampCategoryLeaf } from "@/lib/orderchamp-taxonomy-shared";

// Re-exports pour compatibilité — permet d'importer depuis `orderchamp-taxonomy`
// côté serveur sans devoir jongler entre 2 fichiers. Les Client Components,
// eux, doivent importer directement depuis `orderchamp-taxonomy-shared`.
export type {
  OrderchampCategoryLeaf,
  OrderchampCategoryTreeNode,
} from "@/lib/orderchamp-taxonomy-shared";
export {
  buildOrderchampCategoryTree,
  searchOrderchampCategoryLeaves,
  getOrderchampCategoryLabel,
} from "@/lib/orderchamp-taxonomy-shared";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

// Cache in-memory global (process-level). Partagé entre tenants (l'enum
// GraphQL est identique). Reset au restart PM2.
let cache: { data: OrderchampCategoryLeaf[]; expiresAt: number } | null = null;
let inflight: Promise<OrderchampCategoryLeaf[]> | null = null;

/** Vide le cache. Utile après (re)configuration d'un token OC pour forcer
 *  un fetch propre sans devoir attendre 24 h ou redémarrer PM2. */
export function clearOrderchampTaxonomyCache(): void {
  cache = null;
  inflight = null;
}

/** Renvoie la liste des feuilles OC. Cache in-memory 24 h. Un résultat vide
 *  n'est PAS caché — le prochain appel refera la requête (utile si le token
 *  n'était pas encore posé au 1er appel). */
export async function getCachedOrderchampTaxonomy(): Promise<OrderchampCategoryLeaf[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now && cache.data.length > 0) {
    return cache.data;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await fetchOrderchampTaxonomyRaw();
      if (data.length > 0) {
        cache = { data, expiresAt: Date.now() + ONE_DAY_MS };
      } else {
        cache = null;
      }
      return data;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
