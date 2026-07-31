import { describe, it, expect } from "vitest";
import {
  commitVariantCell,
  countVariantDirtyEdits,
  isVariantCellDirty,
  productHasDirtyVariants,
  type VariantDirtyEdits,
} from "@/components/admin/products/AdminProductsTable";

// Helpers pour l'édition inline du tiroir variantes : la nouvelle valeur d'une
// cellule est stockée dans dirtyEdits[variantId][field] tant que la cliente
// n'a pas cliqué « Appliquer ». Si elle retape la valeur d'origine, la marque
// dirty doit disparaître (sinon le bandeau reste visible pour rien).
describe("variant dirty edits", () => {
  const EMPTY: VariantDirtyEdits = {};

  describe("commitVariantCell", () => {
    it("stocke la nouvelle valeur quand elle diffère de l'originale", () => {
      const next = commitVariantCell(EMPTY, "v1", "price", 5.2, 4.5);
      expect(next).toEqual({ v1: { price: 5.2 } });
    });

    it("efface la marque dirty quand la valeur revient à l'originale", () => {
      const withEdit: VariantDirtyEdits = { v1: { price: 5.2 } };
      const next = commitVariantCell(withEdit, "v1", "price", 4.5, 4.5);
      expect(next).toEqual({});
    });

    it("ne touche pas les autres champs quand un seul revient à l'original", () => {
      const withTwo: VariantDirtyEdits = { v1: { price: 5.2, stock: 10 } };
      const next = commitVariantCell(withTwo, "v1", "price", 4.5, 4.5);
      expect(next).toEqual({ v1: { stock: 10 } });
    });

    it("ne touche pas les autres variantes", () => {
      const state: VariantDirtyEdits = { v1: { stock: 5 }, v2: { price: 7 } };
      const next = commitVariantCell(state, "v1", "stock", 10, 3);
      expect(next).toEqual({ v1: { stock: 10 }, v2: { price: 7 } });
    });

    it("est idempotent : re-committer la même valeur ne change rien", () => {
      const state: VariantDirtyEdits = { v1: { weight: 0.5 } };
      const next = commitVariantCell(state, "v1", "weight", 0.5, 0.3);
      expect(next).toEqual({ v1: { weight: 0.5 } });
    });

    it("ne mute pas l'état d'entrée (retour d'une nouvelle référence)", () => {
      const state: VariantDirtyEdits = { v1: { price: 5.2 } };
      const next = commitVariantCell(state, "v1", "stock", 10, 3);
      expect(next).not.toBe(state);
      expect(state).toEqual({ v1: { price: 5.2 } });
    });
  });

  describe("isVariantCellDirty", () => {
    it("retourne true si le champ a une valeur en attente", () => {
      const state: VariantDirtyEdits = { v1: { price: 5.2 } };
      expect(isVariantCellDirty(state, "v1", "price")).toBe(true);
    });

    it("retourne false si le champ n'a rien en attente", () => {
      const state: VariantDirtyEdits = { v1: { price: 5.2 } };
      expect(isVariantCellDirty(state, "v1", "stock")).toBe(false);
    });

    it("retourne false pour une variante absente", () => {
      expect(isVariantCellDirty({}, "v42", "price")).toBe(false);
    });
  });

  describe("countVariantDirtyEdits", () => {
    it("retourne 0 sur un état vide", () => {
      expect(countVariantDirtyEdits({})).toBe(0);
    });

    it("compte les champs modifiés sur une seule variante", () => {
      const state: VariantDirtyEdits = { v1: { price: 5.2, stock: 10, weight: 0.4 } };
      expect(countVariantDirtyEdits(state)).toBe(3);
    });

    it("cumule les champs sur plusieurs variantes", () => {
      const state: VariantDirtyEdits = {
        v1: { price: 5.2, stock: 10 },
        v2: { weight: 0.4 },
        v3: { packQty: 6 },
      };
      expect(countVariantDirtyEdits(state)).toBe(4);
    });
  });

  describe("champ disabled (booléen)", () => {
    it("stocke true quand la variante était activée", () => {
      const next = commitVariantCell(EMPTY, "v1", "disabled", true, false);
      expect(next).toEqual({ v1: { disabled: true } });
    });

    it("efface la marque dirty quand on retoggle vers l'état d'origine", () => {
      const withEdit: VariantDirtyEdits = { v1: { disabled: true } };
      const next = commitVariantCell(withEdit, "v1", "disabled", false, false);
      expect(next).toEqual({});
    });

    it("cohabite avec un autre champ dirty sur la même variante", () => {
      const withEdit: VariantDirtyEdits = { v1: { price: 5.2 } };
      const next = commitVariantCell(withEdit, "v1", "disabled", true, false);
      expect(next).toEqual({ v1: { price: 5.2, disabled: true } });
    });

    it("est compté par countVariantDirtyEdits comme n'importe quel champ", () => {
      const state: VariantDirtyEdits = { v1: { price: 5.2, disabled: true } };
      expect(countVariantDirtyEdits(state)).toBe(2);
    });
  });

  describe("productHasDirtyVariants", () => {
    const product = { colors: [{ id: "v1" }, { id: "v2" }] } as const;

    it("retourne false si aucune variante du produit n'est dirty", () => {
      expect(productHasDirtyVariants(product, {})).toBe(false);
      expect(productHasDirtyVariants(product, { vAutre: { price: 5 } })).toBe(false);
    });

    it("retourne true dès qu'une variante du produit a une modif", () => {
      expect(productHasDirtyVariants(product, { v1: { price: 5.2 } })).toBe(true);
      expect(productHasDirtyVariants(product, { v2: { stock: 3 } })).toBe(true);
    });

    it("gère un produit sans variante", () => {
      expect(productHasDirtyVariants({ colors: [] }, { v1: { price: 5 } })).toBe(false);
    });
  });

  describe("flux réaliste : édit, revert, ré-édit", () => {
    it("simule une session édition + annulation d'une seule cellule", () => {
      let state: VariantDirtyEdits = {};

      // Édite le prix
      state = commitVariantCell(state, "v1", "price", 5.2, 4.5);
      expect(countVariantDirtyEdits(state)).toBe(1);

      // Édite le stock
      state = commitVariantCell(state, "v1", "stock", 20, 10);
      expect(countVariantDirtyEdits(state)).toBe(2);

      // Ramène le prix à l'original -> il disparaît, mais le stock reste
      state = commitVariantCell(state, "v1", "price", 4.5, 4.5);
      expect(countVariantDirtyEdits(state)).toBe(1);
      expect(isVariantCellDirty(state, "v1", "price")).toBe(false);
      expect(isVariantCellDirty(state, "v1", "stock")).toBe(true);

      // Ramène le stock à l'original -> plus rien
      state = commitVariantCell(state, "v1", "stock", 10, 10);
      expect(state).toEqual({});
      expect(countVariantDirtyEdits(state)).toBe(0);
    });
  });
});
