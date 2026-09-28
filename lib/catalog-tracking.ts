import "server-only";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  CATALOG_CONTEXT_COOKIE_NAME,
  verifyCatalogContext,
} from "@/lib/catalog-context-cookie";

/**
 * Enregistre un ajout au panier attribué à un catalogue partagé, si :
 *  - le visiteur a un cookie de contexte catalogue signé HMAC encore valide,
 *  - la variante ajoutée appartient à un produit du catalogue en question.
 *
 * Silencieux : toute erreur est loggée mais ne remonte jamais à l'appelant
 * (l'ajout au panier a déjà réussi, on ne veut surtout pas casser l'UX).
 */
export async function trackCatalogCartAddition(
  userId: string,
  variantId: string,
  quantityDelta: number,
): Promise<void> {
  try {
    if (quantityDelta <= 0) return;

    const jar = await cookies();
    const raw = jar.get(CATALOG_CONTEXT_COOKIE_NAME)?.value;
    const catalogId = verifyCatalogContext(raw);
    if (!catalogId) return;

    const variant = await prisma.productColor.findUnique({
      where: { id: variantId },
      select: { productId: true },
    });
    if (!variant) return;

    // On n'attribue au catalogue que si le produit y figure vraiment — sinon
    // un client qui ouvre un catalogue puis navigue ailleurs verrait ses
    // autres ajouts panier faussement rattachés au catalogue.
    const inCatalog = await prisma.catalogProduct.findFirst({
      where: { catalogId, productId: variant.productId },
      select: { productId: true },
    });
    if (!inCatalog) return;

    await prisma.catalogCartAddition.create({
      data: {
        catalogId,
        productId: variant.productId,
        variantId,
        userId,
        quantity: quantityDelta,
      },
    });
  } catch (err) {
    logger.warn("[catalog-tracking] addition failed", { err: String(err) });
  }
}
