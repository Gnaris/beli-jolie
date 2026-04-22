import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildAnkorstoreWorkbook } from "@/lib/marketplace-excel/ankorstore-export";
import {
  variantColorSlug,
  formatPfsColorForFilename,
  formatPfsReferenceForFilename,
  pfsImageFileName,
} from "@/lib/marketplace-excel/helpers";
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

async function loadRows(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Vos produits")!;
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) rows.push(ws.getRow(r));
  return rows;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
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

  it("falls back to space-joined color names without override (underscores not allowed in PFS filenames)", () => {
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
    expect(variantColorSlug(p, 0)).toBe("Rouge Or");
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

  it("strips underscores — PFS filenames must not contain them", () => {
    expect(formatPfsColorForFilename("Rouge_Or Rose")).toBe("RougeOrRose");
  });

  it("returns a placeholder for empty input", () => {
    expect(formatPfsColorForFilename("")).toBe("x");
    expect(formatPfsColorForFilename("   ")).toBe("x");
  });
});

describe("formatPfsReferenceForFilename — reference token for the PFS filename", () => {
  it("strips diacritics and keeps alphanumeric characters", () => {
    expect(formatPfsReferenceForFilename("Réf001")).toBe("Ref001");
  });

  it("strips punctuation and whitespace", () => {
    expect(formatPfsReferenceForFilename("REF-123 A")).toBe("REF123A");
  });

  it("strips underscores — PFS filenames must not contain them", () => {
    expect(formatPfsReferenceForFilename("REF_001")).toBe("REF001");
  });

  it("returns a placeholder for empty input", () => {
    expect(formatPfsReferenceForFilename("")).toBe("x");
    expect(formatPfsReferenceForFilename("???")).toBe("x");
  });
});

describe("Ankorstore images — 1 thumbnail per variant, product gallery on first row only", () => {
  it("uses the variant's first image as the variant thumbnail (col 7) on every row", async () => {
    const p = baseProduct([
      {
        variantId: "v1",
        saleType: "UNIT",
        colorNames: ["Rouge"],
        subColorNames: [],
        packQuantity: null,
        sizes: [],
        unitPrice: 10,
        weight: 0.05,
        stock: 5,
        sku: "SKU-RED",
        imagePaths: ["/uploads/products/red-1.webp", "/uploads/products/red-2.webp"],
      },
      {
        variantId: "v2",
        saleType: "UNIT",
        colorNames: ["Bleu"],
        subColorNames: [],
        packQuantity: null,
        sizes: [],
        unitPrice: 10,
        weight: 0.05,
        stock: 5,
        sku: "SKU-BLUE",
        imagePaths: ["/uploads/products/blue-1.webp"],
      },
    ]);
    const { buffer } = await buildAnkorstoreWorkbook([p], ctx());
    const rows = await loadRows(buffer);
    expect(rows).toHaveLength(2);
    expect(cellText(rows[0].getCell(7))).toBe("https://cdn.test/uploads/products/red-1.webp");
    expect(cellText(rows[1].getCell(7))).toBe("https://cdn.test/uploads/products/blue-1.webp");
  });

  it("fills the product gallery (cols 8-12) only on the first variant row, aggregating unique URLs across all variants", async () => {
    const p = baseProduct([
      {
        variantId: "v1",
        saleType: "UNIT",
        colorNames: ["Rouge"],
        subColorNames: [],
        packQuantity: null,
        sizes: [],
        unitPrice: 10,
        weight: 0.05,
        stock: 5,
        sku: "SKU-RED",
        imagePaths: ["/uploads/products/red-1.webp", "/uploads/products/red-2.webp"],
      },
      {
        variantId: "v2",
        saleType: "UNIT",
        colorNames: ["Bleu"],
        subColorNames: [],
        packQuantity: null,
        sizes: [],
        unitPrice: 10,
        weight: 0.05,
        stock: 5,
        sku: "SKU-BLUE",
        imagePaths: ["/uploads/products/blue-1.webp", "/uploads/products/blue-2.webp"],
      },
    ]);
    const { buffer } = await buildAnkorstoreWorkbook([p], ctx());
    const rows = await loadRows(buffer);

    expect(cellText(rows[0].getCell(8))).toBe("https://cdn.test/uploads/products/red-1.webp");
    expect(cellText(rows[0].getCell(9))).toBe("https://cdn.test/uploads/products/red-2.webp");
    expect(cellText(rows[0].getCell(10))).toBe("https://cdn.test/uploads/products/blue-1.webp");
    expect(cellText(rows[0].getCell(11))).toBe("https://cdn.test/uploads/products/blue-2.webp");
    expect(cellText(rows[0].getCell(12))).toBe("");

    for (let c = 8; c <= 12; c++) {
      expect(cellText(rows[1].getCell(c))).toBe("");
    }
  });

  it("caps the product gallery at 5 images even when variants provide more", async () => {
    const paths = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `/uploads/products/${prefix}-${i + 1}.webp`);
    const p = baseProduct([
      {
        variantId: "v1",
        saleType: "UNIT",
        colorNames: ["Rouge"],
        subColorNames: [],
        packQuantity: null,
        sizes: [],
        unitPrice: 10,
        weight: 0.05,
        stock: 5,
        sku: "SKU-RED",
        imagePaths: paths("red", 4),
      },
      {
        variantId: "v2",
        saleType: "UNIT",
        colorNames: ["Bleu"],
        subColorNames: [],
        packQuantity: null,
        sizes: [],
        unitPrice: 10,
        weight: 0.05,
        stock: 5,
        sku: "SKU-BLUE",
        imagePaths: paths("blue", 3),
      },
    ]);
    const { buffer } = await buildAnkorstoreWorkbook([p], ctx());
    const rows = await loadRows(buffer);

    const gallery = [8, 9, 10, 11, 12].map((c) => cellText(rows[0].getCell(c)));
    expect(gallery).toEqual([
      "https://cdn.test/uploads/products/red-1.webp",
      "https://cdn.test/uploads/products/red-2.webp",
      "https://cdn.test/uploads/products/red-3.webp",
      "https://cdn.test/uploads/products/red-4.webp",
      "https://cdn.test/uploads/products/blue-1.webp",
    ]);
  });

  it("dedups URLs when variants share the same image path", async () => {
    const shared = "/uploads/products/shared.webp";
    const p = baseProduct([
      {
        variantId: "v1",
        saleType: "UNIT",
        colorNames: ["Rouge"],
        subColorNames: [],
        packQuantity: null,
        sizes: [],
        unitPrice: 10,
        weight: 0.05,
        stock: 5,
        sku: "SKU-RED",
        imagePaths: [shared, "/uploads/products/red-2.webp"],
      },
      {
        variantId: "v2",
        saleType: "UNIT",
        colorNames: ["Bleu"],
        subColorNames: [],
        packQuantity: null,
        sizes: [],
        unitPrice: 10,
        weight: 0.05,
        stock: 5,
        sku: "SKU-BLUE",
        imagePaths: [shared, "/uploads/products/blue-2.webp"],
      },
    ]);
    const { buffer } = await buildAnkorstoreWorkbook([p], ctx());
    const rows = await loadRows(buffer);

    expect(cellText(rows[0].getCell(8))).toBe("https://cdn.test/uploads/products/shared.webp");
    expect(cellText(rows[0].getCell(9))).toBe("https://cdn.test/uploads/products/red-2.webp");
    expect(cellText(rows[0].getCell(10))).toBe("https://cdn.test/uploads/products/blue-2.webp");
    expect(cellText(rows[0].getCell(11))).toBe("");
  });
});

describe("pfsImageFileName — exact 'reference couleur position.jpg' format", () => {
  it("joins the three tokens with spaces (no underscore)", () => {
    expect(pfsImageFileName("REF001", "Bleu Irisé", 0)).toBe("REF001 BleuIrisé 1.jpg");
  });

  it("uses 1-based position", () => {
    expect(pfsImageFileName("REF001", "Rouge", 0)).toBe("REF001 Rouge 1.jpg");
    expect(pfsImageFileName("REF001", "Rouge", 2)).toBe("REF001 Rouge 3.jpg");
  });

  it("contains no underscore even when inputs do", () => {
    const name = pfsImageFileName("REF_001", "Rouge_Or", 0);
    expect(name).not.toContain("_");
    expect(name).toBe("REF001 RougeOr 1.jpg");
  });

  it("falls back to a placeholder when the color label is empty", () => {
    expect(pfsImageFileName("REF001", "", 0)).toBe("REF001 x 1.jpg");
  });
});
