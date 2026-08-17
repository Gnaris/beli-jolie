import { describe, it, expect } from "vitest";
import { recomputeOrderTotals, floorMoney } from "@/lib/order-totals";

describe("floorMoney — arrondi vers le bas au centime", () => {
  it("arrondit vers le bas (jamais vers le haut)", () => {
    expect(floorMoney(234.024)).toBe(234.02);
    expect(floorMoney(234.029)).toBe(234.02);
    expect(floorMoney(234.02)).toBe(234.02);
    expect(floorMoney(234.03)).toBe(234.03);
  });

  it("gère les valeurs entières et 0", () => {
    expect(floorMoney(0)).toBe(0);
    expect(floorMoney(100)).toBe(100);
  });
});

describe("recomputeOrderTotals — arrondi vers le bas (aligné facturation)", () => {
  it("commande 188.98 HT + port 6.04 + TVA 20% → total 234.02 (pas 234.03)", () => {
    // Cas réel : commande cmr6p6o4n00dqm34qdukqvuog.
    // (188.98 + 6.04) × 1.20 = 234.024 → doit s'arrondir vers le bas à 234.02
    // pour matcher le logiciel de facturation externe.
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 188.98 }],
      tvaRate: 0.2,
      carrierPrice: 6.04,
      clientDiscountType: null,
      clientDiscountValue: null,
    });
    expect(res.totalTTC).toBe(234.02);
    expect(res.tvaAmount).toBe(39.00);
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
    // TVA sur (150 articles + 10 port) × 20% = 32
    expect(res.tvaAmount).toBeCloseTo(32, 5);
    expect(res.totalTTC).toBeCloseTo(192, 5);
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
    // TVA sur les frais de port seulement : 5 × 20% = 1
    expect(res.tvaAmount).toBeCloseTo(1, 5);
    expect(res.totalTTC).toBeCloseTo(6, 5); // port HT + TVA sur port
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
    // TVA sur (120 + 10 port) × 20% = 26
    expect(res.tvaAmount).toBeCloseTo(26, 5);
    expect(res.totalTTC).toBeCloseTo(156, 5);
  });
});

describe("recomputeOrderTotals — articles ajoutés (compensation) hors base remise", () => {
  it("AMOUNT : remise ne s'applique QUE sur les lignes d'origine, pas sur les ajouts admin", () => {
    // Cas Delphine Quinchon 2026-08-17 :
    // - Client avait une remise fixe (ex. −30 €)
    // - Admin retire des articles pour rupture, puis ajoute d'autres à un prix déjà remisé
    // - Bug avant fix : la remise se ré-appliquait sur les ajouts → double remise → total qui s'effondre
    const res = recomputeOrderTotals({
      items: [
        { lineTotal: 50, isCompensation: false }, // article d'origine
        { lineTotal: 20, isCompensation: true },  // ajout admin (prix saisi déjà remisé)
      ],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "AMOUNT",
      clientDiscountValue: 30,
    });

    // La remise 30€ ne mord QUE sur les 50€ d'origine (=> 20€ HT restants)
    // Les 20€ d'ajout admin passent tels quels.
    expect(res.clientDiscountAmt).toBe(30);
    expect(res.subtotalHT).toBe(40); // 20 (origine après remise) + 20 (ajout)
    expect(res.totalTTC).toBeCloseTo(48, 5);
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

    // Remise 10% sur 100 = 10 → base d'origine passe à 90. Ajout 20 intact.
    expect(res.clientDiscountAmt).toBe(10);
    expect(res.subtotalHT).toBe(110);
  });

  it("remise AMOUNT plafonnée à la base remisable (pas au total avec ajouts)", () => {
    const res = recomputeOrderTotals({
      items: [
        { lineTotal: 10, isCompensation: false }, // très peu d'origine
        { lineTotal: 100, isCompensation: true }, // gros ajout admin
      ],
      tvaRate: 0.2,
      carrierPrice: 0,
      clientDiscountType: "AMOUNT",
      clientDiscountValue: 50,
    });

    // La remise 50€ ne peut mordre que sur les 10€ d'origine → plafond à 10€
    expect(res.clientDiscountAmt).toBe(10);
    expect(res.subtotalHT).toBe(100); // 0 (origine 100%) + 100 (ajout)
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
    // Port 10 + TVA 20% dessus = 12
    expect(res.tvaAmount).toBeCloseTo(2, 5);
    expect(res.totalTTC).toBeCloseTo(12, 5);
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

    // (200 + 15) × 20% = 43
    expect(res.tvaAmount).toBeCloseTo(43, 5);
    expect(res.totalTTC).toBeCloseTo(258, 5); // 200 + 15 + 43
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
    expect(res.totalTTC).toBeCloseTo(215, 5); // 200 + 15
  });

  it("B2B intracom exonéré (tvaRate=0) : pas de TVA sur port non plus", () => {
    // Cas d'un client belge validé exonéré par l'admin.
    const res = recomputeOrderTotals({
      items: [{ lineTotal: 500 }],
      tvaRate: 0,
      carrierPrice: 20,
      clientDiscountType: null,
      clientDiscountValue: null,
    });

    expect(res.tvaAmount).toBe(0);
    expect(res.totalTTC).toBeCloseTo(520, 5);
  });
});
