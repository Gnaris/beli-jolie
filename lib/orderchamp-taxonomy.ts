/**
 * Orderchamp Taxonomy — server-only : récupère la liste des feuilles de
 * catégorie standard (`ProductCategoryPath` GraphQL enum) via introspection,
 * avec cache 24 h.
 *
 * Les helpers purs (build tree, search, label) et les types sont dans
 * `lib/orderchamp-taxonomy-shared.ts` — safe à importer depuis un Client
 * Component. Ce fichier-ci embarque prisma/logger/client GraphQL et ne doit
 * jamais être importé d'un composant client (sinon Turbopack bundle prisma
 * côté navigateur).
 *
 * Utilisation :
 *   - Page serveur `app/(admin)/admin/categories/page.tsx` → charge les
 *     feuilles + les passe au client via props.
 *   - `resolveOrderchampCategoryForProduct` — pas d'usage direct ici (le
 *     path est lu depuis la BDD, pas depuis la taxonomie live).
 */

import { unstable_cache } from "next/cache";
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

const ONE_DAY_SECONDS = 24 * 60 * 60;

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
