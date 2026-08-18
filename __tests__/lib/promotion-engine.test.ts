/**
 * Tests du moteur pur de promotions (lib/promotion-engine.ts).
 * Aucune dépendance Prisma — tout est stubbé via des ActivePromotion en mémoire.
 */
import { describe, it, expect } from "vitest";
import {
  promotionTargetsItem,
  resolveBestItemDiscount,
  resolveBestPercentForProductBadge,
  resolveBestShippingDiscount,
  resolveCardPricing,
  type ActivePromotion,
  type ItemPromoContext,
} from "@/lib/promotion-engine";

function makePromo(overrides: Partial<ActivePromotion> = {}): ActivePromotion {
  return {
    id: "promo-1",
    name: "Test promo",
    type: "AUTO",
    code: null,
    scope: "ALL_PRODUCTS",
    discountKind: "PERCENTAGE",
    discountValue: 10,
    minOrderAmount: null,
    maxUses: null,
    maxUsesPerUser: null,
    firstOrderOnly: false,
    currentUses: 0,
    startsAt: new Date("2020-01-01"),
    endsAt: null,
    productIds: [],
    categoryIds: [],
    collectionIds: [],
    stackable: false,
    ...overrides,
  };
}

/** Raccourci pour construire le user shipping (format ClientShippingDiscountForCumul). */
function userShipping(overrides: Partial<{
  isFree: boolean;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}> = {}) {
  return {
    isFree: false,
    discountType: null,
    discountValue: null,
    ...overrides,
  };
}

function makeItem(overrides: Partial<ItemPromoContext> = {}): ItemPromoContext {
  return {
    productId: "product-1",
    categoryId: "cat-1",
    collectionIds: [],
    unitPrice: 100,
    productDiscountPercent: 0,
    ...overrides,
  };
}

describe("promotionTargetsItem", () => {
  it("ALL_PRODUCTS cible tout", () => {
    const promo = makePromo({ scope: "ALL_PRODUCTS" });
    expect(promotionTargetsItem(promo, makeItem())).toBe(true);
  });

  it("PRODUCTS ne cible que si l'id est dans la liste", () => {
    const promo = makePromo({ scope: "PRODUCTS", productIds: ["p-A", "p-B"] });
    expect(promotionTargetsItem(promo, makeItem({ productId: "p-A" }))).toBe(true);
    expect(promotionTargetsItem(promo, makeItem({ productId: "p-Z" }))).toBe(false);
  });

  it("CATEGORIES ne cible que si la catégorie de l'item est dans la liste", () => {
    const promo = makePromo({ scope: "CATEGORIES", categoryIds: ["cat-1"] });
    expect(promotionTargetsItem(promo, makeItem({ categoryId: "cat-1" }))).toBe(true);
    expect(promotionTargetsItem(promo, makeItem({ categoryId: "cat-2" }))).toBe(false);
    expect(promotionTargetsItem(promo, makeItem({ categoryId: null }))).toBe(false);
  });

  it("COLLECTIONS matche si intersection non vide", () => {
    const promo = makePromo({ scope: "COLLECTIONS", collectionIds: ["col-1", "col-2"] });
    expect(promotionTargetsItem(promo, makeItem({ collectionIds: ["col-2", "col-3"] }))).toBe(true);
    expect(promotionTargetsItem(promo, makeItem({ collectionIds: ["col-99"] }))).toBe(false);
    expect(promotionTargetsItem(promo, makeItem({ collectionIds: [] }))).toBe(false);
  });

  it("SHIPPING ne cible jamais un item", () => {
    const promo = makePromo({ scope: "SHIPPING" });
    expect(promotionTargetsItem(promo, makeItem())).toBe(false);
  });
});

describe("resolveBestItemDiscount — la meilleure gagne", () => {
  it("aucune promo, aucune remise produit → prix inchangé", () => {
    const res = resolveBestItemDiscount(makeItem({ unitPrice: 100 }), []);
    expect(res.finalUnitPrice).toBe(100);
    expect(res.source).toBe("none");
    expect(res.displayPercent).toBe(0);
  });

  it("remise produit manuelle seule (-10%) → -10 %", () => {
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100, productDiscountPercent: 10 }),
      [],
    );
    expect(res.finalUnitPrice).toBe(90);
    expect(res.source).toBe("product");
  });

  it("promo AUTO ALL_PRODUCTS -5% écrasée par remise produit -10 %", () => {
    const promo = makePromo({ scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE", discountValue: 5 });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100, productDiscountPercent: 10 }),
      [promo],
    );
    expect(res.source).toBe("product");
    expect(res.finalUnitPrice).toBe(90);
  });

  it("promo AUTO PRODUCTS -20% écrase la remise manuelle -10 %", () => {
    const promo = makePromo({
      scope: "PRODUCTS",
      productIds: ["product-1"],
      discountKind: "PERCENTAGE",
      discountValue: 20,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100, productDiscountPercent: 10 }),
      [promo],
    );
    expect(res.source).toBe("promotion");
    expect(res.finalUnitPrice).toBe(80);
    expect(res.promotion?.id).toBe(promo.id);
  });

  it("Fixed amount peut battre un %", () => {
    const percentPromo = makePromo({
      id: "pct",
      scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE",
      discountValue: 5,
    });
    const fixedPromo = makePromo({
      id: "fixed",
      scope: "ALL_PRODUCTS",
      discountKind: "FIXED_AMOUNT",
      discountValue: 20,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100 }),
      [percentPromo, fixedPromo],
    );
    expect(res.promotion?.id).toBe("fixed");
    expect(res.finalUnitPrice).toBe(80);
  });

  it("code promo saisi peut battre l'AUTO", () => {
    const autoPromo = makePromo({ id: "auto", scope: "ALL_PRODUCTS", discountValue: 5 });
    const codePromo = makePromo({
      id: "code",
      type: "CODE",
      code: "BOOST",
      scope: "PRODUCTS",
      productIds: ["product-1"],
      discountValue: 25,
    });
    const res = resolveBestItemDiscount(makeItem({ unitPrice: 100 }), [autoPromo], codePromo);
    expect(res.promotion?.id).toBe("code");
    expect(res.finalUnitPrice).toBe(75);
  });

  it("promo COLLECTIONS s'applique si l'item appartient à la collection", () => {
    const promo = makePromo({
      scope: "COLLECTIONS",
      collectionIds: ["col-summer"],
      discountValue: 30,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100, collectionIds: ["col-summer"] }),
      [promo],
    );
    expect(res.source).toBe("promotion");
    expect(res.finalUnitPrice).toBe(70);
  });

  it("promo AUTO SHIPPING ne touche jamais un item", () => {
    const promo = makePromo({ scope: "SHIPPING", discountValue: 50 });
    const res = resolveBestItemDiscount(makeItem({ unitPrice: 100 }), [promo]);
    expect(res.source).toBe("none");
    expect(res.finalUnitPrice).toBe(100);
  });

  it("promo CODE non appliquée si scope shipping et on est sur item", () => {
    const codePromo = makePromo({
      type: "CODE",
      code: "FREESHIP",
      scope: "SHIPPING",
      discountValue: 100,
    });
    const res = resolveBestItemDiscount(makeItem({ unitPrice: 50 }), [], codePromo);
    expect(res.source).toBe("none");
    expect(res.finalUnitPrice).toBe(50);
  });
});

describe("resolveBestPercentForProductBadge", () => {
  it("retourne le % promo AUTO si supérieur à la remise manuelle", () => {
    const promo = makePromo({ scope: "ALL_PRODUCTS", discountValue: 15 });
    const pct = resolveBestPercentForProductBadge(
      { productId: "p-1", categoryId: null, collectionIds: [], productDiscountPercent: 5 },
      [promo],
    );
    expect(pct).toBe(15);
  });

  it("retourne la remise manuelle si aucune promo n'est plus forte", () => {
    const promo = makePromo({ scope: "ALL_PRODUCTS", discountValue: 3 });
    const pct = resolveBestPercentForProductBadge(
      { productId: "p-1", categoryId: null, collectionIds: [], productDiscountPercent: 12 },
      [promo],
    );
    expect(pct).toBe(12);
  });

  it("ignore les promos SHIPPING", () => {
    const shipPromo = makePromo({ scope: "SHIPPING", discountValue: 100 });
    const pct = resolveBestPercentForProductBadge(
      { productId: "p-1", categoryId: null, collectionIds: [], productDiscountPercent: 0 },
      [shipPromo],
    );
    expect(pct).toBe(0);
  });
});

describe("resolveBestShippingDiscount", () => {
  it("aucune remise → prix intact", () => {
    const res = resolveBestShippingDiscount(10, [], userShipping());
    expect(res.finalPrice).toBe(10);
    expect(res.source).toBe("none");
  });

  it("user free ship battu par une promo qui coûte moins ? → user gagne (économie ≥)", () => {
    const promo = makePromo({ scope: "SHIPPING", discountValue: 50 }); // -50 % => -5€
    const res = resolveBestShippingDiscount(
      10,
      [promo],
      userShipping({ isFree: true }),
    );
    // User gratifie 10€ économie, promo 5€ → user gagne
    expect(res.source).toBe("user");
    expect(res.finalPrice).toBe(0);
    expect(res.isFree).toBe(true);
  });

  it("promo SHIPPING 100 % bat une remise user 20 %", () => {
    const promo = makePromo({
      scope: "SHIPPING",
      discountKind: "PERCENTAGE",
      discountValue: 100,
    });
    const res = resolveBestShippingDiscount(
      10,
      [promo],
      userShipping({ discountType: "PERCENT", discountValue: 20 }), // 20 % de 10€ = 2€
    );
    expect(res.source).toBe("promotion");
    expect(res.finalPrice).toBe(0);
    expect(res.isFree).toBe(true);
  });

  it("promo SHIPPING FIXED_AMOUNT limitée au prix carrier", () => {
    const promo = makePromo({
      scope: "SHIPPING",
      discountKind: "FIXED_AMOUNT",
      discountValue: 999,
    });
    const res = resolveBestShippingDiscount(10, [promo], userShipping());
    expect(res.finalPrice).toBe(0);
    expect(res.savedAmount).toBe(10);
  });

  it("promo SHIPPING code saisi appliqué en priorité si meilleur", () => {
    const auto = makePromo({
      id: "auto-ship",
      scope: "SHIPPING",
      discountKind: "PERCENTAGE",
      discountValue: 10,
    });
    const codePromo = makePromo({
      id: "code-ship",
      type: "CODE",
      code: "FREESHIP",
      scope: "SHIPPING",
      discountKind: "PERCENTAGE",
      discountValue: 100,
    });
    const res = resolveBestShippingDiscount(20, [auto], userShipping(), codePromo);
    expect(res.promotion?.id).toBe("code-ship");
    expect(res.finalPrice).toBe(0);
  });

  it("carrierPrice à 0 → aucune remise applicable", () => {
    const promo = makePromo({ scope: "SHIPPING", discountValue: 100 });
    const res = resolveBestShippingDiscount(0, [promo], userShipping());
    expect(res.finalPrice).toBe(0);
    expect(res.source).toBe("none");
  });
});

// ─────────────────────────────────────────────
// Cumul « stackable » (2026-08-18)
// ─────────────────────────────────────────────

describe("resolveBestItemDiscount — cumul stackable en cascade", () => {
  it("promo stackable -10 % + client -20 % (PERCENT) → cascade 10€ → 9€ → 7,20€", () => {
    const promo = makePromo({
      scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE",
      discountValue: 10,
      stackable: true,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 10 }),
      [promo],
      null,
      { type: "PERCENT", value: 20 },
    );
    expect(res.stacked).toBe(true);
    expect(res.source).toBe("stack");
    expect(res.finalUnitPrice).toBeCloseTo(7.2); // 10 → 9 → 7,20
    expect(res.savedByClientDiscount).toBeCloseTo(1.8); // 9 - 7,20
  });

  it("promo NON-stackable -5 % + client -10 % (PERCENT) → meilleure gagne (client -10%)", () => {
    const promo = makePromo({
      scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE",
      discountValue: 5,
      stackable: false,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100 }),
      [promo],
      null,
      { type: "PERCENT", value: 10 },
    );
    expect(res.stacked).toBe(false);
    expect(res.source).toBe("client");
    expect(res.finalUnitPrice).toBe(90);
  });

  it("promo stackable ne cible PAS l'item → client seul s'applique quand même", () => {
    const promo = makePromo({
      scope: "PRODUCTS",
      productIds: ["other"],
      discountValue: 5,
      stackable: true,
    });
    const res = resolveBestItemDiscount(
      makeItem({ productId: "product-1", unitPrice: 100 }),
      [promo],
      null,
      { type: "PERCENT", value: 10 },
    );
    // Aucune stack applicable → client seul gagne (source="client")
    expect(res.source).toBe("client");
    expect(res.finalUnitPrice).toBe(90);
  });

  it("2 promos stackables → cascade multiplicative", () => {
    const promoA = makePromo({
      id: "A", scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE", discountValue: 10, stackable: true,
    });
    const promoB = makePromo({
      id: "B", scope: "CATEGORIES", categoryIds: ["cat-1"],
      discountKind: "PERCENTAGE", discountValue: 20, stackable: true,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100, categoryId: "cat-1" }),
      [promoA, promoB],
      null,
    );
    expect(res.stacked).toBe(true);
    // 100 → -10% → 90 → -20% → 72
    expect(res.finalUnitPrice).toBeCloseTo(72);
  });

  it("promo stackable + promo non-stackable meilleure → non-stackable seule gagne si > cascade stack", () => {
    const stack = makePromo({
      id: "stack", scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE", discountValue: 5, stackable: true,
    });
    const solo = makePromo({
      id: "solo", scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE", discountValue: 30, stackable: false,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100 }),
      [stack, solo],
      null,
    );
    // cascade stack = 5 (100→95), non-stack solo = 30 → non-stack gagne
    expect(res.stacked).toBe(false);
    expect(res.source).toBe("promotion");
    expect(res.promotion?.id).toBe("solo");
    expect(res.finalUnitPrice).toBe(70);
  });

  it("client discount AMOUNT non intégré au cumul par item (traité en fin)", () => {
    const promo = makePromo({
      scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE",
      discountValue: 5,
      stackable: true,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100 }),
      [promo],
      null,
      { type: "AMOUNT", value: 20 },
    );
    // AMOUNT ignoré par l'engine — seule la promo stack s'applique (100→95)
    expect(res.source).toBe("stack");
    expect(res.finalUnitPrice).toBe(95);
    expect(res.savedByClientDiscount).toBe(0);
  });

  it("code promo stackable se cumule en cascade avec promo AUTO stackable et client %", () => {
    const promo = makePromo({
      id: "auto", scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE", discountValue: 10, stackable: true,
    });
    const code = makePromo({
      id: "code", type: "CODE", code: "BOOST",
      scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE", discountValue: 10, stackable: true,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100 }),
      [promo],
      code,
      { type: "PERCENT", value: 10 },
    );
    // 100 → -10% → 90 → -10% → 81 → -10% → 72,90 (déjà 2 décimales) → 72,90
    // (ceilCent d'un nombre déjà 2 décimales = lui-même ; mais IEEE peut donner 72,9000001 → ceil = 72,91)
    expect(res.stacked).toBe(true);
    expect(res.finalUnitPrice).toBeCloseTo(72.91, 1);
  });

  it("code stackable + promo AUTO non-stackable → code s'associe au cluster + client (cascade)", () => {
    const auto = makePromo({
      id: "auto", scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE", discountValue: 8, stackable: false,
    });
    const code = makePromo({
      id: "code", type: "CODE", code: "BOOST",
      scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE", discountValue: 5, stackable: true,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100 }),
      [auto], code, { type: "PERCENT", value: 10 },
    );
    // cascade stack = 100 → -5% → 95 → -10% → 85,50 ; solo max = 10 (client) ou 8 (auto)
    // → cascade stack (14,50) gagne
    expect(res.stacked).toBe(true);
    expect(res.finalUnitPrice).toBeCloseTo(85.5);
  });
});

describe("resolveBestShippingDiscount — cumul stackable en cascade", () => {
  it("promo SHIPPING stackable -50 % + user -50 % → cascade 10€ → 5€ → 2,50€", () => {
    const promo = makePromo({
      scope: "SHIPPING",
      discountKind: "PERCENTAGE",
      discountValue: 50,
      stackable: true,
    });
    const res = resolveBestShippingDiscount(
      10,
      [promo],
      userShipping({ discountType: "PERCENT", discountValue: 50 }),
    );
    expect(res.stacked).toBe(true);
    expect(res.finalPrice).toBeCloseTo(2.5);
    expect(res.isFree).toBe(false);
  });

  it("user déjà freeShipping (100 %) + promo stackable → livraison offerte", () => {
    const promo = makePromo({
      scope: "SHIPPING",
      discountKind: "PERCENTAGE",
      discountValue: 50,
      stackable: true,
    });
    const res = resolveBestShippingDiscount(
      10,
      [promo],
      userShipping({ isFree: true }),
    );
    // Cascade : 10 → -50% → 5 → user free = 100% → 0
    expect(res.finalPrice).toBe(0);
    expect(res.isFree).toBe(true);
  });

  it("2 promos SHIPPING stackables + user 20 % → cascade", () => {
    const promoA = makePromo({
      id: "A", scope: "SHIPPING",
      discountKind: "PERCENTAGE", discountValue: 20, stackable: true,
    });
    const promoB = makePromo({
      id: "B", scope: "SHIPPING",
      discountKind: "FIXED_AMOUNT", discountValue: 2, stackable: true,
    });
    const res = resolveBestShippingDiscount(
      10,
      [promoA, promoB],
      userShipping({ discountType: "PERCENT", discountValue: 20 }),
    );
    // Cascade : 10 → -20% → 8 → -2€ → 6 → -20% → 4,80
    expect(res.stacked).toBe(true);
    expect(res.finalPrice).toBeCloseTo(4.8);
    expect(res.savedAmount).toBeCloseTo(5.2);
  });

  it("promo NON-stackable -100 % bat le cluster stack cascade -44 % → non-stackable gagne", () => {
    const stack = makePromo({
      id: "stack", scope: "SHIPPING",
      discountKind: "PERCENTAGE", discountValue: 30, stackable: true,
    });
    const solo = makePromo({
      id: "solo", scope: "SHIPPING",
      discountKind: "PERCENTAGE", discountValue: 100, stackable: false,
    });
    const res = resolveBestShippingDiscount(
      10,
      [stack, solo],
      userShipping({ discountType: "PERCENT", discountValue: 20 }),
    );
    // Stack cascade : 10 → -30% → 7 → -20% → 5,60 (44%) ; solo = 100%
    expect(res.stacked).toBe(false);
    expect(res.source).toBe("promotion");
    expect(res.promotion?.id).toBe("solo");
    expect(res.finalPrice).toBe(0);
  });
});

// ─────────────────────────────────────────────
// resolveCardPricing — affichage cascade des cartes produit
// ─────────────────────────────────────────────

describe("cascade — arrondi ceilCent centime par centime (règle métier 2026-08-18)", () => {
  it("10€ → promo -10% → -5% → -3% → client -10% avec ceil = 7,47€", () => {
    const p1 = makePromo({
      id: "y", scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE",
      discountValue: 10, stackable: true,
    });
    const p2 = makePromo({
      id: "x", scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE",
      discountValue: 5, stackable: true,
    });
    const p3 = makePromo({
      id: "z", scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE",
      discountValue: 3, stackable: true,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 10 }),
      [p1, p2, p3],
      null,
      { type: "PERCENT", value: 10 },
    );
    // 10 → -10% → 9 → -5% → 8,55 → -3% → 8,2935 → ceil 8,30 → -10% → 7,47
    expect(res.stacked).toBe(true);
    expect(res.finalUnitPrice).toBeCloseTo(7.47, 2);
  });
});

describe("resolveCardPricing — 3 paliers d'affichage", () => {
  it("aucune promo, aucun client → hasPromo=false, hasClient=false", () => {
const res = resolveCardPricing(makeItem({ unitPrice: 10 }), []);
    expect(res.basePrice).toBe(10);
    expect(res.priceAfterPromo).toBe(10);
    expect(res.finalPrice).toBe(10);
    expect(res.hasPromo).toBe(false);
    expect(res.hasClient).toBe(false);
    expect(res.totalPercent).toBe(0);
  });

  it("promo stackable seule → prix barré + prix après promo, PAS de palier client", () => {
const promo = makePromo({
      scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE",
      discountValue: 10, stackable: true,
    });
    const res = resolveCardPricing(makeItem({ unitPrice: 10 }), [promo]);
    expect(res.priceAfterPromo).toBe(9);
    expect(res.finalPrice).toBe(9);
    expect(res.hasPromo).toBe(true);
    expect(res.hasClient).toBe(false);
    expect(res.promoPercent).toBe(10);
    expect(res.totalPercent).toBe(10);
  });

  it("remise client seule → prix barré + prix client, PAS de badge Promo", () => {
const res = resolveCardPricing(
      makeItem({ unitPrice: 10 }), [],
      { type: "PERCENT", value: 20 },
    );
    expect(res.priceAfterPromo).toBe(10);
    expect(res.finalPrice).toBe(8);
    expect(res.hasPromo).toBe(false);
    expect(res.hasClient).toBe(true);
    expect(res.clientPercent).toBe(20);
    expect(res.totalPercent).toBe(20);
  });

  it("promo stackable + client → 3 paliers (barré, barré, final)", () => {
const promo = makePromo({
      scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE",
      discountValue: 10, stackable: true,
    });
    const res = resolveCardPricing(
      makeItem({ unitPrice: 10 }), [promo],
      { type: "PERCENT", value: 20 },
    );
    // 10 → -10% → 9 → -20% → 7,20
    expect(res.priceAfterPromo).toBe(9);
    expect(res.finalPrice).toBeCloseTo(7.2);
    expect(res.hasPromo).toBe(true);
    expect(res.hasClient).toBe(true);
    expect(res.promoPercent).toBe(10);
    expect(res.clientPercent).toBe(20);
    expect(res.totalPercent).toBe(28); // 10 → 7,20 = -28%
  });

  it("promo NON-stackable + client → meilleure gagne, pas de cumul (source unique)", () => {
const promo = makePromo({
      scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE",
      discountValue: 5, stackable: false,
    });
    const res = resolveCardPricing(
      makeItem({ unitPrice: 100 }), [promo],
      { type: "PERCENT", value: 10 },
    );
    // withoutClient : promo -5% gagne (source promotion) → 95
    // withClient : client -10% gagne (source client, meilleure) → 90
    // priceAfterPromo = 95 (badge promo affiché), finalPrice = 90 (barré)
    expect(res.priceAfterPromo).toBe(95);
    expect(res.finalPrice).toBe(90);
    expect(res.hasPromo).toBe(true);
    expect(res.hasClient).toBe(true);
  });

  it("remise manuelle produit → badge Promo (source product)", () => {
const res = resolveCardPricing(
      makeItem({ unitPrice: 10, productDiscountPercent: 20 }), [],
    );
    expect(res.finalPrice).toBe(8);
    expect(res.hasPromo).toBe(true);
    expect(res.hasClient).toBe(false);
  });
});
