import { describe, it, expect } from "vitest";
import {
  resolveOrderchampCategory,
} from "@/lib/orderchamp-category-resolve";

const LEAF_BANGLES = "JEWELRY_ACCESSORIES_BRACELETS_BANGLE_BRACELETS";
const LEAF_CATEGORY = "JEWELRY_ACCESSORIES_BRACELETS_OTHER";
const LEAF_ALT = "JEWELRY_ACCESSORIES_BRACELETS_CHAIN_BRACELETS";

const BRACELET = {
  id: "cat-1",
  name: "Bracelet",
  orderchampCategoryPath: LEAF_CATEGORY,
};

describe("resolveOrderchampCategory — règle de priorité", () => {
  it("prend la sous-catégorie mappée si elle existe", () => {
    const res = resolveOrderchampCategory({
      category: BRACELET,
      subCategories: [
        { id: "s1", name: "Jonc", orderchampCategoryPath: LEAF_BANGLES },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.path).toBe(LEAF_BANGLES);
      expect(res.source.kind).toBe("subcategory");
    }
  });

  it("prend la première sous-catégorie MAPPÉE dans l'ordre reçu, même si d'autres non mappées existent avant", () => {
    // Le caller est censé trier alphabétiquement — on donne ici Bracelet plat
    // (pas mappé) avant Jonc (mappé) pour vérifier qu'on saute les vides.
    const res = resolveOrderchampCategory({
      category: BRACELET,
      subCategories: [
        { id: "s0", name: "Bracelet plat", orderchampCategoryPath: null },
        { id: "s1", name: "Jonc", orderchampCategoryPath: LEAF_BANGLES },
        { id: "s2", name: "Manchette", orderchampCategoryPath: LEAF_ALT },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.path).toBe(LEAF_BANGLES);
      expect(res.source.kind).toBe("subcategory");
    }
  });

  it("retombe sur la catégorie principale si aucune sous-cat n'est mappée", () => {
    const res = resolveOrderchampCategory({
      category: BRACELET,
      subCategories: [
        { id: "s0", name: "Bracelet plat", orderchampCategoryPath: null },
        { id: "s1", name: "Jonc", orderchampCategoryPath: null },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.path).toBe(LEAF_CATEGORY);
      expect(res.source.kind).toBe("category");
    }
  });

  it("retombe sur la catégorie principale s'il n'y a AUCUNE sous-catégorie", () => {
    const res = resolveOrderchampCategory({
      category: BRACELET,
      subCategories: [],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.path).toBe(LEAF_CATEGORY);
  });

  it("échoue avec un message explicite si rien n'est mappé", () => {
    const res = resolveOrderchampCategory({
      category: { ...BRACELET, orderchampCategoryPath: null },
      subCategories: [
        { id: "s1", name: "Jonc", orderchampCategoryPath: null },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("Bracelet");
      expect(res.error.toLowerCase()).toContain("orderchamp");
    }
  });

  it("traite un mapping vide (espaces) comme non mappé", () => {
    const res = resolveOrderchampCategory({
      category: { ...BRACELET, orderchampCategoryPath: "   " },
      subCategories: [
        { id: "s1", name: "Jonc", orderchampCategoryPath: "" },
      ],
    });
    expect(res.ok).toBe(false);
  });

  it("échoue si la catégorie BJ est absente", () => {
    const res = resolveOrderchampCategory({
      category: null,
      subCategories: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.toLowerCase()).toContain("catégorie bj");
  });
});
