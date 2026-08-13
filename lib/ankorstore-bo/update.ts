/**
 * Mise à jour d'un produit Ankorstore existant.
 *
 * Reversé depuis PUT /api/me/brand/products/{id}.
 * IMPORTANT : c'est un remplacement TOTAL (pas un PATCH). Le payload doit
 * contenir tous les champs, comme à la création.
 *
 * Convention côté BJ :
 * 1. `readProductById(id)` pour connaître l'état actuel (surtout les images
 *    au format `/products/images/{pid}-{hash}.jpg` à préserver).
 * 2. Reconstruction du payload complet en fusionnant :
 *    - Existant conservé (paths `/products/images/…`)
 *    - Nouveau uploadé (paths `file-upload:<key>`)
 * 3. `updateProduct(id, payload)` → PUT.
 * 4. `readProductById(id)` post-PUT pour vérifier que les images de variantes
 *    ne sont pas revenues null (bug Ankor connu, cf. images.ts).
 */

import { boPutJson } from "./client";
import type { BoProductPayload, BoProductSummary } from "./types";

interface UpdateResponse {
  data: BoProductSummary;
}

/**
 * PUT /api/me/brand/products/{id}.
 * Retourne le produit à jour (avec les nouveaux variants[].id si Ankor a
 * recréé les variantes en interne).
 */
export async function updateProduct(
  productId: number,
  payload: BoProductPayload
): Promise<BoProductSummary> {
  const res = await boPutJson<UpdateResponse>(`/api/me/brand/products/${productId}`, payload);
  if (!res.data?.id) {
    throw new Error(`Ankorstore : PUT products/${productId} n'a pas renvoyé data.id`);
  }
  return res.data;
}
