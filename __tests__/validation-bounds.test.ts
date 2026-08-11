/**
 * Garde-fous bornes numériques (AUDIT 2026-05-29 — point [7]).
 *
 * Sans ces vérifications, le formulaire produit acceptait sans broncher :
 * prix négatif, stock négatif, remise > 100 %, poids négatif.
 */
import { describe, it, expect } from "vitest";
import {
  validateVariantBounds,
  validateProductFields,
  type ColorInput,
} from "@/lib/product-variant-validation";
import { validatePromotionInput } from "@/lib/promotion-validation";

const baseColor = (overrides: Partial<ColorInput> = {}): ColorInput => ({
  colorId: "color-1",
  unitPrice: 10,
  weight: 0.2,
  stock: 5,
  isPrimary: true,
  saleType: "UNIT",
  packQuantity: null,
  sizeEntries: [{ sizeId: "size-1", quantity: 1 }],
  ...overrides,
});

describe("validateProductFields — remise produit (discountPercent)", () => {
  it("accepte null (pas de remise)", () => {
    expect(() => validateProductFields({ discountPercent: null })).not.toThrow();
  });

  it("accepte 0 et 100", () => {
    expect(() => validateProductFields({ discountPercent: 0 })).not.toThrow();
    expect(() => validateProductFields({ discountPercent: 100 })).not.toThrow();
  });

  it("refuse une remise négative", () => {
    expect(() => validateProductFields({ discountPercent: -10 })).toThrow(
      /entre 0 et 100/,
    );
  });

  it("refuse une remise > 100 % (le bug du tiret collé devant 150)", () => {
    expect(() => validateProductFields({ discountPercent: 150 })).toThrow(
      /entre 0 et 100/,
    );
  });

  it("refuse NaN / Infinity", () => {
    expect(() => validateProductFields({ discountPercent: NaN })).toThrow();
    expect(() => validateProductFields({ discountPercent: Infinity })).toThrow();
  });
});

describe("validateVariantBounds — prix / stock / poids", () => {
  it("accepte un cas normal", () => {
    expect(() => validateVariantBounds([baseColor()])).not.toThrow();
  });

  it("refuse un prix négatif", () => {
    expect(() => validateVariantBounds([baseColor({ unitPrice: -50 })])).toThrow(
      /prix.*négatif/i,
    );
  });

  it("refuse un poids négatif", () => {
    expect(() => validateVariantBounds([baseColor({ weight: -0.5 })])).toThrow(
      /poids.*négatif/i,
    );
  });

  it("refuse un stock négatif", () => {
    expect(() => validateVariantBounds([baseColor({ stock: -10 })])).toThrow(
      /stock.*négatif/i,
    );
  });

  it("refuse un stock non entier (3.5 articles)", () => {
    expect(() => validateVariantBounds([baseColor({ stock: 3.5 })])).toThrow(
      /entier/i,
    );
  });

  it("refuse une quantité de taille négative", () => {
    expect(() =>
      validateVariantBounds([
        baseColor({ sizeEntries: [{ sizeId: "s", quantity: -2 }] }),
      ]),
    ).toThrow(/quantité.*négatif/i);
  });

  it("refuse un prix par unité négatif", () => {
    expect(() =>
      validateVariantBounds([
        baseColor({
          sizeEntries: [{ sizeId: "s", quantity: 1, pricePerUnit: -1 }],
        }),
      ]),
    ).toThrow(/prix par unité.*négatif/i);
  });

  it("refuse une quantité négative dans une ligne de pack multi-couleurs", () => {
    expect(() =>
      validateVariantBounds([
        baseColor({
          saleType: "PACK",
          packQuantity: 12,
          packLines: [
            {
              colorId: "c-1",
              sizeEntries: [{ sizeId: "s-1", quantity: -3 }],
            },
          ],
        }),
      ]),
    ).toThrow(/négatif/i);
  });
});

describe("validatePromotionInput — bornes promotions", () => {
  it("accepte une remise PERCENTAGE valide", () => {
    expect(
      validatePromotionInput({
        discountKind: "PERCENTAGE",
        discountValue: 10,
      }),
    ).toBeNull();
  });

  it("refuse une remise négative", () => {
    expect(
      validatePromotionInput({
        discountKind: "PERCENTAGE",
        discountValue: -5,
      }),
    ).toMatch(/négative/i);
  });

  it("refuse une remise PERCENTAGE > 100 %", () => {
    expect(
      validatePromotionInput({
        discountKind: "PERCENTAGE",
        discountValue: 150,
      }),
    ).toMatch(/100/);
  });

  it("refuse une remise FIXED_AMOUNT = 0 (pas une remise)", () => {
    expect(
      validatePromotionInput({
        discountKind: "FIXED_AMOUNT",
        discountValue: 0,
      }),
    ).toMatch(/supérieure à 0/i);
  });

  it("refuse une remise PERCENTAGE = 0 (livraison offerte se fait via scope=SHIPPING + 100 %)", () => {
    expect(
      validatePromotionInput({
        discountKind: "PERCENTAGE",
        discountValue: 0,
      }),
    ).toMatch(/supérieure à 0/i);
  });

  it("refuse un montant minimum négatif", () => {
    expect(
      validatePromotionInput({
        discountKind: "FIXED_AMOUNT",
        discountValue: 5,
        minOrderAmount: -10,
      }),
    ).toMatch(/minimum.*négatif/i);
  });

  it("refuse un nombre max d'utilisations <= 0", () => {
    expect(
      validatePromotionInput({
        discountKind: "FIXED_AMOUNT",
        discountValue: 5,
        maxUses: 0,
      }),
    ).toMatch(/utilisations.*≥ 1/);
  });
});
