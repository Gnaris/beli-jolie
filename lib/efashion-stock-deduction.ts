/**
 * eFashion Stock Deduction — Même règle que `lib/pfs-stock-deduction.ts` mais
 * adaptée aux commandes eFashion.
 *
 * Différences fondamentales vs PFS :
 *  - eFashion n'a PAS de notion de PACK — chaque ligne = 1 produit-couleur.
 *  - La répartition par taille se lit dans `quantitiesJson.q1..q12` +
 *    `declinaisonsJson.d1_FR..d12_FR` (parallel arrays de 12 slots).
 *  - Le rattachement ProductColor est déjà fait à l'import (via `id_produit`
 *    → `ProductColor.efashionProductId`).
 *
 * Idempotence : ne traite que les lignes dont `stockDeductedAt IS NULL` sur
 * des commandes au statut `SHIPPED`.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type EfashionStockDeductionSkipReason =
  | "PRODUCT_NOT_LINKED"
  | "VARIANT_NOT_LINKED"
  | "NO_SIZE_MATCH"
  | "QTY_ZERO";

export interface EfashionStockDeductionSkip {
  efashionOrderItemId: string;
  efashionOrderName: string;
  reference: string;
  colorLabel: string | null;
  sizeLabel: string | null;
  reason: EfashionStockDeductionSkipReason;
}

export interface EfashionStockDeductionResult {
  processedCount: number;
  skipped: EfashionStockDeductionSkip[];
  touchedProductIds: string[];
  touchedVariantIds: string[];
}

interface VariantSlim {
  id: string;
  colorId: string | null;
  stock: number;
  variantSizes: { sizeId: string; quantity: number }[];
}

export async function countPendingEfashionStockDeductions(tenantId: string): Promise<number> {
  return prisma.efashionOrderItem.count({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      efashionOrder: { status: "SHIPPED" },
    },
  });
}

/**
 * Développe une ligne eFashion en un tableau `{sizeLabelFr, units}` en croisant
 * `quantitiesJson` et `declinaisonsJson` par colonne q1..q12.
 */
function expandLineQuantitiesBySize(
  quantitiesJson: unknown,
  declinaisonsJson: unknown,
): Array<{ sizeLabelFr: string | null; units: number }> {
  const qs = (quantitiesJson ?? {}) as Record<string, unknown>;
  const ds = (declinaisonsJson ?? {}) as Record<string, unknown>;
  const out: Array<{ sizeLabelFr: string | null; units: number }> = [];
  for (let i = 1; i <= 12; i++) {
    const rawQty = qs[`q${i}`];
    const units = typeof rawQty === "number" ? rawQty : Number(rawQty ?? 0);
    if (!Number.isFinite(units) || units <= 0) continue;
    const rawLabel = ds[`d${i}_FR`];
    const sizeLabelFr = typeof rawLabel === "string" ? rawLabel : null;
    out.push({ sizeLabelFr, units });
  }
  return out;
}

/**
 * Retrouve le sizeId côté BJ à partir du libellé eFashion.
 * Priorité : name exact (case-insensitive) → efashionDeclinaisonField (si un
 * jour on ajoute un mapping direct).
 *
 * Cas fréquent : « Taille unique » — on essaie plusieurs variantes ("Taille unique",
 * "TU", "Unique") en fallback pour absorber les libellés hétérogènes.
 */
async function resolveSizeIdFromEfashionLabel(
  tenantId: string,
  variant: VariantSlim,
  sizeLabelFr: string | null,
): Promise<string | null> {
  // Priorité 1 : si la variante n'a qu'une seule variantSize, on la prend directement
  // (le cas « produit à taille unique » où le libellé eFashion peut différer du nôtre).
  if (variant.variantSizes.length === 1) {
    return variant.variantSizes[0].sizeId;
  }

  if (!sizeLabelFr) return null;
  const trimmed = sizeLabelFr.trim();
  if (!trimmed) return null;

  const candidates = ["Taille unique", "TU", "Unique"];
  const searchTerms = new Set([trimmed, trimmed.toLowerCase(), trimmed.toUpperCase()]);
  if (candidates.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
    for (const c of candidates) searchTerms.add(c);
  }

  const rows = await prisma.size.findMany({
    where: {
      tenantId,
      name: { in: Array.from(searchTerms) },
    },
    select: { id: true, name: true },
  });
  const match = rows.find((s) => s.name.toLowerCase() === trimmed.toLowerCase()) ?? rows[0];
  if (!match) return null;

  // Vérifie que la variante possède bien cette taille — sinon aucun match.
  const has = variant.variantSizes.some((vs) => vs.sizeId === match.id);
  return has ? match.id : null;
}

export async function deductStockFromEfashionOrders(
  tenantId: string,
  actorUserId: string | null,
  efashionOrderIds?: string[],
): Promise<EfashionStockDeductionResult> {
  const pending = await prisma.efashionOrderItem.findMany({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      efashionOrder: { status: "SHIPPED" },
      ...(efashionOrderIds && efashionOrderIds.length > 0
        ? { efashionOrderId: { in: efashionOrderIds } }
        : {}),
    },
    select: {
      id: true,
      productId: true,
      productColorId: true,
      referenceFull: true,
      colorLabelFr: true,
      qtyTotal: true,
      quantitiesJson: true,
      declinaisonsJson: true,
      efashionOrder: { select: { efashionOrderName: true } },
    },
  });

  const skipped: EfashionStockDeductionSkip[] = [];
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
    const orderName = item.efashionOrder.efashionOrderName;
    const variant = variantById.get(item.productColorId!);
    if (!variant) {
      skipped.push({
        efashionOrderItemId: item.id,
        efashionOrderName: orderName,
        reference: item.referenceFull,
        colorLabel: item.colorLabelFr,
        sizeLabel: null,
        reason: "VARIANT_NOT_LINKED",
      });
      continue;
    }
    if (item.qtyTotal <= 0) {
      skipped.push({
        efashionOrderItemId: item.id,
        efashionOrderName: orderName,
        reference: item.referenceFull,
        colorLabel: item.colorLabelFr,
        sizeLabel: null,
        reason: "QTY_ZERO",
      });
      continue;
    }

    // Étale la ligne sur ses tailles (q1..q12).
    const expanded = expandLineQuantitiesBySize(item.quantitiesJson, item.declinaisonsJson);

    // Résout chaque taille en sizeId BJ, agrège les units par sizeId.
    const consumptions: { sizeId: string; units: number; sizeLabel: string | null }[] = [];
    for (const bucket of expanded) {
      const sizeId = await resolveSizeIdFromEfashionLabel(tenantId, variant, bucket.sizeLabelFr);
      if (!sizeId) {
        skipped.push({
          efashionOrderItemId: item.id,
          efashionOrderName: orderName,
          reference: item.referenceFull,
          colorLabel: item.colorLabelFr,
          sizeLabel: bucket.sizeLabelFr,
          reason: "NO_SIZE_MATCH",
        });
        // On continue sur les autres buckets même si un match échoue.
        continue;
      }
      consumptions.push({ sizeId, units: bucket.units, sizeLabel: bucket.sizeLabelFr });
    }
    if (consumptions.length === 0) continue;

    await prisma.$transaction(async (tx) => {
      // 1 seule décrémentation par variante (variant.stock) — on soustrait la somme.
      const totalUnitsRemoved = consumptions.reduce((s, c) => s + c.units, 0);
      // Décrément atomique (audit checkout 2026-08-17 §6-7). WHERE stock >= X
      // évite la race avec une vente boutique concurrente ; en cas de survente,
      // clamp à 0 + warning explicite.
      const dec = await tx.productColor.updateMany({
        where: { id: variant.id, stock: { gte: totalUnitsRemoved } },
        data: { stock: { decrement: totalUnitsRemoved } },
      });
      let appliedDelta = totalUnitsRemoved;
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
        logger.warn("[eFashion Stock] Survente — clamp stock à 0", {
          efashionOrder: orderName,
          reference: item.referenceFull,
          variantId: variant.id,
          requested: totalUnitsRemoved,
          applied: appliedDelta,
          missing: totalUnitsRemoved - appliedDelta,
        });
      }
      const nextStock = Math.max(0, variant.stock - totalUnitsRemoved);
      const delta = nextStock - variant.stock;
      variant.stock = nextStock;
      touchedVariantIds.add(variant.id);

      // StockMovement : 1 par (sizeId) pour tracer la répartition.
      for (const c of consumptions) {
        if (c.units <= 0) continue;
        await tx.stockMovement.create({
          data: {
            tenantId,
            productColorId: variant.id,
            sizeId: c.sizeId,
            quantity: -c.units,
            type: "ORDER",
            reason: `eFashion ${orderName} (${item.referenceFull}${c.sizeLabel ? ` — ${c.sizeLabel}` : ""})`,
            createdById: actorUserId ?? undefined,
          },
        });
      }
      // Si tout n'a pas pu être imputé à une taille précise (delta > total imputé),
      // on trace un mouvement "ajustement" pour l'écart.
      const totalImputed = consumptions.reduce((s, c) => s + c.units, 0);
      const missing = totalUnitsRemoved - totalImputed;
      if (missing !== 0 && delta !== 0) {
        // ignore : ici totalUnitsRemoved === totalImputed par construction.
      }

      await tx.efashionOrderItem.update({
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

    // Rotation auto couleur principale après déduction de stock côté eFashion.
    const { rotatePrimaryIfNeeded } = await import("@/lib/rotate-primary-service");
    for (const pid of touchedProductIds) {
      await rotatePrimaryIfNeeded(pid, { tenantId }).catch((err) =>
        logger.error("[eFashion Stock] rotatePrimary error", { error: err, productId: pid }),
      );
    }
  }

  logger.info(
    `[eFashion Stock] Déduction terminée : ${processedCount} lignes traitées, ${skipped.length} sautées, ${touchedProductIds.size} produits touchés.`,
  );

  return {
    processedCount,
    skipped,
    touchedProductIds: Array.from(touchedProductIds),
    touchedVariantIds: Array.from(touchedVariantIds),
  };
}

// ─────────────────────────────────────────────
// Prévisualisation d'une déduction eFashion (simulation)
// ─────────────────────────────────────────────

export interface EfashionStockPreviewVariantChange {
  productColorId: string;
  colorLabel: string;
  sizeLabel: string;
  unitsRemoved: number;
  currentStock: number;
  nextStock: number;
}

export interface EfashionStockPreviewLine {
  efashionOrderItemId: string;
  reference: string;
  productName: string | null;
  colorLabel: string | null;
  qtyTotal: number;
  variantChanges: EfashionStockPreviewVariantChange[];
  skipReason?: EfashionStockDeductionSkipReason;
}

export interface EfashionStockPreview {
  orderId: string;
  orderNumber: string;
  lines: EfashionStockPreviewLine[];
  totalUnitsRemoved: number;
}

export async function simulateEfashionStockDeductionForOrder(
  tenantId: string,
  efashionOrderId: string,
): Promise<EfashionStockPreview | null> {
  const order = await prisma.efashionOrder.findFirst({
    where: { tenantId, id: efashionOrderId },
    select: { id: true, efashionOrderName: true, status: true },
  });
  if (!order) return null;

  const pending = await prisma.efashionOrderItem.findMany({
    where: {
      tenantId,
      efashionOrderId: order.id,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      efashionOrder: { status: "SHIPPED" },
    },
    select: {
      id: true,
      productId: true,
      productColorId: true,
      referenceFull: true,
      productSnapshotName: true,
      colorLabelFr: true,
      qtyTotal: true,
      quantitiesJson: true,
      declinaisonsJson: true,
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
  const lines: EfashionStockPreviewLine[] = [];
  let totalUnits = 0;

  for (const item of pending) {
    const variant = variantById.get(item.productColorId!);
    const base: EfashionStockPreviewLine = {
      efashionOrderItemId: item.id,
      reference: item.referenceFull,
      productName: item.productSnapshotName,
      colorLabel: item.colorLabelFr,
      qtyTotal: item.qtyTotal,
      variantChanges: [],
    };
    if (!variant) {
      lines.push({ ...base, skipReason: "VARIANT_NOT_LINKED" });
      continue;
    }
    if (item.qtyTotal <= 0) {
      lines.push({ ...base, skipReason: "QTY_ZERO" });
      continue;
    }

    const expanded = expandLineQuantitiesBySize(item.quantitiesJson, item.declinaisonsJson);
    const changes: EfashionStockPreviewVariantChange[] = [];
    let hasMatch = false;
    for (const bucket of expanded) {
      const sizeId = await resolveSizeIdFromEfashionLabel(
        tenantId,
        variant as VariantSlim,
        bucket.sizeLabelFr,
      );
      if (!sizeId) continue;
      hasMatch = true;
      const current = simulatedStock.get(variant.id) ?? variant.stock;
      const next = Math.max(0, current - bucket.units);
      simulatedStock.set(variant.id, next);
      changes.push({
        productColorId: variant.id,
        colorLabel: variant.color?.name ?? item.colorLabelFr ?? "—",
        sizeLabel: sizeNameById.get(sizeId) ?? bucket.sizeLabelFr ?? "—",
        unitsRemoved: bucket.units,
        currentStock: current,
        nextStock: next,
      });
      totalUnits += bucket.units;
    }
    if (!hasMatch) {
      lines.push({ ...base, skipReason: "NO_SIZE_MATCH" });
      continue;
    }
    lines.push({ ...base, variantChanges: changes });
  }

  return {
    orderId: order.id,
    orderNumber: order.efashionOrderName,
    lines,
    totalUnitsRemoved: totalUnits,
  };
}
