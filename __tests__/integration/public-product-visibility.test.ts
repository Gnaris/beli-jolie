/**
 * Integration test: helper `publicVisibleProductWhere` filtre les produits
 * dont toutes les variantes sont soit désactivées, soit à stock zéro.
 *
 * Ce filtre est appliqué sur tous les listings publics : /produits, home,
 * catégories, collections, recherche, sitemap. L'admin (/admin/produits)
 * n'utilise PAS ce filtre.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { PUBLIC_SELLABLE_COLORS_CLAUSE } from "@/lib/public-product-visibility";

describe("Public product visibility filter", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  let sellableId: string;
  let allDisabledId: string;
  let allOutOfStockId: string;
  let mixedDisabledAndOosId: string;
  let mixedOneSellableId: string;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();

    // A — 1 variante active stock 5 → VISIBLE.
    const sellable = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}VIS-A`,
        name: "Sellable product",
        description: "",
        categoryId: entities.category.id,
        countryIsoCode: entities.country.id,
        seasonId: entities.season.id,
        status: "ONLINE",
      },
    });
    sellableId = sellable.id;
    await prisma.productColor.create({
      data: {
        productId: sellableId,
        colorId: entities.color1.id,
        unitPrice: 10,
        weight: 0.05,
        stock: 5,
        saleType: "UNIT",
        disabled: false,
      },
    });

    // B — toutes variantes disabled=true → MASQUÉ.
    const allDisabled = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}VIS-B`,
        name: "All disabled",
        description: "",
        categoryId: entities.category.id,
        countryIsoCode: entities.country.id,
        seasonId: entities.season.id,
        status: "ONLINE",
      },
    });
    allDisabledId = allDisabled.id;
    await prisma.productColor.createMany({
      data: [
        {
          productId: allDisabledId,
          colorId: entities.color1.id,
          unitPrice: 10,
          weight: 0.05,
          stock: 5,
          saleType: "UNIT",
          disabled: true,
        },
        {
          productId: allDisabledId,
          colorId: entities.color2.id,
          unitPrice: 10,
          weight: 0.05,
          stock: 10,
          saleType: "UNIT",
          disabled: true,
        },
      ],
    });

    // C — toutes variantes stock 0 → MASQUÉ.
    const allOos = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}VIS-C`,
        name: "All out of stock",
        description: "",
        categoryId: entities.category.id,
        countryIsoCode: entities.country.id,
        seasonId: entities.season.id,
        status: "ONLINE",
      },
    });
    allOutOfStockId = allOos.id;
    await prisma.productColor.createMany({
      data: [
        {
          productId: allOutOfStockId,
          colorId: entities.color1.id,
          unitPrice: 10,
          weight: 0.05,
          stock: 0,
          saleType: "UNIT",
          disabled: false,
        },
        {
          productId: allOutOfStockId,
          colorId: entities.color2.id,
          unitPrice: 10,
          weight: 0.05,
          stock: 0,
          saleType: "UNIT",
          disabled: false,
        },
      ],
    });

    // D — mix : une disabled+stock>0, une active+stock=0 → aucune vendable, MASQUÉ.
    const mixed = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}VIS-D`,
        name: "Mixed disabled + oos",
        description: "",
        categoryId: entities.category.id,
        countryIsoCode: entities.country.id,
        seasonId: entities.season.id,
        status: "ONLINE",
      },
    });
    mixedDisabledAndOosId = mixed.id;
    await prisma.productColor.createMany({
      data: [
        {
          productId: mixedDisabledAndOosId,
          colorId: entities.color1.id,
          unitPrice: 10,
          weight: 0.05,
          stock: 5,
          saleType: "UNIT",
          disabled: true,
        },
        {
          productId: mixedDisabledAndOosId,
          colorId: entities.color2.id,
          unitPrice: 10,
          weight: 0.05,
          stock: 0,
          saleType: "UNIT",
          disabled: false,
        },
      ],
    });

    // E — mix : une disabled, une active stock>0 → VISIBLE.
    const mixedOne = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}VIS-E`,
        name: "Mixed one sellable",
        description: "",
        categoryId: entities.category.id,
        countryIsoCode: entities.country.id,
        seasonId: entities.season.id,
        status: "ONLINE",
      },
    });
    mixedOneSellableId = mixedOne.id;
    await prisma.productColor.createMany({
      data: [
        {
          productId: mixedOneSellableId,
          colorId: entities.color1.id,
          unitPrice: 10,
          weight: 0.05,
          stock: 0,
          saleType: "UNIT",
          disabled: true,
        },
        {
          productId: mixedOneSellableId,
          colorId: entities.color2.id,
          unitPrice: 10,
          weight: 0.05,
          stock: 3,
          saleType: "UNIT",
          disabled: false,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("garde le produit qui a au moins une variante active en stock", async () => {
    const rows = await prisma.product.findMany({
      where: {
        status: "ONLINE",
        colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
        reference: { startsWith: TEST_PREFIX },
      },
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(sellableId);
    expect(ids).toContain(mixedOneSellableId);
  });

  it("masque le produit dont toutes les variantes sont désactivées", async () => {
    const rows = await prisma.product.findMany({
      where: {
        status: "ONLINE",
        colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
        reference: { startsWith: TEST_PREFIX },
      },
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).not.toContain(allDisabledId);
  });

  it("masque le produit dont toutes les variantes sont à stock zéro", async () => {
    const rows = await prisma.product.findMany({
      where: {
        status: "ONLINE",
        colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
        reference: { startsWith: TEST_PREFIX },
      },
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).not.toContain(allOutOfStockId);
  });

  it("masque le produit dont chaque variante est soit désactivée soit à stock zéro", async () => {
    const rows = await prisma.product.findMany({
      where: {
        status: "ONLINE",
        colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
        reference: { startsWith: TEST_PREFIX },
      },
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).not.toContain(mixedDisabledAndOosId);
  });

  it("compte correctement les produits visibles (getCachedProductCount-like)", async () => {
    const count = await prisma.product.count({
      where: {
        status: "ONLINE",
        colors: PUBLIC_SELLABLE_COLORS_CLAUSE,
        reference: { startsWith: TEST_PREFIX },
      },
    });
    // Attendu : A + E visibles → 2. B, C, D masqués.
    expect(count).toBe(2);
  });
});
