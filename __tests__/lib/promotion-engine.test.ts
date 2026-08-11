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
    const res = resolveBestShippingDiscount(10, [], { isFree: false, savedAmount: 0 });
    expect(res.finalPrice).toBe(10);
    expect(res.source).toBe("none");
  });

  it("user free ship battu par une promo qui coûte moins ? → user gagne (économie ≥)", () => {
    const promo = makePromo({ scope: "SHIPPING", discountValue: 50 }); // -50 % => -5€
    const res = resolveBestShippingDiscount(
      10,
      [promo],
      { isFree: true, savedAmount: 10 },
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
      { isFree: false, savedAmount: 2 }, // 20 % de 10€
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
    const res = resolveBestShippingDiscount(10, [promo], { isFree: false, savedAmount: 0 });
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
    const res = resolveBestShippingDiscount(20, [auto], { isFree: false, savedAmount: 0 }, codePromo);
    expect(res.promotion?.id).toBe("code-ship");
    expect(res.finalPrice).toBe(0);
  });

  it("carrierPrice à 0 → aucune remise applicable", () => {
    const promo = makePromo({ scope: "SHIPPING", discountValue: 100 });
    const res = resolveBestShippingDiscount(0, [promo], { isFree: false, savedAmount: 0 });
    expect(res.finalPrice).toBe(0);
    expect(res.source).toBe("none");
  });
});
