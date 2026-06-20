import { describe, it, expect } from "vitest";
import { normalizeMicrostoreSubCategoryId } from "@/lib/microstore-subcategory";

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
