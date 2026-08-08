/**
 * Integration tests : depuis 2026-08-07, le statut local d'un produit n'est
 * PLUS modifié automatiquement quand toutes ses variantes passent à stock=0.
 * L'admin garde le contrôle (règle métier posée par la cliente pour permettre
 * de garder un produit en ligne même en rupture, sans que le pull d'audit
 * PFS soit blocké).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import {
  createProduct,
  updateProduct,
  updateVariantQuick,
  bulkUpdateVariants,
} from "@/app/actions/admin/products";
import type { ProductInput } from "@/app/actions/admin/products";

describe("Statut préservé quand toutes les variantes passent à stock=0", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    const productIds = (
      await prisma.product.findMany({
        where: { reference: { startsWith: TEST_PREFIX } },
        select: { id: true },
      })
    ).map((p) => p.id);

    if (productIds.length > 0) {
      const variantIds = (
        await prisma.productColor.findMany({
          where: { productId: { in: productIds } },
          select: { id: true },
        })
      ).map((v) => v.id);
      if (variantIds.length > 0) {
        await prisma.variantSize.deleteMany({ where: { productColorId: { in: variantIds } } });
        await prisma.productColor.deleteMany({ where: { id: { in: variantIds } } });
      }
      await prisma.productColorImage.deleteMany({ where: { productId: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
  });

  function twoVariantsProductInput(overrides?: Partial<ProductInput>): ProductInput {
    return {
      reference: `${TEST_PREFIX}NO-AUTO-ARCH-001`,
      name: "Produit statut préservé",
      description: "Test",
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
          stock: 5,
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

  describe("updateProduct (formulaire complet)", () => {
    it("ne bascule pas ARCHIVED quand tous les stocks passent à 0 (statut préservé)", async () => {
      const { id } = await createProduct(twoVariantsProductInput());
      const variants = await prisma.productColor.findMany({ where: { productId: id } });
      const [v1, v2] = variants;

      await updateProduct(id, twoVariantsProductInput({
        colors: [
          { dbId: v1.id, colorId: entities.color1.id, unitPrice: 9.99, weight: 0.15, stock: 0, isPrimary: true, saleType: "UNIT", packQuantity: null, sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }] },
          { dbId: v2.id, colorId: entities.color2.id, unitPrice: 9.99, weight: 0.15, stock: 0, isPrimary: false, saleType: "UNIT", packQuantity: null, sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }] },
        ],
      }));

      const product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("OFFLINE");
    });

    it("préserve un produit ONLINE en rupture totale", async () => {
      const { id } = await createProduct(twoVariantsProductInput({ status: "ONLINE" }));
      const variants = await prisma.productColor.findMany({ where: { productId: id } });
      const [v1, v2] = variants;

      await updateProduct(id, twoVariantsProductInput({
        status: "ONLINE",
        colors: [
          { dbId: v1.id, colorId: entities.color1.id, unitPrice: 9.99, weight: 0.15, stock: 0, isPrimary: true, saleType: "UNIT", packQuantity: null, sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }] },
          { dbId: v2.id, colorId: entities.color2.id, unitPrice: 9.99, weight: 0.15, stock: 0, isPrimary: false, saleType: "UNIT", packQuantity: null, sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }] },
        ],
      }));

      const product = await prisma.product.findUnique({ where: { id } });
      // ONLINE préservé même en rupture totale : c'est à l'admin de décider.
      expect(product!.status).toBe("ONLINE");
    });
  });

  describe("updateVariantQuick (édition rapide ligne)", () => {
    it("ne bascule pas ARCHIVED quand la dernière variante passe à 0", async () => {
      const { id } = await createProduct(twoVariantsProductInput({ status: "ONLINE" }));
      const variants = await prisma.productColor.findMany({ where: { productId: id } });
      const [v1, v2] = variants;

      await updateVariantQuick(v1.id, { stock: 0 });
      await updateVariantQuick(v2.id, { stock: 0 });

      const product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("ONLINE");
    });
  });

  describe("bulkUpdateVariants (action en masse)", () => {
    it("ne bascule pas ARCHIVED quand toutes les variantes passent à 0 en une passe", async () => {
      const { id } = await createProduct(twoVariantsProductInput({ status: "ONLINE" }));
      const variants = await prisma.productColor.findMany({ where: { productId: id } });

      await bulkUpdateVariants(
        variants.map((v) => v.id),
        { stock: 0 },
      );

      const product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("ONLINE");
    });
  });
});
