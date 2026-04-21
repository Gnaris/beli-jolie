import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildAnkorstoreWorkbook } from "@/lib/marketplace-excel/ankorstore-export";
import { variantColorSlug, formatPfsColorForFilename } from "@/lib/marketplace-excel/helpers";
import type { ExportContext, ExportProduct, ExportVariant } from "@/lib/marketplace-excel/types";

function ctx(): ExportContext {
  return {
    shopName: "Belli Jolie Test",
    markups: {
      pfs: { type: "percent", value: 0, rounding: "none" },
      ankorstoreWholesale: { type: "percent", value: 0, rounding: "none" },
      ankorstoreRetail: { type: "multiplier", value: 2, rounding: "none" },
    },
    ankorstoreVatRate: 20,
    r2PublicUrl: "https://cdn.test",
  };
}

function baseProduct(variants: ExportVariant[]): ExportProduct {
  return {
    id: "p1",
    reference: "REF-001",
    name: "Bague test",
    description: "Une bague en acier inoxydable pour tester le mapping PFS.",
    pfsGenderCode: "WOMAN",
    pfsFamilyName: "Bijoux_Fantaisie",
    pfsCategoryName: "Bagues",
    categoryName: "Bagues",
    seasonPfsRef: "AH2025",
    manufacturingCountryName: "Chine",
    manufacturingCountryIso: "CN",
    compositions: [{ name: "Acier", percentage: 100 }],
    translations: {},
    variants,
  };
}

async function loadRow(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.getWorksheet("Vos produits")!.getRow(2);
}

describe("Ankorstore export — PFS mapping is NOT applied (scoped to PFS only)", () => {
  it("keeps the joined color names even when pfsColorOverride is set", async () => {
    const p = baseProduct([{
      variantId: "v1",
      saleType: "UNIT",
      colorNames: ["Rouge"],
      subColorNames: ["Or"],
      pfsColorOverride: "Multicolore",
      packQuantity: null,
      sizes: [{ name: "TU", quantity: 1, pfsSizeRef: "TU" }],
      unitPrice: 10,
      weight: 0.05,
      stock: 5,
      sku: "SKU-A",
      imagePaths: [],
    }]);
    const { buffer } = await buildAnkorstoreWorkbook([p], ctx());
    const row = await loadRow(buffer);
    expect(row.getCell(5).value).toBe("Rouge / Or");
  });

  it("keeps the local BJ size name even when pfsSizeRef is set", async () => {
    const p = baseProduct([{
      variantId: "v1",
      saleType: "UNIT",
      colorNames: ["Doré"],
      subColorNames: [],
      packQuantity: null,
      sizes: [
        { name: "M", quantity: 2, pfsSizeRef: "M_EU" },
        { name: "L", quantity: 1, pfsSizeRef: "L_EU" },
      ],
      unitPrice: 10,
      weight: 0.05,
      stock: 5,
      sku: "SKU-C",
      imagePaths: [],
    }]);
    const { buffer } = await buildAnkorstoreWorkbook([p], ctx());
    const row = await loadRow(buffer);
    expect(row.getCell(4).value).toBe("2*M, L");
  });
});

describe("PFS image filename — variantColorSlug picks the override when present", () => {
  function prodWithVariant(v: ExportVariant): ExportProduct {
    return baseProduct([v]);
  }

  it("returns pfsColorOverride when the admin has mapped a multi-color combo", () => {
    const p = prodWithVariant({
      variantId: "v1",
      saleType: "UNIT",
      colorNames: ["Rouge"],
      subColorNames: ["Or"],
      pfsColorOverride: "Bleu Irisé",
      packQuantity: null,
      sizes: [],
      unitPrice: 10,
      weight: 0.05,
      stock: 5,
      sku: "SKU",
      imagePaths: ["/uploads/products/a.webp"],
    });
    expect(variantColorSlug(p, 0)).toBe("Bleu Irisé");
  });

  it("falls back to concatenated color names without override", () => {
    const p = prodWithVariant({
      variantId: "v1",
      saleType: "UNIT",
      colorNames: ["Rouge"],
      subColorNames: ["Or"],
      pfsColorOverride: null,
      packQuantity: null,
      sizes: [],
      unitPrice: 10,
      weight: 0.05,
      stock: 5,
      sku: "SKU",
      imagePaths: ["/uploads/products/a.webp"],
    });
    expect(variantColorSlug(p, 0)).toBe("Rouge_Or");
  });

  it("ignores whitespace-only override", () => {
    const p = prodWithVariant({
      variantId: "v1",
      saleType: "UNIT",
      colorNames: ["Noir"],
      subColorNames: [],
      pfsColorOverride: "   ",
      packQuantity: null,
      sizes: [],
      unitPrice: 10,
      weight: 0.05,
      stock: 5,
      sku: "SKU",
      imagePaths: ["/uploads/products/a.webp"],
    });
    expect(variantColorSlug(p, 0)).toBe("Noir");
  });
});

describe("formatPfsColorForFilename — PFS-friendly filename chunk", () => {
  it("collapses internal whitespace so 'Bleu Irisé' becomes 'BleuIrisé'", () => {
    expect(formatPfsColorForFilename("Bleu Irisé")).toBe("BleuIrisé");
  });

  it("preserves diacritics and casing", () => {
    expect(formatPfsColorForFilename("Doré")).toBe("Doré");
    expect(formatPfsColorForFilename("Crème")).toBe("Crème");
  });

  it("collapses several whitespace characters in a row", () => {
    expect(formatPfsColorForFilename("Or  Rose   Doré")).toBe("OrRoseDoré");
  });

  it("strips filesystem-unsafe characters but keeps the rest", () => {
    expect(formatPfsColorForFilename("Bleu/Marine")).toBe("BleuMarine");
    expect(formatPfsColorForFilename('A?B*C|D')).toBe("ABCD");
  });

  it("leaves existing underscores untouched (used as color separator)", () => {
    expect(formatPfsColorForFilename("Rouge_Or Rose")).toBe("Rouge_OrRose");
  });

  it("returns a placeholder for empty input", () => {
    expect(formatPfsColorForFilename("")).toBe("x");
    expect(formatPfsColorForFilename("   ")).toBe("x");
  });
});
