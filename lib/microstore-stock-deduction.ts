/**
 * Microstore Stock Deduction — même règle que `lib/faire-stock-deduction.ts`
 * adaptée aux commandes Microstore.
 *
 * Spécificités Microstore :
 *  - Toutes les commandes importées sont considérées « expédiées » côté BJ
 *    (cf. normalizeMicrostoreToUnified). On accepte donc les statuts NEW et
 *    SHIPPED en base — seul CANCELLED est exclu.
 *  - Chaque `MicrostoreOrderItem` = 1 variante × 1 `quantity`.
 *  - Microstore expose `size_name` mais souvent vide pour les bijoux fantaisie
 *    (produits à taille unique). Comme Faire, on saute avec `NO_SIZE_MATCH`
 *    quand la variante liée a plusieurs tailles et qu'on ne peut pas
 *    déterminer laquelle.
 *
 * Idempotence : ne traite que les lignes dont `stockDeductedAt IS NULL`.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type MicrostoreStockDeductionSkipReason =
  | "PRODUCT_NOT_LINKED"
  | "VARIANT_NOT_LINKED"
  | "NO_SIZE_MATCH"
  | "QTY_ZERO";

export interface MicrostoreStockDeductionSkip {
  microstoreOrderItemId: string;
  reference: string;
  colorLabel: string | null;
  reason: MicrostoreStockDeductionSkipReason;
}

export interface MicrostoreStockDeductionResult {
  processedCount: number;
  skipped: MicrostoreStockDeductionSkip[];
  touchedProductIds: string[];
  touchedVariantIds: string[];
}

interface VariantSlim {
  id: string;
  colorId: string | null;
  stock: number;
  variantSizes: { sizeId: string; quantity: number }[];
}

export async function countPendingMicrostoreStockDeductions(tenantId: string): Promise<number> {
  return prisma.microstoreOrderItem.count({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      microstoreOrder: { status: { in: ["NEW", "SHIPPED"] } },
    },
  });
}

export async function deductStockFromMicrostoreOrders(
  tenantId: string,
  actorUserId: string | null,
  microstoreOrderIds?: string[],
): Promise<MicrostoreStockDeductionResult> {
  const pending = await prisma.microstoreOrderItem.findMany({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      microstoreOrder: { status: { in: ["NEW", "SHIPPED"] } },
      ...(microstoreOrderIds && microstoreOrderIds.length > 0
        ? { microstoreOrderInternalId: { in: microstoreOrderIds } }
        : {}),
    },
    select: {
      id: true,
      productId: true,
      productColorId: true,
      itemRef: true,
      colorNameSnapshot: true,
      quantity: true,
      microstoreOrder: { select: { microstoreOrderId: true } },
    },
  });

  const skipped: MicrostoreStockDeductionSkip[] = [];
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
    const reference = item.itemRef || "(sans référence)";
    const variant = variantById.get(item.productColorId!);
    if (!variant) {
      skipped.push({
        microstoreOrderItemId: item.id,
        reference,
        colorLabel: item.colorNameSnapshot,
        reason: "VARIANT_NOT_LINKED",
      });
      continue;
    }
    if (item.quantity <= 0) {
      skipped.push({
        microstoreOrderItemId: item.id,
        reference,
        colorLabel: item.colorNameSnapshot,
        reason: "QTY_ZERO",
      });
      continue;
    }

    // Microstore n'expose pas toujours la taille (souvent vide pour bijoux
    // fantaisie). On ne décrémente que si la variante a une seule taille.
    if (variant.variantSizes.length !== 1) {
      skipped.push({
        microstoreOrderItemId: item.id,
        reference,
        colorLabel: item.colorNameSnapshot,
        reason: "NO_SIZE_MATCH",
      });
      continue;
    }

    const sizeId = variant.variantSizes[0].sizeId;
    const unitsRemoved = item.quantity;
    const orderTag = item.microstoreOrder.microstoreOrderId;

    await prisma.$transaction(async (tx) => {
      // Décrément atomique (audit checkout 2026-08-17 §6-7). WHERE stock >= X
      // évite la race avec une vente boutique concurrente ; en cas de survente,
      // clamp à 0 + warning explicite.
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
        logger.warn("[Microstore Stock] Survente — clamp stock à 0", {
          microstoreOrder: orderTag,
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
              ? `Microstore #${orderTag} (${reference})`
              : `Microstore #${orderTag} (${reference}) — survente clampée (${appliedDelta}/${unitsRemoved} réellement décrémentés)`,
          createdById: actorUserId ?? undefined,
        },
      });

      await tx.microstoreOrderItem.update({
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

    // Rotation auto couleur principale après déduction de stock côté Microstore.
    const { rotatePrimaryIfNeeded } = await import("@/lib/rotate-primary-service");
    for (const pid of touchedProductIds) {
      await rotatePrimaryIfNeeded(pid, { tenantId }).catch((err) =>
        logger.error("[Microstore Stock] rotatePrimary error", { error: err, productId: pid }),
      );
    }
  }

  logger.info(
    `[Microstore Stock] Déduction terminée : ${processedCount} lignes traitées, ${skipped.length} sautées, ${touchedProductIds.size} produits touchés.`,
  );

  return {
    processedCount,
    skipped,
    touchedProductIds: Array.from(touchedProductIds),
    touchedVariantIds: Array.from(touchedVariantIds),
  };
}
