import { describe, it, expect } from "vitest";
import { translateSizeName } from "@/lib/size-i18n";

describe("translateSizeName", () => {
  it("traduit « Taille unique » vers le libellé fourni", () => {
    expect(translateSizeName("Taille unique", "One size")).toBe("One size");
  });

  it("traduit « TU » vers le libellé fourni", () => {
    expect(translateSizeName("TU", "One size")).toBe("One size");
  });

  it("traduit « one size » (peu importe la casse) vers le libellé fourni", () => {
    expect(translateSizeName("one size", "Taille unique")).toBe("Taille unique");
    expect(translateSizeName("One Size", "Taille unique")).toBe("Taille unique");
    expect(translateSizeName("ONE SIZE", "Taille unique")).toBe("Taille unique");
  });

  it("gère les espaces autour", () => {
    expect(translateSizeName("  Taille unique  ", "One size")).toBe("One size");
    expect(translateSizeName(" TU ", "One size")).toBe("One size");
  });

  it("laisse les tailles alphanumériques intactes", () => {
    expect(translateSizeName("S", "One size")).toBe("S");
    expect(translateSizeName("M", "One size")).toBe("M");
    expect(translateSizeName("42", "One size")).toBe("42");
    expect(translateSizeName("T38", "One size")).toBe("T38");
  });

  it("laisse les libellés inconnus intacts (trim uniquement)", () => {
    expect(translateSizeName("  XL  ", "One size")).toBe("XL");
  });
});
