/**
 * Vérifie que le code promo saisi produit un montant IDENTIQUE à ce que
 * Sage 50 calcule quand la cliente saisit dans son logiciel les prix bruts
 * + une remise globale.
 *
 * Cas de référence (incident 2026-09-23, screenshot Sage FA…) :
 *   - 50 × 3,50 €  = 175,00 €
 *   - 19 × 39,84 € = 756,96 €
 *   - Brut HT     = 931,96 €
 *   - Code promo −10 % → Sage : 93,20 € (round half up sur le total)
 *   - Total HT après remise = 838,76 €
 *   - TVA 20 %              = 167,75 €
 *   - TTC                   = 1 006,51 €
 *
 * Avant refonte : le calcul par ligne donnait −93,31 € (12 ct d'écart) et
 * un TTC de 1 006,38 € — divergence avec Sage.
 */
import { describe, it, expect } from "vitest";
import { computeOrderPricing } from "@/lib/order-pricing";
import type { ActivePromotion } from "@/lib/promotion-engine";

const baseUser = {
  discountType: null,
  discountValue: null,
  discountMode: "PERMANENT" as const,
  discountMinAmount: null,
  discountMinQuantity: null,
  vatExempt: false,
  freeShipping: false,
  freeShippingMaxPrice: null,
  shippingDiscountType: null,
  shippingDiscountValue: null,
  shippingDiscountMode: "PERMANENT" as const,
  shippingDiscountMinAmount: null,
  shippingDiscountMinQuantity: null,
};

function makeCodePromo(percent: number, overrides: Partial<ActivePromotion> = {}): ActivePromotion {
  return {
    id: "code-1",
    name: "Test code",
    type: "CODE",
    code: "NEW10",
    scope: "ALL_PRODUCTS",
    stackable: false,
    discountKind: "PERCENTAGE",
    discountValue: percent,
    minOrderAmount: null,
    maxUses: null,
    maxUsesPerUser: null,
    currentUses: 0,
    startsAt: new Date(2020, 0, 1),
    endsAt: null,
    productIds: [],
    categoryIds: [],
    collectionIds: [],
    ...overrides,
  };
}

function makeItem(id: string, unitPrice: number, qty: number) {
  return {
    id,
    quantity: qty,
    promoContext: {
      productId: id,
      categoryId: null,
      collectionIds: [] as string[],
      unitPrice,
      productDiscountPercent: 0,
    },
  };
}

describe("Code promo — alignement Sage 50", () => {
  it("Cas incident 2026-09-23 : 931,96 € × 10 % → 93,20 € (comme Sage, pas 93,31 €)", () => {
    const result = computeOrderPricing({
      items: [makeItem("i1", 3.5, 50), makeItem("i2", 39.84, 19)],
      carrierId: "pickup_store",
      carrierPrice: 0,
      addressCountry: "FR",
      user: baseUser,
      activePromos: [],
      appliedCodePromo: makeCodePromo(10),
    });

    expect(result.subtotalBrutHT).toBeCloseTo(931.96, 2);
    expect(result.subtotalHT).toBeCloseTo(931.96, 2);
    expect(result.promoCodeSaved).toBeCloseTo(93.2, 2);
    expect(result.subtotalAfterDiscount).toBeCloseTo(838.76, 2);
    expect(result.tvaAmount).toBeCloseTo(167.75, 2);
    expect(result.totalTTC).toBeCloseTo(1006.51, 2);
  });

  it("La trace récap contient une ligne « Code promo (CODE) » avec le montant global", () => {
    const result = computeOrderPricing({
      items: [makeItem("i1", 3.5, 50), makeItem("i2", 39.84, 19)],
      carrierId: "pickup_store",
      carrierPrice: 0,
      addressCountry: "FR",
      user: baseUser,
      activePromos: [],
      appliedCodePromo: makeCodePromo(10),
    });

    const codeLine = result.discountTrace.find((l) => l.label.includes("NEW10"));
    expect(codeLine).toBeDefined();
    expect(codeLine!.amount).toBeCloseTo(93.2, 2);
    expect(codeLine!.percent).toBe(10);
  });

  it("Sans code promo, aucune ligne code n'est ajoutée à la trace", () => {
    const result = computeOrderPricing({
      items: [makeItem("i1", 3.5, 50), makeItem("i2", 39.84, 19)],
      carrierId: "pickup_store",
      carrierPrice: 0,
      addressCountry: "FR",
      user: baseUser,
      activePromos: [],
      appliedCodePromo: null,
    });

    expect(result.subtotalAfterDiscount).toBeCloseTo(931.96, 2);
    expect(result.promoCodeSaved).toBe(0);
    expect(result.discountTrace).toHaveLength(0);
  });

  it("Code promo FIXED_AMOUNT : montant plafonné au sous-total, jamais négatif", () => {
    const result = computeOrderPricing({
      items: [makeItem("i1", 10, 2)], // Sous-total = 20 €
      carrierId: "pickup_store",
      carrierPrice: 0,
      addressCountry: "FR",
      user: baseUser,
      activePromos: [],
      appliedCodePromo: makeCodePromo(0, {
        discountKind: "FIXED_AMOUNT",
        discountValue: 50, // Code de 50 € sur un panier de 20 €
      }),
    });

    expect(result.promoCodeSaved).toBeCloseTo(20, 2);
    expect(result.subtotalAfterDiscount).toBe(0);
  });
});
