import { describe, it, expect } from "vitest";
import {
  findDonorVariant,
  applyDonorAutofill,
  findLastFilledBasics,
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

/**
 * findLastFilledBasics : utilisé pour pré-remplir prix / stock / poids quand on ajoute
 * une nouvelle variante (bouton "+ Ajouter une variante" ou modale "Création rapide")
 * à un produit qui en a déjà au moins une.
 */
describe("findLastFilledBasics", () => {
  it("renvoie null sur une liste vide", () => {
    expect(findLastFilledBasics([])).toBeNull();
  });

  it("renvoie null si aucune variante n'a de prix / stock / poids", () => {
    const a = makeVariant({ colorId: "rouge" });
    const b = makeVariant({ colorId: "bleu" });
    expect(findLastFilledBasics([a, b])).toBeNull();
  });

  it("renvoie les valeurs de la dernière variante remplie", () => {
    const a = makeVariant({ colorId: "rouge", unitPrice: "10", stock: "5", weight: "0.250" });
    const b = makeVariant({ colorId: "bleu", unitPrice: "12", stock: "3", weight: "0.300" });
    expect(findLastFilledBasics([a, b])).toEqual({
      unitPrice: "12", stock: "3", weight: "0.300", sizeEntries: [], saleType: "UNIT",
    });
  });

  it("retient la dernière variante remplie même si la toute dernière est vide", () => {
    const filled = makeVariant({ colorId: "rouge", unitPrice: "20", stock: "8", weight: "0.5" });
    const empty = makeVariant({ colorId: "bleu" });
    expect(findLastFilledBasics([filled, empty])).toEqual({
      unitPrice: "20", stock: "8", weight: "0.5", sizeEntries: [], saleType: "UNIT",
    });
  });

  it("ignore les variantes désactivées", () => {
    const disabled = makeVariant({ colorId: "rouge", unitPrice: "99", stock: "9", weight: "9", disabled: true });
    const active = makeVariant({ colorId: "bleu", unitPrice: "12", stock: "3", weight: "0.300" });
    expect(findLastFilledBasics([disabled, active])).toEqual({
      unitPrice: "12", stock: "3", weight: "0.300", sizeEntries: [], saleType: "UNIT",
    });
  });

  it("considère qu'une variante avec seulement le stock rempli compte aussi", () => {
    const stockOnly = makeVariant({ colorId: "rouge", stock: "4" });
    expect(findLastFilledBasics([stockOnly])).toEqual({
      unitPrice: "", stock: "4", weight: "", sizeEntries: [], saleType: "UNIT",
    });
  });

  it("renvoie aussi les tailles et le saleType du donneur (pour recopier la taille)", () => {
    const filled = makeVariant({
      colorId: "rouge",
      unitPrice: "12",
      stock: "3",
      weight: "0.300",
      saleType: "UNIT",
      sizeEntries: [{ tempId: "s-orig", sizeId: "size-m", sizeName: "M", quantity: "1" }],
    });
    const basics = findLastFilledBasics([filled]);
    expect(basics?.saleType).toBe("UNIT");
    expect(basics?.sizeEntries).toEqual([
      { tempId: "s-orig", sizeId: "size-m", sizeName: "M", quantity: "1" },
    ]);
  });

  it("expose le saleType PACK d'un donneur PACK (le caller décide s'il recopie)", () => {
    const pack = makeVariant({
      colorId: "rouge",
      unitPrice: "30",
      stock: "5",
      weight: "1.0",
      saleType: "PACK",
      packQuantity: "10",
      sizeEntries: [{ tempId: "s-pack", sizeId: "size-tu", sizeName: "TU", quantity: "10" }],
    });
    const basics = findLastFilledBasics([pack]);
    expect(basics?.saleType).toBe("PACK");
    expect(basics?.sizeEntries).toHaveLength(1);
  });
});
