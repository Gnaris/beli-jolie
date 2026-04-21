import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildPfsWorkbook } from "@/lib/marketplace-excel/pfs-export";
import type { ExportContext, ExportProduct } from "@/lib/marketplace-excel/types";

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

function baseProduct(): ExportProduct {
  return {
    id: "p1",
    reference: "REF-001",
    name: "Bague multi",
    description: "Une bague multi-couleurs en acier inoxydable avec finitions dorées.",
    pfsGenderCode: "WOMAN",
    pfsFamilyName: "Bijoux_Fantaisie",
    pfsCategoryName: "Bagues",
    categoryName: "Bagues",
    seasonPfsRef: "AH2025",
    manufacturingCountryName: "Chine",
    manufacturingCountryIso: "CN",
    compositions: [{ name: "Acier", percentage: 100 }],
    translations: {},
    variants: [],
  };
}

async function loadColorCell(p: ExportProduct): Promise<unknown> {
  const { buffer } = await buildPfsWorkbook([p], ctx());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Données")!;
  return ws.getRow(2).getCell(14).value;
}

describe("PFS export — multi-color variant color override", () => {
  it("uses the override when pfsColorOverride is set on a multi-color variant", async () => {
    const p = baseProduct();
    p.variants.push({
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
      sku: "REF-001_ROUGE_OR",
      imagePaths: [],
    });
    const value = await loadColorCell(p);
    expect(value).toBe("Multicolore");
  });

  it("falls back to comma-joined colorNames + subColorNames when no override", async () => {
    const p = baseProduct();
    p.variants.push({
      variantId: "v1",
      saleType: "UNIT",
      colorNames: ["Rouge"],
      subColorNames: ["Or"],
      pfsColorOverride: null,
      packQuantity: null,
      sizes: [{ name: "TU", quantity: 1, pfsSizeRef: "TU" }],
      unitPrice: 10,
      weight: 0.05,
      stock: 5,
      sku: "REF-001_ROUGE_OR",
      imagePaths: [],
    });
    const value = await loadColorCell(p);
    expect(value).toBe("Rouge, Or");
  });

  it("ignores empty-string override and uses colorNames instead", async () => {
    const p = baseProduct();
    p.variants.push({
      variantId: "v1",
      saleType: "UNIT",
      colorNames: ["Noir"],
      subColorNames: [],
      pfsColorOverride: "",
      packQuantity: null,
      sizes: [{ name: "TU", quantity: 1, pfsSizeRef: "TU" }],
      unitPrice: 10,
      weight: 0.05,
      stock: 5,
      sku: "REF-001_NOIR",
      imagePaths: [],
    });
    const value = await loadColorCell(p);
    expect(value).toBe("Noir");
  });
});
