import { describe, it, expect } from "vitest";

// Réplique la logique d'affichage du prix sur les cards :
// - components/produits/ProductCard.tsx (utilisé sur /produits et /favoris)
// - components/home/ProductCarousel.tsx (utilisé sur la home)
//
// Règles :
// - `unitPrice` en BDD est le PRIX TOTAL du pack pour les variantes PACK
//   (cf. ProductForm.tsx → `unitPrice: computeTotalPrice(v)` pour les PACK).
// - Sur la card on doit afficher le prix TOTAL du pack en gros + le prix par
//   unité en sous-texte, pour clarifier ce que paie le client.

type Variant = {
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  unitPrice: number;
};

function variantPricePerUnit(v: Variant): number {
  const p = Number(v.unitPrice);
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) return p / v.packQuantity;
  return p;
}

function computeHeadline(v: Variant, productDiscountPercent: number | null = null) {
  const unit = variantPricePerUnit(v);
  const unitAfterDiscount = productDiscountPercent && productDiscountPercent > 0
    ? Math.max(0, unit * (1 - productDiscountPercent / 100))
    : unit;
  const isPack = v.saleType === "PACK" && !!v.packQuantity && v.packQuantity > 0;
  const packQty = v.packQuantity ?? 1;
  const headlinePrice = isPack ? unitAfterDiscount * packQty : unitAfterDiscount;
  return {
    isPack,
    packQty,
    unitDisplay: unitAfterDiscount,
    headlinePrice,
  };
}

describe("Card produit — prix total pack affiché en headline", () => {
  it("UNIT 7.50 € → headline = 7.50 € (per-unit, pas de note pack)", () => {
    const v: Variant = { saleType: "UNIT", packQuantity: null, unitPrice: 7.5 };
    const r = computeHeadline(v);
    expect(r.isPack).toBe(false);
    expect(r.headlinePrice).toBeCloseTo(7.5, 2);
    expect(r.unitDisplay).toBeCloseTo(7.5, 2);
  });

  it("PACK x12 à 87.60 € (le pack) → headline = 87.60 €, sous-texte = 7.30 €/unité", () => {
    const v: Variant = { saleType: "PACK", packQuantity: 12, unitPrice: 87.6 };
    const r = computeHeadline(v);
    expect(r.isPack).toBe(true);
    expect(r.packQty).toBe(12);
    expect(r.headlinePrice).toBeCloseTo(87.6, 2);
    expect(r.unitDisplay).toBeCloseTo(7.3, 2);
  });

  it("PACK x6 à 30 € avec remise produit 10 % → headline = 27 €, unité = 4.50 €", () => {
    const v: Variant = { saleType: "PACK", packQuantity: 6, unitPrice: 30 };
    const r = computeHeadline(v, 10);
    expect(r.isPack).toBe(true);
    expect(r.headlinePrice).toBeCloseTo(27, 2);
    expect(r.unitDisplay).toBeCloseTo(4.5, 2);
  });

  it("PACK x4 à 100 € sans remise → 100 € total, 25 €/unité", () => {
    const v: Variant = { saleType: "PACK", packQuantity: 4, unitPrice: 100 };
    const r = computeHeadline(v);
    expect(r.headlinePrice).toBeCloseTo(100, 2);
    expect(r.unitDisplay).toBeCloseTo(25, 2);
  });

  it("PACK sans packQuantity (cas dégradé) → pas considéré comme pack, pas de multiplication", () => {
    const v: Variant = { saleType: "PACK", packQuantity: null, unitPrice: 50 };
    const r = computeHeadline(v);
    expect(r.isPack).toBe(false);
    expect(r.headlinePrice).toBeCloseTo(50, 2);
  });

  it("PACK avec packQuantity = 0 (cas dégradé) → pas considéré comme pack", () => {
    const v: Variant = { saleType: "PACK", packQuantity: 0, unitPrice: 50 };
    const r = computeHeadline(v);
    expect(r.isPack).toBe(false);
    expect(r.headlinePrice).toBeCloseTo(50, 2);
  });

  it("UNIT avec remise 25 % → headline = unit après remise", () => {
    const v: Variant = { saleType: "UNIT", packQuantity: null, unitPrice: 20 };
    const r = computeHeadline(v, 25);
    expect(r.isPack).toBe(false);
    expect(r.headlinePrice).toBeCloseTo(15, 2);
  });
});
