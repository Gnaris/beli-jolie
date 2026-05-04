import { describe, it, expect } from "vitest";
import { pickFirstImage } from "@/lib/pick-first-image";

/** Helper : construit la fonction de lookup à partir d'une map plate. */
function lookup(map: Record<string, string>) {
  return (colorId: string | null) => (colorId ? map[colorId] ?? null : null);
}

/** Helper : construit un objet ProductWithColors. */
function product(
  colors: { isPrimary: boolean; colorId: string | null }[],
  primaryColorId: string | null = null,
) {
  return { primaryColorId, colors };
}

describe("pickFirstImage", () => {
  it("retourne null quand aucune couleur n'a d'image", () => {
    expect(pickFirstImage(
      product([
        { isPrimary: true,  colorId: "doré" },
        { isPrimary: false, colorId: "argent" },
      ]),
      lookup({}),
    )).toBeNull();
  });

  it("renvoie l'image de la couleur principale (depuis primaryColorId)", () => {
    expect(pickFirstImage(
      product([
        { isPrimary: false, colorId: "argent" },
        { isPrimary: false, colorId: "doré" },
      ], "doré"),
      lookup({ argent: "/argent.webp", doré: "/dore.webp" }),
    )).toBe("/dore.webp");
  });

  it("fallback : utilise isPrimary quand primaryColorId est null", () => {
    expect(pickFirstImage(
      product([
        { isPrimary: false, colorId: "argent" },
        { isPrimary: true,  colorId: "doré" },
      ]),
      lookup({ argent: "/argent.webp", doré: "/dore.webp" }),
    )).toBe("/dore.webp");
  });

  // Cas réel G292 : 4 variantes (UNIT + PACK pour Argent et Doré).
  // L'image est rattachée à la couleur Doré au niveau du produit.
  it("partage l'image entre toutes les variantes d'une même couleur", () => {
    expect(pickFirstImage(
      product([
        { isPrimary: false, colorId: "argent" },
        { isPrimary: false, colorId: "argent" },
        { isPrimary: false, colorId: "doré" },
        { isPrimary: false, colorId: "doré" },
      ], "doré"),
      lookup({ doré: "/dore.webp", argent: "/argent.webp" }),
    )).toBe("/dore.webp");
  });

  it("retombe sur une autre couleur si la couleur principale n'a aucune image", () => {
    expect(pickFirstImage(
      product([
        { isPrimary: false, colorId: "argent" },
        { isPrimary: false, colorId: "doré" },
      ], "doré"),
      lookup({ argent: "/argent.webp" }), // doré absent
    )).toBe("/argent.webp");
  });

  it("ignore les colorId null pour le fallback", () => {
    expect(pickFirstImage(
      product([
        { isPrimary: false, colorId: "argent" },
        { isPrimary: true,  colorId: null },
      ]),
      lookup({ argent: "/argent.webp" }),
    )).toBe("/argent.webp");
  });

  it("retombe sur la 1ʳᵉ couleur avec image si aucune principale n'est définie", () => {
    expect(pickFirstImage(
      product([
        { isPrimary: false, colorId: "argent" },
        { isPrimary: false, colorId: "doré" },
      ]),
      lookup({ doré: "/dore.webp" }),
    )).toBe("/dore.webp");
  });
});
