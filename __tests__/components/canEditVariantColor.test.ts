import { describe, it, expect } from "vitest";
import { canEditVariantColor, type VariantState } from "@/components/admin/products/ColorVariantManager";

function makeVariant(overrides: Partial<VariantState> = {}): VariantState {
  return {
    tempId: "t1",
    colorId: "color-red",
    colorName: "Rouge",
    colorHex: "#FF0000",
    sizeEntries: [],
    unitPrice: "10",
    weight: "1",
    stock: "5",
    isPrimary: false,
    saleType: "UNIT",
    packQuantity: "",
    packLines: [],
    sku: "",
    disabled: false,
    ...overrides,
  };
}

describe("canEditVariantColor", () => {
  it("autorise toujours l'édition pour une variante nouvelle (sans dbId)", () => {
    const v = makeVariant({ dbId: undefined });
    expect(canEditVariantColor(v, false)).toBe(true);
    expect(canEditVariantColor(v, true)).toBe(true);
  });

  it("verrouille par défaut une variante existante (dbId présent)", () => {
    const v = makeVariant({ dbId: "pc1" });
    expect(canEditVariantColor(v, false)).toBe(false);
  });

  it("déverrouille la couleur d'une variante UNIT existante quand allowColorEdit=true", () => {
    const v = makeVariant({ dbId: "pc1", saleType: "UNIT" });
    expect(canEditVariantColor(v, true)).toBe(true);
  });

  it("garde verrouillée une variante PACK existante même avec allowColorEdit=true", () => {
    const v = makeVariant({ dbId: "pc1", saleType: "PACK", packQuantity: "12" });
    expect(canEditVariantColor(v, true)).toBe(false);
  });

  it("garde verrouillée une variante PACK multi-couleurs (packLines présentes)", () => {
    const v = makeVariant({
      dbId: "pc1",
      saleType: "PACK",
      packQuantity: "12",
      packLines: [
        { tempId: "pl1", colorId: "c1", colorName: "A", colorHex: "#111", sizeEntries: [] },
        { tempId: "pl2", colorId: "c2", colorName: "B", colorHex: "#222", sizeEntries: [] },
      ],
    });
    expect(canEditVariantColor(v, true)).toBe(false);
  });
});
