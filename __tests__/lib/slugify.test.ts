import { describe, it, expect } from "vitest";
import { slugify } from "@/lib/storage";

describe("slugify", () => {
  it("supprime les diacritiques latins courants", () => {
    expect(slugify("Été")).toBe("ete");
    expect(slugify("Éclat d'automne")).toBe("eclat-dautomne");
    expect(slugify("Ça va très bien")).toBe("ca-va-tres-bien");
  });

  it("normalise l'apostrophe typographique et l'em/en dash", () => {
    // Bug reproduit sur Issyma : slug BDD "eclat-d’automne-—-automnehiver-2026"
    // → 404 Next 16 (cache ISR + URL Unicode pourcent-encodée).
    expect(slugify("ÉCLAT D’AUTOMNE — Automne/Hiver 2026")).toBe(
      "eclat-dautomne-automnehiver-2026"
    );
    expect(slugify("Piña – Colada")).toBe("pina-colada");
  });

  it("laisse uniquement des caractères ASCII sûrs pour une URL", () => {
    // Tous les cas piégeux vus en prod : parenthèses, guillemets, symboles.
    expect(slugify("Bracelet « spécial » 100€")).toBe("bracelet-special-100");
    expect(slugify("Modèle A2251(2)")).toBe("modele-a2251_2");
    expect(slugify("Rêve/hiver")).toBe("revehiver");
    expect(slugify("web.dev")).toBe("webdev");
  });

  it("gère les cas nuls ou vides", () => {
    expect(slugify("")).toBe("sans-nom");
    expect(slugify("   ")).toBe("sans-nom");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(slugify(null as any)).toBe("sans-nom");
  });

  it("collapse les tirets répétés et rogne les bords", () => {
    expect(slugify("---foo---bar---")).toBe("foo-bar");
    expect(slugify("foo   bar")).toBe("foo-bar");
  });
});
