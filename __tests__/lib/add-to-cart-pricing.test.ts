import { describe, it, expect } from "vitest";
import {
  pricePerUnit,
  applyDiscount,
  effectiveStock,
  computeCartSummary,
  type CartVariant,
} from "@/lib/add-to-cart-pricing";

const unit = (over: Partial<CartVariant> = {}): CartVariant => ({
  id: "u1",
  saleType: "UNIT",
  packQuantity: null,
  unitPrice: 4.2,
  stock: 100,
  ...over,
});

const pack = (over: Partial<CartVariant> = {}): CartVariant => ({
  id: "p1",
  saleType: "PACK",
  packQuantity: 12,
  unitPrice: 42, // total pack de 12 = 42 € → 3,50 €/unité
  stock: 60,
  ...over,
});

describe("pricePerUnit", () => {
  it("renvoie le prix direct pour une variante UNIT", () => {
    expect(pricePerUnit(unit({ unitPrice: 4.2 }))).toBe(4.2);
  });

  it("divise total ÷ quantité pour une variante PACK", () => {
    expect(pricePerUnit(pack({ unitPrice: 42, packQuantity: 12 }))).toBeCloseTo(3.5, 4);
  });

  it("retombe sur le prix direct si packQuantity est 0 ou null", () => {
    expect(pricePerUnit(pack({ packQuantity: 0 }))).toBe(42);
    expect(pricePerUnit(pack({ packQuantity: null }))).toBe(42);
  });
});

describe("applyDiscount", () => {
  it("laisse le prix intact si aucune remise produit", () => {
    expect(applyDiscount(10)).toBe(10);
    expect(applyDiscount(10, 0)).toBe(10);
    expect(applyDiscount(10, null, null)).toBe(10);
  });

  it("applique la remise produit en pourcentage", () => {
    expect(applyDiscount(10, 20)).toBeCloseTo(8, 4);
  });

  it("ignore la remise commerciale client (appliquée au total panier uniquement)", () => {
    // Nouvelle règle métier : clientDiscount ne modifie plus le prix ligne.
    expect(applyDiscount(10, 20, { discountType: "PERCENT", discountValue: 10 })).toBeCloseTo(8, 4);
    expect(applyDiscount(10, 20, { discountType: "AMOUNT", discountValue: 1 })).toBeCloseTo(8, 4);
    expect(applyDiscount(10, 0, { discountType: "PERCENT", discountValue: 50 })).toBe(10);
  });

  it("ne descend jamais sous 0 même avec une remise produit > 100 %", () => {
    expect(applyDiscount(5, 200)).toBe(0);
  });
});

describe("effectiveStock", () => {
  it("renvoie le stock brut pour une variante UNIT", () => {
    expect(effectiveStock(unit({ stock: 7 }))).toBe(7);
  });

  it("divise le stock par la quantité du pack pour une variante PACK (arrondi bas)", () => {
    // 60 unités disponibles / paquet de 12 = 5 paquets vendables
    expect(effectiveStock(pack({ stock: 60, packQuantity: 12 }))).toBe(5);
    // 61 unités → toujours 5 paquets (pas 5,08)
    expect(effectiveStock(pack({ stock: 61, packQuantity: 12 }))).toBe(5);
  });

  it("renvoie le stock brut si packQuantity est 0", () => {
    expect(effectiveStock(pack({ stock: 60, packQuantity: 0 }))).toBe(60);
  });
});

describe("computeCartSummary", () => {
  const u = unit({ id: "u1", unitPrice: 4.2, stock: 100 });
  const p = pack({ id: "p1", unitPrice: 42, packQuantity: 12, stock: 60 });

  it("est vide quand aucune quantité n'est renseignée", () => {
    const res = computeCartSummary([{ variants: [u, p] }], {});
    expect(res).toEqual({ totalItems: 0, totalPacks: 0, totalPrice: 0 });
  });

  it("ignore les variantes avec quantité 0 ou négative", () => {
    const res = computeCartSummary([{ variants: [u, p] }], { u1: 0, p1: -3 });
    expect(res).toEqual({ totalItems: 0, totalPacks: 0, totalPrice: 0 });
  });

  it("additionne UNIT × prix pour une variante à l'unité", () => {
    // 3 unités × 4,20 € = 12,60 €
    const res = computeCartSummary([{ variants: [u] }], { u1: 3 });
    expect(res.totalItems).toBe(3);
    expect(res.totalPacks).toBe(0);
    expect(res.totalPrice).toBeCloseTo(12.6, 4);
  });

  it("multiplie PACK × contenu du pack pour un paquet (pas juste × prix unitaire)", () => {
    // 2 paquets × 12 unités × 3,50 €/unité = 84 €
    const res = computeCartSummary([{ variants: [p] }], { p1: 2 });
    expect(res.totalItems).toBe(2);
    expect(res.totalPacks).toBe(2);
    expect(res.totalPrice).toBeCloseTo(84, 4);
  });

  it("mélange UNIT et PACK sur la même couleur", () => {
    // 1 unité (4,20) + 1 paquet de 12 (42) = 46,20 €
    const res = computeCartSummary([{ variants: [u, p] }], { u1: 1, p1: 1 });
    expect(res.totalItems).toBe(2);
    expect(res.totalPacks).toBe(1);
    expect(res.totalPrice).toBeCloseTo(46.2, 4);
  });

  it("cumule plusieurs couleurs", () => {
    const u2 = unit({ id: "u2", unitPrice: 5 });
    const res = computeCartSummary(
      [{ variants: [u] }, { variants: [u2] }],
      { u1: 1, u2: 2 },
    );
    expect(res.totalItems).toBe(3);
    expect(res.totalPrice).toBeCloseTo(4.2 + 5 * 2, 4);
  });

  it("applique uniquement la remise produit ; la remise client est ignorée par ligne", () => {
    // 1 paquet à 42 € - 20% = 33,60 € (remise client -10% ignorée ici)
    const res = computeCartSummary(
      [{ variants: [p] }],
      { p1: 1 },
      20,
      { discountType: "PERCENT", discountValue: 10 },
    );
    expect(res.totalPrice).toBeCloseTo(33.6, 4);
  });

  it("ne compte comme paquets que les PACK, pas les UNIT (même quand qty>0)", () => {
    const res = computeCartSummary([{ variants: [u, p] }], { u1: 5, p1: 2 });
    expect(res.totalItems).toBe(7);
    expect(res.totalPacks).toBe(2);
  });
});
