"use server";

/**
 * Server action UNIQUE de calcul de pricing pour le panier.
 * Le panier client appelle cette action au lieu de recalculer localement,
 * ce qui garantit que le total affiché = le total en commande = ce que Stripe encaisse.
 *
 * Source de vérité : computeOrderPricing (lib/order-pricing.ts).
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeOrderPricing } from "@/lib/order-pricing";
import { loadActivePromotions, validatePromoCode } from "@/lib/promotions";
import { buildCartPromoContexts } from "@/lib/promotion-cart-context";
import { logger } from "@/lib/logger";

export interface CartPricingInput {
  carrierId: string;
  carrierPrice: number;
  addressCountry: string | null;
  promoCode?: string | null;
}

export interface CartPricingResult {
  success: true;
  subtotalBrutHT: number;
  subtotalHT: number;
  clientDiscountAmt: number;
  promoAutoDiscount: number;
  promoCodeSaved: number;
  subtotalAfterDiscount: number;
  effectiveCarrierPrice: number;
  shippingIsFree: boolean;
  tvaRate: number;
  tvaOnCart: number;
  tvaOnShipping: number;
  tvaAmount: number;
  totalTTC: number;
  totalTTCCents: number;
  appliedCodePromo: { code: string; name: string; totalSaved: number } | null;
  codeError?: string;
}

export interface CartPricingError {
  success: false;
  error: string;
}

export async function computeCartCheckoutPricing(
  input: CartPricingInput,
): Promise<CartPricingResult | CartPricingError> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return { success: false, error: "Non authentifié." };

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        discountType: true,
        discountValue: true,
        discountMode: true,
        discountMinAmount: true,
        discountMinQuantity: true,
        vatExempt: true,
        freeShipping: true,
        freeShippingMaxPrice: true,
        shippingDiscountType: true,
        shippingDiscountValue: true,
        shippingDiscountMode: true,
        shippingDiscountMinAmount: true,
        shippingDiscountMinQuantity: true,
      },
    });
    if (!user) return { success: false, error: "Utilisateur introuvable." };

    const cart = await prisma.cart.findFirst({
      where: { userId },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: { include: { category: true } },
                color: true,
                variantSizes: { include: { size: true } },
                packLines: { include: { color: true, sizes: { include: { size: true } } } },
              },
            },
          },
        },
      },
    });
    if (!cart || cart.items.length === 0) {
      return { success: false, error: "Panier vide." };
    }

    const [activePromos, promoContexts] = await Promise.all([
      loadActivePromotions(),
      buildCartPromoContexts(cart.items),
    ]);

    const pricingItems = cart.items
      .map((i) => {
        const c = promoContexts.get(i.id);
        if (!c) return null;
        return { id: i.id, quantity: i.quantity, promoContext: c.context };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    const userPricingInput = {
      discountType: user.discountType ?? null,
      discountValue: user.discountValue != null ? Number(user.discountValue) : null,
      discountMode: user.discountMode ?? "PERMANENT",
      discountMinAmount: user.discountMinAmount != null ? Number(user.discountMinAmount) : null,
      discountMinQuantity: user.discountMinQuantity ?? null,
      vatExempt: user.vatExempt,
      freeShipping: user.freeShipping,
      freeShippingMaxPrice: user.freeShippingMaxPrice != null ? Number(user.freeShippingMaxPrice) : null,
      shippingDiscountType: user.shippingDiscountType ?? null,
      shippingDiscountValue: user.shippingDiscountValue != null ? Number(user.shippingDiscountValue) : null,
      shippingDiscountMode: user.shippingDiscountMode ?? "PERMANENT",
      shippingDiscountMinAmount: user.shippingDiscountMinAmount != null ? Number(user.shippingDiscountMinAmount) : null,
      shippingDiscountMinQuantity: user.shippingDiscountMinQuantity ?? null,
    };

    let appliedCode: { code: string; name: string; totalSaved: number; promotionId: string; scope: string } | null = null;
    let codeError: string | undefined;

    if (input.promoCode && input.promoCode.trim()) {
      const preCodePricing = computeOrderPricing({
        items: pricingItems,
        carrierId: input.carrierId,
        carrierPrice: input.carrierPrice,
        addressCountry: input.addressCountry ?? "FR",
        user: userPricingInput,
        activePromos,
        appliedCodePromo: null,
      });
      const contextItems = pricingItems.map((i) => ({ ...i.promoContext, quantity: i.quantity }));
      const check = await validatePromoCode(
        input.promoCode.trim(),
        {
          items: contextItems,
          subtotalHT: preCodePricing.subtotalHT,
          carrierPrice: input.carrierPrice,
          userId,
          userShipping: { isFree: user.freeShipping, discountType: null, discountValue: null },
        },
        activePromos,
      );
      if (!check.valid) {
        codeError = check.error ?? "Le code promo est invalide.";
      } else {
        appliedCode = check.result;
      }
    }

    const appliedCodePromo = appliedCode
      ? activePromos.find((p) => p.id === appliedCode!.promotionId) ?? null
      : null;

    const pricing = computeOrderPricing({
      items: pricingItems,
      carrierId: input.carrierId,
      carrierPrice: input.carrierPrice,
      addressCountry: input.addressCountry ?? "FR",
      user: userPricingInput,
      activePromos,
      appliedCodePromo,
    });

    return {
      success: true,
      subtotalBrutHT: pricing.subtotalBrutHT,
      subtotalHT: pricing.subtotalHT,
      clientDiscountAmt: pricing.clientDiscountAmt,
      promoAutoDiscount: pricing.promoAutoDiscount,
      promoCodeSaved: pricing.promoCodeSaved,
      subtotalAfterDiscount: pricing.subtotalAfterDiscount,
      effectiveCarrierPrice: pricing.effectiveCarrierPrice,
      shippingIsFree: pricing.shippingIsFree,
      tvaRate: pricing.tvaRate,
      tvaOnCart: pricing.tvaOnCart,
      tvaOnShipping: pricing.tvaOnShipping,
      tvaAmount: pricing.tvaAmount,
      totalTTC: pricing.totalTTC,
      totalTTCCents: pricing.totalTTCCents,
      appliedCodePromo: appliedCode ? { code: appliedCode.code, name: appliedCode.name, totalSaved: appliedCode.totalSaved } : null,
      codeError,
    };
  } catch (err) {
    logger.error("[computeCartCheckoutPricing] Error", { error: err });
    return { success: false, error: "Erreur lors du calcul." };
  }
}
