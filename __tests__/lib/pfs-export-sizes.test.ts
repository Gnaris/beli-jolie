import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildPfsWorkbook } from "@/lib/marketplace-excel/pfs-export";
import type { ExportContext, ExportProduct } from "@/lib/marketplace-excel/types";

function ctx(): ExportContext {
  return {
    shopName: "Belli Jolie Test",
    markups: {
      pfs: { type: "percent", value: 10, rounding: "none" },
      ankorstoreWholesale: { type: "percent", value: 20, rounding: "none" },
      ankorstoreRetail: { type: "multiplier", value: 2, rounding: "none" },
    },
    ankorstoreVatRate: 20,
    publicBaseUrl: "https://cdn.test",
  };
}

function product(sizes: { name: string; quantity: number; pfsSizeRef?: string | null }[]): ExportProduct {
  return {
    id: "p1",
    reference: "REF-SZ",
    name: "Produit test",
    description: "Un produit pour tester le mapping des tailles PFS.",
    pfsGenderCode: "WOMAN",
    pfsFamilyName: "Bijoux_Fantaisie",
    pfsCategoryName: "Colliers",
    categoryName: "Colliers",
    seasonPfsRef: "AH2025",
    manufacturingCountryName: "Chine",
    manufacturingCountryIso: "CN",
    compositions: [{ name: "Acier", percentage: 100 }],
    translations: {},
    variants: [{
      variantId: "v1",
      saleType: "UNIT",
      colorNames: ["Doré"],
      subColorNames: [],
      packQuantity: null,
      sizes,
      unitPrice: 10,
      weight: 0.1,
      stock: 5,
      sku: "REF-SZ_DORE_UNIT_1",
      imagePaths: [],
    }],
  };
}

async function sheetData(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb.getWorksheet("Données")!;
}

describe("PFS export — size ref formatting", () => {
  it("uses the pfsSizeRef when available", async () => {
    const { buffer, warnings } = await buildPfsWorkbook(
      [product([{ name: "M", quantity: 2, pfsSizeRef: "M_EU" }, { name: "L", quantity: 1, pfsSizeRef: "L_EU" }])],
      ctx(),
    );
    const ws = await sheetData(buffer);
    const row = ws.getRow(2);
    // Column 13 = "Tailles" (format "qty*ref, qty*ref")
    expect(row.getCell(13).value).toBe("2*M_EU, 1*L_EU");
    // No size-mapping warning emitted
    expect(warnings.filter((w) => w.message.includes("sans référence PFS"))).toHaveLength(0);
  });

  it("falls back to the BJ name and emits a warning when ref is missing", async () => {
    const { buffer, warnings } = await buildPfsWorkbook(
      [product([{ name: "M", quantity: 1, pfsSizeRef: null }])],
      ctx(),
    );
    const ws = await sheetData(buffer);
    expect(ws.getRow(2).getCell(13).value).toBe("1*M");
    const orphanWarning = warnings.find((w) => w.message.includes('Taille « M »'));
    expect(orphanWarning).toBeDefined();
    expect(orphanWarning!.reference).toBe("REF-SZ");
  });

  it("only warns once per distinct missing size name per product", async () => {
    const { warnings } = await buildPfsWorkbook(
      [product([
        { name: "M", quantity: 1, pfsSizeRef: null },
        { name: "M", quantity: 1, pfsSizeRef: null },
        { name: "L", quantity: 1, pfsSizeRef: null },
      ])],
      ctx(),
    );
    const missing = warnings.filter((w) => w.message.includes("sans référence PFS"));
    expect(missing.map((w) => w.message.match(/« ([^»]+) »/)?.[1])).toEqual(["M", "L"]);
  });
});
