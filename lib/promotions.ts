/**
 * Fonctions serveur pour le système de promotions.
 * Les calculs purs (résolution "meilleure gagne") sont dans `lib/promotion-engine.ts`.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { DiscountKind, PromotionScope } from "@prisma/client";
import {
  type ActivePromotion,
  type ItemPromoContext,
  resolveBestItemDiscount,
  resolveBestShippingDiscount,
} from "@/lib/promotion-engine";

// Re-export des types côté serveur pour compatibilité avec les callers existants
export type {
  ActivePromotion,
  ItemPromoContext,
  ResolvedItemDiscount,
  ResolvedShippingDiscount,
} from "@/lib/promotion-engine";
export {
  promotionTargetsItem,
  resolveBestItemDiscount,
  resolveBestPercentForProductBadge,
  resolveBestShippingDiscount,
} from "@/lib/promotion-engine";

/**
 * Charge toutes les promotions actives (bornes dates + toggle) avec leurs
 * relations produits/catégories/collections.
 *
 * Pour les rendus fréquents, préférer `getCachedActivePromotions()` de
 * `lib/cached-data.ts` (TTL 5 min, tag "promotions").
 */
export async function loadActivePromotions(): Promise<ActivePromotion[]> {
  const now = new Date();
  const rows = await prisma.promotion.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    include: {
      products: { select: { productId: true } },
      categories: { select: { categoryId: true } },
      collections: { select: { collectionId: true } },
    },
  });

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    code: p.code,
    scope: p.scope,
    discountKind: p.discountKind,
    discountValue: Number(p.discountValue),
    minOrderAmount: p.minOrderAmount != null ? Number(p.minOrderAmount) : null,
    maxUses: p.maxUses,
    maxUsesPerUser: p.maxUsesPerUser,
    firstOrderOnly: p.firstOrderOnly,
    currentUses: p.currentUses,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    productIds: p.products.map((r) => r.productId),
    categoryIds: p.categories.map((r) => r.categoryId),
    collectionIds: p.collections.map((r) => r.collectionId),
    stackable: p.stackable,
  }));
}

// ─────────────────────────────────────────────
// Codes promo saisis
// ─────────────────────────────────────────────

interface CartForCodeValidation {
  items: (ItemPromoContext & { quantity: number })[];
  subtotalHT: number;
  carrierPrice: number;
  userId: string;
  /**
   * Livraison du client sous forme cumulable. `isFree=true` = 100 %.
   * Sinon les 2 champs discountType/discountValue sont utilisés (pré-filtrés
   * côté caller si un seuil THRESHOLD n'est pas atteint).
   */
  userShipping: {
    isFree: boolean;
    discountType: "PERCENT" | "AMOUNT" | null;
    discountValue: number | null;
  };
}

export interface AppliedCodePromo {
  promotionId: string;
  code: string;
  name: string;
  scope: PromotionScope;
  discountKind: DiscountKind;
  discountValue: number;
  totalSaved: number;
  itemsSaved: number;
  shippingSaved: number;
}

/**
 * Valide et calcule l'application d'un code promo saisi manuellement.
 * L'appelant a déjà chargé les promos AUTO ; on confronte le code aux items
 * après remises AUTO (règle "la meilleure gagne", pas de cumul).
 */
export async function validatePromoCode(
  code: string,
  cart: CartForCodeValidation,
  activePromos: ActivePromotion[],
): Promise<{ valid: false; error: string } | { valid: true; result: AppliedCodePromo }> {
  const normalized = code.toUpperCase().trim();
  if (!normalized) return { valid: false, error: "Code vide." };

  const promo = await prisma.promotion.findFirst({
    where: { code: normalized, type: "CODE" },
    include: {
      products: { select: { productId: true } },
      categories: { select: { categoryId: true } },
      collections: { select: { collectionId: true } },
    },
  });

  if (!promo) return { valid: false, error: "Code promo invalide." };
  if (!promo.isActive) return { valid: false, error: "Ce code n'est plus actif." };

  const now = new Date();
  if (now < promo.startsAt) return { valid: false, error: "Ce code n'est pas encore actif." };
  if (promo.endsAt && now > promo.endsAt) return { valid: false, error: "Ce code a expiré." };
  if (promo.maxUses && promo.currentUses >= promo.maxUses) {
    return { valid: false, error: "Ce code a atteint son nombre maximum d'utilisations." };
  }

  if (promo.maxUsesPerUser) {
    const userUses = await prisma.promotionUsage.count({
      where: { promotionId: promo.id, userId: cart.userId },
    });
    if (userUses >= promo.maxUsesPerUser) {
      return { valid: false, error: "Vous avez déjà utilisé ce code." };
    }
  }

  if (promo.firstOrderOnly) {
    const orderCount = await prisma.order.count({ where: { userId: cart.userId } });
    if (orderCount > 0) {
      return { valid: false, error: "Ce code est réservé à la première commande." };
    }
  }

  if (promo.minOrderAmount && cart.subtotalHT < Number(promo.minOrderAmount)) {
    return {
      valid: false,
      error: `Commande minimum de ${Number(promo.minOrderAmount).toFixed(2)} € HT requise.`,
    };
  }

  const applied: ActivePromotion = {
    id: promo.id,
    name: promo.name,
    type: promo.type,
    code: promo.code,
    scope: promo.scope,
    discountKind: promo.discountKind,
    discountValue: Number(promo.discountValue),
    minOrderAmount: promo.minOrderAmount != null ? Number(promo.minOrderAmount) : null,
    maxUses: promo.maxUses,
    maxUsesPerUser: promo.maxUsesPerUser,
    firstOrderOnly: promo.firstOrderOnly,
    currentUses: promo.currentUses,
    startsAt: promo.startsAt,
    endsAt: promo.endsAt,
    productIds: promo.products.map((r) => r.productId),
    categoryIds: promo.categories.map((r) => r.categoryId),
    collectionIds: promo.collections.map((r) => r.collectionId),
    stackable: promo.stackable,
  };

  let itemsSaved = 0;
  let shippingSaved = 0;

  if (applied.scope === "SHIPPING") {
    const resolved = resolveBestShippingDiscount(cart.carrierPrice, activePromos, cart.userShipping, applied);
    if (resolved.promotion?.id === applied.id) {
      shippingSaved = resolved.savedAmount;
    } else {
      return {
        valid: false,
        error: "Vous bénéficiez déjà d'une meilleure remise sur la livraison.",
      };
    }
  } else {
    let anyBeaten = false;
    for (const item of cart.items) {
      const withoutCode = resolveBestItemDiscount(item, activePromos, null);
      const withCode = resolveBestItemDiscount(item, activePromos, applied);
      const gain = (withoutCode.finalUnitPrice - withCode.finalUnitPrice) * item.quantity;
      if (gain > 0) {
        anyBeaten = true;
        itemsSaved += gain;
      }
    }
    if (!anyBeaten) {
      return {
        valid: false,
        error: "Ce code n'apporte pas d'avantage supplémentaire sur votre panier actuel.",
      };
    }
  }

  const totalSaved = Math.round((itemsSaved + shippingSaved) * 100) / 100;

  return {
    valid: true,
    result: {
      promotionId: applied.id,
      code: applied.code || normalized,
      name: applied.name,
      scope: applied.scope,
      discountKind: applied.discountKind,
      discountValue: applied.discountValue,
      totalSaved,
      itemsSaved: Math.round(itemsSaved * 100) / 100,
      shippingSaved: Math.round(shippingSaved * 100) / 100,
    },
  };
}

// ─────────────────────────────────────────────
// Journal d'utilisation
// ─────────────────────────────────────────────

export async function recordPromoUsage(
  promotionId: string,
  userId: string,
  orderId: string,
  discountApplied: number,
): Promise<void> {
  await prisma.$transaction([
    prisma.promotionUsage.create({
      data: { promotionId, userId, orderId, discountApplied },
    }),
    prisma.promotion.update({
      where: { id: promotionId },
      data: { currentUses: { increment: 1 } },
    }),
  ]);
  logger.info(
    `[Promo] Recorded usage for promotion ${promotionId}, user ${userId}, order ${orderId}: -${discountApplied}EUR`,
  );
}
