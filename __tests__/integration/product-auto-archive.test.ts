/**
 * Integration tests : auto-archivage d'un produit quand toutes ses variantes
 * ont stock=0, déclenché par updateProduct / updateVariantQuick / bulkUpdateVariants.
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

describe("Auto-archive when all variants stock=0", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    // Remove all test products between tests for isolation
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

  // Helper : produit OFFLINE avec 2 variantes (couleur1 stock=10, couleur2 stock=5)
  function twoVariantsProductInput(overrides?: Partial<ProductInput>): ProductInput {
    return {
      reference: `${TEST_PREFIX}AUTO-ARCH-001`,
      name: "Produit auto-archive",
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
      manufacturingCountryId: entities.country.id,
      seasonId: entities.season.id,
      ...overrides,
    };
  }

  // ───────────── updateProduct ─────────────

  describe("updateProduct (full edit form)", () => {
    it("archives the product when all variant stocks are saved to 0", async () => {
      const { id } = await createProduct(twoVariantsProductInput());
      const variants = await prisma.productColor.findMany({ where: { productId: id } });
      const [v1, v2] = variants;

      await updateProduct(id, twoVariantsProductInput({
        colors: [
          {
            dbId: v1.id,
            colorId: entities.color1.id,
            unitPrice: 9.99,
            weight: 0.15,
            stock: 0,
            isPrimary: true,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
          },
          {
            dbId: v2.id,
            colorId: entities.color2.id,
            unitPrice: 9.99,
            weight: 0.15,
            stock: 0,
            isPrimary: false,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
          },
        ],
      }));

      const product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("ARCHIVED");
    });

    it("does NOT archive when at least one variant still has stock", async () => {
      const { id } = await createProduct(twoVariantsProductInput());
      const variants = await prisma.productColor.findMany({ where: { productId: id } });
      const [v1, v2] = variants;

      await updateProduct(id, twoVariantsProductInput({
        colors: [
          {
            dbId: v1.id,
            colorId: entities.color1.id,
            unitPrice: 9.99,
            weight: 0.15,
            stock: 0,
            isPrimary: true,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
          },
          {
            dbId: v2.id,
            colorId: entities.color2.id,
            unitPrice: 9.99,
            weight: 0.15,
            stock: 3,
            isPrimary: false,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
          },
        ],
      }));

      const product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("OFFLINE");
    });

    it("archives even when admin saves with status=OFFLINE", async () => {
      const { id } = await createProduct(twoVariantsProductInput({ status: "OFFLINE" }));
      const variants = await prisma.productColor.findMany({ where: { productId: id } });
      const [v1, v2] = variants;

      await updateProduct(id, twoVariantsProductInput({
        status: "OFFLINE",
        colors: [
          {
            dbId: v1.id,
            colorId: entities.color1.id,
            unitPrice: 9.99,
            weight: 0.15,
            stock: 0,
            isPrimary: true,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
          },
          {
            dbId: v2.id,
            colorId: entities.color2.id,
            unitPrice: 9.99,
            weight: 0.15,
            stock: 0,
            isPrimary: false,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
          },
        ],
      }));

      const product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("ARCHIVED");
    });
  });

  // ───────────── updateVariantQuick ─────────────

  describe("updateVariantQuick (édition rapide ligne)", () => {
    it("archives the product when the last non-zero variant becomes 0", async () => {
      const { id } = await createProduct(twoVariantsProductInput());
      const variants = await prisma.productColor.findMany({ where: { productId: id } });
      const [v1, v2] = variants;

      await updateVariantQuick(v1.id, { stock: 0 });
      let product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("OFFLINE"); // pas encore archivé : v2 a encore du stock

      await updateVariantQuick(v2.id, { stock: 0 });
      product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("ARCHIVED");
    });

    it("does NOT archive when other variants still have stock", async () => {
      const { id } = await createProduct(twoVariantsProductInput());
      const variants = await prisma.productColor.findMany({ where: { productId: id } });
      const [v1] = variants;

      await updateVariantQuick(v1.id, { stock: 0 });

      const product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("OFFLINE");
    });

    it("does not re-archive when product is already ARCHIVED", async () => {
      const { id } = await createProduct(twoVariantsProductInput({ status: "ARCHIVED" }));
      const variants = await prisma.productColor.findMany({ where: { productId: id } });
      const [v1, v2] = variants;

      await updateVariantQuick(v1.id, { stock: 0 });
      await updateVariantQuick(v2.id, { stock: 0 });

      const product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("ARCHIVED");
    });

    it("does not change status when only price is updated (no stock)", async () => {
      const { id } = await createProduct(twoVariantsProductInput());
      const variants = await prisma.productColor.findMany({ where: { productId: id } });
      const [v1] = variants;

      await updateVariantQuick(v1.id, { unitPrice: 19.99 });

      const product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("OFFLINE"); // pas archivé : stock inchangé
    });
  });

  // ───────────── bulkUpdateVariants ─────────────

  describe("bulkUpdateVariants (action en masse)", () => {
    it("archives a product when its last variants are set to 0 in bulk", async () => {
      const { id } = await createProduct(twoVariantsProductInput());
      const variants = await prisma.productColor.findMany({ where: { productId: id } });

      await bulkUpdateVariants(
        variants.map((v) => v.id),
        { stock: 0 },
      );

      const product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("ARCHIVED");
    });

    it("does NOT archive when only one of two variants is zeroed in bulk", async () => {
      const { id } = await createProduct(twoVariantsProductInput());
      const variants = await prisma.productColor.findMany({ where: { productId: id } });
      const [v1] = variants;

      await bulkUpdateVariants([v1.id], { stock: 0 });

      const product = await prisma.product.findUnique({ where: { id } });
      expect(product!.status).toBe("OFFLINE");
    });

    it("handles multiple products in the same bulk call", async () => {
      const a = await createProduct(twoVariantsProductInput({ reference: `${TEST_PREFIX}BULK-A` }));
      const b = await createProduct(twoVariantsProductInput({ reference: `${TEST_PREFIX}BULK-B` }));

      const variantsA = await prisma.productColor.findMany({ where: { productId: a.id } });
      const variantsB = await prisma.productColor.findMany({ where: { productId: b.id } });

      // A : on met à 0 toutes les variantes ; B : juste une variante
      await bulkUpdateVariants(
        [...variantsA.map((v) => v.id), variantsB[0].id],
        { stock: 0 },
      );

      const productA = await prisma.product.findUnique({ where: { id: a.id } });
      const productB = await prisma.product.findUnique({ where: { id: b.id } });
      expect(productA!.status).toBe("ARCHIVED");
      expect(productB!.status).toBe("OFFLINE");
    });
  });
});
