import { describe, it, expect } from "vitest";
import { boolish, readStatus, type ProductImportRow } from "@/lib/import-processor";

/**
 * Couvre l'extension de l'import produit (mai 2026) qui aligne l'Excel/JSON sur
 * le formulaire manuel : Code SH, couleur principale, taille unique, statut,
 * best seller, traductions EN.
 */

describe("boolish", () => {
  it("reconnaît true/1/oui/yes/vrai/x comme vrai", () => {
    expect(boolish("true")).toBe(true);
    expect(boolish("TRUE")).toBe(true);
    expect(boolish("1")).toBe(true);
    expect(boolish("oui")).toBe(true);
    expect(boolish("Yes")).toBe(true);
    expect(boolish("vrai")).toBe(true);
    expect(boolish("x")).toBe(true);
  });

  it("reconnaît false/0/non/no/faux comme faux", () => {
    expect(boolish("false")).toBe(false);
    expect(boolish("0")).toBe(false);
    expect(boolish("non")).toBe(false);
    expect(boolish("NO")).toBe(false);
    expect(boolish("faux")).toBe(false);
  });

  it("retourne undefined pour valeur vide ou inconnue", () => {
    expect(boolish("")).toBeUndefined();
    expect(boolish(undefined)).toBeUndefined();
    expect(boolish(null)).toBeUndefined();
    expect(boolish("peut-être")).toBeUndefined();
  });
});

describe("readStatus", () => {
  it("accepte les valeurs canoniques", () => {
    expect(readStatus("OFFLINE")).toBe("OFFLINE");
    expect(readStatus("ONLINE")).toBe("ONLINE");
    expect(readStatus("ARCHIVED")).toBe("ARCHIVED");
  });

  it("accepte les alias FR (insensibles à la casse + accents)", () => {
    expect(readStatus("en ligne")).toBe("ONLINE");
    expect(readStatus("Hors ligne")).toBe("OFFLINE");
    expect(readStatus("brouillon")).toBe("OFFLINE");
    expect(readStatus("archivé")).toBe("ARCHIVED");
    expect(readStatus("publié")).toBe("ONLINE");
  });

  it("rejette SYNCING (état système, pas un statut admin)", () => {
    expect(readStatus("SYNCING")).toBeUndefined();
  });

  it("retourne undefined pour valeur vide ou inconnue", () => {
    expect(readStatus("")).toBeUndefined();
    expect(readStatus(undefined)).toBeUndefined();
    expect(readStatus("FOO")).toBeUndefined();
  });
});

describe("ProductImportRow — type contract", () => {
  it("expose toutes les colonnes manuelles attendues", () => {
    // Compilation-only test : si le type ProductImportRow régresse en perdant
    // un champ, ce test ne compilera plus.
    const r: ProductImportRow = {
      _rowIndex: 1,
      reference: "X",
      name: "X",
      color: "X",
      saleType: "UNIT",
      unitPrice: 1,
      stock: 0,
      hsCode: "71171900",
      primaryColor: "Doré",
      sizeDetailsTu: "52-56",
      status: "ONLINE",
      isBestSeller: true,
      nameEn: "X",
      descriptionEn: "X",
    };
    expect(r.hsCode).toBe("71171900");
  });
});
