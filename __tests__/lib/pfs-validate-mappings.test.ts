import { describe, it, expect } from "vitest";
import { validatePfsMappings, type FullProduct } from "@/lib/pfs-reverse-sync";

/** Helper to build a minimal valid FullProduct for testing */
function makeProduct(overrides?: Partial<FullProduct>): FullProduct {
  return {
    id: "prod-1",
    reference: "REF001",
    pfsProductId: "pfs-1",
    name: "Test Product",
    description: "desc",
    status: "ONLINE",
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    category: { name: "Bijoux", pfsCategoryId: "PFS_CAT", pfsGender: null, pfsFamilyId: null },
    colors: [],
    compositions: [],
    manufacturingCountry: null,
    season: null,
    ...overrides,
  };
}

function makeVariant(overrides?: Partial<FullProduct["colors"][number]>): FullProduct["colors"][number] {
  return {
    id: "var-1",
    pfsColorRef: null,
    pfsVariantId: null,
    unitPrice: 10,
    weight: 0.5,
    stock: 5,
    isPrimary: true,
    saleType: "UNIT",
    packQuantity: null,
    variantSizes: [],
    discountType: null,
    discountValue: null,
    color: { id: "col-1", name: "Rouge", pfsColorRef: "RED" },
    subColors: [],
    packColorLines: [],
    images: [],
    ...overrides,
  };
}

describe("validatePfsMappings", () => {
  it("passes for a single-color UNIT variant with mapped color", () => {
    const product = makeProduct({
      colors: [makeVariant()],
    });
    expect(() => validatePfsMappings(product)).not.toThrow();
  });

  it("throws for unmapped category", () => {
    const product = makeProduct({
      category: { name: "Bijoux", pfsCategoryId: null, pfsGender: null, pfsFamilyId: null },
    });
    expect(() => validatePfsMappings(product)).toThrow(/Catégorie.*sans correspondance/);
  });

  it("throws for unmapped single color", () => {
    const product = makeProduct({
      colors: [makeVariant({ color: { id: "col-1", name: "Rouge", pfsColorRef: null } })],
    });
    expect(() => validatePfsMappings(product)).toThrow(/Couleur.*Rouge.*sans correspondance/);
  });

  it("throws for multi-color UNIT variant without override", () => {
    const product = makeProduct({
      colors: [
        makeVariant({
          pfsColorRef: null,
          subColors: [
            { color: { id: "col-2", name: "Noir", pfsColorRef: "BLACK" }, position: 0 },
          ],
        }),
      ],
    });
    expect(() => validatePfsMappings(product)).toThrow(/Variante multi-couleur.*sans correspondance Paris Fashion Shop/);
  });

  it("passes for multi-color UNIT variant with override", () => {
    const product = makeProduct({
      colors: [
        makeVariant({
          pfsColorRef: "RED_BLACK",
          subColors: [
            { color: { id: "col-2", name: "Noir", pfsColorRef: "BLACK" }, position: 0 },
          ],
        }),
      ],
    });
    expect(() => validatePfsMappings(product)).not.toThrow();
  });

  it("throws for PACK variant with color lines but no override", () => {
    const product = makeProduct({
      colors: [
        makeVariant({
          saleType: "PACK",
          color: { id: "col-1", name: "Multi", pfsColorRef: null },
          pfsColorRef: null,
          subColors: [],
          packColorLines: [
            {
              position: 0,
              colors: [
                { color: { id: "col-2", name: "Bleu", pfsColorRef: "BLUE" }, position: 0 },
                { color: { id: "col-3", name: "Vert", pfsColorRef: "GREEN" }, position: 1 },
              ],
            },
          ],
        }),
      ],
    });
    expect(() => validatePfsMappings(product)).toThrow(/Variante multi-couleur.*sans correspondance Paris Fashion Shop/);
  });

  it("passes for PACK variant with color lines and override", () => {
    const product = makeProduct({
      colors: [
        makeVariant({
          saleType: "PACK",
          pfsColorRef: "BLUE_GREEN",
          subColors: [],
          packColorLines: [
            {
              position: 0,
              colors: [
                { color: { id: "col-2", name: "Bleu", pfsColorRef: "BLUE" }, position: 0 },
                { color: { id: "col-3", name: "Vert", pfsColorRef: "GREEN" }, position: 1 },
              ],
            },
          ],
        }),
      ],
    });
    expect(() => validatePfsMappings(product)).not.toThrow();
  });

  it("passes for PACK variant with single-color lines (no override needed)", () => {
    // e.g. product A9988: PACK with one "Doré" color line — not truly multi-color
    const product = makeProduct({
      colors: [
        makeVariant({
          saleType: "PACK",
          color: null,
          pfsColorRef: null,
          subColors: [],
          packColorLines: [
            {
              position: 0,
              colors: [
                { color: { id: "col-gold", name: "Doré", pfsColorRef: "GOLDEN" }, position: 0 },
              ],
            },
          ],
        }),
      ],
    });
    expect(() => validatePfsMappings(product)).not.toThrow();
  });

  it("throws for unmapped composition", () => {
    const product = makeProduct({
      compositions: [
        { percentage: 100, composition: { name: "Coton", pfsCompositionRef: null } },
      ],
    });
    expect(() => validatePfsMappings(product)).toThrow(/Composition.*Coton.*sans correspondance/);
  });

  it("throws for unmapped size", () => {
    const product = makeProduct({
      colors: [
        makeVariant({
          variantSizes: [{ size: { name: "M", pfsMappings: [] }, quantity: 1 }],
        }),
      ],
    });
    expect(() => validatePfsMappings(product)).toThrow(/Taille.*M.*sans correspondance/);
  });
});
