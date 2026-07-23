/**
 * Ankorstore Stock Deduction — Même règle que `lib/pfs-stock-deduction.ts` et
 * `lib/efashion-stock-deduction.ts` mais adaptée aux commandes Ankorstore.
 *
 * Spécificités Ankor :
 *  - Chaque `AnkorstoreOrderItem` = 1 variante × 1 quantité totale
 *    (`multipliedQuantity` = `quantity` × `unitMultiplier`).
 *  - **Aucune répartition par taille dans l'API Ankor** : pour l'instant on
 *    ne peut décrémenter proprement que les variantes mono-taille (le cas
 *    fréquent des bijoux fantaisie). Si la variante a plusieurs tailles, on
 *    saute avec la raison NO_SIZE_MATCH (la cliente pourra ajuster à la main).
 *  - Le rattachement `ProductColor.ankorsVariantId` est fait à l'import.
 *
 * Idempotence : ne traite que les lignes dont `stockDeductedAt IS NULL` sur
 * des commandes au statut `VALIDATED` (ankor_confirmed) ou `SHIPPED`.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type AnkorstoreStockDeductionSkipReason =
  | "PRODUCT_NOT_LINKED"
  | "VARIANT_NOT_LINKED"
  | "NO_SIZE_MATCH"
  | "QTY_ZERO";

export interface AnkorstoreStockDeductionSkip {
  ankorstoreOrderItemId: string;
  reference: string;
  colorLabel: string | null;
  reason: AnkorstoreStockDeductionSkipReason;
}

export interface AnkorstoreStockDeductionResult {
  processedCount: number;
  skipped: AnkorstoreStockDeductionSkip[];
  touchedProductIds: string[];
  touchedVariantIds: string[];
}

interface VariantSlim {
  id: string;
  colorId: string | null;
  stock: number;
  variantSizes: { sizeId: string; quantity: number }[];
}

export async function countPendingAnkorstoreStockDeductions(tenantId: string): Promise<number> {
  return prisma.ankorstoreOrderItem.count({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      ankorstoreOrder: { status: { in: ["VALIDATED", "SHIPPED"] } },
    },
  });
}

export async function deductStockFromAnkorstoreOrders(
  tenantId: string,
  actorUserId: string | null,
  ankorstoreOrderIds?: string[],
): Promise<AnkorstoreStockDeductionResult> {
  const pending = await prisma.ankorstoreOrderItem.findMany({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      ankorstoreOrder: { status: { in: ["VALIDATED", "SHIPPED"] } },
      ...(ankorstoreOrderIds && ankorstoreOrderIds.length > 0
        ? { ankorstoreOrderId: { in: ankorstoreOrderIds } }
        : {}),
    },
    select: {
      id: true,
      productId: true,
      productColorId: true,
      sku: true,
      referenceBase: true,
      variantOptionLabel: true,
      multipliedQuantity: true,
      ankorstoreOrder: { select: { reference: true } },
    },
  });

  const skipped: AnkorstoreStockDeductionSkip[] = [];
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

  const variantIds = Array.from(new Set(pending.map((p) => p.productColorId!).filter(Boolean)));
  const variants = await prisma.productColor.findMany({
    where: { tenantId, id: { in: variantIds } },
    select: {
      id: true,
      colorId: true,
      stock: true,
      variantSizes: { select: { sizeId: true, quantity: true } },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v as VariantSlim]));

  const now = new Date();
  let processedCount = 0;

  for (const item of pending) {
    const reference = item.referenceBase ?? item.sku;
    const variant = variantById.get(item.productColorId!);
    if (!variant) {
      skipped.push({
        ankorstoreOrderItemId: item.id,
        reference,
        colorLabel: item.variantOptionLabel,
        reason: "VARIANT_NOT_LINKED",
      });
      continue;
    }
    if (item.multipliedQuantity <= 0) {
      skipped.push({
        ankorstoreOrderItemId: item.id,
        reference,
        colorLabel: item.variantOptionLabel,
        reason: "QTY_ZERO",
      });
      continue;
    }

    // Ankor ne donne pas la répartition par taille. On ne décrémente que si la
    // variante a une seule taille (produit à taille unique).
    if (variant.variantSizes.length !== 1) {
      skipped.push({
        ankorstoreOrderItemId: item.id,
        reference,
        colorLabel: item.variantOptionLabel,
        reason: "NO_SIZE_MATCH",
      });
      continue;
    }

    const sizeId = variant.variantSizes[0].sizeId;
    const unitsRemoved = item.multipliedQuantity;

    await prisma.$transaction(async (tx) => {
      const nextStock = Math.max(0, variant.stock - unitsRemoved);
      await tx.productColor.update({
        where: { id: variant.id },
        data: { stock: nextStock },
      });
      variant.stock = nextStock;
      touchedVariantIds.add(variant.id);

      await tx.stockMovement.create({
        data: {
          tenantId,
          productColorId: variant.id,
          sizeId,
          quantity: -unitsRemoved,
          type: "ORDER",
          reason: `Ankorstore #${item.ankorstoreOrder.reference} (${reference})`,
          createdById: actorUserId ?? undefined,
        },
      });

      await tx.ankorstoreOrderItem.update({
        where: { id: item.id },
        data: { stockDeductedAt: now },
      });
    });

    processedCount += 1;
    if (item.productId) touchedProductIds.add(item.productId);
  }

  if (touchedProductIds.size > 0) {
    await prisma.product.updateMany({
      where: { tenantId, id: { in: Array.from(touchedProductIds) } },
      data: { important: true },
    });
  }

  logger.info(
    `[Ankorstore Stock] Déduction terminée : ${processedCount} lignes traitées, ${skipped.length} sautées, ${touchedProductIds.size} produits touchés.`,
  );

  return {
    processedCount,
    skipped,
    touchedProductIds: Array.from(touchedProductIds),
    touchedVariantIds: Array.from(touchedVariantIds),
  };
}

// ─────────────────────────────────────────────
// Prévisualisation d'une déduction Ankorstore (simulation)
// ─────────────────────────────────────────────

export interface AnkorstoreStockPreviewVariantChange {
  productColorId: string;
  colorLabel: string;
  sizeLabel: string;
  unitsRemoved: number;
  currentStock: number;
  nextStock: number;
}

export interface AnkorstoreStockPreviewLine {
  ankorstoreOrderItemId: string;
  reference: string;
  productName: string | null;
  colorLabel: string | null;
  quantity: number;
  variantChanges: AnkorstoreStockPreviewVariantChange[];
  skipReason?: AnkorstoreStockDeductionSkipReason;
}

export interface AnkorstoreStockPreview {
  orderId: string;
  orderNumber: string;
  lines: AnkorstoreStockPreviewLine[];
  totalUnitsRemoved: number;
}

export async function simulateAnkorstoreStockDeductionForOrder(
  tenantId: string,
  ankorstoreOrderId: string,
): Promise<AnkorstoreStockPreview | null> {
  const order = await prisma.ankorstoreOrder.findFirst({
    where: { tenantId, id: ankorstoreOrderId },
    select: { id: true, reference: true, status: true },
  });
  if (!order) return null;

  const pending = await prisma.ankorstoreOrderItem.findMany({
    where: {
      tenantId,
      ankorstoreOrderId: order.id,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      ankorstoreOrder: { status: { in: ["VALIDATED", "SHIPPED"] } },
    },
    select: {
      id: true,
      productId: true,
      productColorId: true,
      sku: true,
      referenceBase: true,
      productSnapshotName: true,
      variantOptionLabel: true,
      multipliedQuantity: true,
    },
  });

  const variantIds = Array.from(new Set(pending.map((p) => p.productColorId!).filter(Boolean)));
  const [variants, sizes] = await Promise.all([
    prisma.productColor.findMany({
      where: { tenantId, id: { in: variantIds } },
      select: {
        id: true,
        colorId: true,
        stock: true,
        color: { select: { id: true, name: true } },
        variantSizes: { select: { sizeId: true, quantity: true } },
      },
    }),
    prisma.size.findMany({ where: { tenantId }, select: { id: true, name: true } }),
  ]);
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const sizeNameById = new Map(sizes.map((s) => [s.id, s.name]));

  const simulatedStock = new Map<string, number>();
  const lines: AnkorstoreStockPreviewLine[] = [];
  let totalUnits = 0;

  for (const item of pending) {
    const reference = item.referenceBase ?? item.sku;
    const variant = variantById.get(item.productColorId!);
    const base: AnkorstoreStockPreviewLine = {
      ankorstoreOrderItemId: item.id,
      reference,
      productName: item.productSnapshotName,
      colorLabel: item.variantOptionLabel,
      quantity: item.multipliedQuantity,
      variantChanges: [],
    };
    if (!variant) {
      lines.push({ ...base, skipReason: "VARIANT_NOT_LINKED" });
      continue;
    }
    if (item.multipliedQuantity <= 0) {
      lines.push({ ...base, skipReason: "QTY_ZERO" });
      continue;
    }
    if (variant.variantSizes.length !== 1) {
      lines.push({ ...base, skipReason: "NO_SIZE_MATCH" });
      continue;
    }

    const sizeId = variant.variantSizes[0].sizeId;
    const current = simulatedStock.get(variant.id) ?? variant.stock;
    const next = Math.max(0, current - item.multipliedQuantity);
    simulatedStock.set(variant.id, next);

    lines.push({
      ...base,
      variantChanges: [
        {
          productColorId: variant.id,
          colorLabel: variant.color?.name ?? item.variantOptionLabel ?? "—",
          sizeLabel: sizeNameById.get(sizeId) ?? "—",
          unitsRemoved: item.multipliedQuantity,
          currentStock: current,
          nextStock: next,
        },
      ],
    });
    totalUnits += item.multipliedQuantity;
  }

  return {
    orderId: order.id,
    orderNumber: order.reference,
    lines,
    totalUnitsRemoved: totalUnits,
  };
}
