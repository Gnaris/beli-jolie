import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildAnkorstoreWorkbook } from "@/lib/marketplace-excel/ankorstore-export";
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
    publicBaseUrl: "https://cdn.test",
  };
}

function unitVariant(sku: string): ExportVariant {
  return {
    variantId: `v-${sku}`,
    saleType: "UNIT",
    colorNames: ["Rouge"],
    subColorNames: [],
    packQuantity: null,
    sizes: [],
    unitPrice: 10,
    weight: 0.05,
    stock: 5,
    sku,
    imagePaths: [],
  };
}

function product(reference: string, description: string, variants: ExportVariant[]): ExportProduct {
  return {
    id: "p1",
    reference,
    name: "Bague test",
    description,
    pfsGenderCode: "WOMAN",
    pfsFamilyName: "Bijoux_Fantaisie",
    pfsCategoryName: "Bagues",
    categoryName: "Bagues",
    seasonPfsRef: "AH2025",
    manufacturingCountryName: "Chine",
    manufacturingCountryIso: "CN",
    compositions: [{ name: "Acier", percentage: 100 }],
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    translations: {},
    variants,
  };
}

async function readDescription(buffer: Buffer, row = 2): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const cell = wb.getWorksheet("Vos produits")!.getRow(row).getCell(3);
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  // ExcelJS may wrap multiline strings in a richText structure
  if (typeof v === "object" && v !== null && "richText" in (v as object)) {
    const parts = (v as { richText: { text: string }[] }).richText;
    return parts.map((p) => p.text).join("");
  }
  return String(v);
}

describe("Ankorstore export — description appends 'Référence : <ref>' on a new line", () => {
  it("appends the reference line at the end of the description", async () => {
    const desc = "Une jolie bague en acier inoxydable, hypoallergénique.";
    const p = product("REF-001", desc, [unitVariant("SKU-A")]);
    const { buffer } = await buildAnkorstoreWorkbook([p], ctx());
    const cellValue = await readDescription(buffer);
    expect(cellValue).toBe(`${desc}\nRéférence : REF-001`);
  });

  it("uses only 'Référence : <ref>' when the original description is empty", async () => {
    const p = product("REF-002", "", [unitVariant("SKU-B")]);
    const { buffer } = await buildAnkorstoreWorkbook([p], ctx());
    const cellValue = await readDescription(buffer);
    expect(cellValue).toBe("Référence : REF-002");
  });

  it("trims trailing whitespace before appending the reference line", async () => {
    const p = product("REF-003", "Bracelet doré.   \n  ", [unitVariant("SKU-C")]);
    const { buffer } = await buildAnkorstoreWorkbook([p], ctx());
    const cellValue = await readDescription(buffer);
    expect(cellValue).toBe("Bracelet doré.\nRéférence : REF-003");
  });

  it("only writes the description on the first variant row", async () => {
    const desc = "Une jolie bague en acier inoxydable, hypoallergénique.";
    const p = product("REF-004", desc, [unitVariant("SKU-D1"), unitVariant("SKU-D2")]);
    const { buffer } = await buildAnkorstoreWorkbook([p], ctx());
    expect(await readDescription(buffer, 2)).toBe(`${desc}\nRéférence : REF-004`);
    expect(await readDescription(buffer, 3)).toBe("");
  });
});

describe("Ankorstore export — 30-char minimum is checked AFTER the reference line is appended", () => {
  it("does NOT warn when the original description is short but the reference suffix pushes it past 30 chars", async () => {
    // 16 chars + "\nRéférence : REF-1234567" = 16 + 1 + 12 + 7 = 36 chars
    const shortDesc = "Bague élégante.";
    const p = product("REF-1234567", shortDesc, [unitVariant("SKU-E")]);
    const { warnings } = await buildAnkorstoreWorkbook([p], ctx());
    const descWarnings = warnings.filter((w) => w.message.includes("Description"));
    expect(descWarnings).toEqual([]);
  });

  it("warns when even after appending the reference line the total is still < 30 chars", async () => {
    // empty desc + "Référence : R1" = 14 chars → still too short
    const p = product("R1", "", [unitVariant("SKU-F")]);
    const { warnings } = await buildAnkorstoreWorkbook([p], ctx());
    const descWarnings = warnings.filter((w) => w.message.includes("Description"));
    expect(descWarnings).toHaveLength(1);
    expect(descWarnings[0].reference).toBe("R1");
  });
});
