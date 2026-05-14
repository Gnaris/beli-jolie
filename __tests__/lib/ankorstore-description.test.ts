import { describe, it, expect } from "vitest";
import {
  formatAnkorstoreCompositionLabel,
  formatAnkorstoreDescription,
} from "@/lib/ankorstore-description";

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

  it("diamètre renseigné → ligne 'Diamètre : X cm' dans la description", () => {
    const out = formatAnkorstoreDescription({
      description: "Bague.",
      reference: "REF",
      dimensionDiameter: 18,
    });
    expect(out).toContain("Diamètre : 18 cm");
  });

  it("circonférence renseignée → ligne 'Circonférence : X cm' dans la description", () => {
    const out = formatAnkorstoreDescription({
      description: "Bracelet.",
      reference: "REF",
      dimensionCircumference: 56,
    });
    expect(out).toContain("Circonférence : 56 cm");
  });

  it("diamètre + circonférence combinés sur la même ligne avec séparateur", () => {
    const out = formatAnkorstoreDescription({
      description: "Bague.",
      reference: "REF",
      dimensionDiameter: 18,
      dimensionCircumference: 56,
    });
    expect(out).toContain("Diamètre : 18 cm · Circonférence : 56 cm");
  });

  it("ignore les diamètre/circonférence à 0 ou null", () => {
    const out = formatAnkorstoreDescription({
      description: "Produit standard avec description suffisamment longue.",
      reference: "REF",
      dimensionDiameter: null,
      dimensionCircumference: 0,
    });
    expect(out).not.toContain("Diamètre");
    expect(out).not.toContain("Circonférence");
  });
});

describe("formatAnkorstoreCompositionLabel", () => {
  it("retourne null quand aucune composition n'est fournie", () => {
    expect(formatAnkorstoreCompositionLabel(undefined)).toBeNull();
    expect(formatAnkorstoreCompositionLabel([])).toBeNull();
  });

  it("retourne le format 'X% Nom' pour une composition unique", () => {
    expect(
      formatAnkorstoreCompositionLabel([
        { percentage: 100, composition: { nameFR: "Acier inoxydable" } },
      ]),
    ).toBe("100% Acier inoxydable");
  });

  it("concatène plusieurs compositions séparées par virgule + espace", () => {
    expect(
      formatAnkorstoreCompositionLabel([
        { percentage: 50, composition: { nameFR: "Acier inoxydable" } },
        { percentage: 50, composition: { nameFR: "Laiton" } },
      ]),
    ).toBe("50% Acier inoxydable, 50% Laiton");
  });

  it("ignore les compositions sans nom (vide ou que des espaces)", () => {
    expect(
      formatAnkorstoreCompositionLabel([
        { percentage: 50, composition: { nameFR: "" } },
        { percentage: 50, composition: { nameFR: "   " } },
      ]),
    ).toBeNull();
  });

  it("garde uniquement les compositions valides quand mix vide/rempli", () => {
    expect(
      formatAnkorstoreCompositionLabel([
        { percentage: 60, composition: { nameFR: "Coton" } },
        { percentage: 40, composition: { nameFR: "" } },
      ]),
    ).toBe("60% Coton");
  });

  it("convertit percentage objet ({toString}) en number propre", () => {
    expect(
      formatAnkorstoreCompositionLabel([
        { percentage: { toString: () => "92.5" }, composition: { nameFR: "Argent 925" } },
      ]),
    ).toBe("92.5% Argent 925");
  });
});
