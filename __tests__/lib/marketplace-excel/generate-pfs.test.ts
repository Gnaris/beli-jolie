import { describe, it, expect } from "vitest";
import { batchProductsForPfs, productToPfsRows } from "@/lib/marketplace-excel/generate-pfs";
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
    unitPrice: 3.5,
    weight: 0.035,
    stock: 100,
    sku: null,
    imagePaths: [],
    ...over,
  };
}

function makeProduct(over: Partial<ExportProduct> = {}): ExportProduct {
  return {
    id: "p1",
    reference: "E803",
    name: "Collier en acier inoxydable",
    description: "Description complète du collier.",
    status: "ONLINE",
    pfsGenderCode: "WOMAN",
    pfsFamilyName: "Bijoux_Fantaisie",
    pfsCategoryName: "Colliers",
    categoryName: "Colliers",
    microstoreCategoryOverride: null,
    hsCode: "711719",
    efashionCategorieId: null,
    efashionCategoryPath: null,
    seasonPfsRef: "PE2026",
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
    translations: {},
    variants: [makeVariant()],
    ...over,
  };
}

describe("productToPfsRows", () => {
  it("UNIT produces 1 row with `Unité` and `1*TU`", () => {
    const rows = productToPfsRows(makeProduct(), makeCtx());
    expect(rows).toHaveLength(1);
    expect(rows[0]![10]).toBe("Unité"); // col 11
    expect(rows[0]![12]).toBe("1*TU"); // col 13
    expect(rows[0]![4]).toBe("E803"); // col 5 reference
  });

  it("PACK produces 1 row with `Pack` and `12*TU`", () => {
    const p = makeProduct({
      variants: [
        makeVariant({
          saleType: "PACK",
          packQuantity: 12,
          unitPrice: 42, // total pack = 42€ → 3.5/pc
          sizes: [{ name: "TU", quantity: 12, pfsSizeRef: "TU" }],
        }),
      ],
    });
    const rows = productToPfsRows(p, makeCtx());
    expect(rows[0]![10]).toBe("Pack");
    expect(rows[0]![12]).toBe("12*TU");
    expect(rows[0]![14]).toBe(3.5); // prix HT (per-piece)
  });

  it("exporte le stock tel quel pour un PACK (pas multiplié par la quantité du pack)", () => {
    // Décision 2026-06-06 : la cliente veut voir dans l'export le stock
    // affiché en admin (= nombre de packs), pas le total en pièces.
    const p = makeProduct({
      variants: [
        makeVariant({
          saleType: "PACK",
          packQuantity: 12,
          unitPrice: 42,
          stock: 1000,
          sizes: [{ name: "TU", quantity: 12, pfsSizeRef: "TU" }],
        }),
      ],
    });
    const rows = productToPfsRows(p, makeCtx());
    expect(rows[0]![16]).toBe(1000); // col 17 "Quantité total stock pcs"
  });

  it("exporte le stock tel quel pour une UNIT (pas de multiplication)", () => {
    const p = makeProduct({
      variants: [makeVariant({ stock: 1000 })],
    });
    const rows = productToPfsRows(p, makeCtx());
    expect(rows[0]![16]).toBe(1000); // col 17
  });

  it("uses Composition Matière in column 19", () => {
    const rows = productToPfsRows(makeProduct(), makeCtx());
    expect(rows[0]![18]).toBe("100% Acier Inoxydable"); // col 19
  });

  it("translates gender code WOMAN to `Femme`", () => {
    const rows = productToPfsRows(makeProduct(), makeCtx());
    expect(rows[0]![1]).toBe("Femme"); // col 2
  });
});

describe("batchProductsForPfs", () => {
  function makeProductWithVariants(ref: string, variantCount: number): ExportProduct {
    return makeProduct({
      id: ref,
      reference: ref,
      variants: Array.from({ length: variantCount }, (_, i) =>
        makeVariant({ variantId: `${ref}-v${i}` }),
      ),
    });
  }

  it("groups products into batches up to limit", () => {
    const products = Array.from({ length: 5 }, (_, i) =>
      makeProductWithVariants(`P${i}`, 1),
    );
    const batches = batchProductsForPfs(products, 3);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(3);
    expect(batches[1]).toHaveLength(2);
  });

  it("never splits a single product across two batches", () => {
    // P1 = 3 variantes ; limit 3 ; P2 = 1 variante. P2 doit aller en batch 2.
    const products = [
      makeProductWithVariants("P1", 3),
      makeProductWithVariants("P2", 1),
    ];
    const batches = batchProductsForPfs(products, 3);
    expect(batches).toHaveLength(2);
    expect(batches[0]!.map((p) => p.reference)).toEqual(["P1"]);
    expect(batches[1]!.map((p) => p.reference)).toEqual(["P2"]);
  });

  it("throws if a single product exceeds the row limit", () => {
    const products = [makeProductWithVariants("Big", 600)];
    expect(() => batchProductsForPfs(products, 500)).toThrow(/supérieur/);
  });
});
