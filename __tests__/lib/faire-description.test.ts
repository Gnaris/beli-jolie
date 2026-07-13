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

  describe("ligne taille", () => {
    it("écrit « Taille Unique (38-42) » si la seule taille est « Taille Unique » et sizeDetailsTu renseigné", () => {
      const out = buildFaireDescription("Bague.", [], {
        sizes: ["Taille Unique"],
        sizeDetailsTu: "38-42",
      });
      expect(out).toBe("Bague.\n\nTaille Unique (38-42)");
    });

    it("écrit « Taille Unique (52-56) » quand le nom est « TU » (alias)", () => {
      const out = buildFaireDescription("Bague.", [], {
        sizes: ["TU"],
        sizeDetailsTu: "52-56",
      });
      expect(out).toBe("Bague.\n\nTaille Unique (52-56)");
    });

    it("écrit juste « Taille Unique » (sans parenthèses) si sizeDetailsTu vide", () => {
      const out = buildFaireDescription("Bague.", [], {
        sizes: ["Taille Unique"],
        sizeDetailsTu: null,
      });
      expect(out).toBe("Bague.\n\nTaille Unique");
    });

    it("écrit « Tailles : X, Y, Z » quand plusieurs tailles distinctes", () => {
      const out = buildFaireDescription("Bague.", [], {
        sizes: ["XS", "S", "M"],
      });
      expect(out).toBe("Bague.\n\nTailles : XS, S, M");
    });

    it("dédup les doublons quand la même taille revient sur plusieurs couleurs", () => {
      const out = buildFaireDescription("Bague.", [], {
        sizes: ["S", "M", "S", "M", "L"],
      });
      expect(out).toBe("Bague.\n\nTailles : S, M, L");
    });

    it("écrit « Taille : S » quand une seule taille distincte non-unique", () => {
      const out = buildFaireDescription("Bague.", [], {
        sizes: ["S", "S"],
      });
      expect(out).toBe("Bague.\n\nTaille : S");
    });

    it("omet la ligne taille si aucune taille fournie", () => {
      const out = buildFaireDescription("Bague.", [], { sizes: [] });
      expect(out).toBe("Bague.");
    });

    it("ignore les tailles vides ou en espaces", () => {
      const out = buildFaireDescription("Bague.", [], {
        sizes: ["", "   ", "S"],
      });
      expect(out).toBe("Bague.\n\nTaille : S");
    });
  });

  describe("ligne « Made in »", () => {
    it("ajoute « Made in China » quand madeInCountryEn = « China »", () => {
      const out = buildFaireDescription("Bague.", [], { madeInCountryEn: "China" });
      expect(out).toBe("Bague.\n\nMade in China");
    });

    it("ajoute « Made in France »", () => {
      const out = buildFaireDescription("Bague.", [], { madeInCountryEn: "France" });
      expect(out).toBe("Bague.\n\nMade in France");
    });

    it("omet la ligne si madeInCountryEn est null / vide", () => {
      expect(buildFaireDescription("Bague.", [], { madeInCountryEn: null })).toBe("Bague.");
      expect(buildFaireDescription("Bague.", [], { madeInCountryEn: "   " })).toBe("Bague.");
      expect(buildFaireDescription("Bague.", [])).toBe("Bague.");
    });
  });

  it("combine description + composition + taille + made in dans l'ordre attendu", () => {
    const out = buildFaireDescription(
      "Bracelet doré à porter au quotidien.",
      [{ name: "Acier inoxydable 316L", percentage: 100 }],
      {
        sizes: ["Taille Unique"],
        sizeDetailsTu: "38-42",
        madeInCountryEn: "China",
      },
    );
    expect(out).toBe(
      "Bracelet doré à porter au quotidien.\n\n" +
      "Composition : Acier inoxydable 316L (100%)\n\n" +
      "Taille Unique (38-42)\n\n" +
      "Made in China",
    );
  });
});
