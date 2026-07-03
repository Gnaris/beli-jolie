import { describe, it, expect } from "vitest";
import {
  matchesSearch,
  matchesFilters,
  countMissing,
  type CountryForFilters,
} from "@/lib/country-filters";

const country = (over: Partial<CountryForFilters> = {}): CountryForFilters => ({
  id: "c1",
  name: "Chine",
  isoCode: "CN",
  pfsCountryRef: "Chine",
  efashionProvenanceId: 42,
  faireCountryCode: "CHN",
  productCount: 120,
  translations: { en: "China" },
  ...over,
});

describe("matchesSearch", () => {
  it("renvoie true si query vide", () => {
    expect(matchesSearch(country(), "")).toBe(true);
  });
  it("matche sur le nom, insensible à la casse", () => {
    expect(matchesSearch(country(), "chine")).toBe(true);
  });
  it("matche sur le code ISO", () => {
    expect(matchesSearch(country(), "cn")).toBe(true);
  });
  it("matche sur les traductions", () => {
    expect(matchesSearch(country(), "china")).toBe(true);
  });
  it("ne matche pas si rien", () => {
    expect(matchesSearch(country(), "france")).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("aucun filtre → toujours true", () => {
    expect(matchesFilters(country(), new Set())).toBe(true);
  });
  it("missingIso → pays avec ISO ne match pas", () => {
    expect(matchesFilters(country(), new Set(["missingIso"]))).toBe(false);
  });
  it("missingIso → ISO null → match", () => {
    expect(matchesFilters(country({ isoCode: null }), new Set(["missingIso"]))).toBe(true);
  });
  it("missingTranslation → pays traduit ne match pas", () => {
    expect(matchesFilters(country(), new Set(["missingTranslation"]))).toBe(false);
  });
  it("missingTranslation → aucune traduction → match", () => {
    expect(matchesFilters(country({ translations: {} }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingMapping → pays mappé ne match pas", () => {
    expect(matchesFilters(country(), new Set(["missingMapping"]))).toBe(false);
  });
  it("missingMapping → aucun mapping → match", () => {
    const c = country({ pfsCountryRef: null, efashionProvenanceId: null, faireCountryCode: null });
    expect(matchesFilters(c, new Set(["missingMapping"]))).toBe(true);
  });
  it("missingMapping → au moins un mapping suffit", () => {
    const c = country({ pfsCountryRef: null, efashionProvenanceId: null, faireCountryCode: "FRA" });
    expect(matchesFilters(c, new Set(["missingMapping"]))).toBe(false);
  });
  it("unused → produits > 0 ne match pas", () => {
    expect(matchesFilters(country(), new Set(["unused"]))).toBe(false);
  });
  it("unused → productCount 0 → match", () => {
    expect(matchesFilters(country({ productCount: 0 }), new Set(["unused"]))).toBe(true);
  });
});

describe("countMissing", () => {
  it("compte les pays sans ISO", () => {
    const list = [country(), country({ id: "c2", isoCode: null })];
    expect(countMissing(list, "missingIso")).toBe(1);
  });
  it("compte les pays sans traduction", () => {
    const list = [country(), country({ id: "c2", translations: {} })];
    expect(countMissing(list, "missingTranslation")).toBe(1);
  });
});
