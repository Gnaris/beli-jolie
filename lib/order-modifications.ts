/**
 * Fonctions pures pour les modifications de commande.
 * Isolées de Prisma pour être testables unitairement.
 */

import { roundCent } from "@/lib/money";

export interface ItemState {
  originalQuantity: number;
  originalUnitPrice: number;
  newQuantity: number;
  newUnitPrice: number;
}

/**
 * Calcule la différence de prix induite par une modification d'article
 * (quantité et/ou prix). Positif = avoir dû au client.
 */
export function computePriceDifference(s: ItemState): number {
  const originalLine = s.originalQuantity * s.originalUnitPrice;
  const newLine = s.newQuantity * s.newUnitPrice;
  return originalLine - newLine;
}

/**
 * Calcule la balance d'une commande modifiée vs le montant déjà encaissé.
 * `remainingToPay` > 0 → la cliente doit émettre un complément à régler.
 * `creditToRefund` > 0 → la boutique doit émettre un avoir.
 * (Les deux sont mutuellement exclusifs, sauf arrondi 1 ct.)
 */
export function computeOrderBalance(args: {
  subtotalHT: number;
  tvaRate: number;
  carrierPrice: number;
  paidTotalTTC: number;
}): { newTotalTTC: number; remainingToPay: number; creditToRefund: number } {
  const tva = roundCent((args.subtotalHT + args.carrierPrice) * args.tvaRate);
  const newTotalTTC = roundCent(args.subtotalHT + args.carrierPrice + tva);
  return {
    newTotalTTC,
    remainingToPay: Math.max(0, roundCent(newTotalTTC - args.paidTotalTTC)),
    creditToRefund: Math.max(0, roundCent(args.paidTotalTTC - newTotalTTC)),
  };
}
