import { describe, it, expect } from "vitest";
import { buildFaireDescription } from "@/lib/faire-description";

describe("buildFaireDescription", () => {
  it("ajoute la composition après la description", () => {
    const out = buildFaireDescription(
      "Bracelet doré à porter au quotidien.",
      [
        { name: "Acier inoxydable 316L", percentage: 70 },
        { name: "Plaqué or 18 carats", percentage: 30 },
      ],
    );
    expect(out).toBe(
      "Bracelet doré à porter au quotidien.\n\n" +
      "Composition : Acier inoxydable 316L (70%), Plaqué or 18 carats (30%)",
    );
  });

  it("omet la ligne composition si aucune ligne valide", () => {
    expect(buildFaireDescription("Desc.", [])).toBe("Desc.");
    expect(buildFaireDescription("Desc.", [{ name: "  ", percentage: 50 }])).toBe("Desc.");
  });

  it("omet le pourcentage si 0 ou non fini", () => {
    expect(buildFaireDescription("", [{ name: "Coton bio", percentage: 0 }]))
      .toBe("Composition : Coton bio");
    expect(buildFaireDescription("", [{ name: "Lin", percentage: Number.NaN }]))
      .toBe("Composition : Lin");
  });

  it("garde une décimale pour les pourcentages fractionnaires", () => {
    expect(buildFaireDescription("", [{ name: "Acier", percentage: 33.33 }]))
      .toBe("Composition : Acier (33.3%)");
    expect(buildFaireDescription("", [{ name: "Or", percentage: 12.5 }]))
      .toBe("Composition : Or (12.5%)");
  });

  it("tolère une description vide", () => {
    expect(buildFaireDescription("", [{ name: "Acier", percentage: 100 }]))
      .toBe("Composition : Acier (100%)");
  });

  it("trim la description de base", () => {
    expect(buildFaireDescription("  Texte.  \n", [])).toBe("Texte.");
  });

  it("n'ajoute jamais de ligne « Code SH » dans la description", () => {
    const out = buildFaireDescription(
      "Bracelet.",
      [{ name: "Acier", percentage: 100 }],
    );
    expect(out).not.toMatch(/Code SH/i);
  });
});
