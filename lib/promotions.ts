import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { DiscountKind } from "@prisma/client";

interface CartForPromo {
  items: {
    variantId: string;
    quantity: number;
    unitPrice: number;
    productId: string;
    categoryId?: string;
  }[];
  subtotalHT: number;
  userId: string;
}

interface PromoResult {
  promotionId: string;
  promotionName: string;
  code?: string;
  discountKind: DiscountKind;
  discountValue: number;
  discountAmount: number;
}

/**
 * Validate and calculate discount for a promo code.
 */
export async function validatePromoCode(code: string, cart: CartForPromo): Promise<{ valid: boolean; error?: string; result?: PromoResult }> {
  const promo = await prisma.promotion.findUnique({
    where: { code: code.toUpperCase().trim() },
    include: {
      categories: { select: { categoryId: true } },
      collections: { select: { collectionId: true } },
      products: { select: { productId: true } },
    },
  });

  if (!promo) return { valid: false, error: "Code promo invalide." };
  if (!promo.isActive) return { valid: false, error: "Ce code promo n'est plus actif." };
  if (promo.type !== "CODE") return { valid: false, error: "Code promo invalide." };

  const now = new Date();
  if (now < promo.startsAt) return { valid: false, error: "Ce code promo n'est pas encore actif." };
  if (promo.endsAt && now > promo.endsAt) return { valid: false, error: "Ce code promo a expire." };

  if (promo.maxUses && promo.currentUses >= promo.maxUses) {
    return { valid: false, error: "Ce code promo a atteint son nombre maximum d'utilisations." };
  }

  if (promo.maxUsesPerUser) {
    const userUses = await prisma.promotionUsage.count({
      where: { promotionId: promo.id, userId: cart.userId },
    });
    if (userUses >= promo.maxUsesPerUser) {
      return { valid: false, error: "Vous avez deja utilise ce code promo." };
    }
  }

  if (promo.firstOrderOnly) {
    const orderCount = await prisma.order.count({ where: { userId: cart.userId } });
    if (orderCount > 0) {
      return { valid: false, error: "Ce code promo est reserve a la premiere commande." };
    }
  }

  if (promo.minOrderAmount && cart.subtotalHT < Number(promo.minOrderAmount)) {
    return { valid: false, error: `Commande minimum de ${Number(promo.minOrderAmount).toFixed(2)}EUR HT requise.` };
  }

  let applicableAmount = cart.subtotalHT;
  if (!promo.appliesToAll) {
    const targetProductIds = new Set(promo.products.map((p) => p.productId));
    const targetCategoryIds = new Set(promo.categories.map((c) => c.categoryId));
    applicableAmount = cart.items
      .filter((item) => targetProductIds.has(item.productId) || (item.categoryId && targetCategoryIds.has(item.categoryId)))
      .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  }

  let discountAmount = 0;
  const dv = Number(promo.discountValue);

  switch (promo.discountKind) {
    case "PERCENTAGE":
      discountAmount = Math.round((applicableAmount * dv / 100) * 100) / 100;
      break;
    case "FIXED_AMOUNT":
      discountAmount = Math.min(dv, applicableAmount);
      break;
    case "FREE_SHIPPING":
      discountAmount = 0;
      break;
  }

  return {
    valid: true,
    result: {
      promotionId: promo.id,
      promotionName: promo.name,
      code: promo.code || undefined,
      discountKind: promo.discountKind,
      discountValue: dv,
      discountAmount,
    },
  };
}

/**
 * Find and apply all automatic promotions for a cart.
 */
export async function getAutoPromotions(cart: CartForPromo): Promise<PromoResult[]> {
  const now = new Date();

  const autoPromos = await prisma.promotion.findMany({
    where: {
      type: "AUTO",
      isActive: true,
      startsAt: { lte: now },
      OR: [
        { endsAt: null },
        { endsAt: { gte: now } },
      ],
    },
    include: {
      categories: { select: { categoryId: true } },
      collections: { select: { collectionId: true } },
      products: { select: { productId: true } },
    },
  });

  const results: PromoResult[] = [];

  for (const promo of autoPromos) {
    if (promo.maxUses && promo.currentUses >= promo.maxUses) continue;
    if (promo.minOrderAmount && cart.subtotalHT < Number(promo.minOrderAmount)) continue;

    if (promo.firstOrderOnly) {
      const orderCount = await prisma.order.count({ where: { userId: cart.userId } });
      if (orderCount > 0) continue;
    }

    let applicableAmount = cart.subtotalHT;
    if (!promo.appliesToAll) {
      const targetProductIds = new Set(promo.products.map((p) => p.productId));
      const targetCategoryIds = new Set(promo.categories.map((c) => c.categoryId));
      applicableAmount = cart.items
        .filter((item) => targetProductIds.has(item.productId) || (item.categoryId && targetCategoryIds.has(item.categoryId)))
        .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    }

    let discountAmount = 0;
    const dv = Number(promo.discountValue);

    switch (promo.discountKind) {
      case "PERCENTAGE":
        discountAmount = Math.round((applicableAmount * dv / 100) * 100) / 100;
        break;
      case "FIXED_AMOUNT":
        discountAmount = Math.min(dv, applicableAmount);
        break;
      case "FREE_SHIPPING":
        discountAmount = 0;
        break;
    }

    results.push({
      promotionId: promo.id,
      promotionName: promo.name,
      discountKind: promo.discountKind,
      discountValue: dv,
      discountAmount,
    });
  }

  return results;
}

/**
 * Record promotion usage after order confirmation.
 */
export async function recordPromoUsage(promotionId: string, userId: string, orderId: string, discountApplied: number) {
  await prisma.$transaction([
    prisma.promotionUsage.create({
      data: { promotionId, userId, orderId, discountApplied },
    }),
    prisma.promotion.update({
      where: { id: promotionId },
      data: { currentUses: { increment: 1 } },
    }),
  ]);

  logger.info(`[Promo] Recorded usage for promotion ${promotionId}, user ${userId}, order ${orderId}: -${discountApplied}EUR`);
}
