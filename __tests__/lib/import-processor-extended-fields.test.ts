import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { boolish, parseExcel, readStatus, type ProductImportRow } from "@/lib/import-processor";

/**
 * Couvre l'extension de l'import produit (mai 2026) qui aligne l'Excel sur
 * le formulaire manuel : Code SH, couleur principale, taille unique, statut,
 * best seller. La traduction anglaise est désormais générée automatiquement
 * via l'API PFS — plus de colonnes EN à valider ici.
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
      isBestSeller: true,
    };
    expect(r.hsCode).toBe("71171900");
  });
});

describe("parseExcel — détection des headers du template (avec étoile)", () => {
  function buildBuffer(rows: (string | number)[][]): Buffer {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produits");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  }

  /**
   * Le template écrit ses colonnes obligatoires avec une étoile finale
   * (« Détail taille unique * »). Le parseur doit reconnaître la version
   * avec étoile sinon le champ devient `undefined` et l'erreur
   * « Détail taille unique manquant » est levée à tort.
   */
  it("lit « Détail taille unique * » même quand la valeur saisie est « 0 »", () => {
    const buffer = buildBuffer([
      ["🛍️  Fiche produit"], // bandeau ligne 1 → skip via range:1
      [
        "Référence *", "Nom *", "Description *", "Catégorie *",
        "Composition *", "Pays fabrication *", "Saison *",
        "Détail taille unique *",
        "Couleur *", "Type de vente *", "Taille *", "Prix unitaire *", "Stock *",
      ],
      [
        "REF-001", "Mon Produit", "Une description",
        "Bracelets", "Acier inoxydable:100", "Chine", "Toutes saisons",
        "0",
        "Doré", "UNIT", "Taille unique", 3.5, 1000,
      ],
    ]);

    const rows = parseExcel(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0].sizeDetailsTu).toBe("0");
  });

  it("lit aussi l'ancien header « Détail taille unique » sans étoile (compat ascendante)", () => {
    const buffer = buildBuffer([
      ["🛍️  Fiche produit"],
      [
        "Référence *", "Nom *", "Description *", "Catégorie *",
        "Composition *", "Pays fabrication *", "Saison *",
        "Détail taille unique",
        "Couleur *", "Type de vente *", "Taille *", "Prix unitaire *", "Stock *",
      ],
      [
        "REF-002", "Mon Produit", "Une description",
        "Bracelets", "Acier inoxydable:100", "Chine", "Toutes saisons",
        "52-56",
        "Doré", "UNIT", "Taille unique", 3.5, 1000,
      ],
    ]);

    const rows = parseExcel(buffer);
    expect(rows[0].sizeDetailsTu).toBe("52-56");
  });
});
