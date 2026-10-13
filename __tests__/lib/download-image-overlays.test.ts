import { describe, it, expect } from "vitest";
import {
  formatPriceEuros,
  mimeTypeFor,
  extensionFor,
} from "@/lib/download-image-overlays";

describe("formatPriceEuros", () => {
  it("formate un prix entier avec deux décimales et le symbole euro", () => {
    expect(formatPriceEuros(12)).toBe("12,00 €");
  });

  it("formate un prix décimal avec virgule française", () => {
    expect(formatPriceEuros(12.34)).toBe("12,34 €");
  });

  it("arrondit à 2 décimales (toFixed)", () => {
    expect(formatPriceEuros(12.345)).toBe("12,35 €");
  });

  it("insère un séparateur de milliers (espace fine)", () => {
    expect(formatPriceEuros(1234.5)).toBe("1 234,50 €");
    expect(formatPriceEuros(123456.78)).toBe("123 456,78 €");
  });

  it("rend 0 sans crasher", () => {
    expect(formatPriceEuros(0)).toBe("0,00 €");
  });

  it("coerce les valeurs négatives ou invalides à 0", () => {
    expect(formatPriceEuros(-5)).toBe("0,00 €");
    expect(formatPriceEuros(Number.NaN)).toBe("0,00 €");
    expect(formatPriceEuros(Number.POSITIVE_INFINITY)).toBe("0,00 €");
  });
});

describe("mimeTypeFor / extensionFor", () => {
  it("mappe chaque format à son type MIME", () => {
    expect(mimeTypeFor("webp")).toBe("image/webp");
    expect(mimeTypeFor("png")).toBe("image/png");
    expect(mimeTypeFor("jpeg")).toBe("image/jpeg");
  });

  it("mappe JPEG à l'extension .jpg (par convention)", () => {
    expect(extensionFor("webp")).toBe("webp");
    expect(extensionFor("png")).toBe("png");
    expect(extensionFor("jpeg")).toBe("jpg");
  });
});
