import { describe, it, expect } from "vitest";
import * as ExcelJS from "exceljs";
import { parseExcel, validateVariantRow, type ProductImportRow } from "@/lib/import-processor";

/**
 * Le poids (en kilogrammes) est désormais obligatoire dans l'Excel d'import
 * produits — la cliente a demandé ce verrou pour éviter les variantes
 * publiées sans donnée logistique.
 */

function makeRow(overrides: Partial<ProductImportRow> = {}): ProductImportRow {
  return {
    _rowIndex: 5,
    reference: "REF-001",
    name: "Produit",
    color: "Doré",
    saleType: "UNIT",
    unitPrice: 12.5,
    stock: 100,
    weight: 0.03,
    ...overrides,
    size: overrides.size ?? "M",
  };
}

describe("validateVariantRow — poids obligatoire", () => {
  it("accepte une ligne avec un poids > 0", () => {
    const errors = validateVariantRow(makeRow({ weight: 0.03 }));
    expect(errors).not.toContain("Poids (kg) obligatoire.");
  });

  it("refuse une ligne sans poids", () => {
    const errors = validateVariantRow(makeRow({ weight: undefined }));
    expect(errors).toContain("Poids (kg) obligatoire.");
  });

  it("refuse une ligne avec un poids égal à zéro", () => {
    const errors = validateVariantRow(makeRow({ weight: 0 }));
    expect(errors).toContain("Poids (kg) obligatoire.");
  });

  it("refuse une ligne avec un poids négatif", () => {
    const errors = validateVariantRow(makeRow({ weight: -0.5 }));
    expect(errors).toContain("Poids (kg) obligatoire.");
  });
});

describe("parseExcel — lecture du header « Poids (kg) * »", () => {
  it("lit la valeur de poids depuis le nouveau header avec astérisque", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Produits");

    ws.getCell(1, 1).value = "Référence *";
    ws.getCell(1, 2).value = "Nom *";
    ws.getCell(1, 3).value = "Couleur *";
    ws.getCell(1, 4).value = "Type de vente *";
    ws.getCell(1, 5).value = "Taille *";
    ws.getCell(1, 6).value = "Prix unitaire *";
    ws.getCell(1, 7).value = "Stock *";
    ws.getCell(1, 8).value = "Poids (kg) *";

    ws.getCell(2, 1).value = "REF-100";
    ws.getCell(2, 2).value = "Produit";
    ws.getCell(2, 3).value = "Doré";
    ws.getCell(2, 4).value = "UNIT";
    ws.getCell(2, 5).value = "M";
    ws.getCell(2, 6).value = 12.5;
    ws.getCell(2, 7).value = 100;
    ws.getCell(2, 8).value = 0.042;

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = parseExcel(buf);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].weight).toBe(0.042);
  });
});
