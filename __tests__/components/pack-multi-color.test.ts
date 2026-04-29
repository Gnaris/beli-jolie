import { describe, it, expect } from "vitest";
import {
  computeTotalPrice,
  computePackTotalQty,
  computePackLinesTotal,
  packLinesColorList,
  isMultiColorPack,
} from "@/components/admin/products/ColorVariantManager";
import type { VariantState } from "@/components/admin/products/ColorVariantManager";

function variant(overrides: Partial<VariantState> = {}): VariantState {
  return {
    tempId: "v1",
    colorId: "c1",
    colorName: "Rouge",
    colorHex: "#FF0000",
    sizeEntries: [],
    unitPrice: "",
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

describe("Pack multi-couleurs : helpers", () => {
  it("computePackLinesTotal somme toutes les tailles de toutes les couleurs", () => {
    const lines = [
      {
        tempId: "l1",
        colorId: "rouge",
        colorName: "Rouge",
        colorHex: "#f00",
        sizeEntries: [
          { tempId: "s1", sizeId: "S", sizeName: "S", quantity: "2" },
          { tempId: "s2", sizeId: "M", sizeName: "M", quantity: "3" },
        ],
      },
      {
        tempId: "l2",
        colorId: "bleu",
        colorName: "Bleu",
        colorHex: "#00f",
        sizeEntries: [{ tempId: "s3", sizeId: "M", sizeName: "M", quantity: "2" }],
      },
      {
        tempId: "l3",
        colorId: "noir",
        colorName: "Noir",
        colorHex: "#000",
        sizeEntries: [{ tempId: "s4", sizeId: "L", sizeName: "L", quantity: "1" }],
      },
    ];
    expect(computePackLinesTotal(lines)).toBe(8);
  });

  it("packLinesColorList retourne les couleurs distinctes en ordre", () => {
    const lines = [
      { tempId: "a", colorId: "r", colorName: "Rouge", colorHex: "#f00", sizeEntries: [] },
      { tempId: "b", colorId: "b", colorName: "Bleu", colorHex: "#00f", sizeEntries: [] },
    ];
    expect(packLinesColorList(lines).map((c) => c.colorName)).toEqual(["Rouge", "Bleu"]);
  });

  it("isMultiColorPack: true uniquement si PACK + packLines non vide", () => {
    expect(isMultiColorPack(variant({ saleType: "UNIT" }))).toBe(false);
    expect(isMultiColorPack(variant({ saleType: "PACK", packLines: [] }))).toBe(false);
    expect(isMultiColorPack(variant({
      saleType: "PACK",
      packLines: [{ tempId: "x", colorId: "r", colorName: "R", colorHex: "#f00", sizeEntries: [] }],
    }))).toBe(true);
  });

  it("computeTotalPrice multi-couleurs : prix unitaire × somme des tailles", () => {
    const v = variant({
      saleType: "PACK",
      unitPrice: "5", // 5€ pièce
      packLines: [
        {
          tempId: "l1",
          colorId: "r",
          colorName: "Rouge",
          colorHex: "#f00",
          sizeEntries: [
            { tempId: "s1", sizeId: "S", sizeName: "S", quantity: "2" },
            { tempId: "s2", sizeId: "M", sizeName: "M", quantity: "3" },
          ],
        },
        {
          tempId: "l2",
          colorId: "b",
          colorName: "Bleu",
          colorHex: "#00f",
          sizeEntries: [{ tempId: "s3", sizeId: "L", sizeName: "L", quantity: "1" }],
        },
      ],
    });
    // 5 × (2+3+1) = 30
    expect(computeTotalPrice(v)).toBe(30);
  });

  it("computeTotalPrice multi-couleurs renvoie null si une ligne n'a pas de taille", () => {
    const v = variant({
      saleType: "PACK",
      unitPrice: "5",
      packLines: [
        { tempId: "l1", colorId: "r", colorName: "Rouge", colorHex: "#f00", sizeEntries: [] },
      ],
    });
    expect(computeTotalPrice(v)).toBeNull();
  });

  it("computePackTotalQty délègue à computePackLinesTotal pour un pack multi-couleurs", () => {
    const v = variant({
      saleType: "PACK",
      unitPrice: "5",
      packLines: [
        {
          tempId: "l1",
          colorId: "r",
          colorName: "Rouge",
          colorHex: "#f00",
          sizeEntries: [{ tempId: "s1", sizeId: "S", sizeName: "S", quantity: "4" }],
        },
        {
          tempId: "l2",
          colorId: "b",
          colorName: "Bleu",
          colorHex: "#00f",
          sizeEntries: [{ tempId: "s2", sizeId: "M", sizeName: "M", quantity: "2" }],
        },
      ],
    });
    expect(computePackTotalQty(v)).toBe(6);
  });

  it("PACK mono-couleur legacy reste sur sizeEntries (pas de regression)", () => {
    const v = variant({
      saleType: "PACK",
      unitPrice: "10",
      sizeEntries: [
        { tempId: "s1", sizeId: "S", sizeName: "S", quantity: "3" },
        { tempId: "s2", sizeId: "M", sizeName: "M", quantity: "2" },
      ],
      packLines: [],
    });
    expect(isMultiColorPack(v)).toBe(false);
    // 10 × (3+2) = 50
    expect(computeTotalPrice(v)).toBe(50);
    expect(computePackTotalQty(v)).toBe(5);
  });
});
