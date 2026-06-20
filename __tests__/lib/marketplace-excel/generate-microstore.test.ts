import { describe, it, expect } from "vitest";
import { productToMicrostoreRows } from "@/lib/marketplace-excel/generate-microstore";
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
      ankorstoreRetail: noMarkup,
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
    unitPrice: 4.2,
    weight: 0.025,
    stock: 12,
    sku: null,
    imagePaths: [],
    ...over,
  };
}

function makeProduct(over: Partial<ExportProduct> = {}): ExportProduct {
  return {
    id: "p1",
    reference: "AAA-100",
    name: "Bracelet acier",
    description: "Bracelet en acier inoxydable, fermoir mousqueton.",
    pfsGenderCode: "WOMAN",
    pfsFamilyName: "Bijoux_Fantaisie",
    pfsCategoryName: "Bracelets",
    categoryName: "Bracelet",
    microstoreCategoryOverride: null,
    hsCode: "711719",
    efashionCategorieId: null,
    efashionCategoryPath: null,
    seasonPfsRef: "PE2026",
    seasonEfashionCollectionId: null,
    seasonEfashionLabel: null,
    seasonName: "Toutes saisons",
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
      fr: { name: "Bracelet acier", description: "Bracelet en acier inoxydable." },
    },
    variants: [makeVariant()],
    ...over,
  };
}

describe("productToMicrostoreRows — colonne Catégorie", () => {
  // L'index 2 correspond à la colonne « Catégorie » (3ᵉ colonne du modèle
  // Microstore, voir generate-microstore.ts).
  const COL_CATEGORIE = 2;

  it("utilise la catégorie principale par défaut (pas d'override)", () => {
    const rows = productToMicrostoreRows(makeProduct(), makeCtx());
    expect(rows).toHaveLength(1);
    expect(rows[0]![COL_CATEGORIE]).toBe("Bracelets"); // pfsCategoryName prioritaire
  });

  it("retombe sur la catégorie locale si pas de catégorie PFS", () => {
    const rows = productToMicrostoreRows(
      makeProduct({ pfsCategoryName: null }),
      makeCtx(),
    );
    expect(rows[0]![COL_CATEGORIE]).toBe("Bracelet"); // categoryName local
  });

  it("utilise la sous-catégorie quand microstoreCategoryOverride est posé", () => {
    const rows = productToMicrostoreRows(
      makeProduct({ microstoreCategoryOverride: "Bracelet de main" }),
      makeCtx(),
    );
    expect(rows[0]![COL_CATEGORIE]).toBe("Bracelet de main");
  });

  it("l'override Microstore prime sur pfsCategoryName ET categoryName", () => {
    const rows = productToMicrostoreRows(
      makeProduct({
        pfsCategoryName: "Bracelets",
        categoryName: "Bracelet",
        microstoreCategoryOverride: "Chaîne de cheville",
      }),
      makeCtx(),
    );
    expect(rows[0]![COL_CATEGORIE]).toBe("Chaîne de cheville");
  });

  it("ignore un override vide (chaîne vide → fallback catégorie principale)", () => {
    const rows = productToMicrostoreRows(
      makeProduct({ microstoreCategoryOverride: "" }),
      makeCtx(),
    );
    expect(rows[0]![COL_CATEGORIE]).toBe("Bracelets");
  });
});
