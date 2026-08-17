/**
 * Faire Stock Deduction — Même règle que `lib/ankorstore-stock-deduction.ts` et
 * `lib/pfs-stock-deduction.ts` adaptée aux commandes Faire.
 *
 * Spécificités Faire :
 *  - Chaque `FaireOrderItem` = 1 variante × 1 `quantity`.
 *  - **Aucune répartition par taille dans l'API Faire** : un `product_option_id`
 *    représente 1 couleur × 1 taille côté Faire. Côté BJ, si la variante liée
 *    (`ProductColor.faireVariantId`) contient plusieurs tailles, on ne peut pas
 *    deviner laquelle — on saute avec la raison NO_SIZE_MATCH. Le cas fréquent
 *    des bijoux fantaisie (taille unique) est traité normalement.
 *  - Le rattachement `ProductColor.faireVariantId` est posé à la publication
 *    Faire (ou à l'import commande via `product_option_id`).
 *
 * Idempotence : ne traite que les lignes dont `stockDeductedAt IS NULL` sur
 * des commandes au statut BJ `SHIPPED` (Faire renvoie SHIPPED/DELIVERED,
 * unifiés en SHIPPED chez BJ).
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type FaireStockDeductionSkipReason =
  | "PRODUCT_NOT_LINKED"
  | "VARIANT_NOT_LINKED"
  | "NO_SIZE_MATCH"
  | "QTY_ZERO";

export interface FaireStockDeductionSkip {
  faireOrderItemId: string;
  reference: string;
  colorLabel: string | null;
  reason: FaireStockDeductionSkipReason;
}

export interface FaireStockDeductionResult {
  processedCount: number;
  skipped: FaireStockDeductionSkip[];
  touchedProductIds: string[];
  touchedVariantIds: string[];
}

interface VariantSlim {
  id: string;
  colorId: string | null;
  stock: number;
  variantSizes: { sizeId: string; quantity: number }[];
}

export async function countPendingFaireStockDeductions(tenantId: string): Promise<number> {
  return prisma.faireOrderItem.count({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      faireOrder: { status: "SHIPPED" },
    },
  });
}

export async function deductStockFromFaireOrders(
  tenantId: string,
  actorUserId: string | null,
  faireOrderIds?: string[],
): Promise<FaireStockDeductionResult> {
  const pending = await prisma.faireOrderItem.findMany({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      faireOrder: { status: "SHIPPED" },
      ...(faireOrderIds && faireOrderIds.length > 0
        ? { faireOrderId: { in: faireOrderIds } }
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
      faireOrder: { select: { displayId: true, faireOrderId: true } },
    },
  });

  const skipped: FaireStockDeductionSkip[] = [];
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
    const reference = item.referenceBase ?? item.sku ?? "(sans référence)";
    const variant = variantById.get(item.productColorId!);
    if (!variant) {
      skipped.push({
        faireOrderItemId: item.id,
        reference,
        colorLabel: item.variantOptionLabel,
        reason: "VARIANT_NOT_LINKED",
      });
      continue;
    }
    if (item.quantity <= 0) {
      skipped.push({
        faireOrderItemId: item.id,
        reference,
        colorLabel: item.variantOptionLabel,
        reason: "QTY_ZERO",
      });
      continue;
    }

    // Faire ne renvoie pas la répartition par taille. On ne décrémente que si
    // la variante a une seule taille (produit à taille unique — cas typique
    // des bijoux fantaisie).
    if (variant.variantSizes.length !== 1) {
      skipped.push({
        faireOrderItemId: item.id,
        reference,
        colorLabel: item.variantOptionLabel,
        reason: "NO_SIZE_MATCH",
      });
      continue;
    }

    const sizeId = variant.variantSizes[0].sizeId;
    const unitsRemoved = item.quantity;
    const orderTag = item.faireOrder.displayId ?? item.faireOrder.faireOrderId;

    await prisma.$transaction(async (tx) => {
      // Décrément atomique : le WHERE stock >= X empêche une vente boutique
      // concurrente d'écraser silencieusement notre décrément (read-then-write
      // n'est pas race-safe côté MySQL). Si count=0, on tombe en fallback
      // clamp-à-0 avec un warning explicite (audit checkout 2026-08-17 §7).
      const dec = await tx.productColor.updateMany({
        where: { id: variant.id, stock: { gte: unitsRemoved } },
        data: { stock: { decrement: unitsRemoved } },
      });
      let appliedDelta = unitsRemoved;
      if (dec.count === 0) {
        const current = await tx.productColor.findUnique({
          where: { id: variant.id },
          select: { stock: true },
        });
        const available = current?.stock ?? 0;
        appliedDelta = available;
        if (available > 0) {
          await tx.productColor.update({
            where: { id: variant.id },
            data: { stock: 0 },
          });
        }
        logger.warn("[Faire Stock] Survente — clamp stock à 0", {
          faireOrder: orderTag,
          reference,
          variantId: variant.id,
          requested: unitsRemoved,
          applied: appliedDelta,
          missing: unitsRemoved - appliedDelta,
        });
      }
      variant.stock = Math.max(0, variant.stock - unitsRemoved);
      touchedVariantIds.add(variant.id);

      await tx.stockMovement.create({
        data: {
          tenantId,
          productColorId: variant.id,
          sizeId,
          quantity: -unitsRemoved,
          type: "ORDER",
          reason:
            appliedDelta === unitsRemoved
              ? `Faire #${orderTag} (${reference})`
              : `Faire #${orderTag} (${reference}) — survente clampée (${appliedDelta}/${unitsRemoved} réellement décrémentés)`,
          createdById: actorUserId ?? undefined,
        },
      });

      await tx.faireOrderItem.update({
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

    // Rotation auto couleur principale après déduction de stock côté Faire.
    const { rotatePrimaryIfNeeded } = await import("@/lib/rotate-primary-service");
    for (const pid of touchedProductIds) {
      await rotatePrimaryIfNeeded(pid, { tenantId }).catch((err) =>
        logger.error("[Faire Stock] rotatePrimary error", { error: err, productId: pid }),
      );
    }
  }

  logger.info(
    `[Faire Stock] Déduction terminée : ${processedCount} lignes traitées, ${skipped.length} sautées, ${touchedProductIds.size} produits touchés.`,
  );

  return {
    processedCount,
    skipped,
    touchedProductIds: Array.from(touchedProductIds),
    touchedVariantIds: Array.from(touchedVariantIds),
  };
}

// ─────────────────────────────────────────────
// Prévisualisation d'une déduction Faire (simulation)
// ─────────────────────────────────────────────

export interface FaireStockPreviewVariantChange {
  productColorId: string;
  colorLabel: string;
  sizeLabel: string;
  unitsRemoved: number;
  currentStock: number;
  nextStock: number;
}

export interface FaireStockPreviewLine {
  faireOrderItemId: string;
  reference: string;
  productName: string | null;
  colorLabel: string | null;
  quantity: number;
  variantChanges: FaireStockPreviewVariantChange[];
  skipReason?: FaireStockDeductionSkipReason;
}

export interface FaireStockPreview {
  orderId: string;
  orderNumber: string;
  lines: FaireStockPreviewLine[];
  totalUnitsRemoved: number;
}

export async function simulateFaireStockDeductionForOrder(
  tenantId: string,
  faireOrderId: string,
): Promise<FaireStockPreview | null> {
  const order = await prisma.faireOrder.findFirst({
    where: { tenantId, id: faireOrderId },
    select: { id: true, displayId: true, faireOrderId: true, status: true },
  });
  if (!order) return null;

  const pending = await prisma.faireOrderItem.findMany({
    where: {
      tenantId,
      faireOrderId: order.id,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      faireOrder: { status: "SHIPPED" },
    },
    select: {
      id: true,
      productId: true,
      productColorId: true,
      sku: true,
      referenceBase: true,
      productSnapshotName: true,
      variantOptionLabel: true,
      quantity: true,
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
  const lines: FaireStockPreviewLine[] = [];
  let totalUnits = 0;

  for (const item of pending) {
    const reference = item.referenceBase ?? item.sku ?? "(sans référence)";
    const variant = variantById.get(item.productColorId!);
    const base: FaireStockPreviewLine = {
      faireOrderItemId: item.id,
      reference,
      productName: item.productSnapshotName,
      colorLabel: item.variantOptionLabel,
      quantity: item.quantity,
      variantChanges: [],
    };
    if (!variant) {
      lines.push({ ...base, skipReason: "VARIANT_NOT_LINKED" });
      continue;
    }
    if (item.quantity <= 0) {
      lines.push({ ...base, skipReason: "QTY_ZERO" });
      continue;
    }
    if (variant.variantSizes.length !== 1) {
      lines.push({ ...base, skipReason: "NO_SIZE_MATCH" });
      continue;
    }

    const sizeId = variant.variantSizes[0].sizeId;
    const current = simulatedStock.get(variant.id) ?? variant.stock;
    const next = Math.max(0, current - item.quantity);
    simulatedStock.set(variant.id, next);

    lines.push({
      ...base,
      variantChanges: [
        {
          productColorId: variant.id,
          colorLabel: variant.color?.name ?? item.variantOptionLabel ?? "—",
          sizeLabel: sizeNameById.get(sizeId) ?? "—",
          unitsRemoved: item.quantity,
          currentStock: current,
          nextStock: next,
        },
      ],
    });
    totalUnits += item.quantity;
  }

  return {
    orderId: order.id,
    orderNumber: order.displayId ?? order.faireOrderId,
    lines,
    totalUnitsRemoved: totalUnits,
  };
}
