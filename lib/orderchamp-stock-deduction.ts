/**
 * Orderchamp Stock Deduction — même règle que `lib/faire-stock-deduction.ts`
 * adaptée aux commandes Orderchamp.
 *
 * Spécificités Orderchamp :
 *  - Chaque `OrderchampOrderItem` = 1 variante × 1 `quantity`.
 *  - `ProductColor.orderchampVariantId` mappe la ligne OC à une variante BJ.
 *  - Pas de répartition par taille dans le payload OC : si la variante BJ liée
 *    contient plusieurs tailles, on skip avec la raison `NO_SIZE_MATCH`.
 *
 * Idempotence : ne traite que les lignes dont `stockDeductedAt IS NULL` sur des
 * commandes au statut BJ `SHIPPED`.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type OrderchampStockDeductionSkipReason =
  | "PRODUCT_NOT_LINKED"
  | "VARIANT_NOT_LINKED"
  | "NO_SIZE_MATCH"
  | "QTY_ZERO";

export interface OrderchampStockDeductionSkip {
  orderchampOrderItemId: string;
  reference: string;
  colorLabel: string | null;
  reason: OrderchampStockDeductionSkipReason;
}

export interface OrderchampStockDeductionResult {
  processedCount: number;
  skipped: OrderchampStockDeductionSkip[];
  touchedProductIds: string[];
  touchedVariantIds: string[];
}

interface VariantSlim {
  id: string;
  colorId: string | null;
  stock: number;
  variantSizes: { sizeId: string; quantity: number }[];
}

export async function countPendingOrderchampStockDeductions(tenantId: string): Promise<number> {
  return prisma.orderchampOrderItem.count({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      orderchampOrder: { status: "SHIPPED" },
    },
  });
}

export async function deductStockFromOrderchampOrders(
  tenantId: string,
  actorUserId: string | null,
  orderchampOrderIds?: string[],
): Promise<OrderchampStockDeductionResult> {
  const pending = await prisma.orderchampOrderItem.findMany({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      orderchampOrder: { status: "SHIPPED" },
      ...(orderchampOrderIds && orderchampOrderIds.length > 0
        ? { orderchampOrderId: { in: orderchampOrderIds } }
        : {}),
    },
    select: {
      id: true,
      productId: true,
      productColorId: true,
      sku: true,
      referenceBase: true,
      variantOptionLabel: true,
      quantity: true,
      orderchampOrder: { select: { displayId: true, orderchampOrderId: true } },
    },
  });

  const skipped: OrderchampStockDeductionSkip[] = [];
  const touchedVariantIds = new Set<string>();
  const touchedProductIds = new Set<string>();

  if (pending.length === 0) {
    return {
      processedCount: 0,
      skipped,
      touchedProductIds: [],
      touchedVariantIds: [],
    };
  }

  const variantIds = Array.from(new Set(pending.map((it) => it.productColorId).filter((v): v is string => !!v)));
  const variants = await prisma.productColor.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      colorId: true,
      stock: true,
      variantSizes: { select: { sizeId: true, quantity: true } },
    },
  });
  const variantMap = new Map<string, VariantSlim>(variants.map((v) => [v.id, v]));

  const deductions: { itemId: string; variantId: string; productId: string; qty: number }[] = [];

  for (const item of pending) {
    if (!item.productId || !item.productColorId) {
      skipped.push({
        orderchampOrderItemId: item.id,
        reference: item.referenceBase ?? item.sku ?? "?",
        colorLabel: item.variantOptionLabel,
        reason: "PRODUCT_NOT_LINKED",
      });
      continue;
    }
    if (item.quantity <= 0) {
      skipped.push({
        orderchampOrderItemId: item.id,
        reference: item.referenceBase ?? item.sku ?? "?",
        colorLabel: item.variantOptionLabel,
        reason: "QTY_ZERO",
      });
      continue;
    }
    const variant = variantMap.get(item.productColorId);
    if (!variant) {
      skipped.push({
        orderchampOrderItemId: item.id,
        reference: item.referenceBase ?? item.sku ?? "?",
        colorLabel: item.variantOptionLabel,
        reason: "VARIANT_NOT_LINKED",
      });
      continue;
    }
    // Si la variante BJ liée a plusieurs tailles, OC ne dit pas laquelle a été
    // commandée → on skip par sécurité (même règle que Faire).
    if (variant.variantSizes.length > 1) {
      skipped.push({
        orderchampOrderItemId: item.id,
        reference: item.referenceBase ?? item.sku ?? "?",
        colorLabel: item.variantOptionLabel,
        reason: "NO_SIZE_MATCH",
      });
      continue;
    }
    deductions.push({
      itemId: item.id,
      variantId: variant.id,
      productId: item.productId,
      qty: item.quantity,
    });
  }

  if (deductions.length === 0) {
    return { processedCount: 0, skipped, touchedProductIds: [], touchedVariantIds: [] };
  }

  const now = new Date();
  let processedCount = 0;

  for (const d of deductions) {
    try {
      // Atomicité : `updateMany WHERE stock >= qty` — évite le stock négatif.
      const res = await prisma.productColor.updateMany({
        where: { id: d.variantId, stock: { gte: d.qty } },
        data: { stock: { decrement: d.qty } },
      });
      if (res.count === 0) {
        // Stock insuffisant — on clamp à 0 avec warning (comme Faire).
        logger.warn("[Orderchamp Stock] Stock insuffisant, clamp à 0", {
          tenantId,
          variantId: d.variantId,
          qty: d.qty,
        });
        await prisma.productColor.update({
          where: { id: d.variantId },
          data: { stock: 0 },
        });
      }
      await prisma.orderchampOrderItem.update({
        where: { id: d.itemId },
        data: { stockDeductedAt: now },
      });
      touchedVariantIds.add(d.variantId);
      touchedProductIds.add(d.productId);
      processedCount++;
    } catch (err) {
      logger.warn("[Orderchamp Stock] Déduction échouée pour un item", {
        tenantId,
        itemId: d.itemId,
        error: err,
      });
    }
  }

  if (actorUserId) {
    logger.info("[Orderchamp Stock] Déduction effectuée", {
      tenantId,
      actorUserId,
      processed: processedCount,
      skipped: skipped.length,
    });
  }

  return {
    processedCount,
    skipped,
    touchedProductIds: Array.from(touchedProductIds),
    touchedVariantIds: Array.from(touchedVariantIds),
  };
}
