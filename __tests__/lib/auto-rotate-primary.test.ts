import { describe, it, expect } from "vitest";
import { decidePrimaryRotation } from "@/lib/auto-rotate-primary";

/**
 * decidePrimaryRotation — logique pure.
 *
 * La règle métier tient dans trois cas :
 *   1) couleur principale en rupture + au moins 1 autre couleur dispo → rotation
 *   2) couleur principale dispo → jamais de rotation
 *   3) toutes les couleurs en rupture → pas de rotation (produit HS complet)
 */

describe("decidePrimaryRotation", () => {
  it("retourne null quand la couleur principale actuelle n'est pas définie", () => {
    const result = decidePrimaryRotation({
      currentPrimaryColorId: null,
      colors: [
        { colorId: "bleu", stock: 0, disabled: false },
        { colorId: "rouge", stock: 5, disabled: false },
      ],
    });
    expect(result).toBeNull();
  });

  it("retourne null quand la couleur principale a encore du stock", () => {
    const result = decidePrimaryRotation({
      currentPrimaryColorId: "bleu",
      colors: [
        { colorId: "bleu", stock: 3, disabled: false },
        { colorId: "rouge", stock: 0, disabled: false },
      ],
    });
    expect(result).toBeNull();
  });

  it("bascule vers la 1ʳᵉ couleur dispo quand la principale est à 0", () => {
    const result = decidePrimaryRotation({
      currentPrimaryColorId: "bleu",
      colors: [
        { colorId: "bleu", stock: 0, disabled: false },
        { colorId: "rouge", stock: 4, disabled: false },
        { colorId: "vert", stock: 7, disabled: false },
      ],
    });
    expect(result).toEqual({ nextPrimaryColorId: "rouge" });
  });

  it("respecte l'ordre du tableau colors pour choisir la nouvelle principale", () => {
    // Ordre : vert, rouge, bleu — bleu est la principale actuelle, elle est
    // à 0. Vert est en rupture, rouge a du stock → rouge gagne.
    const result = decidePrimaryRotation({
      currentPrimaryColorId: "bleu",
      colors: [
        { colorId: "vert", stock: 0, disabled: false },
        { colorId: "rouge", stock: 4, disabled: false },
        { colorId: "bleu", stock: 0, disabled: false },
      ],
    });
    expect(result).toEqual({ nextPrimaryColorId: "rouge" });
  });

  it("ne bascule pas quand TOUTES les couleurs sont en rupture (rupture totale)", () => {
    const result = decidePrimaryRotation({
      currentPrimaryColorId: "bleu",
      colors: [
        { colorId: "bleu", stock: 0, disabled: false },
        { colorId: "rouge", stock: 0, disabled: false },
        { colorId: "vert", stock: 0, disabled: false },
      ],
    });
    expect(result).toBeNull();
  });

  it("traite une variante disabled comme si elle était en rupture", () => {
    const result = decidePrimaryRotation({
      currentPrimaryColorId: "bleu",
      colors: [
        // Bleu a du stock mais est désactivée → traitée en rupture
        { colorId: "bleu", stock: 10, disabled: true },
        { colorId: "rouge", stock: 3, disabled: false },
      ],
    });
    expect(result).toEqual({ nextPrimaryColorId: "rouge" });
  });

  it("agrège les variantes d'une même couleur : couleur dispo si AU MOINS 1 variante ok", () => {
    // Bleu a 2 variantes : une à 0 et une à 5 → bleu reste dispo → pas de rotation
    const result = decidePrimaryRotation({
      currentPrimaryColorId: "bleu",
      colors: [
        { colorId: "bleu", stock: 0, disabled: false },
        { colorId: "bleu", stock: 5, disabled: false },
        { colorId: "rouge", stock: 2, disabled: false },
      ],
    });
    expect(result).toBeNull();
  });

  it("agrège aussi côté candidate : une couleur est éligible si au moins 1 variante ok", () => {
    // Rouge a 2 variantes : 0 et 3 → rouge dispo → rouge gagne
    const result = decidePrimaryRotation({
      currentPrimaryColorId: "bleu",
      colors: [
        { colorId: "bleu", stock: 0, disabled: false },
        { colorId: "rouge", stock: 0, disabled: false },
        { colorId: "rouge", stock: 3, disabled: false },
      ],
    });
    expect(result).toEqual({ nextPrimaryColorId: "rouge" });
  });

  it("ignore les variantes sans colorId (legacy)", () => {
    const result = decidePrimaryRotation({
      currentPrimaryColorId: "bleu",
      colors: [
        { colorId: null, stock: 99, disabled: false },
        { colorId: "bleu", stock: 0, disabled: false },
        { colorId: "rouge", stock: 5, disabled: false },
      ],
    });
    expect(result).toEqual({ nextPrimaryColorId: "rouge" });
  });

  it("scénario retour de stock : produit HS complet + une AUTRE couleur revient → rotation", () => {
    // Contexte : produit était totalement HS (toutes les couleurs à 0), la
    // couleur principale reste "bleu". On remet 5 unités sur rouge. La
    // principale (bleu) est toujours en rupture, rouge est dispo → rotation.
    const result = decidePrimaryRotation({
      currentPrimaryColorId: "bleu",
      colors: [
        { colorId: "bleu", stock: 0, disabled: false },
        { colorId: "rouge", stock: 5, disabled: false },
        { colorId: "vert", stock: 0, disabled: false },
      ],
    });
    expect(result).toEqual({ nextPrimaryColorId: "rouge" });
  });

  it("scénario retour de stock : la principale est aussi remise en stock → pas de rotation", () => {
    // Cas explicité par la cliente : si la principale a aussi retrouvé du
    // stock en même temps, on ne touche à rien (elle reste en tête).
    const result = decidePrimaryRotation({
      currentPrimaryColorId: "bleu",
      colors: [
        { colorId: "bleu", stock: 2, disabled: false },
        { colorId: "rouge", stock: 5, disabled: false },
        { colorId: "vert", stock: 0, disabled: false },
      ],
    });
    expect(result).toBeNull();
  });

  it("gère le cas où la couleur principale ne fait plus partie du produit (variante supprimée)", () => {
    // primaryColorId pointe vers "bleu" mais bleu n'existe plus dans colors
    // → considéré comme en rupture → rotation vers 1ʳᵉ dispo
    const result = decidePrimaryRotation({
      currentPrimaryColorId: "bleu",
      colors: [
        { colorId: "rouge", stock: 5, disabled: false },
        { colorId: "vert", stock: 3, disabled: false },
      ],
    });
    expect(result).toEqual({ nextPrimaryColorId: "rouge" });
  });
});
