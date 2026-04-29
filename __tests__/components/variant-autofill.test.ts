import { describe, it, expect } from "vitest";
import {
  findDonorVariant,
  applyDonorAutofill,
  type VariantState,
} from "@/components/admin/products/ColorVariantManager";

/**
 * Auto-remplissage des nouvelles variantes : quand l'utilisateur attribue
 * une couleur à une variante encore vierge, on recopie prix / stock / poids
 * (et tailles si même type) depuis une variante existante choisie selon
 * une priorité : même type+couleur > même type > même couleur > la dernière.
 */

let counter = 0;
const fakeUid = () => `uid-${++counter}`;

function makeVariant(overrides: Partial<VariantState>): VariantState {
  return {
    tempId: fakeUid(),
    colorId: "",
    colorName: "",
    colorHex: "#9CA3AF",
    sizeEntries: [],
    unitPrice: "",
    weight: "",
    stock: "",
    isPrimary: false,
    saleType: "UNIT",
    packQuantity: "",
    packLines: [],
    sku: "",
    disabled: false,
    ...overrides,
  };
}

describe("findDonorVariant", () => {
  it("renvoie null quand il n'y a aucune variante remplie", () => {
    const target = makeVariant({ colorId: "rouge" });
    expect(findDonorVariant(target, [target])).toBeNull();
  });

  it("ignore les variantes désactivées", () => {
    const filled = makeVariant({ colorId: "rouge", unitPrice: "10", disabled: true });
    const target = makeVariant({ colorId: "bleu" });
    expect(findDonorVariant(target, [filled, target])).toBeNull();
  });

  it("priorité 1 : même type + même couleur principale", () => {
    const sameTypeOther = makeVariant({ colorId: "vert", saleType: "UNIT", unitPrice: "5" });
    const samePerfect = makeVariant({ colorId: "rouge", saleType: "UNIT", unitPrice: "20" });
    const sameColorOtherType = makeVariant({ colorId: "rouge", saleType: "PACK", unitPrice: "30" });
    const target = makeVariant({ colorId: "rouge", saleType: "UNIT" });
    const donor = findDonorVariant(target, [sameTypeOther, samePerfect, sameColorOtherType, target]);
    expect(donor?.tempId).toBe(samePerfect.tempId);
  });

  it("priorité 2 : même type, couleur différente", () => {
    const otherTypeSameColor = makeVariant({ colorId: "rouge", saleType: "PACK", unitPrice: "30" });
    const sameTypeOtherColor = makeVariant({ colorId: "vert", saleType: "UNIT", unitPrice: "10" });
    const target = makeVariant({ colorId: "rouge", saleType: "UNIT" });
    const donor = findDonorVariant(target, [otherTypeSameColor, sameTypeOtherColor, target]);
    expect(donor?.tempId).toBe(sameTypeOtherColor.tempId);
  });

  it("priorité 3 : même couleur, type différent", () => {
    const otherEverything = makeVariant({ colorId: "vert", saleType: "PACK", unitPrice: "40" });
    const sameColor = makeVariant({ colorId: "rouge", saleType: "PACK", unitPrice: "25" });
    const target = makeVariant({ colorId: "rouge", saleType: "UNIT" });
    const donor = findDonorVariant(target, [otherEverything, sameColor, target]);
    expect(donor?.tempId).toBe(sameColor.tempId);
  });

  it("fallback : dernière variante remplie", () => {
    const a = makeVariant({ colorId: "noir", saleType: "PACK", unitPrice: "5" });
    const b = makeVariant({ colorId: "blanc", saleType: "PACK", unitPrice: "7" });
    const target = makeVariant({ colorId: "rouge", saleType: "UNIT" });
    const donor = findDonorVariant(target, [a, b, target]);
    expect(donor?.tempId).toBe(b.tempId);
  });
});

describe("applyDonorAutofill", () => {
  it("recopie prix / stock / poids / tailles quand le type de vente est identique", () => {
    const donor = makeVariant({
      saleType: "UNIT",
      unitPrice: "12.50",
      stock: "3",
      weight: "0.250",
      sizeEntries: [{ tempId: "old", sizeId: "s1", sizeName: "M", quantity: "1" }],
      packQuantity: "",
    });
    const target = makeVariant({ colorId: "rouge", saleType: "UNIT" });
    const filled = applyDonorAutofill(target, donor, fakeUid);
    expect(filled.unitPrice).toBe("12.50");
    expect(filled.stock).toBe("3");
    expect(filled.weight).toBe("0.250");
    expect(filled.sizeEntries).toHaveLength(1);
    expect(filled.sizeEntries[0].sizeId).toBe("s1");
    // tempId doit être régénéré pour éviter les collisions
    expect(filled.sizeEntries[0].tempId).not.toBe("old");
    // Identité de la cible préservée
    expect(filled.tempId).toBe(target.tempId);
    expect(filled.colorId).toBe("rouge");
  });

  it("ne recopie pas les tailles ni packQuantity quand les types diffèrent", () => {
    const donor = makeVariant({
      saleType: "PACK",
      unitPrice: "30",
      stock: "2",
      weight: "1.5",
      sizeEntries: [{ tempId: "x", sizeId: "s1", sizeName: "M", quantity: "10" }],
      packQuantity: "10",
    });
    const target = makeVariant({ colorId: "rouge", saleType: "UNIT" });
    const filled = applyDonorAutofill(target, donor, fakeUid);
    expect(filled.unitPrice).toBe("30");
    expect(filled.stock).toBe("2");
    expect(filled.weight).toBe("1.5");
    expect(filled.sizeEntries).toEqual([]);
    expect(filled.packQuantity).toBe("");
  });
});
