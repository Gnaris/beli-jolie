import { describe, it, expect } from "vitest";
import { recomputeOrderTotals } from "@/lib/order-totals";

describe("recomputeOrderTotals — arrondi Sage (facture FA10005485)", () => {
  it("commande 4EKJ7LYW après rupture : 212.20 -10% → 190.98 HT / 38.20 TVA / 229.18 TTC", () => {
    // Reproduction exacte de la facture Sage 50 FA10005485 (2026-09-01).
    // Ancien floorMoney donnait 38.19 / 229.17 → écart 1 ct.
    const res = recomputeOrderTotals({
      items: [
        { lineTotal: 45.0 },
        { lineTotal: 26.0 },
        { lineTotal: 33.0 },
        { lineTotal: 36.0 },
        { lineTotal: 25.2 },
        { lineTotal: 3.0 },
        { lineTotal: 28.0 },
        { lineTotal: 16.0 },
      ],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "PERCENT",
      clientDiscountValue: 10,
    });

    expect(res.preDiscountSubtotal).toBe(212.2);
    expect(res.clientDiscountAmt).toBe(21.22);
    expect(res.subtotalHT).toBe(190.98);
    expect(res.tvaAmount).toBe(38.2);
    expect(res.totalTTC).toBe(229.18);
  });

  it("commande initiale 4EKJ7LYW (avant rupture) : 225.20 -10% → 202.68 HT / 40.54 TVA / 243.22 TTC", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 225.2 }],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "PERCENT",
      clientDiscountValue: 10,
    });

    expect(res.clientDiscountAmt).toBe(22.52);
    expect(res.subtotalHT).toBe(202.68);
    expect(res.tvaAmount).toBe(40.54);
    expect(res.totalTTC).toBe(243.22);
  });
});

describe("recomputeOrderTotals — sans remise client", () => {
  it("somme simple HT + TVA (sur articles + port) + transport", () => {
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
    expect(res.tvaAmount).toBe(32); // (150 + 10) × 20%
    expect(res.totalTTC).toBe(192); // 150 + 10 + 32
  });

  it("cas historique cmr6p6o4n00dqm34qdukqvuog : 188.98 + port 6.04 → TTC 234.02", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 188.98 }],
      tvaRate: 0.2,
      carrierPrice: 6.04,
      clientDiscountType: null,
      clientDiscountValue: null,
    });

    // (188.98 + 6.04) × 20 % = 39.004 → arrondi 39.00
    // TTC = 195.02 + 39.00 = 234.02
    expect(res.tvaAmount).toBe(39);
    expect(res.totalTTC).toBe(234.02);
  });
});

describe("recomputeOrderTotals — remise PERCENT", () => {
  it("AUDIT [4] : remise de 10% réappliquée après retrait d'un article", () => {
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
    expect(res.tvaAmount).toBe(144);
    expect(res.totalTTC).toBe(864);
  });

  it("258.50 avec −5 % : remise 12.93 / net 245.57 / TTC 294.68", () => {
    // Round half up : 258.50 × 5% = 12.925 → 12.93 (contre 12.92 avec l'ancien floor).
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 258.5 }],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "PERCENT",
      clientDiscountValue: 5,
    });

    expect(res.clientDiscountAmt).toBe(12.93);
    expect(res.subtotalHT).toBe(245.57);
    expect(res.tvaAmount).toBe(49.11);
    expect(res.totalTTC).toBe(294.68);
  });

  it("remise de 100% = HT articles à 0, mais TVA sur port restante", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 100 }],
      tvaRate: 0.2,
      carrierPrice: 5,
      clientDiscountType: "PERCENT",
      clientDiscountValue: 100,
    });

    expect(res.clientDiscountAmt).toBe(100);
    expect(res.subtotalHT).toBe(0);
    expect(res.tvaAmount).toBe(1);
    expect(res.totalTTC).toBe(6);
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
    expect(res.tvaAmount).toBe(30);
    expect(res.totalTTC).toBe(180);
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
    expect(res.tvaAmount).toBe(26); // (120 + 10) × 20%
    expect(res.totalTTC).toBe(156);
  });
});

describe("recomputeOrderTotals — articles ajoutés (compensation) hors base remise", () => {
  it("AMOUNT : remise ne s'applique QUE sur les lignes d'origine, pas sur les ajouts admin", () => {
    const res = recomputeOrderTotals({
      items: [
        { lineTotal: 50, isCompensation: false },
        { lineTotal: 20, isCompensation: true },
      ],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "AMOUNT",
      clientDiscountValue: 30,
    });

    expect(res.clientDiscountAmt).toBe(30);
    expect(res.subtotalHT).toBe(40);
    expect(res.totalTTC).toBe(48);
  });

  it("PERCENT : remise ne s'applique QUE sur les lignes d'origine", () => {
    const res = recomputeOrderTotals({
      items: [
        { lineTotal: 100, isCompensation: false },
        { lineTotal: 20, isCompensation: true },
      ],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "PERCENT",
      clientDiscountValue: 10,
    });

    expect(res.clientDiscountAmt).toBe(10);
    expect(res.subtotalHT).toBe(110);
  });

  it("remise AMOUNT plafonnée à la base remisable (pas au total avec ajouts)", () => {
    const res = recomputeOrderTotals({
      items: [
        { lineTotal: 10, isCompensation: false },
        { lineTotal: 100, isCompensation: true },
      ],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "AMOUNT",
      clientDiscountValue: 50,
    });

    expect(res.clientDiscountAmt).toBe(10);
    expect(res.subtotalHT).toBe(100);
  });

  it("rétrocompat : items sans isCompensation traités comme lignes d'origine", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 100 }, { lineTotal: 50 }],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "PERCENT",
      clientDiscountValue: 10,
    });

    expect(res.clientDiscountAmt).toBe(15);
    expect(res.subtotalHT).toBe(135);
  });
});

describe("recomputeOrderTotals — edge cases", () => {
  it("panier vide → tout à 0 sauf transport (avec TVA sur port)", () => {
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
    expect(res.tvaAmount).toBe(2); // 10 × 20%
    expect(res.totalTTC).toBe(12);
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

describe("recomputeOrderTotals — TVA sur frais de port (art. 267 CGI)", () => {
  it("France 20% : TVA sur articles ET port", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 200 }],
      tvaRate: 0.2,
      carrierPrice: 15,
      clientDiscountType: null,
      clientDiscountValue: null,
    });

    expect(res.tvaAmount).toBe(43);
    expect(res.totalTTC).toBe(258);
  });

  it("hors UE (tvaRate=0) : pas de TVA sur port non plus", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 200 }],
      tvaRate: 0,
      carrierPrice: 15,
      clientDiscountType: null,
      clientDiscountValue: null,
    });

    expect(res.tvaAmount).toBe(0);
    expect(res.totalTTC).toBe(215);
  });

  it("B2B intracom exonéré (tvaRate=0) : pas de TVA sur port non plus", () => {
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 500 }],
      tvaRate: 0,
      carrierPrice: 20,
      clientDiscountType: null,
      clientDiscountValue: null,
    });

    expect(res.tvaAmount).toBe(0);
    expect(res.totalTTC).toBe(520);
  });
});
