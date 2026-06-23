import { describe, it, expect } from "vitest";
import { validateVariantRow, type ProductImportRow } from "@/lib/import-processor";

/**
 * « Qté pack » est obligatoire pour les variantes PACK depuis juin 2026.
 * Avant ce verrou, une cellule vide retombait silencieusement sur 1
 * (1 pièce par paquet), ce qui a généré une vague de brouillons avec
 * packQuantity = 1 alors que la cliente voulait 12.
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
    size: "M",
    ...overrides,
  };
}

describe("validateVariantRow — Qté pack obligatoire pour PACK", () => {
  it("UNIT : pas de Qté pack requise", () => {
    const errors = validateVariantRow(makeRow({ saleType: "UNIT", packQuantity: undefined }));
    expect(errors.some((e) => /Qté pack/i.test(e))).toBe(false);
  });

  it("PACK + Qté pack vide → erreur", () => {
    const errors = validateVariantRow(makeRow({ saleType: "PACK", size: "Taille unique", packQuantity: undefined }));
    expect(errors).toContain("Qté pack obligatoire pour un PACK (nombre de pièces dans un paquet).");
  });

  it("PACK + Qté pack = 0 → erreur", () => {
    const errors = validateVariantRow(makeRow({ saleType: "PACK", size: "Taille unique", packQuantity: 0 }));
    expect(errors).toContain("Qté pack obligatoire pour un PACK (nombre de pièces dans un paquet).");
  });

  it("PACK + Qté pack négatif → erreur", () => {
    const errors = validateVariantRow(makeRow({ saleType: "PACK", size: "Taille unique", packQuantity: -3 }));
    expect(errors).toContain("Qté pack obligatoire pour un PACK (nombre de pièces dans un paquet).");
  });

  it("PACK + Qté pack = 12 → pas d'erreur Qté pack", () => {
    const errors = validateVariantRow(makeRow({ saleType: "PACK", size: "Taille unique", packQuantity: 12 }));
    expect(errors.some((e) => /Qté pack/i.test(e))).toBe(false);
  });

  it("PACK + Qté pack = 12 + tailles « S:2,M:3,L:7 » → pas d'erreur Qté pack", () => {
    const errors = validateVariantRow(makeRow({ saleType: "PACK", size: "S:2,M:3,L:7", packQuantity: 12 }));
    expect(errors.some((e) => /Qté pack/i.test(e))).toBe(false);
  });
});
