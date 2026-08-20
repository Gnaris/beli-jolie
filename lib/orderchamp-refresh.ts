/**
 * Orderchamp Refresh — bouton « ↻ Rafraîchir » côté BJ.
 *
 * Grande différence vs Faire : `productRepublish(id)` garde le MÊME ID.
 * Pas besoin d'archiver + recréer + renommer comme Faire — l'URL fiche
 * acheteur reste stable (bon pour SEO + réassorts habituels).
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
