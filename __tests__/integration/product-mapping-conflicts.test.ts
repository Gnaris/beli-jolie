/**
 * Blocage serveur : deux couleurs différentes du même produit ne peuvent pas
 * partager le même mapping PFS ou eFashion effectif (principal ou override).
 * Vérifie que createProduct/updateProduct throw avec un message explicite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { createProduct, updateProduct } from "@/app/actions/admin/products";
import type { ProductInput } from "@/app/actions/admin/products";

describe("Product mapping conflicts (real DB)", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  function twoColorProductInput(overrides?: Partial<ProductInput>): ProductInput {
    return {
      reference: `${TEST_PREFIX}MAP-001`,
      name: "Bague conflit mapping",
      description: "Test conflit mapping",
      categoryId: entities.category.id,
      subCategoryIds: [],
      colors: [
        {
          colorId: entities.color1.id,
          unitPrice: 9.99,
          weight: 0.15,
          stock: 10,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
        },
        {
          colorId: entities.color2.id,
          unitPrice: 9.99,
          weight: 0.15,
          stock: 10,
          isPrimary: false,
          saleType: "UNIT",
          packQuantity: null,
          sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
        },
      ],
      compositions: [{ compositionId: entities.composition.id, percentage: 100 }],
      similarProductIds: [],
      bundleChildIds: [],
      tagNames: [],
      isBestSeller: false,
      discountPercent: null,
      status: "OFFLINE",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      countryIsoCode: entities.country.id,
      seasonId: entities.season.id,
      ...overrides,
    };
  }

  describe("PFS mapping conflicts", () => {
    it("refuse deux couleurs avec le même pfsColorRef principal", async () => {
      await prisma.color.update({ where: { id: entities.color1.id }, data: { pfsColorRef: "OR" } });
      await prisma.color.update({ where: { id: entities.color2.id }, data: { pfsColorRef: "OR" } });

      await expect(createProduct(twoColorProductInput())).rejects.toThrow(/Conflit de mapping PFS/);
    });

    it("refuse un override PFS qui collisionne avec le principal d'une autre couleur", async () => {
      await prisma.color.update({ where: { id: entities.color1.id }, data: { pfsColorRef: "OR" } });
      await prisma.color.update({ where: { id: entities.color2.id }, data: { pfsColorRef: "ARGENT" } });

      const input = twoColorProductInput({
        reference: `${TEST_PREFIX}MAP-002`,
        colors: [
          {
            colorId: entities.color1.id,
            unitPrice: 9.99, weight: 0.15, stock: 10,
            isPrimary: true, saleType: "UNIT", packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
          },
          {
            colorId: entities.color2.id,
            unitPrice: 9.99, weight: 0.15, stock: 10,
            isPrimary: false, saleType: "UNIT", packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            pfsColorRefOverride: "OR",
          },
        ],
      });
      await expect(createProduct(input)).rejects.toThrow(/Conflit de mapping PFS/);
    });

    it("accepte deux couleurs avec des mappings PFS différents", async () => {
      await prisma.color.update({ where: { id: entities.color1.id }, data: { pfsColorRef: "OR" } });
      await prisma.color.update({ where: { id: entities.color2.id }, data: { pfsColorRef: "ARGENT" } });

      const result = await createProduct(
        twoColorProductInput({ reference: `${TEST_PREFIX}MAP-003` }),
      );
      expect(result.id).toBeDefined();
    });
  });

  describe("eFashion mapping conflicts", () => {
    it("refuse deux couleurs avec le même efashionColorId principal", async () => {
      await prisma.color.update({
        where: { id: entities.color1.id },
        data: { pfsColorRef: null, efashionColorId: 78 },
      });
      await prisma.color.update({
        where: { id: entities.color2.id },
        data: { pfsColorRef: null, efashionColorId: 78 },
      });

      await expect(
        createProduct(twoColorProductInput({ reference: `${TEST_PREFIX}MAP-004` })),
      ).rejects.toThrow(/Conflit de mapping eFashion/);
    });

    it("refuse une modification introduisant un conflit eFashion", async () => {
      await prisma.color.update({
        where: { id: entities.color1.id },
        data: { pfsColorRef: null, efashionColorId: 78 },
      });
      await prisma.color.update({
        where: { id: entities.color2.id },
        data: { pfsColorRef: null, efashionColorId: 22 },
      });

      const created = await createProduct(
        twoColorProductInput({ reference: `${TEST_PREFIX}MAP-005` }),
      );

      // Charge les dbId des variantes pour updateProduct (verrouillage colorId
      // existant en mode update — le server action ignore colorId sur les
      // variantes déjà persistées).
      const persisted = await prisma.productColor.findMany({
        where: { productId: created.id },
        select: { id: true, colorId: true },
      });
      const dbIdByColorId = new Map(persisted.map((p) => [p.colorId, p.id]));

      const badUpdate = twoColorProductInput({
        reference: `${TEST_PREFIX}MAP-005`,
        colors: [
          {
            dbId: dbIdByColorId.get(entities.color1.id),
            colorId: entities.color1.id,
            unitPrice: 9.99, weight: 0.15, stock: 10,
            isPrimary: true, saleType: "UNIT", packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
          },
          {
            dbId: dbIdByColorId.get(entities.color2.id),
            colorId: entities.color2.id,
            unitPrice: 9.99, weight: 0.15, stock: 10,
            isPrimary: false, saleType: "UNIT", packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            efashionColorIdOverride: 78,
          },
        ],
      });
      await expect(updateProduct(created.id, badUpdate)).rejects.toThrow(
        /Conflit de mapping eFashion/,
      );
    });
  });
});
