import { describe, it, expect } from "vitest";
import {
  decidePrimaryRotation,
  type VariantForRotation,
} from "@/lib/auto-rotate-primary";

const variant = (
  colorId: string | null,
  stock: number,
  disabled = false,
): VariantForRotation => ({ colorId, stock, disabled });

describe("decidePrimaryRotation", () => {
  it("ne tourne pas si primaryColorId est null", () => {
    const result = decidePrimaryRotation(null, [variant("rouge", 5)]);
    expect(result).toEqual({ rotate: false, reason: "no-primary" });
  });

  it("ne tourne pas si la primary actuelle a encore du stock", () => {
    const result = decidePrimaryRotation("rouge", [
      variant("rouge", 3),
      variant("kaki", 0),
    ]);
    expect(result).toEqual({ rotate: false, reason: "primary-still-in-stock" });
  });

  it("ne tourne pas si toutes les couleurs sont à 0", () => {
    const result = decidePrimaryRotation("rouge", [
      variant("rouge", 0),
      variant("kaki", 0),
      variant("bleu", 0),
    ]);
    expect(result).toEqual({ rotate: false, reason: "no-alternative" });
  });

  it("bascule sur la 1ʳᵉ couleur en stock dans l'ordre fourni", () => {
    const result = decidePrimaryRotation("rouge", [
      variant("rouge", 0),
      variant("kaki", 0),
      variant("bleu", 4),
      variant("vert", 2),
    ]);
    expect(result).toEqual({ rotate: true, newPrimaryColorId: "bleu" });
  });

  it("somme le stock des variantes partageant la même colorId (UNIT + PACK)", () => {
    // Si la primary "rouge" a une variante UNIT à 0 mais une variante PACK
    // à 5 (même colorId), on considère que "rouge" est toujours en stock.
    const result = decidePrimaryRotation("rouge", [
      variant("rouge", 0),
      variant("rouge", 5),
      variant("kaki", 3),
    ]);
    expect(result).toEqual({ rotate: false, reason: "primary-still-in-stock" });
  });

  it("ignore les variantes disabled pour décider du stock", () => {
    // La seule variante "rouge" non disabled est à 0 → on bascule.
    const result = decidePrimaryRotation("rouge", [
      variant("rouge", 10, true), // disabled, ne compte pas
      variant("rouge", 0),
      variant("kaki", 7),
    ]);
    expect(result).toEqual({ rotate: true, newPrimaryColorId: "kaki" });
  });

  it("skip une couleur alternative entièrement disabled", () => {
    // "kaki" arrive avant "bleu" mais toutes ses variantes sont disabled
    // → on passe à "bleu".
    const result = decidePrimaryRotation("rouge", [
      variant("rouge", 0),
      variant("kaki", 5, true),
      variant("bleu", 3),
    ]);
    expect(result).toEqual({ rotate: true, newPrimaryColorId: "bleu" });
  });

  it("ignore les variantes avec colorId=null", () => {
    const result = decidePrimaryRotation("rouge", [
      variant(null, 100),
      variant("rouge", 0),
      variant("kaki", 2),
    ]);
    expect(result).toEqual({ rotate: true, newPrimaryColorId: "kaki" });
  });

  it("ne se choisit jamais elle-même comme alternative", () => {
    // Cas dégénéré : la primary apparaît plusieurs fois avec stock=0
    // partout. Aucune autre couleur → no-alternative.
    const result = decidePrimaryRotation("rouge", [
      variant("rouge", 0),
      variant("rouge", 0),
    ]);
    expect(result).toEqual({ rotate: false, reason: "no-alternative" });
  });

  it("retourne no-alternative si le produit n'a pas de variantes", () => {
    const result = decidePrimaryRotation("rouge", []);
    expect(result).toEqual({ rotate: false, reason: "no-alternative" });
  });
});
