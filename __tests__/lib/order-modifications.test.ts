import { describe, it, expect } from "vitest";
import { computePriceDifference, computeOrderBalance } from "@/lib/order-modifications";

describe("computePriceDifference", () => {
  it("retourne 0 quand aucune modification n'a eu lieu", () => {
    expect(
      computePriceDifference({
        originalQuantity: 5,
        originalUnitPrice: 20,
        newQuantity: 5,
        newUnitPrice: 20,
      }),
    ).toBe(0);
  });

  it("calcule un avoir positif quand la quantité baisse", () => {
    // 4 × 18 → 2 × 18 = 36 € d'avoir
    expect(
      computePriceDifference({
        originalQuantity: 4,
        originalUnitPrice: 18,
        newQuantity: 2,
        newUnitPrice: 18,
      }),
    ).toBe(36);
  });

  it("calcule un avoir positif quand le prix baisse à quantité inchangée", () => {
    // 5 × 24 → 5 × 22 = 10 € d'avoir
    expect(
      computePriceDifference({
        originalQuantity: 5,
        originalUnitPrice: 24,
        newQuantity: 5,
        newUnitPrice: 22,
      }),
    ).toBe(10);
  });

  it("cumule les deux ajustements (quantité + prix)", () => {
    // 4 × 20 = 80 → 2 × 15 = 30 → avoir de 50
    expect(
      computePriceDifference({
        originalQuantity: 4,
        originalUnitPrice: 20,
        newQuantity: 2,
        newUnitPrice: 15,
      }),
    ).toBe(50);
  });

  it("retourne le montant total quand l'article est retiré", () => {
    // 2 × 22,5 = 45 → 0 = 45 € d'avoir
    expect(
      computePriceDifference({
        originalQuantity: 2,
        originalUnitPrice: 22.5,
        newQuantity: 0,
        newUnitPrice: 22.5,
      }),
    ).toBe(45);
  });
});

describe("computeOrderBalance", () => {
  it("retourne reste=0 et avoir=0 quand le nouveau total = payé", () => {
    // 300 HT × 1.2 + 12 (port, hors TVA ici car tvaRate 0,2 appliquée sur HT+port)
    // tva = (300 + 12) × 0,2 = 62,40 → total 374,40
    const b = computeOrderBalance({
      subtotalHT: 300,
      tvaRate: 0.2,
      carrierPrice: 12,
      paidTotalTTC: 374.4,
    });
    expect(b.newTotalTTC).toBe(374.4);
    expect(b.remainingToPay).toBe(0);
    expect(b.creditToRefund).toBe(0);
  });

  it("expose un avoir à rembourser quand le nouveau total < payé", () => {
    // 250 HT × 1.2 + 12 TTC port → tva = (250+12)×0,2 = 52,40 → total 314,40 ; payé 374,40 → avoir 60 €
    const b = computeOrderBalance({
      subtotalHT: 250,
      tvaRate: 0.2,
      carrierPrice: 12,
      paidTotalTTC: 374.4,
    });
    expect(b.newTotalTTC).toBe(314.4);
    expect(b.remainingToPay).toBe(0);
    expect(b.creditToRefund).toBe(60);
  });

  it("expose un reste à régler quand le nouveau total > payé (dépassement autorisé)", () => {
    // 350 HT × 1.2 + 12 → tva = (350+12)×0,2 = 72,40 → total 434,40 ; payé 374,40 → reste 60 €
    const b = computeOrderBalance({
      subtotalHT: 350,
      tvaRate: 0.2,
      carrierPrice: 12,
      paidTotalTTC: 374.4,
    });
    expect(b.newTotalTTC).toBe(434.4);
    expect(b.remainingToPay).toBe(60);
    expect(b.creditToRefund).toBe(0);
  });

  it("arrondit la balance au centime (artefacts IEEE-754)", () => {
    // 4,20 × 3 produit 12,600000000000001 en IEEE-754 ; roundCent doit nettoyer.
    const b = computeOrderBalance({
      subtotalHT: 4.2 * 3,
      tvaRate: 0,
      carrierPrice: 0,
      paidTotalTTC: 12.6,
    });
    expect(b.newTotalTTC).toBe(12.6);
    expect(b.remainingToPay).toBe(0);
    expect(b.creditToRefund).toBe(0);
  });
});
