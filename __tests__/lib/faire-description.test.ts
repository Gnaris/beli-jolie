import { describe, it, expect } from "vitest";
import { buildFaireDescription } from "@/lib/faire-description";

describe("buildFaireDescription", () => {
  it("ajoute composition + code SH après la description", () => {
    const out = buildFaireDescription(
      "Bracelet doré à porter au quotidien.",
      [
        { name: "Acier inoxydable 316L", percentage: 70 },
        { name: "Plaqué or 18 carats", percentage: 30 },
      ],
      "7117.19.00",
    );
    expect(out).toBe(
      "Bracelet doré à porter au quotidien.\n\n" +
      "Composition : Acier inoxydable 316L (70%), Plaqué or 18 carats (30%)\n\n" +
      "Code SH : 7117.19.00",
    );
  });

  it("omet la ligne code SH si vide ou null", () => {
    const out = buildFaireDescription(
      "Texte.",
      [{ name: "Acier 316L", percentage: 100 }],
      null,
    );
    expect(out).toBe("Texte.\n\nComposition : Acier 316L (100%)");
    expect(buildFaireDescription("Texte.", [{ name: "Acier", percentage: 100 }], "  ")).toBe(
      "Texte.\n\nComposition : Acier (100%)",
    );
  });

  it("omet la ligne composition si aucune ligne valide", () => {
    expect(buildFaireDescription("Desc.", [], "7117.19.00")).toBe("Desc.\n\nCode SH : 7117.19.00");
    expect(buildFaireDescription("Desc.", [{ name: "  ", percentage: 50 }], null)).toBe("Desc.");
  });

  it("omet le pourcentage si 0 ou non fini", () => {
    expect(buildFaireDescription("", [{ name: "Coton bio", percentage: 0 }], null))
      .toBe("Composition : Coton bio");
    expect(buildFaireDescription("", [{ name: "Lin", percentage: Number.NaN }], null))
      .toBe("Composition : Lin");
  });

  it("garde une décimale pour les pourcentages fractionnaires", () => {
    expect(buildFaireDescription("", [{ name: "Acier", percentage: 33.33 }], null))
      .toBe("Composition : Acier (33.3%)");
    expect(buildFaireDescription("", [{ name: "Or", percentage: 12.5 }], null))
      .toBe("Composition : Or (12.5%)");
  });

  it("tolère une description vide", () => {
    expect(buildFaireDescription("", [{ name: "Acier", percentage: 100 }], "7117"))
      .toBe("Composition : Acier (100%)\n\nCode SH : 7117");
  });

  it("trim la description de base", () => {
    expect(buildFaireDescription("  Texte.  \n", [], null)).toBe("Texte.");
  });
});
