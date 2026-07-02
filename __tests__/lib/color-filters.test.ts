import { describe, it, expect } from "vitest";
import {
  matchesSearch,
  matchesFilters,
  countMissing,
  type ColorForFilters,
} from "@/lib/color-filters";

const color = (over: Partial<ColorForFilters> = {}): ColorForFilters => ({
  id: "c1",
  name: "Doré",
  translations: { fr: "Doré", en: "Gold" },
  pfsColorRef: "GOLDEN",
  efashionColorId: 78,
  ...over,
});

describe("matchesSearch", () => {
  it("renvoie true si query vide", () => {
    expect(matchesSearch(color(), "")).toBe(true);
  });
  it("matche sur le nom, insensible à la casse", () => {
    expect(matchesSearch(color({ name: "Argenté" }), "argen")).toBe(true);
  });
  it("matche sur une traduction", () => {
    expect(matchesSearch(color(), "gold")).toBe(true);
  });
  it("ne matche pas si rien", () => {
    expect(matchesSearch(color({ name: "Rouge", translations: {} }), "bleu")).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("aucun filtre actif → toujours true", () => {
    expect(matchesFilters(color(), new Set())).toBe(true);
  });
  it("missingTranslation → couleur avec 2 traductions ne match pas", () => {
    expect(matchesFilters(color(), new Set(["missingTranslation"]))).toBe(false);
  });
  it("missingTranslation → couleur sans traduction match", () => {
    expect(matchesFilters(color({ translations: {} }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingTranslation → couleur avec 1 seule traduction match (FR sans EN)", () => {
    expect(matchesFilters(color({ translations: { fr: "Doré" } }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingTranslation → EN sans FR match aussi", () => {
    expect(matchesFilters(color({ translations: { en: "Gold" } }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingTranslation → traduction vide compte comme manquante", () => {
    expect(matchesFilters(color({ translations: { fr: "x", en: "" } }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingPfs → pfsColorRef renseigné ne match pas", () => {
    expect(matchesFilters(color(), new Set(["missingPfs"]))).toBe(false);
  });
  it("missingPfs → pfsColorRef null → match", () => {
    expect(matchesFilters(color({ pfsColorRef: null }), new Set(["missingPfs"]))).toBe(true);
  });
  it("missingPfs → pfsColorRef chaîne vide → match", () => {
    expect(matchesFilters(color({ pfsColorRef: "" }), new Set(["missingPfs"]))).toBe(true);
  });
  it("missingEfashion → efashionColorId null → match", () => {
    expect(matchesFilters(color({ efashionColorId: null }), new Set(["missingEfashion"]))).toBe(true);
  });
  it("missingEfashion → efashionColorId renseigné ne match pas", () => {
    expect(matchesFilters(color(), new Set(["missingEfashion"]))).toBe(false);
  });
  it("filtres cumulés (ET logique)", () => {
    const c = color({ translations: {}, efashionColorId: null });
    expect(matchesFilters(c, new Set(["missingTranslation", "missingEfashion"]))).toBe(true);
    expect(matchesFilters(c, new Set(["missingTranslation", "missingPfs"]))).toBe(false);
  });
});

describe("countMissing", () => {
  it("compte les couleurs sans traduction", () => {
    const list = [color(), color({ id: "c2", translations: {} }), color({ id: "c3", translations: { fr: "x" } })];
    expect(countMissing(list, "missingTranslation")).toBe(2);
  });
  it("compte les couleurs sans PFS", () => {
    const list = [color(), color({ id: "c2", pfsColorRef: null }), color({ id: "c3", pfsColorRef: "" })];
    expect(countMissing(list, "missingPfs")).toBe(2);
  });
  it("compte les couleurs sans eFashion", () => {
    const list = [color(), color({ id: "c2", efashionColorId: null })];
    expect(countMissing(list, "missingEfashion")).toBe(1);
  });
});
