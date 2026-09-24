import { describe, it, expect } from "vitest";
import { resolveLocalizedName } from "@/lib/localize-name";

describe("resolveLocalizedName — panier /en", () => {
  it("locale fr : renvoie le texte brut BDD, aucun dictionnaire appliqué", () => {
    const out = resolveLocalizedName(
      "Bracelet Doré",
      [{ name: "Gold Bracelet" }],
      "fr"
    );
    expect(out).toBe("Bracelet Doré");
  });

  it("locale en avec traduction saisie : renvoie la valeur BDD telle quelle (capitales préservées)", () => {
    const out = resolveLocalizedName(
      "Collier plaqué or perles blanches",
      [{ name: "White Pearl Gold-Plated Necklace" }],
      "en"
    );
    expect(out).toBe("White Pearl Gold-Plated Necklace");
  });

  it("locale en sans traduction BDD : retombe sur le dictionnaire FR→EN", () => {
    const out = resolveLocalizedName("Bracelet", undefined, "en");
    // translateProduct lowercase le texte puis re-capitalise la 1re lettre
    expect(out.toLowerCase()).toContain("bracelet");
  });

  it("locale en avec tableau vide de traductions : retombe sur le dictionnaire", () => {
    const out = resolveLocalizedName("Bracelet", [], "en");
    expect(out.toLowerCase()).toContain("bracelet");
  });

  it("traduction BDD vide (whitespace) : ignorée, fallback dictionnaire", () => {
    const out = resolveLocalizedName("Bracelet", [{ name: "   " }], "en");
    expect(out).not.toBe("   ");
    expect(out.toLowerCase()).toContain("bracelet");
  });

  it("raw null : renvoie chaîne vide", () => {
    expect(resolveLocalizedName(null, undefined, "fr")).toBe("");
    expect(resolveLocalizedName(undefined, undefined, "en")).toBe("");
  });
});
