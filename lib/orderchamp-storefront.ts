/**
 * Résolution du storefrontId Orderchamp du tenant courant.
 *
 * Chaque compte fournisseur OC a **une** storefront (vitrine marque). L'ID est
 * nécessaire à `productPublish(input: { id, storefrontId })` pour publier sur
 * la bonne vitrine — sans lui, la publication tombe sur un défaut aléatoire.
 *
 * On cache l'ID par tenant pour éviter de rappeler `storefronts()` à chaque
 * publication. Cache invalidé si l'API retourne « storefront not found ».
 */

import { orderchampGraphQL } from "@/lib/orderchamp-client";
import { STOREFRONTS_QUERY } from "@/lib/orderchamp-queries";
import { logger } from "@/lib/logger";

// Cache mémoire par tenant — perdu au restart PM2, refetch alors gratuit
// (query légère, une seule vitrine renvoyée).
const cache = new Map<string, string>();

export function primeOrderchampStorefrontId(tenantId: string, id: string): void {
  cache.set(tenantId, id);
}

export function clearOrderchampStorefrontCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/**
 * Récupère l'ID de la première storefront du compte. Cache par tenant.
 * Retourne null si aucune storefront (compte pas encore validé côté OC).
 */
export async function getOrderchampStorefrontId(tenantId: string): Promise<string | null> {
  const cached = cache.get(tenantId);
  if (cached) return cached;

  try {
    const data = await orderchampGraphQL<{
      storefronts: { edges: Array<{ node: { id: string; name: string; slug: string } }> };
    }>(STOREFRONTS_QUERY, { first: 5 }, "storefronts");
    const first = data.storefronts.edges[0]?.node;
    if (!first) {
      logger.warn("[Orderchamp Storefront] Aucune storefront active", { tenantId });
      return null;
    }
    cache.set(tenantId, first.id);
    logger.info("[Orderchamp Storefront] Résolue", {
      tenantId,
      storefrontId: first.id,
      slug: first.slug,
      name: first.name,
    });
    return first.id;
  } catch (err) {
    logger.error("[Orderchamp Storefront] Échec lookup", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
