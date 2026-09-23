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
// Cumul « stackable » (2026-08-18 / 2026-08-21)
// La remise commerciale client n'entre plus par item : elle s'applique
// une seule fois sur le total panier (voir __tests__/order-totals.test.ts).
// ─────────────────────────────────────────────

describe("resolveBestItemDiscount — cumul remise fiche + promos stackable", () => {
  it("remise fiche -10 % + promo stackable -10 % → cascade 2,50€ → 2,25€ → 2,03€", () => {
    const promo = makePromo({
      scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE",
      discountValue: 10,
      stackable: true,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 2.5, productDiscountPercent: 10 }),
      [promo],
    );
    expect(res.stacked).toBe(true);
    expect(res.source).toBe("stack");
    // 2,50 → -10% → 2,25 → -10% → 2,025 → troncature → 2,02
    expect(res.finalUnitPrice).toBeCloseTo(2.02, 2);
  });

  it("2 promos stackables sans remise fiche → cascade multiplicative", () => {
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
    );
    expect(res.stacked).toBe(true);
    // 100 → -10% → 90 → -20% → 72
    expect(res.finalUnitPrice).toBeCloseTo(72);
  });

  it("remise fiche seule (aucune promo AUTO) → source product, pas stacked", () => {
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100, productDiscountPercent: 15 }),
      [],
    );
    expect(res.source).toBe("product");
    expect(res.stacked).toBe(false);
    expect(res.finalUnitPrice).toBe(85);
  });

  it("promo NON-stackable -30 % > remise fiche -5 % → meilleure gagne (non-stackable)", () => {
    const promo = makePromo({
      scope: "ALL_PRODUCTS",
      discountKind: "PERCENTAGE",
      discountValue: 30,
      stackable: false,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 100, productDiscountPercent: 5 }),
      [promo],
    );
    expect(res.stacked).toBe(false);
    expect(res.source).toBe("promotion");
    expect(res.finalUnitPrice).toBe(70);
  });

  it("promo stackable + promo non-stackable meilleure → non-stackable seule gagne", () => {
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
    );
    expect(res.stacked).toBe(false);
    expect(res.source).toBe("promotion");
    expect(res.promotion?.id).toBe("solo");
    expect(res.finalUnitPrice).toBe(70);
  });

  it("code promo stackable + remise fiche + promo AUTO stackable → cascade complète", () => {
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
      makeItem({ unitPrice: 100, productDiscountPercent: 10 }),
      [promo],
      code,
    );
    // 100 → -10% (fiche) → 90 → -10% (auto) → 81 → -10% (code) → 72,90
    expect(res.stacked).toBe(true);
    expect(res.finalUnitPrice).toBeCloseTo(72.9, 1);
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

describe("cascade — troncature au centime (règle métier : jamais d'arrondi à la hausse)", () => {
  it("10€ → remise fiche -10% → promo -5% → promo -3% = 8,29€ (troncature à chaque palier)", () => {
    const p1 = makePromo({
      id: "y", scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE",
      discountValue: 5, stackable: true,
    });
    const p2 = makePromo({
      id: "z", scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE",
      discountValue: 3, stackable: true,
    });
    const res = resolveBestItemDiscount(
      makeItem({ unitPrice: 10, productDiscountPercent: 10 }),
      [p1, p2],
    );
    // 10 → -10% → 9 → -5% → 8,55 → -3% → 8,2935 → trunc 8,29
    expect(res.stacked).toBe(true);
    expect(res.finalUnitPrice).toBeCloseTo(8.29, 2);
  });
});

describe("resolveCardPricing — affichage carte produit (sans remise client)", () => {
  it("aucune promo, aucune remise → hasPromo=false, hasAutoPromotion=false", () => {
    const res = resolveCardPricing(makeItem({ unitPrice: 10 }), []);
    expect(res.basePrice).toBe(10);
    expect(res.finalPrice).toBe(10);
    expect(res.hasPromo).toBe(false);
    expect(res.hasAutoPromotion).toBe(false);
    expect(res.promoPercent).toBe(0);
  });

  it("promo AUTO stackable seule → badge Promo + prix réduit + hasAutoPromotion=true", () => {
    const promo = makePromo({
      scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE",
      discountValue: 10, stackable: true,
    });
    const res = resolveCardPricing(makeItem({ unitPrice: 10 }), [promo]);
    expect(res.finalPrice).toBe(9);
    expect(res.hasPromo).toBe(true);
    expect(res.hasAutoPromotion).toBe(true);
    expect(res.promoPercent).toBe(10);
  });

  it("remise fiche seule (pas de promo AUTO) → badge Promo + hasAutoPromotion=false", () => {
    const res = resolveCardPricing(
      makeItem({ unitPrice: 10, productDiscountPercent: 20 }), [],
    );
    expect(res.finalPrice).toBe(8);
    expect(res.hasPromo).toBe(true);
    expect(res.hasAutoPromotion).toBe(false);
    expect(res.promoPercent).toBe(20);
  });

  it("remise fiche -10 % + promo AUTO stackable -10 % → cascade cumulée (badge Promo)", () => {
    const promo = makePromo({
      scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE",
      discountValue: 10, stackable: true,
    });
    const res = resolveCardPricing(
      makeItem({ unitPrice: 2.5, productDiscountPercent: 10 }),
      [promo],
    );
    // 2,50 → -10% → 2,25 → -10% → 2,025 → troncature → 2,02
    expect(res.finalPrice).toBeCloseTo(2.02, 2);
    expect(res.hasPromo).toBe(true);
    expect(res.hasAutoPromotion).toBe(true);
  });

  it("promo NON-stackable -30 % + remise fiche -5 % → non-stackable seule gagne", () => {
    const promo = makePromo({
      scope: "ALL_PRODUCTS", discountKind: "PERCENTAGE",
      discountValue: 30, stackable: false,
    });
    const res = resolveCardPricing(
      makeItem({ unitPrice: 100, productDiscountPercent: 5 }), [promo],
    );
    expect(res.finalPrice).toBe(70);
    expect(res.promoPercent).toBe(30);
    expect(res.hasAutoPromotion).toBe(true);
  });
});
