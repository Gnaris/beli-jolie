/**
 * Édition en masse en direct des variantes (prix / poids / stock / taille).
 *
 * Couvre les helpers purs `applyBulkFieldToVariants` et `applyBulkSizeToVariants`
 * extraits du composant `ColorVariantManager`. La logique UI (debounce, focus,
 * etc.) n'est pas testée ici — seule la transformation des données.
 */
import { describe, it, expect } from "vitest";
import {
  applyBulkFieldToVariants,
  applyBulkSizeToVariants,
  type VariantState,
} from "@/components/admin/products/ColorVariantManager";

function makeVariant(overrides: Partial<VariantState> & { tempId: string }): VariantState {
  return {
    tempId: overrides.tempId,
    colorId: "c1",
    colorName: "Doré",
    colorHex: "#FFD700",
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

let counter = 0;
const stableId = () => `id-${++counter}`;

describe("applyBulkFieldToVariants", () => {
  it("applique la nouvelle valeur de prix uniquement aux variantes sélectionnées", () => {
    const variants = [
      makeVariant({ tempId: "a", unitPrice: "5" }),
      makeVariant({ tempId: "b", unitPrice: "5" }),
      makeVariant({ tempId: "c", unitPrice: "5" }),
    ];
    const selected = new Set(["a", "c"]);

    const next = applyBulkFieldToVariants(variants, selected, "unitPrice", "12.50");

    expect(next[0].unitPrice).toBe("12.50");
    expect(next[1].unitPrice).toBe("5"); // non sélectionnée → intacte
    expect(next[2].unitPrice).toBe("12.50");
  });

  it("applique stock et poids indépendamment", () => {
    const variants = [
      makeVariant({ tempId: "a", stock: "1", weight: "0.1" }),
      makeVariant({ tempId: "b", stock: "2", weight: "0.2" }),
    ];
    const selected = new Set(["a", "b"]);

    const afterStock = applyBulkFieldToVariants(variants, selected, "stock", "10");
    expect(afterStock.map((v) => v.stock)).toEqual(["10", "10"]);
    expect(afterStock.map((v) => v.weight)).toEqual(["0.1", "0.2"]);

    const afterWeight = applyBulkFieldToVariants(afterStock, selected, "weight", "0.5");
    expect(afterWeight.map((v) => v.weight)).toEqual(["0.5", "0.5"]);
    expect(afterWeight.map((v) => v.stock)).toEqual(["10", "10"]);
  });

  it("ne touche à rien quand la valeur est vide (l'utilisateur efface le champ)", () => {
    const variants = [
      makeVariant({ tempId: "a", unitPrice: "5" }),
      makeVariant({ tempId: "b", unitPrice: "7" }),
    ];
    const selected = new Set(["a", "b"]);

    const next = applyBulkFieldToVariants(variants, selected, "unitPrice", "");

    expect(next).toBe(variants); // même référence → l'appelant n'appellera pas onChange
    expect(next.map((v) => v.unitPrice)).toEqual(["5", "7"]);
  });

  it("applique à toutes les variantes quand la sélection est vide", () => {
    const variants = [
      makeVariant({ tempId: "a", unitPrice: "5" }),
      makeVariant({ tempId: "b", unitPrice: "7" }),
    ];
    const next = applyBulkFieldToVariants(variants, new Set(), "unitPrice", "99");
    expect(next.map((v) => v.unitPrice)).toEqual(["99", "99"]);
  });

  it("préserve les autres champs de la variante modifiée", () => {
    const variants = [
      makeVariant({
        tempId: "a",
        colorName: "Argenté",
        sku: "SKU-A",
        disabled: true,
        unitPrice: "5",
      }),
    ];
    const next = applyBulkFieldToVariants(variants, new Set(["a"]), "unitPrice", "20");
    expect(next[0]).toMatchObject({
      tempId: "a",
      colorName: "Argenté",
      sku: "SKU-A",
      disabled: true,
      unitPrice: "20",
    });
  });
});

describe("applyBulkSizeToVariants", () => {
  const size = { id: "s-tu", name: "TU" };

  it("assigne la taille aux nouvelles variantes UNIT sélectionnées", () => {
    const variants = [
      makeVariant({ tempId: "a" }), // neuve, UNIT
      makeVariant({ tempId: "b" }), // neuve, UNIT (non cochée)
    ];
    const next = applyBulkSizeToVariants(variants, new Set(["a"]), size, stableId);
    expect(next[0].sizeEntries).toEqual([
      { tempId: expect.any(String), sizeId: "s-tu", sizeName: "TU", quantity: "1" },
    ]);
    expect(next[1].sizeEntries).toEqual([]); // non cochée → intacte
  });

  it("assigne à toutes les nouvelles variantes UNIT quand la sélection est vide", () => {
    const variants = [
      makeVariant({ tempId: "a" }),
      makeVariant({ tempId: "b" }),
    ];
    const next = applyBulkSizeToVariants(variants, new Set(), size, stableId);
    expect(next[0].sizeEntries[0]).toMatchObject({ sizeId: "s-tu", sizeName: "TU" });
    expect(next[1].sizeEntries[0]).toMatchObject({ sizeId: "s-tu", sizeName: "TU" });
  });

  it("ignore les variantes déjà enregistrées (dbId présent)", () => {
    const variants = [
      makeVariant({ tempId: "a", dbId: "db-1", sizeEntries: [{ tempId: "t1", sizeId: "s-m", sizeName: "M", quantity: "3" }] }),
      makeVariant({ tempId: "b" }), // neuve
    ];
    const next = applyBulkSizeToVariants(variants, new Set(["a", "b"]), size, stableId);
    expect(next[0].sizeEntries).toEqual([{ tempId: "t1", sizeId: "s-m", sizeName: "M", quantity: "3" }]);
    expect(next[1].sizeEntries[0]).toMatchObject({ sizeId: "s-tu", sizeName: "TU" });
  });

  it("ignore les variantes PACK mono-couleur", () => {
    const variants = [
      makeVariant({ tempId: "a", saleType: "PACK", packQuantity: "5", sizeEntries: [{ tempId: "t1", sizeId: "s-m", sizeName: "M", quantity: "5" }] }),
      makeVariant({ tempId: "b" }),
    ];
    const next = applyBulkSizeToVariants(variants, new Set(["a", "b"]), size, stableId);
    expect(next[0].sizeEntries).toEqual([{ tempId: "t1", sizeId: "s-m", sizeName: "M", quantity: "5" }]);
    expect(next[1].sizeEntries[0]).toMatchObject({ sizeId: "s-tu", sizeName: "TU" });
  });

  it("ignore les variantes PACK multi-couleurs (packLines non vide)", () => {
    const variants = [
      makeVariant({
        tempId: "a",
        saleType: "PACK",
        packLines: [{ tempId: "pl1", colorId: "c1", colorName: "Doré", colorHex: "#FFD700", sizeEntries: [{ tempId: "t1", sizeId: "s-m", sizeName: "M", quantity: "2" }] }],
        sizeEntries: [],
      }),
    ];
    const next = applyBulkSizeToVariants(variants, new Set(["a"]), size, stableId);
    expect(next).toBe(variants); // aucune candidate → référence inchangée
  });

  it("conserve la quantité existante quand elle est déjà saisie", () => {
    const variants = [
      makeVariant({ tempId: "a", sizeEntries: [{ tempId: "t1", sizeId: "s-m", sizeName: "M", quantity: "7" }] }),
    ];
    const next = applyBulkSizeToVariants(variants, new Set(["a"]), size, stableId);
    expect(next[0].sizeEntries).toEqual([
      { tempId: "t1", sizeId: "s-tu", sizeName: "TU", quantity: "7" },
    ]);
  });

  it("renvoie la liste d'origine quand size est null ou id vide", () => {
    const variants = [makeVariant({ tempId: "a" })];
    expect(applyBulkSizeToVariants(variants, new Set(["a"]), null, stableId)).toBe(variants);
    expect(applyBulkSizeToVariants(variants, new Set(["a"]), { id: "", name: "" }, stableId)).toBe(variants);
  });
});
