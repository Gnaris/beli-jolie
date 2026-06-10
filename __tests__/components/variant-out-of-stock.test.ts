import { describe, it, expect } from "vitest";
import { isVariantOutOfStock } from "@/components/admin/products/ColorVariantManager";

describe("isVariantOutOfStock", () => {
  it("retourne true quand stock = '0'", () => {
    expect(isVariantOutOfStock({ stock: "0" })).toBe(true);
  });

  it("retourne true quand stock = ' 0 ' (espaces)", () => {
    expect(isVariantOutOfStock({ stock: " 0 " })).toBe(true);
  });

  it("retourne false quand stock est vide (variante en cours de création)", () => {
    expect(isVariantOutOfStock({ stock: "" })).toBe(false);
  });

  it("retourne false quand stock est uniquement des espaces", () => {
    expect(isVariantOutOfStock({ stock: "   " })).toBe(false);
  });

  it("retourne false quand stock > 0", () => {
    expect(isVariantOutOfStock({ stock: "1" })).toBe(false);
    expect(isVariantOutOfStock({ stock: "42" })).toBe(false);
  });
});
