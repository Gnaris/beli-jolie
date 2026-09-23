/**
 * Moteur de calcul des promotions — 100 % pur, réutilisable côté serveur
 * ET côté client (aucun import Prisma / server-only). Le fichier serveur
 * `lib/promotions.ts` s'appuie dessus pour la validation code promo et
 * l'application au flow placeOrder.
 *
 * Règle métier (2026-08-21) : le prix « produit final » est calculé
 * exclusivement à partir de la remise fiche produit (`productDiscountPercent`)
 * et des promotions AUTO/CODE ciblant le produit. Il vit tel quel partout
 * (cartes, fiche, ligne panier, snapshot commande, facture).
 *   - Remise fiche produit + promos stackable → cascade multiplicative
 *     (avec troncature centime à chaque palier).
 *   - Promo non-stackable → « meilleure gagne » avec la remise fiche seule.
 * La remise commerciale du client (`User.discountType/Value`) n'entre PLUS
 * dans le calcul par item : elle s'applique une seule fois sur le total
 * panier (voir `lib/order-pricing.ts`).
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
  currentUses: number;
  startsAt: Date;
  endsAt: Date | null;
  productIds: string[];
  categoryIds: string[];
  collectionIds: string[];
  /** Se cumule avec la remise client et les autres promos stackable. */
  stackable: boolean;
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

/**
 * Remise commerciale livraison du client. `isFree=true` équivaut à 100 %.
 * Les 2 champs discountType/discountValue ne sont pris en compte que si
 * `isFree=false`. Ne passer que si effectivement applicable.
 */
export interface ClientShippingDiscountForCumul {
  isFree: boolean;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}

export interface ResolvedItemDiscount {
  finalUnitPrice: number;
  savedPerUnit: number;
  displayPercent: number;
  source: "none" | "product" | "promotion" | "stack";
  promotion: ActivePromotion | null;
  /** Vrai si le résultat vient du cluster cumulé (plusieurs remises additionnées). */
  stacked: boolean;
}

export interface ResolvedShippingDiscount {
  finalPrice: number;
  savedAmount: number;
  isFree: boolean;
  source: "none" | "user" | "promotion" | "stack";
  promotion: ActivePromotion | null;
  stacked: boolean;
  /** Économie attribuable à la remise commerciale client (subset de savedAmount). */
  savedByUser: number;
}

// ─────────────────────────────────────────────
// Utilitaires arrondi
// ─────────────────────────────────────────────

/**
 * TRONCATURE au centime (règle métier confirmée : « on ne veut plus arrondir,
 * on récupère uniquement les 2 chiffres après la virgule »).
 *
 * Ex : 39.84 × 0.9 = 35.856 → 35.85 (jamais 35.86).
 *
 * Neutralise le bruit IEEE-754 : on travaille en millièmes de centime puis on
 * round pour tuer les décimales fantômes, avant d'appliquer Math.floor.
 *
 * Nom historique conservé pour éviter de propager le renommage sur 5 fichiers ;
 * le comportement est bien une troncature depuis cette révision.
 */
export function ceilCent(n: number): number {
  const cents = Math.round(n * 100 * 1000) / 1000;
  return Math.floor(cents) / 100;
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

function clientShippingSavings(
  client: ClientShippingDiscountForCumul,
  carrierPrice: number,
): number {
  if (carrierPrice <= 0) return 0;
  if (client.isFree) return carrierPrice;
  if (!client.discountType || client.discountValue == null) return 0;
  if (client.discountType === "PERCENT") {
    return Math.min(carrierPrice, carrierPrice * (client.discountValue / 100));
  }
  return Math.min(carrierPrice, client.discountValue);
}

// ─────────────────────────────────────────────
// Résolutions
// ─────────────────────────────────────────────

export function resolveBestItemDiscount(
  item: ItemPromoContext,
  activePromos: ActivePromotion[],
  appliedCodePromo: ActivePromotion | null = null,
): ResolvedItemDiscount {
  // ── 1. Cluster cumulable : remise fiche produit puis promos stackable ──
  // Cascade multiplicative, troncature au centime à chaque palier.
  // La remise fiche produit est toujours cumulée en tête ; les promos AUTO
  // (et un éventuel code) stackable ciblant l'item s'ajoutent ensuite.
  let cascadePrice = item.unitPrice;
  let stackFirstPromo: ActivePromotion | null = null;
  let stackHasManual = false;
  let stackHasAnyPromo = false;

  if (item.productDiscountPercent > 0) {
    const saved = Math.min(cascadePrice, cascadePrice * (item.productDiscountPercent / 100));
    if (saved > 0) {
      cascadePrice = Math.max(0, ceilCent(cascadePrice - saved));
      stackHasManual = true;
    }
  }

  for (const promo of activePromos) {
    if (promo.type !== "AUTO") continue;
    if (!promo.stackable) continue;
    if (!promotionTargetsItem(promo, item)) continue;
    const saved = itemSavingsForPromo(promo, cascadePrice);
    if (saved > 0) {
      cascadePrice = Math.max(0, ceilCent(cascadePrice - saved));
      if (!stackFirstPromo) stackFirstPromo = promo;
      stackHasAnyPromo = true;
    }
  }
  if (appliedCodePromo && appliedCodePromo.stackable && promotionTargetsItem(appliedCodePromo, item)) {
    const saved = itemSavingsForPromo(appliedCodePromo, cascadePrice);
    if (saved > 0) {
      cascadePrice = Math.max(0, ceilCent(cascadePrice - saved));
      if (!stackFirstPromo) stackFirstPromo = appliedCodePromo;
      stackHasAnyPromo = true;
    }
  }
  const stackActive = stackHasManual || stackHasAnyPromo;
  const stackSaved = item.unitPrice - cascadePrice;

  // ── 2. Candidats « seul » (meilleure gagne) ───────────────────
  //   Remise manuelle seule + chaque promo non-stackable ciblant l'item.
  const soloCandidates: Array<{
    saved: number;
    source: "product" | "promotion";
    promotion?: ActivePromotion;
  }> = [];

  if (item.productDiscountPercent > 0) {
    const rawSaved = Math.min(item.unitPrice, item.unitPrice * (item.productDiscountPercent / 100));
    const finalPrice = Math.max(0, ceilCent(item.unitPrice - rawSaved));
    soloCandidates.push({ saved: item.unitPrice - finalPrice, source: "product" });
  }
  for (const promo of activePromos) {
    if (promo.type !== "AUTO") continue;
    if (promo.stackable) continue;
    if (!promotionTargetsItem(promo, item)) continue;
    const rawSaved = itemSavingsForPromo(promo, item.unitPrice);
    if (rawSaved > 0) {
      const finalPrice = Math.max(0, ceilCent(item.unitPrice - rawSaved));
      soloCandidates.push({ saved: item.unitPrice - finalPrice, source: "promotion", promotion: promo });
    }
  }
  if (appliedCodePromo && !appliedCodePromo.stackable && promotionTargetsItem(appliedCodePromo, item)) {
    const rawSaved = itemSavingsForPromo(appliedCodePromo, item.unitPrice);
    if (rawSaved > 0) {
      const finalPrice = Math.max(0, ceilCent(item.unitPrice - rawSaved));
      soloCandidates.push({ saved: item.unitPrice - finalPrice, source: "promotion", promotion: appliedCodePromo });
    }
  }

  soloCandidates.sort((a, b) => b.saved - a.saved);
  const bestSolo = soloCandidates[0];

  // ── 3. Choix final : max(cascade cumulée, meilleur candidat seul) ─
  const useStack = stackActive && stackSaved >= (bestSolo?.saved ?? 0);

  if (!useStack && !bestSolo) {
    return {
      finalUnitPrice: item.unitPrice,
      savedPerUnit: 0,
      displayPercent: 0,
      source: "none",
      promotion: null,
      stacked: false,
    };
  }

  if (useStack) {
    const finalUnitPrice = cascadePrice;
    const displayPercent = item.unitPrice > 0
      ? Math.round((stackSaved / item.unitPrice) * 100)
      : 0;
    // Si au moins une promo participe au cluster → source "stack" (badge Promo
    // ancré sur la promo). Sinon seule la remise fiche joue → source "product".
    const source: "product" | "stack" = stackHasAnyPromo ? "stack" : "product";
    return {
      finalUnitPrice,
      savedPerUnit: stackSaved,
      displayPercent,
      source,
      promotion: stackFirstPromo,
      stacked: stackHasAnyPromo,
    };
  }

  // Meilleur candidat seul gagne.
  const best = bestSolo!;
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
    stacked: false,
  };
}

/**
 * Version « côté client » ultra-légère : ne dépend pas d'ActivePromotion.
 * Reçoit directement le `productDiscountPercent` cumulé (déjà résolu par
 * `enrichProductsWithBestPromoPercent`, = cascade remise fiche + promo AUTO
 * ciblante) et l'applique. La remise commerciale du client n'entre pas dans
 * ce calcul — elle est appliquée une seule fois sur le total panier.
 */
export interface CardPriceCascade {
  basePrice: number;
  finalPrice: number;
  hasPromo: boolean;
  promoPercent: number;
}

export function computeCardPriceCascade(
  basePrice: number,
  productDiscountPercent?: number | null,
): CardPriceCascade {
  const promoPercent = productDiscountPercent && productDiscountPercent > 0
    ? productDiscountPercent
    : 0;
  const finalPrice = promoPercent > 0
    ? Math.max(0, ceilCent(basePrice * (1 - promoPercent / 100)))
    : basePrice;

  return {
    basePrice,
    finalPrice,
    hasPromo: promoPercent > 0,
    promoPercent,
  };
}

export interface ResolvedCardPricing {
  basePrice: number;
  finalPrice: number;         // = basePrice si aucune remise/promo produit
  promoPercent: number;       // 0..100 — remise totale appliquée sur la fiche produit
  hasPromo: boolean;          // true si un badge Promo doit s'afficher
  hasAutoPromotion: boolean;  // true si au moins une promo AUTO cible le produit
}

export function resolveCardPricing(
  item: ItemPromoContext,
  activePromos: ActivePromotion[],
): ResolvedCardPricing {
  const basePrice = item.unitPrice;
  const resolved = resolveBestItemDiscount(item, activePromos, null);

  const finalPrice = resolved.finalUnitPrice;
  const hasPromo = resolved.source !== "none";
  const hasAutoPromotion = activePromos.some(
    (p) => p.type === "AUTO" && p.scope !== "SHIPPING" && promotionTargetsItem(p, item),
  );
  const promoPercent = basePrice > 0 && hasPromo
    ? Math.round(((basePrice - finalPrice) / basePrice) * 100)
    : 0;

  return {
    basePrice,
    finalPrice,
    promoPercent,
    hasPromo,
    hasAutoPromotion,
  };
}

/**
 * Meilleur % équivalent pour l'affichage sur une card produit. Réutilise le
 * moteur `resolveBestItemDiscount` avec un item factice à 100 € pour
 * bénéficier de la même logique (cascade remise fiche + promos stackable vs
 * meilleure gagne non-stackable).
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
  const dummyItem: ItemPromoContext = {
    productId: ctx.productId,
    categoryId: ctx.categoryId,
    collectionIds: ctx.collectionIds,
    unitPrice: 100,
    productDiscountPercent: ctx.productDiscountPercent,
  };
  const noShipping = activePromos.filter((p) => p.scope !== "SHIPPING");
  const resolved = resolveBestItemDiscount(dummyItem, noShipping, null);
  return Math.round(100 - resolved.finalUnitPrice);
}

export function resolveBestShippingDiscount(
  carrierPrice: number,
  activePromos: ActivePromotion[],
  userShipping: ClientShippingDiscountForCumul,
  appliedCodePromo: ActivePromotion | null = null,
): ResolvedShippingDiscount {
  if (carrierPrice <= 0) {
    return {
      finalPrice: 0, savedAmount: 0, isFree: true,
      source: "none", promotion: null, stacked: false, savedByUser: 0,
    };
  }

  const userSaved = clientShippingSavings(userShipping, carrierPrice);

  // Cluster cumulable : cascade multiplicative + ceilCent à chaque palier.
  let cascadePrice = carrierPrice;
  let stackFirstPromo: ActivePromotion | null = null;
  let stackHasAnyPromo = false;

  for (const promo of activePromos) {
    if (promo.scope !== "SHIPPING") continue;
    if (promo.type !== "AUTO") continue;
    if (!promo.stackable) continue;
    const saved = shippingSavingsForPromo(promo, cascadePrice);
    if (saved > 0) {
      cascadePrice = Math.max(0, ceilCent(cascadePrice - saved));
      if (!stackFirstPromo) stackFirstPromo = promo;
      stackHasAnyPromo = true;
    }
  }
  if (appliedCodePromo && appliedCodePromo.scope === "SHIPPING" && appliedCodePromo.stackable) {
    const saved = shippingSavingsForPromo(appliedCodePromo, cascadePrice);
    if (saved > 0) {
      cascadePrice = Math.max(0, ceilCent(cascadePrice - saved));
      if (!stackFirstPromo) stackFirstPromo = appliedCodePromo;
      stackHasAnyPromo = true;
    }
  }
  const priceAfterPromosStack = cascadePrice;
  let stackHasUser = false;
  if (stackHasAnyPromo) {
    const savedByUser = clientShippingSavings(userShipping, cascadePrice);
    if (savedByUser > 0) {
      cascadePrice = Math.max(0, ceilCent(cascadePrice - savedByUser));
      stackHasUser = true;
    }
  }
  const stackSaved = carrierPrice - cascadePrice;

  // Candidats seuls (meilleure gagne historique).
  const soloCandidates: Array<{
    saved: number;
    source: "user" | "promotion";
    promotion?: ActivePromotion;
  }> = [];
  if (userSaved > 0) {
    soloCandidates.push({ saved: userSaved, source: "user" });
  }
  for (const promo of activePromos) {
    if (promo.scope !== "SHIPPING") continue;
    if (promo.type !== "AUTO") continue;
    if (promo.stackable) continue;
    const saved = shippingSavingsForPromo(promo, carrierPrice);
    if (saved > 0) soloCandidates.push({ saved, source: "promotion", promotion: promo });
  }
  if (appliedCodePromo && appliedCodePromo.scope === "SHIPPING" && !appliedCodePromo.stackable) {
    const saved = shippingSavingsForPromo(appliedCodePromo, carrierPrice);
    if (saved > 0) soloCandidates.push({ saved, source: "promotion", promotion: appliedCodePromo });
  }
  soloCandidates.sort((a, b) => b.saved - a.saved);
  const bestSolo = soloCandidates[0];

  // Choix final : max(cumul stackable, meilleur candidat seul).
  // On active le cluster seulement s'il combine réellement plusieurs sources
  // (au moins 1 promo stackable), sinon c'est équivalent au "user seul".
  const stackActive = stackHasAnyPromo;
  const useStack = stackActive && stackSaved >= (bestSolo?.saved ?? 0);

  if (!useStack && !bestSolo) {
    return {
      finalPrice: carrierPrice, savedAmount: 0, isFree: false,
      source: "none", promotion: null, stacked: false, savedByUser: 0,
    };
  }

  if (useStack) {
    const finalPrice = cascadePrice;
    return {
      finalPrice,
      savedAmount: stackSaved,
      isFree: stackSaved >= carrierPrice - 0.005,
      source: "stack",
      promotion: stackFirstPromo,
      stacked: true,
      savedByUser: stackHasUser ? Math.max(0, priceAfterPromosStack - cascadePrice) : 0,
    };
  }

  const best = bestSolo!;
  const finalPrice = Math.max(0, carrierPrice - best.saved);
  return {
    finalPrice,
    savedAmount: best.saved,
    isFree: best.saved >= carrierPrice - 0.005,
    source: best.source,
    promotion: best.promotion ?? null,
    stacked: false,
    savedByUser: best.source === "user" ? best.saved : 0,
  };
}
