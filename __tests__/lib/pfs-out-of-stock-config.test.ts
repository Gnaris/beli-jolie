import { describe, it, expect } from "vitest";
import {
  parsePfsDeactivateVariant,
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

describe("PFS_OUT_OF_STOCK_DEFAULTS", () => {
  it("garde le contrat par défaut (désactive variante quand stock=0)", () => {
    expect(PFS_OUT_OF_STOCK_DEFAULTS).toEqual({ deactivateVariant: true });
  });
});
