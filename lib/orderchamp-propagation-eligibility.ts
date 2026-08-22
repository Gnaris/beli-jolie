/**
 * Éligibilité d'un produit à une propagation vers Orderchamp.
 *
 * Comme Microstore, Orderchamp est upsert-style : `orderchampUpdateProduct`
 * retombe automatiquement sur `orderchampPublishProduct` quand
 * `orderchampProductId` est absent. Un produit n'a donc pas besoin d'être
 * déjà lié à OC pour figurer dans la modale « Propager les modifications ».
 *
 * Contraintes :
 *   - `orderchampEnabled` produit (toggle par produit, défaut true) : OFF =
 *     la cliente a explicitement exclu ce produit d'OC.
 *   - `!isIncomplete` : sans ça un premier push créerait une fiche vide chez OC.
 */

export interface OrderchampPropagationInput {
  orderchampEnabled?: boolean;
  isIncomplete: boolean;
}

export function isOrderchampPropagationEligible(
  p: OrderchampPropagationInput,
): boolean {
  return !!p.orderchampEnabled && !p.isIncomplete;
}
