import "server-only";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  COLLECTION_CONTEXT_COOKIE_NAME,
  verifyCollectionContext,
} from "@/lib/collection-context-cookie";

/**
 * Enregistre un ajout au panier attribué à une collection publique, si :
 *  - cookie de contexte collection signé HMAC encore valide,
 *  - la variante ajoutée appartient à un produit de la collection.
 *
 * Silencieux : toute erreur est loggée mais ne remonte jamais à l'appelant.
 */
export async function trackCollectionCartAddition(
  userId: string,
  variantId: string,
  quantityDelta: number,
): Promise<void> {
  try {
    if (quantityDelta <= 0) return;

    const jar = await cookies();
    const raw = jar.get(COLLECTION_CONTEXT_COOKIE_NAME)?.value;
    const collectionId = verifyCollectionContext(raw);
    if (!collectionId) return;

    const variant = await prisma.productColor.findUnique({
      where: { id: variantId },
      select: { productId: true },
    });
    if (!variant) return;

    const inCollection = await prisma.collectionProduct.findFirst({
      where: { collectionId, productId: variant.productId },
      select: { productId: true },
    });
    if (!inCollection) return;

    await prisma.collectionCartAddition.create({
      data: {
        collectionId,
        productId: variant.productId,
        variantId,
        userId,
        quantity: quantityDelta,
      },
    });
  } catch (err) {
    logger.warn("[collection-tracking] addition failed", { err: String(err) });
  }
}
