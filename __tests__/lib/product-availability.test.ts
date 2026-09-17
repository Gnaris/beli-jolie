/**
 * Tests pour lib/product-availability.ts
 *
 * Règle métier : un produit ne peut être mis en ligne que si au moins une
 * variante est disponible (stock > 0 ET non désactivée). Le comportement
 * inverse — retirer automatiquement un produit ONLINE dont toutes les
 * variantes deviennent OOS/désactivées — n'est PAS souhaité (la cliente
 * veut garder la main).
 */
import { describe, it, expect } from "vitest";
import { hasAvailableVariant } from "@/lib/product-availability";

describe("hasAvailableVariant", () => {
  it("retourne false quand la liste est vide", () => {
    expect(hasAvailableVariant([])).toBe(false);
  });

  it("retourne false quand toutes les variantes sont à stock 0", () => {
    expect(
      hasAvailableVariant([
        { stock: 0, disabled: false },
        { stock: 0, disabled: false },
      ]),
    ).toBe(false);
  });

  it("retourne false quand toutes les variantes sont désactivées", () => {
    expect(
      hasAvailableVariant([
        { stock: 10, disabled: true },
        { stock: 5, disabled: true },
      ]),
    ).toBe(false);
  });

  it("retourne false pour un mélange stock=0 et disabled=true", () => {
    expect(
      hasAvailableVariant([
        { stock: 0, disabled: false },
        { stock: 20, disabled: true },
      ]),
    ).toBe(false);
  });

  it("retourne false quand stock est null", () => {
    expect(
      hasAvailableVariant([{ stock: null, disabled: false }]),
    ).toBe(false);
  });

  it("retourne true dès qu'une variante a stock > 0 et n'est pas désactivée", () => {
    expect(
      hasAvailableVariant([
        { stock: 0, disabled: false },
        { stock: 3, disabled: false },
        { stock: 0, disabled: true },
      ]),
    ).toBe(true);
  });

  it("considère disabled absent comme non désactivé", () => {
    expect(hasAvailableVariant([{ stock: 1 }])).toBe(true);
  });
});
