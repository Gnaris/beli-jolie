"use server";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { stockUnitsForOrderItem } from "@/lib/stock-units";
import type { StockMovementType } from "@prisma/client";

/**
 * Create a stock movement and update the current stock on the variant.
 */
export async function createStockMovement(params: {
  productColorId: string;
  sizeId?: string | null;
  quantity: number; // positive = in, negative = out
  type: StockMovementType;
  reason?: string;
  orderId?: string;
  createdById?: string;
}) {
  const { productColorId, sizeId, quantity, type, reason, orderId, createdById } = params;

  const result = await prisma.$transaction(async (tx) => {
    const movement = await tx.stockMovement.create({
      data: {
        productColorId,
        sizeId: sizeId || null,
        quantity,
        type,
        reason,
        orderId,
        createdById,
      },
    });

    await tx.productColor.update({
      where: { id: productColorId },
      data: { stock: { increment: quantity } },
    });

    return movement;
  });

  logger.info(`[Stock] Movement ${type}: ${quantity > 0 ? "+" : ""}${quantity} on variant ${productColorId}${sizeId ? ` size ${sizeId}` : ""}`);
  return result;
}

/**
 * Check if enough stock is available for a cart item.
 */
export async function checkStockAvailability(productColorId: string, requestedQty: number) {
  const variant = await prisma.productColor.findUnique({
    where: { id: productColorId },
    select: { stock: true },
  });

  if (!variant) return { available: false, currentStock: 0 };

  return {
    available: variant.stock >= requestedQty,
    currentStock: variant.stock,
  };
}

/**
 * Decrement stock for all items in an order.
 * Called at order creation (commande PENDING).
 */
export async function decrementStockForOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) throw new Error("Order not found");

  for (const item of order.items) {
    let variantId: string | null = null;

    if (item.variantSnapshot) {
      try {
        const snapshot = JSON.parse(item.variantSnapshot);
        variantId = snapshot.productColorId || snapshot.id || null;
      } catch {
        logger.warn(`[Stock] Could not parse variantSnapshot for OrderItem ${item.id}`);
      }
    }

    if (!variantId) {
      logger.warn(`[Stock] No variantId found for OrderItem ${item.id}, skipping stock decrement`);
      continue;
    }

    const units = stockUnitsForOrderItem(item);

    await createStockMovement({
      productColorId: variantId,
      quantity: -units,
      type: "ORDER",
      orderId: order.id,
    });
  }

  logger.info(`[Stock] Decremented stock for order ${order.orderNumber} (${order.items.length} items)`);
}

/**
 * Reincrément stock for all items in an order.
 * Called when order is cancelled.
 */
export async function reinstateStockForOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) throw new Error("Order not found");

  const impactedColorIds: string[] = [];

  for (const item of order.items) {
    let variantId: string | null = null;

    if (item.variantSnapshot) {
      try {
        const snapshot = JSON.parse(item.variantSnapshot);
        variantId = snapshot.productColorId || snapshot.id || null;
      } catch {
        logger.warn(`[Stock] Could not parse variantSnapshot for OrderItem ${item.id}`);
      }
    }

    if (!variantId) continue;

    const units = stockUnitsForOrderItem(item);

    await createStockMovement({
      productColorId: variantId,
      quantity: units,
      type: "CANCEL",
      orderId: order.id,
    });

    impactedColorIds.push(variantId);
  }

  logger.info(`[Stock] Reinstated stock for cancelled order ${order.orderNumber}`);

  // Push stock silencieux vers Microstore (fire-and-forget). Le stock est
  // remonté suite à une annulation → on répercute le nouvel état côté
  // Microstore automatiquement. Voir CLAUDE.md > Microstore.
  if (order.tenantId && impactedColorIds.length > 0) {
    const impactedProducts = await prisma.productColor.findMany({
      where: { id: { in: impactedColorIds } },
      select: { productId: true },
    });
    const impactedProductIds = Array.from(
      new Set(impactedProducts.map((c) => c.productId)),
    );
    if (impactedProductIds.length > 0) {
      const tenantId = order.tenantId;
      import("@/lib/microstore-products").then(({ pushMicrostoreStockSilent }) =>
        pushMicrostoreStockSilent(impactedProductIds, tenantId).catch((err) =>
          logger.error("[Stock] Microstore silent push after reinstate failed", {
            error: err,
          }),
        ),
      );
    }
  }
}

