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
    category: { id: "cat", name: "Bracelet", faireTaxonomyId: "tt_czw8pmzjrc" },
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
    countryIsoCode: "CN",
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

describe("buildFaireProductPayload — un seul axe d'option Color", () => {
  // Le payload builder ne reçoit jamais de variantes PACK : `fairePublishProduct`
  // et `faireUpdateProduct` filtrent les PACK en amont (alignement Ankorstore).
  // Faire refusait sinon HTTP 400 « Duplicate variants with same options »
  // quand la même couleur existait en UNIT et en PACK (cas ZK03E).
  it("expose un unique axe Color dans variant_option_sets et dans chaque variante", () => {
    const { body, variants } = buildFaireProductPayload(makeProduct(), ctx, wholesale, retail, "PUBLISHED");
    const sets = body.variant_option_sets as { name: string }[];
    expect(sets).toHaveLength(1);
    expect(sets[0].name).toBe("Color");
    for (const v of variants) {
      expect(v.payload.options).toHaveLength(1);
      expect(v.payload.options[0].name).toBe("Color");
    }
  });
});

describe("buildFaireProductPayload — galerie racine : couleur principale d'abord", () => {
  it("place TOUTES les images de la couleur primaire d'abord, puis les autres couleurs", () => {
    const { body, productImagesCount } = buildFaireProductPayload(
      makeProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    const images = body.images as { url: string }[] | undefined;
    expect(Array.isArray(images)).toBe(true);
    // makeProduct() : 2 images Or (primaire) + 1 image Argent.
    // Ordre attendu : or-1, or-2 (toute la primaire), puis ar-1.
    expect(images?.length).toBe(3);
    expect(images?.[0]?.url).toContain("or-1");
    expect(images?.[1]?.url).toContain("or-2");
    expect(images?.[2]?.url).toContain("ar-1");
    expect(productImagesCount).toBe(3);
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

  it("plafonne à 5 images au niveau produit même quand chaque couleur a beaucoup d'images", () => {
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

  it("avec 3 couleurs et beaucoup d'images, vide TOUTE la couleur primaire avant d'attaquer les autres", () => {
    const product = makeProduct({
      primaryColorId: "c-or",
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
        {
          id: "v-rg",
          unitPrice: 10,
          weight: 0.02,
          stock: 1,
          isPrimary: false,
          saleType: "UNIT" as const,
          packQuantity: null,
          colorId: "c-rg",
          color: { id: "c-rg", name: "Rouge" },
          variantSizes: [],
          packLines: [],
        },
      ],
      colorImages: [
        // Or : 4 images
        { path: "/uploads/produits/BJ001/or-1.webp", order: 0, colorId: "c-or" },
        { path: "/uploads/produits/BJ001/or-2.webp", order: 1, colorId: "c-or" },
        { path: "/uploads/produits/BJ001/or-3.webp", order: 2, colorId: "c-or" },
        { path: "/uploads/produits/BJ001/or-4.webp", order: 3, colorId: "c-or" },
        // Argent : 3 images
        { path: "/uploads/produits/BJ001/ar-1.webp", order: 0, colorId: "c-ar" },
        { path: "/uploads/produits/BJ001/ar-2.webp", order: 1, colorId: "c-ar" },
        { path: "/uploads/produits/BJ001/ar-3.webp", order: 2, colorId: "c-ar" },
        // Rouge : 2 images
        { path: "/uploads/produits/BJ001/rg-1.webp", order: 0, colorId: "c-rg" },
        { path: "/uploads/produits/BJ001/rg-2.webp", order: 1, colorId: "c-rg" },
      ],
    });
    const { body } = buildFaireProductPayload(product, ctx, wholesale, retail, "PUBLISHED");
    const images = body.images as { url: string }[] | undefined;
    expect(images?.length).toBe(5);
    // Stratégie « primaire d'abord » : on remplit avec or-1..or-4 puis ar-1.
    // Rouge n'apparaît pas dans les 5 premières (visible quand même côté Faire
    // dans les variantes en bas de fiche).
    expect(images?.[0]?.url).toContain("or-1");
    expect(images?.[1]?.url).toContain("or-2");
    expect(images?.[2]?.url).toContain("or-3");
    expect(images?.[3]?.url).toContain("or-4");
    expect(images?.[4]?.url).toContain("ar-1");
  });
});

describe("buildFaireProductPayload — axe Size activé quand ≥ 2 tailles distinctes", () => {
  // Cas H30 : bague ajustable avec 2 couleurs × 4 tailles = 8 variantes UNIT
  // partageant les mêmes noms de couleur. Avant : Faire refuse HTTP 400
  // « Duplicate variants with same options ». Solution : exposer un deuxième
  // axe Size en plus de Color pour que chaque combinaison soit unique.
  function makeRingProduct() {
    return makeProduct({
      reference: "H30",
      primaryColorId: "c-do",
      colors: [52, 53, 54, 55].flatMap((s) => [
        {
          id: `v-ar-${s}`,
          unitPrice: 3.2,
          weight: 0.02,
          stock: 1000,
          isPrimary: false,
          saleType: "UNIT" as const,
          packQuantity: null,
          colorId: "c-ar",
          color: { id: "c-ar", name: "Argent" },
          variantSizes: [{ size: { name: String(s) }, quantity: 1 }],
          packLines: [],
        },
        {
          id: `v-do-${s}`,
          unitPrice: 3.2,
          weight: 0.02,
          stock: 1000,
          isPrimary: s === 52,
          saleType: "UNIT" as const,
          packQuantity: null,
          colorId: "c-do",
          color: { id: "c-do", name: "Doré" },
          variantSizes: [{ size: { name: String(s) }, quantity: 1 }],
          packLines: [],
        },
      ]),
      colorImages: [
        { path: "/uploads/produits/H30/ar-1.webp", order: 0, colorId: "c-ar" },
        { path: "/uploads/produits/H30/do-1.webp", order: 0, colorId: "c-do" },
      ],
    });
  }

  it("expose 2 axes Color + Size dans variant_option_sets", () => {
    const { body } = buildFaireProductPayload(
      makeRingProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    const sets = body.variant_option_sets as { name: string; values: string[] }[];
    expect(sets).toHaveLength(2);
    const byName = new Map(sets.map((s) => [s.name, s.values]));
    expect(byName.get("Color")?.sort()).toEqual(["Argent", "Doré"]);
    expect(byName.get("Size")?.sort()).toEqual(["52", "53", "54", "55"]);
  });

  it("émet une variante Faire par combinaison Couleur × Taille (8 pour H30)", () => {
    const { variants } = buildFaireProductPayload(
      makeRingProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    expect(variants).toHaveLength(8);
    const combos = new Set(
      variants.map((v) => {
        const color = v.payload.options.find((o) => o.name === "Color")?.value;
        const size = v.payload.options.find((o) => o.name === "Size")?.value;
        return `${color}×${size}`;
      }),
    );
    expect(combos.size).toBe(8);
    expect(combos.has("Argent×52")).toBe(true);
    expect(combos.has("Argent×55")).toBe(true);
    expect(combos.has("Doré×52")).toBe(true);
    expect(combos.has("Doré×55")).toBe(true);
  });

  it("chaque variante a exactement 2 options (Color + Size) uniques", () => {
    const { variants } = buildFaireProductPayload(
      makeRingProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    for (const v of variants) {
      expect(v.payload.options).toHaveLength(2);
      const names = v.payload.options.map((o) => o.name).sort();
      expect(names).toEqual(["Color", "Size"]);
    }
  });

  it("SKU intègre la taille et reste unique pour chaque combinaison", () => {
    const { variants } = buildFaireProductPayload(
      makeRingProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    const skus = variants.map((v) => v.sku);
    expect(new Set(skus).size).toBe(skus.length);
    for (const v of variants) {
      const size = v.payload.options.find((o) => o.name === "Size")!.value;
      expect(v.sku).toMatch(new RegExp(`_${size}_UNIT_`));
    }
  });

  it("idempotence_token est unique par combinaison (pas juste par variante BJ)", () => {
    // Sinon Faire répond « Duplicate idempotence_token » quand plusieurs lignes
    // partagent le même bjVariantId (cas variante multi-taille).
    const p = makeProduct({
      colors: [
        {
          id: "v-ar-multi",
          unitPrice: 3.2,
          weight: 0.02,
          stock: 100,
          isPrimary: false,
          saleType: "UNIT" as const,
          packQuantity: null,
          colorId: "c-ar",
          color: { id: "c-ar", name: "Argent" },
          variantSizes: [
            { size: { name: "52" }, quantity: 10 },
            { size: { name: "53" }, quantity: 20 },
          ],
          packLines: [],
        },
        {
          id: "v-do-mono",
          unitPrice: 3.2,
          weight: 0.02,
          stock: 100,
          isPrimary: true,
          saleType: "UNIT" as const,
          packQuantity: null,
          colorId: "c-do",
          color: { id: "c-do", name: "Doré" },
          variantSizes: [{ size: { name: "54" }, quantity: 5 }],
          packLines: [],
        },
      ],
    });
    const { variants } = buildFaireProductPayload(p, ctx, wholesale, retail, "PUBLISHED");
    const tokens = variants.map((v) => v.payload.idempotence_token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("stock envoyé à Faire = quantité de cette taille (pas le stock total de la variante BJ)", () => {
    const p = makeProduct({
      colors: [
        {
          id: "v-ar-multi",
          unitPrice: 3.2,
          weight: 0.02,
          stock: 9999,
          isPrimary: false,
          saleType: "UNIT" as const,
          packQuantity: null,
          colorId: "c-ar",
          color: { id: "c-ar", name: "Argent" },
          variantSizes: [
            { size: { name: "52" }, quantity: 42 },
            { size: { name: "53" }, quantity: 7 },
          ],
          packLines: [],
        },
        {
          id: "v-do-mono",
          unitPrice: 3.2,
          weight: 0.02,
          stock: 3,
          isPrimary: true,
          saleType: "UNIT" as const,
          packQuantity: null,
          colorId: "c-do",
          color: { id: "c-do", name: "Doré" },
          variantSizes: [{ size: { name: "54" }, quantity: 3 }],
          packLines: [],
        },
      ],
    });
    const { variants } = buildFaireProductPayload(p, ctx, wholesale, retail, "PUBLISHED");
    const argent52 = variants.find(
      (v) =>
        v.payload.options.some((o) => o.name === "Color" && o.value === "Argent") &&
        v.payload.options.some((o) => o.name === "Size" && o.value === "52"),
    );
    const argent53 = variants.find(
      (v) =>
        v.payload.options.some((o) => o.name === "Color" && o.value === "Argent") &&
        v.payload.options.some((o) => o.name === "Size" && o.value === "53"),
    );
    expect(argent52?.payload.available_quantity).toBe(42);
    expect(argent53?.payload.available_quantity).toBe(7);
  });

  it("éclate une variante multi-taille en autant de lignes Faire pointant vers la même variante BJ", () => {
    const p = makeProduct({
      colors: [
        {
          id: "v-ar-multi",
          unitPrice: 3.2,
          weight: 0.02,
          stock: 100,
          isPrimary: false,
          saleType: "UNIT" as const,
          packQuantity: null,
          colorId: "c-ar",
          color: { id: "c-ar", name: "Argent" },
          variantSizes: [
            { size: { name: "52" }, quantity: 10 },
            { size: { name: "53" }, quantity: 20 },
            { size: { name: "54" }, quantity: 30 },
          ],
          packLines: [],
        },
        {
          id: "v-do-multi",
          unitPrice: 3.2,
          weight: 0.02,
          stock: 100,
          isPrimary: true,
          saleType: "UNIT" as const,
          packQuantity: null,
          colorId: "c-do",
          color: { id: "c-do", name: "Doré" },
          variantSizes: [
            { size: { name: "52" }, quantity: 5 },
            { size: { name: "53" }, quantity: 15 },
          ],
          packLines: [],
        },
      ],
    });
    const { variants } = buildFaireProductPayload(p, ctx, wholesale, retail, "PUBLISHED");
    expect(variants).toHaveLength(5);
    const argentLines = variants.filter((v) => v.bjVariantId === "v-ar-multi");
    expect(argentLines).toHaveLength(3);
    const doreLines = variants.filter((v) => v.bjVariantId === "v-do-multi");
    expect(doreLines).toHaveLength(2);
  });

  it("garde 1 seul axe Color quand toutes les variantes partagent la même taille (ex 'Taille unique')", () => {
    // Sécurité rétro-compat : les 1051 produits déjà sur Faire ont tous
    // « Taille unique » comme taille — leur SKU et leur schéma d'options
    // NE DOIVENT PAS bouger, sinon le prochain resync recréerait tout.
    const p = makeProduct({
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
          variantSizes: [{ size: { name: "Taille unique" }, quantity: 5 }],
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
          variantSizes: [{ size: { name: "Taille unique" }, quantity: 3 }],
          packLines: [],
        },
      ],
    });
    const { body, variants } = buildFaireProductPayload(p, ctx, wholesale, retail, "PUBLISHED");
    const sets = body.variant_option_sets as { name: string }[];
    expect(sets).toHaveLength(1);
    expect(sets[0].name).toBe("Color");
    expect(variants).toHaveLength(2);
    // SKU au format historique (sans taille) → pas de faux diff au resync.
    for (const v of variants) {
      expect(v.sku).not.toMatch(/_taille/);
    }
  });
});

describe("buildFaireProductPayload — imageBaseUrl (multi-tenant)", () => {
  it("préfixe les URLs images avec le baseUrl du tenant quand fourni", () => {
    const { body, variants } = buildFaireProductPayload(
      makeProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
      undefined,
      "https://issyma.fr",
    );
    const productImages = (body.images as { url: string }[]) ?? [];
    expect(productImages.length).toBeGreaterThan(0);
    for (const img of productImages) {
      expect(img.url).toMatch(/^https:\/\/issyma\.fr\/api\/marketplace-image\?/);
    }
    for (const v of variants) {
      for (const img of v.payload.images ?? []) {
        expect(img.url).toMatch(/^https:\/\/issyma\.fr\/api\/marketplace-image\?/);
      }
    }
  });

  it("retombe sur le fallback env quand baseUrl absent", () => {
    // Sans baseUrl explicite, buildMarketplaceImageUrl lit NEXTAUTH_URL puis
    // fallback https://beliandjolie.com. On vérifie juste que l'URL est bien
    // construite sur ce fallback (le hostname exact dépend de l'env de test).
    const { body } = buildFaireProductPayload(makeProduct(), ctx, wholesale, retail, "PUBLISHED");
    const productImages = (body.images as { url: string }[]) ?? [];
    expect(productImages.length).toBeGreaterThan(0);
    for (const img of productImages) {
      expect(img.url).not.toMatch(/^https:\/\/issyma\.fr\//);
      expect(img.url).toContain("/api/marketplace-image?");
    }
  });
});

describe("buildFaireProductPayload — badge brandé sur variante primaire", () => {
  // Régression : Faire refusait tout PATCH avec HTTP 400 « 2 images
  // principales pour X » quand la variante primaire recevait à la fois
  // l'URL brandée et l'URL brute de la MÊME source (incident U02/Multicolore
  // 2026-07-29). Le fix skip imgPaths[0] dans la liste raw qui suit la
  // brandée : plus jamais deux URLs pointant sur la même image source.
  it("n'inclut jamais la version brute de imgPaths[0] sur la variante primaire quand le badge est actif", () => {
    const { variants } = buildFaireProductPayload(
      makeProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
      undefined,
      "https://beliandjolie.com",
      /* brandedBadgeEnabled */ true,
    );
    const primary = variants.find((v) => v.bjVariantId === "v-or");
    expect(primary, "variante Or (primaire) doit exister").toBeDefined();
    const imgUrls = (primary!.payload.images ?? []).map((i) => i.url);
    // 1ère image : URL brandée (endpoint /api/branded-image).
    expect(imgUrls[0]).toMatch(/\/api\/branded-image\?/);
    expect(imgUrls[0]).toContain("or-1.webp");
    // Aucune autre image ne doit pointer sur or-1.webp (la source déjà brandée).
    for (const url of imgUrls.slice(1)) {
      expect(url, `URL raw ne doit pas dupliquer imgPaths[0] : ${url}`).not.toContain("or-1.webp");
    }
    // Les sequences restent 0..N sans trou.
    const seqs = (primary!.payload.images ?? []).map((i) => i.sequence);
    expect(seqs).toEqual(seqs.map((_, i) => i));
  });

  it("laisse la variante secondaire sans URL brandée (comportement inchangé)", () => {
    const { variants } = buildFaireProductPayload(
      makeProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
      undefined,
      "https://beliandjolie.com",
      true,
    );
    const secondary = variants.find((v) => v.bjVariantId === "v-ar");
    const imgUrls = (secondary!.payload.images ?? []).map((i) => i.url);
    for (const url of imgUrls) {
      expect(url).not.toMatch(/\/api\/branded-image\?/);
    }
  });

  it("badge désactivé : la variante primaire reçoit la brute uniquement (pas d'URL brandée)", () => {
    const { variants } = buildFaireProductPayload(
      makeProduct(),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
      undefined,
      "https://beliandjolie.com",
      /* brandedBadgeEnabled */ false,
    );
    const primary = variants.find((v) => v.bjVariantId === "v-or");
    const imgUrls = (primary!.payload.images ?? []).map((i) => i.url);
    for (const url of imgUrls) {
      expect(url).not.toMatch(/\/api\/branded-image\?/);
    }
    // On garde bien or-1.webp comme 1ère image (pas skippé quand pas de badge).
    expect(imgUrls[0]).toContain("or-1.webp");
  });
});
