/**
 * eFashion Paris — Mise à jour ciblée d'un produit lié (Lot 3).
 *
 * Pré-requis : le produit doit déjà être lié côté eFashion via la modale
 * "Lier à un produit eFashion existant" (Lot 2). Chaque ProductColor a son
 * `efashionProductId`.
 *
 * Flux :
 *   1. Charge le produit + variantes liées
 *   2. Construit le snapshot cible (état désiré côté eFashion)
 *   3. Diff vs `Product.efashionLastSyncSnapshot`
 *   4. Pour chaque variant modifié : `efashionUpdateProduit` (visible, prix, poids)
 *   5. Pour le stock : `efashionSaveProduitStocks` en batch par efashionProductId
 *   6. Sauvegarde le snapshot
 *
 * Pas de fallback automatique sur publish — si la liaison est rompue, on
 * remonte l'erreur à l'admin pour qu'elle re-lie manuellement.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  efashionUpdateProduit,
  efashionSaveProduitStocks,
} from "@/lib/efashion-api-write";
import {
  diffEfashionSnapshots,
  hasAnyChanges,
  type EfashionSnapshot,
  type EfashionVariantSnapshot,
} from "@/lib/efashion-sync-diff";
import { loadEfashionMarkup, computeEfashionPrice } from "@/lib/efashion-pricing";

interface UpdateOpts {
  /** Si true, ignore le snapshot existant et renvoie tout — équivalent du « Resync » côté UI. */
  forceFullSync?: boolean;
}

export interface EfashionUpdateOutcome {
  success: boolean;
  error?: string;
  /** Nombre de variantes envoyées (mutations executées). */
  variantsUpdated?: number;
  stockMutationsCount?: number;
  /** Variants qui n'étaient pas liés et qu'on n'a pas pu mettre à jour. */
  unlinkedVariants?: number;
  noChanges?: boolean;
}

export async function efashionUpdateProductInPlace(
  productId: string,
  opts: UpdateOpts = {},
): Promise<EfashionUpdateOutcome> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      status: true,
      efashionReferenceBase: true,
      efashionLastSyncSnapshot: true,
      colors: {
        select: {
          id: true,
          colorId: true,
          efashionProductId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          saleType: true,
          packQuantity: true,
          disabled: true,
          variantSizes: {
            select: {
              quantity: true,
              size: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!product) return { success: false, error: "Produit introuvable" };
  if (!product.efashionReferenceBase) {
    return { success: false, error: "Produit non lié à eFashion (référence manquante)" };
  }

  const markup = await loadEfashionMarkup();

  const linkedColors = product.colors.filter((c) => c.efashionProductId !== null);
  const unlinkedCount = product.colors.length - linkedColors.length;

  if (linkedColors.length === 0) {
    return { success: false, error: "Aucune couleur de ce produit n'est liée à eFashion." };
  }

  // Construit le snapshot cible
  const targetVariants: EfashionVariantSnapshot[] = linkedColors.map((c) => {
    const efashionPrice = computeEfashionPrice({
      basePrice: Number(c.unitPrice),
      isPack: c.saleType === "PACK",
      packQuantity: c.packQuantity,
      markup,
    });
    // visible = ONLINE + variante non disabled + pas en rupture totale
    const totalStock =
      c.saleType === "PACK"
        ? c.stock
        : c.variantSizes.reduce((sum, vs) => sum + (vs.quantity ?? 0), 0);
    const visible = product.status === "ONLINE" && !c.disabled && totalStock > 0;

    // Stock par taille : pour UNIT, une entrée par taille ; pour PACK, juste "TU" (à confirmer)
    const stockByTaille: Record<string, number> = {};
    if (c.saleType === "UNIT" && c.variantSizes.length > 0) {
      for (const vs of c.variantSizes) {
        stockByTaille[vs.size.name] = vs.quantity ?? 0;
      }
    } else {
      stockByTaille[c.variantSizes[0]?.size.name ?? "TU"] = c.stock;
    }

    return {
      efashionProductId: c.efashionProductId as number,
      visible,
      prix: efashionPrice,
      poids: c.weight,
      stockByTaille,
    };
  });

  const target: EfashionSnapshot = {
    version: 1,
    referenceBase: product.efashionReferenceBase,
    variants: targetVariants,
  };

  const previousSnapshot = opts.forceFullSync
    ? null
    : (product.efashionLastSyncSnapshot as EfashionSnapshot | null);

  const diff = diffEfashionSnapshots(previousSnapshot, target);

  if (!hasAnyChanges(diff)) {
    return { success: true, noChanges: true, unlinkedVariants: unlinkedCount };
  }

  // Applique le diff
  let variantsUpdated = 0;
  let stockMutations = 0;
  const errors: string[] = [];

  // Champs basiques (visible / prix / poids) — 1 call par variant modifié
  const variantsToUpdate = [
    ...diff.added.map((v) => ({ variant: v, fields: ["visible", "prix", "poids"] as const })),
    ...diff.changed
      .filter((c) => c.fieldsChanged.length > 0)
      .map((c) => ({ variant: c.after, fields: c.fieldsChanged })),
  ];

  for (const { variant, fields } of variantsToUpdate) {
    try {
      const input: Parameters<typeof efashionUpdateProduit>[0] = {
        id_produit: variant.efashionProductId,
      };
      if (fields.includes("visible")) input.visible = variant.visible;
      if (fields.includes("prix")) input.prix = variant.prix;
      if (fields.includes("poids")) input.poids = variant.poids;
      await efashionUpdateProduit(input);
      variantsUpdated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`updateProduit(${variant.efashionProductId}): ${msg}`);
    }
  }

  // Stock — batch par variant. On utilise `id_couleur` qu'on retrouve via le mapping
  // local : pour chaque efashionProductId, on retrouve sa Color.efashionColorId.
  const efIdToColorId = new Map<number, number | null>();
  const colorRows = await prisma.color.findMany({
    where: {
      id: { in: linkedColors.map((c) => c.colorId).filter(Boolean) as string[] },
    },
    select: { id: true, efashionColorId: true },
  });
  const localColorIdToEfashion = new Map(colorRows.map((c) => [c.id, c.efashionColorId]));
  for (const lc of linkedColors) {
    if (lc.colorId && lc.efashionProductId) {
      efIdToColorId.set(lc.efashionProductId, localColorIdToEfashion.get(lc.colorId) ?? null);
    }
  }

  const stockItemsByEfId = new Map<
    number,
    Array<{ id_couleur: number; value: number; taille: string | null }>
  >();
  for (const v of [...diff.added, ...diff.changed.map((c) => c.after)]) {
    const idCouleur = efIdToColorId.get(v.efashionProductId);
    if (!idCouleur) continue; // on ne peut pas pousser le stock sans id_couleur eFashion
    const arr: Array<{ id_couleur: number; value: number; taille: string | null }> = [];
    for (const [taille, value] of Object.entries(v.stockByTaille)) {
      arr.push({ id_couleur: idCouleur, value, taille: taille === "TU" ? null : taille });
    }
    if (arr.length > 0) stockItemsByEfId.set(v.efashionProductId, arr);
  }

  for (const [efId, items] of stockItemsByEfId) {
    try {
      await efashionSaveProduitStocks({ id_produit: efId, items });
      stockMutations++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`saveProduitStocks(${efId}): ${msg}`);
    }
  }

  // Sauve le nouveau snapshot uniquement si on n'a pas d'erreur (sinon on
  // garderait un état faux dans la BDD et on rate les retries).
  if (errors.length === 0) {
    await prisma.product.update({
      where: { id: productId },
      data: {
        efashionLastSyncSnapshot: target as unknown as Prisma.InputJsonValue,
        efashionLastRefreshedAt: new Date(),
      },
    });
  } else {
    logger.warn("[eFashion] update finished with errors", {
      productId,
      errors,
    });
  }

  return {
    success: errors.length === 0,
    error: errors.length > 0 ? errors.join(" | ") : undefined,
    variantsUpdated,
    stockMutationsCount: stockMutations,
    unlinkedVariants: unlinkedCount,
  };
}
