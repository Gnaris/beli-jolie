/**
 * Faire Refresh — duplication d'un produit pour qu'il remonte en "nouveauté".
 *
 * Faire (comme PFS et Ankorstore) calcule la nouveauté en regardant la date de
 * création côté plateforme. Plutôt que de modifier ce champ (impossible), on
 * duplique le produit :
 *   1. POST /products avec un nom temporaire (`{ref}__TEMP_{ts}`)
 *      → nouveau faireProductId, nouvelle date de création.
 *   2. Swap des IDs côté BDD : ancien id → nouveau id, ancien id archivé/supprimé.
 *   3. DELETE /products/{old_id} chez Faire pour libérer l'ancien produit.
 *   4. PATCH /products/{new_id} avec le nom final (sans le __TEMP).
 *
 * Si une étape plante avant le swap BDD, on rollback en supprimant le nouveau
 * produit Faire — on garde l'ancien intact. Calqué sur `lib/pfs-refresh.ts`
 * + `lib/ankorstore-refresh.ts`.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { faireFetch } from "@/lib/faire-api";
import {
  fairePublishProduct,
  type FairePublishResult,
} from "@/lib/faire-publish";
import { faireHardDeleteProduct } from "@/lib/faire-delete";

export type FaireRefreshResult =
  | { success: true; oldFaireProductId: string; newFaireProductId: string }
  | { success: false; error: string };

interface ProductRefreshMeta {
  id: string;
  name: string;
  reference: string;
  faireProductId: string | null;
  colors: { id: string; faireVariantId: string | null }[];
}

async function loadMeta(productId: string): Promise<ProductRefreshMeta | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      reference: true,
      faireProductId: true,
      colors: { select: { id: true, faireVariantId: true } },
    },
  });
}

/**
 * Génère un nom temporaire unique. Faire n'a pas de contrainte d'unicité sur
 * `name`, mais on veut éviter qu'un humain qui scrute le portail brand pense
 * que c'est un doublon involontaire. Le suffixe est retiré juste après.
 */
export function buildTempName(originalName: string): string {
  const ts = Date.now().toString(36);
  return `${originalName} [REFRESH_${ts}]`;
}

export async function faireRefreshProduct(
  productId: string,
): Promise<FaireRefreshResult> {
  const meta = await loadMeta(productId);
  if (!meta) return { success: false, error: "Produit introuvable." };
  if (!meta.faireProductId) {
    return { success: false, error: "Produit pas encore publié sur Faire — utiliser publish." };
  }
  const oldFaireProductId = meta.faireProductId;

  // Étape 1 : temporairement renommer le produit BDD pour que la création
  // Faire passe avec un nom non-conflictuel (Faire accepterait quand même mais
  // on évite de voir 2 produits avec le même nom dans le portail brand).
  const tempName = buildTempName(meta.name);

  // On garde le nom et l'ID Faire originaux côté BDD pendant le POST : on
  // ne touche à rien avant d'avoir reçu un nouvel ID confirmé.
  // Pour cela on duplique localement les valeurs cibles via un override sur
  // l'objet chargé par publish (qui re-lit la BDD). La voie la plus simple :
  // muter temporairement le nom en BDD le temps du POST.
  await prisma.product.update({
    where: { id: productId },
    data: {
      name: tempName,
      faireProductId: null,
      faireLastSyncSnapshot: Prisma.DbNull,
    },
  });

  let publishRes: FairePublishResult;
  try {
    publishRes = await fairePublishProduct(productId, { lifecycleState: "DRAFT" });
  } catch (err) {
    // Rollback nom + IDs.
    await prisma.product.update({
      where: { id: productId },
      data: { name: meta.name, faireProductId: oldFaireProductId },
    });
    logger.error("[Faire Refresh] publish threw", { productId, error: String(err) });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur réseau.",
    };
  }

  if (!publishRes.success) {
    // Rollback nom + IDs.
    await prisma.product.update({
      where: { id: productId },
      data: { name: meta.name, faireProductId: oldFaireProductId },
    });
    return { success: false, error: publishRes.error };
  }

  const newFaireProductId = publishRes.faireProductId;

  // Étape 2 : restaurer le nom original côté BDD (et donc côté Faire via PATCH).
  try {
    await prisma.product.update({
      where: { id: productId },
      data: { name: meta.name, faireLastRefreshedAt: new Date() },
    });
    const res = await faireFetch(`/products/${encodeURIComponent(newFaireProductId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ name: meta.name }),
    });
    if (!res.ok) {
      logger.warn("[Faire Refresh] PATCH nom final failed (non bloquant)", {
        productId,
        newFaireProductId,
        status: res.status,
      });
    }
  } catch (err) {
    logger.warn("[Faire Refresh] PATCH nom final threw (non bloquant)", {
      productId,
      error: String(err),
    });
  }

  // Étape 3 : suppression hard de l'ancien produit chez Faire.
  // Si ça échoue, on log et on laisse le job de cleanup s'en occuper plus tard.
  const del = await faireHardDeleteProduct(oldFaireProductId);
  if (!del.success) {
    logger.warn("[Faire Refresh] ancien produit pas supprimé chez Faire", {
      productId,
      oldFaireProductId,
      error: del.error,
    });
  }

  return { success: true, oldFaireProductId, newFaireProductId };
}
