import { describe, it, expect } from "vitest";
import { computeUniqueUsedColors } from "@/components/admin/products/ColorVariantManager";
import type { VariantState, PackLineState } from "@/components/admin/products/ColorVariantManager";

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

function packLine(colorId: string, colorName: string, colorHex: string): PackLineState {
  return { tempId: "l-" + colorId, colorId, colorName, colorHex, sizeEntries: [] };
}

describe("computeUniqueUsedColors", () => {
  it("déduplique deux variantes utilisant la même couleur", () => {
    const list = computeUniqueUsedColors([
      variant({ tempId: "a" }),
      variant({ tempId: "b" }),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].colorId).toBe("c1");
  });

  it("préserve l'ordre d'apparition des couleurs", () => {
    const list = computeUniqueUsedColors([
      variant({ colorId: "c2", colorName: "Bleu", colorHex: "#0000FF" }),
      variant({ colorId: "c1", colorName: "Rouge", colorHex: "#FF0000" }),
      variant({ colorId: "c3", colorName: "Vert", colorHex: "#00FF00" }),
    ]);
    expect(list.map((c) => c.colorId)).toEqual(["c2", "c1", "c3"]);
  });

  it("inclut les couleurs présentes uniquement dans un pack multi-couleurs", () => {
    const multiPack = variant({
      colorId: "c1",
      colorName: "Rouge",
      colorHex: "#FF0000",
      saleType: "PACK",
      packLines: [
        packLine("c1", "Rouge", "#FF0000"),
        packLine("c9", "Kaki", "#8B7355"),
      ],
    });
    const list = computeUniqueUsedColors([multiPack]);
    expect(list.map((c) => c.colorId)).toEqual(["c1", "c9"]);
  });

  it("fusionne une couleur présente à la fois dans une variante UNIT et dans un pack", () => {
    const list = computeUniqueUsedColors([
      variant({ colorId: "c1", colorName: "Rouge", colorHex: "#FF0000" }),
      variant({
        colorId: "c9",
        colorName: "Kaki",
        colorHex: "#8B7355",
        saleType: "PACK",
        packLines: [
          packLine("c1", "Rouge", "#FF0000"),
          packLine("c9", "Kaki", "#8B7355"),
        ],
      }),
    ]);
    expect(list.map((c) => c.colorId)).toEqual(["c1", "c9"]);
  });

  it("ignore les variantes sans couleur", () => {
    const list = computeUniqueUsedColors([variant({ colorId: "" })]);
    expect(list).toHaveLength(0);
  });

  it("ignore les pack-lines sans colorId", () => {
    const list = computeUniqueUsedColors([
      variant({
        saleType: "PACK",
        colorId: "c1",
        colorName: "Rouge",
        colorHex: "#FF0000",
        packLines: [
          packLine("c1", "Rouge", "#FF0000"),
          packLine("", "", "#000000"),
        ],
      }),
    ]);
    expect(list.map((c) => c.colorId)).toEqual(["c1"]);
  });
});
