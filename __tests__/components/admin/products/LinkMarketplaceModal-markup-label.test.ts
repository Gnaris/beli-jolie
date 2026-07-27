import { describe, it, expect } from "vitest";
import { shortMarkupLabel } from "@/components/admin/products/LinkMarketplaceModal";

describe("shortMarkupLabel (libellé de majoration dans les cartes du modal)", () => {
  it("dit 'sans majoration' quand la valeur est 0", () => {
    expect(shortMarkupLabel({ type: "percent", value: 0, rounding: "none" })).toBe(
      "sans majoration",
    );
    expect(shortMarkupLabel({ type: "fixed", value: 0, rounding: "up" })).toBe(
      "sans majoration",
    );
  });

  it("formate le pourcentage avec le signe + et l'unité", () => {
    expect(shortMarkupLabel({ type: "percent", value: 30, rounding: "up" })).toBe(
      "+30 % Majoration",
    );
    expect(shortMarkupLabel({ type: "percent", value: 12.5, rounding: "none" })).toBe(
      "+12.5 % Majoration",
    );
  });

  it("formate le fixe en euros avec la locale française (virgule décimale)", () => {
    const label = shortMarkupLabel({ type: "fixed", value: 5, rounding: "none" });
    expect(label).toContain("Majoration");
    // "5,00 €" en fr-FR (l'espace est un NBSP, on ne teste pas la chaîne exacte)
    expect(label).toMatch(/\+ 5,00/);
  });

  it("formate le multiplicateur avec le signe × et virgule décimale française", () => {
    expect(shortMarkupLabel({ type: "multiplier", value: 1.4, rounding: "up" })).toBe(
      "× 1,4 Majoration",
    );
    expect(shortMarkupLabel({ type: "multiplier", value: 2, rounding: "none" })).toBe(
      "× 2 Majoration",
    );
  });
});
