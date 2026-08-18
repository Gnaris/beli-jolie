/**
 * Calcul cascade LIVRAISON côté client — respecte le flag `stackable` :
 *   - Cluster stackable = toutes les promos SHIPPING `stackable` en cascade
 *     PUIS la remise commerciale livraison du client par-dessus.
 *   - Meilleure non-cumulable = pour chaque promo SHIPPING non-stackable,
 *     on garde celle qui apporte le PLUS gros gain seule (pas de client cumul).
 *   - Résultat final = max(gain cluster, gain meilleure non-cumulable).
 *
 * Utilise `ceilCent` de promotion-engine à chaque palier pour rester cohérent
 * avec le calcul serveur (`resolveBestShippingDiscount` + order-pricing).
 */

import { ceilCent } from "@/lib/promotion-engine";

export interface ShippingPromoInput {
  id: string;
  name: string;
  discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
  discountValue: number;
  stackable: boolean;
}

export interface ShippingCascadeLine {
  label: string;
  kind: "promo" | "client";
  percent?: number;
  amount: number;
  subtotalAfter: number;
}

export interface ShippingCascadeResult {
  /** Prix carrier final après toutes les réductions. */
  finalPrice: number;
  /** Économie totale (carrierPrice - finalPrice). */
  totalSaved: number;
  /** Vrai si le prix final ≈ 0. */
  isFree: boolean;
  /** Trace ligne par ligne pour affichage récap. */
  trace: ShippingCascadeLine[];
  /** Vrai si le résultat vient du cluster stackable (client compris). */
  usedStack: boolean;
}

export function computeShippingCascade(input: {
  carrierPrice: number;
  shippingPromos: ShippingPromoInput[];
  /** True si le client a la livraison offerte (freeShipping=100%) sous le plafond. */
  freeShippingActive: boolean;
  clientShippingDiscountType: "PERCENT" | "AMOUNT" | null;
  clientShippingDiscountValue: number | null;
}): ShippingCascadeResult {
  const carrier = input.carrierPrice;
  if (carrier <= 0) {
    return { finalPrice: 0, totalSaved: 0, isFree: true, trace: [], usedStack: false };
  }

  const promos = input.shippingPromos;

  // ─── 1. Cluster stackable ──────────────────────────────────────
  const stackTrace: ShippingCascadeLine[] = [];
  let stackPrice = carrier;
  for (const p of promos) {
    if (!p.stackable) continue;
    const before = stackPrice;
    let after = before;
    if (p.discountKind === "FREE_SHIPPING") {
      after = 0;
    } else if (p.discountKind === "PERCENTAGE") {
      after = Math.max(0, ceilCent(before * (1 - p.discountValue / 100)));
    } else {
      after = Math.max(0, ceilCent(before - p.discountValue));
    }
    const gain = Math.round((before - after) * 100) / 100;
    if (gain > 0.005) {
      stackTrace.push({
        label: p.name,
        kind: "promo",
        percent: p.discountKind === "PERCENTAGE" || p.discountKind === "FREE_SHIPPING"
          ? (p.discountKind === "FREE_SHIPPING" ? 100 : p.discountValue)
          : undefined,
        amount: gain,
        subtotalAfter: after,
      });
      stackPrice = after;
    }
  }
  // Remise commerciale livraison client → toujours cumulée avec le cluster
  if (input.freeShippingActive && stackPrice > 0.005) {
    stackTrace.push({
      label: "Livraison offerte (avantage client)",
      kind: "client",
      percent: 100,
      amount: stackPrice,
      subtotalAfter: 0,
    });
    stackPrice = 0;
  } else if (
    !input.freeShippingActive
    && input.clientShippingDiscountType
    && input.clientShippingDiscountValue != null
    && input.clientShippingDiscountValue > 0
    && stackPrice > 0.005
  ) {
    const before = stackPrice;
    const after = input.clientShippingDiscountType === "PERCENT"
      ? Math.max(0, ceilCent(before * (1 - input.clientShippingDiscountValue / 100)))
      : Math.max(0, ceilCent(before - input.clientShippingDiscountValue));
    const gain = Math.round((before - after) * 100) / 100;
    if (gain > 0.005) {
      stackTrace.push({
        label: "Remise commerciale livraison",
        kind: "client",
        percent: input.clientShippingDiscountType === "PERCENT"
          ? input.clientShippingDiscountValue : undefined,
        amount: gain,
        subtotalAfter: after,
      });
      stackPrice = after;
    }
  }
  const stackGain = Math.round((carrier - stackPrice) * 100) / 100;

  // ─── 2. Meilleure promo non-cumulable seule ────────────────────
  let bestSoloGain = 0;
  let bestSoloPromo: ShippingPromoInput | null = null;
  let bestSoloAfter = carrier;
  for (const p of promos) {
    if (p.stackable) continue;
    let after: number;
    if (p.discountKind === "FREE_SHIPPING") {
      after = 0;
    } else if (p.discountKind === "PERCENTAGE") {
      after = Math.max(0, ceilCent(carrier * (1 - p.discountValue / 100)));
    } else {
      after = Math.max(0, ceilCent(carrier - p.discountValue));
    }
    const gain = Math.round((carrier - after) * 100) / 100;
    if (gain > bestSoloGain) {
      bestSoloGain = gain;
      bestSoloPromo = p;
      bestSoloAfter = after;
    }
  }

  // ─── 3. Choix final ────────────────────────────────────────────
  if (stackGain >= bestSoloGain) {
    return {
      finalPrice: stackPrice,
      totalSaved: stackGain,
      isFree: stackPrice <= 0.005,
      trace: stackTrace,
      usedStack: true,
    };
  }
  // Non-cumulable gagne : une seule ligne dans la trace, remise client ignorée.
  const trace: ShippingCascadeLine[] = bestSoloPromo
    ? [{
        label: bestSoloPromo.name,
        kind: "promo",
        percent: bestSoloPromo.discountKind === "PERCENTAGE"
          ? bestSoloPromo.discountValue
          : bestSoloPromo.discountKind === "FREE_SHIPPING" ? 100 : undefined,
        amount: bestSoloGain,
        subtotalAfter: bestSoloAfter,
      }]
    : [];
  return {
    finalPrice: bestSoloAfter,
    totalSaved: bestSoloGain,
    isFree: bestSoloAfter <= 0.005,
    trace,
    usedStack: false,
  };
}
