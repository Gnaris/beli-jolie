/**
 * Vérifie qu'un même panier + mêmes conditions produit EXACTEMENT le même totalTTC,
 * peu importe combien de fois on appelle le moteur. Ce test garantit que la
 * source de vérité (computeOrderPricing) est déterministe et que le panier + la
 * commande, qui l'appellent tous les deux, ne peuvent PAS diverger.
 */

import { describe, it, expect } from "vitest";
import { computeOrderPricing } from "@/lib/order-pricing";
import type { ActivePromotion } from "@/lib/promotion-engine";

function makeItem(id: string, unitPrice: number, quantity: number, productId = id) {
  return {
    id,
    quantity,
    promoContext: {
      productId,
      categoryId: null,
      collectionIds: [] as string[],
      unitPrice,
      productDiscountPercent: 0,
    },
  };
}

function makePercentPromo(id: string, percent: number, opts?: Partial<ActivePromotion>): ActivePromotion {
  return {
    id,
    name: `Promo ${id}`,
    type: "AUTO",
    code: null,
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
    ...opts,
  };
}

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

describe("Cohérence pricing panier ↔ commande", () => {
  it("Cas simple : deux appels successifs donnent le même totalTTC (déterministe)", () => {
    const items = [makeItem("i1", 12.99, 2), makeItem("i2", 4.5, 3)];
    const input = {
      items,
      carrierId: "colissimo",
      carrierPrice: 9.9,
      addressCountry: "FR",
      user: baseUser,
      activePromos: [] as ActivePromotion[],
      appliedCodePromo: null,
    };
    const a = computeOrderPricing(input);
    const b = computeOrderPricing(input);
    expect(a.totalTTC).toBe(b.totalTTC);
    expect(a.subtotalHT).toBe(b.subtotalHT);
    expect(a.subtotalBrutHT).toBe(b.subtotalBrutHT);
    expect(a.clientDiscountAmt).toBe(b.clientDiscountAmt);
    expect(a.tvaAmount).toBe(b.tvaAmount);
  });

  it("Cas complexe : promo AUTO -10% + remise client PERCENT 5% + port + TVA — déterministe", () => {
    const items = [makeItem("i1", 100, 1), makeItem("i2", 47.5, 2)];
    const promo = makePercentPromo("p1", 10);
    const user = {
      ...baseUser,
      discountType: "PERCENT" as const,
      discountValue: 5,
    };
    const input = {
      items,
      carrierId: "colissimo",
      carrierPrice: 5,
      addressCountry: "FR",
      user,
      activePromos: [promo],
      appliedCodePromo: null,
    };
    const a = computeOrderPricing(input);
    const b = computeOrderPricing(input);
    // Cohérence absolue : chaque champ identique à l'octet près.
    expect(a.totalTTC).toBe(b.totalTTC);
    expect(a.subtotalHT).toBe(b.subtotalHT);
    expect(a.clientDiscountAmt).toBe(b.clientDiscountAmt);
    expect(a.subtotalAfterDiscount).toBe(b.subtotalAfterDiscount);
    expect(a.tvaAmount).toBe(b.tvaAmount);
    expect(a.promoAutoDiscount).toBe(b.promoAutoDiscount);
    // Sanity : le totalTTC ne peut jamais être supérieur au max théorique brut × 1.2
    expect(a.totalTTC).toBeLessThanOrEqual(a.subtotalBrutHT * 1.2 + 5 * 1.2);
  });

  it("Formule TTC additive (jamais Math.round) : troncature stricte", () => {
    const items = [makeItem("i1", 4.2, 3)];
    const input = {
      items,
      carrierId: "colissimo",
      carrierPrice: 9.9,
      addressCountry: "FR",
      user: baseUser,
      activePromos: [] as ActivePromotion[],
      appliedCodePromo: null,
    };
    const r = computeOrderPricing(input);
    // brut = 4.2 × 3 = 12.60 (troncature au centime, pas arrondi à la hausse)
    expect(r.subtotalBrutHT).toBe(12.6);
    // total = 12.6 + 9.9 + (12.6 + 9.9) × 0.20 = 27
    expect(r.totalTTC).toBe(27);
  });

  it("Remise commerciale client PERCENT appliquée UNE FOIS sur subtotalHT, pas par item", () => {
    // 3 items à 3,33 € → subtotalHT = 9,99 €. Client -10 %.
    // Depuis 2026-08-31, on floor le sous-total après remise d'abord
    // (avantage client, aligné facturation) : floor(9,99 × 0,90) = 8,99 €,
    // et clientDiscountAmt = 9,99 − 8,99 = 1,00 €.
    // Le snapshot par item reste à 3,33 € (pas 2,99 par ligne comme avant).
    const items = [
      makeItem("i1", 3.33, 1),
      makeItem("i2", 3.33, 1),
      makeItem("i3", 3.33, 1),
    ];
    const user = {
      ...baseUser,
      discountType: "PERCENT" as const,
      discountValue: 10,
    };
    const input = {
      items,
      carrierId: "pickup_store",
      carrierPrice: 0,
      addressCountry: "FR",
      user,
      activePromos: [] as ActivePromotion[],
      appliedCodePromo: null,
    };
    const r = computeOrderPricing(input);
    expect(r.subtotalHT).toBeCloseTo(9.99, 2);
    expect(r.subtotalAfterDiscount).toBeCloseTo(8.99, 2);
    expect(r.clientDiscountAmt).toBeCloseTo(1.00, 2);
    // Chaque ligne conserve le prix produit final complet (pas de remise client par ligne)
    for (const [, entry] of r.itemFinalPrices) {
      expect(entry.finalUnitPrice).toBeCloseTo(3.33, 2);
    }
  });

  it("Cascade remise fiche + promo stackable au niveau item (rend 2,02 € au lieu de 2,25 €)", () => {
    // BL235 : prix 2,50 €, remise fiche 10 %, promo stackable 10 %.
    // Ancienne règle : max(remise, promo) = 10 % → 2,25 €. Nouvelle : cascade → 2,02 €.
    const items = [{
      id: "bl235-unit",
      quantity: 1,
      promoContext: {
        productId: "bl235",
        categoryId: null,
        collectionIds: [] as string[],
        unitPrice: 2.5,
        productDiscountPercent: 10,
      },
    }];
    const stackablePromo = makePercentPromo("p-summer", 10, { stackable: true });
    const input = {
      items,
      carrierId: "pickup_store",
      carrierPrice: 0,
      addressCountry: "FR",
      user: baseUser,
      activePromos: [stackablePromo],
      appliedCodePromo: null,
    };
    const r = computeOrderPricing(input);
    const entry = r.itemFinalPrices.get("bl235-unit");
    expect(entry?.finalUnitPrice).toBeCloseTo(2.02, 2);
    expect(entry?.source).toBe("stack");
  });

  // Régression 2026-08-31 : commande beliandjolie cmteptzaw0052dhg4h121pf2k.
  // Le calcul fautif floorait la remise avant soustraction : 258.50 × 0.05
  // = 12.925 → 12.92, puis 258.50 − 12.92 = 245.58 stocké (au lieu de 245.57)
  // → totalTTC 294.69 au lieu de 294.68 attendu par la facturation externe.
  it("258.50 avec −5 % : subtotalAfterDiscount 245.57 (pas 245.58), totalTTC 294.68 (pas 294.69)", () => {
    const items = [makeItem("i1", 258.50, 1)];
    const user = {
      ...baseUser,
      discountType: "PERCENT" as const,
      discountValue: 5,
    };
    const input = {
      items,
      carrierId: "pickup_store",
      carrierPrice: 0,
      addressCountry: "FR",
      user,
      activePromos: [] as ActivePromotion[],
      appliedCodePromo: null,
    };
    const r = computeOrderPricing(input);
    expect(r.subtotalHT).toBe(258.50);
    expect(r.subtotalAfterDiscount).toBe(245.57);
    expect(r.clientDiscountAmt).toBe(12.93);
    // Reconstruction PDF : subtotalHT + clientDiscountAmt = subtotalBrut affiché.
    expect(r.subtotalHT).toBeCloseTo(r.subtotalAfterDiscount + r.clientDiscountAmt, 5);
    expect(r.totalTTC).toBe(294.68);
  });

  it("promoAutoDiscount = subtotalBrut - subtotalHT (sans code) — pour affichage séparé du récap", () => {
    const items = [makeItem("i1", 100, 1)];
    const promo = makePercentPromo("p1", 20);
    const input = {
      items,
      carrierId: "colissimo",
      carrierPrice: 0,
      addressCountry: "FR",
      user: baseUser,
      activePromos: [promo],
      appliedCodePromo: null,
    };
    const r = computeOrderPricing(input);
    // brut 100 → -20% → 80. Promo auto = 100 - 80 = 20 (aucun code appliqué).
    expect(r.subtotalBrutHT).toBe(100);
    expect(r.subtotalHT).toBe(80);
    expect(r.promoAutoDiscount).toBe(20);
    expect(r.promoCodeSaved).toBe(0);
  });
});
