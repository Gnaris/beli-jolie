import { describe, it, expect } from "vitest";
import {
  slugify,
  buildProductHandle,
  parseProductHandle,
} from "@/lib/product-url";

describe("slugify", () => {
  it("normalise les accents en ASCII", () => {
    expect(slugify("Collier bohème doré")).toBe("collier-boheme-dore");
    expect(slugify("Bracelet à l'étoile")).toBe("bracelet-a-l-etoile");
    expect(slugify("Cœur & Éclat")).toBe("c-ur-eclat");
  });

  it("retire la ponctuation et les emojis", () => {
    expect(slugify("Bague — édition limitée !")).toBe(
      "bague-edition-limitee",
    );
    expect(slugify("Boucles ★ or 18k")).toBe("boucles-or-18k");
  });

  it("collapse les séparateurs consécutifs", () => {
    expect(slugify("Collier    triple___rangs")).toBe(
      "collier-triple-rangs",
    );
  });

  it("trim les tirets début et fin", () => {
    expect(slugify("---Bijou fantaisie!!!")).toBe("bijou-fantaisie");
  });

  it("gère une chaîne vide ou uniquement de la ponctuation", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!!???")).toBe("");
    expect(slugify("   ")).toBe("");
  });

  it("tronque à 80 caractères sans laisser un tiret orphelin", () => {
    const long = "a".repeat(50) + " " + "b".repeat(50);
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("-")).toBe(false);
  });

  it("conserve les chiffres", () => {
    expect(slugify("Chaîne 2020 or 18k")).toBe("chaine-2020-or-18k");
  });
});

describe("buildProductHandle", () => {
  it("assemble un handle slug + reference", () => {
    expect(buildProductHandle("Collier bohème doré", "10019")).toBe(
      "collier-boheme-dore-10019",
    );
    expect(buildProductHandle("Bracelet argenté", "A2380")).toBe(
      "bracelet-argente-a2380",
    );
  });

  it("retombe sur la reference seule si le nom est vide", () => {
    expect(buildProductHandle("", "10019")).toBe("10019");
    expect(buildProductHandle("   ", "A2380")).toBe("a2380");
  });

  it("retombe sur le slug seul si la reference est vide (edge)", () => {
    expect(buildProductHandle("Bague simple", "")).toBe("bague-simple");
  });

  it("normalise une reference contenant des caractères spéciaux", () => {
    expect(buildProductHandle("Test", "REF-2024")).toBe("test-ref-2024");
  });
});

describe("parseProductHandle", () => {
  it("extrait la reference du dernier segment", () => {
    expect(parseProductHandle("collier-boheme-dore-10019")).toMatchObject({
      reference: "10019",
      legacyCuid: null,
    });
    expect(parseProductHandle("bracelet-argente-a2380")).toMatchObject({
      reference: "a2380",
      legacyCuid: null,
    });
  });

  it("détecte un cuid legacy pour redirection 301", () => {
    expect(parseProductHandle("cms7oy6sk001g945p63xk5ffc")).toMatchObject({
      reference: null,
      legacyCuid: "cms7oy6sk001g945p63xk5ffc",
    });
  });

  it("gère une URL avec la reference seule (pas de tiret)", () => {
    expect(parseProductHandle("10019")).toMatchObject({
      reference: "10019",
      legacyCuid: null,
    });
    expect(parseProductHandle("a2380")).toMatchObject({
      reference: "a2380",
      legacyCuid: null,
    });
  });

  it("gère une chaîne vide", () => {
    expect(parseProductHandle("")).toMatchObject({
      reference: null,
      legacyCuid: null,
    });
  });

  it("gère une URL encodée", () => {
    expect(parseProductHandle("collier%20boheme-10019")).toMatchObject({
      reference: "10019",
      legacyCuid: null,
    });
  });

  it("est insensible à la casse", () => {
    expect(parseProductHandle("Collier-BOHEME-10019")).toMatchObject({
      reference: "10019",
      legacyCuid: null,
    });
  });
});

describe("parseProductHandle — références avec parenthèses", () => {
  // Contexte : les refs dupliquées par refresh (`A2251(2)`, `A2251(3)`…)
  // sont slugifiées en `a2251-2` (parens → tiret). `lastIndexOf("-")` extrait
  // alors `2` comme reference, qui ne matche aucun produit → 404.
  it("propose A2251(2) en candidat quand le suffixe est un chiffre isolé", () => {
    const parsed = parseProductHandle(
      "lot-de-3-paires-boucles-d-oreilles-creoles-en-acier-inoxydable-a2251-2",
    );
    expect(parsed.referenceCandidates).toContain("a2251(2)");
  });

  it("propose aussi le tail brut comme premier candidat (comportement historique)", () => {
    const parsed = parseProductHandle("bracelet-argente-a2380");
    expect(parsed.referenceCandidates[0]).toBe("a2380");
  });

  it("reconstruit depuis le format underscore _N (nouveau slugify potentiel)", () => {
    const parsed = parseProductHandle("collier-a2251_2");
    expect(parsed.referenceCandidates).toContain("a2251(2)");
  });

  it("ne fabrique pas de candidat parasite quand le suffixe n'est pas numérique", () => {
    const parsed = parseProductHandle("bracelet-argente-a2380");
    expect(parsed.referenceCandidates.every((c) => !c.includes("("))).toBe(true);
  });
});

describe("roundtrip build → parse", () => {
  const samples = [
    { name: "Collier bohème doré", reference: "10019" },
    { name: "Bracelet argenté", reference: "A2380" },
    { name: "Boucles d'oreilles ★ or 18k", reference: "12039" },
    { name: "Chaîne fine 45cm", reference: "10056" },
  ];

  it.each(samples)(
    "extrait la ref d'un handle produit par $reference",
    ({ name, reference }) => {
      const handle = buildProductHandle(name, reference);
      const parsed = parseProductHandle(handle);
      expect(parsed.reference).toBe(reference.toLowerCase());
      expect(parsed.legacyCuid).toBeNull();
    },
  );
});
