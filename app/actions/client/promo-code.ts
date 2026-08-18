"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validatePromoCode, loadActivePromotions, type AppliedCodePromo } from "@/lib/promotions";
import { buildCartPromoContexts } from "@/lib/promotion-cart-context";
import { resolveBestItemDiscount } from "@/lib/promotion-engine";

interface ShippingContextInput {
  carrierPrice: number;
  isFreeShipping: boolean;
  shippingSavedAmount: number;
}

/**
 * Valide un code promo pour le panier courant du client connecté.
 * Retourne le montant économisé si valide, sinon un message d'erreur.
 *
 * L'appelant fournit le contexte livraison (carrier sélectionné) car il
 * change au fil du choix du client dans le checkout.
 */
export async function validatePromoCodeForCart(
  code: string,
  shipping: ShippingContextInput,
): Promise<
  | { success: false; error: string }
  | { success: true; result: AppliedCodePromo }
> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Non authentifié." };
  const userId = session.user.id;

  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          variant: {
            include: {
              product: { select: { id: true, discountPercent: true } },
            },
          },
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    return { success: false, error: "Votre panier est vide." };
  }

  const contexts = await buildCartPromoContexts(cart.items);
  const activePromos = await loadActivePromotions();

  const items = cart.items
    .map((i) => {
      const ctx = contexts.get(i.id);
      if (!ctx) return null;
      return {
        ...ctx.context,
        quantity: i.quantity,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const subtotalHT = items.reduce((sum, it) => {
    const resolved = resolveBestItemDiscount(it, activePromos, null);
    return sum + resolved.finalUnitPrice * it.quantity;
  }, 0);

  const result = await validatePromoCode(
    code,
    {
      items,
      subtotalHT,
      carrierPrice: shipping.carrierPrice,
      userId,
      userShipping: {
        isFree: shipping.isFreeShipping,
        // La remise user est déjà précalculée en montant € par le caller —
        // on la remonte à l'engine comme un discount AMOUNT équivalent.
        discountType: shipping.shippingSavedAmount > 0 ? "AMOUNT" : null,
        discountValue: shipping.shippingSavedAmount > 0 ? shipping.shippingSavedAmount : null,
      },
    },
    activePromos,
  );

  if (!result.valid) return { success: false, error: result.error };
  return { success: true, result: result.result };
}
