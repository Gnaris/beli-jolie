import { describe, it, expect } from "vitest";
import {
  validateOrderchampProductShape,
  type OrderchampShapeProductInput,
} from "@/lib/orderchamp-shape";

function base(overrides: Partial<OrderchampShapeProductInput> = {}): OrderchampShapeProductInput {
  return {
    title: "Bracelet Or",
    description: "Base desc",
    categoryId: "cc-1",
    wholesalePriceCents: 450,
    retailPriceCents: 1350,
    countryAlpha2: "CN",
    weightGrams: 25,
    lengthCm: 6.5,
    widthCm: 6.5,
    heightCm: 0.3,
    diameterCm: 6.5,
    productImagesCount: 1,
    variants: [
      {
        sku: "sku-1",
        wholesalePriceCents: 450,
        retailPriceCents: 1350,
        imagesCount: 0,
        colorOption: "Or",
        sizeOption: "TU",
        weightGrams: 25,
      },
    ],
    ...overrides,
  };
}

describe("orderchamp-shape validate", () => {
  it("valide un produit complet", () => {
    const res = validateOrderchampProductShape(base());
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("rejette title vide", () => {
    const res = validateOrderchampProductShape(base({ title: "" }));
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("nom"))).toBe(true);
  });

  it("rejette wholesale <= 0", () => {
    const res = validateOrderchampProductShape(base({ wholesalePriceCents: 0 }));
    expect(res.ok).toBe(false);
  });

  it("rejette retail < wholesale", () => {
    const res = validateOrderchampProductShape(base({ retailPriceCents: 100 }));
    expect(res.ok).toBe(false);
  });

  it("rejette variante sans couleur", () => {
    const v = base().variants[0];
    const res = validateOrderchampProductShape(
      base({ variants: [{ ...v, colorOption: "" }] }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.toLowerCase().includes("couleur"))).toBe(true);
  });

  it("rejette SKU dupliqués", () => {
    const v = base().variants[0];
    const res = validateOrderchampProductShape(
      base({ variants: [v, { ...v, colorOption: "Argent" }] }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.toLowerCase().includes("dupliqué"))).toBe(true);
  });

  it("rejette aucune image", () => {
    const v = base().variants[0];
    const res = validateOrderchampProductShape(
      base({ productImagesCount: 0, variants: [{ ...v, imagesCount: 0 }] }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.toLowerCase().includes("image"))).toBe(true);
  });

  it("warnings sans erreurs pour catégorie manquante", () => {
    const res = validateOrderchampProductShape(base({ categoryId: null }));
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => w.includes("Catégorie"))).toBe(true);
  });

  it("warnings pour pays et dimensions manquants", () => {
    const res = validateOrderchampProductShape(
      base({
        countryAlpha2: null,
        weightGrams: 0,
        lengthCm: 0,
        widthCm: 0,
        heightCm: 0,
        diameterCm: 0,
      }),
    );
    expect(res.ok).toBe(true);
    expect(res.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it("accepte sizeOption vide (fallback fait par le caller)", () => {
    const v = base().variants[0];
    const res = validateOrderchampProductShape(
      base({ variants: [{ ...v, sizeOption: null }] }),
    );
    expect(res.ok).toBe(true);
  });
});
