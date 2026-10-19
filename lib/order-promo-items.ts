/**
 * Détermine la portion ITEMS d'un code promo saisi au checkout.
 *
 * `Order.promoDiscount` stocke `appliedCode.totalSaved` = `itemsSaved + shippingSaved`.
 * Quand le code portait sur la livraison (scope SHIPPING), la remise est déjà
 * intégrée à `Order.carrierPrice` ; il ne faut PAS la re-déduire du HT items,
 * sinon le total chute d'un extra équivalent à la remise livraison.
 *
 * Les commandes historiques (avant snapshot `appliedPromotions`) tombent sur
 * le fallback « assume items scope » qui couvre 99 % des cas réels.
 */
export function getPromoItemsDiscount(order: {
  promoDiscount: unknown;
  appliedPromotions?: unknown;
}): number {
  const total = Number(order.promoDiscount ?? 0);
  if (!Number.isFinite(total) || total <= 0) return 0;

  const snapshot = Array.isArray(order.appliedPromotions)
    ? (order.appliedPromotions as Array<{ kind?: unknown; scope?: unknown }>)
    : null;
  if (!snapshot) return total;

  const codeEntry = snapshot.find((p) => p?.kind === "CODE");
  if (codeEntry && codeEntry.scope === "SHIPPING") return 0;
  return total;
}
