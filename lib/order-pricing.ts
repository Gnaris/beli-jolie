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
import { roundCent } from "@/lib/money";
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

// Alias historique — les callers de ce fichier utilisent encore `floorMoney`.
// Depuis 2026-09-01 c'est en réalité un arrondi au centime le plus proche
// (règle Sage), plus un arrondi vers le bas. Voir lib/money.ts.
const floorMoney = roundCent;

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

  // Depuis 2026-09-23, le code promo ciblant les items n'est plus incorporé
  // ligne à ligne : il devient une remise globale unique, arrondie au centime
  // le plus proche (roundCent), appliquée sur le sous-total après remise
  // commerciale client. Cela aligne le calcul sur Sage 50 (Remise globale
  // sur le brut) : sans ce changement, la troncature ligne par ligne du
  // moteur créait un mini-écart (ex : 931,96 × 10 % → 93,31 côté BJ vs
  // 93,20 côté Sage) qui empêchait la facture BJ et Sage de tomber pareil.
  const itemsCodePromo = appliedCodePromo?.scope !== "SHIPPING" ? appliedCodePromo : null;
  const shippingCodePromo = appliedCodePromo?.scope === "SHIPPING" ? appliedCodePromo : null;

  // ── 1. Applicabilité de la remise commerciale client ───────────────
  const totalItemQuantity = input.items.reduce((s, i) => s + i.quantity, 0);

  const subtotalBrutHT = computeSubtotalBrut(input.items);
  // Sous-total post-promos AUTO uniquement — le code promo est appliqué
  // globalement après (voir étape 3.bis ci-dessous).
  const subtotalHT = computeSubtotalWithPromos(input.items, activePromos, null);

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
  // La remise commerciale client et le code promo global n'entrent pas ici —
  // seul le prix "post-promos AUTO" est incorporé dans chaque OrderItem.
  const itemFinalPrices: OrderPricingResult["itemFinalPrices"] = new Map();
  for (const item of input.items) {
    const resolved = resolveBestItemDiscount(item.promoContext, activePromos, null);
    itemFinalPrices.set(item.id, {
      finalUnitPrice: resolved.finalUnitPrice,
      savedPerUnit: resolved.savedPerUnit,
      promotionId: resolved.promotion?.id ?? null,
      promotionName: resolved.promotion?.name ?? null,
      source: resolved.source,
    });
  }

  // ── 3. Remise commerciale client — arrondi Sage ─────────────────────
  // Sage 50 (facture FA10005485) : Remise = round(base × taux), puis
  // Net HT = base − Remise (pas de re-arrondi). Sur 258.50 −5 % : remise
  // 12.93, net 245.57 → TTC 294.68 (idem Sage).
  let clientDiscountAmt = 0;
  let subtotalAfterClient = roundCent(subtotalHT);
  if (clientDiscountApplies && user.discountType && user.discountValue != null) {
    if (user.discountType === "PERCENT") {
      clientDiscountAmt = Math.max(0, roundCent(subtotalHT * (user.discountValue / 100)));
      clientDiscountAmt = Math.min(clientDiscountAmt, subtotalHT);
    } else {
      clientDiscountAmt = Math.min(subtotalHT, user.discountValue);
    }
    subtotalAfterClient = Math.max(0, roundCent(subtotalHT - clientDiscountAmt));
  }

  // ── 3bis. Code promo global (scope items) — Remise unique arrondi Sage ──
  // Appliqué APRÈS la remise commerciale, sur (subtotalHT − clientDiscountAmt).
  // Cet ordre est celui affiché dans le récap panier et le PDF facture.
  // Le montant final tombe pareil que Sage 50 (Remise globale sur le brut −
  // 10 % → 93,20 € sur 931,96 €), quel que soit le détail des lignes.
  let promoCodeItemsSaved = 0;
  if (itemsCodePromo && subtotalAfterClient > 0.005) {
    if (itemsCodePromo.discountKind === "PERCENTAGE") {
      promoCodeItemsSaved = Math.max(
        0,
        roundCent(subtotalAfterClient * (itemsCodePromo.discountValue / 100)),
      );
    } else if (itemsCodePromo.discountKind === "FIXED_AMOUNT") {
      promoCodeItemsSaved = Math.min(itemsCodePromo.discountValue, subtotalAfterClient);
    }
    promoCodeItemsSaved = Math.min(promoCodeItemsSaved, subtotalAfterClient);
  }
  const subtotalAfterDiscount = Math.max(
    0,
    roundCent(subtotalAfterClient - promoCodeItemsSaved),
  );

  // ── 4. Cascade trace — affichage récap (promos items + remise client + code) ──
  const discountTrace: CascadeTraceLine[] = [];
  let running = subtotalBrutHT;

  // 4a. Meilleure gagne (remise manuelle produit + promos non-stackable) — 1 ligne agrégée
  const subtotalAfterNonStackable = computeSubtotalWithPromos(
    input.items,
    activePromos.filter((p) => !p.stackable),
    null,
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
  const cumulative: ActivePromotion[] = [];
  const nonStackList = activePromos.filter((p) => !p.stackable);

  for (const promo of stackablePromos) {
    cumulative.push(promo);
    const newSubtotal = computeSubtotalWithPromos(
      input.items,
      [...nonStackList, ...cumulative],
      null,
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

  // 4c. Remise commerciale client — après les promos catalogue
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

  // 4d. Code promo saisi (scope items) — toujours en dernier, remise unique
  if (promoCodeItemsSaved > 0.005 && itemsCodePromo) {
    const newSubtotal = Math.max(0, floorMoney(running - promoCodeItemsSaved));
    discountTrace.push({
      label: itemsCodePromo.code
        ? `Code promo (${itemsCodePromo.code})`
        : itemsCodePromo.name,
      kind: "promo",
      percent: itemsCodePromo.discountKind === "PERCENTAGE" ? itemsCodePromo.discountValue : undefined,
      amount: promoCodeItemsSaved,
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

  // ── 6. TVA — arrondi Sage (facture FA10005485) ─────────────────────
  // TVA = roundCent((base + port) × taux) — un seul arrondi sur la base
  // taxable arrondie. TTC = simple addition, jamais re-arrondi.
  // Les breakdowns tvaOnCart/tvaOnShipping restent indicatifs (peuvent
  // différer d'1 ct de la somme selon les arrondis).
  const tvaRate = resolveVatRate({
    countryCode: input.addressCountry,
    isPickup,
    vatExempt: user.vatExempt,
  });
  const tvaOnCart = roundCent(subtotalAfterDiscount * tvaRate);
  const tvaOnShipping = roundCent(shipping.finalPrice * tvaRate);
  const tvaAmount = roundCent((subtotalAfterDiscount + shipping.finalPrice) * tvaRate);
  const totalTTC = roundCent(subtotalAfterDiscount + shipping.finalPrice + tvaAmount);
  const totalTTCCents = Math.round(totalTTC * 100);

  // ── 7. Gain apporté par le code promo ──────────────────────────────
  // Scope SHIPPING : gain sur la livraison, calculé par le moteur shipping.
  // Scope items : montant global de la remise unique (étape 3bis).
  let promoCodeSaved = 0;
  if (appliedCodePromo) {
    if (appliedCodePromo.scope === "SHIPPING") {
      promoCodeSaved = shipping.promotion?.id === appliedCodePromo.id ? shipping.savedAmount : 0;
    } else {
      promoCodeSaved = promoCodeItemsSaved;
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
