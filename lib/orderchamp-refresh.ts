/**
 * Orderchamp Refresh — bouton « ↻ Rafraîchir » côté BJ.
 *
 * Étape 1 : `orderchampUpdateProduct({forceFullSync:true})` — pousse tout
 *   l'état BJ vers OC (title, dimensions, stock, matériaux, sous-catégorie…).
 *   Sans ça, le refresh ne synchronisait aucune donnée BJ → les modifs de
 *   matériaux / sous-cat / prix ne remontaient jamais côté OC.
 * Étape 2 : `productRepublish(id)` — bump la date côté OC pour ré-apparaître
 *   dans les nouveautés. Garde le MÊME ID (grande diff vs Faire — pas de
 *   delete+recreate, l'URL fiche acheteur reste stable, bon pour SEO +
 *   réassorts habituels).
 *
 * Après le republish, on met à jour `Product.orderchampLastRefreshedAt` (BJ)
 * pour que le badge « Nouveauté » se recalcule et pour tracker la date du
 * dernier refresh dans l'admin.
 */

import {
  orderchampGraphQL,
  extractUserErrors,
  formatUserErrors,
  OrderchampGraphQLError,
} from "@/lib/orderchamp-client";
import { PRODUCT_REPUBLISH_MUTATION } from "@/lib/orderchamp-queries";
import { orderchampUpdateProduct } from "@/lib/orderchamp-update";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

export interface OrderchampRefreshResult {
  success: boolean;
  orderchampProductId?: string;
  error?: string;
}

export async function orderchampRefreshProduct(
  productId: string,
): Promise<OrderchampRefreshResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { orderchampProductId: true, reference: true },
  });

  if (!product) {
    return { success: false, error: "Produit BJ introuvable." };
  }
  if (!product.orderchampProductId) {
    return { success: false, error: "Produit non lié à Orderchamp — publier d'abord." };
  }

  // 1) Sync complète du produit vers OC (title, stock, matériaux, sous-cat…)
  // avant le republish. Sans ça, les modifs BJ ne remontent jamais.
  const syncRes = await orderchampUpdateProduct(productId, { forceFullSync: true });
  if (!syncRes.success) {
    return { success: false, error: syncRes.error ?? "Erreur sync avant refresh" };
  }

  try {
    const data = await orderchampGraphQL<{
      productRepublish: {
        product: { id: string; title?: string } | null;
        userErrors: Array<Record<string, unknown>>;
      };
    }>(
      PRODUCT_REPUBLISH_MUTATION,
      { input: { id: product.orderchampProductId } },
      "productRepublish",
    );

    const errs = extractUserErrors(data.productRepublish);
    if (errs.length > 0) {
      const msg = formatUserErrors(errs) ?? "Erreur refresh Orderchamp";
      return { success: false, error: msg };
    }

    const republishedId = data.productRepublish.product?.id ?? product.orderchampProductId;

    await prisma.product.update({
      where: { id: productId },
      data: {
        orderchampLastRefreshedAt: new Date(),
        orderchampSyncRequired: false,
      },
    });

    logger.info("[Orderchamp Refresh] OK", {
      productId,
      reference: product.reference,
      orderchampProductId: republishedId,
    });

    return { success: true, orderchampProductId: republishedId };
  } catch (err) {
    if (err instanceof OrderchampGraphQLError) {
      const notFound = err.errors.some((e) => /not found/i.test(e.message));
      if (notFound) {
        // Le produit n'existe plus côté Orderchamp — on nettoie l'ID côté BJ
        // pour que le prochain « Publier » recrée une fiche propre.
        await prisma.product.update({
          where: { id: productId },
          data: { orderchampProductId: null, orderchampLastSyncSnapshot: Prisma.DbNull },
        });
        return {
          success: false,
          error: "Fiche introuvable côté Orderchamp — lien supprimé, publier à nouveau.",
        };
      }
    }
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    logger.error("[Orderchamp Refresh] échec", { productId, error: message });
    return { success: false, error: message };
  }
}
