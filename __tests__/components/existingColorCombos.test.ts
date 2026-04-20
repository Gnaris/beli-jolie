import { describe, it, expect } from "vitest";
import { computeExistingColorCombos } from "@/components/admin/products/ColorVariantManager";
import type { VariantState } from "@/components/admin/products/ColorVariantManager";

function variant(overrides: Partial<VariantState> = {}): VariantState {
  return {
    tempId: "v-" + Math.random(),
    colorId: "c1",
    colorName: "Rouge",
    colorHex: "#FF0000",
    subColors: [],
    sizeEntries: [],
    unitPrice: "10",
    weight: "",
    stock: "",
    isPrimary: false,
    saleType: "UNIT",
    packQuantity: "",
    pfsColorRef: "",
    sku: "",
    ...overrides,
  };
}

describe("computeExistingColorCombos", () => {
  it("deduplicates two variants with the same color", () => {
    const combos = computeExistingColorCombos([
      variant({ tempId: "a" }),
      variant({ tempId: "b" }),
    ]);
    expect(combos).toHaveLength(1);
    expect(combos[0].colors[0].colorId).toBe("c1");
  });

  it("lists different colors separately", () => {
    const combos = computeExistingColorCombos([
      variant({ colorId: "c1", colorName: "Rouge", colorHex: "#FF0000" }),
      variant({ colorId: "c2", colorName: "Bleu", colorHex: "#0000FF" }),
    ]);
    expect(combos).toHaveLength(2);
    expect(combos.map((c) => c.colors[0].colorId).sort()).toEqual(["c1", "c2"]);
  });

  it("treats multi-color and single-color as distinct combos", () => {
    const combos = computeExistingColorCombos([
      variant({
        colorId: "c1",
        colorName: "Rouge",
        colorHex: "#FF0000",
        subColors: [{ colorId: "c2", colorName: "Bleu", colorHex: "#0000FF" }],
      }),
      variant({ colorId: "c1", colorName: "Rouge", colorHex: "#FF0000" }),
    ]);
    expect(combos).toHaveLength(2);
  });

  it("preserves pfsColorRef on the entry", () => {
    const combos = computeExistingColorCombos([
      variant({ colorId: "c1", pfsColorRef: "RED-01" }),
    ]);
    expect(combos[0].pfsColorRef).toBe("RED-01");
  });

  it("skips variants without a color", () => {
    const combos = computeExistingColorCombos([
      variant({ colorId: "" }),
    ]);
    expect(combos).toHaveLength(0);
  });
});
