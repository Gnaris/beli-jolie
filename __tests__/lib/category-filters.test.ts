import { describe, it, expect } from "vitest";
import {
  matchesSearch,
  matchesFilters,
  countMissing,
  type CategoryForFilters,
  type FilterKey,
} from "@/lib/category-filters";

const cat = (over: Partial<CategoryForFilters> = {}): CategoryForFilters => ({
  id: "c1",
  name: "Colliers",
  translations: { fr: "Colliers", en: "Necklaces" },
  pfsGender: "WOMAN",
  pfsFamilyName: "BIJOUX",
  pfsCategoryName: "Colliers",
  efashionCategorieId: 42,
  faireTaxonomyId: "tt_abc",
  ...over,
});

describe("matchesSearch", () => {
  it("renvoie true si query vide", () => {
    expect(matchesSearch(cat(), "")).toBe(true);
  });
  it("matche sur le nom, insensible à la casse", () => {
    expect(matchesSearch(cat({ name: "Bracelets" }), "BRACE")).toBe(true);
  });
  it("matche sur une traduction", () => {
    expect(matchesSearch(cat(), "neck")).toBe(true);
  });
  it("ne matche pas si rien", () => {
    expect(matchesSearch(cat({ name: "Bagues", translations: {} }), "collier")).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("aucun filtre actif → toujours true", () => {
    expect(matchesFilters(cat(), new Set())).toBe(true);
  });
  it("missingTranslation → catégorie avec 2 traductions ne match pas", () => {
    expect(matchesFilters(cat(), new Set(["missingTranslation"]))).toBe(false);
  });
  it("missingTranslation → catégorie sans traduction match", () => {
    expect(matchesFilters(cat({ translations: {} }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingTranslation → catégorie avec 1 seule traduction match (FR sans EN)", () => {
    expect(matchesFilters(cat({ translations: { fr: "Colliers" } }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingPfs → catégorie PFS complète ne match pas", () => {
    expect(matchesFilters(cat(), new Set(["missingPfs"]))).toBe(false);
  });
  it("missingPfs → manque gender → match", () => {
    expect(matchesFilters(cat({ pfsGender: null }), new Set(["missingPfs"]))).toBe(true);
  });
  it("missingEfashion → efashionCategorieId null → match", () => {
    expect(matchesFilters(cat({ efashionCategorieId: null }), new Set(["missingEfashion"]))).toBe(true);
  });
  it("missingFaire → faireTaxonomyId null → match", () => {
    expect(matchesFilters(cat({ faireTaxonomyId: null }), new Set(["missingFaire"]))).toBe(true);
  });
  it("filtres cumulés (ET logique)", () => {
    const c = cat({ translations: {}, faireTaxonomyId: null });
    expect(matchesFilters(c, new Set(["missingTranslation", "missingFaire"]))).toBe(true);
    expect(matchesFilters(c, new Set(["missingTranslation", "missingPfs"]))).toBe(false);
  });
  it("missingTranslation → EN sans FR match aussi", () => {
    expect(matchesFilters(cat({ translations: { en: "Necklaces" } }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingTranslation → traduction vide compte comme manquante", () => {
    expect(matchesFilters(cat({ translations: { fr: "x", en: "" } }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingTranslation → autre locale (DE) ne compense pas l'absence d'EN", () => {
    expect(matchesFilters(cat({ translations: { fr: "x", de: "y" } }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingPfs → manque pfsCategoryName seul → match", () => {
    expect(matchesFilters(cat({ pfsCategoryName: null }), new Set(["missingPfs"]))).toBe(true);
  });
});

describe("countMissing", () => {
  it("compte les catégories sans traduction", () => {
    const list = [cat(), cat({ id: "c2", translations: {} }), cat({ id: "c3", translations: { fr: "x" } })];
    expect(countMissing(list, "missingTranslation")).toBe(2);
  });
  it("compte les catégories sans Faire", () => {
    const list = [cat(), cat({ id: "c2", faireTaxonomyId: null }), cat({ id: "c3", faireTaxonomyId: null })];
    expect(countMissing(list, "missingFaire")).toBe(2);
  });
  it("compte les catégories sans PFS (manque au moins 1 des 3 champs)", () => {
    const list = [cat(), cat({ id: "c2", pfsCategoryName: null }), cat({ id: "c3", pfsGender: null })];
    expect(countMissing(list, "missingPfs")).toBe(2);
  });
  it("compte les catégories sans eFashion", () => {
    const list = [cat(), cat({ id: "c2", efashionCategorieId: null })];
    expect(countMissing(list, "missingEfashion")).toBe(1);
  });
});
