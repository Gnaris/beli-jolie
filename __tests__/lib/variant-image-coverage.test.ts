import { describe, it, expect } from "vitest";
import {
  anyVariantHasImage,
  colorIdsWithImages,
  filterVariantsByColorIdSet,
  filterVariantsWithImages,
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

describe("anyVariantHasImage", () => {
  it("false quand aucune variante n'a d'image", () => {
    expect(anyVariantHasImage([
      v("a", "argent", "Argent", 0),
      v("b", "dore", "Doré", 0),
    ])).toBe(false);
  });

  it("true dès qu'une seule couleur a au moins une image", () => {
    // Règle assouplie : on autorise le ONLINE même si certaines couleurs
    // n'ont pas d'image — elles seront simplement masquées côté public.
    expect(anyVariantHasImage([
      v("a", "argent", "Argent", 2),
      v("b", "dore", "Doré", 0),
    ])).toBe(true);
  });

  it("UNIT et PACK partagent les images du même colorId", () => {
    // Le PACK porte les images, le UNIT n'en a pas : la couleur est couverte.
    expect(anyVariantHasImage([
      v("argent-unit", "argent", "Argent", 0),
      v("argent-pack", "argent", "Argent", 3),
    ])).toBe(true);
  });

  it("false pour une liste vide", () => {
    expect(anyVariantHasImage([])).toBe(false);
  });
});

describe("colorIdsWithImages", () => {
  it("renvoie le Set des colorId présents dans la liste d'images", () => {
    const set = colorIdsWithImages([
      { colorId: "argent" },
      { colorId: "argent" },
      { colorId: "dore" },
    ]);
    expect([...set].sort()).toEqual(["argent", "dore"]);
  });

  it("renvoie un Set vide pour une liste vide", () => {
    expect(colorIdsWithImages([]).size).toBe(0);
  });
});

describe("filterVariantsWithImages", () => {
  type V = { id: string; colorId: string | null; saleType: "UNIT" | "PACK" };

  it("ne garde que les variantes dont le colorId est présent dans colorImages", () => {
    // C'est le filtre appliqué côté push marketplace : on n'envoie jamais
    // une variante dont la couleur n'a aucune image.
    const variants: V[] = [
      { id: "v1", colorId: "argent", saleType: "UNIT" },
      { id: "v2", colorId: "dore", saleType: "UNIT" },
      { id: "v3", colorId: "noir", saleType: "PACK" },
    ];
    const result = filterVariantsWithImages(variants, [
      { colorId: "argent" },
      { colorId: "noir" },
    ]);
    expect(result.map((v) => v.id)).toEqual(["v1", "v3"]);
  });

  it("exclut les variantes sans colorId", () => {
    const variants: V[] = [
      { id: "ghost", colorId: null, saleType: "UNIT" },
    ];
    const result = filterVariantsWithImages(variants, [{ colorId: "argent" }]);
    expect(result).toEqual([]);
  });

  it("renvoie une liste vide si aucune couleur n'a d'image", () => {
    // Scénario de la cliente : un produit n'a aucune image → on n'envoie
    // rien aux marketplaces. C'est l'auto-OFFLINE qui prend le relais.
    const variants: V[] = [
      { id: "v1", colorId: "argent", saleType: "UNIT" },
    ];
    expect(filterVariantsWithImages(variants, [])).toEqual([]);
  });
});

describe("filterVariantsByColorIdSet", () => {
  type V = { id: string; colorId: string | null };

  it("filtre par Set<colorId> directement", () => {
    const result = filterVariantsByColorIdSet<V>(
      [
        { id: "v1", colorId: "argent" },
        { id: "v2", colorId: "dore" },
      ],
      new Set(["argent"]),
    );
    expect(result.map((v) => v.id)).toEqual(["v1"]);
  });

  it("exclut les variantes sans colorId", () => {
    const result = filterVariantsByColorIdSet<V>(
      [{ id: "v1", colorId: null }],
      new Set(["argent"]),
    );
    expect(result).toEqual([]);
  });
});
