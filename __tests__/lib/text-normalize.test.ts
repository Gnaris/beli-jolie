import { describe, it, expect } from "vitest";
import { normalizeForCompare } from "@/lib/text-normalize";

describe("normalizeForCompare", () => {
  it("met en minuscules", () => {
    expect(normalizeForCompare("Collier")).toBe("collier");
  });

  it("retire les accents français courants", () => {
    expect(normalizeForCompare("Cœur")).toBe("coeur");
    expect(normalizeForCompare("éléphant")).toBe("elephant");
    expect(normalizeForCompare("À côté")).toBe("a cote");
  });

  it("garde les espaces et la ponctuation utile", () => {
    expect(normalizeForCompare("Boucles d'oreilles")).toBe("boucles d'oreilles");
  });

  it("réduit les espaces multiples en un seul", () => {
    expect(normalizeForCompare("  collier   ras  du cou  ")).toBe(
      "collier ras du cou",
    );
  });

  it("traite null/undefined comme chaîne vide", () => {
    expect(normalizeForCompare(null as unknown as string)).toBe("");
    expect(normalizeForCompare(undefined as unknown as string)).toBe("");
  });
});
