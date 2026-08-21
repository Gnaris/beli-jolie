/**
 * Serveur : enrichit des produits pour l'affichage catalogue avec le meilleur
 * % de remise applicable (remise manuelle vs promotion AUTO ciblant le produit).
 *
 * Utilisé par /produits SSR + /api/products (pagination infinite scroll) pour
 * que les badges promo s'affichent partout uniformément.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { loadActivePromotions } from "@/lib/promotions";
import {
  resolveBestPercentForProductBadge,
  promotionTargetsItem,
  type ActivePromotion,
} from "@/lib/promotion-engine";

export interface ProductForEnrichment {
  id: string;
  categoryId?: string | null;
  discountPercent?: number | null;
}

/**
 * Enrichit chaque produit avec :
 *  - `discountPercent` : cascade cumulée (remise fiche + promos AUTO stackable
 *    ciblant le produit) OU meilleure promo non-stackable seule. C'est le %
 *    de remise à appliquer directement sur le prix affiché.
 *  - `hasAutoPromotion` : vrai si au moins une promo AUTO (table Promotion)
 *    cible le produit, pour afficher le badge « Promo ».
 */
export async function enrichProductsWithBestPromoPercent<T extends ProductForEnrichment>(
  products: T[],
): Promise<(T & { discountPercent: number | null; hasAutoPromotion: boolean })[]> {
  if (products.length === 0) {
    return products as (T & { discountPercent: number | null; hasAutoPromotion: boolean })[];
  }

  const productIds = products.map((p) => p.id);
  const [activePromos, collectionLinks] = await Promise.all([
    loadActivePromotions(),
    prisma.collectionProduct.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true, collectionId: true },
    }),
  ]);

  const collectionsByProduct = new Map<string, string[]>();
  for (const link of collectionLinks) {
    const list = collectionsByProduct.get(link.productId) ?? [];
    list.push(link.collectionId);
    collectionsByProduct.set(link.productId, list);
  }

  return products.map((p) => applyBest(p, activePromos, collectionsByProduct));
}

/** Variante sans requête DB : réutilise des promos déjà chargées. */
export function enrichProductsWithBestPromoPercentSync<T extends ProductForEnrichment>(
  products: T[],
  activePromos: ActivePromotion[],
  collectionsByProduct: Map<string, string[]>,
): (T & { discountPercent: number | null; hasAutoPromotion: boolean })[] {
  return products.map((p) => applyBest(p, activePromos, collectionsByProduct));
}

function applyBest<T extends ProductForEnrichment>(
  p: T,
  activePromos: ActivePromotion[],
  collectionsByProduct: Map<string, string[]>,
): T & { discountPercent: number | null; hasAutoPromotion: boolean } {
  const manualPercent = p.discountPercent != null ? Number(p.discountPercent) : 0;
  const collectionIds = collectionsByProduct.get(p.id) ?? [];
  const dummyItem = {
    productId: p.id,
    categoryId: p.categoryId ?? null,
    collectionIds,
    unitPrice: 100,
    productDiscountPercent: 0,
  };
  const hasAutoPromotion = activePromos.some(
    (pr) => pr.type === "AUTO" && pr.scope !== "SHIPPING" && promotionTargetsItem(pr, dummyItem),
  );
  const best = resolveBestPercentForProductBadge(
    {
      productId: p.id,
      categoryId: p.categoryId ?? null,
      collectionIds,
      productDiscountPercent: manualPercent,
    },
    activePromos,
  );
  const finalPercent = best > 0 ? best : (manualPercent > 0 ? manualPercent : null);
  return { ...p, discountPercent: finalPercent, hasAutoPromotion };
}
