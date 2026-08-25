import { describe, it, expect } from "vitest";
import {
  normalizeMicrostoreSubCategoryId,
  resolveMicrostoreCategoryChoice,
} from "@/lib/microstore-subcategory";

describe("normalizeMicrostoreSubCategoryId", () => {
  it("retourne null si aucune sous-catégorie n'est choisie (undefined)", () => {
    expect(normalizeMicrostoreSubCategoryId(undefined, ["sub-1", "sub-2"])).toBeNull();
  });

  it("retourne null si l'utilisatrice a explicitement choisi null (catégorie principale)", () => {
    expect(normalizeMicrostoreSubCategoryId(null, ["sub-1"])).toBeNull();
  });

  it("retourne null si la chaîne est vide", () => {
    expect(normalizeMicrostoreSubCategoryId("", ["sub-1"])).toBeNull();
  });

  it("garde l'id si la sous-catégorie est attribuée au produit", () => {
    expect(normalizeMicrostoreSubCategoryId("sub-2", ["sub-1", "sub-2"])).toBe("sub-2");
  });

  it("réinitialise à null si la sous-catégorie n'est plus attribuée au produit", () => {
    // Cas : l'utilisatrice avait choisi sub-2 puis a décoché sub-2 dans le
    // formulaire (sans changer l'étiquette Microstore). On retombe sur la
    // catégorie principale plutôt que de garder un id orphelin.
    expect(normalizeMicrostoreSubCategoryId("sub-2", ["sub-1"])).toBeNull();
  });

  it("réinitialise à null si la liste des sous-catégories attribuées est vide", () => {
    expect(normalizeMicrostoreSubCategoryId("sub-1", [])).toBeNull();
  });
});

describe("resolveMicrostoreCategoryChoice", () => {
  it("utilise la catégorie principale mappée quand aucune sous-catégorie n'est choisie", () => {
    const res = resolveMicrostoreCategoryChoice({
      categoryName: "Bracelet",
      categoryMicrostoreId: 42,
      subCategoryName: null,
      subCategoryMicrostoreId: null,
    });
    expect(res).toEqual({
      ok: true,
      source: "category",
      categoryId: 42,
      categoryName: "Bracelet",
    });
  });

  it("refuse le push quand la catégorie principale n'est pas mappée et aucune sous-catégorie n'est choisie", () => {
    const res = resolveMicrostoreCategoryChoice({
      categoryName: "Bracelet",
      categoryMicrostoreId: null,
      subCategoryName: null,
      subCategoryMicrostoreId: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.missing).toContain("Bracelet");
      expect(res.missing).toContain("/admin/categories");
    }
  });

  it("utilise la sous-catégorie mappée quand elle est choisie, même si la catégorie principale est mappée", () => {
    const res = resolveMicrostoreCategoryChoice({
      categoryName: "Bracelet",
      categoryMicrostoreId: 42,
      subCategoryName: "Bracelet de main",
      subCategoryMicrostoreId: 100,
    });
    expect(res).toEqual({
      ok: true,
      source: "subcategory",
      categoryId: 100,
      categoryName: "Bracelet de main",
    });
  });

  it("refuse le push quand la sous-catégorie choisie n'est pas mappée — même si la catégorie principale l'est", () => {
    const res = resolveMicrostoreCategoryChoice({
      categoryName: "Bracelet",
      categoryMicrostoreId: 42,
      subCategoryName: "Bracelet de main",
      subCategoryMicrostoreId: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.missing).toContain("Bracelet de main");
      expect(res.missing).toContain("badge M");
    }
  });

  it("utilise la sous-catégorie mappée même quand la catégorie principale n'est pas mappée (source unique)", () => {
    const res = resolveMicrostoreCategoryChoice({
      categoryName: "Bracelet",
      categoryMicrostoreId: null,
      subCategoryName: "Bracelet de main",
      subCategoryMicrostoreId: 100,
    });
    expect(res).toEqual({
      ok: true,
      source: "subcategory",
      categoryId: 100,
      categoryName: "Bracelet de main",
    });
  });
});
