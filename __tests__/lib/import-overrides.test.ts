import { describe, it, expect } from "vitest";
import { applyOverrides, type ImportOverride, type ProductImportRow } from "@/lib/import-processor";

/**
 * Vérifie l'application des overrides envoyés par l'UI éditable du
 * récapitulatif d'import (fichier overrides.json à côté du XLSX).
 *
 * Cas couverts :
 *  - Champ produit modifié → propagé sur toutes les rows du groupe
 *  - Champ variante modifié → posé sur la row à l'index donné uniquement
 *  - Référence inconnue dans les overrides → silencieusement ignorée
 *  - Champ override = "" → écrase la valeur d'origine (modification volontaire)
 *  - Champ override = undefined → la valeur d'origine est conservée
 */

function makeRow(partial: Partial<ProductImportRow>): ProductImportRow {
  return {
    _rowIndex: 0,
    reference: "REF",
    name: "",
    color: "",
    saleType: "UNIT",
    unitPrice: 0,
    stock: 0,
    ...partial,
  };
}

describe("applyOverrides", () => {
  it("modifie un champ produit sur toutes les rows du groupe", () => {
    const grouped = new Map<string, ProductImportRow[]>([
      [
        "PRD-001",
        [
          makeRow({ reference: "PRD-001", name: "Ancien nom", color: "Bleu" }),
          makeRow({ reference: "PRD-001", name: "Ancien nom", color: "Rouge" }),
        ],
      ],
    ]);
    const overrides: Record<string, ImportOverride> = {
      "PRD-001": { name: "Nouveau nom", category: "Bijoux" },
    };
    applyOverrides(grouped, overrides);
    const rows = grouped.get("PRD-001")!;
    expect(rows[0].name).toBe("Nouveau nom");
    expect(rows[1].name).toBe("Nouveau nom");
    expect(rows[0].category).toBe("Bijoux");
    expect(rows[1].category).toBe("Bijoux");
  });

  it("modifie une variante à l'index ciblé sans toucher aux autres", () => {
    const grouped = new Map<string, ProductImportRow[]>([
      [
        "PRD-002",
        [
          makeRow({ reference: "PRD-002", color: "Bleu", unitPrice: 10, stock: 5 }),
          makeRow({ reference: "PRD-002", color: "Rouge", unitPrice: 10, stock: 3 }),
          makeRow({ reference: "PRD-002", color: "Vert", unitPrice: 10, stock: 7 }),
        ],
      ],
    ]);
    const overrides: Record<string, ImportOverride> = {
      "PRD-002": {
        variants: {
          1: { unitPrice: 25, stock: 99 },
        },
      },
    };
    applyOverrides(grouped, overrides);
    const rows = grouped.get("PRD-002")!;
    expect(rows[0].unitPrice).toBe(10);
    expect(rows[0].stock).toBe(5);
    expect(rows[1].unitPrice).toBe(25);
    expect(rows[1].stock).toBe(99);
    expect(rows[2].unitPrice).toBe(10);
    expect(rows[2].stock).toBe(7);
  });

  it("modifie plusieurs variantes simultanément", () => {
    const grouped = new Map<string, ProductImportRow[]>([
      [
        "PRD-003",
        [
          makeRow({ reference: "PRD-003", color: "Bleu", saleType: "UNIT" }),
          makeRow({ reference: "PRD-003", color: "Rouge", saleType: "UNIT" }),
        ],
      ],
    ]);
    const overrides: Record<string, ImportOverride> = {
      "PRD-003": {
        variants: {
          0: { color: "Bleu Marine" },
          1: { color: "Bordeaux", saleType: "PACK" },
        },
      },
    };
    applyOverrides(grouped, overrides);
    const rows = grouped.get("PRD-003")!;
    expect(rows[0].color).toBe("Bleu Marine");
    expect(rows[1].color).toBe("Bordeaux");
    expect(rows[1].saleType).toBe("PACK");
  });

  it("ignore silencieusement une référence absente du groupe", () => {
    const grouped = new Map<string, ProductImportRow[]>([
      ["PRD-001", [makeRow({ reference: "PRD-001", name: "Original" })]],
    ]);
    const overrides: Record<string, ImportOverride> = {
      "INEXISTANT": { name: "Ne devrait pas s'appliquer" },
    };
    applyOverrides(grouped, overrides);
    expect(grouped.get("PRD-001")![0].name).toBe("Original");
  });

  it("ignore un index de variante hors limite", () => {
    const grouped = new Map<string, ProductImportRow[]>([
      ["PRD-001", [makeRow({ reference: "PRD-001", color: "Bleu" })]],
    ]);
    const overrides: Record<string, ImportOverride> = {
      "PRD-001": { variants: { 5: { color: "Rouge" } } },
    };
    expect(() => applyOverrides(grouped, overrides)).not.toThrow();
    expect(grouped.get("PRD-001")![0].color).toBe("Bleu");
  });

  it("écrase la valeur quand l'override vaut une chaîne vide", () => {
    // L'admin a volontairement vidé un champ — l'override doit l'enregistrer.
    const grouped = new Map<string, ProductImportRow[]>([
      ["PRD-001", [makeRow({ reference: "PRD-001", description: "Ancien" })]],
    ]);
    const overrides: Record<string, ImportOverride> = {
      "PRD-001": { description: "" },
    };
    applyOverrides(grouped, overrides);
    expect(grouped.get("PRD-001")![0].description).toBe("");
  });

  it("conserve la valeur d'origine quand l'override ne mentionne pas le champ", () => {
    const grouped = new Map<string, ProductImportRow[]>([
      ["PRD-001", [makeRow({ reference: "PRD-001", name: "Original", category: "Bijoux" })]],
    ]);
    const overrides: Record<string, ImportOverride> = {
      "PRD-001": { description: "Nouvelle desc" }, // ne touche pas à name/category
    };
    applyOverrides(grouped, overrides);
    const row = grouped.get("PRD-001")![0];
    expect(row.name).toBe("Original");
    expect(row.category).toBe("Bijoux");
    expect(row.description).toBe("Nouvelle desc");
  });

  it("matche les références en majuscules", () => {
    // Les groupes sont indexés par référence en MAJUSCULES (cf. processProductImport).
    // L'override doit utiliser la même clé.
    const grouped = new Map<string, ProductImportRow[]>([
      ["PRD-001", [makeRow({ reference: "PRD-001", name: "Original" })]],
    ]);
    const overrides: Record<string, ImportOverride> = {
      "prd-001": { name: "Modifié" },
    };
    applyOverrides(grouped, overrides);
    // L'override "prd-001" est uppercased dans la fonction → matche "PRD-001"
    expect(grouped.get("PRD-001")![0].name).toBe("Modifié");
  });
});
