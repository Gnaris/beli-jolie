/**
 * Source unique de vérité pour le prix d'une commande côté serveur.
 * Utilisé par :
 *   - /api/payments/create-intent (montant Stripe à préparer)
 *   - app/actions/client/order::placeOrder (vérif finale + snapshot BDD)
 *
 * Assure que les deux endpoints calculent EXACTEMENT le même total (au
 * centime près, tolérance Stripe = 1 cent).
 */

import "server-only";
import { resolveVatRate } from "@/lib/vat";
import {
  resolveBestItemDiscount,
  resolveBestShippingDiscount,
  type ActivePromotion,
  type ItemPromoContext,
} from "@/lib/promotion-engine";

interface UserPricingInput {
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
  discountMode: "PERMANENT" | "THRESHOLD" | "NEXT_ORDER" | null;
  discountMinAmount: number | null;
  discountMinQuantity: number | null;
  vatExempt: boolean;
  freeShipping: boolean;
  shippingDiscountType: "PERCENT" | "AMOUNT" | null;
  shippingDiscountValue: number | null;
  shippingDiscountMode: "PERMANENT" | "THRESHOLD" | "NEXT_ORDER" | null;
  shippingDiscountMinAmount: number | null;
  shippingDiscountMinQuantity: number | null;
}

interface CartItemInput {
  id: string;
  quantity: number;
  promoContext: ItemPromoContext; // unitPrice = base BDD, productDiscountPercent = remise manuelle
}

interface OrderPricingInput {
  items: CartItemInput[];
  carrierId: string;
  carrierPrice: number;
  addressCountry: string;
  user: UserPricingInput;
  activePromos: ActivePromotion[];
  /** Code promo déjà validé (résolu par validatePromoCode). */
  appliedCodePromo: ActivePromotion | null;
}

export interface OrderPricingResult {
  itemFinalPrices: Map<string, {
    finalUnitPrice: number;
    savedPerUnit: number;
    promotionId: string | null;
    promotionName: string | null;
    source: "none" | "product" | "promotion";
  }>;
  subtotalHT: number;               // après promos items (avant remise perso client)
  clientDiscountAmt: number;        // remise perso client (avantage commercial)
  subtotalAfterDiscount: number;    // subtotalHT − clientDiscountAmt
  carrierPrice: number;             // input (référence)
  effectiveCarrierPrice: number;    // après meilleure remise livraison
  shippingSaved: number;
  shippingIsFree: boolean;
  shippingPromotionId: string | null;
  tvaRate: number;
  tvaAmount: number;
  totalTTC: number;
  totalTTCCents: number;
  promoCodeSaved: number;           // gain apporté par le code promo (0 si aucun)
}

function floorMoney(n: number): number {
  return Math.floor(n * 100) / 100;
}

export function computeOrderPricing(input: OrderPricingInput): OrderPricingResult {
  const { user, activePromos, appliedCodePromo } = input;

  // 1. Prix items — meilleure remise (produit manuel vs AUTO vs code)
  const itemFinalPrices = new Map<string, {
    finalUnitPrice: number;
    savedPerUnit: number;
    promotionId: string | null;
    promotionName: string | null;
    source: "none" | "product" | "promotion";
  }>();

  let subtotalHT = 0;
  for (const item of input.items) {
    const resolved = resolveBestItemDiscount(
      item.promoContext,
      activePromos,
      appliedCodePromo?.scope !== "SHIPPING" ? appliedCodePromo : null,
    );
    itemFinalPrices.set(item.id, {
      finalUnitPrice: resolved.finalUnitPrice,
      savedPerUnit: resolved.savedPerUnit,
      promotionId: resolved.promotion?.id ?? null,
      promotionName: resolved.promotion?.name ?? null,
      source: resolved.source,
    });
    subtotalHT += resolved.finalUnitPrice * item.quantity;
  }

  // 2. Remise commerciale perso client
  const totalItemQuantity = input.items.reduce((s, i) => s + i.quantity, 0);
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
  const clientDiscountAmt = (() => {
    if (!clientDiscountApplies || !user.discountType || user.discountValue == null) return 0;
    if (user.discountType === "PERCENT") {
      return Math.min(subtotalHT, subtotalHT * (user.discountValue / 100));
    }
    return Math.min(subtotalHT, user.discountValue);
  })();
  const subtotalAfterDiscount = subtotalHT - clientDiscountAmt;

  // 3. Prix livraison — meilleure remise (user perso vs promo AUTO SHIPPING vs code SHIPPING)
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
  const userShippingSaved = (() => {
    if (user.freeShipping) return input.carrierPrice;
    if (shippingDiscountApplies && user.shippingDiscountType && user.shippingDiscountValue != null) {
      if (user.shippingDiscountType === "PERCENT") {
        return Math.min(input.carrierPrice, input.carrierPrice * (user.shippingDiscountValue / 100));
      }
      return Math.min(input.carrierPrice, user.shippingDiscountValue);
    }
    return 0;
  })();

  const shipping = isPrivateCarrier
    ? { finalPrice: 0, savedAmount: input.carrierPrice, isFree: true, source: "none" as const, promotion: null }
    : resolveBestShippingDiscount(
        input.carrierPrice,
        activePromos,
        { isFree: user.freeShipping, savedAmount: userShippingSaved },
        appliedCodePromo?.scope === "SHIPPING" ? appliedCodePromo : null,
      );

  // 4. TVA
  const tvaRate = resolveVatRate({
    countryCode: input.addressCountry,
    isPickup,
    vatExempt: user.vatExempt,
  });
  const tvaAmount = floorMoney((subtotalAfterDiscount + shipping.finalPrice) * tvaRate);
  const totalTTC = floorMoney(
    subtotalAfterDiscount + shipping.finalPrice + (subtotalAfterDiscount + shipping.finalPrice) * tvaRate,
  );

  const totalTTCCents = Math.floor(
    (subtotalAfterDiscount + shipping.finalPrice + (subtotalAfterDiscount + shipping.finalPrice) * tvaRate) * 100,
  );

  // Gain apporté par le code promo (sur items + shipping)
  let promoCodeSaved = 0;
  if (appliedCodePromo) {
    if (appliedCodePromo.scope === "SHIPPING") {
      promoCodeSaved = shipping.promotion?.id === appliedCodePromo.id ? shipping.savedAmount : 0;
    } else {
      // Recalcul sans code pour mesurer le gain net
      for (const item of input.items) {
        const withoutCode = resolveBestItemDiscount(item.promoContext, activePromos, null);
        const cur = itemFinalPrices.get(item.id)!;
        promoCodeSaved += (withoutCode.finalUnitPrice - cur.finalUnitPrice) * item.quantity;
      }
    }
  }

  return {
    itemFinalPrices,
    subtotalHT,
    clientDiscountAmt,
    subtotalAfterDiscount,
    carrierPrice: input.carrierPrice,
    effectiveCarrierPrice: shipping.finalPrice,
    shippingSaved: shipping.savedAmount,
    shippingIsFree: shipping.isFree,
    shippingPromotionId: shipping.promotion?.id ?? null,
    tvaRate,
    tvaAmount,
    totalTTC,
    totalTTCCents,
    promoCodeSaved: Math.round(promoCodeSaved * 100) / 100,
  };
}
