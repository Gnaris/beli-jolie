/**
 * Serveur : construit le contexte promotionnel d'un panier (ItemPromoContext
 * par cartItem). Sert le rendu SSR de /panier et /panier/commande.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import type { ItemPromoContext } from "@/lib/promotion-engine";

interface MinimalCartItem {
  id: string;
  quantity: number;
  variant: {
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    unitPrice: number | { toString(): string };
    product: {
      id: string;
      discountPercent: number | { toString(): string } | null;
    };
  };
}

export interface CartItemPromoInfo {
  itemId: string;
  productId: string;
  /** unitPrice affiché sans aucune promo (base facturable BDD). */
  baseUnitPrice: number;
  /** Contexte pour resolveBestItemDiscount. */
  context: ItemPromoContext;
}

/**
 * Enrichit une liste d'items du panier avec les métadonnées nécessaires au
 * moteur de promotions (categoryId + collectionIds).
 *
 * Une seule requête agrégée pour tous les produits distincts du panier.
 */
export async function buildCartPromoContexts(
  items: MinimalCartItem[],
): Promise<Map<string, CartItemPromoInfo>> {
  const map = new Map<string, CartItemPromoInfo>();
  if (items.length === 0) return map;

  const productIds = [...new Set(items.map((i) => i.variant.product.id))];

  const [products, collectionLinks] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, categoryId: true },
    }),
    prisma.collectionProduct.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true, collectionId: true },
    }),
  ]);

  const categoryByProduct = new Map<string, string | null>();
  for (const p of products) categoryByProduct.set(p.id, p.categoryId);

  const collectionsByProduct = new Map<string, string[]>();
  for (const link of collectionLinks) {
    const list = collectionsByProduct.get(link.productId) ?? [];
    list.push(link.collectionId);
    collectionsByProduct.set(link.productId, list);
  }

  for (const item of items) {
    const productId = item.variant.product.id;
    const baseUnitPrice = Number(item.variant.unitPrice);
    const productDiscountPercent = item.variant.product.discountPercent != null
      ? Number(item.variant.product.discountPercent)
      : 0;

    map.set(item.id, {
      itemId: item.id,
      productId,
      baseUnitPrice,
      context: {
        productId,
        categoryId: categoryByProduct.get(productId) ?? null,
        collectionIds: collectionsByProduct.get(productId) ?? [],
        unitPrice: baseUnitPrice,
        productDiscountPercent,
      },
    });
  }

  return map;
}
