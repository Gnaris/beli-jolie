import { describe, it, expect } from "vitest";
import { minUnitPriceForColor } from "@/components/admin/products/PhotosPanel";
import type { VariantState } from "@/components/admin/products/ColorVariantManager";

function makeUnitVariant(overrides: Partial<VariantState>): VariantState {
  return {
    tempId: Math.random().toString(36).slice(2, 9),
    colorId: "color-noir",
    colorName: "Noir",
    colorHex: "#000000",
    sizeEntries: [],
    unitPrice: "10",
    weight: "",
    stock: "1",
    isPrimary: false,
    saleType: "UNIT",
    packQuantity: "",
    packLines: [],
    sku: "",
    disabled: false,
    ...overrides,
  };
}

describe("minUnitPriceForColor", () => {
  it("renvoie null si aucune variante", () => {
    expect(minUnitPriceForColor("color-noir", [])).toBeNull();
  });

  it("renvoie null si l'ID couleur est vide", () => {
    expect(minUnitPriceForColor("", [makeUnitVariant({})])).toBeNull();
  });

  it("renvoie le prix unitaire pour une seule variante UNIT de la bonne couleur", () => {
    const variants = [makeUnitVariant({ colorId: "color-noir", unitPrice: "12.50" })];
    expect(minUnitPriceForColor("color-noir", variants)).toBe(12.5);
  });

  it("prend le plus bas prix entre plusieurs variantes de la même couleur", () => {
    const variants = [
      makeUnitVariant({ colorId: "color-noir", unitPrice: "15.00" }),
      makeUnitVariant({ colorId: "color-noir", unitPrice: "8.90" }),
      makeUnitVariant({ colorId: "color-noir", unitPrice: "12.00" }),
    ];
    expect(minUnitPriceForColor("color-noir", variants)).toBe(8.9);
  });

  it("ignore les variantes désactivées", () => {
    const variants = [
      makeUnitVariant({ colorId: "color-noir", unitPrice: "5.00", disabled: true }),
      makeUnitVariant({ colorId: "color-noir", unitPrice: "20.00" }),
    ];
    expect(minUnitPriceForColor("color-noir", variants)).toBe(20);
  });

  it("ignore les variantes d'une autre couleur", () => {
    const variants = [
      makeUnitVariant({ colorId: "color-noir", unitPrice: "30.00" }),
      makeUnitVariant({ colorId: "color-blanc", unitPrice: "5.00" }),
    ];
    expect(minUnitPriceForColor("color-noir", variants)).toBe(30);
  });

  it("ignore les prix non parsables ou nuls", () => {
    const variants = [
      makeUnitVariant({ colorId: "color-noir", unitPrice: "" }),
      makeUnitVariant({ colorId: "color-noir", unitPrice: "abc" }),
      makeUnitVariant({ colorId: "color-noir", unitPrice: "0" }),
      makeUnitVariant({ colorId: "color-noir", unitPrice: "9.99" }),
    ];
    expect(minUnitPriceForColor("color-noir", variants)).toBe(9.99);
  });

  it("renvoie null quand aucun prix exploitable", () => {
    const variants = [
      makeUnitVariant({ colorId: "color-noir", unitPrice: "" }),
      makeUnitVariant({ colorId: "color-noir", unitPrice: "0" }),
    ];
    expect(minUnitPriceForColor("color-noir", variants)).toBeNull();
  });

  it("considère les variantes PACK multi-couleurs qui référencent la couleur via packLines", () => {
    const packMulti: VariantState = makeUnitVariant({
      colorId: "",
      saleType: "PACK",
      unitPrice: "4.50",
      packLines: [
        {
          lineId: "l1",
          colorId: "color-noir",
          colorName: "Noir",
          colorHex: "#000000",
          sizeEntries: [{ entryId: "s1", sizeId: "s", sizeName: "TU", quantity: "1" }],
        },
        {
          lineId: "l2",
          colorId: "color-rouge",
          colorName: "Rouge",
          colorHex: "#ff0000",
          sizeEntries: [{ entryId: "s2", sizeId: "s", sizeName: "TU", quantity: "1" }],
        },
      ],
    });
    const unit = makeUnitVariant({ colorId: "color-noir", unitPrice: "20.00" });
    const variants = [packMulti, unit];
    expect(minUnitPriceForColor("color-noir", variants)).toBe(4.5);
  });
});
