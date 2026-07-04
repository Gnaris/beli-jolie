/**
 * Fonctions pures pour les modifications de commande.
 * Isolées de Prisma pour être testables unitairement.
 */

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
 * Simule le nouveau total TTC de la commande et vérifie qu'il ne dépasse pas
 * le montant payé par le client. Renvoie null si OK, un message d'erreur sinon.
 */
export function checkOverpayment(
  newSubtotalHT: number,
  tvaRate: number,
  carrierPrice: number,
  paidAmount: number,
  tolerance = 0.01,
): string | null {
  const newTotalTTC = newSubtotalHT * (1 + tvaRate) + carrierPrice;
  if (newTotalTTC > paidAmount + tolerance) {
    const fmtEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";
    return `Modification refusée : le nouveau total (${fmtEur(newTotalTTC)}) dépasserait le montant payé (${fmtEur(paidAmount)}).`;
  }
  return null;
}
