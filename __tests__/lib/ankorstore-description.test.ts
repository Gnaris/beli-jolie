import { describe, it, expect } from "vitest";
import { formatAnkorstoreDescription } from "@/lib/ankorstore-description";

describe("formatAnkorstoreDescription", () => {
  it("ajoute composition et référence en bas", () => {
    const out = formatAnkorstoreDescription({
      description: "Belle bague en argent.",
      reference: "BAG001",
      compositions: [{ percentage: 92.5, composition: { nameFR: "Argent 925" } }],
    });
    expect(out).toContain("Belle bague en argent.");
    expect(out).toContain("Composition : 92.5% Argent 925");
    expect(out).toContain("Référence : BAG001");
  });

  it("plusieurs compositions séparées par virgule", () => {
    const out = formatAnkorstoreDescription({
      description: "Produit",
      reference: "REF",
      compositions: [
        { percentage: 80, composition: { nameFR: "Coton" } },
        { percentage: 20, composition: { nameFR: "Polyester" } },
      ],
    });
    expect(out).toContain("80% Coton, 20% Polyester");
  });

  it("description vide → placeholder + min 30 chars", () => {
    const out = formatAnkorstoreDescription({ description: "", reference: "X" });
    expect(out.length).toBeGreaterThanOrEqual(30);
    expect(out).toContain("Produit de notre boutique");
  });

  it("description très courte → ajoute le filler 30 chars", () => {
    const out = formatAnkorstoreDescription({ description: "OK", reference: "X" });
    expect(out.length).toBeGreaterThanOrEqual(30);
  });

  it("aucune composition → pas de ligne Composition", () => {
    const out = formatAnkorstoreDescription({ description: "Bonjour le monde", reference: "REF" });
    expect(out).not.toContain("Composition");
  });
});
