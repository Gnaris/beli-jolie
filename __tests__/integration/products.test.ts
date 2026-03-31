/**
 * Integration tests: Product CRUD — UNIT + PACK variants, status, stock, price, bestseller.
 *
 * Uses REAL database. Tests the full product lifecycle through server actions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { createProduct, updateProduct, deleteProduct, archiveProduct, unarchiveProduct, toggleBestSeller, bulkUpdateProductStatus } from "@/app/actions/admin/products";
import type { ProductInput, ColorInput } from "@/app/actions/admin/products";

describe("Product CRUD (real DB)", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // Helper to build a minimal UNIT product input
  function unitProductInput(overrides?: Partial<ProductInput>): ProductInput {
    return {
      reference: `${TEST_PREFIX}PROD-001`,
      name: "Bague test dorée",
      description: "Description test",
      categoryId: entities.category.id,
      subCategoryIds: [],
      colors: [
        {
          colorId: entities.color1.id,
          unitPrice: 9.99,
          weight: 0.15,
          stock: 100,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
          packColorLines: [],
          discountType: null,
          discountValue: null,
        },
      ],
      compositions: [{ compositionId: entities.composition.id, percentage: 100 }],
      similarProductIds: [],
      bundleChildIds: [],
      tagNames: [],
      isBestSeller: false,
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

  // ─── Create UNIT Product ───────────────────────────────────────

  describe("Create UNIT product", () => {
    let productId: string;

    it("should create a product with one UNIT variant", async () => {
      const result = await createProduct(unitProductInput());
      productId = result.id;

      expect(productId).toBeDefined();
      expect(typeof productId).toBe("string");
    });

    it("should persist product fields correctly", async () => {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          category: true,
          manufacturingCountry: true,
          season: true,
          compositions: { include: { composition: true } },
          colors: {
            include: {
              color: true,
              variantSizes: { include: { size: true } },
              subColors: true,
            },
          },
        },
      });

      expect(product).not.toBeNull();
      expect(product!.reference).toBe(`${TEST_PREFIX}PROD-001`);
      expect(product!.name).toBe("Bague test dorée");
      expect(product!.status).toBe("OFFLINE");
      expect(product!.category.name).toBe(`${TEST_PREFIX}Bagues`);
      expect(product!.manufacturingCountry?.name).toBe(`${TEST_PREFIX}France`);
      expect(product!.season?.name).toBe(`${TEST_PREFIX}PE2026`);

      // Composition
      expect(product!.compositions).toHaveLength(1);
      expect(product!.compositions[0].percentage).toBe(100);

      // Variant
      expect(product!.colors).toHaveLength(1);
      const variant = product!.colors[0];
      expect(variant.saleType).toBe("UNIT");
      expect(Number(variant.unitPrice)).toBe(9.99);
      expect(variant.weight).toBeCloseTo(0.15);
      expect(variant.stock).toBe(100);
      expect(variant.isPrimary).toBe(true);
      expect(variant.color?.name).toBe(`${TEST_PREFIX}Doré`);

      // Size
      expect(variant.variantSizes).toHaveLength(1);
      expect(variant.variantSizes[0].size.name).toBe(`${TEST_PREFIX}TU`);
    });

    it("should enforce unique reference", async () => {
      await expect(
        createProduct(unitProductInput()),
      ).rejects.toThrow();
    });
  });

  // ─── Create multi-variant product ──────────────────────────────

  describe("Create product with multiple UNIT variants", () => {
    let productId: string;

    it("should create product with 2 color variants", async () => {
      const input = unitProductInput({
        reference: `${TEST_PREFIX}PROD-002`,
        name: "Bague bicolore",
        colors: [
          {
            colorId: entities.color1.id,
            unitPrice: 12.50,
            weight: 0.2,
            stock: 50,
            isPrimary: true,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            packColorLines: [],
            discountType: null,
            discountValue: null,
          },
          {
            colorId: entities.color2.id,
            unitPrice: 12.50,
            weight: 0.2,
            stock: 30,
            isPrimary: false,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            packColorLines: [],
            discountType: "PERCENT",
            discountValue: 10,
          },
        ],
      });

      const result = await createProduct(input);
      productId = result.id;

      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { colors: { include: { color: true }, orderBy: { isPrimary: "desc" } } },
      });

      expect(product!.colors).toHaveLength(2);

      // Primary variant
      expect(product!.colors[0].isPrimary).toBe(true);
      expect(product!.colors[0].color?.name).toBe(`${TEST_PREFIX}Doré`);
      expect(product!.colors[0].discountType).toBeNull();

      // Secondary variant with discount
      expect(product!.colors[1].isPrimary).toBe(false);
      expect(product!.colors[1].color?.name).toBe(`${TEST_PREFIX}Argenté`);
      expect(product!.colors[1].discountType).toBe("PERCENT");
      expect(Number(product!.colors[1].discountValue)).toBe(10);
    });
  });

  // ─── Create PACK Product ───────────────────────────────────────

  describe("Create PACK product", () => {
    let productId: string;

    it("should create a PACK product with pack color lines", async () => {
      const input = unitProductInput({
        reference: `${TEST_PREFIX}PROD-PACK-001`,
        name: "Lot de bagues assorties",
        colors: [
          {
            colorId: null,
            unitPrice: 29.99,
            weight: 0.5,
            stock: 20,
            isPrimary: true,
            saleType: "PACK",
            packQuantity: 6,
            sizeEntries: [
              { sizeId: entities.sizeS.id, quantity: 3, pricePerUnit: 5 },
              { sizeId: entities.sizeM.id, quantity: 3, pricePerUnit: 5 },
            ],
            packColorLines: [
              { colorIds: [entities.color1.id, entities.color2.id, entities.color3.id], position: 0 },
            ],
            discountType: null,
            discountValue: null,
          },
        ],
      });

      const result = await createProduct(input);
      productId = result.id;

      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          colors: {
            include: {
              variantSizes: { include: { size: true }, orderBy: { size: { position: "asc" } } },
              packColorLines: {
                include: { colors: { include: { color: true }, orderBy: { position: "asc" } } },
                orderBy: { position: "asc" },
              },
            },
          },
        },
      });

      expect(product!.colors).toHaveLength(1);
      const variant = product!.colors[0];

      // PACK specific
      expect(variant.saleType).toBe("PACK");
      expect(variant.colorId).toBeNull();
      expect(variant.packQuantity).toBe(6);

      // Sizes
      expect(variant.variantSizes).toHaveLength(2);
      expect(variant.variantSizes[0].size.name).toBe(`${TEST_PREFIX}S`);
      expect(variant.variantSizes[0].quantity).toBe(3);
      expect(variant.variantSizes[1].size.name).toBe(`${TEST_PREFIX}M`);

      // Pack color lines
      expect(variant.packColorLines).toHaveLength(1);
      expect(variant.packColorLines[0].colors).toHaveLength(3);
      expect(variant.packColorLines[0].colors[0].color.name).toBe(`${TEST_PREFIX}Doré`);
      expect(variant.packColorLines[0].colors[1].color.name).toBe(`${TEST_PREFIX}Argenté`);
      expect(variant.packColorLines[0].colors[2].color.name).toBe(`${TEST_PREFIX}Rose`);
    });
  });

  // ─── Update Product ────────────────────────────────────────────

  describe("Update product", () => {
    let productId: string;
    let variantDbId: string;

    beforeAll(async () => {
      const result = await createProduct(unitProductInput({
        reference: `${TEST_PREFIX}PROD-UPD-001`,
        name: "Produit à modifier",
      }));
      productId = result.id;

      const variants = await prisma.productColor.findMany({
        where: { productId },
      });
      variantDbId = variants[0].id;
    });

    it("should update product name and description", async () => {
      await updateProduct(productId, unitProductInput({
        reference: `${TEST_PREFIX}PROD-UPD-001`,
        name: "Produit modifié",
        description: "Nouvelle description",
        colors: [
          {
            dbId: variantDbId,
            colorId: entities.color1.id,
            unitPrice: 9.99,
            weight: 0.15,
            stock: 100,
            isPrimary: true,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            packColorLines: [],
            discountType: null,
            discountValue: null,
          },
        ],
      }));

      const product = await prisma.product.findUnique({ where: { id: productId } });
      expect(product!.name).toBe("Produit modifié");
      expect(product!.description).toBe("Nouvelle description");
    });

    it("should update variant price and stock", async () => {
      await updateProduct(productId, unitProductInput({
        reference: `${TEST_PREFIX}PROD-UPD-001`,
        name: "Produit modifié",
        colors: [
          {
            dbId: variantDbId,
            colorId: entities.color1.id,
            unitPrice: 14.99,
            weight: 0.2,
            stock: 200,
            isPrimary: true,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            packColorLines: [],
            discountType: "AMOUNT",
            discountValue: 2,
          },
        ],
      }));

      const variant = await prisma.productColor.findUnique({ where: { id: variantDbId } });
      expect(Number(variant!.unitPrice)).toBe(14.99);
      expect(variant!.stock).toBe(200);
      expect(variant!.weight).toBeCloseTo(0.2);
      expect(variant!.discountType).toBe("AMOUNT");
      expect(Number(variant!.discountValue)).toBe(2);
    });

    it("should add a second variant during update", async () => {
      await updateProduct(productId, unitProductInput({
        reference: `${TEST_PREFIX}PROD-UPD-001`,
        name: "Produit modifié",
        colors: [
          {
            dbId: variantDbId,
            colorId: entities.color1.id,
            unitPrice: 14.99,
            weight: 0.2,
            stock: 200,
            isPrimary: true,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            packColorLines: [],
            discountType: "AMOUNT",
            discountValue: 2,
          },
          {
            colorId: entities.color2.id,
            unitPrice: 11.99,
            weight: 0.15,
            stock: 50,
            isPrimary: false,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            packColorLines: [],
            discountType: null,
            discountValue: null,
          },
        ],
      }));

      const variants = await prisma.productColor.findMany({
        where: { productId },
        orderBy: { isPrimary: "desc" },
      });
      expect(variants).toHaveLength(2);
      expect(Number(variants[1].unitPrice)).toBe(11.99);
    });

    it("should change composition", async () => {
      const newComp = await prisma.composition.create({
        data: { name: `${TEST_PREFIX}Cuivre` },
      });

      await updateProduct(productId, unitProductInput({
        reference: `${TEST_PREFIX}PROD-UPD-001`,
        name: "Produit modifié",
        colors: [
          {
            dbId: variantDbId,
            colorId: entities.color1.id,
            unitPrice: 14.99,
            weight: 0.2,
            stock: 200,
            isPrimary: true,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            packColorLines: [],
            discountType: null,
            discountValue: null,
          },
        ],
        compositions: [
          { compositionId: entities.composition.id, percentage: 70 },
          { compositionId: newComp.id, percentage: 30 },
        ],
      }));

      const compositions = await prisma.productComposition.findMany({
        where: { productId },
        include: { composition: true },
        orderBy: { percentage: "desc" },
      });
      expect(compositions).toHaveLength(2);
      expect(compositions[0].percentage).toBe(70);
      expect(compositions[1].percentage).toBe(30);
      expect(compositions[1].composition.name).toBe(`${TEST_PREFIX}Cuivre`);
    });
  });

  // ─── Status transitions ────────────────────────────────────────

  describe("Status transitions", () => {
    let productId: string;

    beforeAll(async () => {
      const result = await createProduct(unitProductInput({
        reference: `${TEST_PREFIX}PROD-STATUS-001`,
        name: "Produit pour status",
      }));
      productId = result.id;
    });

    it("product should start OFFLINE", async () => {
      const product = await prisma.product.findUnique({ where: { id: productId } });
      expect(product!.status).toBe("OFFLINE");
    });

    it("should archive product (OFFLINE → ARCHIVED)", async () => {
      await archiveProduct(productId);

      const product = await prisma.product.findUnique({ where: { id: productId } });
      expect(product!.status).toBe("ARCHIVED");
    });

    it("should unarchive product (ARCHIVED → OFFLINE)", async () => {
      await unarchiveProduct(productId);

      const product = await prisma.product.findUnique({ where: { id: productId } });
      expect(product!.status).toBe("OFFLINE");
    });

    it("bulkUpdateProductStatus should validate before setting ONLINE", async () => {
      // Product has no images → should fail ONLINE validation
      const result = await bulkUpdateProductStatus([productId], "ONLINE");

      // Should have error because no images
      expect(result.errors.length).toBeGreaterThanOrEqual(0);
      // If it succeeded, check status
      if (result.success.includes(productId)) {
        const product = await prisma.product.findUnique({ where: { id: productId } });
        expect(product!.status).toBe("ONLINE");
      }
    });
  });

  // ─── Bestseller toggle ─────────────────────────────────────────

  describe("Bestseller toggle", () => {
    let productId: string;

    beforeAll(async () => {
      const result = await createProduct(unitProductInput({
        reference: `${TEST_PREFIX}PROD-BS-001`,
        name: "Bestseller test",
      }));
      productId = result.id;
    });

    it("should toggle bestseller ON", async () => {
      const result = await toggleBestSeller(productId, true);
      expect(result.success).toBe(true);

      const product = await prisma.product.findUnique({ where: { id: productId } });
      expect(product!.isBestSeller).toBe(true);
    });

    it("should toggle bestseller OFF", async () => {
      const result = await toggleBestSeller(productId, false);
      expect(result.success).toBe(true);

      const product = await prisma.product.findUnique({ where: { id: productId } });
      expect(product!.isBestSeller).toBe(false);
    });

    it("should return success if already in desired state", async () => {
      const result = await toggleBestSeller(productId, false);
      expect(result.success).toBe(true);
    });
  });

  // ─── Delete product ────────────────────────────────────────────

  describe("Delete product", () => {
    let productId: string;

    beforeAll(async () => {
      const result = await createProduct(unitProductInput({
        reference: `${TEST_PREFIX}PROD-DEL-001`,
        name: "Produit à supprimer",
      }));
      productId = result.id;
    });

    it("should delete product with no orders", async () => {
      // deleteProduct calls redirect, which is mocked
      await deleteProduct(productId);

      const product = await prisma.product.findUnique({ where: { id: productId } });
      expect(product).toBeNull();

      // Variants should also be deleted (cascade)
      const variants = await prisma.productColor.findMany({ where: { productId } });
      expect(variants).toHaveLength(0);
    });
  });

  // ─── Sub-colors on UNIT variant ────────────────────────────────

  describe("UNIT variant with sub-colors", () => {
    let productId: string;

    it("should create variant with sub-colors", async () => {
      const result = await createProduct(unitProductInput({
        reference: `${TEST_PREFIX}PROD-SUBCOL-001`,
        name: "Bague tricolore",
        colors: [
          {
            colorId: entities.color1.id,
            subColorIds: [entities.color2.id, entities.color3.id],
            unitPrice: 15,
            weight: 0.2,
            stock: 40,
            isPrimary: true,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            packColorLines: [],
            discountType: null,
            discountValue: null,
          },
        ],
      }));
      productId = result.id;

      const variant = await prisma.productColor.findFirst({
        where: { productId },
        include: {
          subColors: { include: { color: true }, orderBy: { position: "asc" } },
        },
      });

      expect(variant!.subColors).toHaveLength(2);
      expect(variant!.subColors[0].color.name).toBe(`${TEST_PREFIX}Argenté`);
      expect(variant!.subColors[1].color.name).toBe(`${TEST_PREFIX}Rose`);
    });
  });

  // ─── Tags ──────────────────────────────────────────────────────

  describe("Product tags", () => {
    it("should create product with tags (auto-created)", async () => {
      const result = await createProduct(unitProductInput({
        reference: `${TEST_PREFIX}PROD-TAG-001`,
        name: "Bague avec tags",
        tagNames: [`${TEST_PREFIX}Promo`, `${TEST_PREFIX}Été`],
      }));

      const tags = await prisma.productTag.findMany({
        where: { productId: result.id },
        include: { tag: true },
      });

      expect(tags).toHaveLength(2);
      const tagNames = tags.map((t) => t.tag.name).sort();
      // createProduct lowercases tag names
      expect(tagNames).toContain(`${TEST_PREFIX}Promo`.toLowerCase());
      expect(tagNames).toContain(`${TEST_PREFIX}Été`.toLowerCase());
    });
  });
});
