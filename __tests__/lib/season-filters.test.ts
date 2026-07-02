import { describe, it, expect } from "vitest";
import {
  matchesSearch,
  matchesFilters,
  countMissing,
  extractYear,
  seasonEmoji,
  seasonGradient,
  type SeasonForFilters,
} from "@/lib/season-filters";

const season = (over: Partial<SeasonForFilters> = {}): SeasonForFilters => ({
  id: "s1",
  name: "Printemps/Été 2026",
  translations: { fr: "Printemps/Été 2026", en: "Spring/Summer 2026" },
  pfsRef: "PE2026",
  efashionCollectionId: 3,
  ...over,
});

describe("matchesSearch", () => {
  it("renvoie true si query vide", () => {
    expect(matchesSearch(season(), "")).toBe(true);
  });
  it("matche sur le nom, insensible à la casse", () => {
    expect(matchesSearch(season(), "PRINTEMPS")).toBe(true);
  });
  it("matche sur une traduction", () => {
    expect(matchesSearch(season(), "summer")).toBe(true);
  });
  it("matche sur la référence PFS", () => {
    expect(matchesSearch(season(), "pe2026")).toBe(true);
  });
  it("ne matche pas si rien", () => {
    expect(matchesSearch(season({ name: "Fêtes", translations: {}, pfsRef: null }), "hiver")).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("aucun filtre actif → toujours true", () => {
    expect(matchesFilters(season(), new Set())).toBe(true);
  });
  it("missingTranslation → saison avec 2 traductions ne match pas", () => {
    expect(matchesFilters(season(), new Set(["missingTranslation"]))).toBe(false);
  });
  it("missingTranslation → saison sans traduction match", () => {
    expect(matchesFilters(season({ translations: {} }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingTranslation → FR seul (sans EN) match", () => {
    expect(matchesFilters(season({ translations: { fr: "PE2026" } }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingTranslation → traduction vide compte comme manquante", () => {
    expect(matchesFilters(season({ translations: { fr: "x", en: "" } }), new Set(["missingTranslation"]))).toBe(true);
  });
  it("missingPfs → pfsRef renseigné ne match pas", () => {
    expect(matchesFilters(season(), new Set(["missingPfs"]))).toBe(false);
  });
  it("missingPfs → pfsRef null → match", () => {
    expect(matchesFilters(season({ pfsRef: null }), new Set(["missingPfs"]))).toBe(true);
  });
  it("missingPfs → pfsRef chaîne vide → match", () => {
    expect(matchesFilters(season({ pfsRef: "" }), new Set(["missingPfs"]))).toBe(true);
  });
  it("missingEfashion → efashionCollectionId null → match", () => {
    expect(matchesFilters(season({ efashionCollectionId: null }), new Set(["missingEfashion"]))).toBe(true);
  });
  it("missingEfashion → efashionCollectionId renseigné ne match pas", () => {
    expect(matchesFilters(season(), new Set(["missingEfashion"]))).toBe(false);
  });
  it("filtres cumulés (ET logique)", () => {
    const s = season({ translations: {}, efashionCollectionId: null });
    expect(matchesFilters(s, new Set(["missingTranslation", "missingEfashion"]))).toBe(true);
    expect(matchesFilters(s, new Set(["missingTranslation", "missingPfs"]))).toBe(false);
  });
});

describe("countMissing", () => {
  it("compte les saisons sans traduction", () => {
    const list = [
      season(),
      season({ id: "s2", translations: {} }),
      season({ id: "s3", translations: { fr: "x" } }),
    ];
    expect(countMissing(list, "missingTranslation")).toBe(2);
  });
  it("compte les saisons sans PFS", () => {
    const list = [season(), season({ id: "s2", pfsRef: null }), season({ id: "s3", pfsRef: "" })];
    expect(countMissing(list, "missingPfs")).toBe(2);
  });
  it("compte les saisons sans eFashion", () => {
    const list = [season(), season({ id: "s2", efashionCollectionId: null })];
    expect(countMissing(list, "missingEfashion")).toBe(1);
  });
});

describe("extractYear", () => {
  it("extrait 2026 depuis « Printemps/Été 2026 »", () => {
    expect(extractYear("Printemps/Été 2026")).toBe(2026);
  });
  it("extrait 2025 depuis « SS25 »", () => {
    expect(extractYear("SS25")).toBe(2025);
  });
  it("extrait 2026 depuis « AH26 »", () => {
    expect(extractYear("AH26")).toBe(2026);
  });
  it("préfère l'année à 4 chiffres si présente", () => {
    expect(extractYear("Collection 2026 lot 4")).toBe(2026);
  });
  it("retourne null pour « Toute saison »", () => {
    expect(extractYear("Toute saison")).toBeNull();
  });
  it("retourne null pour « Intemporel »", () => {
    expect(extractYear("Intemporel")).toBeNull();
  });
  it("ignore les nombres > 2 chiffres qui ne sont pas des années", () => {
    expect(extractYear("Ref 12345")).toBeNull();
  });
});

describe("seasonEmoji", () => {
  it("été → ☀️", () => {
    expect(seasonEmoji("Printemps/Été 2026")).toBe("☀️");
    expect(seasonEmoji("Spring/Summer 2026")).toBe("☀️");
  });
  it("hiver → 🍂", () => {
    expect(seasonEmoji("Automne/Hiver 2025")).toBe("🍂");
    expect(seasonEmoji("Fall/Winter 2025")).toBe("🍂");
  });
  it("fêtes → ✨", () => {
    expect(seasonEmoji("Fêtes 2026")).toBe("✨");
    expect(seasonEmoji("Noël")).toBe("✨");
    expect(seasonEmoji("Holidays 2026")).toBe("✨");
  });
  it("toute saison → ♾", () => {
    expect(seasonEmoji("Toute saison")).toBe("♾");
    expect(seasonEmoji("Intemporel")).toBe("♾");
    expect(seasonEmoji("All season")).toBe("♾");
  });
  it("fallback → ✨ pour saison inconnue", () => {
    expect(seasonEmoji("Collection spéciale")).toBe("✨");
  });
});

describe("seasonGradient", () => {
  it("renvoie un gradient CSS pour chaque saison connue", () => {
    expect(seasonGradient("Printemps/Été 2026")).toContain("linear-gradient");
    expect(seasonGradient("Automne/Hiver 2025")).toContain("linear-gradient");
    expect(seasonGradient("Fêtes 2026")).toContain("linear-gradient");
    expect(seasonGradient("Toute saison")).toContain("linear-gradient");
  });
  it("saison été et automne ont des dégradés différents", () => {
    expect(seasonGradient("Été 2026")).not.toBe(seasonGradient("Automne 2026"));
  });
});
