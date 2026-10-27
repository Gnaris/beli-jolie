import { describe, it, expect } from "vitest";
import { formatTagName } from "@/lib/tag-display";

describe("formatTagName", () => {
  it("met la première lettre en majuscule et le reste en minuscule", () => {
    expect(formatTagName("bijoux")).toBe("Bijoux");
    expect(formatTagName("BIJOUX")).toBe("Bijoux");
    expect(formatTagName("Bijoux")).toBe("Bijoux");
    expect(formatTagName("bIjOuX")).toBe("Bijoux");
  });

  it("conserve le texte en minuscule après le premier mot (sentence case, pas title case)", () => {
    expect(formatTagName("maille marine")).toBe("Maille marine");
    expect(formatTagName("MAILLE MARINE")).toBe("Maille marine");
    expect(formatTagName("Maille Marine")).toBe("Maille marine");
  });

  it("gère les accents correctement", () => {
    expect(formatTagName("été")).toBe("Été");
    expect(formatTagName("ÉTÉ")).toBe("Été");
    expect(formatTagName("élégant")).toBe("Élégant");
  });

  it("retire les espaces en début et fin", () => {
    expect(formatTagName("  bijoux  ")).toBe("Bijoux");
  });

  it("retourne une chaîne vide pour null, undefined ou vide", () => {
    expect(formatTagName(null)).toBe("");
    expect(formatTagName(undefined)).toBe("");
    expect(formatTagName("")).toBe("");
    expect(formatTagName("   ")).toBe("");
  });

  it("gère les tags d'un seul caractère", () => {
    expect(formatTagName("a")).toBe("A");
    expect(formatTagName("A")).toBe("A");
  });

  it("gère les traits d'union et apostrophes sans ajouter de capitalisation ailleurs", () => {
    expect(formatTagName("bracelet thaïlandais")).toBe("Bracelet thaïlandais");
    expect(formatTagName("d'été")).toBe("D'été");
    expect(formatTagName("boucles-d'oreilles")).toBe("Boucles-d'oreilles");
  });
});
