import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildPfsWorkbook } from "@/lib/marketplace-excel/pfs-export";
import { buildAnkorstoreWorkbook } from "@/lib/marketplace-excel/ankorstore-export";
import type { ExportContext, ExportProduct } from "@/lib/marketplace-excel/types";

function makeCtx(overrides: Partial<ExportContext> = {}): ExportContext {
  return {
    shopName: "Belli Jolie Test",
    markups: {
      pfs: { type: "percent", value: 10, rounding: "none" },
      ankorstoreWholesale: { type: "percent", value: 20, rounding: "none" },
      ankorstoreRetail: { type: "multiplier", value: 2, rounding: "none" },
    },
    ankorstoreVatRate: 20,
    r2PublicUrl: "https://cdn.test",
    ...overrides,
  };
}

function unitProduct(overrides: Partial<ExportProduct> = {}): ExportProduct {
  return {
    id: "p1",
    reference: "REF-001",
    name: "Collier test",
    description: "Un joli collier en acier inoxydable pour les tests.",
    pfsGenderCode: "WOMAN",
    pfsFamilyName: "Bijoux_Fantaisie",
    categoryName: "Colliers",
    seasonPfsRef: "AH2025",
    manufacturingCountryName: "Chine",
    manufacturingCountryIso: "CN",
    compositions: [{ name: "Acier Inoxydable", percentage: 100 }],
    translations: {
      en: { name: "Test necklace", description: "A nice stainless steel necklace." },
    },
    variants: [{
      variantId: "v1",
      saleType: "UNIT",
      colorNames: ["Doré"],
      subColorNames: [],
      packColorLines: [],
      packQuantity: null,
      sizes: [{ name: "TU", quantity: 1 }],
      unitPrice: 10,
      weight: 0.035,
      stock: 100,
      sku: "REF-001_DORE_UNIT_1",
      imagePaths: ["/uploads/products/a.webp"],
    }],
    ...overrides,
  };
}

async function readSheet(buffer: Buffer, sheetName: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.getWorksheet(sheetName)!;
}

describe("PFS Excel export", () => {
  it("applies pfs markup (10% on base price 10€ → 11€)", async () => {
    const ctx = makeCtx();
    const { buffer } = await buildPfsWorkbook([unitProduct()], ctx);
    const ws = await readSheet(buffer, "Données");
    const priceCell = ws.getRow(2).getCell(15).value; // Prix gros HT unit.
    expect(Number(priceCell)).toBeCloseTo(11, 2);
  });

  it("maps WOMAN → Femme", async () => {
    const { buffer } = await buildPfsWorkbook([unitProduct()], makeCtx());
    const ws = await readSheet(buffer, "Données");
    expect(ws.getRow(2).getCell(2).value).toBe("Femme"); // Genre
  });

  it("formats sizes as qty*size", async () => {
    const { buffer } = await buildPfsWorkbook([unitProduct()], makeCtx());
    const ws = await readSheet(buffer, "Données");
    expect(String(ws.getRow(2).getCell(13).value)).toBe("1*TU");
  });

  it("warns when pfsFamilyName is missing", async () => {
    const p = unitProduct({ pfsFamilyName: null });
    const { warnings } = await buildPfsWorkbook([p], makeCtx());
    expect(warnings.some((w) => w.message.includes("Famille PFS manquante"))).toBe(true);
  });

  it("emits one row per SaleType (UNIT + PACK → 2 rows)", async () => {
    const p = unitProduct({
      variants: [
        {
          variantId: "v1", saleType: "UNIT", colorNames: ["Or"], subColorNames: [], packColorLines: [],
          packQuantity: null, sizes: [{ name: "TU", quantity: 1 }], unitPrice: 10, weight: 0.1, stock: 5, sku: "a", imagePaths: [],
        },
        {
          variantId: "v2", saleType: "PACK", colorNames: [], subColorNames: [],
          packColorLines: [{ colors: ["Or"], sizes: [{ name: "TU", quantity: 12 }] }],
          packQuantity: 12, sizes: [{ name: "TU", quantity: 12 }], unitPrice: 120, weight: 1, stock: 2, sku: "b", imagePaths: [],
        },
      ],
    });
    const { buffer } = await buildPfsWorkbook([p], makeCtx());
    const ws = await readSheet(buffer, "Données");
    // 1 header + 2 saleType rows
    expect(ws.rowCount).toBe(3);
    expect(ws.getRow(2).getCell(11).value).toBe("Unité");
    expect(ws.getRow(3).getCell(11).value).toBe("Pack");
  });
});

describe("Ankorstore Excel export", () => {
  it("emits one row per variant", async () => {
    const p = unitProduct({
      variants: [
        { variantId: "v1", saleType: "UNIT", colorNames: ["Doré"], subColorNames: [], packColorLines: [], packQuantity: null, sizes: [{ name: "TU", quantity: 1 }], unitPrice: 10, weight: 0.035, stock: 5, sku: "A_DORE", imagePaths: [] },
        { variantId: "v2", saleType: "UNIT", colorNames: ["Argent"], subColorNames: [], packColorLines: [], packQuantity: null, sizes: [{ name: "TU", quantity: 1 }], unitPrice: 10, weight: 0.035, stock: 5, sku: "A_ARG", imagePaths: [] },
      ],
    });
    const { buffer } = await buildAnkorstoreWorkbook([p], makeCtx());
    const ws = await readSheet(buffer, "Vos produits");
    expect(ws.rowCount).toBe(3); // header + 2 variants
  });

  it("computes retail TTC = wholesale × retail markup × (1 + VAT)", async () => {
    // base 10 → wholesale (+20%) = 12 → retail (×2) = 24 → TTC (+20% VAT) = 28.8
    const ctx = makeCtx();
    const { buffer } = await buildAnkorstoreWorkbook([unitProduct()], ctx);
    const ws = await readSheet(buffer, "Vos produits");
    const row = ws.getRow(2);
    expect(Number(row.getCell(13).value)).toBeCloseTo(12, 2); // wholesale HT
    expect(Number(row.getCell(14).value)).toBeCloseTo(28.8, 2); // retail TTC
    expect(Number(row.getCell(15).value)).toBe(20); // VAT
  });

  it("uses country ISO code in column 19", async () => {
    const { buffer } = await buildAnkorstoreWorkbook([unitProduct()], makeCtx());
    const ws = await readSheet(buffer, "Vos produits");
    expect(ws.getRow(2).getCell(19).value).toBe("CN");
  });

  it("emits packQuantity as 'Nombre d'unités par paquet' for PACK", async () => {
    const p = unitProduct({
      variants: [{
        variantId: "v1", saleType: "PACK", colorNames: [], subColorNames: [],
        packColorLines: [{ colors: ["Doré"], sizes: [{ name: "TU", quantity: 12 }] }],
        packQuantity: 12, sizes: [{ name: "TU", quantity: 12 }], unitPrice: 120, weight: 1, stock: 3, sku: "PK", imagePaths: [],
      }],
    });
    const { buffer } = await buildAnkorstoreWorkbook([p], makeCtx());
    const ws = await readSheet(buffer, "Vos produits");
    expect(ws.getRow(2).getCell(17).value).toBe(12);
  });

  it("warns when description shorter than 30 chars", async () => {
    const p = unitProduct({ description: "Court." });
    const { warnings } = await buildAnkorstoreWorkbook([p], makeCtx());
    expect(warnings.some((w) => w.message.includes("Description"))).toBe(true);
  });
});

describe("Template preservation — the exported workbook IS the official model", () => {
  it("PFS: preserves ANNEXE sheets (Catégories, Tailles v2, Pays v2, Couleurs, GenreFamilleCatégorie) + Exemples", async () => {
    const { buffer } = await buildPfsWorkbook([unitProduct()], makeCtx());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toContain("Données");
    expect(names).toContain("Exemples");
    expect(names).toContain("ANNEXE Catégories");
    expect(names).toContain("ANNEXE Tailles v2");
    expect(names).toContain("ANNEXE Pays v2");
    expect(names).toContain("ANNEXE Couleurs");
  });

  it("Ankorstore: preserves LISEZ-MOI, Exemples and Codes pays sheets", async () => {
    const { buffer } = await buildAnkorstoreWorkbook([unitProduct()], makeCtx());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toContain("Vos produits");
    expect(names).toContain("LISEZ-MOI");
    expect(names).toContain("Codes pays");
  });

  it("PFS: reuses the template's header row (row 1 untouched, data starts at row 2)", async () => {
    const { buffer } = await buildPfsWorkbook([unitProduct()], makeCtx());
    const ws = await readSheet(buffer, "Données");
    // Template header for col 1 = "Marque*\n(obligatoire)"
    const headerMarque = cellText(ws.getRow(1).getCell(1).value);
    expect(headerMarque).toMatch(/Marque/);
    expect(headerMarque).toMatch(/obligatoire/);
    // Data row 2 carries our product reference
    expect(String(ws.getRow(2).getCell(5).value)).toBe("REF-001");
  });

  it("Ankorstore: reuses the template's header row (row 1 untouched, data starts at row 2)", async () => {
    const { buffer } = await buildAnkorstoreWorkbook([unitProduct()], makeCtx());
    const ws = await readSheet(buffer, "Vos produits");
    const headerSku = cellText(ws.getRow(1).getCell(1).value);
    expect(headerSku).toMatch(/SKU/);
    expect(String(ws.getRow(2).getCell(1).value)).toBe("REF-001_DORE_UNIT_1");
  });
});

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && value !== null && "richText" in value) {
    return (value as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  }
  return String(value);
}
