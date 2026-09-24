/**
 * Calcul du prix réellement payé par unité pour un article signalé dans une
 * demande service client. Retourne aussi la remise unitaire cumulée (€ + %)
 * et le total remboursable pour la quantité signalée.
 *
 * Sources de remise agrégées :
 *   1. Product `discountPercent` + promotions AUTO ligne à ligne → déjà bakées
 *      dans `OrderItem.unitPrice` (et donc dans `lineTotal`) au moment de la
 *      commande. Le prix « avant remise » est retrouvé via `variantSnapshot`.
 *   2. Remise ligne admin post-facto (`OrderItem.lineDiscountAmt`) — soustraite
 *      directement au `lineTotal` de la ligne.
 *   3. Remise commerciale client (`Order.clientDiscountAmt`) — appliquée sur le
 *      sous-total, réparti au prorata du `lineTotal` de chaque ligne dans le
 *      `discountableSubtotal` (les lignes de compensation n'y participent pas).
 *   4. Code promo global (`Order.promoDiscount`) — réparti au prorata comme (3)
 *      depuis 2026-09-23 (avant : baké ligne à ligne).
 */

interface OrderItemInput {
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  lineDiscountAmt: number | null;
  isCompensation: boolean;
  variantSnapshot: string | null;
}

interface OrderContext {
  /** Somme des lineTotal des lignes NON-compensation. Base du prorata. */
  discountableSubtotal: number;
  /** Remise commerciale client (Order.clientDiscountAmt). */
  clientDiscountAmt: number;
  /** Remise code promo global (Order.promoDiscount, depuis 2026-09-23). */
  promoDiscount: number;
}

export interface ClaimItemPricing {
  /** Prix unitaire avant TOUTE remise (source : variantSnapshot). */
  originalUnitPrice: number;
  /** Prix unitaire effectivement payé après TOUTES remises réparties au prorata. */
  paidUnitPrice: number;
  /** Montant de remise unitaire cumulée (originalUnitPrice - paidUnitPrice). */
  discountUnitAmt: number;
  /** Pourcentage de remise unitaire cumulée. */
  discountUnitPct: number;
  /** Montant remboursable = paidUnitPrice × claimQty. */
  refundableAmount: number;
}

export function computeClaimItemPricing(
  item: OrderItemInput,
  ctx: OrderContext,
  claimQty: number,
): ClaimItemPricing {
  // Prix de départ (avant TOUTE remise) : on lit le snapshot posé au checkout.
  // Fallback = unitPrice courant si le snapshot est manquant (vieilles commandes).
  let originalUnitPrice = item.unitPrice;
  if (item.variantSnapshot) {
    try {
      const snap = JSON.parse(item.variantSnapshot) as { unitPriceOriginal?: number };
      if (typeof snap.unitPriceOriginal === "number" && snap.unitPriceOriginal > 0) {
        originalUnitPrice = snap.unitPriceOriginal;
      }
    } catch {
      /* JSON cassé — on garde le fallback */
    }
  }

  // IMPORTANT : `lineTotal` en base est déjà NET après `lineDiscountAmt` (cf.
  // `app/actions/admin/orders.ts:842` — convention `lineTotal = grossLine -
  // lineDiscountAmt`). Il ne faut PAS re-soustraire le line discount ici.
  const netAfterLineDisc = item.lineTotal;

  // Part de remise globale (client + code promo) attribuée à cette ligne
  // au prorata du lineTotal dans discountableSubtotal. Compensation exclue :
  // ces lignes n'entrent pas dans la base de calcul de la remise client.
  let orderLevelShare = 0;
  if (!item.isCompensation && ctx.discountableSubtotal > 0) {
    const shareRatio = netAfterLineDisc / ctx.discountableSubtotal;
    orderLevelShare = (ctx.clientDiscountAmt + ctx.promoDiscount) * shareRatio;
  }

  const netLine = Math.max(0, netAfterLineDisc - orderLevelShare);
  const paidUnitPrice = item.quantity > 0 ? netLine / item.quantity : 0;

  const discountUnitAmt = Math.max(0, originalUnitPrice - paidUnitPrice);
  const discountUnitPct = originalUnitPrice > 0 ? (discountUnitAmt / originalUnitPrice) * 100 : 0;

  return {
    originalUnitPrice,
    paidUnitPrice,
    discountUnitAmt,
    discountUnitPct,
    refundableAmount: paidUnitPrice * claimQty,
  };
}
