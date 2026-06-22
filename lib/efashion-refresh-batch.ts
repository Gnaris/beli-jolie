/**
 * eFashion — Refresh groupé de N produits dans un seul shooting.
 *
 * Reproduit la mécanique de `lib/efashion-refresh.ts` (renommer ancien +
 * recréer + soft-delete ancien) mais en regroupant **l'étape de recréation**
 * de tous les produits dans un seul appel batch `efashionPublishProductsBatch`.
 * Conséquence : un seul ticket de shooting créé côté eFashion pour tous les
 * refresh combinés.
 *
 * Étapes :
 *   1. Pour chaque produit, lit l'état live des anciennes fiches (références,
 *      catégorie, etc. — nécessaires pour le renommage sans propagation prix)
 *   2. Renomme toutes les anciennes fiches en référence aléatoire DEL… (par
 *      produit, séquentiel)
 *   3. Vide les liens BJ (`efashionReferenceBase = null`, `efashionProductId = null`)
 *   4. Lance `efashionPublishProductsBatch(productIds)` — UN SEUL shooting créé
 *   5. Neutralise + soft-delete les anciennes fiches
 *
 * Si la phase batch publish (4) échoue globalement → rollback : restaure les
 * liens BJ et les références côté eFashion.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  efashionUpdateProduit,
  efashionSoftDeleteProduits,
  efashionSaveProduitDescription,
} from "@/lib/efashion-api-write";
import {
  efashionGetMe,
  efashionListByReferenceBaseExact,
} from "@/lib/efashion-api";
import { efashionPublishProductsBatch } from "@/lib/efashion-publish-batch";

const OLD_PRODUCT_PLACEHOLDER_DESC = "Article retiré.";

interface LiveState {
  reference: string;
  reference_base: string | null;
  id_collection: number | null;
  id_categorie: number | null;
  id_provenance: number | null;
  id_declinaison: number | null;
  id_pack: number | null;
  vendu_par: "couleurs" | "tailles" | null;
  id_vendeur_marque: number | null;
}

function generateRandomRef(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `DEL${s}`;
}

function colorSuffix(name: string | null | undefined): string {
  const cleaned = (name ?? "X").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned.slice(0, 8) || "X";
}

async function renameProduit(
  efId: number,
  reference: string,
  referenceBase: string,
  live: LiveState,
): Promise<void> {
  await efashionUpdateProduit({
    id_produit: efId,
    reference,
    reference_base: referenceBase,
    id_vendeur_marque: live.id_vendeur_marque ?? 3228,
    id_collection: live.id_collection ?? undefined,
    id_categorie: live.id_categorie ?? undefined,
    id_provenance: live.id_provenance ?? undefined,
    id_declinaison: live.id_declinaison ?? undefined,
    id_pack: live.id_pack,
    vendu_par: live.vendu_par ?? undefined,
  });
}

interface RefreshContext {
  productId: string;
  oldReferenceBase: string;
  oldEfIds: number[];
  oldBjMapping: Array<{ colorId: string; efashionProductId: number }>;
  liveById: Map<number, LiveState>;
  renamedIds: number[];
}

export interface EfashionBatchRefreshItemResult {
  productId: string;
  success: boolean;
  error?: string;
  newEfashionProductIds?: number[];
  deletedOldIds?: number[];
}

export interface EfashionBatchRefreshOutcome {
  success: boolean;
  results: EfashionBatchRefreshItemResult[];
  globalError?: string;
}

export async function efashionRefreshProductsBatch(
  productIds: string[],
): Promise<EfashionBatchRefreshOutcome> {
  if (productIds.length === 0) {
    return { success: true, results: [] };
  }

  const results: EfashionBatchRefreshItemResult[] = [];
  const contexts: RefreshContext[] = [];

  // 1. Charge + lit l'état live de chaque produit
  let me: { id_vendeur: number };
  try {
    me = await efashionGetMe();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      results: productIds.map((productId) => ({
        productId,
        success: false,
        error: `Impossible de récupérer l'info vendeur eFashion : ${msg}`,
      })),
      globalError: `efashionGetMe : ${msg}`,
    };
  }

  for (const productId of productIds) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        locked: true,
        efashionReferenceBase: true,
        colors: {
          select: {
            id: true,
            efashionProductId: true,
            color: { select: { name: true } },
          },
        },
      },
    });
    if (!product) {
      results.push({ productId, success: false, error: "Produit introuvable." });
      continue;
    }
    if (product.locked) {
      results.push({
        productId,
        success: false,
        error: "Produit verrouillé : rafraîchissement bloqué.",
      });
      continue;
    }
    if (!product.efashionReferenceBase) {
      results.push({
        productId,
        success: false,
        error: "Produit non lié à eFashion — utilisez « Publier » d'abord.",
      });
      continue;
    }
    const linkedColors = product.colors.filter((c) => c.efashionProductId != null);
    if (linkedColors.length === 0) {
      results.push({
        productId,
        success: false,
        error: "Aucune couleur liée à eFashion.",
      });
      continue;
    }

    const oldEfIds = linkedColors.map((c) => c.efashionProductId as number);
    let liveItems: Awaited<ReturnType<typeof efashionListByReferenceBaseExact>>;
    try {
      liveItems = await efashionListByReferenceBaseExact({
        idVendeur: me.id_vendeur,
        referenceBase: product.efashionReferenceBase,
        premelFilter: "tous",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        productId,
        success: false,
        error: `Impossible de lire l'état live eFashion : ${msg}`,
      });
      continue;
    }
    const liveById = new Map<number, LiveState>();
    for (const it of liveItems) {
      if (!oldEfIds.includes(it.id_produit)) continue;
      liveById.set(it.id_produit, {
        reference: it.reference,
        reference_base: it.reference_base ?? null,
        id_collection: it.id_collection ?? null,
        id_categorie: it.id_categorie ?? null,
        id_provenance: it.id_provenance ?? null,
        id_declinaison: it.id_declinaison ?? null,
        id_pack: it.id_pack ?? null,
        vendu_par: (it.vendu_par as "couleurs" | "tailles") ?? null,
        id_vendeur_marque: it.id_vendeur_marque ?? null,
      });
    }
    if (liveById.size < oldEfIds.length) {
      results.push({
        productId,
        success: false,
        error: "État live eFashion incomplet — certains anciens produits sont introuvables.",
      });
      continue;
    }

    contexts.push({
      productId,
      oldReferenceBase: product.efashionReferenceBase,
      oldEfIds,
      oldBjMapping: linkedColors.map((c) => ({
        colorId: c.id,
        efashionProductId: c.efashionProductId as number,
      })),
      liveById,
      renamedIds: [],
    });
  }

  if (contexts.length === 0) {
    return {
      success: false,
      results,
      globalError: "Aucun produit éligible au refresh.",
    };
  }

  // 2. Renomme toutes les anciennes fiches en DEL…
  for (const ctx of contexts) {
    const randomBase = generateRandomRef();
    const product = await prisma.product.findUnique({
      where: { id: ctx.productId },
      select: { colors: { select: { id: true, color: { select: { name: true } } } } },
    });
    const colorNameById = new Map(
      product?.colors.map((c) => [c.id, c.color?.name ?? null]) ?? [],
    );

    let renameFailed = false;
    for (const mapping of ctx.oldBjMapping) {
      const liveState = ctx.liveById.get(mapping.efashionProductId);
      if (!liveState) {
        renameFailed = true;
        break;
      }
      const newRef = `${randomBase}-${colorSuffix(colorNameById.get(mapping.colorId))}`;
      try {
        await renameProduit(mapping.efashionProductId, newRef, randomBase, liveState);
        ctx.renamedIds.push(mapping.efashionProductId);
      } catch (err) {
        logger.error("[eFashion batch refresh] Rename failed", {
          productId: ctx.productId,
          efId: mapping.efashionProductId,
          error: err as Error,
        });
        renameFailed = true;
        break;
      }
    }

    if (renameFailed) {
      // Rollback partiel des renames de CE produit
      for (const efId of ctx.renamedIds) {
        const liveState = ctx.liveById.get(efId);
        if (!liveState) continue;
        try {
          await renameProduit(
            efId,
            liveState.reference,
            liveState.reference_base ?? ctx.oldReferenceBase,
            liveState,
          );
        } catch (rollbackErr) {
          logger.error("[eFashion batch refresh] Rollback rename failed", {
            efId,
            error: rollbackErr as Error,
          });
        }
      }
      results.push({
        productId: ctx.productId,
        success: false,
        error: "Échec du renommage des anciennes fiches eFashion.",
      });
      ctx.renamedIds = [];
    }
  }

  // Garde uniquement les ctx qui ont réussi le rename
  const renamed = contexts.filter((c) => c.renamedIds.length === c.oldEfIds.length);
  if (renamed.length === 0) {
    return {
      success: false,
      results,
      globalError: "Aucun produit n'a pu être renommé.",
    };
  }

  // 3. Vide les liens BJ (transaction unique)
  await prisma.$transaction(async (tx) => {
    for (const ctx of renamed) {
      await tx.product.update({
        where: { id: ctx.productId },
        data: {
          efashionReferenceBase: null,
          efashionLastSyncSnapshot: Prisma.DbNull,
        },
      });
      for (const m of ctx.oldBjMapping) {
        await tx.productColor.update({
          where: { id: m.colorId },
          data: { efashionProductId: null },
        });
      }
    }
  });

  // 4. Batch publish des nouvelles fiches — UN SEUL shooting créé
  const publishOutcome = await efashionPublishProductsBatch(
    renamed.map((c) => c.productId),
  );

  const publishedById = new Map(publishOutcome.results.map((r) => [r.productId, r]));

  // 5. Pour les produits dont le publish a échoué → rollback (restaure liens + refs)
  // Pour ceux qui ont réussi → neutralise + soft-delete anciennes
  const successCtxs: RefreshContext[] = [];
  const failedCtxs: RefreshContext[] = [];
  for (const ctx of renamed) {
    const r = publishedById.get(ctx.productId);
    if (r && r.success) successCtxs.push(ctx);
    else failedCtxs.push(ctx);
  }

  if (failedCtxs.length > 0) {
    logger.error("[eFashion batch refresh] Publish failed for some products — rollback", {
      productIds: failedCtxs.map((c) => c.productId),
    });
    await prisma.$transaction(async (tx) => {
      for (const ctx of failedCtxs) {
        await tx.product.update({
          where: { id: ctx.productId },
          data: { efashionReferenceBase: ctx.oldReferenceBase },
        });
        for (const m of ctx.oldBjMapping) {
          await tx.productColor.update({
            where: { id: m.colorId },
            data: { efashionProductId: m.efashionProductId },
          });
        }
      }
    });
    for (const ctx of failedCtxs) {
      for (const efId of ctx.renamedIds) {
        const liveState = ctx.liveById.get(efId);
        if (!liveState) continue;
        try {
          await renameProduit(
            efId,
            liveState.reference,
            liveState.reference_base ?? ctx.oldReferenceBase,
            liveState,
          );
        } catch (rollbackErr) {
          logger.error("[eFashion batch refresh] Rollback rename failed", {
            efId,
            error: rollbackErr as Error,
          });
        }
      }
      const r = publishedById.get(ctx.productId);
      results.push({
        productId: ctx.productId,
        success: false,
        error: `Échec republication : ${r?.error ?? "erreur inconnue"}`,
      });
    }
  }

  // 6. Pour les succès : neutralise descriptions + soft-delete anciennes
  for (const ctx of successCtxs) {
    for (const efId of ctx.renamedIds) {
      try {
        await efashionSaveProduitDescription({
          id_produit: efId,
          texte_fr: OLD_PRODUCT_PLACEHOLDER_DESC,
          texte_uk: OLD_PRODUCT_PLACEHOLDER_DESC,
          texte_it: OLD_PRODUCT_PLACEHOLDER_DESC,
          texte_es: OLD_PRODUCT_PLACEHOLDER_DESC,
          texte_zh: OLD_PRODUCT_PLACEHOLDER_DESC,
        });
      } catch (err) {
        logger.warn("[eFashion batch refresh] Description neutralization failed (non-blocking)", {
          efId,
          error: err as Error,
        });
      }
    }
    try {
      await efashionSoftDeleteProduits(ctx.renamedIds);
    } catch (err) {
      logger.warn("[eFashion batch refresh] Soft-delete failed (non-blocking)", {
        productId: ctx.productId,
        oldEfIds: ctx.renamedIds,
        error: err as Error,
      });
    }
    await prisma.product.update({
      where: { id: ctx.productId },
      data: { lastRefreshedAt: new Date() },
    });
    const r = publishedById.get(ctx.productId);
    results.push({
      productId: ctx.productId,
      success: true,
      newEfashionProductIds: r?.efashionProductIds,
      deletedOldIds: ctx.renamedIds,
    });
  }

  return {
    success: successCtxs.length > 0,
    results,
    globalError:
      publishOutcome.globalError && successCtxs.length === 0
        ? publishOutcome.globalError
        : undefined,
  };
}
