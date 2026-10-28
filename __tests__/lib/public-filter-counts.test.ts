import { describe, it, expect } from "vitest";
import {
  computeFilterCounts,
  type FilterState,
  type ProductFilterSummary,
} from "@/lib/public-filter-counts";

function mkProduct(partial: Partial<ProductFilterSummary>): ProductFilterSummary {
  return {
    id: "p",
    reference: "REF",
    name: "produit",
    categoryId: null,
    subCategoryIds: [],
    tagIds: [],
    compositionIds: [],
    colorIds: [],
    minUnitPrice: 10,
    isBestSeller: false,
    isTrending: false,
    discountPercent: 0,
    createdAt: new Date("2026-01-01"),
    lastRefreshedAt: null,
    ...partial,
  };
}

const EMPTY_STATE: FilterState = {
  q: "", exactRef: false,
  cat: "", subcat: "",
  colorIds: [],
  tagId: "", compositionId: "",
  minPrice: null, maxPrice: null,
  bestseller: false, trending: false,
  isNew: false, promo: false,
  ordered: false, notOrdered: false,
};

describe("computeFilterCounts", () => {
  it("compte les catégories sans filtre", () => {
    const products = [
      mkProduct({ id: "p1", categoryId: "catA" }),
      mkProduct({ id: "p2", categoryId: "catA" }),
      mkProduct({ id: "p3", categoryId: "catB" }),
    ];
    const counts = computeFilterCounts(products, EMPTY_STATE, []);
    expect(counts.categories).toEqual({ catA: 2, catB: 1 });
  });

  it("compte les sous-catégories en respectant le filtre catégorie courant", () => {
    const products = [
      mkProduct({ id: "p1", categoryId: "catA", subCategoryIds: ["sc1"] }),
      mkProduct({ id: "p2", categoryId: "catA", subCategoryIds: ["sc1", "sc2"] }),
      mkProduct({ id: "p3", categoryId: "catB", subCategoryIds: ["sc3"] }),
    ];
    const counts = computeFilterCounts(
      products,
      { ...EMPTY_STATE, cat: "catA" },
      [],
    );
    // catA → sc1 (2 produits), sc2 (1 produit), sc3 (0 produit car filtré par cat).
    expect(counts.subCategories).toEqual({ sc1: 2, sc2: 1 });
  });

  it("faceted : count d'une couleur ignore le filtre couleur courant", () => {
    const products = [
      mkProduct({ id: "p1", colorIds: ["red"] }),
      mkProduct({ id: "p2", colorIds: ["red", "blue"] }),
      mkProduct({ id: "p3", colorIds: ["green"] }),
    ];
    // User a filtré sur rouge : le count pour bleu doit valoir 1 (p2), pas 0,
    // et le count pour vert doit rester 1 (p3) même s'il n'est pas rouge.
    const counts = computeFilterCounts(
      products,
      { ...EMPTY_STATE, colorIds: ["red"] },
      [],
    );
    expect(counts.colors).toEqual({ red: 2, blue: 1, green: 1 });
  });

  it("count bestseller respecte les autres filtres sauf lui-même", () => {
    const products = [
      mkProduct({ id: "p1", categoryId: "catA", isBestSeller: true }),
      mkProduct({ id: "p2", categoryId: "catA", isBestSeller: false }),
      mkProduct({ id: "p3", categoryId: "catB", isBestSeller: true }),
    ];
    const counts = computeFilterCounts(
      products,
      { ...EMPTY_STATE, cat: "catA", bestseller: true },
      [],
    );
    // Dans catA, 1 produit est bestseller.
    expect(counts.bestseller).toBe(1);
  });

  it("le prix est toujours appliqué même quand on compte une autre dimension", () => {
    const products = [
      mkProduct({ id: "p1", categoryId: "catA", minUnitPrice: 5 }),
      mkProduct({ id: "p2", categoryId: "catA", minUnitPrice: 50 }),
      mkProduct({ id: "p3", categoryId: "catB", minUnitPrice: 100 }),
    ];
    const counts = computeFilterCounts(
      products,
      { ...EMPTY_STATE, minPrice: 10, maxPrice: 80 },
      [],
    );
    // Dans la fourchette : seulement p2 (catA).
    expect(counts.categories).toEqual({ catA: 1 });
  });

  it("ordered/notOrdered utilise les références déjà commandées de l'utilisateur", () => {
    const products = [
      mkProduct({ id: "p1", reference: "A" }),
      mkProduct({ id: "p2", reference: "B" }),
      mkProduct({ id: "p3", reference: "C" }),
    ];
    const counts = computeFilterCounts(products, EMPTY_STATE, ["A", "C"]);
    expect(counts.ordered).toBe(2);
    expect(counts.notOrdered).toBe(1);
  });
});
