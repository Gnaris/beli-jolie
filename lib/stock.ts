"use server";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
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
 * Called when order status changes to PROCESSING.
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

    await createStockMovement({
      productColorId: variantId,
      quantity: -item.quantity,
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

    await createStockMovement({
      productColorId: variantId,
      quantity: item.quantity,
      type: "CANCEL",
      orderId: order.id,
    });
  }

  logger.info(`[Stock] Reinstated stock for cancelled order ${order.orderNumber}`);
}

/**
 * Get low stock threshold for a product. Falls back to global default.
 */
export async function getLowStockThreshold(productId: string): Promise<number> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { lowStockThreshold: true },
  });

  if (product?.lowStockThreshold != null) return product.lowStockThreshold;

  const config = await prisma.siteConfig.findUnique({
    where: { key: "default_low_stock_threshold" },
  });

  return config ? parseInt(config.value, 10) || 5 : 5;
}
