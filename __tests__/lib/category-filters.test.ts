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
  pfsCategoryId: "a045J000003KWwDQAW",
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
  it("missingPfs → catégorie avec les 3 champs texte remplis ne match pas", () => {
    expect(matchesFilters(cat(), new Set(["missingPfs"]))).toBe(false);
  });
  it("missingPfs → pfsCategoryId null mais 3 champs texte présents → NE match PAS (l'ID est auto-résolu au push)", () => {
    expect(matchesFilters(cat({ pfsCategoryId: null }), new Set(["missingPfs"]))).toBe(false);
  });
  it("missingPfs → pfsGender manquant → match", () => {
    expect(matchesFilters(cat({ pfsGender: null }), new Set(["missingPfs"]))).toBe(true);
  });
  it("missingPfs → pfsFamilyName manquant → match", () => {
    expect(matchesFilters(cat({ pfsFamilyName: null }), new Set(["missingPfs"]))).toBe(true);
  });
  it("missingPfs → pfsCategoryName manquant → match", () => {
    expect(matchesFilters(cat({ pfsCategoryName: null }), new Set(["missingPfs"]))).toBe(true);
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
  it("missingPfs → pfsCategoryId présent mais 3 libellés vides → match (les libellés sont la source de vérité)", () => {
    expect(
      matchesFilters(
        cat({ pfsCategoryName: null, pfsFamilyName: null, pfsGender: null }),
        new Set(["missingPfs"]),
      ),
    ).toBe(true);
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
  it("compte les catégories sans PFS (au moins un des 3 champs texte manquant)", () => {
    const list = [
      cat(), // 3 champs présents → mappée
      cat({ id: "c2", pfsCategoryId: null }), // ID null mais 3 champs présents → mappée
      cat({ id: "c3", pfsGender: null }), // gender manquant → non mappée
      cat({ id: "c4", pfsCategoryName: null }), // categoryName manquant → non mappée
    ];
    expect(countMissing(list, "missingPfs")).toBe(2);
  });
  it("compte les catégories sans eFashion", () => {
    const list = [cat(), cat({ id: "c2", efashionCategorieId: null })];
    expect(countMissing(list, "missingEfashion")).toBe(1);
  });
});
