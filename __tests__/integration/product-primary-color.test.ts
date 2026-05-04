/**
 * Integration tests : refonte couleurs au niveau produit.
 *
 * Vérifie que :
 *  - createProduct écrit Product.primaryColorId
 *  - createProduct dédoublonne les images quand 2 variantes partagent la même couleur
 *  - updateProduct accepte une couleur de pack-line comme principale (résout bug Orange)
 *  - updateProduct réassigne auto si la couleur courante n'est plus dans l'union
 *  - les images sont stockées avec productColorId = NULL après refonte
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { createProduct, updateProduct } from "@/app/actions/admin/products";
import type { ProductInput } from "@/app/actions/admin/products";

describe("Refonte couleurs au niveau produit (real DB)", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  function baseInput(overrides?: Partial<ProductInput>): ProductInput {
    return {
      reference: `${TEST_PREFIX}PRIM-001`,
      name: "Produit test couleur principale",
      description: "Description test",
      categoryId: entities.category.id,
      subCategoryIds: [],
      colors: [
        {
          colorId: entities.color1.id,
          unitPrice: 9.99,
          weight: 0.1,
          stock: 10,
          isPrimary: true,
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

  describe("createProduct.primaryColorId", () => {
    it("auto-assigne primaryColorId depuis la 1ʳᵉ variante quand l'input ne le fournit pas", async () => {
      const result = await createProduct(
        baseInput({ reference: `${TEST_PREFIX}PRIM-AUTO` }),
      );
      const product = await prisma.product.findUnique({
        where: { id: result.id },
        select: { primaryColorId: true },
      });
      expect(product?.primaryColorId).toBe(entities.color1.id);
    });

    it("respecte primaryColorId fourni quand il est dans l'union des couleurs", async () => {
      const result = await createProduct(
        baseInput({
          reference: `${TEST_PREFIX}PRIM-RESPECT`,
          primaryColorId: entities.color1.id,
          colors: [
            {
              colorId: entities.color1.id,
              unitPrice: 9.99,
              weight: 0.1,
              stock: 10,
              isPrimary: true,
              saleType: "UNIT",
              packQuantity: null,
              sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            },
            {
              colorId: entities.color2.id,
              unitPrice: 9.99,
              weight: 0.1,
              stock: 10,
              isPrimary: false,
              saleType: "UNIT",
              packQuantity: null,
              sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            },
          ],
        }),
      );
      const product = await prisma.product.findUnique({
        where: { id: result.id },
        select: { primaryColorId: true },
      });
      expect(product?.primaryColorId).toBe(entities.color1.id);
    });

    it("réassigne sur la 1ʳᵉ couleur disponible si l'input est invalide", async () => {
      const result = await createProduct(
        baseInput({
          reference: `${TEST_PREFIX}PRIM-FALLBACK`,
          primaryColorId: "id-inexistant-dans-l-union",
        }),
      );
      const product = await prisma.product.findUnique({
        where: { id: result.id },
        select: { primaryColorId: true },
      });
      expect(product?.primaryColorId).toBe(entities.color1.id);
    });
  });

  describe("createProduct image dedup", () => {
    it("ne crée qu'une seule ProductColorImage par (colorId, order, path) même si imagePaths contient des doublons", async () => {
      const result = await createProduct(
        baseInput({
          reference: `${TEST_PREFIX}PRIM-DEDUP`,
          colors: [
            {
              colorId: entities.color1.id,
              unitPrice: 9.99,
              weight: 0.1,
              stock: 10,
              isPrimary: true,
              saleType: "UNIT",
              packQuantity: null,
              sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            },
            {
              colorId: entities.color1.id,
              unitPrice: 19.99,
              weight: 0.2,
              stock: 5,
              isPrimary: false,
              saleType: "PACK",
              packQuantity: 3,
              sizeEntries: [{ sizeId: entities.size.id, quantity: 3 }],
            },
          ],
          imagePaths: [
            { colorId: entities.color1.id, paths: ["/uploads/dore-1.webp", "/uploads/dore-2.webp"], orders: [0, 1] },
            { colorId: entities.color1.id, paths: ["/uploads/dore-1.webp", "/uploads/dore-2.webp"], orders: [0, 1] },
          ],
        }),
      );
      const images = await prisma.productColorImage.findMany({
        where: { productId: result.id, colorId: entities.color1.id },
        orderBy: { order: "asc" },
      });
      expect(images).toHaveLength(2);
      expect(images.every((img) => img.productColorId === null)).toBe(true);
    });
  });

  describe("updateProduct.primaryColorId", () => {
    it("accepte une couleur de pack-line comme principale (résout bug Orange)", async () => {
      const created = await createProduct(
        baseInput({
          reference: `${TEST_PREFIX}PRIM-PACK-LINE`,
          colors: [
            {
              colorId: entities.color1.id,
              unitPrice: 19.99,
              weight: 0.2,
              stock: 5,
              isPrimary: true,
              saleType: "PACK",
              packQuantity: 2,
              sizeEntries: [],
              packLines: [
                {
                  colorId: entities.color1.id,
                  sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
                },
                {
                  colorId: entities.color2.id,
                  sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
                },
              ],
            },
          ],
        }),
      );

      // L'admin demande à mettre color2 comme principale, alors qu'elle n'apparaît
      // que dans la pack-line — pas comme colorId principal de la variante.
      await updateProduct(created.id, {
        ...baseInput({
          reference: `${TEST_PREFIX}PRIM-PACK-LINE`,
          primaryColorId: entities.color2.id,
        }),
        colors: [
          {
            dbId: undefined,
            colorId: entities.color1.id,
            unitPrice: 19.99,
            weight: 0.2,
            stock: 5,
            isPrimary: true,
            saleType: "PACK",
            packQuantity: 2,
            sizeEntries: [],
            packLines: [
              {
                colorId: entities.color1.id,
                sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
              },
              {
                colorId: entities.color2.id,
                sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
              },
            ],
          },
        ],
      });

      const product = await prisma.product.findUnique({
        where: { id: created.id },
        select: { primaryColorId: true },
      });
      expect(product?.primaryColorId).toBe(entities.color2.id);
    });

    it("réassigne primaryColorId sur la 1ʳᵉ couleur restante quand la variante portant la principale est supprimée", async () => {
      const created = await createProduct(
        baseInput({
          reference: `${TEST_PREFIX}PRIM-REASSIGN`,
          primaryColorId: entities.color1.id,
          colors: [
            {
              colorId: entities.color1.id,
              unitPrice: 9.99,
              weight: 0.1,
              stock: 10,
              isPrimary: true,
              saleType: "UNIT",
              packQuantity: null,
              sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            },
            {
              colorId: entities.color2.id,
              unitPrice: 9.99,
              weight: 0.1,
              stock: 10,
              isPrimary: false,
              saleType: "UNIT",
              packQuantity: null,
              sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
            },
          ],
        }),
      );

      const before = await prisma.product.findUnique({
        where: { id: created.id },
        select: { primaryColorId: true },
      });
      expect(before?.primaryColorId).toBe(entities.color1.id);

      // L'admin supprime la variante color1 (en n'envoyant que color2 dans colors).
      // Il a aussi gardé primaryColorId = color1 (état stale du formulaire) — le serveur
      // doit détecter que color1 n'est plus disponible et réassigner sur color2.
      await updateProduct(created.id, {
        ...baseInput({
          reference: `${TEST_PREFIX}PRIM-REASSIGN`,
          primaryColorId: entities.color1.id, // <- valeur stale, désormais invalide
        }),
        colors: [
          {
            dbId: undefined,
            colorId: entities.color2.id,
            unitPrice: 9.99,
            weight: 0.1,
            stock: 10,
            isPrimary: true,
            saleType: "UNIT",
            packQuantity: null,
            sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
          },
        ],
      });

      const after = await prisma.product.findUnique({
        where: { id: created.id },
        select: { primaryColorId: true },
      });
      expect(after?.primaryColorId).toBe(entities.color2.id);
    });
  });
});
