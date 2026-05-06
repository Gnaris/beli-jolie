import { describe, it, expect } from "vitest";
import {
  buildVariantImagesByColor,
  planVariantImageDownloads,
  findPrimaryColorIdFromPfs,
} from "@/lib/pfs-import";
import type { PfsColorInfo } from "@/lib/pfs-api";

const mkColor = (
  reference: string,
  labels: Partial<Record<"fr" | "en" | "de" | "es" | "it", string>> = {},
  value = "#000000",
): PfsColorInfo => ({
  id: 0,
  reference,
  value,
  image: null,
  labels: labels as Record<string, string>,
});

/**
 * Couvre le bug observé sur FZEAFSDF : pack multi-couleurs BROWN+KAKI où les
 * photos Kaki étaient ignorées (seule la 1ʳᵉ couleur du pack récupérait ses
 * images). Vérifie aussi le fallback sur les images produit + l'ordonnancement
 * sans collision avec la contrainte unique (productId, colorId, order).
 */
describe("buildVariantImagesByColor", () => {
  it("retourne un groupe par couleur PFS et leur attache leurs propres URLs", () => {
    const brown = mkColor("BROWN", { fr: "Brun" });
    const kaki = mkColor("KAKI", { fr: "Kaki" });
    const productImages = {
      BROWN: ["https://pfs/brown-1.jpg"],
      KAKI: ["https://pfs/kaki-1.jpg", "https://pfs/kaki-2.jpg"],
      DEFAULT: "https://pfs/kaki-1.jpg",
    };

    const out = buildVariantImagesByColor(
      [
        { localColorId: "col-brown", pfsColor: brown },
        { localColorId: "col-kaki", pfsColor: kaki },
      ],
      null,
      productImages,
    );

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ colorId: "col-brown", urls: ["https://pfs/brown-1.jpg"] });
    expect(out[1]).toEqual({
      colorId: "col-kaki",
      urls: ["https://pfs/kaki-1.jpg", "https://pfs/kaki-2.jpg"],
    });
  });

  it("priorise les images de la variante sur celles du produit (par couleur)", () => {
    const brown = mkColor("BROWN", { fr: "Brun" });
    const variantImages = { BROWN: ["https://pfs/variant-brown.jpg"] };
    const productImages = { BROWN: ["https://pfs/product-brown.jpg"] };

    const out = buildVariantImagesByColor(
      [{ localColorId: "col-brown", pfsColor: brown }],
      variantImages,
      productImages,
    );
    expect(out[0].urls).toEqual(["https://pfs/variant-brown.jpg"]);
  });

  it("retombe sur les images produit quand la variante n'a pas de photo pour cette couleur", () => {
    const kaki = mkColor("KAKI", { fr: "Kaki" });
    // v.images existe pour Brown (autre couleur) mais pas pour Kaki
    const variantImages = { BROWN: ["https://pfs/brown.jpg"] };
    const productImages = { KAKI: ["https://pfs/kaki.jpg"] };

    const out = buildVariantImagesByColor(
      [{ localColorId: "col-kaki", pfsColor: kaki }],
      variantImages,
      productImages,
    );
    expect(out[0].urls).toEqual(["https://pfs/kaki.jpg"]);
  });

  it("renvoie un tableau d'urls vide pour une couleur sans image (ne plante pas)", () => {
    const kaki = mkColor("KAKI", { fr: "Kaki" });
    const out = buildVariantImagesByColor(
      [{ localColorId: "col-kaki", pfsColor: kaki }],
      null,
      { OTHER: "https://pfs/other.jpg" },
    );
    expect(out).toEqual([{ colorId: "col-kaki", urls: [] }]);
  });

  it("dédoublonne les URLs au sein d'une même couleur", () => {
    const brown = mkColor("BROWN", { fr: "Brun" });
    // PFS expose la même URL via la clé reference ET via le label fr → on n'en garde qu'une
    const productImages = {
      BROWN: ["https://pfs/brown.jpg", "https://pfs/brown.jpg"],
      Brun: ["https://pfs/brown.jpg"],
    };
    const out = buildVariantImagesByColor(
      [{ localColorId: "col-brown", pfsColor: brown }],
      null,
      productImages,
    );
    expect(out[0].urls).toEqual(["https://pfs/brown.jpg"]);
  });
});

describe("planVariantImageDownloads", () => {
  it("rattache chaque image à son propre colorId (pas à celui du variant)", () => {
    // Pack multi-couleurs BROWN+KAKI : les photos Kaki doivent être stockées
    // sous colorId=col-kaki pour apparaître dans l'onglet Kaki du modal.
    const planned = planVariantImageDownloads([
      {
        id: "var-pack",
        imagesByColor: [
          { colorId: "col-brown", urls: ["https://pfs/brown.jpg"] },
          { colorId: "col-kaki", urls: ["https://pfs/kaki-1.jpg", "https://pfs/kaki-2.jpg"] },
        ],
      },
    ]);

    expect(planned).toHaveLength(3);
    expect(planned.find((p) => p.url === "https://pfs/brown.jpg")?.colorId).toBe("col-brown");
    expect(planned.filter((p) => p.colorId === "col-kaki")).toHaveLength(2);
  });

  it("attribue des `order` consécutifs (0,1,2…) par couleur pour respecter la contrainte unique", () => {
    const planned = planVariantImageDownloads([
      {
        id: "var-1",
        imagesByColor: [
          { colorId: "col-brown", urls: ["b1", "b2", "b3"] },
          { colorId: "col-kaki", urls: ["k1", "k2"] },
        ],
      },
    ]);

    const browns = planned.filter((p) => p.colorId === "col-brown").map((p) => p.order);
    const kakis = planned.filter((p) => p.colorId === "col-kaki").map((p) => p.order);
    expect(browns).toEqual([0, 1, 2]);
    expect(kakis).toEqual([0, 1]);
  });

  it("dédoublonne les URLs partagées entre variantes de la même couleur", () => {
    // Même couleur Brun en UNIT et dans un PACK : on ne télécharge qu'une fois
    const planned = planVariantImageDownloads([
      { id: "var-unit", imagesByColor: [{ colorId: "col-brown", urls: ["b1"] }] },
      { id: "var-pack", imagesByColor: [{ colorId: "col-brown", urls: ["b1", "b2"] }] },
    ]);
    expect(planned).toHaveLength(2);
    // Toutes les images Brun sont rattachées à la 1ʳᵉ variante rencontrée pour cette couleur
    expect(planned.every((p) => p.variantId === "var-unit")).toBe(true);
    // Et les `order` sont 0, 1 — pas 0, 0 (qui violerait la contrainte unique)
    expect(planned.map((p) => p.order)).toEqual([0, 1]);
  });

  it("rattache les images d'une couleur à la première variante qui la déclare", () => {
    const planned = planVariantImageDownloads([
      { id: "var-1", imagesByColor: [{ colorId: "col-rouge", urls: ["r1"] }] },
      {
        id: "var-2",
        imagesByColor: [
          { colorId: "col-rouge", urls: ["r1", "r2"] },
          { colorId: "col-bleu", urls: ["bl1"] },
        ],
      },
    ]);

    const rouges = planned.filter((p) => p.colorId === "col-rouge");
    const bleus = planned.filter((p) => p.colorId === "col-bleu");
    expect(rouges.every((p) => p.variantId === "var-1")).toBe(true);
    expect(bleus.every((p) => p.variantId === "var-2")).toBe(true);
  });

  it("retourne une liste vide pour des variantes sans images", () => {
    const planned = planVariantImageDownloads([
      { id: "var-1", imagesByColor: [{ colorId: "col-x", urls: [] }] },
    ]);
    expect(planned).toEqual([]);
  });
});

describe("findPrimaryColorIdFromPfs", () => {
  // Construit un mapping minimal d'une variante (couleur principale + pack-lines)
  const mapping = (reference: string, fr: string, localId: string) => ({
    reference,
    labels: [fr],
    localId,
  });

  it("retrouve la couleur principale dans une variante UNIT via default_color", () => {
    const result = findPrimaryColorIdFromPfs({
      variants: [
        {
          primaryPfsColorRef: "GOLDEN",
          isStar: false,
          pfsColorMappings: [mapping("GOLDEN", "Doré", "col-golden")],
        },
        {
          primaryPfsColorRef: "PINK",
          isStar: false,
          pfsColorMappings: [mapping("PINK", "Rose", "col-pink")],
        },
      ],
      defaultColor: "GOLDEN",
      productImages: null,
    });
    expect(result).toBe("col-golden");
  });

  it("retrouve une couleur de pack multi-couleurs (cas FZEAFSDF : Kaki dans pack Brun+Kaki)", () => {
    // La variante PACK a Brown comme couleur principale, Kaki en 2ᵉ ligne.
    // PFS dit que default_color = "KAKI" → on doit retomber sur col-kaki.
    const result = findPrimaryColorIdFromPfs({
      variants: [
        {
          primaryPfsColorRef: "GOLDEN",
          isStar: false,
          pfsColorMappings: [mapping("GOLDEN", "Doré", "col-golden")],
        },
        {
          primaryPfsColorRef: "BROWN",
          isStar: false,
          pfsColorMappings: [
            mapping("BROWN", "Brun", "col-brown"),
            mapping("KAKI", "Kaki", "col-kaki"),
          ],
        },
      ],
      defaultColor: "KAKI",
      productImages: null,
    });
    expect(result).toBe("col-kaki");
  });

  it("matche default_color via le libellé localisé (ex: 'Doré' → reference GOLDEN)", () => {
    const result = findPrimaryColorIdFromPfs({
      variants: [
        {
          primaryPfsColorRef: "GOLDEN",
          isStar: false,
          pfsColorMappings: [mapping("GOLDEN", "Doré", "col-golden")],
        },
      ],
      defaultColor: "Doré",
      productImages: null,
    });
    expect(result).toBe("col-golden");
  });

  it("priorise l'image DEFAUT sur default_color quand les deux sont présents", () => {
    const result = findPrimaryColorIdFromPfs({
      variants: [
        {
          primaryPfsColorRef: "GOLDEN",
          isStar: false,
          pfsColorMappings: [mapping("GOLDEN", "Doré", "col-golden")],
        },
        {
          primaryPfsColorRef: "PINK",
          isStar: false,
          pfsColorMappings: [mapping("PINK", "Rose", "col-pink")],
        },
      ],
      defaultColor: "GOLDEN",
      productImages: {
        DEFAUT: "https://pfs/pink.jpg",
        GOLDEN: "https://pfs/gold.jpg",
        PINK: "https://pfs/pink.jpg",
      },
    });
    expect(result).toBe("col-pink");
  });

  it("retombe sur is_star quand DEFAUT et default_color échouent", () => {
    const result = findPrimaryColorIdFromPfs({
      variants: [
        {
          primaryPfsColorRef: "GOLDEN",
          isStar: false,
          pfsColorMappings: [mapping("GOLDEN", "Doré", "col-golden")],
        },
        {
          primaryPfsColorRef: "PINK",
          isStar: true,
          pfsColorMappings: [mapping("PINK", "Rose", "col-pink")],
        },
      ],
      defaultColor: "INCONNU",
      productImages: null,
    });
    expect(result).toBe("col-pink");
  });

  it("renvoie null quand aucun signal n'aboutit (l'appelant retombe sur la 1ʳᵉ couleur)", () => {
    const result = findPrimaryColorIdFromPfs({
      variants: [
        {
          primaryPfsColorRef: "GOLDEN",
          isStar: false,
          pfsColorMappings: [mapping("GOLDEN", "Doré", "col-golden")],
        },
      ],
      defaultColor: "INCONNU",
      productImages: null,
    });
    expect(result).toBeNull();
  });
});
