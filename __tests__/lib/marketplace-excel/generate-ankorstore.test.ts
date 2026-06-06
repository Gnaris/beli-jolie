import { describe, it, expect } from "vitest";
import {
  ankorstoreSkuForVariant,
  productToAnkorstoreRows,
} from "@/lib/marketplace-excel/generate-ankorstore";
import type {
  ExportProduct,
  ExportVariant,
  ExportContext,
} from "@/lib/marketplace-excel/types";

const noMarkup = { type: "percent" as const, value: 0, rounding: "none" as const };

function makeCtx(): ExportContext {
  return {
    shopName: "Beli & Jolie",
    publicBaseUrl: "https://beliandjolie.com",
    markups: {
      pfs: noMarkup,
      efashion: noMarkup,
      microstore: noMarkup,
      ankorstoreWholesale: noMarkup,
      ankorstoreRetail: { type: "multiplier", value: 2, rounding: "none" },
      ankorstoreVatRate: 20,
    },
  };
}

function makeVariant(over: Partial<ExportVariant> = {}): ExportVariant {
  return {
    variantId: "v1",
    saleType: "UNIT",
    colorNames: ["Doré"],
    packQuantity: null,
    sizes: [{ name: "TU", quantity: 1, pfsSizeRef: "TU" }],
    unitPrice: 5,
    weight: 0.05,
    stock: 50,
    sku: null,
    imagePaths: ["/uploads/produits/e803/e803-dore-1.webp"],
    ...over,
  };
}

function makeProduct(over: Partial<ExportProduct> = {}): ExportProduct {
  return {
    id: "p1",
    reference: "E803",
    name: "Collier",
    description: "Description longue qui dépasse 30 caractères pour Ankorstore.",
    pfsGenderCode: null,
    pfsFamilyName: null,
    pfsCategoryName: null,
    categoryName: "Colliers",
    hsCode: "711719",
    efashionCategorieId: null,
    efashionCategoryPath: null,
    seasonPfsRef: null,
    seasonEfashionCollectionId: null,
    seasonEfashionLabel: null,
    seasonName: null,
    manufacturingCountryName: "Chine",
    manufacturingCountryIso: "CN",
    manufacturingCountryEfashionProvenanceId: null,
    compositions: [{ name: "Acier Inoxydable", percentage: 100 }],
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    translations: {
      fr: { name: "Collier", description: "Description longue qui dépasse 30 caractères pour Ankorstore." },
    },
    variants: [makeVariant()],
    ...over,
  };
}

describe("ankorstoreSkuForVariant", () => {
  it("uses uppercase color : E803_DORÉ", () => {
    const v = makeVariant({ colorNames: ["Doré"] });
    expect(ankorstoreSkuForVariant("E803", v, 0)).toBe("E803_DORÉ");
  });

  it("joins multiple colors with space then uppercases", () => {
    const v = makeVariant({ colorNames: ["Doré", "Argent"] });
    expect(ankorstoreSkuForVariant("ZJ01", v, 0)).toBe("ZJ01_DORÉ ARGENT");
  });

  it("falls back to V<index> when no color", () => {
    const v = makeVariant({ colorNames: [] });
    expect(ankorstoreSkuForVariant("X", v, 2)).toBe("X_V3");
  });
});

describe("productToAnkorstoreRows", () => {
  it("emits description on first row, null on subsequent rows (cellule vide en XLSX, pas chaîne vide)", () => {
    const p = makeProduct({
      variants: [
        makeVariant({ variantId: "v1", colorNames: ["Doré"] }),
        makeVariant({ variantId: "v2", colorNames: ["Argent"] }),
      ],
    });
    const rows = productToAnkorstoreRows(p, makeCtx());
    expect(rows).toHaveLength(2);
    // Col 3 = description (index 2). null pour la 2ème variante évite l'erreur
    // Ankorstore "Description should not be blank" : un "" XLSX est interprété
    // par leur importeur comme un champ rempli mais invalide.
    expect(rows[0]![2]).toContain("Description longue");
    expect(rows[1]![2]).toBe(null);
  });

  it("uses ISO code uppercase in column 19", () => {
    const rows = productToAnkorstoreRows(makeProduct(), makeCtx());
    expect(rows[0]![18]).toBe("CN"); // col 19
  });

  it("applies wholesale + retail markups separately", () => {
    const rows = productToAnkorstoreRows(makeProduct(), makeCtx());
    // wholesale = 0% → 5
    expect(rows[0]![12]).toBe(5); // col 13 prix de gros
    // retail = ×2 → 10
    expect(rows[0]![13]).toBe(10); // col 14 prix de détail
  });

  it("includes VAT rate in column 15", () => {
    const rows = productToAnkorstoreRows(makeProduct(), makeCtx());
    expect(rows[0]![14]).toBe(20); // col 15
  });

  it("builds an image proxy URL", () => {
    const rows = productToAnkorstoreRows(makeProduct(), makeCtx());
    const imgVariant = rows[0]![6] as string; // col 7
    expect(imgVariant).toContain("https://beliandjolie.com/api/marketplace-image");
    expect(imgVariant).toContain("e803-dore-1.webp");
  });

  it("sets unitsPerPack to 1 for UNIT (col 17)", () => {
    const unit = productToAnkorstoreRows(makeProduct(), makeCtx());
    expect(unit[0]![16]).toBe(1); // col 17
  });

  it("ignore les variantes PACK (génère 0 ligne si uniquement des PACK)", () => {
    const rows = productToAnkorstoreRows(
      makeProduct({
        variants: [
          makeVariant({ saleType: "PACK", packQuantity: 12, unitPrice: 60 }),
        ],
      }),
      makeCtx(),
    );
    expect(rows).toHaveLength(0);
  });

  it("garde uniquement les UNIT quand mélange UNIT + PACK", () => {
    const rows = productToAnkorstoreRows(
      makeProduct({
        variants: [
          makeVariant({ variantId: "u1", saleType: "UNIT", colorNames: ["Doré"] }),
          makeVariant({ variantId: "p1", saleType: "PACK", packQuantity: 12, colorNames: ["Doré"] }),
          makeVariant({ variantId: "u2", saleType: "UNIT", colorNames: ["Argent"] }),
        ],
      }),
      makeCtx(),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]![4]).toBe("Doré"); // col 5
    expect(rows[1]![4]).toBe("Argent");
  });
});
