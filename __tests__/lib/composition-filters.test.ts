import { describe, it, expect } from "vitest";
import {
  matchesSearch,
  matchesFilters,
  countMissing,
  compositionInitials,
  type CompositionForFilters,
} from "@/lib/composition-filters";

const comp = (over: Partial<CompositionForFilters> = {}): CompositionForFilters => ({
  id: "co1",
  name: "Acier inoxydable",
  translations: { fr: "Acier inoxydable", en: "Stainless steel" },
  pfsCompositionRef: "acier_inox",
  efashionId: 182,
  ...over,
});

describe("matchesSearch", () => {
  it("renvoie true si query vide", () => {
    expect(matchesSearch(comp(), "")).toBe(true);
  });
  it("matche sur le nom, insensible à la casse", () => {
    expect(matchesSearch(comp({ name: "Laiton" }), "lait")).toBe(true);
  });
  it("matche sur une traduction", () => {
    expect(matchesSearch(comp(), "stainless")).toBe(true);
  });
  it("ne matche pas si rien", () => {
    expect(matchesSearch(comp({ name: "Coton", translations: {} }), "verre")).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("aucun filtre actif → toujours true", () => {
    expect(matchesFilters(comp(), new Set())).toBe(true);
  });
  it("missingTranslation → composition avec 2 traductions ne match pas", () => {
    expect(matchesFilters(comp(), new Set(["missingTranslation"]))).toBe(false);
  });
  it("missingTranslation → composition sans traduction match", () => {
    expect(matchesFilters(comp({ translations: {} }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingTranslation → FR seul (sans EN) match", () => {
    expect(matchesFilters(comp({ translations: { fr: "Laiton" } }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingTranslation → traduction vide compte comme manquante", () => {
    expect(matchesFilters(comp({ translations: { fr: "x", en: "" } }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingPfs → pfsCompositionRef renseigné ne match pas", () => {
    expect(matchesFilters(comp(), new Set(["missingPfs"]))).toBe(false);
  });
  it("missingPfs → pfsCompositionRef null → match", () => {
    expect(matchesFilters(comp({ pfsCompositionRef: null }), new Set(["missingPfs"]))).toBe(true);
  });
  it("missingPfs → pfsCompositionRef chaîne vide → match", () => {
    expect(matchesFilters(comp({ pfsCompositionRef: "" }), new Set(["missingPfs"]))).toBe(true);
  });
  it("missingEfashion → efashionId null → match", () => {
    expect(matchesFilters(comp({ efashionId: null }), new Set(["missingEfashion"]))).toBe(true);
  });
  it("missingEfashion → efashionId renseigné ne match pas", () => {
    expect(matchesFilters(comp(), new Set(["missingEfashion"]))).toBe(false);
  });
  it("filtres cumulés (ET logique)", () => {
    const c = comp({ translations: {}, efashionId: null });
    expect(matchesFilters(c, new Set(["missingTranslation", "missingEfashion"]))).toBe(true);
    expect(matchesFilters(c, new Set(["missingTranslation", "missingPfs"]))).toBe(false);
  });
});

describe("countMissing", () => {
  it("compte les compositions sans traduction", () => {
    const list = [comp(), comp({ id: "c2", translations: {} }), comp({ id: "c3", translations: { fr: "x" } })];
    expect(countMissing(list, "missingTranslation")).toBe(2);
  });
  it("compte les compositions sans PFS", () => {
    const list = [comp(), comp({ id: "c2", pfsCompositionRef: null }), comp({ id: "c3", pfsCompositionRef: "" })];
    expect(countMissing(list, "missingPfs")).toBe(2);
  });
  it("compte les compositions sans eFashion", () => {
    const list = [comp(), comp({ id: "c2", efashionId: null })];
    expect(countMissing(list, "missingEfashion")).toBe(1);
  });
});

describe("compositionInitials", () => {
  it("prend première majuscule + seconde minuscule", () => {
    expect(compositionInitials("Acier inoxydable")).toBe("Ac");
    expect(compositionInitials("Laiton")).toBe("La");
    expect(compositionInitials("Or 18k")).toBe("Or");
  });
  it("saute les caractères non alpha entre les deux lettres", () => {
    expect(compositionInitials("A 316L")).toBe("Al");
    expect(compositionInitials("Z-mak")).toBe("Zm");
  });
  it("gère nom vide", () => {
    expect(compositionInitials("")).toBe("?");
    expect(compositionInitials("   ")).toBe("?");
  });
  it("gère nom d'une seule lettre", () => {
    expect(compositionInitials("Y")).toBe("Y");
  });
  it("supporte les accents", () => {
    expect(compositionInitials("Émail")).toBe("Ém");
  });
});
