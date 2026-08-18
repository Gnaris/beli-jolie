/**
 * Moteur de calcul des promotions — 100 % pur, réutilisable côté serveur
 * ET côté client (aucun import Prisma / server-only). Le fichier serveur
 * `lib/promotions.ts` s'appuie dessus pour la validation code promo et
 * l'application au flow placeOrder.
 *
 * Depuis 2026-08-18, chaque promotion peut être « stackable ». Une promo
 * stackable se cumule additivement avec :
 *   - les autres promos stackable qui ciblent le même item / la livraison,
 *   - la remise commerciale du client (profil).
 * Les promos non-stackable gardent le comportement historique « la meilleure
 * gagne ». Le résultat final = max(cumul stackable, meilleur candidat seul).
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
 * Remise commerciale du client à cumuler éventuellement avec les promos
 * stackable. Ne passer que si elle est effectivement applicable (seuils
 * validés en amont).
 */
export interface ClientDiscountForCumul {
  type: "PERCENT" | "AMOUNT";
  value: number;
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
  source: "none" | "product" | "promotion" | "client" | "stack";
  promotion: ActivePromotion | null;
  /** Vrai si le résultat vient du cluster cumulé (plusieurs remises additionnées). */
  stacked: boolean;
  /** Économie unitaire attribuable à la remise commerciale client (subset de savedPerUnit). */
  savedByClientDiscount: number;
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
 * Arrondi au centime SUPÉRIEUR (règle métier convenue le 2026-08-18).
 * Appliqué à chaque palier de la cascade (promo, remise client, prix final).
 *
 * Neutralise le bruit IEEE-754 : on travaille en millièmes de centime puis on
 * round pour tuer les décimales fantômes, avant d'appliquer Math.ceil. Sans ce
 * filtre, 7,47 est représenté 747.0000000000001 en flottant et ceil monte à
 * 7,48 € au lieu de rester à 7,47 €.
 */
export function ceilCent(n: number): number {
  const cents = Math.round(n * 100 * 1000) / 1000;
  return Math.ceil(cents) / 100;
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

function clientDiscountSavingsOnItem(client: ClientDiscountForCumul, unitPrice: number): number {
  if (unitPrice <= 0) return 0;
  if (client.type === "PERCENT") {
    return Math.max(0, unitPrice * (client.value / 100));
  }
  // AMOUNT — non traité au niveau item (appliqué en fin dans order-pricing).
  return 0;
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
  clientDiscount: ClientDiscountForCumul | null = null,
): ResolvedItemDiscount {
  // Client discount participe au cumul cascade uniquement en mode PERCENT.
  // AMOUNT sera appliqué en fin de commande dans order-pricing.
  const clientPercentForStack = clientDiscount && clientDiscount.type === "PERCENT"
    ? clientDiscount
    : null;

  // ── 1. Cluster cumulable : cascade multiplicative + ceilCent à chaque palier ─
  // Chaque promo stackable ciblant l'item s'applique sur le prix courant, puis
  // la remise commerciale client s'applique aussi en cascade sur le résiduel.
  // Règle métier : arrondi au centime supérieur (ceilCent) à chaque palier.
  let cascadePrice = item.unitPrice;
  let stackFirstPromo: ActivePromotion | null = null;

  for (const promo of activePromos) {
    if (promo.type !== "AUTO") continue;
    if (!promo.stackable) continue;
    if (!promotionTargetsItem(promo, item)) continue;
    const saved = itemSavingsForPromo(promo, cascadePrice);
    if (saved > 0) {
      cascadePrice = Math.max(0, ceilCent(cascadePrice - saved));
      if (!stackFirstPromo) stackFirstPromo = promo;
    }
  }
  if (appliedCodePromo && appliedCodePromo.stackable && promotionTargetsItem(appliedCodePromo, item)) {
    const saved = itemSavingsForPromo(appliedCodePromo, cascadePrice);
    if (saved > 0) {
      cascadePrice = Math.max(0, ceilCent(cascadePrice - saved));
      if (!stackFirstPromo) stackFirstPromo = appliedCodePromo;
    }
  }
  const stackHasAnyPromo = stackFirstPromo != null;
  const priceAfterPromosStack = cascadePrice; // avant remise client

  let stackHasClient = false;
  if (clientPercentForStack && stackHasAnyPromo) {
    const saved = clientDiscountSavingsOnItem(clientPercentForStack, cascadePrice);
    if (saved > 0) {
      cascadePrice = Math.max(0, ceilCent(cascadePrice - saved));
      stackHasClient = true;
    }
  }
  const stackSaved = item.unitPrice - cascadePrice;

  // ── 2. Candidats « seul » (meilleure gagne) ───────────────────
  //   Remise manuelle produit, chaque promo non-stackable, code non-stackable,
  //   et remise commerciale client (seule, si aucune promo stackable ne s'est
  //   déclenchée pour ne pas la compter deux fois — sinon elle vit dans le
  //   cluster ci-dessus).
  const soloCandidates: Array<{
    saved: number;
    source: "product" | "promotion" | "client";
    promotion?: ActivePromotion;
  }> = [];

  if (item.productDiscountPercent > 0) {
    const rawSaved = Math.min(item.unitPrice, item.unitPrice * (item.productDiscountPercent / 100));
    // On enregistre l'économie qui produira un finalPrice = ceilCent(unitPrice - rawSaved).
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
  if (clientPercentForStack) {
    const rawSaved = clientDiscountSavingsOnItem(clientPercentForStack, item.unitPrice);
    if (rawSaved > 0) {
      const finalPrice = Math.max(0, ceilCent(item.unitPrice - rawSaved));
      soloCandidates.push({ saved: item.unitPrice - finalPrice, source: "client" });
    }
  }

  soloCandidates.sort((a, b) => b.saved - a.saved);
  const bestSolo = soloCandidates[0];

  // ── 3. Choix final : max(cascade cumulée, meilleur candidat seul) ─
  const useStack = stackHasAnyPromo && stackSaved >= (bestSolo?.saved ?? 0);

  if (!useStack && !bestSolo) {
    return {
      finalUnitPrice: item.unitPrice,
      savedPerUnit: 0,
      displayPercent: 0,
      source: "none",
      promotion: null,
      stacked: false,
      savedByClientDiscount: 0,
    };
  }

  if (useStack) {
    const finalUnitPrice = cascadePrice;
    const displayPercent = item.unitPrice > 0
      ? Math.round((stackSaved / item.unitPrice) * 100)
      : 0;
    const savedByClientDiscount = stackHasClient
      ? Math.max(0, priceAfterPromosStack - cascadePrice)
      : 0;
    return {
      finalUnitPrice,
      savedPerUnit: stackSaved,
      displayPercent,
      source: "stack",
      promotion: stackFirstPromo,
      stacked: true,
      savedByClientDiscount,
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
    savedByClientDiscount: best.source === "client" ? best.saved : 0,
  };
}

/**
 * Décompose l'affichage prix d'une carte / fiche produit en 3 paliers
 * pour la cascade « prix initial → prix après promo → prix final client ».
 * Renvoie aussi `showPromoBadge` : true dès qu'une promo produit est active
 * (remise manuelle, AUTO ciblant, code stackable ciblant), indépendamment
 * de la remise commerciale du client.
 */
/**
 * Version « côté client » ultra-légère : ne dépend pas d'ActivePromotion.
 * Reçoit directement le `productDiscountPercent` (déjà résolu au badge, cf.
 * `enrichProductsWithBestPromoPercent`) et applique la cascade
 * (produit → client). Utilisé par les cards / la fiche produit pour afficher
 * les 3 paliers de prix.
 */
export interface CardPriceCascade {
  basePrice: number;
  priceAfterPromo: number;
  finalPrice: number;
  hasPromo: boolean;
  hasClient: boolean;
  promoPercent: number;
  clientPercent: number;
  totalPercent: number;
}

export function computeCardPriceCascade(
  basePrice: number,
  productDiscountPercent?: number | null,
  clientDiscount?: { discountType: "PERCENT" | "AMOUNT"; discountValue: number } | null,
): CardPriceCascade {
  const promoPercent = productDiscountPercent && productDiscountPercent > 0
    ? productDiscountPercent
    : 0;
  const priceAfterPromo = promoPercent > 0
    ? Math.max(0, ceilCent(basePrice * (1 - promoPercent / 100)))
    : basePrice;

  let finalPrice = priceAfterPromo;
  let clientPercent = 0;
  if (clientDiscount && clientDiscount.discountValue > 0) {
    if (clientDiscount.discountType === "PERCENT") {
      clientPercent = clientDiscount.discountValue;
      finalPrice = Math.max(0, ceilCent(priceAfterPromo * (1 - clientDiscount.discountValue / 100)));
    } else {
      const cutAbs = Math.min(clientDiscount.discountValue, priceAfterPromo);
      finalPrice = Math.max(0, ceilCent(priceAfterPromo - clientDiscount.discountValue));
      clientPercent = priceAfterPromo > 0 ? Math.round((cutAbs / priceAfterPromo) * 100) : 0;
    }
  }

  const hasPromo = promoPercent > 0;
  const hasClient = finalPrice < priceAfterPromo - 0.005;
  const totalPercent = basePrice > 0
    ? Math.round(((basePrice - finalPrice) / basePrice) * 100)
    : 0;

  return {
    basePrice,
    priceAfterPromo,
    finalPrice,
    hasPromo,
    hasClient,
    promoPercent,
    clientPercent,
    totalPercent,
  };
}

export interface ResolvedCardPricing {
  basePrice: number;
  priceAfterPromo: number;   // = basePrice si aucune promo produit
  finalPrice: number;        // = priceAfterPromo si pas de remise client applicable
  promoPercent: number;      // 0..100 — remise attribuable aux promos (arrondi)
  clientPercent: number;     // 0..100 — remise attribuable au client (arrondi)
  totalPercent: number;      // 0..100 — remise totale affichée (arrondi)
  hasPromo: boolean;         // true si un badge Promo doit s'afficher
  hasClient: boolean;        // true si la remise client contribue au prix final
}

export function resolveCardPricing(
  item: ItemPromoContext,
  activePromos: ActivePromotion[],
  clientDiscount: ClientDiscountForCumul | null = null,
): ResolvedCardPricing {
  const basePrice = item.unitPrice;

  const withoutClient = resolveBestItemDiscount(item, activePromos, null, null);
  const withClient = resolveBestItemDiscount(item, activePromos, null, clientDiscount);

  const priceAfterPromo = withoutClient.finalUnitPrice;
  const finalPrice = withClient.finalUnitPrice;

  // Y a-t-il une vraie promo (badge à afficher) ?
  const hasPromo = withoutClient.source === "product"
    || withoutClient.source === "promotion"
    || withoutClient.source === "stack";

  const hasClient = finalPrice < priceAfterPromo - 0.005;

  const promoPercent = basePrice > 0 && hasPromo
    ? Math.round(((basePrice - priceAfterPromo) / basePrice) * 100)
    : 0;
  const clientPercent = hasClient && priceAfterPromo > 0
    ? Math.round(((priceAfterPromo - finalPrice) / priceAfterPromo) * 100)
    : 0;
  const totalPercent = basePrice > 0
    ? Math.round(((basePrice - finalPrice) / basePrice) * 100)
    : 0;

  return {
    basePrice,
    priceAfterPromo,
    finalPrice,
    promoPercent,
    clientPercent,
    totalPercent,
    hasPromo,
    hasClient,
  };
}

/**
 * Meilleur % équivalent pour un badge sur une card produit (avant sélection
 * d'une variante). Compare la remise manuelle aux promotions AUTO ciblant le
 * produit — ignore SHIPPING. Ignore aussi la remise commerciale client
 * (variable selon client, pas affichable sur un badge public).
 * Cumul stackable inclus pour refléter au mieux le prix affiché.
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
    productDiscountPercent: 0,
  };

  // Candidat cumulable — cascade multiplicative sur 100 (produit).
  let cascade = 100;
  let hasAnyStack = false;
  for (const promo of activePromos) {
    if (promo.type !== "AUTO") continue;
    if (promo.scope === "SHIPPING") continue;
    if (!promo.stackable) continue;
    if (!promotionTargetsItem(promo, dummyItem)) continue;
    const saved = itemSavingsForPromo(promo, cascade);
    if (saved > 0) {
      cascade = Math.max(0, cascade - saved);
      hasAnyStack = true;
    }
  }
  const stackSaved = 100 - cascade;

  // Candidats non-stackables + remise manuelle.
  let bestSolo = ctx.productDiscountPercent > 0 ? ctx.productDiscountPercent : 0;
  for (const promo of activePromos) {
    if (promo.type !== "AUTO") continue;
    if (promo.scope === "SHIPPING") continue;
    if (promo.stackable) continue;
    if (!promotionTargetsItem(promo, dummyItem)) continue;
    const saved = itemSavingsForPromo(promo, 100);
    if (saved > bestSolo) bestSolo = saved;
  }

  return Math.round(hasAnyStack ? Math.max(stackSaved, bestSolo) : bestSolo);
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
