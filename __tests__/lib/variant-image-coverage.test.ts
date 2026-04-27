import { describe, it, expect } from "vitest";
import {
  findMissingImageCoverage,
  variantGroupKey,
  type VariantForCoverage,
} from "@/lib/variant-image-coverage";

const v = (
  id: string,
  colorId: string | null,
  colorName: string | null,
  imageCount: number,
  subColors: { colorId: string; colorName?: string | null; position: number }[] = [],
): VariantForCoverage => ({ id, colorId, colorName, subColors, imageCount });

describe("variantGroupKey", () => {
  it("renvoie le colorId seul quand il n'y a pas de sous-couleurs", () => {
    expect(variantGroupKey(v("1", "argent", "Argent", 0))).toBe("argent");
  });

  it("trie les sous-couleurs par position pour un groupKey stable", () => {
    const a = variantGroupKey(
      v("1", "argent", "Argent", 0, [
        { colorId: "dore", position: 1 },
        { colorId: "noir", position: 0 },
      ]),
    );
    const b = variantGroupKey(
      v("2", "argent", "Argent", 0, [
        { colorId: "noir", position: 0 },
        { colorId: "dore", position: 1 },
      ]),
    );
    expect(a).toBe(b);
    expect(a).toBe("argent::noir,dore");
  });
});

describe("findMissingImageCoverage", () => {
  it("ne signale rien quand chaque couleur a au moins une image", () => {
    const missing = findMissingImageCoverage([
      v("1", "argent", "Argent", 2),
      v("2", "dore", "Doré", 1),
    ]);
    expect(missing).toEqual([]);
  });

  it("considère UNIT et PACK de la même couleur comme partageant les images", () => {
    // Le PACK porte les images, le UNIT n'en a aucune en BDD :
    // l'import PFS ne télécharge qu'une fois par couleur. Le contrôle ONLINE
    // doit donc considérer la couleur Argent comme couverte.
    const missing = findMissingImageCoverage([
      v("argent-pack", "argent", "Argent", 2),
      v("argent-unit", "argent", "Argent", 0),
    ]);
    expect(missing).toEqual([]);
  });

  it("signale une couleur quand aucune des variantes du groupe n'a d'image", () => {
    const missing = findMissingImageCoverage([
      v("argent-pack", "argent", "Argent", 2),
      v("dore-pack", "dore", "Doré", 0),
      v("dore-unit", "dore", "Doré", 0),
    ]);
    expect(missing).toHaveLength(1);
    expect(missing[0].label).toBe("Doré");
    expect(missing[0].variantIds.sort()).toEqual(["dore-pack", "dore-unit"]);
  });

  it("regroupe par composition complète (couleur + sous-couleurs)", () => {
    const missing = findMissingImageCoverage([
      v("argent-seul", "argent", "Argent", 2),
      v("argent+dore-1", "argent", "Argent", 0, [
        { colorId: "dore", colorName: "Doré", position: 0 },
      ]),
      v("argent+dore-2", "argent", "Argent", 0, [
        { colorId: "dore", colorName: "Doré", position: 0 },
      ]),
    ]);
    expect(missing).toHaveLength(1);
    expect(missing[0].label).toBe("Argent + Doré");
  });

  it("renvoie un libellé lisible avec sous-couleurs triées par position", () => {
    const missing = findMissingImageCoverage([
      v("multi", "argent", "Argent", 0, [
        { colorId: "dore", colorName: "Doré", position: 1 },
        { colorId: "noir", colorName: "Noir", position: 0 },
      ]),
    ]);
    expect(missing[0].label).toBe("Argent + Noir + Doré");
  });

  it("traite les variantes sans nom de couleur sans planter", () => {
    const missing = findMissingImageCoverage([v("orphan", null, null, 0)]);
    expect(missing).toHaveLength(1);
    expect(missing[0].label).toBe("variante");
  });
});
