import { describe, it, expect } from "vitest";
import {
  validateFaireProductShape,
  type FaireShapeProductInput,
} from "@/lib/faire-shape";

function base(overrides: Partial<FaireShapeProductInput> = {}): FaireShapeProductInput {
  return {
    name: "Bracelet test",
    description: "Description longue",
    taxonomyTypeId: "tt_czw8pmzjrc",
    wholesalePriceCents: 750,
    retailPriceCents: 1500,
    countryAlpha3: "CHN",
    materials: ["Stainless Steel"],
    hsCode: "7117.19.00",
    productImagesCount: 0,
    variants: [
      {
        sku: "BJ001_OR_UNIT_aaaaaaaa",
        wholesalePriceCents: 750,
        retailPriceCents: 1500,
        imagesCount: 2,
      },
    ],
    ...overrides,
  };
}

describe("validateFaireProductShape", () => {
  it("accepte un produit complet et bien formé", () => {
    const r = validateFaireProductShape(base());
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejette quand le nom est vide", () => {
    const r = validateFaireProductShape(base({ name: "  " }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes("nom"))).toBe(true);
  });

  it("rejette quand taxonomyTypeId est manquant ou invalide", () => {
    expect(validateFaireProductShape(base({ taxonomyTypeId: null })).ok).toBe(false);
    expect(validateFaireProductShape(base({ taxonomyTypeId: "wrong_format" })).ok).toBe(false);
    expect(validateFaireProductShape(base({ taxonomyTypeId: "tt_abc123" })).ok).toBe(true);
  });

  it("rejette quand retail < 2× wholesale au niveau produit", () => {
    const r = validateFaireProductShape(
      base({ wholesalePriceCents: 1000, retailPriceCents: 1500 }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("2×"))).toBe(true);
  });

  it("rejette quand retail < 2× wholesale au niveau d'une variante", () => {
    const r = validateFaireProductShape(
      base({
        variants: [
          {
            sku: "v1",
            wholesalePriceCents: 1000,
            retailPriceCents: 1500,
            imagesCount: 1,
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("v1"))).toBe(true);
  });

  it("rejette les SKUs dupliqués", () => {
    const r = validateFaireProductShape(
      base({
        variants: [
          { sku: "DUP", wholesalePriceCents: 750, retailPriceCents: 1500, imagesCount: 1 },
          { sku: "DUP", wholesalePriceCents: 750, retailPriceCents: 1500, imagesCount: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("dupliqué"))).toBe(true);
  });

  it("rejette quand aucune image n'est fournie (ni produit ni variantes)", () => {
    const r = validateFaireProductShape(
      base({
        productImagesCount: 0,
        variants: [
          {
            sku: "v1",
            wholesalePriceCents: 750,
            retailPriceCents: 1500,
            imagesCount: 0,
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes("image"))).toBe(true);
  });

  it("rejette quand aucune variante n'est fournie", () => {
    const r = validateFaireProductShape(base({ variants: [] }));
    expect(r.ok).toBe(false);
  });

  it("émet des avertissements (pas erreurs) quand description / pays / matériaux manquent", () => {
    const r = validateFaireProductShape(
      base({
        description: "",
        countryAlpha3: null,
        materials: [],
        hsCode: null,
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThanOrEqual(4);
  });
});
