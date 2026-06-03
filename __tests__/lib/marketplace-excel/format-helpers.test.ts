import { describe, it, expect } from "vitest";
import {
  formatSizesQty,
  formatColorList,
  formatCompositionPfs,
  formatCompositionEfashion,
  variantUnitPriceWithMarkup,
  variantTotalPriceWithMarkup,
  aggregatePackSizes,
  pickTranslation,
  slugForImageFilename,
} from "@/lib/marketplace-excel/format-helpers";
import type { ExportProduct, ExportVariant } from "@/lib/marketplace-excel/types";

const noMarkup = { type: "percent" as const, value: 0, rounding: "none" as const };
const percent20 = { type: "percent" as const, value: 20, rounding: "none" as const };

function makeVariant(over: Partial<ExportVariant> = {}): ExportVariant {
  return {
    variantId: "v1",
    saleType: "UNIT",
    colorNames: ["Doré"],
    packQuantity: null,
    sizes: [{ name: "TU", quantity: 1, pfsSizeRef: "TU" }],
    unitPrice: 10,
    weight: 0.05,
    stock: 100,
    sku: null,
    imagePaths: [],
    ...over,
  };
}

describe("formatSizesQty", () => {
  it("formats single size as `1*TU`", () => {
    const v = makeVariant();
    expect(formatSizesQty(v.sizes, ", ", true)).toBe("1*TU");
  });

  it("uses pfsSizeRef when usePfsRef is true", () => {
    const v = makeVariant({
      sizes: [{ name: "Taille unique", quantity: 12, pfsSizeRef: "TU" }],
    });
    expect(formatSizesQty(v.sizes, ", ", true)).toBe("12*TU");
  });

  it("falls back to size.name when pfsSizeRef missing", () => {
    const v = makeVariant({
      sizes: [{ name: "S", quantity: 2, pfsSizeRef: null }],
    });
    expect(formatSizesQty(v.sizes, ", ", true)).toBe("2*S");
  });

  it("uses size.name when usePfsRef false (Efashion)", () => {
    const v = makeVariant({
      sizes: [
        { name: "S", quantity: 2, pfsSizeRef: "XS" },
        { name: "M", quantity: 2, pfsSizeRef: "S" },
        { name: "L", quantity: 2, pfsSizeRef: "M" },
      ],
    });
    expect(formatSizesQty(v.sizes, ",", false)).toBe("2*S,2*M,2*L");
  });
});

describe("formatColorList", () => {
  it("joins multiple colors with comma+space", () => {
    expect(formatColorList(makeVariant({ colorNames: ["Doré", "Argent"] }))).toBe(
      "Doré, Argent",
    );
  });

  it("single color stays single", () => {
    expect(formatColorList(makeVariant({ colorNames: ["Noir"] }))).toBe("Noir");
  });
});

describe("compositions", () => {
  const product = {
    compositions: [
      { name: "Coton", percentage: 65 },
      { name: "Polyester", percentage: 35 },
    ],
  } as ExportProduct;

  it("formats PFS-style with ` - ` separator", () => {
    expect(formatCompositionPfs(product)).toBe("65% Coton - 35% Polyester");
  });

  it("formats Efashion-style with `*` and `,`", () => {
    expect(formatCompositionEfashion(product)).toBe("Coton*65,Polyester*35");
  });
});

describe("variant pricing", () => {
  it("UNIT applies markup directly", () => {
    const v = makeVariant({ unitPrice: 10 });
    expect(variantUnitPriceWithMarkup(v, percent20)).toBe(12);
  });

  it("PACK applies markup on per-piece base", () => {
    const v = makeVariant({
      saleType: "PACK",
      packQuantity: 12,
      unitPrice: 60, // total pack = 60€ → 5€/pc
    });
    expect(variantUnitPriceWithMarkup(v, percent20)).toBe(6); // 5 * 1.2
  });

  it("total price = per-piece * packQty for PACK", () => {
    const v = makeVariant({
      saleType: "PACK",
      packQuantity: 12,
      unitPrice: 60,
    });
    expect(variantTotalPriceWithMarkup(v, noMarkup)).toBe(60);
  });
});

describe("aggregatePackSizes", () => {
  it("returns variant.sizes unchanged when no packLines", () => {
    const v = makeVariant();
    expect(aggregatePackSizes(v)).toEqual(v.sizes);
  });

  it("aggregates pack lines summing quantities per size", () => {
    const v = makeVariant({
      packLines: [
        { colorName: "Rouge", sizes: [{ name: "S", quantity: 2 }, { name: "M", quantity: 3 }] },
        { colorName: "Bleu", sizes: [{ name: "M", quantity: 2 }] },
        { colorName: "Noir", sizes: [{ name: "L", quantity: 1 }] },
      ],
    });
    const agg = aggregatePackSizes(v);
    const byName = Object.fromEntries(agg.map((s) => [s.name, s.quantity]));
    expect(byName).toEqual({ S: 2, M: 5, L: 1 });
  });
});

describe("pickTranslation", () => {
  it("uses translation when available", () => {
    const p = {
      name: "X",
      description: "Y",
      translations: { en: { name: "Stainless necklace", description: "Z" } },
    } as ExportProduct;
    expect(pickTranslation(p, "en", "name")).toBe("Stainless necklace");
  });

  it("returns FR product field when locale is fr", () => {
    const p = {
      name: "Original FR",
      description: "Orig",
      translations: {},
    } as ExportProduct;
    expect(pickTranslation(p, "fr", "name")).toBe("Original FR");
  });

  it("returns empty string for ES/DE/IT when no translation (no FR fallback)", () => {
    const p = {
      name: "Original FR",
      description: "Orig",
      translations: {},
    } as ExportProduct;
    expect(pickTranslation(p, "es", "name")).toBe("");
    expect(pickTranslation(p, "de", "name")).toBe("");
    expect(pickTranslation(p, "it", "name")).toBe("");
  });
});

describe("formatCompositionEfashion", () => {
  it("uses efashionLabel when available", () => {
    const p = {
      compositions: [{ name: "Acier Inoxydable", percentage: 100, efashionLabel: "Acier" }],
    } as ExportProduct;
    expect(formatCompositionEfashion(p)).toBe("Acier*100");
  });

  it("falls back to local name when no efashionLabel", () => {
    const p = {
      compositions: [{ name: "Coton", percentage: 100 }],
    } as ExportProduct;
    expect(formatCompositionEfashion(p)).toBe("Coton*100");
  });
});

describe("slugForImageFilename", () => {
  it("preserves accents but replaces spaces with hyphens", () => {
    expect(slugForImageFilename("Doré Foncé")).toBe("Doré-Foncé");
  });

  it("strips Windows-illegal characters", () => {
    expect(slugForImageFilename('A/B\\C:D*E?F"G<H>I|J')).toBe("ABCDEFGHIJ");
  });
});
