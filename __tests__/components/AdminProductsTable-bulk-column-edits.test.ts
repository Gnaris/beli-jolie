import { describe, it, expect } from "vitest";
import {
  computeBulkPriceEdits,
  computeVariantPackTotalQty,
} from "@/components/admin/products/AdminProductsTable";

// Type minimal pour les tests — reflète ce que consomment les helpers bulk.
type TestVariant = {
  id: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  unitPrice: number;
  variantSizes?: { quantity: number }[];
};

describe("computeBulkPriceEdits — modif rapide toute la colonne Prix HT", () => {
  it("applique la valeur unitaire telle quelle sur les variantes UNIT", () => {
    const variants: TestVariant[] = [
      { id: "v1", saleType: "UNIT", packQuantity: null, unitPrice: 5.5 },
      { id: "v2", saleType: "UNIT", packQuantity: null, unitPrice: 7.2 },
    ];
    const edits = computeBulkPriceEdits(variants, 8.9);
    expect(edits).toEqual([
      { variantId: "v1", newTotal: 8.9, originalPrice: 5.5 },
      { variantId: "v2", newTotal: 8.9, originalPrice: 7.2 },
    ]);
  });

  it("multiplie par la quantité du pack pour les variantes PACK (sans tailles)", () => {
    const variants: TestVariant[] = [
      { id: "p1", saleType: "PACK", packQuantity: 10, unitPrice: 30 },
      { id: "p2", saleType: "PACK", packQuantity: 6, unitPrice: 24 },
    ];
    const edits = computeBulkPriceEdits(variants, 4);
    expect(edits).toEqual([
      { variantId: "p1", newTotal: 40, originalPrice: 30 },
      { variantId: "p2", newTotal: 24, originalPrice: 24 },
    ]);
  });

  it("utilise la somme des tailles quand elles existent (prime sur packQuantity)", () => {
    const variants: TestVariant[] = [
      {
        id: "p3",
        saleType: "PACK",
        packQuantity: 10,
        unitPrice: 0,
        variantSizes: [{ quantity: 3 }, { quantity: 2 }],
      },
    ];
    const edits = computeBulkPriceEdits(variants, 7);
    // packTotalQty = 3+2 = 5 → total = 7 × 5 = 35
    expect(edits[0]).toEqual({ variantId: "p3", newTotal: 35, originalPrice: 0 });
  });

  it("respecte un packQty en attente d'application (édition packQty dirty)", () => {
    const variants: TestVariant[] = [
      { id: "p4", saleType: "PACK", packQuantity: 10, unitPrice: 0 },
    ];
    // packQty déjà édité à 4 mais pas encore validé → doit servir de base
    const edits = computeBulkPriceEdits(variants, 12, { p4: 4 });
    expect(edits[0]).toEqual({ variantId: "p4", newTotal: 48, originalPrice: 0 });
  });

  it("mélange UNIT + PACK dans la même liste sans se tromper", () => {
    const variants: TestVariant[] = [
      { id: "u", saleType: "UNIT", packQuantity: null, unitPrice: 3 },
      { id: "p", saleType: "PACK", packQuantity: 8, unitPrice: 40 },
    ];
    const edits = computeBulkPriceEdits(variants, 5);
    expect(edits).toEqual([
      { variantId: "u", newTotal: 5, originalPrice: 3 },
      { variantId: "p", newTotal: 40, originalPrice: 40 },
    ]);
  });

  it("arrondit le total au centime pour éviter les .0000001", () => {
    const variants: TestVariant[] = [
      { id: "p", saleType: "PACK", packQuantity: 3, unitPrice: 0 },
    ];
    const edits = computeBulkPriceEdits(variants, 1.11);
    // 1.11 × 3 = 3.33 pile → arrondi propre
    expect(edits[0].newTotal).toBe(3.33);
  });

  it("garde 1 comme packTotalQty pour un PACK mal configuré (pas de sizes ni packQty)", () => {
    // packQty = 0 → fallback à 1 pour éviter une division / multiplication par 0
    const total = computeVariantPackTotalQty(
      { saleType: "PACK", packQuantity: 0 },
    );
    expect(total).toBe(1);
  });

  it("garde 1 comme packTotalQty pour un UNIT (le prix unitaire = prix total)", () => {
    const total = computeVariantPackTotalQty(
      { saleType: "UNIT", packQuantity: null },
    );
    expect(total).toBe(1);
  });

  it("renvoie un tableau vide sans variantes", () => {
    expect(computeBulkPriceEdits([], 42)).toEqual([]);
  });
});
