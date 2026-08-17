import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { pickFirstImage } from "@/lib/pick-first-image";

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
  /** Lignes PFS marquées « exclues manuellement » via la modale de prévisualisation. */
  excludedItemsCount: number;
  /** IDs des produits exclus (le stock n'a PAS été modifié pour ces produits). */
  excludedProductIds: string[];
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
      stockDeductionExcludedAt: null,
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

interface ResolvedItem {
  itemId: string;
  productId: string;
  orderNumber: string;
  pfsSku: string;
  consumptions: { variantId: string; sizeId: string; units: number }[];
}

/**
 * Applique les décrémentations. Idempotent : ne traite que les lignes dont
 * stockDeductedAt IS NULL. Stratégie agrégée (une seule passe DB par produit) :
 *  1. Charge toutes les lignes en attente (ordonnées FIFO par date PFS).
 *  2. Résout chaque ligne en (variantId UNIT, sizeId, units) ou la marque skipped.
 *  3. Regroupe par produit puis, en simulant le stock en mémoire, calcule :
 *      - le stock final par variante UNIT (1 UPDATE par variante, pas par ligne).
 *      - le delta réel par ligne pour créer 1 StockMovement par commande (traçabilité).
 *      - la cascade PACK une seule fois par produit (recalcul min sur composants).
 *  4. 1 transaction Prisma par produit : updates variants + createMany StockMovement +
 *     updateMany PfsOrderItem.stockDeductedAt.
 *  5. 1 updateMany global pour Product.important = true.
 *
 * Sortie : compteur + liste des lignes sautées + IDs produits/variantes touchés
 * (pour permettre à l'UI de proposer une action marketplace derrière).
 */
export interface DeductStockOptions {
  /** Restreint aux commandes indiquées (utile pour le bouton unitaire par commande). */
  pfsOrderIds?: string[];
  /**
   * Liste d'IDs produit à exclure : les lignes PFS rattachées à ces produits ne
   * déduisent PAS le stock mais sont marquées `stockDeductionExcludedAt = now`
   * pour ne plus jamais réapparaître dans la file. Action irréversible côté UI.
   */
  excludedProductIds?: string[];
}

export async function deductStockFromPfsOrders(
  tenantId: string,
  actorUserId: string | null,
  opts?: DeductStockOptions,
): Promise<PfsStockDeductionResult> {
  const pfsOrderIds = opts?.pfsOrderIds;
  const excludedProductIds = opts?.excludedProductIds ?? [];
  const excludedSet = new Set(excludedProductIds);

  const pending = await prisma.pfsOrderItem.findMany({
    where: {
      tenantId,
      stockDeductedAt: null,
      stockDeductionExcludedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      pfsOrder: { status: { in: ["VALIDATED", "SENT"] } },
      ...(pfsOrderIds && pfsOrderIds.length > 0 ? { pfsOrderId: { in: pfsOrderIds } } : {}),
    },
    orderBy: [{ pfsOrder: { createdAtPfs: "asc" } }, { id: "asc" }],
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

  // Sépare tout de suite les lignes des produits exclus : elles seront marquées
  // comme traitées (excludedAt) sans jamais entrer dans la simulation stock.
  const excludedItemIds: string[] = [];
  const eligiblePending: typeof pending = [];
  for (const p of pending) {
    if (p.productId && excludedSet.has(p.productId)) {
      excludedItemIds.push(p.id);
    } else {
      eligiblePending.push(p);
    }
  }

  const skipped: PfsStockDeductionSkip[] = [];
  const touchedVariantIds = new Set<string>();
  const touchedProductIds = new Set<string>();

  // Marque immédiatement les lignes des produits exclus (avant tout early-return).
  const now = new Date();
  if (excludedItemIds.length > 0) {
    await prisma.pfsOrderItem.updateMany({
      where: { tenantId, id: { in: excludedItemIds } },
      data: { stockDeductionExcludedAt: now },
    });
  }

  if (eligiblePending.length === 0) {
    return {
      processedCount: 0,
      skipped,
      touchedProductIds: [],
      touchedVariantIds: [],
      excludedItemsCount: excludedItemIds.length,
      excludedProductIds: Array.from(excludedSet),
    };
  }

  const uniqueProductIds = Array.from(new Set(eligiblePending.map((p) => p.productId!).filter(Boolean)));
  const bundles = await loadProductBundles(uniqueProductIds, tenantId);

  // Phase 1 : résout chaque ligne en consommations (variantId UNIT, sizeId, units)
  // ou la met dans `skipped`. Ordre FIFO préservé pour l'allocation delta.
  const resolvedByProduct = new Map<string, ResolvedItem[]>();

  for (const item of eligiblePending) {
    const productId = item.productId!;
    const bundle = bundles.get(productId);
    const pushSkip = (reason: PfsStockDeductionSkipReason) => {
      skipped.push({
        pfsOrderItemId: item.id,
        pfsOrderNumber: item.pfsOrder.orderNumber,
        pfsSku: item.pfsSku,
        colorLabel: item.colorLabelFr,
        sizeLabel: item.sizeLabel,
        reason,
      });
    };

    if (!bundle) {
      pushSkip("PRODUCT_NOT_LINKED");
      continue;
    }
    const soldVariant = bundle.variants.find((v) => v.id === item.productColorId);
    if (!soldVariant) {
      pushSkip("VARIANT_NOT_LINKED");
      continue;
    }
    if (item.qtyValidated <= 0) {
      pushSkip("QTY_ZERO");
      continue;
    }

    // Pour un PACK, PFS n'envoie pas de taille (le paquet a une composition interne).
    // On ne bloque sur SIZE_UNKNOWN que pour les ventes UNIT.
    const sizeId = await resolveSizeIdFromLabel(tenantId, item.sizeLabel);
    if (soldVariant.saleType === "UNIT" && !sizeId) {
      pushSkip("SIZE_UNKNOWN");
      continue;
    }

    // UNIT : 1 conso (couleur vendue, taille PFS, qtyValidated).
    // PACK mono-couleur : 1 conso par variantSize (× qtyValidated).
    // PACK multi-couleurs : 1 conso par packLine/size (× qtyValidated).
    const rawConsumptions: { colorId: string; sizeId: string; units: number }[] = [];

    if (soldVariant.saleType === "UNIT") {
      if (!soldVariant.colorId || !sizeId) {
        pushSkip("VARIANT_NOT_LINKED");
        continue;
      }
      rawConsumptions.push({ colorId: soldVariant.colorId, sizeId, units: item.qtyValidated });
    } else if (soldVariant.packLines.length > 0) {
      for (const line of soldVariant.packLines) {
        for (const s of line.sizes) {
          if (s.quantity > 0) rawConsumptions.push({ colorId: line.colorId, sizeId: s.sizeId, units: s.quantity * item.qtyValidated });
        }
      }
    } else if (soldVariant.colorId) {
      for (const s of soldVariant.variantSizes) {
        if (s.quantity > 0) rawConsumptions.push({ colorId: soldVariant.colorId, sizeId: s.sizeId, units: s.quantity * item.qtyValidated });
      }
    } else {
      pushSkip("VARIANT_NOT_LINKED");
      continue;
    }

    // Résout chaque (colorId, sizeId) en variantId UNIT.
    const consumptions: { variantId: string; sizeId: string; units: number }[] = [];
    let missedUnit = false;
    for (const c of rawConsumptions) {
      const unit = findUnitVariant(bundle, c.colorId, c.sizeId);
      if (!unit) {
        missedUnit = true;
        break;
      }
      consumptions.push({ variantId: unit.id, sizeId: c.sizeId, units: c.units });
    }
    if (missedUnit || consumptions.length === 0) {
      pushSkip("UNIT_VARIANT_NOT_FOUND");
      continue;
    }

    let list = resolvedByProduct.get(productId);
    if (!list) {
      list = [];
      resolvedByProduct.set(productId, list);
    }
    list.push({
      itemId: item.id,
      productId,
      orderNumber: item.pfsOrder.orderNumber,
      pfsSku: item.pfsSku,
      consumptions,
    });
  }

  // Phase 2 : par produit, simule l'allocation FIFO sur le stock UNIT, calcule
  // les StockMovements par ligne (delta réel après clamp à 0), la cascade PACK,
  // puis applique tout dans une seule transaction.
  let processedCount = 0;

  for (const [productId, resolvedItems] of resolvedByProduct) {
    const bundle = bundles.get(productId);
    if (!bundle) continue;

    const initialStock = new Map<string, number>();
    const runningStock = new Map<string, number>();
    for (const v of bundle.variants) {
      if (v.saleType === "UNIT") {
        initialStock.set(v.id, v.stock);
        runningStock.set(v.id, v.stock);
      }
    }

    const movements: { variantId: string; sizeId: string; quantity: number; reason: string }[] = [];
    for (const ri of resolvedItems) {
      for (const c of ri.consumptions) {
        const before = runningStock.get(c.variantId) ?? 0;
        const after = Math.max(0, before - c.units);
        const delta = after - before; // <= 0
        runningStock.set(c.variantId, after);
        if (delta !== 0) {
          movements.push({
            variantId: c.variantId,
            sizeId: c.sizeId,
            quantity: delta,
            reason: `PFS ${ri.orderNumber} (SKU ${ri.pfsSku})`,
          });
        }
      }
    }

    // UNIT variants dont le stock final diffère du stock initial.
    const changedUnitVariants: { id: string; stock: number }[] = [];
    for (const [vid, finalStock] of runningStock) {
      if (initialStock.get(vid) !== finalStock) {
        changedUnitVariants.push({ id: vid, stock: finalStock });
        const v = bundle.variants.find((x) => x.id === vid);
        if (v) v.stock = finalStock;
      }
    }

    // Cascade PACK : recalcule chaque PACK à partir des UNIT mis à jour.
    const changedPackVariants: { id: string; stock: number }[] = [];
    for (const v of bundle.variants) {
      if (v.saleType !== "PACK") continue;
      const available = computePackAvailability(v, bundle);
      if (available !== v.stock) {
        changedPackVariants.push({ id: v.id, stock: available });
        v.stock = available;
      }
    }

    await prisma.$transaction(async (tx) => {
      // Décrément atomique (audit checkout 2026-08-17 §6) : au lieu d'un
      // update {stock: absolu} calculé hors-tx (race avec ventes boutique
      // concurrentes), on soustrait le delta avec un WHERE stock >= delta.
      // Si count=0, une vente boutique est passée entre-temps : on clamp
      // à 0 et on log un warning pour visibilité.
      for (const cv of changedUnitVariants) {
        const initial = initialStock.get(cv.id) ?? 0;
        const delta = initial - cv.stock; // > 0 (on ne fait que décrémenter)
        if (delta <= 0) {
          await tx.productColor.update({ where: { id: cv.id }, data: { stock: cv.stock } });
        } else {
          const dec = await tx.productColor.updateMany({
            where: { id: cv.id, stock: { gte: delta } },
            data: { stock: { decrement: delta } },
          });
          if (dec.count === 0) {
            const current = await tx.productColor.findUnique({
              where: { id: cv.id },
              select: { stock: true },
            });
            const available = current?.stock ?? 0;
            if (available > 0) {
              await tx.productColor.update({ where: { id: cv.id }, data: { stock: 0 } });
            }
            logger.warn("[PFS Stock] Survente — clamp stock à 0", {
              variantId: cv.id,
              requestedDelta: delta,
              appliedDelta: available,
              missing: delta - available,
            });
          }
        }
        touchedVariantIds.add(cv.id);
      }
      for (const cv of changedPackVariants) {
        // PACK stock = fonction dérivée des UNIT via computePackAvailability.
        // C'est une valeur recalculée, pas une décrémentation → set absolu OK.
        await tx.productColor.update({ where: { id: cv.id }, data: { stock: cv.stock } });
        touchedVariantIds.add(cv.id);
      }
      if (movements.length > 0) {
        await tx.stockMovement.createMany({
          data: movements.map((m) => ({
            tenantId,
            productColorId: m.variantId,
            sizeId: m.sizeId,
            quantity: m.quantity,
            type: "ORDER" as const,
            reason: m.reason,
            createdById: actorUserId ?? undefined,
          })),
        });
      }
      await tx.pfsOrderItem.updateMany({
        where: { id: { in: resolvedItems.map((r) => r.itemId) } },
        data: { stockDeductedAt: now },
      });
    });

    processedCount += resolvedItems.length;
    touchedProductIds.add(productId);
  }

  if (touchedProductIds.size > 0) {
    await prisma.product.updateMany({
      where: { tenantId, id: { in: Array.from(touchedProductIds) } },
      data: { important: true },
    });

    // Rotation auto couleur principale après déduction de stock côté PFS.
    // On est ici dans un worker (hors HTTP) → tenantId explicite obligatoire.
    const { rotatePrimaryIfNeeded } = await import("@/lib/rotate-primary-service");
    for (const pid of touchedProductIds) {
      await rotatePrimaryIfNeeded(pid, { tenantId }).catch((err) =>
        logger.error("[PFS Stock] rotatePrimary error", { error: err, productId: pid }),
      );
    }
  }

  logger.info(
    `[PFS Stock] Déduction terminée : ${processedCount} lignes traitées, ${skipped.length} sautées, ${touchedProductIds.size} produits touchés, ${excludedItemIds.length} lignes exclues manuellement (${excludedSet.size} produits).`,
  );

  return {
    processedCount,
    skipped,
    touchedProductIds: Array.from(touchedProductIds),
    touchedVariantIds: Array.from(touchedVariantIds),
    excludedItemsCount: excludedItemIds.length,
    excludedProductIds: Array.from(excludedSet),
  };
}

// ─────────────────────────────────────────────
// Prévisualisation d'une déduction (simulation)
// ─────────────────────────────────────────────

export interface PfsStockPreviewVariantChange {
  productColorId: string;
  colorLabel: string;
  sizeLabel: string;
  unitsRemoved: number;
  currentStock: number;
  nextStock: number;
}

export interface PfsStockPreviewLine {
  pfsOrderItemId: string;
  pfsProductRef: string;
  productName: string | null;
  colorLabel: string | null;
  sizeLabel: string | null;
  qtyValidated: number;
  saleType: "UNIT" | "PACK";
  variantChanges: PfsStockPreviewVariantChange[];
  skipReason?: PfsStockDeductionSkipReason;
}

export interface PfsStockPreview {
  orderId: string;
  orderNumber: string;
  lines: PfsStockPreviewLine[];
  totalUnitsRemoved: number;
}

/**
 * Simule la déduction stock d'une commande PFS pour la modale de prévisualisation.
 * Ne persiste rien — reproduit uniquement la logique de `deductStockFromPfsOrders`
 * en mémoire pour montrer à la cliente : « stock actuel → nouveau stock » par variante.
 */
export async function simulatePfsStockDeductionForOrder(
  tenantId: string,
  pfsOrderId: string,
): Promise<PfsStockPreview | null> {
  const order = await prisma.pfsOrder.findFirst({
    where: { tenantId, id: pfsOrderId },
    select: { id: true, orderNumber: true, status: true },
  });
  if (!order) return null;

  const pending = await prisma.pfsOrderItem.findMany({
    where: {
      tenantId,
      pfsOrderId: order.id,
      stockDeductedAt: null,
      stockDeductionExcludedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      pfsOrder: { status: { in: ["VALIDATED", "SENT"] } },
    },
    select: {
      id: true,
      pfsProductRef: true,
      productId: true,
      productColorId: true,
      pfsSku: true,
      productSnapshotName: true,
      colorLabelFr: true,
      sizeLabel: true,
      qtyValidated: true,
    },
  });

  const uniqueProductIds = Array.from(new Set(pending.map((p) => p.productId!).filter(Boolean)));
  const bundles = await loadProductBundles(uniqueProductIds, tenantId);

  // Charge les libellés (couleur / taille) des ProductColor + Sizes pour un rendu propre.
  const variantIds = new Set<string>();
  for (const b of bundles.values()) for (const v of b.variants) variantIds.add(v.id);
  const [variantsMeta, sizesMeta] = await Promise.all([
    prisma.productColor.findMany({
      where: { tenantId, id: { in: Array.from(variantIds) } },
      select: {
        id: true,
        saleType: true,
        color: { select: { id: true, name: true } },
        variantSizes: { select: { size: { select: { id: true, name: true } } } },
        packLines: {
          select: { color: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.size.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    }),
  ]);
  const colorNameByVariant = new Map<string, string>();
  for (const v of variantsMeta) {
    if (v.color?.name) colorNameByVariant.set(v.id, v.color.name);
  }
  // Map colorId → colorName pour retrouver le libellé côté PACK.
  const colorNameByColorId = new Map<string, string>();
  for (const v of variantsMeta) {
    if (v.color?.id && v.color.name) colorNameByColorId.set(v.color.id, v.color.name);
    for (const pl of v.packLines) {
      if (pl.color?.id && pl.color.name) colorNameByColorId.set(pl.color.id, pl.color.name);
    }
  }
  const sizeNameById = new Map(sizesMeta.map((s) => [s.id, s.name]));

  // Retrouve la variante UNIT (colorId + sizeId).
  const findUnit = (bundle: ProductBundle, colorId: string, sizeId: string) =>
    findUnitVariant(bundle, colorId, sizeId);

  // Stock courant simulé par variantId (partagé entre lignes pour cumuler correctement
  // si plusieurs items PFS attaquent la même variante).
  const simulatedStock = new Map<string, number>();

  const lines: PfsStockPreviewLine[] = [];
  let totalUnits = 0;

  for (const item of pending) {
    const productId = item.productId!;
    const bundle = bundles.get(productId);
    const baseLine: PfsStockPreviewLine = {
      pfsOrderItemId: item.id,
      pfsProductRef: item.pfsProductRef,
      productName: item.productSnapshotName,
      colorLabel: item.colorLabelFr,
      sizeLabel: item.sizeLabel,
      qtyValidated: item.qtyValidated,
      saleType: "UNIT",
      variantChanges: [],
    };

    if (!bundle) {
      lines.push({ ...baseLine, skipReason: "PRODUCT_NOT_LINKED" });
      continue;
    }
    const soldVariant = bundle.variants.find((v) => v.id === item.productColorId);
    if (!soldVariant) {
      lines.push({ ...baseLine, skipReason: "VARIANT_NOT_LINKED" });
      continue;
    }
    baseLine.saleType = soldVariant.saleType;
    if (item.qtyValidated <= 0) {
      lines.push({ ...baseLine, skipReason: "QTY_ZERO" });
      continue;
    }

    const sizeId = await resolveSizeIdFromLabel(tenantId, item.sizeLabel);
    if (!sizeId && soldVariant.saleType === "UNIT") {
      lines.push({ ...baseLine, skipReason: "SIZE_UNKNOWN" });
      continue;
    }

    const consumptions: { colorId: string; sizeId: string; units: number }[] = [];
    if (soldVariant.saleType === "UNIT") {
      if (!soldVariant.colorId || !sizeId) {
        lines.push({ ...baseLine, skipReason: "VARIANT_NOT_LINKED" });
        continue;
      }
      consumptions.push({ colorId: soldVariant.colorId, sizeId, units: item.qtyValidated });
    } else if (soldVariant.packLines.length > 0) {
      for (const line of soldVariant.packLines) {
        for (const s of line.sizes) {
          if (s.quantity > 0) {
            consumptions.push({ colorId: line.colorId, sizeId: s.sizeId, units: s.quantity * item.qtyValidated });
          }
        }
      }
    } else if (soldVariant.colorId) {
      for (const s of soldVariant.variantSizes) {
        if (s.quantity > 0) {
          consumptions.push({ colorId: soldVariant.colorId, sizeId: s.sizeId, units: s.quantity * item.qtyValidated });
        }
      }
    } else {
      lines.push({ ...baseLine, skipReason: "VARIANT_NOT_LINKED" });
      continue;
    }

    const changes: PfsStockPreviewVariantChange[] = [];
    let missedUnit = false;
    for (const c of consumptions) {
      const unit = findUnit(bundle, c.colorId, c.sizeId);
      if (!unit) {
        missedUnit = true;
        break;
      }
      const current = simulatedStock.get(unit.id) ?? unit.stock;
      const next = Math.max(0, current - c.units);
      simulatedStock.set(unit.id, next);
      changes.push({
        productColorId: unit.id,
        colorLabel: colorNameByColorId.get(c.colorId) ?? colorNameByVariant.get(unit.id) ?? "—",
        sizeLabel: sizeNameById.get(c.sizeId) ?? "—",
        unitsRemoved: c.units,
        currentStock: current,
        nextStock: next,
      });
      totalUnits += c.units;
    }
    if (missedUnit || changes.length === 0) {
      lines.push({ ...baseLine, skipReason: "UNIT_VARIANT_NOT_FOUND" });
      continue;
    }

    lines.push({ ...baseLine, variantChanges: changes });
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    lines,
    totalUnitsRemoved: totalUnits,
  };
}

// ─────────────────────────────────────────────
// Prévisualisation globale (regroupée par produit)
// ─────────────────────────────────────────────

export interface PfsStockPreviewAllVariantChange {
  productColorId: string;
  colorLabel: string;
  sizeLabel: string;
  unitsRemoved: number;
  currentStock: number;
  nextStock: number;
}

export interface PfsStockPreviewAllProduct {
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  status: "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  totalUnitsRemoved: number;
  linesCount: number;
  orderNumbers: string[];
  variantChanges: PfsStockPreviewAllVariantChange[];
  skippedLinesCount: number;
  hasPack: boolean;
}

export interface PfsStockPreviewSkippedLine {
  pfsOrderItemId: string;
  pfsProductRef: string;
  productName: string | null;
  colorLabel: string | null;
  sizeLabel: string | null;
  reason: PfsStockDeductionSkipReason;
}

export interface PfsStockPreviewAll {
  products: PfsStockPreviewAllProduct[];
  skippedUnlinked: PfsStockPreviewSkippedLine[];
  totalPendingLines: number;
  totalUnitsRemoved: number;
}

/**
 * Simule la déduction complète (toutes les lignes PFS en attente sur le tenant)
 * et renvoie une vue agrégée PAR PRODUIT pour la modale de prévisualisation.
 * Ne persiste rien. Réutilise la même logique que `deductStockFromPfsOrders` :
 * clamp du stock à 0, cascade PACK non recalculée ici (l'affichage montre
 * seulement les variantes UNIT touchées, la cascade est appliquée à l'exécution).
 */
export async function simulatePfsStockDeductionAll(tenantId: string): Promise<PfsStockPreviewAll> {
  const pending = await prisma.pfsOrderItem.findMany({
    where: {
      tenantId,
      stockDeductedAt: null,
      stockDeductionExcludedAt: null,
      productId: { not: null },
      productColorId: { not: null },
      pfsOrder: { status: { in: ["VALIDATED", "SENT"] } },
    },
    orderBy: [{ pfsOrder: { createdAtPfs: "asc" } }, { id: "asc" }],
    select: {
      id: true,
      pfsProductRef: true,
      productId: true,
      productColorId: true,
      pfsSku: true,
      productSnapshotName: true,
      colorLabelFr: true,
      sizeLabel: true,
      qtyValidated: true,
      pfsOrder: { select: { orderNumber: true } },
    },
  });

  const empty: PfsStockPreviewAll = {
    products: [],
    skippedUnlinked: [],
    totalPendingLines: 0,
    totalUnitsRemoved: 0,
  };
  if (pending.length === 0) return empty;

  const uniqueProductIds = Array.from(new Set(pending.map((p) => p.productId!).filter(Boolean)));
  const bundles = await loadProductBundles(uniqueProductIds, tenantId);

  // Charge en parallèle : métadonnées produits (nom, ref, statut, image, primaryColorId)
  // + libellés couleurs/tailles pour un rendu propre.
  const [productMeta, images, variantsMeta, sizesMeta] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, id: { in: uniqueProductIds } },
      select: {
        id: true,
        reference: true,
        name: true,
        status: true,
        isIncomplete: true,
        primaryColorId: true,
        colors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: { colorId: true },
        },
      },
    }),
    prisma.productColorImage.findMany({
      where: { productId: { in: uniqueProductIds } },
      orderBy: { order: "asc" },
      select: { productId: true, colorId: true, path: true },
    }),
    prisma.productColor.findMany({
      where: { tenantId, productId: { in: uniqueProductIds } },
      select: {
        id: true,
        color: { select: { id: true, name: true } },
        packLines: { select: { color: { select: { id: true, name: true } } } },
      },
    }),
    prisma.size.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    }),
  ]);

  const imageByKey = new Map<string, string>();
  for (const img of images) {
    const key = `${img.productId}::${img.colorId}`;
    if (!imageByKey.has(key)) imageByKey.set(key, img.path);
  }
  const colorNameByColorId = new Map<string, string>();
  for (const v of variantsMeta) {
    if (v.color?.id && v.color.name) colorNameByColorId.set(v.color.id, v.color.name);
    for (const pl of v.packLines) {
      if (pl.color?.id && pl.color.name) colorNameByColorId.set(pl.color.id, pl.color.name);
    }
  }
  const sizeNameById = new Map(sizesMeta.map((s) => [s.id, s.name]));
  const productMetaById = new Map(productMeta.map((p) => [p.id, p]));

  // Buckets par produit — on cumule les consommations par (colorId, sizeId).
  interface Bucket {
    productId: string;
    hasPack: boolean;
    linesCount: number;
    skippedLinesCount: number;
    orderNumbers: Set<string>;
    // Somme d'unités par variante UNIT résolue (variantId).
    unitsByVariantId: Map<string, { colorId: string; sizeId: string; units: number }>;
  }
  const buckets = new Map<string, Bucket>();
  const skippedUnlinked: PfsStockPreviewSkippedLine[] = [];

  const getBucket = (productId: string): Bucket => {
    let b = buckets.get(productId);
    if (!b) {
      b = {
        productId,
        hasPack: false,
        linesCount: 0,
        skippedLinesCount: 0,
        orderNumbers: new Set<string>(),
        unitsByVariantId: new Map(),
      };
      buckets.set(productId, b);
    }
    return b;
  };

  for (const item of pending) {
    const productId = item.productId!;
    const bundle = bundles.get(productId);

    const pushUnlinked = (reason: PfsStockDeductionSkipReason) => {
      skippedUnlinked.push({
        pfsOrderItemId: item.id,
        pfsProductRef: item.pfsProductRef,
        productName: item.productSnapshotName,
        colorLabel: item.colorLabelFr,
        sizeLabel: item.sizeLabel,
        reason,
      });
    };

    if (!bundle || !productMetaById.has(productId)) {
      pushUnlinked("PRODUCT_NOT_LINKED");
      continue;
    }
    const soldVariant = bundle.variants.find((v) => v.id === item.productColorId);
    if (!soldVariant) {
      const bucket = getBucket(productId);
      bucket.linesCount += 1;
      bucket.skippedLinesCount += 1;
      bucket.orderNumbers.add(item.pfsOrder.orderNumber);
      continue;
    }
    if (item.qtyValidated <= 0) {
      const bucket = getBucket(productId);
      bucket.linesCount += 1;
      bucket.skippedLinesCount += 1;
      bucket.orderNumbers.add(item.pfsOrder.orderNumber);
      continue;
    }

    const sizeId = await resolveSizeIdFromLabel(tenantId, item.sizeLabel);
    if (soldVariant.saleType === "UNIT" && !sizeId) {
      const bucket = getBucket(productId);
      bucket.linesCount += 1;
      bucket.skippedLinesCount += 1;
      bucket.orderNumbers.add(item.pfsOrder.orderNumber);
      continue;
    }

    const rawConsumptions: { colorId: string; sizeId: string; units: number }[] = [];
    if (soldVariant.saleType === "UNIT") {
      if (!soldVariant.colorId || !sizeId) {
        const bucket = getBucket(productId);
        bucket.linesCount += 1;
        bucket.skippedLinesCount += 1;
        bucket.orderNumbers.add(item.pfsOrder.orderNumber);
        continue;
      }
      rawConsumptions.push({ colorId: soldVariant.colorId, sizeId, units: item.qtyValidated });
    } else if (soldVariant.packLines.length > 0) {
      for (const line of soldVariant.packLines) {
        for (const s of line.sizes) {
          if (s.quantity > 0) rawConsumptions.push({ colorId: line.colorId, sizeId: s.sizeId, units: s.quantity * item.qtyValidated });
        }
      }
    } else if (soldVariant.colorId) {
      for (const s of soldVariant.variantSizes) {
        if (s.quantity > 0) rawConsumptions.push({ colorId: soldVariant.colorId, sizeId: s.sizeId, units: s.quantity * item.qtyValidated });
      }
    } else {
      const bucket = getBucket(productId);
      bucket.linesCount += 1;
      bucket.skippedLinesCount += 1;
      bucket.orderNumbers.add(item.pfsOrder.orderNumber);
      continue;
    }

    let missedUnit = false;
    const resolvedConsumptions: { variantId: string; colorId: string; sizeId: string; units: number }[] = [];
    for (const c of rawConsumptions) {
      const unit = findUnitVariant(bundle, c.colorId, c.sizeId);
      if (!unit) {
        missedUnit = true;
        break;
      }
      resolvedConsumptions.push({ variantId: unit.id, colorId: c.colorId, sizeId: c.sizeId, units: c.units });
    }
    if (missedUnit || resolvedConsumptions.length === 0) {
      const bucket = getBucket(productId);
      bucket.linesCount += 1;
      bucket.skippedLinesCount += 1;
      bucket.orderNumbers.add(item.pfsOrder.orderNumber);
      continue;
    }

    const bucket = getBucket(productId);
    bucket.linesCount += 1;
    bucket.orderNumbers.add(item.pfsOrder.orderNumber);
    if (soldVariant.saleType === "PACK") bucket.hasPack = true;
    for (const rc of resolvedConsumptions) {
      const existing = bucket.unitsByVariantId.get(rc.variantId);
      if (existing) {
        existing.units += rc.units;
      } else {
        bucket.unitsByVariantId.set(rc.variantId, { colorId: rc.colorId, sizeId: rc.sizeId, units: rc.units });
      }
    }
  }

  const products: PfsStockPreviewAllProduct[] = [];
  let totalUnits = 0;

  for (const [productId, bucket] of buckets) {
    const meta = productMetaById.get(productId)!;
    const bundle = bundles.get(productId);
    const variantChanges: PfsStockPreviewAllVariantChange[] = [];

    for (const [variantId, agg] of bucket.unitsByVariantId) {
      const variant = bundle?.variants.find((v) => v.id === variantId);
      const currentStock = variant?.stock ?? 0;
      const nextStock = Math.max(0, currentStock - agg.units);
      variantChanges.push({
        productColorId: variantId,
        colorLabel: colorNameByColorId.get(agg.colorId) ?? "—",
        sizeLabel: sizeNameById.get(agg.sizeId) ?? "—",
        unitsRemoved: agg.units,
        currentStock,
        nextStock,
      });
      totalUnits += agg.units;
    }

    // Tri stable des variantes : couleur A→Z puis taille A→Z.
    variantChanges.sort((a, b) => {
      const c = a.colorLabel.localeCompare(b.colorLabel, "fr");
      if (c !== 0) return c;
      return a.sizeLabel.localeCompare(b.sizeLabel, "fr", { numeric: true });
    });

    const firstImage = pickFirstImage(
      { primaryColorId: meta.primaryColorId, colors: meta.colors },
      (colorId) => (colorId ? imageByKey.get(`${productId}::${colorId}`) ?? null : null),
    );

    products.push({
      productId,
      reference: meta.reference,
      productName: meta.name,
      firstImage,
      status: meta.status as "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING",
      isIncomplete: meta.isIncomplete,
      totalUnitsRemoved: variantChanges.reduce((s, v) => s + v.unitsRemoved, 0),
      linesCount: bucket.linesCount,
      orderNumbers: Array.from(bucket.orderNumbers).sort(),
      variantChanges,
      skippedLinesCount: bucket.skippedLinesCount,
      hasPack: bucket.hasPack,
    });
  }

  // Tri : produits avec le plus d'unités retirées d'abord (les plus impactants).
  products.sort((a, b) => b.totalUnitsRemoved - a.totalUnitsRemoved || a.reference.localeCompare(b.reference));

  return {
    products,
    skippedUnlinked,
    totalPendingLines: pending.length,
    totalUnitsRemoved: totalUnits,
  };
}
