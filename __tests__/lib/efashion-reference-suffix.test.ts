/**
 * Suffixe de ref eFashion pour désambiguïser plusieurs ProductColor BJ
 * partageant la même `Color`.
 *
 * Contexte : eFashion crée 1 fiche par ProductColor et compose la ref en
 * concaténant `product.reference` + le nom de la couleur (ex "10037-NOIR").
 * Quand BJ a plusieurs ProductColor sur la même Color (typiquement pour vendre
 * 3 combos de tailles S/M · M/L · L/XL comme des lots UNIT distincts),
 * les 3 fiches eFashion héritent de la même ref → conflit d'unicité au push.
 *
 * `computeEfashionReferenceSuffixes` renvoie une map `key → suffix` :
 *  - vide quand toutes les couleurs sont uniques
 *  - `suffix` dérivé du nom de taille pour les couleurs partagées (S/M → SM)
 *  - fallback ordinal (1, 2, 3…) quand la taille est vide
 *  - déduplication (SM, SM-2, SM-3) si 2 variants portent exactement la même
 *    taille sur la même couleur
 */
import { describe, it, expect } from "vitest";
import { computeEfashionReferenceSuffixes } from "@/lib/efashion-reference-suffix";

describe("computeEfashionReferenceSuffixes", () => {
  it("retourne une map vide quand chaque ProductColor pointe vers une Color différente", () => {
    const result = computeEfashionReferenceSuffixes([
      { key: "v1", colorId: "c-noir", sizeName: "S/M" },
      { key: "v2", colorId: "c-bordeaux", sizeName: "S/M" },
      { key: "v3", colorId: "c-brun", sizeName: "S/M" },
    ]);
    expect(result.size).toBe(0);
  });

  it("suffixe les variants qui partagent une Color avec le nom de taille sanitizé", () => {
    const result = computeEfashionReferenceSuffixes([
      { key: "v1", colorId: "c-noir", sizeName: "S/M" },
      { key: "v2", colorId: "c-noir", sizeName: "M/L" },
      { key: "v3", colorId: "c-noir", sizeName: "L/XL" },
    ]);
    expect(result.get("v1")).toBe("SM");
    expect(result.get("v2")).toBe("ML");
    expect(result.get("v3")).toBe("LXL");
  });

  it("sanitize les noms de taille (espaces, slash, casse)", () => {
    const result = computeEfashionReferenceSuffixes([
      { key: "v1", colorId: "c-noir", sizeName: "36 / 38" },
      { key: "v2", colorId: "c-noir", sizeName: "Taille unique" },
    ]);
    expect(result.get("v1")).toBe("3638");
    expect(result.get("v2")).toBe("TAILLEUNIQUE");
  });

  it("retombe sur un suffixe ordinal quand aucune taille n'est renseignée", () => {
    const result = computeEfashionReferenceSuffixes([
      { key: "v1", colorId: "c-noir", sizeName: null },
      { key: "v2", colorId: "c-noir", sizeName: null },
    ]);
    expect(result.get("v1")).toBe("1");
    expect(result.get("v2")).toBe("2");
  });

  it("dédoublonne le suffixe quand 2 variants ont exactement la même taille", () => {
    const result = computeEfashionReferenceSuffixes([
      { key: "v1", colorId: "c-noir", sizeName: "S/M" },
      { key: "v2", colorId: "c-noir", sizeName: "S/M" },
    ]);
    expect(result.get("v1")).toBe("SM");
    expect(result.get("v2")).toBe("SM-2");
  });

  it("gère plusieurs couleurs partagées en parallèle sans les mélanger", () => {
    const result = computeEfashionReferenceSuffixes([
      { key: "n1", colorId: "c-noir", sizeName: "S/M" },
      { key: "n2", colorId: "c-noir", sizeName: "M/L" },
      { key: "b1", colorId: "c-bordeaux", sizeName: "S/M" },
      { key: "b2", colorId: "c-bordeaux", sizeName: "L/XL" },
      { key: "u1", colorId: "c-brun", sizeName: "S/M" }, // unique, pas de suffixe
    ]);
    expect(result.get("n1")).toBe("SM");
    expect(result.get("n2")).toBe("ML");
    expect(result.get("b1")).toBe("SM");
    expect(result.get("b2")).toBe("LXL");
    expect(result.has("u1")).toBe(false);
  });

  it("ignore les variants dont colorId est null (pas d'ambiguïté possible)", () => {
    const result = computeEfashionReferenceSuffixes([
      { key: "v1", colorId: null, sizeName: "S/M" },
      { key: "v2", colorId: null, sizeName: "M/L" },
    ]);
    expect(result.size).toBe(0);
  });
});
