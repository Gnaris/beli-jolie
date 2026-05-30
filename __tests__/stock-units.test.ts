import { describe, it, expect } from "vitest";
import { stockUnitsForOrderItem, stockUnitsForCartLine } from "@/lib/stock-units";

describe("stockUnitsForOrderItem", () => {
  it("UNIT : retourne la quantité telle quelle", () => {
    const snap = JSON.stringify({ saleType: "UNIT", packQuantity: null });
    expect(stockUnitsForOrderItem({ quantity: 3, variantSnapshot: snap })).toBe(3);
  });

  it("PACK : multiplie par packQuantity (qté 1 × 12 = 12)", () => {
    const snap = JSON.stringify({ saleType: "PACK", packQuantity: 12 });
    expect(stockUnitsForOrderItem({ quantity: 1, variantSnapshot: snap })).toBe(12);
  });

  it("PACK : 3 paquets de 12 = 36 unités physiques", () => {
    const snap = JSON.stringify({ saleType: "PACK", packQuantity: 12 });
    expect(stockUnitsForOrderItem({ quantity: 3, variantSnapshot: snap })).toBe(36);
  });

  it("PACK avec packQuantity manquant : retombe sur UNIT (safe)", () => {
    const snap = JSON.stringify({ saleType: "PACK", packQuantity: null });
    expect(stockUnitsForOrderItem({ quantity: 2, variantSnapshot: snap })).toBe(2);
  });

  it("PACK avec packQuantity = 0 : retombe sur UNIT (safe)", () => {
    const snap = JSON.stringify({ saleType: "PACK", packQuantity: 0 });
    expect(stockUnitsForOrderItem({ quantity: 5, variantSnapshot: snap })).toBe(5);
  });

  it("variantSnapshot null : retombe sur UNIT", () => {
    expect(stockUnitsForOrderItem({ quantity: 2, variantSnapshot: null })).toBe(2);
  });

  it("variantSnapshot illisible : retombe sur UNIT (ne throw pas)", () => {
    expect(
      stockUnitsForOrderItem({ quantity: 4, variantSnapshot: "{not-json" }),
    ).toBe(4);
  });
});

describe("stockUnitsForCartLine", () => {
  it("UNIT : retourne la quantité telle quelle", () => {
    expect(
      stockUnitsForCartLine({
        quantity: 2,
        variant: { saleType: "UNIT", packQuantity: null },
      }),
    ).toBe(2);
  });

  it("PACK : multiplie par packQuantity (1 paquet de 12 = 12 unités)", () => {
    expect(
      stockUnitsForCartLine({
        quantity: 1,
        variant: { saleType: "PACK", packQuantity: 12 },
      }),
    ).toBe(12);
  });

  it("PACK : 3 paquets de 8 = 24 unités", () => {
    expect(
      stockUnitsForCartLine({
        quantity: 3,
        variant: { saleType: "PACK", packQuantity: 8 },
      }),
    ).toBe(24);
  });

  it("PACK avec packQuantity null : retombe sur UNIT (safe)", () => {
    expect(
      stockUnitsForCartLine({
        quantity: 2,
        variant: { saleType: "PACK", packQuantity: null },
      }),
    ).toBe(2);
  });
});
