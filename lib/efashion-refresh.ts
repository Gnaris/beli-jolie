/**
 * eFashion Paris — Renouvellement complet d'un produit pour le faire remonter
 * en premier sur leur catalogue vendeur (qui trie par date de création).
 *
 * Reproduit le pattern PFS : on renomme les anciennes fiches avec une
 * référence aléatoire « DEL… », on en crée de nouvelles avec la vraie
 * référence (donc une nouvelle date de création côté eFashion), puis on
 * soft-supprime les anciennes.
 *
 * Flux :
 *   1. Charge le produit BJ + les couleurs liées (efashionProductId != null)
 *   2. Récupère l'état live des anciennes fiches (id_collection, id_categorie…
 *      — nécessaires pour reposter un payload complet sans propager les prix)
 *   3. Génère une référence aléatoire « DEL + 8 chars »
 *   4. Renomme chaque ancienne fiche : reference_base = randomBase,
 *      reference = randomBase-COULEUR — libère ainsi la vraie référence
 *   5. Vide les liens BJ (Product.efashionReferenceBase = null,
 *      ProductColor.efashionProductId = null) dans une transaction
 *   6. Appelle `efashionPublishProduct(productId)` — crée les nouvelles fiches
 *      avec la vraie référence + nouvel id_produit + nouvelle date de création,
 *      puis met à jour les liens BJ avec les nouveaux IDs
 *   7. Soft-supprime les anciennes fiches via `efashionSoftDeleteProduits`
 *   8. Bump `Product.lastRefreshedAt` pour que le produit remonte aussi côté
 *      boutique BJ
 *
 * Rollback si une étape critique échoue :
 *   - Renommage partiel → restaure les références originales
 *   - Publish échoue → restaure les liens BJ et les références originales
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  efashionUpdateProduit,
  efashionSoftDeleteProduits,
  efashionSaveProduitDescription,
} from "@/lib/efashion-api-write";
import { efashionGetMe, efashionListProducts } from "@/lib/efashion-api";
import { efashionPublishProduct } from "@/lib/efashion-publish";

// Texte court neutre posé sur la description multilingue de l'ancienne fiche.
// Évite qu'elle conserve la description d'origine si jamais elle réapparait
// (cas où l'admin restaure depuis la corbeille eFashion).
const OLD_PRODUCT_PLACEHOLDER_DESC = "Article retiré.";

// ⚠️ On ne supprime PAS les photos des anciennes fiches : eFashion refuse de
// supprimer la dernière photo (au moins 1 obligatoire). Comme la fiche est
// soft-supprimée juste après, elle disparait de toute façon du catalogue
// acheteurs — les photos résiduelles ne sont visibles que dans la corbeille
// du vendeur, sans impact.

export type EfashionRefreshOutcome =
  | { success: true; newProductIds: number[]; deletedOldIds: number[] }
  | { success: false; reason: "not_linked"; error: string }
  | { success: false; reason: "error"; error: string };

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
  for (let i = 0; i < 8; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return `DEL${s}`;
}

function colorSuffix(name: string | null | undefined): string {
  const cleaned = (name ?? "X").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned.slice(0, 8) || "X";
}

// Pose le payload minimum pour renommer une fiche sans toucher au prix
// (envoyer `prix` déclencherait une propagation inter-couleurs côté eFashion).
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

export async function efashionRefreshProduct(
  productId: string,
): Promise<EfashionRefreshOutcome> {
  // 1. Load BJ product + linked colors
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
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
    return { success: false, reason: "error", error: "Produit introuvable." };
  }
  if (!product.efashionReferenceBase) {
    return {
      success: false,
      reason: "not_linked",
      error: "Produit non lié à eFashion — utilisez « Publier » d'abord.",
    };
  }
  const linkedColors = product.colors.filter((c) => c.efashionProductId != null);
  if (linkedColors.length === 0) {
    return {
      success: false,
      reason: "not_linked",
      error: "Aucune couleur liée à eFashion.",
    };
  }

  const oldEfIds = linkedColors.map((c) => c.efashionProductId as number);
  const oldReferenceBase = product.efashionReferenceBase;
  logger.info("[eFashion refresh] Démarrage", {
    productId,
    reference: product.reference,
    oldEfIds,
  });

  // 2. Lit l'état live des anciennes fiches (pour le payload de renommage)
  const live = new Map<number, LiveState>();
  try {
    const me = await efashionGetMe();
    const list = await efashionListProducts({
      idVendeur: me.id_vendeur,
      take: 100,
      reference: oldReferenceBase,
      premelFilter: "tous",
    });
    for (const it of list.items) {
      if (!oldEfIds.includes(it.id_produit)) continue;
      live.set(it.id_produit, {
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[eFashion refresh] Impossible de lire l'état live", {
      productId,
      error: msg,
    });
    return {
      success: false,
      reason: "error",
      error: `Impossible de lire l'état actuel sur eFashion : ${msg}`,
    };
  }

  if (live.size < oldEfIds.length) {
    return {
      success: false,
      reason: "error",
      error: "État live eFashion incomplet — certains anciens produits sont introuvables.",
    };
  }

  // 3. Référence temporaire « DEL… »
  const randomBase = generateRandomRef();

  // 4. Renomme chaque ancienne fiche
  const renamedIds: number[] = [];
  try {
    for (const lc of linkedColors) {
      const efId = lc.efashionProductId as number;
      const liveState = live.get(efId)!;
      const newRef = `${randomBase}-${colorSuffix(lc.color?.name)}`;
      await renameProduit(efId, newRef, randomBase, liveState);
      renamedIds.push(efId);
      logger.info("[eFashion refresh] Renommé", {
        efId,
        oldRef: liveState.reference,
        newRef,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[eFashion refresh] Échec du renommage — rollback", {
      productId,
      error: msg,
      renamedIds,
    });
    for (const efId of renamedIds) {
      const liveState = live.get(efId);
      if (!liveState) continue;
      try {
        await renameProduit(
          efId,
          liveState.reference,
          liveState.reference_base ?? oldReferenceBase,
          liveState,
        );
      } catch (rollbackErr) {
        logger.error("[eFashion refresh] Rollback rename failed", {
          efId,
          error: rollbackErr,
        });
      }
    }
    return {
      success: false,
      reason: "error",
      error: `Échec du renommage des anciennes fiches eFashion : ${msg}`,
    };
  }

  // 5. Vide les liens BJ
  const oldBjMapping = linkedColors.map((c) => ({
    colorId: c.id,
    efashionProductId: c.efashionProductId as number,
  }));
  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: {
        efashionReferenceBase: null,
        efashionLastSyncSnapshot: Prisma.DbNull,
      },
    });
    for (const ob of oldBjMapping) {
      await tx.productColor.update({
        where: { id: ob.colorId },
        data: { efashionProductId: null },
      });
    }
  });

  // 6. Republie via le workflow shooting standard
  let publishOutcome: Awaited<ReturnType<typeof efashionPublishProduct>>;
  try {
    publishOutcome = await efashionPublishProduct(productId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    publishOutcome = { success: false, error: msg };
  }

  if (!publishOutcome.success) {
    logger.error("[eFashion refresh] Publish a échoué — rollback complet", {
      productId,
      publishError: publishOutcome.error,
    });
    // Restaure les liens BJ
    try {
      await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: productId },
          data: { efashionReferenceBase: oldReferenceBase },
        });
        for (const ob of oldBjMapping) {
          await tx.productColor.update({
            where: { id: ob.colorId },
            data: { efashionProductId: ob.efashionProductId },
          });
        }
      });
    } catch (dbErr) {
      logger.error("[eFashion refresh] Rollback BJ DB failed", { error: dbErr });
    }
    // Restaure les références sur eFashion
    for (const efId of renamedIds) {
      const liveState = live.get(efId);
      if (!liveState) continue;
      try {
        await renameProduit(
          efId,
          liveState.reference,
          liveState.reference_base ?? oldReferenceBase,
          liveState,
        );
      } catch (rollbackErr) {
        logger.error("[eFashion refresh] Rollback rename failed", {
          efId,
          error: rollbackErr,
        });
      }
    }
    return {
      success: false,
      reason: "error",
      error: `Échec de la republication : ${publishOutcome.error ?? "erreur inconnue"}`,
    };
  }

  // 7. Neutralise la description des anciennes fiches AVANT le soft-delete.
  //    Best-effort : un échec ici ne bloque pas la suite (la nouvelle fiche
  //    est déjà en ligne, l'ancienne sera quand même soft-supprimée).
  //    Les photos sont laissées en place (eFashion refuse la suppression de
  //    la dernière, voir commentaire en haut du module).
  for (const efId of renamedIds) {
    try {
      await efashionSaveProduitDescription({
        id_produit: efId,
        texte_fr: OLD_PRODUCT_PLACEHOLDER_DESC,
        texte_uk: OLD_PRODUCT_PLACEHOLDER_DESC,
        texte_it: OLD_PRODUCT_PLACEHOLDER_DESC,
        texte_es: OLD_PRODUCT_PLACEHOLDER_DESC,
        texte_zh: OLD_PRODUCT_PLACEHOLDER_DESC,
      });
      logger.info("[eFashion refresh] Description neutralisée sur l'ancienne fiche", {
        efId,
      });
    } catch (err) {
      logger.warn(
        "[eFashion refresh] Neutralisation description ancienne échouée (non bloquant)",
        { efId, error: err },
      );
    }
  }

  // 8. Soft-delete des anciennes fiches (best-effort — si ça plante, les
  //    anciennes restent avec leur ref DEL… visible côté eFashion mais
  //    n'apparaitront pas dans le catalogue acheteurs après ce delete)
  try {
    await efashionSoftDeleteProduits(renamedIds);
    logger.info("[eFashion refresh] Anciennes fiches soft-supprimées", {
      productId,
      oldEfIds: renamedIds,
    });
  } catch (err) {
    logger.warn(
      "[eFashion refresh] Soft-delete des anciennes a planté (non bloquant)",
      { productId, oldEfIds: renamedIds, error: err },
    );
  }

  // 9. Bump lastRefreshedAt côté BJ
  await prisma.product.update({
    where: { id: productId },
    data: { lastRefreshedAt: new Date() },
  });

  return {
    success: true,
    newProductIds: publishOutcome.productIds ?? [],
    deletedOldIds: renamedIds,
  };
}
