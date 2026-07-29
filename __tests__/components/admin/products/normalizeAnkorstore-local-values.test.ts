import { describe, it, expect } from "vitest";
import { normalizeAnkorstore } from "@/components/admin/products/linkMarketplaceAdapters";

// Régression : normalizeAnkorstore hardcodait unitPrice/stock à 0 pour les
// couleurs locales, ce qui affichait « Prix 0 € · Stock 0 » dans la colonne
// boutique du modal de liaison — et faisait mentir la comparaison côté
// Ankorstore (« ~980 € → 0 € »). La donnée doit remonter telle quelle depuis
// la preview serveur.
describe("normalizeAnkorstore — propage prix/stock/poids boutique", () => {
  it("copie unitPrice, stock et weightKg de la preview vers localColors", () => {
    const preview = {
      ankorstoreProduct: {
        id: "ak-prod-1",
        name: "T-shirt JG",
        description: "",
        mainImage: null,
        extraImages: [],
      },
      variants: [
        {
          ankorstoreVariantId: "ak-var-1",
          sku: "SKU-JG",
          colorOption: "JG",
          sizeOption: "TU",
          imageUrl: null,
          wholesalePrice: 980,
          retailPrice: 1500,
          stockQuantity: 12,
          weightKg: 0.5,
          suggestedLocalColorId: null,
        },
      ],
      localColors: [
        {
          productColorId: "pc-1",
          colorId: "c-1",
          name: "JG",
          hex: null,
          patternImage: null,
          sku: "BJ-SKU",
          sizeName: "TU",
          productImage: null,
          weightKg: 0.42,
          unitPrice: 12.5,
          stock: 7,
          existingAnkorstoreVariantId: null,
          isAlreadyLinked: false,
        },
      ],
    };

    const out = normalizeAnkorstore("bj-prod-1", "REF-42", preview);

    expect(out.localColors).toHaveLength(1);
    expect(out.localColors[0].unitPrice).toBe(12.5);
    expect(out.localColors[0].stock).toBe(7);
    expect(out.localColors[0].weightKg).toBe(0.42);
    expect(out.localColors[0].sizes).toEqual(["TU"]);
    expect(out.localColors[0].saleType).toBe("UNIT");
  });

  it("convertit aussi le retailPrice de centimes vers euros — utilisé pour la 2ᵉ ligne « Prix de vente/u » du modal", () => {
    const preview = {
      ankorstoreProduct: {
        id: "ak-prod-r",
        name: "Bague",
        description: "",
        mainImage: null,
        extraImages: [],
      },
      variants: [
        {
          ankorstoreVariantId: "ak-var-r",
          sku: "SKU",
          colorOption: null,
          sizeOption: null,
          imageUrl: null,
          wholesalePrice: 500, // 5,00 €
          retailPrice: 1250, // 12,50 €
          stockQuantity: 3,
          weightKg: 0,
          suggestedLocalColorId: null,
        },
      ],
      localColors: [],
    };
    const out = normalizeAnkorstore("bj-prod-r", "REF-R", preview);
    expect(out.candidates[0].priceUnit).toBeCloseTo(5.0, 2);
    expect(out.candidates[0].retailPriceUnit).toBeCloseTo(12.5, 2);
  });

  it("retailPriceUnit = null quand Ankorstore renvoie 0 (pas de prix conseillé configuré)", () => {
    const preview = {
      ankorstoreProduct: {
        id: "ak-prod-r0",
        name: "X",
        description: "",
        mainImage: null,
        extraImages: [],
      },
      variants: [
        {
          ankorstoreVariantId: "v",
          sku: "s",
          colorOption: null,
          sizeOption: null,
          imageUrl: null,
          wholesalePrice: 500,
          retailPrice: 0,
          stockQuantity: 0,
          weightKg: 0,
          suggestedLocalColorId: null,
        },
      ],
      localColors: [],
    };
    const out = normalizeAnkorstore("bj-prod-r0", "REF-R0", preview);
    expect(out.candidates[0].retailPriceUnit).toBeNull();
  });

  it("convertit les prix Ankorstore de centimes vers euros — API renvoie en integer", () => {
    // Régression : GET /products/{id} Ankorstore renvoie wholesalePrice/retailPrice
    // en centimes (integer) selon leur spec OpenAPI. Un produit à 4,80 € revient
    // en `wholesalePrice: 480`. Avant fix on affichait « 480,00 € » (100× trop).
    const preview = {
      ankorstoreProduct: {
        id: "ak-prod-cents",
        name: "PS3",
        description: "",
        mainImage: null,
        extraImages: [],
      },
      variants: [
        {
          ankorstoreVariantId: "ak-var-cents",
          sku: "SKU",
          colorOption: null,
          sizeOption: null,
          imageUrl: null,
          wholesalePrice: 480, // = 4,80 € en base
          retailPrice: 900, // = 9,00 €
          stockQuantity: 5,
          weightKg: 0.2,
          suggestedLocalColorId: null,
        },
      ],
      localColors: [],
    };
    const out = normalizeAnkorstore("bj-prod-cents", "PS3", preview);
    expect(out.candidates[0].priceUnit).toBeCloseTo(4.8, 2);
    expect(out.candidates[0].priceTotal).toBeCloseTo(4.8, 2);
  });

  it("marque weightIsProductLevel=true — Ankorstore stocke le poids sur le produit, pas la variante", () => {
    const preview = {
      ankorstoreProduct: {
        id: "ak-prod-w",
        name: "Bague",
        description: "",
        mainImage: null,
        extraImages: [],
      },
      variants: [],
      localColors: [],
    };
    const out = normalizeAnkorstore("bj-prod-w", "REF-W", preview);
    expect(out.weightIsProductLevel).toBe(true);
  });

  it("garde 0/0 si la boutique elle-même n'a rien renseigné (pas d'inflation factice)", () => {
    const preview = {
      ankorstoreProduct: {
        id: "ak-prod-2",
        name: "Vide",
        description: "",
        mainImage: null,
        extraImages: [],
      },
      variants: [],
      localColors: [
        {
          productColorId: "pc-2",
          colorId: "c-2",
          name: "Rouge",
          hex: "#f00",
          patternImage: null,
          sku: null,
          sizeName: null,
          productImage: null,
          weightKg: 0,
          unitPrice: 0,
          stock: 0,
          existingAnkorstoreVariantId: null,
          isAlreadyLinked: false,
        },
      ],
    };

    const out = normalizeAnkorstore("bj-prod-2", "REF-vide", preview);

    expect(out.localColors[0].unitPrice).toBe(0);
    expect(out.localColors[0].stock).toBe(0);
  });
});
