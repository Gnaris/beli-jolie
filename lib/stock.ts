"use server";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { stockUnitsForOrderItem } from "@/lib/stock-units";
import {
  dropRestockEntryForProductColor,
  enqueueRestockForProductColor,
} from "@/lib/restock-trigger";
import type { StockMovementType } from "@prisma/client";

/**
 * Create a stock movement and update the current stock on the variant.
 *
 * Déclenche aussi la détection « retour en stock » : si le stock vient de
 * passer de ≤ 0 → > 0, on fire-and-forget `enqueueRestockForProductColor`
 * pour alimenter la file de notifications. Non-bloquant.
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

  const { movement, stockBefore, stockAfter, tenantId } = await prisma.$transaction(
    async (tx) => {
      // Snapshot du stock avant mutation — sert à détecter la transition
      // 0 → >0 pour les notifications « retour en stock ».
      const before = await tx.productColor.findUnique({
        where: { id: productColorId },
        select: {
          stock: true,
          product: { select: { tenantId: true } },
        },
      });
      const stockBefore = before?.stock ?? 0;

      const created = await tx.stockMovement.create({
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

      return {
        movement: created,
        stockBefore,
        stockAfter: stockBefore + quantity,
        tenantId: before?.product.tenantId ?? null,
      };
    },
  );

  logger.info(
    `[Stock] Movement ${type}: ${quantity > 0 ? "+" : ""}${quantity} on variant ${productColorId}${sizeId ? ` size ${sizeId}` : ""}`,
  );

  // Détection « retour en stock » : transition ≤ 0 → > 0. Fire-and-forget —
  // on ne bloque pas l'appel et on avale les erreurs côté trigger. Skip pour
  // les mouvements ORDER (sortie de stock, jamais retour).
  if (stockBefore <= 0 && stockAfter > 0 && type !== "ORDER") {
    enqueueRestockForProductColor(productColorId, tenantId ?? undefined).catch(
      (err) => {
        logger.error("[Stock] enqueueRestock fire-and-forget failed", {
          productColorId,
          error: err as Error,
        });
      },
    );
  }

  // Transition inverse : > 0 → ≤ 0. On purge les files PENDING pour que le
  // produit ne soit pas annoncé en retour en stock alors qu'il vient d'être
  // re-rupté. Fire-and-forget.
  if (stockBefore > 0 && stockAfter <= 0) {
    dropRestockEntryForProductColor(productColorId, tenantId ?? undefined).catch(
      (err) => {
        logger.error("[Stock] dropRestockEntry fire-and-forget failed", {
          productColorId,
          error: err as Error,
        });
      },
    );
  }

  return movement;
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
 *
 * Idempotent : si un StockMovement CANCEL existe déjà pour cette commande,
 * on skip pour éviter de doubler le stock (double-clic admin, race
 * client-cancel + admin-cancel, ré-exécution manuelle du script d'annulation).
 */
export async function reinstateStockForOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) throw new Error("Order not found");

  const alreadyReinstated = await prisma.stockMovement.findFirst({
    where: { orderId: order.id, type: "CANCEL" },
    select: { id: true },
  });
  if (alreadyReinstated) {
    logger.info(`[Stock] Skip reinstate — CANCEL déjà tracé pour ${order.orderNumber}`);
    return;
  }

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

