import { describe, it, expect } from "vitest";
import { hexForPfsColor } from "@/lib/marketplace-excel/pfs-color-hex";

describe("hexForPfsColor", () => {
  it("returns the hex for exact PFS color names", () => {
    expect(hexForPfsColor("Noir")).toBe("#000000");
    expect(hexForPfsColor("Blanc")).toBe("#FFFFFF");
    expect(hexForPfsColor("Rouge")).toBe("#E53935");
  });

  it("is case- and diacritics-insensitive", () => {
    expect(hexForPfsColor("NOIR")).toBe("#000000");
    expect(hexForPfsColor("doré")).toBe(hexForPfsColor("Doré"));
    expect(hexForPfsColor("CREME")).toBe(hexForPfsColor("Crème"));
  });

  it("returns null for unknown or abstract PFS values", () => {
    expect(hexForPfsColor("Bicolore")).toBeNull();
    expect(hexForPfsColor("Autre")).toBeNull();
    expect(hexForPfsColor("ANIMALS")).toBeNull();
    expect(hexForPfsColor("")).toBeNull();
    expect(hexForPfsColor(null)).toBeNull();
    expect(hexForPfsColor(undefined)).toBeNull();
  });

  it("resolves compound color variants", () => {
    expect(hexForPfsColor("Bleu Marine")).toBe("#12274D");
    expect(hexForPfsColor("Rose Pâle")).toBe("#F8BBD0");
    expect(hexForPfsColor("Or Rose")).toBe("#E79F9A");
  });
});
