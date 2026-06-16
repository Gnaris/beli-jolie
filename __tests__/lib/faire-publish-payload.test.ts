import { describe, it, expect } from "vitest";
import { buildFaireProductPayload, type FairePublishContext } from "@/lib/faire-publish";
import type { MarkupConfig } from "@/lib/marketplace-pricing";

const wholesale: MarkupConfig = { type: "percent", value: 0, rounding: "none" };
const retail: MarkupConfig = { type: "multiplier", value: 2.5, rounding: "none" };

const ctx: FairePublishContext = {
  taxonomyTypeId: "tt_czw8pmzjrc",
  tariffCode: "7117.19.00",
  countryAlpha2: "CN",
  description: "Bracelet acier inoxydable",
  countryUsedFallback: false,
};

function makeProduct(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    id: "p1",
    reference: "BJ001",
    name: "Bracelet test",
    description: "Bracelet acier inoxydable",
    status: "ONLINE",
    primaryColorId: "c-or",
    hsCode: { code: "7117.19.00" },
    category: { id: "cat", faireTaxonomyId: "tt_czw8pmzjrc" },
    colors: [
      {
        id: "v-or",
        unitPrice: 10,
        weight: 0.02,
        stock: 5,
        isPrimary: true,
        saleType: "UNIT" as const,
        packQuantity: null,
        colorId: "c-or",
        color: { id: "c-or", name: "Or" },
        variantSizes: [],
        packLines: [],
      },
      {
        id: "v-ar",
        unitPrice: 10,
        weight: 0.02,
        stock: 3,
        isPrimary: false,
        saleType: "UNIT" as const,
        packQuantity: null,
        colorId: "c-ar",
        color: { id: "c-ar", name: "Argent" },
        variantSizes: [],
        packLines: [],
      },
    ],
    colorImages: [
      { path: "/uploads/produits/BJ001/or-1.webp", order: 0, colorId: "c-or" },
      { path: "/uploads/produits/BJ001/or-2.webp", order: 1, colorId: "c-or" },
      { path: "/uploads/produits/BJ001/ar-1.webp", order: 0, colorId: "c-ar" },
    ],
    compositions: [{ percentage: 100, composition: { name: "Acier" } }],
    manufacturingCountry: { isoCode: "CN" },
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
  };
  return { ...base, ...overrides } as Parameters<typeof buildFaireProductPayload>[0];
}

describe("buildFaireProductPayload — measurements (dimensions + poids)", () => {
  it("envoie length/width/height + distance_unit dans measurements de chaque variante", () => {
    const { variants } = buildFaireProductPayload(
      makeProduct({ dimensionLength: 180, dimensionWidth: 5, dimensionHeight: 3 }),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    for (const v of variants) {
      // BDD en mm → envoi à Faire en cm (÷10).
      expect(v.payload.measurements).toMatchObject({
        length: 18,
        width: 0.5,
        height: 0.3,
        distance_unit: "CENTIMETERS",
      });
    }
  });

  it("n'envoie pas de dimensions si aucun axe positif", () => {
    const { variants } = buildFaireProductPayload(
      makeProduct({ dimensionLength: 0, dimensionWidth: null, dimensionHeight: null }),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    for (const v of variants) {
      expect(v.payload.measurements?.length).toBeUndefined();
      expect(v.payload.measurements?.width).toBeUndefined();
      expect(v.payload.measurements?.height).toBeUndefined();
      expect(v.payload.measurements?.distance_unit).toBeUndefined();
    }
  });

  it("garde weight + mass_unit quand le poids est renseigné", () => {
    const { variants } = buildFaireProductPayload(
      makeProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    for (const v of variants) {
      expect(v.payload.measurements).toMatchObject({ weight: 20, mass_unit: "GRAMS" });
    }
  });
});

describe("buildFaireProductPayload — prix moderne uniquement (pas de champs dépréciés)", () => {
  it("envoie prices[] EUR/EU sur chaque variante, jamais wholesale_price_cents/retail_price_cents", () => {
    const { body, variants } = buildFaireProductPayload(
      makeProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    for (const v of variants) {
      const p = v.payload as Record<string, unknown>;
      // Champs dépréciés Faire 2021 — leur présence + prices[] casse la
      // cohérence des geo_constraints entre variantes au PATCH.
      expect(p.wholesale_price_cents).toBeUndefined();
      expect(p.retail_price_cents).toBeUndefined();
      // Format moderne attendu.
      expect(v.payload.prices).toHaveLength(1);
      expect(v.payload.prices[0]).toMatchObject({
        geo_constraint: { country_group: "EUROPEAN_UNION" },
        wholesale_price: { currency: "EUR" },
        retail_price: { currency: "EUR" },
      });
    }
    // Le body racine ne porte plus non plus les champs dépréciés.
    const root = body as Record<string, unknown>;
    expect(root.wholesale_price_cents).toBeUndefined();
    expect(root.retail_price_cents).toBeUndefined();
  });

  it("expose wholesalePriceCents/retailPriceCents sur l'objet FaireVariantPayload (pour le snapshot interne)", () => {
    const { variants } = buildFaireProductPayload(
      makeProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    for (const v of variants) {
      // Cents EUR positifs — utilisés en interne (snapshot/diff) sans être
      // envoyés à Faire en tant que champs racine variant.
      expect(typeof v.wholesalePriceCents).toBe("number");
      expect(typeof v.retailPriceCents).toBe("number");
      expect(v.wholesalePriceCents).toBeGreaterThan(0);
      expect(v.retailPriceCents).toBeGreaterThan(0);
    }
  });
});

describe("buildFaireProductPayload — images racine", () => {
  it("pose un tableau `images` au niveau produit à partir de la couleur primaire", () => {
    const { body, productImagesCount } = buildFaireProductPayload(
      makeProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    const images = body.images as { url: string }[] | undefined;
    expect(Array.isArray(images)).toBe(true);
    expect(images?.length).toBe(2);
    // Doit viser les images de la couleur primaire (Or), pas Argent
    expect(images?.[0]?.url).toContain("or-1");
    expect(productImagesCount).toBe(2);
  });

  it("retombe sur la première couleur disponible si la couleur primaire n'a pas d'images", () => {
    const { body, productImagesCount } = buildFaireProductPayload(
      makeProduct({
        primaryColorId: "c-or",
        colorImages: [
          { path: "/uploads/produits/BJ001/ar-1.webp", order: 0, colorId: "c-ar" },
        ],
      }),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    const images = body.images as { url: string }[] | undefined;
    expect(images?.length).toBe(1);
    expect(images?.[0]?.url).toContain("ar-1");
    expect(productImagesCount).toBe(1);
  });

  it("n'inclut pas de champ images si le produit n'en a aucune", () => {
    const { body, productImagesCount } = buildFaireProductPayload(
      makeProduct({ colorImages: [] }),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    expect(body.images).toBeUndefined();
    expect(productImagesCount).toBe(0);
  });

  it("plafonne à 5 images au niveau produit", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      path: `/uploads/produits/BJ001/or-${i + 1}.webp`,
      order: i,
      colorId: "c-or",
    }));
    const { body, productImagesCount } = buildFaireProductPayload(
      makeProduct({ colorImages: many }),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    const images = body.images as { url: string }[] | undefined;
    expect(images?.length).toBe(5);
    expect(productImagesCount).toBe(5);
  });
});
