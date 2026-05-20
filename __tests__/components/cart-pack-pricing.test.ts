import { describe, it, expect } from "vitest";

// Réplique la logique exacte utilisée dans :
// - components/panier/CartPageClient.tsx (computeUnitPrice)
// - components/panier/CheckoutClient.tsx (computeUnitPrice)
// - app/api/payments/create-intent/route.ts (computeUnitPrice)
// - app/actions/client/order.ts (computeUnitPrice)
// Pour rappel : `unitPrice` en BDD est le PRIX TOTAL pour UNIT comme pour PACK
// (cf. ProductForm.tsx:1322 → `unitPrice: computeTotalPrice(v)` pour les PACK).
function computeCartUnitPrice(v: {
  unitPrice: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  product: { discountPercent?: number | null };
}): number {
  const base = Number(v.unitPrice);
  const dp = v.product.discountPercent != null ? Number(v.product.discountPercent) : null;
  if (!dp || dp <= 0) return base;
  return Math.max(0, base * (1 - dp / 100));
}

// Réplique la logique des cards (ProductCard, ProductCarousel, CatalogProductCard)
// après le fix : prix affiché PAR UNITÉ.
function variantPricePerUnit(v: { unitPrice: number; saleType: "UNIT" | "PACK"; packQuantity: number | null }): number {
  const p = Number(v.unitPrice);
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) return p / v.packQuantity;
  return p;
}

describe("Panier — calcul du total de ligne pour une variante PACK", () => {
  it("SAUTOIR01 (pack x12, 87.60€ le pack) → 87.60€ et non 1051.20€", () => {
    const v = {
      unitPrice: 87.6,
      saleType: "PACK" as const,
      packQuantity: 12,
      product: { discountPercent: null },
    };
    expect(computeCartUnitPrice(v)).toBeCloseTo(87.6, 2);
    expect(computeCartUnitPrice(v) * 1).toBeCloseTo(87.6, 2);
    expect(computeCartUnitPrice(v) * 1).not.toBeCloseTo(1051.2, 2);
  });

  it("UNIT (7.50€ l'unité) → 7.50€ × qty", () => {
    const v = {
      unitPrice: 7.5,
      saleType: "UNIT" as const,
      packQuantity: null,
      product: { discountPercent: null },
    };
    expect(computeCartUnitPrice(v) * 3).toBeCloseTo(22.5, 2);
  });

  it("PACK avec remise produit 10% → total pack × 0.9", () => {
    const v = {
      unitPrice: 87.6,
      saleType: "PACK" as const,
      packQuantity: 12,
      product: { discountPercent: 10 },
    };
    expect(computeCartUnitPrice(v)).toBeCloseTo(78.84, 2);
  });
});

describe("Card produit — prix affiché par unité (UNIT vs PACK)", () => {
  it("UNIT (7.50€) → affiche 7.50€", () => {
    const v = { unitPrice: 7.5, saleType: "UNIT" as const, packQuantity: null };
    expect(variantPricePerUnit(v)).toBeCloseTo(7.5, 2);
  });

  it("PACK x12 (87.60€ le pack) → affiche 7.30€ par unité", () => {
    const v = { unitPrice: 87.6, saleType: "PACK" as const, packQuantity: 12 };
    expect(variantPricePerUnit(v)).toBeCloseTo(7.3, 2);
  });

  it("PACK sans packQuantity (cas dégradé) → retombe sur le prix brut", () => {
    const v = { unitPrice: 50, saleType: "PACK" as const, packQuantity: null };
    expect(variantPricePerUnit(v)).toBe(50);
  });
});
