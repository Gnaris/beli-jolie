import { describe, it, expect } from "vitest";
import { shapeProducts } from "@/lib/product-shape";

// Fabrique un produit Prisma-like minimal pour tester la reshape.
function makeProduct(overrides: Partial<{
  id: string;
  name: string;
  primaryColorId: string | null;
  colors: Array<{
    id: string;
    colorId: string;
    unitPrice: number;
    stock: number;
    isPrimary?: boolean;
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    color: { name: string; hex: string | null; patternImage: string | null };
    variantSizes: Array<{ size: { name: string }; quantity: number }>;
  }>;
}> = {}) {
  return {
    id: overrides.id ?? "p1",
    name: overrides.name ?? "Bague test",
    reference: "REF1",
    category: { name: "Bague" },
    subCategories: [],
    tags: [],
    primaryColorId: overrides.primaryColorId ?? null,
    colors: overrides.colors ?? [],
  };
}

describe("shapeProducts", () => {
  it("marque isPrimary sur la couleur pointée par primaryColorId", () => {
    const raw = makeProduct({
      primaryColorId: "colorB",
      colors: [
        {
          id: "pc-a", colorId: "colorA", unitPrice: 10, stock: 5,
          saleType: "UNIT", packQuantity: null,
          color: { name: "Rouge", hex: "#f00", patternImage: null },
          variantSizes: [],
        },
        {
          id: "pc-b", colorId: "colorB", unitPrice: 12, stock: 3,
          saleType: "UNIT", packQuantity: null,
          color: { name: "Bleu", hex: "#00f", patternImage: null },
          variantSizes: [],
        },
      ],
    });
    const imageMap = new Map([[
      "p1",
      new Map([["colorA", "/img/a.webp"], ["colorB", "/img/b.webp"]]),
    ]]);

    const [shaped] = shapeProducts([raw], imageMap);
    expect(shaped.colors).toHaveLength(2);
    const bleu = shaped.colors.find((c: { colorId: string }) => c.colorId === "colorB");
    const rouge = shaped.colors.find((c: { colorId: string }) => c.colorId === "colorA");
    expect(bleu?.isPrimary).toBe(true);
    expect(rouge?.isPrimary).toBe(false);
  });

  it("masque les couleurs sans image", () => {
    const raw = makeProduct({
      colors: [
        {
          id: "pc-a", colorId: "colorA", unitPrice: 10, stock: 5,
          saleType: "UNIT", packQuantity: null,
          color: { name: "Rouge", hex: "#f00", patternImage: null },
          variantSizes: [],
        },
        {
          id: "pc-b", colorId: "colorB", unitPrice: 12, stock: 3,
          saleType: "UNIT", packQuantity: null,
          color: { name: "Bleu", hex: "#00f", patternImage: null },
          variantSizes: [],
        },
      ],
    });
    // Seul colorA a une image.
    const imageMap = new Map([[
      "p1",
      new Map([["colorA", "/img/a.webp"]]),
    ]]);

    const [shaped] = shapeProducts([raw], imageMap);
    expect(shaped.colors).toHaveLength(1);
    expect(shaped.colors[0].colorId).toBe("colorA");
  });

  it("regroupe les variantes UNIT et PACK sous la même couleur", () => {
    const raw = makeProduct({
      colors: [
        {
          id: "pc-unit", colorId: "colorA", unitPrice: 10, stock: 8,
          saleType: "UNIT", packQuantity: null,
          color: { name: "Rouge", hex: "#f00", patternImage: null },
          variantSizes: [{ size: { name: "TU" }, quantity: 1 }],
        },
        {
          id: "pc-pack", colorId: "colorA", unitPrice: 96, stock: 24,
          saleType: "PACK", packQuantity: 12,
          color: { name: "Rouge", hex: "#f00", patternImage: null },
          variantSizes: [],
        },
      ],
    });
    const imageMap = new Map([[
      "p1",
      new Map([["colorA", "/img/a.webp"]]),
    ]]);

    const [shaped] = shapeProducts([raw], imageMap);
    expect(shaped.colors).toHaveLength(1);
    expect(shaped.colors[0].variants).toHaveLength(2);
    expect(shaped.colors[0].totalStock).toBe(32);
    // unitPrice groupe = min des variantes
    expect(shaped.colors[0].unitPrice).toBe(10);
  });

  it("catalogue : primaryColorId overridé par selectedColorId → la bonne couleur devient primaire", () => {
    // Cas d'usage catalogue : le catalog.products a selectedColorId=colorC.
    // La page catalogue surcharge product.primaryColorId=selectedColorId avant
    // d'appeler shapeProducts → shapeProducts doit marquer colorC isPrimary.
    const raw = makeProduct({
      primaryColorId: "colorC",
      colors: [
        {
          id: "pc-a", colorId: "colorA", unitPrice: 10, stock: 5,
          saleType: "UNIT", packQuantity: null,
          color: { name: "Rouge", hex: "#f00", patternImage: null },
          variantSizes: [],
        },
        {
          id: "pc-c", colorId: "colorC", unitPrice: 14, stock: 2,
          saleType: "UNIT", packQuantity: null,
          color: { name: "Vert", hex: "#0f0", patternImage: null },
          variantSizes: [],
        },
      ],
    });
    const imageMap = new Map([[
      "p1",
      new Map([["colorA", "/img/a.webp"], ["colorC", "/img/c.webp"]]),
    ]]);

    const [shaped] = shapeProducts([raw], imageMap);
    const vert = shaped.colors.find((c: { colorId: string }) => c.colorId === "colorC");
    expect(vert?.isPrimary).toBe(true);
  });
});
