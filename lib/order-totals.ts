/**
 * Recalcul des totaux d'une commande après modification d'articles (admin).
 *
 * Centralisé ici parce que les server actions `modifyOrderItems`,
 * `revertOrderItemModification` et `revertAllOrderItemModifications` faisaient
 * tous les trois le même calcul, qui oubliait de réappliquer la remise
 * commerciale du client (cf. AUDIT 2026-05-29 — point [4]).
 *
 * Fonction pure pour pouvoir être testée sans Prisma.
 */

export type ClientDiscountType = "PERCENT" | "AMOUNT" | null;

export interface OrderTotalsInput {
  /**
   * Lignes de la commande après modification. `lineTotal` = qty × unitPrice.
   * `isCompensation` = article ajouté après-coup par l'admin, avec un prix qu'elle
   * a saisi manuellement (déjà « remisé » côté UX). Ces lignes ne rentrent PAS
   * dans la base de calcul de la remise client — sinon la remise s'applique
   * deux fois (une par l'admin qui baisse le prix, une par le moteur).
   */
  items: {
    lineTotal: number | string | { toNumber?: () => number };
    isCompensation?: boolean;
  }[];
  tvaRate: number; // ex 0.20
  carrierPrice: number | string | { toNumber?: () => number };
  clientDiscountType: ClientDiscountType;
  clientDiscountValue: number | string | { toNumber?: () => number } | null;
}

export interface OrderTotalsResult {
  /** Somme des lineTotal AVANT remise commerciale. */
  preDiscountSubtotal: number;
  /** Montant de la remise commerciale appliquée (>= 0, plafonné au sous-total). */
  clientDiscountAmt: number;
  /** Sous-total HT après remise (ce qui est stocké dans `Order.subtotalHT`). */
  subtotalHT: number;
  tvaAmount: number;
  totalTTC: number;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && "toNumber" in (value as object)) {
    const fn = (value as { toNumber?: unknown }).toNumber;
    if (typeof fn === "function") return Number((fn as () => number).call(value));
  }
  return Number(value);
}

/**
 * Arrondit un montant vers le bas (floor) au centime.
 * Choix comptable : notre logiciel de facturation externe arrondit aussi vers
 * le bas, donc on aligne totalTTC/tvaAmount pour éviter les écarts de 1 ct.
 */
export function floorMoney(value: number): number {
  return Math.floor(value * 100) / 100;
}

export function recomputeOrderTotals(input: OrderTotalsInput): OrderTotalsResult {
  // Sépare les lignes « d'origine » (soumises à la remise) des lignes ajoutées
  // par l'admin (compensation) — cf. commentaire sur OrderTotalsInput.items.
  let discountableSubtotal = 0;
  let compensationSubtotal = 0;
  for (const item of input.items) {
    const line = toNumber(item.lineTotal);
    if (item.isCompensation) compensationSubtotal += line;
    else discountableSubtotal += line;
  }
  const preDiscountSubtotal = discountableSubtotal + compensationSubtotal;

  let clientDiscountAmt = 0;
  const discountValue = toNumber(input.clientDiscountValue);
  if (input.clientDiscountType && discountValue > 0) {
    if (input.clientDiscountType === "PERCENT") {
      clientDiscountAmt = discountableSubtotal * (discountValue / 100);
    } else {
      // AMOUNT : remise fixe en euros
      clientDiscountAmt = discountValue;
    }
    // La remise ne peut jamais dépasser la base remisable (commande à 0 max).
    clientDiscountAmt = Math.min(discountableSubtotal, clientDiscountAmt);
    if (clientDiscountAmt < 0) clientDiscountAmt = 0;
  }

  const subtotalHT = Math.max(
    0,
    discountableSubtotal - clientDiscountAmt + compensationSubtotal,
  );
  const carrierPriceNum = toNumber(input.carrierPrice);
  // TVA appliquée aussi sur les frais de port (art. 267 CGI :
  // le port suit le même régime TVA que les biens vendus).
  // Total et TVA arrondis vers le bas au centime pour rester alignés avec
  // le logiciel de facturation externe (voir floorMoney).
  const tvaAmount = floorMoney((subtotalHT + carrierPriceNum) * input.tvaRate);
  const totalTTC = floorMoney(subtotalHT + carrierPriceNum + (subtotalHT + carrierPriceNum) * input.tvaRate);

  return {
    preDiscountSubtotal,
    clientDiscountAmt,
    subtotalHT,
    tvaAmount,
    totalTTC,
  };
}
