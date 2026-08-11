/**
 * Moteur de calcul des promotions — 100 % pur, réutilisable côté serveur
 * ET côté client (aucun import Prisma / server-only). Le fichier serveur
 * `lib/promotions.ts` s'appuie dessus pour la validation code promo et
 * l'application au flow placeOrder.
 */

import type { DiscountKind, PromotionScope, PromotionType } from "@prisma/client";

// ─────────────────────────────────────────────
// Types partagés (lisibles côté client)
// ─────────────────────────────────────────────

export interface ActivePromotion {
  id: string;
  name: string;
  type: PromotionType;
  code: string | null;
  scope: PromotionScope;
  discountKind: DiscountKind;
  discountValue: number;
  minOrderAmount: number | null;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  firstOrderOnly: boolean;
  currentUses: number;
  startsAt: Date;
  endsAt: Date | null;
  productIds: string[];
  categoryIds: string[];
  collectionIds: string[];
}

export interface ItemPromoContext {
  productId: string;
  categoryId: string | null;
  collectionIds: string[];
  /** Prix unitaire hors toute remise. */
  unitPrice: number;
  /** Remise manuelle sur le produit (Product.discountPercent), 0..100. */
  productDiscountPercent: number;
}

export interface ResolvedItemDiscount {
  finalUnitPrice: number;
  savedPerUnit: number;
  displayPercent: number;
  source: "none" | "product" | "promotion";
  promotion: ActivePromotion | null;
}

export interface ResolvedShippingDiscount {
  finalPrice: number;
  savedAmount: number;
  isFree: boolean;
  source: "none" | "user" | "promotion";
  promotion: ActivePromotion | null;
}

// ─────────────────────────────────────────────
// Éligibilité & calculs bruts
// ─────────────────────────────────────────────

export function promotionTargetsItem(promo: ActivePromotion, item: ItemPromoContext): boolean {
  switch (promo.scope) {
    case "ALL_PRODUCTS":
      return true;
    case "PRODUCTS":
      return promo.productIds.includes(item.productId);
    case "CATEGORIES":
      return item.categoryId != null && promo.categoryIds.includes(item.categoryId);
    case "COLLECTIONS":
      return item.collectionIds.some((cid) => promo.collectionIds.includes(cid));
    case "SHIPPING":
      return false;
  }
}

function itemSavingsForPromo(promo: ActivePromotion, unitPrice: number): number {
  if (unitPrice <= 0) return 0;
  if (promo.discountKind === "PERCENTAGE") {
    return Math.max(0, unitPrice * (promo.discountValue / 100));
  }
  if (promo.discountKind === "FIXED_AMOUNT") {
    return Math.min(promo.discountValue, unitPrice);
  }
  return 0; // FREE_SHIPPING legacy — pas d'effet sur un item
}

function shippingSavingsForPromo(promo: ActivePromotion, carrierPrice: number): number {
  if (carrierPrice <= 0) return 0;
  if (promo.discountKind === "PERCENTAGE") {
    return Math.max(0, carrierPrice * (promo.discountValue / 100));
  }
  if (promo.discountKind === "FIXED_AMOUNT") {
    return Math.min(promo.discountValue, carrierPrice);
  }
  return carrierPrice; // FREE_SHIPPING legacy = 100 %
}

// ─────────────────────────────────────────────
// Résolutions "meilleure gagne"
// ─────────────────────────────────────────────

export function resolveBestItemDiscount(
  item: ItemPromoContext,
  activePromos: ActivePromotion[],
  appliedCodePromo: ActivePromotion | null = null,
): ResolvedItemDiscount {
  const candidates: Array<{
    saved: number;
    source: "product" | "promotion";
    promotion?: ActivePromotion;
  }> = [];

  if (item.productDiscountPercent > 0) {
    const saved = item.unitPrice * (item.productDiscountPercent / 100);
    candidates.push({ saved, source: "product" });
  }

  for (const promo of activePromos) {
    if (promo.type !== "AUTO") continue;
    if (!promotionTargetsItem(promo, item)) continue;
    const saved = itemSavingsForPromo(promo, item.unitPrice);
    if (saved > 0) candidates.push({ saved, source: "promotion", promotion: promo });
  }

  if (appliedCodePromo && promotionTargetsItem(appliedCodePromo, item)) {
    const saved = itemSavingsForPromo(appliedCodePromo, item.unitPrice);
    if (saved > 0) candidates.push({ saved, source: "promotion", promotion: appliedCodePromo });
  }

  if (candidates.length === 0) {
    return {
      finalUnitPrice: item.unitPrice,
      savedPerUnit: 0,
      displayPercent: 0,
      source: "none",
      promotion: null,
    };
  }

  candidates.sort((a, b) => b.saved - a.saved);
  const best = candidates[0]!;
  const finalUnitPrice = Math.max(0, item.unitPrice - best.saved);
  const displayPercent = item.unitPrice > 0
    ? Math.round((best.saved / item.unitPrice) * 100)
    : 0;

  return {
    finalUnitPrice,
    savedPerUnit: best.saved,
    displayPercent,
    source: best.source,
    promotion: best.promotion ?? null,
  };
}

/**
 * Meilleur % équivalent pour un badge sur une card produit (avant sélection
 * d'une variante). Compare la remise manuelle aux promotions AUTO ciblant le
 * produit — ignore SHIPPING.
 */
export function resolveBestPercentForProductBadge(
  ctx: {
    productId: string;
    categoryId: string | null;
    collectionIds: string[];
    productDiscountPercent: number;
  },
  activePromos: ActivePromotion[],
): number {
  let best = ctx.productDiscountPercent > 0 ? ctx.productDiscountPercent : 0;
  const dummyItem: ItemPromoContext = {
    productId: ctx.productId,
    categoryId: ctx.categoryId,
    collectionIds: ctx.collectionIds,
    unitPrice: 100,
    productDiscountPercent: 0,
  };
  for (const promo of activePromos) {
    if (promo.type !== "AUTO") continue;
    if (promo.scope === "SHIPPING") continue;
    if (!promotionTargetsItem(promo, dummyItem)) continue;
    const saved = itemSavingsForPromo(promo, 100);
    if (saved > best) best = saved;
  }
  return Math.round(best);
}

export function resolveBestShippingDiscount(
  carrierPrice: number,
  activePromos: ActivePromotion[],
  userShipping: { isFree: boolean; savedAmount: number },
  appliedCodePromo: ActivePromotion | null = null,
): ResolvedShippingDiscount {
  if (carrierPrice <= 0) {
    return { finalPrice: 0, savedAmount: 0, isFree: true, source: "none", promotion: null };
  }

  const candidates: Array<{
    saved: number;
    isFree: boolean;
    source: "user" | "promotion";
    promotion?: ActivePromotion;
  }> = [];

  if (userShipping.isFree) {
    candidates.push({ saved: carrierPrice, isFree: true, source: "user" });
  } else if (userShipping.savedAmount > 0) {
    candidates.push({
      saved: Math.min(userShipping.savedAmount, carrierPrice),
      isFree: false,
      source: "user",
    });
  }

  for (const promo of activePromos) {
    if (promo.scope !== "SHIPPING") continue;
    if (promo.type !== "AUTO") continue;
    const saved = shippingSavingsForPromo(promo, carrierPrice);
    if (saved > 0) {
      candidates.push({
        saved,
        isFree: saved >= carrierPrice - 0.005,
        source: "promotion",
        promotion: promo,
      });
    }
  }

  if (appliedCodePromo && appliedCodePromo.scope === "SHIPPING") {
    const saved = shippingSavingsForPromo(appliedCodePromo, carrierPrice);
    if (saved > 0) {
      candidates.push({
        saved,
        isFree: saved >= carrierPrice - 0.005,
        source: "promotion",
        promotion: appliedCodePromo,
      });
    }
  }

  if (candidates.length === 0) {
    return { finalPrice: carrierPrice, savedAmount: 0, isFree: false, source: "none", promotion: null };
  }

  candidates.sort((a, b) => b.saved - a.saved);
  const best = candidates[0]!;
  const finalPrice = Math.max(0, carrierPrice - best.saved);
  return {
    finalPrice,
    savedAmount: best.saved,
    isFree: best.isFree,
    source: best.source,
    promotion: best.promotion ?? null,
  };
}
