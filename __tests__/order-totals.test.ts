import { describe, it, expect } from "vitest";
import { recomputeOrderTotals } from "@/lib/order-totals";

describe("recomputeOrderTotals — sans remise client", () => {
  it("somme simple HT + TVA + transport", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 100 }, { lineTotal: 50 }],
      tvaRate: 0.2,
      carrierPrice: 10,
      clientDiscountType: null,
      clientDiscountValue: null,
    });

    expect(res.preDiscountSubtotal).toBe(150);
    expect(res.clientDiscountAmt).toBe(0);
    expect(res.subtotalHT).toBe(150);
    expect(res.tvaAmount).toBeCloseTo(30, 5);
    expect(res.totalTTC).toBeCloseTo(190, 5);
  });
});

describe("recomputeOrderTotals — remise PERCENT", () => {
  it("AUDIT [4] : remise de 10% réappliquée après retrait d'un article", () => {
    // Cas reel : 1000€ panier, -10% client => 900€ HT.
    // Admin retire un article 200€ → nouveau panier = 800€ HT.
    // Sans le fix : subtotalHT = 800 (pas de remise). Avec le fix : 720.
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 800 }],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "PERCENT",
      clientDiscountValue: 10,
    });

    expect(res.preDiscountSubtotal).toBe(800);
    expect(res.clientDiscountAmt).toBe(80);
    expect(res.subtotalHT).toBe(720);
    expect(res.tvaAmount).toBeCloseTo(144, 5);
    expect(res.totalTTC).toBeCloseTo(864, 5);
  });

  it("remise de 100% = total HT à 0, TVA à 0", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 100 }],
      tvaRate: 0.2,
      carrierPrice: 5,
      clientDiscountType: "PERCENT",
      clientDiscountValue: 100,
    });

    expect(res.clientDiscountAmt).toBe(100);
    expect(res.subtotalHT).toBe(0);
    expect(res.tvaAmount).toBe(0);
    expect(res.totalTTC).toBe(5); // juste le transport
  });
});

describe("recomputeOrderTotals — remise AMOUNT (montant fixe)", () => {
  it("remise de 50€ sur 200€ → subtotal 150€", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 200 }],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "AMOUNT",
      clientDiscountValue: 50,
    });

    expect(res.clientDiscountAmt).toBe(50);
    expect(res.subtotalHT).toBe(150);
    expect(res.tvaAmount).toBeCloseTo(30, 5);
    expect(res.totalTTC).toBeCloseTo(180, 5);
  });

  it("remise > sous-total : plafonnée au sous-total (jamais négatif)", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 30 }],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "AMOUNT",
      clientDiscountValue: 100,
    });

    expect(res.clientDiscountAmt).toBe(30);
    expect(res.subtotalHT).toBe(0);
    expect(res.totalTTC).toBe(0);
  });
});

describe("recomputeOrderTotals — types Prisma Decimal (toNumber)", () => {
  it("accepte des objets façon Decimal avec toNumber()", () => {
    const decimal = (n: number) => ({ toNumber: () => n });
    const res = recomputeOrderTotals({
      items: [{ lineTotal: decimal(100) }, { lineTotal: decimal(50) }],
      tvaRate: 0.2,
      carrierPrice: decimal(10),
      clientDiscountType: "PERCENT",
      clientDiscountValue: decimal(20),
    });

    expect(res.preDiscountSubtotal).toBe(150);
    expect(res.clientDiscountAmt).toBe(30);
    expect(res.subtotalHT).toBe(120);
    expect(res.tvaAmount).toBeCloseTo(24, 5);
    expect(res.totalTTC).toBeCloseTo(154, 5);
  });
});

describe("recomputeOrderTotals — edge cases", () => {
  it("panier vide → tout à 0 sauf transport", () => {
    const res = recomputeOrderTotals({
      items: [],
      tvaRate: 0.2,
      carrierPrice: 10,
      clientDiscountType: "PERCENT",
      clientDiscountValue: 50,
    });

    expect(res.preDiscountSubtotal).toBe(0);
    expect(res.clientDiscountAmt).toBe(0);
    expect(res.subtotalHT).toBe(0);
    expect(res.totalTTC).toBe(10);
  });

  it("clientDiscountValue=0 → pas de remise", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 100 }],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "PERCENT",
      clientDiscountValue: 0,
    });

    expect(res.clientDiscountAmt).toBe(0);
    expect(res.subtotalHT).toBe(100);
  });
});
