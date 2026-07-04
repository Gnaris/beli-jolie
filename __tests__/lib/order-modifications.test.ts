import { describe, it, expect } from "vitest";
import { computePriceDifference, checkOverpayment } from "@/lib/order-modifications";

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

describe("checkOverpayment", () => {
  it("accepte quand le nouveau total = montant payé", () => {
    // 300 HT × 1.2 + 12 = 372 TTC — le client a payé 372
    expect(checkOverpayment(300, 0.2, 12, 372)).toBeNull();
  });

  it("accepte quand le nouveau total est inférieur au montant payé", () => {
    expect(checkOverpayment(250, 0.2, 12, 372)).toBeNull();
  });

  it("refuse quand le nouveau total dépasse le montant payé", () => {
    // 350 HT × 1.2 + 12 = 432 TTC — le client n'a payé que 372
    const err = checkOverpayment(350, 0.2, 12, 372);
    expect(err).not.toBeNull();
    expect(err).toContain("Modification refusée");
    expect(err).toContain("432,00 €");
    expect(err).toContain("372,00 €");
  });

  it("tolère une différence de 1 centime (arrondi)", () => {
    // Petits arrondis dus aux Decimal MySQL
    expect(checkOverpayment(300, 0.2, 12, 371.995, 0.01)).toBeNull();
  });
});
