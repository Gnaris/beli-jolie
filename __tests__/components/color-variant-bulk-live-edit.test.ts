/**
 * Édition en masse en direct des variantes (prix / poids / stock).
 *
 * Couvre le helper pur `applyBulkFieldToVariants` extrait du
 * composant `ColorVariantManager`. La logique UI (debounce, focus,
 * etc.) n'est pas testée ici — seule la transformation des données.
 */
import { describe, it, expect } from "vitest";
import {
  applyBulkFieldToVariants,
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

  it("ne touche à rien quand aucune variante n'est sélectionnée", () => {
    const variants = [makeVariant({ tempId: "a", unitPrice: "5" })];
    const next = applyBulkFieldToVariants(variants, new Set(), "unitPrice", "99");
    expect(next).toBe(variants);
    expect(next[0].unitPrice).toBe("5");
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
