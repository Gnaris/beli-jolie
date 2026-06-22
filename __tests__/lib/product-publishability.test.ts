/**
 * Tests pour lib/product-publishability.ts
 *
 * Cette fonction décide si un brouillon (statut OFFLINE) peut être mis en
 * ligne et publié sur les marketplaces — et liste les raisons précises quand
 * il ne peut pas. Elle alimente la modale « Publier brouillons » de l'admin
 * Produits.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateProductPublishability,
  DESCRIPTION_MIN_CHARS,
  type PublishabilityProduct,
  type PublishabilityVariant,
} from "@/lib/product-publishability";

function makeVariant(overrides: Partial<PublishabilityVariant> = {}): PublishabilityVariant {
  return {
    id: "v1",
    colorId: "color-1",
    colorName: "Argenté",
    unitPrice: 5,
    stock: 10,
    weight: 0.02,
    saleType: "UNIT",
    packQuantity: null,
    sizes: [{ sizeId: "s1", sizeName: "Taille unique", quantity: 1 }],
    packLinesCount: 0,
    packLinesSizesTotal: 0,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<PublishabilityProduct> = {}): PublishabilityProduct {
  return {
    id: "prod-1",
    reference: "BJ-001",
    name: "Bague Lune",
    description: "Une jolie bague en acier inoxydable plaquée argent.",
    categoryId: "cat-1",
    compositionCount: 1,
    compositionPercentTotal: 100,
    variants: [makeVariant()],
    imageCountByColorId: { "color-1": 2 },
    ...overrides,
  };
}

describe("evaluateProductPublishability", () => {
  it("retourne eligible=true et aucune raison pour un produit complet", () => {
    const res = evaluateProductPublishability(makeProduct());
    expect(res.eligible).toBe(true);
    expect(res.reasons).toEqual([]);
  });

  it("signale une référence manquante", () => {
    const res = evaluateProductPublishability(makeProduct({ reference: "   " }));
    expect(res.eligible).toBe(false);
    expect(res.reasons).toContain("Référence produit manquante");
  });

  it("signale un nom manquant", () => {
    const res = evaluateProductPublishability(makeProduct({ name: "" }));
    expect(res.eligible).toBe(false);
    expect(res.reasons).toContain("Nom du produit manquant");
  });

  it("signale une description manquante", () => {
    const res = evaluateProductPublishability(makeProduct({ description: "" }));
    expect(res.eligible).toBe(false);
    expect(res.reasons).toContain("Description manquante");
  });

  it("signale une description trop courte", () => {
    const res = evaluateProductPublishability(makeProduct({ description: "Trop court" }));
    expect(res.eligible).toBe(false);
    expect(
      res.reasons.some((r) => r.includes(`${DESCRIPTION_MIN_CHARS} caractères minimum`)),
    ).toBe(true);
  });

  it("signale une catégorie manquante", () => {
    const res = evaluateProductPublishability(makeProduct({ categoryId: null }));
    expect(res.eligible).toBe(false);
    expect(res.reasons).toContain("Catégorie non sélectionnée");
  });

  it("signale l'absence de composition", () => {
    const res = evaluateProductPublishability(
      makeProduct({ compositionCount: 0, compositionPercentTotal: 0 }),
    );
    expect(res.eligible).toBe(false);
    expect(res.reasons).toContain("Au moins une composition est requise");
  });

  it("signale une composition dont le total ne fait pas 100%", () => {
    const res = evaluateProductPublishability(
      makeProduct({ compositionCount: 2, compositionPercentTotal: 80 }),
    );
    expect(res.eligible).toBe(false);
    expect(res.reasons.some((r) => r.startsWith("La composition doit totaliser 100%"))).toBe(
      true,
    );
  });

  it("accepte une composition à 100% à 0.5% près (tolérance arrondi)", () => {
    const res = evaluateProductPublishability(
      makeProduct({ compositionCount: 1, compositionPercentTotal: 99.6 }),
    );
    expect(res.eligible).toBe(true);
  });

  it("signale l'absence totale de variantes", () => {
    const res = evaluateProductPublishability(
      makeProduct({ variants: [], imageCountByColorId: {} }),
    );
    expect(res.eligible).toBe(false);
    expect(res.reasons).toContain("Au moins une variante de couleur est requise");
  });

  it("signale uniquement quand aucune couleur n'a d'image", () => {
    const res = evaluateProductPublishability(
      makeProduct({ imageCountByColorId: { "color-1": 0 } }),
    );
    expect(res.eligible).toBe(false);
    expect(
      res.reasons.some((r) =>
        r.includes("Aucune couleur n'a d'image"),
      ),
    ).toBe(true);
  });

  it("accepte un produit dont seule UNE des couleurs a des images (les autres sont silencieusement ignorées)", () => {
    const res = evaluateProductPublishability(
      makeProduct({
        variants: [
          makeVariant({ id: "v1", colorId: "color-1", colorName: "Doré" }),
          makeVariant({ id: "v2", colorId: "color-2", colorName: "Argenté" }),
        ],
        imageCountByColorId: { "color-1": 2, "color-2": 0 },
      }),
    );
    expect(res.eligible).toBe(true);
    expect(res.reasons).toEqual([]);
  });

  it("ne bloque pas quand 2 variantes partagent la même couleur et qu'elle a au moins une image", () => {
    const res = evaluateProductPublishability(
      makeProduct({
        variants: [
          makeVariant({ id: "v1", colorId: "color-1", saleType: "UNIT" }),
          makeVariant({ id: "v2", colorId: "color-1", saleType: "PACK", packQuantity: 5 }),
        ],
        imageCountByColorId: { "color-1": 1 },
      }),
    );
    expect(res.eligible).toBe(true);
  });

  it("signale un poids invalide", () => {
    const res = evaluateProductPublishability(
      makeProduct({ variants: [makeVariant({ weight: 0 })] }),
    );
    expect(res.eligible).toBe(false);
    expect(res.reasons.some((r) => r.includes("poids invalide"))).toBe(true);
  });

  it("signale un prix invalide", () => {
    const res = evaluateProductPublishability(
      makeProduct({ variants: [makeVariant({ unitPrice: 0 })] }),
    );
    expect(res.eligible).toBe(false);
    expect(res.reasons.some((r) => r.includes("prix/unité invalide"))).toBe(true);
  });

  it("signale un stock non renseigné (null)", () => {
    const res = evaluateProductPublishability(
      makeProduct({ variants: [makeVariant({ stock: null })] }),
    );
    expect(res.eligible).toBe(false);
    expect(res.reasons.some((r) => r.includes("stock non renseigné"))).toBe(true);
  });

  it("accepte stock = 0 (rupture mais renseigné)", () => {
    const res = evaluateProductPublishability(
      makeProduct({ variants: [makeVariant({ stock: 0 })] }),
    );
    expect(res.eligible).toBe(true);
  });

  it("signale une variante sans taille (ni simple, ni pack)", () => {
    const res = evaluateProductPublishability(
      makeProduct({
        variants: [makeVariant({ sizes: [], packLinesCount: 0, packLinesSizesTotal: 0 })],
      }),
    );
    expect(res.eligible).toBe(false);
    expect(res.reasons.some((r) => r.includes("aucune taille"))).toBe(true);
  });

  it("accepte une variante PACK multi-couleurs (tailles portées par les packLines)", () => {
    const res = evaluateProductPublishability(
      makeProduct({
        variants: [
          makeVariant({
            saleType: "PACK",
            packQuantity: 6,
            sizes: [],
            packLinesCount: 2,
            packLinesSizesTotal: 4,
          }),
        ],
      }),
    );
    expect(res.eligible).toBe(true);
  });

  it("signale une quantité paquet invalide pour un PACK", () => {
    const res = evaluateProductPublishability(
      makeProduct({
        variants: [
          makeVariant({
            saleType: "PACK",
            packQuantity: 0,
            sizes: [{ sizeId: "s1", sizeName: "S", quantity: 3 }],
          }),
        ],
      }),
    );
    expect(res.eligible).toBe(false);
    expect(res.reasons.some((r) => r.includes("quantité paquet invalide"))).toBe(true);
  });

  it("signale une quantité par taille invalide pour un PACK", () => {
    const res = evaluateProductPublishability(
      makeProduct({
        variants: [
          makeVariant({
            saleType: "PACK",
            packQuantity: 4,
            sizes: [{ sizeId: "s1", sizeName: "M", quantity: 0 }],
          }),
        ],
      }),
    );
    expect(res.eligible).toBe(false);
    expect(res.reasons.some((r) => r.includes("quantité invalide pour taille"))).toBe(true);
  });

  it("signale une variante sans couleur sélectionnée", () => {
    const res = evaluateProductPublishability(
      makeProduct({
        variants: [makeVariant({ colorId: null, colorName: null })],
        imageCountByColorId: {},
      }),
    );
    expect(res.eligible).toBe(false);
    expect(res.reasons.some((r) => r.includes("couleur non sélectionnée"))).toBe(true);
  });

  it("accumule plusieurs raisons", () => {
    const res = evaluateProductPublishability(
      makeProduct({
        name: "",
        categoryId: null,
        variants: [makeVariant({ unitPrice: 0, weight: 0 })],
      }),
    );
    expect(res.eligible).toBe(false);
    expect(res.reasons.length).toBeGreaterThanOrEqual(4);
  });
});
