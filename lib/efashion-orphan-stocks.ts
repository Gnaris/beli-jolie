/**
 * Nettoie les lignes stock orphelines côté eFashion pour un produit BJ lié.
 *
 * Contexte : `upsertProduitStock` crée une NOUVELLE ligne stock si le couple
 * (id_couleur, taille) ne matche pas une ligne existante — au lieu de remplacer.
 * Si le produit eFashion cible avait déjà du stock sur un id_couleur différent
 * (ex : mapping global BJ obsolète, ligne créée manuellement dans l'UI eFashion),
 * la sync post-liaison affiche un DOUBLE STOCK (ancien fantôme + nouveau réel).
 *
 * Détection : une ligne stock est orpheline si son `id_couleur` ne matche pas
 * celui du produit eFashion lui-même (`efLine.id_couleur`, source de vérité côté
 * eFashion). Toutes les lignes non-orphelines sont conservées telles quelles —
 * la sync qui suit ré-écrira leur `value` via `upsertProduitStock`.
 *
 * Appelé :
 *   - En préventif dans `linkEfashionProductManually` (avant la sync post-lien)
 *   - En curatif via `scripts/efashion-fix-stock-doubling.ts`
 */

import { prisma } from "@/lib/prisma";
import {
  efashionGetMe,
  efashionListByReferenceBaseExact,
  efashionListProduitStocks,
  type EfashionProduitStock,
} from "@/lib/efashion-api";
import { efashionRemoveProduitStock } from "@/lib/efashion-api-write";
import { logger } from "@/lib/logger";

export interface OrphanStockPlanEntry {
  colorName: string;
  efProductId: number;
  /** id_couleur « officiel » du produit eFashion (source de vérité). */
  efActualColorId: number;
  /** Lignes stock qui ne matchent pas efActualColorId → à supprimer. */
  orphanLines: EfashionProduitStock[];
}

export interface OrphanStockCleanupResult {
  plans: OrphanStockPlanEntry[];
  deletedCount: number;
  /** Nombre d'appels removeProduitStock qui ont échoué (best-effort). */
  failedCount: number;
}

/**
 * Analyse (dry-run par défaut) puis supprime les lignes stock orphelines
 * pour toutes les ProductColor UNIT du produit liées à eFashion.
 *
 * Si le produit n'est pas lié à eFashion (pas d'efashionReferenceBase), ou n'a
 * aucune ProductColor UNIT liée, ou aucun mismatch détecté, retourne un plan
 * vide sans erreur.
 *
 * IMPORTANT : appeler dans un contexte tenant (ALS bindé) — les queries Prisma
 * et les appels eFashion (credentials par tenant) en dépendent.
 *
 * @param productId cuid du Product BJ
 * @param apply si false (défaut), rapporte sans supprimer
 */
export async function cleanupOrphanEfashionStocks(
  productId: string,
  apply = false,
): Promise<OrphanStockCleanupResult> {
  const product = await prisma.product.findFirst({
    where: { id: productId },
    select: { id: true, efashionReferenceBase: true },
  });
  if (!product?.efashionReferenceBase) {
    return { plans: [], deletedCount: 0, failedCount: 0 };
  }

  const productColors = await prisma.productColor.findMany({
    where: {
      productId,
      saleType: "UNIT",
      efashionProductId: { not: null },
    },
    select: {
      efashionProductId: true,
      color: { select: { name: true } },
    },
  });
  if (productColors.length === 0) {
    return { plans: [], deletedCount: 0, failedCount: 0 };
  }

  const vendor = await efashionGetMe();
  const efItems = await efashionListByReferenceBaseExact({
    idVendeur: vendor.id_vendeur,
    referenceBase: product.efashionReferenceBase,
    premelFilter: "tous",
  });
  const efLineById = new Map(efItems.map((it) => [it.id_produit, it]));

  const plans: OrphanStockPlanEntry[] = [];
  for (const pc of productColors) {
    if (!pc.efashionProductId || !pc.color) continue;
    const efLine = efLineById.get(pc.efashionProductId);
    // Produit eFashion introuvable pour cet efProductId (peut arriver si la
    // ligne a été supprimée côté eFashion entre la liaison et le cleanup).
    // On saute — la sync suivante détectera l'orpheline via `computeOrphanEfashionIds`.
    if (!efLine) continue;
    const allStocks = await efashionListProduitStocks(pc.efashionProductId);
    const orphans = allStocks.filter((s) => s.id_couleur !== efLine.id_couleur);
    if (orphans.length > 0) {
      plans.push({
        colorName: pc.color.name,
        efProductId: pc.efashionProductId,
        efActualColorId: efLine.id_couleur,
        orphanLines: orphans,
      });
    }
  }

  if (!apply || plans.length === 0) {
    return { plans, deletedCount: 0, failedCount: 0 };
  }

  let deletedCount = 0;
  let failedCount = 0;
  for (const p of plans) {
    for (const line of p.orphanLines) {
      try {
        await efashionRemoveProduitStock(line.id_produit_stock);
        deletedCount += 1;
      } catch (err) {
        failedCount += 1;
        logger.warn("[eFashion cleanup] removeProduitStock KO", {
          id_produit_stock: line.id_produit_stock,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  logger.info("[eFashion cleanup] Lignes stock orphelines supprimées", {
    productId,
    deletedCount,
    failedCount,
    plansCount: plans.length,
  });

  return { plans, deletedCount, failedCount };
}
