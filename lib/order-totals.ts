/**
 * Recalcul des totaux d'une commande après modification d'articles (admin).
 *
 * Centralisé ici parce que les server actions `modifyOrderItems`,
 * `revertOrderItemModification` et `revertAllOrderItemModifications` faisaient
 * tous les trois le même calcul, qui oubliait de réappliquer la remise
 * commerciale du client (cf. AUDIT 2026-05-29 — point [4]).
 *
 * 2026-09-01 : bascule vers l'arrondi Sage 50 (roundCent, cf. lib/money.ts).
 * L'ancien `floorMoney` créait 1 centime d'écart chronique par facture.
 *
 * Fonction pure pour pouvoir être testée sans Prisma.
 */

import { roundCent } from "@/lib/money";

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
  /** Somme des lineTotal AVANT remise commerciale (= subtotalBrutHT recalculé). */
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
 * @deprecated Utiliser `roundCent` de `lib/money.ts` (arrondi Sage au plus
 * proche). Conservé provisoirement pour les callers historiques qui ne sont
 * pas encore migrés. À supprimer une fois tous les imports basculés.
 */
export const floorMoney = roundCent;

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
  const preDiscountSubtotal = roundCent(discountableSubtotal + compensationSubtotal);

  // Remise commerciale = round(base × taux) puis Net = base − remise.
  // Aligné sur Sage 50 (facture FA10005485) : Sage arrondit la remise au
  // centime le plus proche, pas le sous-total après remise.
  let clientDiscountAmt = 0;
  let discountedBase = discountableSubtotal;
  const discountValue = toNumber(input.clientDiscountValue);
  if (input.clientDiscountType && discountValue > 0) {
    if (input.clientDiscountType === "PERCENT") {
      clientDiscountAmt = roundCent(discountableSubtotal * (discountValue / 100));
      clientDiscountAmt = Math.min(clientDiscountAmt, discountableSubtotal);
      discountedBase = roundCent(discountableSubtotal - clientDiscountAmt);
    } else {
      clientDiscountAmt = Math.min(discountableSubtotal, discountValue);
      discountedBase = roundCent(discountableSubtotal - clientDiscountAmt);
    }
  }

  const subtotalHT = Math.max(0, roundCent(discountedBase + compensationSubtotal));
  const carrierPriceNum = toNumber(input.carrierPrice);
  // TVA sur (subtotalHT + livraison) — art. 267 CGI, le port suit le régime
  // TVA des biens. Un seul arrondi : la TVA est calculée sur la base taxable
  // arrondie, puis le TTC est l'addition simple (Net HT + livraison + TVA)
  // sans re-arrondi. Reproduit exactement le calcul de Sage 50.
  const tvaAmount = roundCent((subtotalHT + carrierPriceNum) * input.tvaRate);
  const totalTTC = roundCent(subtotalHT + carrierPriceNum + tvaAmount);

  return {
    preDiscountSubtotal,
    clientDiscountAmt,
    subtotalHT,
    tvaAmount,
    totalTTC,
  };
}
