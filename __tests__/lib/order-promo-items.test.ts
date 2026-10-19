import { describe, it, expect } from "vitest";
import { getPromoItemsDiscount } from "@/lib/order-promo-items";

describe("getPromoItemsDiscount", () => {
  it("retourne 0 quand promoDiscount est nul ou négatif", () => {
    expect(getPromoItemsDiscount({ promoDiscount: 0, appliedPromotions: null })).toBe(0);
    expect(getPromoItemsDiscount({ promoDiscount: null, appliedPromotions: null })).toBe(0);
    expect(getPromoItemsDiscount({ promoDiscount: -5, appliedPromotions: null })).toBe(0);
  });

  it("retourne le montant quand le code promo cible les articles (scope ALL_PRODUCTS)", () => {
    expect(
      getPromoItemsDiscount({
        promoDiscount: 10,
        appliedPromotions: [{ kind: "CODE", scope: "ALL_PRODUCTS" }],
      }),
    ).toBe(10);
  });

  it("retourne 0 quand le code promo cible la livraison (scope SHIPPING)", () => {
    // La remise livraison est déjà intégrée à carrierPrice ; la re-déduire du
    // HT items ferait chuter le total d'un second montant équivalent.
    expect(
      getPromoItemsDiscount({
        promoDiscount: 10,
        appliedPromotions: [{ kind: "CODE", scope: "SHIPPING" }],
      }),
    ).toBe(0);
  });

  it("accepte Decimal via Number() (comportement Prisma)", () => {
    const decimal = { toString: () => "10", valueOf: () => 10 };
    expect(
      getPromoItemsDiscount({
        promoDiscount: decimal,
        appliedPromotions: [{ kind: "CODE", scope: "ALL_PRODUCTS" }],
      }),
    ).toBe(10);
  });

  it("fallback historique : pas de snapshot → traité comme items (99 % des cas)", () => {
    expect(
      getPromoItemsDiscount({ promoDiscount: 15, appliedPromotions: null }),
    ).toBe(15);
    expect(
      getPromoItemsDiscount({ promoDiscount: 15, appliedPromotions: undefined }),
    ).toBe(15);
  });

  it("ignore les entrées AUTO quand on cherche le scope CODE", () => {
    // Un code CODE scope=ALL_PRODUCTS peut cohabiter avec des AUTO shipping.
    expect(
      getPromoItemsDiscount({
        promoDiscount: 10,
        appliedPromotions: [
          { kind: "AUTO", scope: "SHIPPING" },
          { kind: "CODE", scope: "ALL_PRODUCTS" },
        ],
      }),
    ).toBe(10);
  });
});
