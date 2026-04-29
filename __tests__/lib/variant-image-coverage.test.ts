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
): VariantForCoverage => ({ id, colorId, colorName, imageCount });

describe("variantGroupKey", () => {
  it("renvoie le colorId comme clé de groupe", () => {
    expect(variantGroupKey(v("1", "argent", "Argent", 0))).toBe("argent");
  });

  it("renvoie une chaîne vide si colorId est null", () => {
    expect(variantGroupKey(v("1", null, null, 0))).toBe("");
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

  it("traite les variantes sans nom de couleur sans planter", () => {
    const missing = findMissingImageCoverage([v("orphan", null, null, 0)]);
    expect(missing).toHaveLength(1);
    expect(missing[0].label).toBe("variante");
  });
});
