import { describe, it, expect } from "vitest";
import { sortVariantsByColorFirstSeen } from "@/components/admin/products/ColorVariantManager";
import type { VariantState } from "@/components/admin/products/ColorVariantManager";

function variant(overrides: Partial<VariantState> = {}): VariantState {
  return {
    tempId: "v-" + Math.random(),
    colorId: "c1",
    colorName: "Rouge",
    colorHex: "#FF0000",
    sizeEntries: [],
    unitPrice: "10",
    weight: "",
    stock: "",
    isPrimary: false,
    saleType: "UNIT",
    packQuantity: "",
    packLines: [],
    sku: "",
    disabled: false,
    ...overrides,
  };
}

describe("sortVariantsByColorFirstSeen", () => {
  it("garde une variante à la même position quand son saleType change UNIT→PACK", () => {
    const v1 = variant({ tempId: "v1", colorId: "c1", saleType: "UNIT" });
    const v2 = variant({ tempId: "v2", colorId: "c2", saleType: "UNIT" });
    const v3 = variant({ tempId: "v3", colorId: "c3", saleType: "UNIT" });
    const initial = sortVariantsByColorFirstSeen([v1, v2, v3]);
    expect(initial.map((v) => v.tempId)).toEqual(["v1", "v2", "v3"]);

    const v2Pack = { ...v2, saleType: "PACK" as const };
    const after = sortVariantsByColorFirstSeen([v1, v2Pack, v3]);
    expect(after.map((v) => v.tempId)).toEqual(["v1", "v2", "v3"]);
  });

  it("garde une variante à la même position quand son saleType change PACK→UNIT", () => {
    const v1 = variant({ tempId: "v1", colorId: "c1", saleType: "UNIT" });
    const v2 = variant({ tempId: "v2", colorId: "c2", saleType: "PACK" });
    const v3 = variant({ tempId: "v3", colorId: "c3", saleType: "PACK" });
    const initial = sortVariantsByColorFirstSeen([v1, v2, v3]);
    expect(initial.map((v) => v.tempId)).toEqual(["v1", "v2", "v3"]);

    const v3Unit = { ...v3, saleType: "UNIT" as const };
    const after = sortVariantsByColorFirstSeen([v1, v2, v3Unit]);
    expect(after.map((v) => v.tempId)).toEqual(["v1", "v2", "v3"]);
  });

  it("regroupe les variantes par couleur dans l'ordre de première apparition", () => {
    const a1 = variant({ tempId: "a1", colorId: "rouge" });
    const b1 = variant({ tempId: "b1", colorId: "bleu" });
    const a2 = variant({ tempId: "a2", colorId: "rouge" });
    const b2 = variant({ tempId: "b2", colorId: "bleu" });
    const sorted = sortVariantsByColorFirstSeen([a1, b1, a2, b2]);
    // a1 (rouge first), a2 (rouge), b1 (bleu first), b2 (bleu)
    expect(sorted.map((v) => v.tempId)).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("préserve l'ordre des variantes de même couleur", () => {
    const a1 = variant({ tempId: "a1", colorId: "rouge" });
    const a2 = variant({ tempId: "a2", colorId: "rouge" });
    const a3 = variant({ tempId: "a3", colorId: "rouge" });
    const sorted = sortVariantsByColorFirstSeen([a1, a2, a3]);
    expect(sorted.map((v) => v.tempId)).toEqual(["a1", "a2", "a3"]);
  });

  it("gère une liste vide", () => {
    expect(sortVariantsByColorFirstSeen([])).toEqual([]);
  });

  it("ne mélange plus Unité/Pack quand on alterne sur la même couleur", () => {
    const v1 = variant({ tempId: "v1", colorId: "rouge", saleType: "UNIT" });
    const v2 = variant({ tempId: "v2", colorId: "rouge", saleType: "PACK" });
    const sorted = sortVariantsByColorFirstSeen([v1, v2]);
    // Avant le fix : [v1 (UNIT), v2 (PACK at end)] — coïncidence
    // Après le fix : même couleur → groupées dans l'ordre passé
    expect(sorted.map((v) => v.tempId)).toEqual(["v1", "v2"]);
  });
});
