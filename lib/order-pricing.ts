/**
 * Source unique de vérité pour le prix d'une commande côté serveur.
 * Utilisé par :
 *   - /api/payments/create-intent (montant Stripe à préparer)
 *   - app/actions/client/order::placeOrder (vérif finale + snapshot BDD)
 *
 * Assure que les deux endpoints calculent EXACTEMENT le même total (au
 * centime près, tolérance Stripe = 1 cent).
 *
 * Depuis 2026-08-18 : cumul « stackable » en cascade (ceilCent à chaque palier).
 * Depuis 2026-08-19 : expose `discountTrace` + `shippingTrace` pour l'affichage
 * ligne-à-ligne dans le récap panier/checkout.
 */

import "server-only";
import { resolveVatRate } from "@/lib/vat";
import {
  resolveBestItemDiscount,
  resolveBestShippingDiscount,
  ceilCent,
  type ActivePromotion,
  type ItemPromoContext,
  type ClientShippingDiscountForCumul,
} from "@/lib/promotion-engine";

interface UserPricingInput {
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
  discountMode: "PERMANENT" | "THRESHOLD" | "NEXT_ORDER" | null;
  discountMinAmount: number | null;
  discountMinQuantity: number | null;
  vatExempt: boolean;
  freeShipping: boolean;
  freeShippingMaxPrice: number | null;
  shippingDiscountType: "PERCENT" | "AMOUNT" | null;
  shippingDiscountValue: number | null;
  shippingDiscountMode: "PERMANENT" | "THRESHOLD" | "NEXT_ORDER" | null;
  shippingDiscountMinAmount: number | null;
  shippingDiscountMinQuantity: number | null;
}

interface CartItemInput {
  id: string;
  quantity: number;
  promoContext: ItemPromoContext;
}

interface OrderPricingInput {
  items: CartItemInput[];
  carrierId: string;
  carrierPrice: number;
  addressCountry: string;
  user: UserPricingInput;
  activePromos: ActivePromotion[];
  appliedCodePromo: ActivePromotion | null;
}

/** Ligne d'affichage de la cascade — une par réduction appliquée. */
export interface CascadeTraceLine {
  label: string;                                // « Soldes été », « Remise commerciale »…
  kind: "product" | "promo" | "client";
  percent?: number;                             // 10 pour -10 % (undefined pour FIXED_AMOUNT)
  amount: number;                               // € économisés sur cette ligne
  subtotalAfter: number;                        // sous-total après cette ligne
}

export interface OrderPricingResult {
  itemFinalPrices: Map<string, {
    finalUnitPrice: number;
    savedPerUnit: number;
    promotionId: string | null;
    promotionName: string | null;
    source: "none" | "product" | "promotion" | "stack";
  }>;
  /** Sous-total avant TOUTE réduction (vrai prix des articles × quantités). */
  subtotalBrutHT: number;
  /** Sous-total après promos items (avant remise commerciale client). */
  subtotalHT: number;
  clientDiscountAmt: number;
  /** subtotalHT - clientDiscountAmt. */
  subtotalAfterDiscount: number;
  /** Cascade détaillée pour affichage récap (promos + remise client). */
  discountTrace: CascadeTraceLine[];
  carrierPrice: number;
  effectiveCarrierPrice: number;
  shippingSaved: number;
  shippingIsFree: boolean;
  shippingPromotionId: string | null;
  /** Cascade livraison (promos livraison + remise livraison client). */
  shippingTrace: CascadeTraceLine[];
  tvaRate: number;
  /** TVA sur le sous-total articles (subtotalAfterDiscount). */
  tvaOnCart: number;
  /** TVA sur la livraison. */
  tvaOnShipping: number;
  tvaAmount: number;
  totalTTC: number;
  totalTTCCents: number;
  promoCodeSaved: number;
  /** Somme des promos AUTO par item (subtotalBrutHT - subtotalHT - promoCodeSaved). */
  promoAutoDiscount: number;
}

function floorMoney(n: number): number {
  return Math.floor(n * 100) / 100;
}

/**
 * Trace cascade pour affichage sur le panier — indépendante du transporteur.
 * Utilisée par /panier avant que le client choisisse son mode de livraison.
 */
export interface CartCascadeResult {
  subtotalBrutHT: number;
  subtotalHT: number;
  clientDiscountAmt: number;
  subtotalAfterDiscount: number;
  discountTrace: CascadeTraceLine[];
}

/**
 * Snapshot cascade panier — n'inclut ni livraison ni TVA. Utilisé pour le
 * récap affiché en amont du checkout.
 */
export function computeCartCascade(input: {
  items: CartItemInput[];
  user: Pick<UserPricingInput,
    | "discountType" | "discountValue" | "discountMode"
    | "discountMinAmount" | "discountMinQuantity">;
  activePromos: ActivePromotion[];
  appliedCodePromo: ActivePromotion | null;
}): CartCascadeResult {
  // Réutilise computeOrderPricing avec un transporteur factice à 0 pour ne
  // calculer que la partie panier. Champs livraison/TVA ignorés en sortie.
  const result = computeOrderPricing({
    items: input.items,
    carrierId: "pickup_store",
    carrierPrice: 0,
    addressCountry: "FR",
    user: {
      ...input.user,
      vatExempt: false,
      freeShipping: false,
      freeShippingMaxPrice: null,
      shippingDiscountType: null,
      shippingDiscountValue: null,
      shippingDiscountMode: null,
      shippingDiscountMinAmount: null,
      shippingDiscountMinQuantity: null,
    },
    activePromos: input.activePromos,
    appliedCodePromo: input.appliedCodePromo,
  });
  return {
    subtotalBrutHT: result.subtotalBrutHT,
    subtotalHT: result.subtotalHT,
    clientDiscountAmt: result.clientDiscountAmt,
    subtotalAfterDiscount: result.subtotalAfterDiscount,
    discountTrace: result.discountTrace,
  };
}

/** Somme des prix de vente bruts (avant toute réduction). Troncature stricte (pas d'arrondi). */
function computeSubtotalBrut(items: CartItemInput[]): number {
  let s = 0;
  for (const it of items) s += it.promoContext.unitPrice * it.quantity;
  return floorMoney(s);
}

/** Somme des prix résolus par le moteur avec une liste donnée de promos. Troncature stricte. */
function computeSubtotalWithPromos(
  items: CartItemInput[],
  activePromos: ActivePromotion[],
  code: ActivePromotion | null,
): number {
  let s = 0;
  for (const it of items) {
    const r = resolveBestItemDiscount(it.promoContext, activePromos, code);
    s += r.finalUnitPrice * it.quantity;
  }
  return floorMoney(s);
}

export function computeOrderPricing(input: OrderPricingInput): OrderPricingResult {
  const { user, activePromos, appliedCodePromo } = input;

  const itemsCodePromo = appliedCodePromo?.scope !== "SHIPPING" ? appliedCodePromo : null;
  const shippingCodePromo = appliedCodePromo?.scope === "SHIPPING" ? appliedCodePromo : null;

  // ── 1. Applicabilité de la remise commerciale client ───────────────
  const totalItemQuantity = input.items.reduce((s, i) => s + i.quantity, 0);

  const subtotalBrutHT = computeSubtotalBrut(input.items);
  const subtotalHT = computeSubtotalWithPromos(input.items, activePromos, itemsCodePromo);

  const clientDiscountApplies = (() => {
    if (!user.discountType || user.discountValue == null) return false;
    const mode = user.discountMode ?? "PERMANENT";
    if (mode === "THRESHOLD") {
      const minAmount = user.discountMinAmount ?? 0;
      const minQty = user.discountMinQuantity ?? 0;
      const amountOk = minAmount <= 0 || subtotalHT >= minAmount;
      const qtyOk = minQty <= 0 || totalItemQuantity >= minQty;
      return amountOk && qtyOk;
    }
    return true;
  })();

  // ── 2. Snapshot par item (pour OrderItem BDD) ──────────────────────
  // La remise commerciale client n'entre pas ici — elle est appliquée
  // exclusivement sur le total panier (étape 3).
  const itemFinalPrices: OrderPricingResult["itemFinalPrices"] = new Map();
  for (const item of input.items) {
    const resolved = resolveBestItemDiscount(item.promoContext, activePromos, itemsCodePromo);
    itemFinalPrices.set(item.id, {
      finalUnitPrice: resolved.finalUnitPrice,
      savedPerUnit: resolved.savedPerUnit,
      promotionId: resolved.promotion?.id ?? null,
      promotionName: resolved.promotion?.name ?? null,
      source: resolved.source,
    });
  }

  // ── 3. Remise commerciale client — appliquée UNE FOIS sur le sous-total ──
  // Pour PERCENT, on calcule le sous-total après remise d'abord (floor au
  // centime) puis on déduit le montant de remise à partir de la différence :
  // évite qu'un floor prématuré sur la remise (ex. 12.925 → 12.92) laisse
  // 1 ct de trop dans le sous-total et fasse dériver le total TTC.
  // Cas réel : 258.50 − 5 % → sous-total 245.57 (et non 245.58), total ×1.20
  // = 294.68 (et non 294.69). Facturation externe attend 245.57.
  let clientDiscountAmt = 0;
  let subtotalAfterDiscount = floorMoney(subtotalHT);
  if (clientDiscountApplies && user.discountType && user.discountValue != null) {
    if (user.discountType === "PERCENT") {
      subtotalAfterDiscount = Math.max(0, floorMoney(subtotalHT * (1 - user.discountValue / 100)));
      clientDiscountAmt = Math.max(0, floorMoney(subtotalHT - subtotalAfterDiscount));
    } else {
      clientDiscountAmt = Math.min(subtotalHT, user.discountValue);
      subtotalAfterDiscount = Math.max(0, floorMoney(subtotalHT - clientDiscountAmt));
    }
  }

  // ── 4. Cascade trace — affichage récap (promos items + remise client) ──
  const discountTrace: CascadeTraceLine[] = [];
  let running = subtotalBrutHT;

  // 4a. Meilleure gagne (remise manuelle produit + promos non-stackable) — 1 ligne agrégée
  const subtotalAfterNonStackable = computeSubtotalWithPromos(
    input.items,
    activePromos.filter((p) => !p.stackable),
    itemsCodePromo && !itemsCodePromo.stackable ? itemsCodePromo : null,
  );
  if (subtotalAfterNonStackable < running - 0.005) {
    const gain = floorMoney(running - subtotalAfterNonStackable);
    discountTrace.push({
      label: "Remises catalogue",
      kind: "product",
      amount: gain,
      subtotalAfter: subtotalAfterNonStackable,
    });
    running = subtotalAfterNonStackable;
  }

  // 4b. Chaque promo stackable, dans l'ordre, avec son gain cascade
  const stackablePromos = activePromos.filter((p) => p.type === "AUTO" && p.stackable);
  const stackableCode = itemsCodePromo?.stackable ? itemsCodePromo : null;
  const cumulative: ActivePromotion[] = [];
  const nonStackList = activePromos.filter((p) => !p.stackable);
  const nonStackCodeArg = itemsCodePromo && !itemsCodePromo.stackable ? itemsCodePromo : null;

  for (const promo of stackablePromos) {
    cumulative.push(promo);
    const newSubtotal = computeSubtotalWithPromos(
      input.items,
      [...nonStackList, ...cumulative],
      nonStackCodeArg,
    );
    if (newSubtotal < running - 0.005) {
      const gain = floorMoney(running - newSubtotal);
      discountTrace.push({
        label: promo.name,
        kind: "promo",
        percent: promo.discountKind === "PERCENTAGE" ? promo.discountValue : undefined,
        amount: gain,
        subtotalAfter: newSubtotal,
      });
      running = newSubtotal;
    }
  }
  if (stackableCode) {
    const newSubtotal = computeSubtotalWithPromos(
      input.items,
      [...nonStackList, ...cumulative],
      stackableCode,
    );
    if (newSubtotal < running - 0.005) {
      const gain = floorMoney(running - newSubtotal);
      discountTrace.push({
        label: stackableCode.name,
        kind: "promo",
        percent: stackableCode.discountKind === "PERCENTAGE" ? stackableCode.discountValue : undefined,
        amount: gain,
        subtotalAfter: newSubtotal,
      });
      running = newSubtotal;
    }
  }

  // 4c. Remise commerciale client — toujours en dernier
  if (clientDiscountAmt > 0.005) {
    const newSubtotal = Math.max(0, floorMoney(running - clientDiscountAmt));
    discountTrace.push({
      label: "Remise commerciale",
      kind: "client",
      percent: user.discountType === "PERCENT" && user.discountValue != null ? user.discountValue : undefined,
      amount: clientDiscountAmt,
      subtotalAfter: newSubtotal,
    });
    running = newSubtotal;
  }

  // ── 5. Livraison ───────────────────────────────────────────────────
  const isPrivateCarrier = input.carrierId === "private_carrier";
  const isPickup = input.carrierId === "pickup_store";

  const shippingDiscountApplies = (() => {
    if (!user.shippingDiscountType || user.shippingDiscountValue == null) return false;
    const mode = user.shippingDiscountMode ?? "PERMANENT";
    if (mode === "THRESHOLD") {
      const minAmount = user.shippingDiscountMinAmount ?? 0;
      const minQty = user.shippingDiscountMinQuantity ?? 0;
      const amountOk = minAmount <= 0 || subtotalHT >= minAmount;
      const qtyOk = minQty <= 0 || totalItemQuantity >= minQty;
      return amountOk && qtyOk;
    }
    return true;
  })();
  const freeShippingActive = user.freeShipping
    && (user.freeShippingMaxPrice == null || input.carrierPrice <= user.freeShippingMaxPrice);

  const userShipping: ClientShippingDiscountForCumul = {
    isFree: freeShippingActive,
    discountType: shippingDiscountApplies ? user.shippingDiscountType : null,
    discountValue: shippingDiscountApplies ? user.shippingDiscountValue : null,
  };

  const shipping = isPrivateCarrier
    ? {
        finalPrice: 0, savedAmount: input.carrierPrice, isFree: true,
        source: "none" as const, promotion: null, stacked: false, savedByUser: 0,
      }
    : resolveBestShippingDiscount(
        input.carrierPrice, activePromos, userShipping, shippingCodePromo,
      );

  // Trace livraison en cascade
  const shippingTrace: CascadeTraceLine[] = [];
  if (!isPrivateCarrier && input.carrierPrice > 0) {
    let shipRunning = input.carrierPrice;
    // Promos SHIPPING stackable une par une
    const shipStackables = activePromos.filter((p) => p.type === "AUTO" && p.stackable && p.scope === "SHIPPING");
    const shipStackableCode = shippingCodePromo?.stackable ? shippingCodePromo : null;
    let cumulativeShipPrice = input.carrierPrice;
    for (const promo of shipStackables) {
      const rate = promo.discountKind === "PERCENTAGE"
        ? promo.discountValue / 100
        : 0;
      let after: number;
      if (promo.discountKind === "PERCENTAGE") {
        after = Math.max(0, ceilCent(cumulativeShipPrice * (1 - rate)));
      } else {
        after = Math.max(0, ceilCent(cumulativeShipPrice - promo.discountValue));
      }
      const gain = floorMoney(cumulativeShipPrice - after);
      if (gain > 0.005) {
        shippingTrace.push({
          label: promo.name,
          kind: "promo",
          percent: promo.discountKind === "PERCENTAGE" ? promo.discountValue : undefined,
          amount: gain,
          subtotalAfter: after,
        });
        cumulativeShipPrice = after;
      }
    }
    if (shipStackableCode) {
      const rate = shipStackableCode.discountKind === "PERCENTAGE"
        ? shipStackableCode.discountValue / 100 : 0;
      const after = shipStackableCode.discountKind === "PERCENTAGE"
        ? Math.max(0, ceilCent(cumulativeShipPrice * (1 - rate)))
        : Math.max(0, ceilCent(cumulativeShipPrice - shipStackableCode.discountValue));
      const gain = floorMoney(cumulativeShipPrice - after);
      if (gain > 0.005) {
        shippingTrace.push({
          label: shipStackableCode.name,
          kind: "promo",
          percent: shipStackableCode.discountKind === "PERCENTAGE" ? shipStackableCode.discountValue : undefined,
          amount: gain,
          subtotalAfter: after,
        });
        cumulativeShipPrice = after;
      }
    }
    shipRunning = cumulativeShipPrice;

    // Remise commerciale livraison client — après les promos stackable
    if (freeShippingActive && shipRunning > 0.005) {
      shippingTrace.push({
        label: "Livraison offerte (avantage client)",
        kind: "client",
        percent: 100,
        amount: shipRunning,
        subtotalAfter: 0,
      });
    } else if (shippingDiscountApplies && user.shippingDiscountType && user.shippingDiscountValue != null) {
      const before = shipRunning;
      const after = user.shippingDiscountType === "PERCENT"
        ? Math.max(0, ceilCent(before * (1 - user.shippingDiscountValue / 100)))
        : Math.max(0, ceilCent(before - user.shippingDiscountValue));
      const gain = floorMoney(before - after);
      if (gain > 0.005) {
        shippingTrace.push({
          label: "Remise commerciale livraison",
          kind: "client",
          percent: user.shippingDiscountType === "PERCENT" ? user.shippingDiscountValue : undefined,
          amount: gain,
          subtotalAfter: after,
        });
      }
    }

    // Fallback : si aucune trace n'a été ajoutée mais qu'une promo non-cumulable a
    // gagné (source=promotion), on l'affiche en une ligne.
    if (shippingTrace.length === 0 && shipping.savedAmount > 0.005 && shipping.source === "promotion") {
      shippingTrace.push({
        label: shipping.promotion?.name ?? "Promotion livraison",
        kind: "promo",
        percent: shipping.promotion?.discountKind === "PERCENTAGE" ? shipping.promotion.discountValue : undefined,
        amount: shipping.savedAmount,
        subtotalAfter: shipping.finalPrice,
      });
    }
  }

  // ── 6. TVA — détaillée panier vs livraison ─────────────────────────
  const tvaRate = resolveVatRate({
    countryCode: input.addressCountry,
    isPickup,
    vatExempt: user.vatExempt,
  });
  const tvaOnCart = floorMoney(subtotalAfterDiscount * tvaRate);
  const tvaOnShipping = floorMoney(shipping.finalPrice * tvaRate);
  const tvaAmount = floorMoney((subtotalAfterDiscount + shipping.finalPrice) * tvaRate);
  const totalTTC = floorMoney(
    subtotalAfterDiscount + shipping.finalPrice + (subtotalAfterDiscount + shipping.finalPrice) * tvaRate,
  );
  const totalTTCCents = Math.floor(
    (subtotalAfterDiscount + shipping.finalPrice + (subtotalAfterDiscount + shipping.finalPrice) * tvaRate) * 100,
  );

  // ── 7. Gain apporté par le code promo ──────────────────────────────
  let promoCodeSaved = 0;
  if (appliedCodePromo) {
    if (appliedCodePromo.scope === "SHIPPING") {
      promoCodeSaved = shipping.promotion?.id === appliedCodePromo.id ? shipping.savedAmount : 0;
    } else {
      for (const item of input.items) {
        const withoutCode = resolveBestItemDiscount(item.promoContext, activePromos, null);
        const withCode = resolveBestItemDiscount(item.promoContext, activePromos, itemsCodePromo);
        promoCodeSaved += (withoutCode.finalUnitPrice - withCode.finalUnitPrice) * item.quantity;
      }
    }
  }

  return {
    itemFinalPrices,
    subtotalBrutHT,
    subtotalHT,
    clientDiscountAmt,
    subtotalAfterDiscount,
    discountTrace,
    carrierPrice: input.carrierPrice,
    effectiveCarrierPrice: shipping.finalPrice,
    shippingSaved: shipping.savedAmount,
    shippingIsFree: shipping.isFree,
    shippingPromotionId: shipping.promotion?.id ?? null,
    shippingTrace,
    tvaRate,
    tvaOnCart,
    tvaOnShipping,
    tvaAmount,
    totalTTC,
    totalTTCCents,
    promoCodeSaved: floorMoney(promoCodeSaved),
    promoAutoDiscount: Math.max(0, floorMoney(subtotalBrutHT - subtotalHT - floorMoney(promoCodeSaved))),
  };
}
