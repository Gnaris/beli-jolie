import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type PfsStockDeductionSkipReason =
  | "PRODUCT_NOT_LINKED"
  | "VARIANT_NOT_LINKED"
  | "SIZE_UNKNOWN"
  | "UNIT_VARIANT_NOT_FOUND"
  | "QTY_ZERO";

export interface PfsStockDeductionSkip {
  pfsOrderItemId: string;
  pfsOrderNumber: string;
  pfsSku: string;
  colorLabel: string | null;
  sizeLabel: string | null;
  reason: PfsStockDeductionSkipReason;
}

export interface PfsStockDeductionResult {
  processedCount: number;
  skipped: PfsStockDeductionSkip[];
  touchedProductIds: string[];
  touchedVariantIds: string[];
}

interface UnitVariantSlim {
  id: string;
  colorId: string | null;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  stock: number;
  variantSizes: { sizeId: string; quantity: number }[];
  packLines: {
    colorId: string;
    sizes: { sizeId: string; quantity: number }[];
  }[];
}

interface ProductBundle {
  productId: string;
  variants: UnitVariantSlim[];
}

export async function countPendingPfsStockDeductions(tenantId: string): Promise<number> {
  return prisma.pfsOrderItem.count({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      pfsOrder: { status: { in: ["VALIDATED", "SENT"] } },
    },
  });
}

async function loadProductBundles(productIds: string[], tenantId: string): Promise<Map<string, ProductBundle>> {
  if (productIds.length === 0) return new Map();
  const products = await prisma.product.findMany({
    where: { tenantId, id: { in: productIds } },
    select: {
      id: true,
      colors: {
        select: {
          id: true,
          colorId: true,
          saleType: true,
          packQuantity: true,
          stock: true,
          variantSizes: { select: { sizeId: true, quantity: true } },
          packLines: {
            select: {
              colorId: true,
              sizes: { select: { sizeId: true, quantity: true } },
            },
          },
        },
      },
    },
  });
  const map = new Map<string, ProductBundle>();
  for (const p of products) {
    map.set(p.id, {
      productId: p.id,
      variants: p.colors.map((c) => ({
        id: c.id,
        colorId: c.colorId,
        saleType: c.saleType,
        packQuantity: c.packQuantity,
        stock: c.stock,
        variantSizes: c.variantSizes,
        packLines: c.packLines.map((pl) => ({
          colorId: pl.colorId,
          sizes: pl.sizes,
        })),
      })),
    });
  }
  return map;
}

/**
 * Retrouve la variante UNIT (colorId + sizeId) dans un produit.
 * Convention Beli & Jolie : une variante UNIT a exactement une VariantSize.
 */
function findUnitVariant(bundle: ProductBundle, colorId: string, sizeId: string): UnitVariantSlim | null {
  for (const v of bundle.variants) {
    if (v.saleType !== "UNIT") continue;
    if (v.colorId !== colorId) continue;
    if (v.variantSizes.some((vs) => vs.sizeId === sizeId)) return v;
  }
  return null;
}

/**
 * Calcule le stock disponible d'une variante PACK à partir des stocks des variantes UNIT
 * qui composent le pack. Mono-couleur : itère sur variantSizes. Multi-couleurs : itère
 * sur packLines. Retourne 0 si un composant n'a pas de variante UNIT correspondante.
 */
function computePackAvailability(pack: UnitVariantSlim, bundle: ProductBundle): number {
  if (pack.saleType !== "PACK") return pack.stock;
  let minPacks = Infinity;
  const isMultiColor = pack.packLines.length > 0;

  if (isMultiColor) {
    for (const line of pack.packLines) {
      for (const s of line.sizes) {
        if (s.quantity <= 0) continue;
        const unit = findUnitVariant(bundle, line.colorId, s.sizeId);
        if (!unit) return 0;
        const canMake = Math.floor(unit.stock / s.quantity);
        if (canMake < minPacks) minPacks = canMake;
      }
    }
  } else {
    if (!pack.colorId) return 0;
    for (const s of pack.variantSizes) {
      if (s.quantity <= 0) continue;
      const unit = findUnitVariant(bundle, pack.colorId, s.sizeId);
      if (!unit) return 0;
      const canMake = Math.floor(unit.stock / s.quantity);
      if (canMake < minPacks) minPacks = canMake;
    }
  }

  if (!Number.isFinite(minPacks)) return 0;
  return Math.max(0, minPacks);
}

/**
 * Retrouve le sizeId côté site à partir du sizeLabel envoyé par PFS.
 * Priorité : pfsSizeRef exact → name exact → name en minuscules.
 */
async function resolveSizeIdFromLabel(tenantId: string, sizeLabel: string | null): Promise<string | null> {
  if (!sizeLabel) return null;
  const trimmed = sizeLabel.trim();
  if (!trimmed) return null;
  const candidates = await prisma.size.findMany({
    where: {
      tenantId,
      OR: [
        { pfsSizeRef: trimmed },
        { name: trimmed },
      ],
    },
    select: { id: true, pfsSizeRef: true, name: true },
  });
  const byPfsRef = candidates.find((s) => s.pfsSizeRef === trimmed);
  if (byPfsRef) return byPfsRef.id;
  const byName = candidates.find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  return byName ? byName.id : null;
}

/**
 * Applique les décrémentations. Idempotent : ne traite que les lignes dont
 * stockDeductedAt IS NULL. Sur chaque ligne :
 *  - retrouve la ProductColor cible (via productColorId de l'import).
 *  - calcule les unités physiques (× packQuantity si PACK).
 *  - retrouve la variante UNIT (colorId + sizeId) à décrémenter.
 *  - décrémente son stock (floor 0).
 *  - recalcule le stock des variantes PACK impactées (min sur composants).
 *  - crée un StockMovement type ORDER par ligne.
 *  - passe Product.important = true.
 *  - marque PfsOrderItem.stockDeductedAt = now().
 *
 * Sortie : compteur + liste des lignes sautées + IDs produits/variantes touchés
 * (pour permettre à l'UI de proposer une action marketplace derrière).
 */
export async function deductStockFromPfsOrders(tenantId: string, actorUserId: string | null): Promise<PfsStockDeductionResult> {
  const pending = await prisma.pfsOrderItem.findMany({
    where: {
      tenantId,
      stockDeductedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      pfsOrder: { status: { in: ["VALIDATED", "SENT"] } },
    },
    select: {
      id: true,
      productId: true,
      productColorId: true,
      pfsSku: true,
      colorLabelFr: true,
      sizeLabel: true,
      qtyValidated: true,
      pfsOrder: { select: { orderNumber: true } },
    },
  });

  const skipped: PfsStockDeductionSkip[] = [];
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

  const uniqueProductIds = Array.from(new Set(pending.map((p) => p.productId!).filter(Boolean)));
  const bundles = await loadProductBundles(uniqueProductIds, tenantId);

  const now = new Date();
  let processedCount = 0;

  for (const item of pending) {
    const productId = item.productId!;
    const bundle = bundles.get(productId);
    if (!bundle) {
      skipped.push({
        pfsOrderItemId: item.id,
        pfsOrderNumber: item.pfsOrder.orderNumber,
        pfsSku: item.pfsSku,
        colorLabel: item.colorLabelFr,
        sizeLabel: item.sizeLabel,
        reason: "PRODUCT_NOT_LINKED",
      });
      continue;
    }
    const soldVariant = bundle.variants.find((v) => v.id === item.productColorId);
    if (!soldVariant) {
      skipped.push({
        pfsOrderItemId: item.id,
        pfsOrderNumber: item.pfsOrder.orderNumber,
        pfsSku: item.pfsSku,
        colorLabel: item.colorLabelFr,
        sizeLabel: item.sizeLabel,
        reason: "VARIANT_NOT_LINKED",
      });
      continue;
    }
    if (item.qtyValidated <= 0) {
      skipped.push({
        pfsOrderItemId: item.id,
        pfsOrderNumber: item.pfsOrder.orderNumber,
        pfsSku: item.pfsSku,
        colorLabel: item.colorLabelFr,
        sizeLabel: item.sizeLabel,
        reason: "QTY_ZERO",
      });
      continue;
    }

    const sizeId = await resolveSizeIdFromLabel(tenantId, item.sizeLabel);
    if (!sizeId) {
      skipped.push({
        pfsOrderItemId: item.id,
        pfsOrderNumber: item.pfsOrder.orderNumber,
        pfsSku: item.pfsSku,
        colorLabel: item.colorLabelFr,
        sizeLabel: item.sizeLabel,
        reason: "SIZE_UNKNOWN",
      });
      continue;
    }

    // Calcule les mouvements UNIT à appliquer (map sizeId → quantité à retirer).
    // UNIT vendu : (colorId=couleur soldée, sizeId=taille PFS, qty=qtyValidated).
    // PACK mono-couleur vendu : chaque composant multiplié par qtyValidated.
    // PACK multi-couleurs vendu : chaque packLine/size multiplié par qtyValidated.
    const consumptions: { colorId: string; sizeId: string; units: number }[] = [];

    if (soldVariant.saleType === "UNIT") {
      if (!soldVariant.colorId) {
        skipped.push({
          pfsOrderItemId: item.id,
          pfsOrderNumber: item.pfsOrder.orderNumber,
          pfsSku: item.pfsSku,
          colorLabel: item.colorLabelFr,
          sizeLabel: item.sizeLabel,
          reason: "VARIANT_NOT_LINKED",
        });
        continue;
      }
      consumptions.push({ colorId: soldVariant.colorId, sizeId, units: item.qtyValidated });
    } else {
      // PACK. PFS envoie qtyValidated = nombre de PACKS. On multiplie par la composition.
      if (soldVariant.packLines.length > 0) {
        for (const line of soldVariant.packLines) {
          for (const s of line.sizes) {
            if (s.quantity > 0) consumptions.push({ colorId: line.colorId, sizeId: s.sizeId, units: s.quantity * item.qtyValidated });
          }
        }
      } else if (soldVariant.colorId) {
        for (const s of soldVariant.variantSizes) {
          if (s.quantity > 0) consumptions.push({ colorId: soldVariant.colorId, sizeId: s.sizeId, units: s.quantity * item.qtyValidated });
        }
      } else {
        skipped.push({
          pfsOrderItemId: item.id,
          pfsOrderNumber: item.pfsOrder.orderNumber,
          pfsSku: item.pfsSku,
          colorLabel: item.colorLabelFr,
          sizeLabel: item.sizeLabel,
          reason: "VARIANT_NOT_LINKED",
        });
        continue;
      }
    }

    // Applique chaque consommation : trouve la variante UNIT correspondante et décrémente.
    const decrementApplied: { variantId: string; sizeId: string; units: number }[] = [];
    let missedUnit = false;
    for (const c of consumptions) {
      const unit = findUnitVariant(bundle, c.colorId, c.sizeId);
      if (!unit) {
        missedUnit = true;
        break;
      }
      decrementApplied.push({ variantId: unit.id, sizeId: c.sizeId, units: c.units });
    }
    if (missedUnit || decrementApplied.length === 0) {
      skipped.push({
        pfsOrderItemId: item.id,
        pfsOrderNumber: item.pfsOrder.orderNumber,
        pfsSku: item.pfsSku,
        colorLabel: item.colorLabelFr,
        sizeLabel: item.sizeLabel,
        reason: "UNIT_VARIANT_NOT_FOUND",
      });
      continue;
    }

    await prisma.$transaction(async (tx) => {
      for (const d of decrementApplied) {
        const current = bundle.variants.find((v) => v.id === d.variantId);
        if (!current) continue;
        const nextStock = Math.max(0, current.stock - d.units);
        const delta = nextStock - current.stock; // <= 0
        await tx.productColor.update({
          where: { id: d.variantId },
          data: { stock: nextStock },
        });
        current.stock = nextStock;
        touchedVariantIds.add(d.variantId);
        if (delta !== 0) {
          await tx.stockMovement.create({
            data: {
              tenantId,
              productColorId: d.variantId,
              sizeId: d.sizeId,
              quantity: delta,
              type: "ORDER",
              reason: `PFS ${item.pfsOrder.orderNumber} (SKU ${item.pfsSku})`,
              createdById: actorUserId ?? undefined,
            },
          });
        }
      }

      // Cascade PACK : pour chaque PACK du produit, recalcule le stock disponible.
      for (const v of bundle.variants) {
        if (v.saleType !== "PACK") continue;
        const available = computePackAvailability(v, bundle);
        if (available !== v.stock) {
          await tx.productColor.update({
            where: { id: v.id },
            data: { stock: available },
          });
          v.stock = available;
          touchedVariantIds.add(v.id);
        }
      }

      await tx.pfsOrderItem.update({
        where: { id: item.id },
        data: { stockDeductedAt: now },
      });
    });

    processedCount += 1;
    touchedProductIds.add(productId);
  }

  // Marque tous les produits touchés comme importants (un seul UPDATE global).
  if (touchedProductIds.size > 0) {
    await prisma.product.updateMany({
      where: { tenantId, id: { in: Array.from(touchedProductIds) } },
      data: { important: true },
    });
  }

  logger.info(
    `[PFS Stock] Déduction terminée : ${processedCount} lignes traitées, ${skipped.length} sautées, ${touchedProductIds.size} produits touchés.`,
  );

  return {
    processedCount,
    skipped,
    touchedProductIds: Array.from(touchedProductIds),
    touchedVariantIds: Array.from(touchedVariantIds),
  };
}
