import { describe, it, expect } from "vitest";
import { pickFirstImage } from "@/lib/pick-first-image";

/** Helper : construit la fonction de lookup à partir d'une map plate. */
function lookup(map: Record<string, string>) {
  return (colorId: string | null) => (colorId ? map[colorId] ?? null : null);
}

describe("pickFirstImage", () => {
  it("retourne null quand aucune couleur n'a d'image", () => {
    expect(pickFirstImage(
      [
        { isPrimary: true,  colorId: "doré" },
        { isPrimary: false, colorId: "argent" },
      ],
      lookup({}),
    )).toBeNull();
  });

  it("renvoie l'image de la couleur de la variante principale", () => {
    expect(pickFirstImage(
      [
        { isPrimary: false, colorId: "argent" },
        { isPrimary: true,  colorId: "doré" },
      ],
      lookup({ argent: "/argent.webp", doré: "/dore.webp" }),
    )).toBe("/dore.webp");
  });

  // Cas réel G292 : 4 variantes (UNIT + PACK pour Argent et Doré).
  // L'image est rattachée à la couleur Doré, peu importe quelle variante
  // précise est marquée principale parmi celles partageant cette couleur.
  it("partage l'image entre toutes les variantes d'une même couleur", () => {
    const colorImages = lookup({ doré: "/dore.webp", argent: "/argent.webp" });
    // La variante Doré "principale" n'a pas d'image en propre, mais Doré
    // (en tant que couleur du produit) en a une → on l'affiche quand même.
    expect(pickFirstImage(
      [
        { isPrimary: false, colorId: "argent" },
        { isPrimary: false, colorId: "argent" },
        { isPrimary: false, colorId: "doré" },
        { isPrimary: true,  colorId: "doré" },
      ],
      colorImages,
    )).toBe("/dore.webp");
  });

  it("préfère la variante principale la plus récente quand plusieurs sont marquées", () => {
    expect(pickFirstImage(
      [
        { isPrimary: true,  colorId: "argent" },
        { isPrimary: true,  colorId: "doré" },
      ],
      lookup({ argent: "/argent.webp", doré: "/dore.webp" }),
    )).toBe("/dore.webp");
  });

  it("retombe sur une autre couleur si la couleur principale n'a aucune image", () => {
    expect(pickFirstImage(
      [
        { isPrimary: false, colorId: "argent" },
        { isPrimary: true,  colorId: "doré" },
      ],
      lookup({ argent: "/argent.webp" }), // doré absent
    )).toBe("/argent.webp");
  });

  it("ignore les variantes principales avec colorId null pour le fallback couleur", () => {
    expect(pickFirstImage(
      [
        { isPrimary: false, colorId: "argent" },
        { isPrimary: true,  colorId: null },
      ],
      lookup({ argent: "/argent.webp" }),
    )).toBe("/argent.webp");
  });

  it("retombe sur la 1ʳᵉ couleur avec image si aucune principale n'est définie", () => {
    expect(pickFirstImage(
      [
        { isPrimary: false, colorId: "argent" },
        { isPrimary: false, colorId: "doré" },
      ],
      lookup({ doré: "/dore.webp" }),
    )).toBe("/dore.webp");
  });
});
