import { describe, it, expect } from "vitest";
import {
  parsePfsDeactivateVariant,
  parsePfsOutOfStockProductAction,
  PFS_OUT_OF_STOCK_DEFAULTS,
} from "@/lib/pfs-out-of-stock-config";

describe("parsePfsDeactivateVariant", () => {
  it('accepte "true" → true', () => {
    expect(parsePfsDeactivateVariant("true")).toBe(true);
  });

  it('accepte "false" → false', () => {
    expect(parsePfsDeactivateVariant("false")).toBe(false);
  });

  it("null/undefined/valeur inconnue → défaut (true)", () => {
    expect(parsePfsDeactivateVariant(null)).toBe(true);
    expect(parsePfsDeactivateVariant(undefined)).toBe(true);
    expect(parsePfsDeactivateVariant("nope")).toBe(true);
  });
});

describe("parsePfsOutOfStockProductAction", () => {
  it("accepte les 3 valeurs valides", () => {
    expect(parsePfsOutOfStockProductAction("archived")).toBe("archived");
    expect(parsePfsOutOfStockProductAction("deleted")).toBe("deleted");
    expect(parsePfsOutOfStockProductAction("draft")).toBe("draft");
  });

  it("null/undefined/valeur inconnue → défaut (archived)", () => {
    expect(parsePfsOutOfStockProductAction(null)).toBe("archived");
    expect(parsePfsOutOfStockProductAction(undefined)).toBe("archived");
    expect(parsePfsOutOfStockProductAction("online")).toBe("archived");
    expect(parsePfsOutOfStockProductAction("")).toBe("archived");
  });
});

describe("PFS_OUT_OF_STOCK_DEFAULTS", () => {
  it("garde le contrat par défaut (désactive variante + archive produit)", () => {
    expect(PFS_OUT_OF_STOCK_DEFAULTS).toEqual({
      deactivateVariant: true,
      productAction: "archived",
    });
  });
});
