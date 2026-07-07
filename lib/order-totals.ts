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
  /** Lignes de la commande après modification. `lineTotal` = qty × unitPrice. */
  items: { lineTotal: number | string | { toNumber?: () => number } }[];
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
  const preDiscountSubtotal = input.items.reduce(
    (sum, item) => sum + toNumber(item.lineTotal),
    0,
  );

  let clientDiscountAmt = 0;
  const discountValue = toNumber(input.clientDiscountValue);
  if (input.clientDiscountType && discountValue > 0) {
    if (input.clientDiscountType === "PERCENT") {
      clientDiscountAmt = preDiscountSubtotal * (discountValue / 100);
    } else {
      // AMOUNT : remise fixe en euros
      clientDiscountAmt = discountValue;
    }
    // La remise ne peut jamais dépasser le sous-total (commande à 0 max).
    clientDiscountAmt = Math.min(preDiscountSubtotal, clientDiscountAmt);
    if (clientDiscountAmt < 0) clientDiscountAmt = 0;
  }

  const subtotalHT = Math.max(0, preDiscountSubtotal - clientDiscountAmt);
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
