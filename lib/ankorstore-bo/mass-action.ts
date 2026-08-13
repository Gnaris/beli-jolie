/**
 * Actions groupées enable/disable/archive.
 *
 * Endpoint unique : POST /api/me/brand/products/mass-action
 * Payload : { product_ids: number[], action: "enable" | "disable" | "archive" }
 * - enable  → 200 avec produits complets rafraîchis (active: true)
 * - disable → 200 avec produits (active: false)
 * - archive → 204 vide (soft-delete côté Ankor)
 *
 * 100% synchrone : plus de callback async à attendre.
 * Bulk natif : on peut passer 50 IDs d'un coup.
 */

import { boPostJson } from "./client";
import type { BoMassAction, BoProductSummary } from "./types";

interface MassActionResponse {
  data?: BoProductSummary[];
}

/**
 * Met en ligne un ou plusieurs produits. Retourne les produits à jour.
 */
export async function enableProducts(productIds: number[]): Promise<BoProductSummary[]> {
  if (productIds.length === 0) return [];
  const res = await boPostJson<MassActionResponse>("/api/me/brand/products/mass-action", {
    product_ids: productIds,
    action: "enable" satisfies BoMassAction,
  });
  return res.data ?? [];
}

/**
 * Met hors ligne un ou plusieurs produits. Retourne les produits à jour.
 */
export async function disableProducts(productIds: number[]): Promise<BoProductSummary[]> {
  if (productIds.length === 0) return [];
  const res = await boPostJson<MassActionResponse>("/api/me/brand/products/mass-action", {
    product_ids: productIds,
    action: "disable" satisfies BoMassAction,
  });
  return res.data ?? [];
}

/**
 * Archive (= soft-delete) un ou plusieurs produits. Réponse 204 vide.
 * L'ID reste probablement valide côté Ankor — un enable ultérieur pourrait restaurer.
 */
export async function archiveProducts(productIds: number[]): Promise<void> {
  if (productIds.length === 0) return;
  await boPostJson<void>("/api/me/brand/products/mass-action", {
    product_ids: productIds,
    action: "archive" satisfies BoMassAction,
  });
}
