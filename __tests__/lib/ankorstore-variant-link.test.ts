import { describe, it, expect } from "vitest";
import { normSku, colorKeyOf } from "@/lib/ankorstore-variant-link";

describe("normSku", () => {
  it("met en majuscules", () => {
    expect(normSku("n683_dore")).toBe("N683_DORE");
  });

  it("supprime les espaces", () => {
    expect(normSku("N683 _ DORE")).toBe("N683_DORE");
  });

  it("supprime les accents (cas Doré vs DORE)", () => {
    expect(normSku("N683_Doré")).toBe("N683_DORE");
    expect(normSku("N683_DORÉ")).toBe("N683_DORE");
  });

  it("supprime tous les diacritiques courants", () => {
    expect(normSku("café")).toBe("CAFE");
    expect(normSku("Crème")).toBe("CREME");
    expect(normSku("Noël")).toBe("NOEL");
    expect(normSku("naïf")).toBe("NAIF");
  });

  it("gere null/undefined/vide", () => {
    expect(normSku(null)).toBe("");
    expect(normSku(undefined)).toBe("");
    expect(normSku("")).toBe("");
  });
});

describe("colorKeyOf", () => {
  it("extrait la couleur d'un SKU AS avec accent", () => {
    expect(colorKeyOf("N683_Doré", "N683")).toBe("DORE");
  });

  it("extrait la couleur d'un SKU local sans accent", () => {
    expect(colorKeyOf("N683_DORE_UNIT_2", "N683")).toBe("DORE");
  });

  it("retourne la meme cle pour les deux formats (le but du fix)", () => {
    expect(colorKeyOf("N683_Doré", "N683")).toBe(
      colorKeyOf("N683_DORE_UNIT_2", "N683"),
    );
  });

  it("retourne null si le SKU ne commence pas par la reference", () => {
    expect(colorKeyOf("OTHER_DORE", "N683")).toBeNull();
  });

  it("retourne null sur sku vide/null", () => {
    expect(colorKeyOf(null, "N683")).toBeNull();
    expect(colorKeyOf("", "N683")).toBeNull();
  });

  it("gere la reference avec espaces", () => {
    expect(colorKeyOf("N 683_DORE", "N 683")).toBe("DORE");
  });
});
