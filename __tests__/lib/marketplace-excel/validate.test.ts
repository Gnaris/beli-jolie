import { describe, it, expect } from "vitest";
import { validateProductsForMarketplace } from "@/lib/marketplace-excel/validate";
import type { ExportProduct, ExportVariant } from "@/lib/marketplace-excel/types";

function makeVariant(over: Partial<ExportVariant> = {}): ExportVariant {
  return {
    variantId: "v1",
    saleType: "UNIT",
    colorNames: ["Doré"],
    packQuantity: null,
    sizes: [{ name: "TU", quantity: 1, pfsSizeRef: "TU" }],
    unitPrice: 3.5,
    weight: 0.035,
    stock: 100,
    sku: null,
    imagePaths: ["/uploads/produits/e803/e803-dore-1.webp"],
    ...over,
  };
}

function makeProduct(over: Partial<ExportProduct> = {}): ExportProduct {
  return {
    id: "p1",
    reference: "E803",
    name: "Collier en acier inoxydable",
    description: "Collier en acier inoxydable, longueur 45cm, fermoir mousqueton.",
    pfsGenderCode: "WOMAN",
    pfsFamilyName: "Bijoux_Fantaisie",
    pfsCategoryName: "Colliers",
    categoryName: "Colliers",
    hsCode: "711719",
    efashionCategorieId: 160101,
    efashionCategoryPath: { top: "Accessoires", sub: "Bijoux", leaf: "Colliers" },
    seasonPfsRef: "PE2026",
    seasonEfashionCollectionId: 700,
    seasonEfashionLabel: "Toutes les saisons",
    seasonName: "Toutes saisons",
    manufacturingCountryName: "Chine",
    manufacturingCountryIso: "CN",
    manufacturingCountryEfashionProvenanceId: 86,
    compositions: [{ name: "Acier Inoxydable", percentage: 100, pfsRef: "Acier Inoxydable", efashionId: 182 }],
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    translations: { fr: { name: "Collier", description: "Description longue de plus de 30 caractères pour Ankorstore." } },
    variants: [makeVariant()],
    ...over,
  };
}

describe("validateProductsForMarketplace", () => {
  describe("PFS", () => {
    it("accepte un produit complet", () => {
      const res = validateProductsForMarketplace([makeProduct()], "pfs");
      expect(res[0]!.eligible).toBe(true);
      expect(res[0]!.missing).toEqual([]);
    });

    it("refuse sans saison PFS", () => {
      const res = validateProductsForMarketplace(
        [makeProduct({ seasonPfsRef: null })],
        "pfs",
      );
      expect(res[0]!.eligible).toBe(false);
      expect(res[0]!.missing).toContain("saison sans référence PFS");
    });

    it("refuse sans poids variante", () => {
      const res = validateProductsForMarketplace(
        [makeProduct({ variants: [makeVariant({ weight: 0 })] })],
        "pfs",
      );
      expect(res[0]!.eligible).toBe(false);
      expect(res[0]!.missing.some((m) => m.includes("poids"))).toBe(true);
    });
  });

  describe("Efashion", () => {
    it("accepte un produit avec mapping eFashion complet", () => {
      const res = validateProductsForMarketplace([makeProduct()], "efashion");
      expect(res[0]!.eligible).toBe(true);
    });

    it("refuse sans efashionCategorieId", () => {
      const res = validateProductsForMarketplace(
        [makeProduct({ efashionCategorieId: null })],
        "efashion",
      );
      expect(res[0]!.eligible).toBe(false);
      expect(res[0]!.missing.some((m) => m.includes("mapping Efashion"))).toBe(true);
    });

    it("refuse un produit avec uniquement des PACK (Efashion exclut les packs)", () => {
      const res = validateProductsForMarketplace(
        [
          makeProduct({
            variants: [makeVariant({ saleType: "PACK", packQuantity: 12 })],
          }),
        ],
        "efashion",
      );
      expect(res[0]!.eligible).toBe(false);
      expect(res[0]!.missing.some((m) => m.includes("unité"))).toBe(true);
    });

    it("refuse sans efashionId sur composition", () => {
      const res = validateProductsForMarketplace(
        [
          makeProduct({
            compositions: [{ name: "Acier", percentage: 100, efashionId: null }],
          }),
        ],
        "efashion",
      );
      expect(res[0]!.eligible).toBe(false);
      expect(res[0]!.missing.some((m) => m.includes("correspondance Efashion"))).toBe(true);
    });
  });

  describe("Microstore", () => {
    it("accepte un produit standard (pas besoin de mapping eFashion)", () => {
      const res = validateProductsForMarketplace(
        [makeProduct({ efashionCategorieId: null })],
        "microstore",
      );
      expect(res[0]!.eligible).toBe(true);
    });

    it("refuse un produit avec uniquement des PACK", () => {
      const res = validateProductsForMarketplace(
        [
          makeProduct({
            variants: [makeVariant({ saleType: "PACK", packQuantity: 12 })],
          }),
        ],
        "microstore",
      );
      expect(res[0]!.eligible).toBe(false);
      expect(res[0]!.missing.some((m) => m.includes("unité"))).toBe(true);
    });

    it("refuse sans pays d'origine", () => {
      const res = validateProductsForMarketplace(
        [makeProduct({ manufacturingCountryName: null })],
        "microstore",
      );
      expect(res[0]!.eligible).toBe(false);
      expect(res[0]!.missing).toContain("pays d'origine manquant");
    });
  });

  describe("Ankorstore", () => {
    it("accepte un produit avec description longue + ISO + images", () => {
      const res = validateProductsForMarketplace([makeProduct()], "ankorstore");
      expect(res[0]!.eligible).toBe(true);
    });

    it("refuse une description < 30 caractères", () => {
      const res = validateProductsForMarketplace(
        [
          makeProduct({
            description: "Court",
            translations: { fr: { name: "x", description: "Court" } },
          }),
        ],
        "ankorstore",
      );
      expect(res[0]!.eligible).toBe(false);
      expect(res[0]!.missing.some((m) => m.includes("30 caractères"))).toBe(true);
    });

    it("refuse sans code ISO pays", () => {
      const res = validateProductsForMarketplace(
        [makeProduct({ manufacturingCountryIso: null })],
        "ankorstore",
      );
      expect(res[0]!.eligible).toBe(false);
      expect(res[0]!.missing).toContain("pays sans code ISO");
    });

    it("accepte si au moins une variante a une image (autres peuvent être vides)", () => {
      const res = validateProductsForMarketplace(
        [
          makeProduct({
            variants: [
              makeVariant({ variantId: "v1", colorNames: ["Doré"] }),
              makeVariant({ variantId: "v2", colorNames: ["Argent"], imagePaths: [] }),
            ],
          }),
        ],
        "ankorstore",
      );
      expect(res[0]!.eligible).toBe(true);
    });

    it("accepte si les UNIT sont vides mais un PACK a des images (cas F137)", () => {
      const res = validateProductsForMarketplace(
        [
          makeProduct({
            variants: [
              makeVariant({ variantId: "u1", saleType: "UNIT", colorNames: ["Doré"], imagePaths: [] }),
              makeVariant({
                variantId: "p1",
                saleType: "PACK",
                packQuantity: 12,
                colorNames: ["Doré"],
                imagePaths: ["/uploads/produits/f137/f137-dore-1.webp"],
              }),
            ],
          }),
        ],
        "ankorstore",
      );
      expect(res[0]!.eligible).toBe(true);
    });

    it("refuse un produit avec uniquement des PACK (Ankorstore exclut les packs)", () => {
      const res = validateProductsForMarketplace(
        [
          makeProduct({
            variants: [makeVariant({ saleType: "PACK", packQuantity: 12 })],
          }),
        ],
        "ankorstore",
      );
      expect(res[0]!.eligible).toBe(false);
      expect(res[0]!.missing.some((m) => m.includes("unité"))).toBe(true);
    });

    it("refuse si AUCUNE variante n'a d'image", () => {
      const res = validateProductsForMarketplace(
        [
          makeProduct({
            variants: [
              makeVariant({ variantId: "v1", imagePaths: [] }),
              makeVariant({ variantId: "v2", imagePaths: [] }),
            ],
          }),
        ],
        "ankorstore",
      );
      expect(res[0]!.eligible).toBe(false);
      expect(res[0]!.missing.some((m) => m.includes("image"))).toBe(true);
    });
  });
});
