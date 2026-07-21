/**
 * Integration : déplacer une photo d'une couleur vers une autre (sans changer
 * le fichier) doit lever les 4 drapeaux *SyncRequired (PFS, Ankorstore, eFashion,
 * Faire) pour les marketplaces où le produit est lié. Sans ça, le badge orange
 * « Synchronisation nécessaire » resterait éteint et le push marketplaces ne
 * saurait pas qu'il faut renvoyer les nouvelles photos.
 *
 * Régression : demande cliente juillet 2026 après refonte de l'onglet Photos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { createProduct, updateProduct } from "@/app/actions/admin/products";
import type { ProductInput } from "@/app/actions/admin/products";

describe("images move → drapeaux *SyncRequired (real DB)", () => {
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
      reference: `${TEST_PREFIX}IMG-MOVE`,
      name: "Bague test move",
      description: "Description",
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
      compositions: [{ compositionId: entities.composition.id, percentage: 100 }],
      similarProductIds: [],
      bundleChildIds: [],
      tagNames: [],
      isBestSeller: false,
      discountPercent: null,
      status: "ONLINE",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      countryIsoCode: entities.country.id,
      seasonId: entities.season.id,
      primaryColorId: entities.color1.id,
      ...overrides,
    };
  }

  it("lève tous les drapeaux *SyncRequired quand une photo passe de la couleur A à la couleur B", async () => {
    const created = await createProduct(
      baseInput({
        reference: `${TEST_PREFIX}IMG-MOVE-1`,
        imagePaths: [
          {
            colorId: entities.color1.id,
            paths: ["/uploads/produits/test/photo-a.webp"],
            orders: [0],
          },
        ],
      }),
    );

    // Lien artificiel aux 4 marketplaces + reset des 4 drapeaux à false.
    await prisma.product.update({
      where: { id: created.id },
      data: {
        pfsProductId: "pfs-fake-id",
        ankorsProductId: "ank-fake-id",
        efashionReferenceBase: "ef-fake-base",
        faireProductId: "p_fake_faire",
        pfsSyncRequired: false,
        ankorsSyncRequired: false,
        efashionSyncRequired: false,
        faireSyncRequired: false,
      },
    });

    // Save en déplaçant la photo de color1 vers color2 (même fichier, même
    // position, colorId différent).
    await updateProduct(created.id, {
      ...baseInput({ reference: `${TEST_PREFIX}IMG-MOVE-1` }),
      colors: [
        {
          dbId: undefined,
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
          dbId: undefined,
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
      imagePaths: [
        {
          colorId: entities.color2.id,
          paths: ["/uploads/produits/test/photo-a.webp"],
          orders: [0],
        },
      ],
    });

    const after = await prisma.product.findUnique({
      where: { id: created.id },
      select: {
        pfsSyncRequired: true,
        ankorsSyncRequired: true,
        efashionSyncRequired: true,
        faireSyncRequired: true,
      },
    });

    expect(after?.pfsSyncRequired).toBe(true);
    expect(after?.ankorsSyncRequired).toBe(true);
    expect(after?.efashionSyncRequired).toBe(true);
    expect(after?.faireSyncRequired).toBe(true);
  });

  it("ne lève PAS les drapeaux si le mapping images est identique (save à blanc)", async () => {
    const created = await createProduct(
      baseInput({
        reference: `${TEST_PREFIX}IMG-MOVE-2`,
        imagePaths: [
          {
            colorId: entities.color1.id,
            paths: ["/uploads/produits/test/photo-a.webp"],
            orders: [0],
          },
        ],
      }),
    );

    await prisma.product.update({
      where: { id: created.id },
      data: {
        pfsProductId: "pfs-fake-id-nochange",
        ankorsProductId: "ank-fake-id-nochange",
        efashionReferenceBase: "ef-fake-base-nochange",
        faireProductId: "p_fake_faire_nochange",
        pfsSyncRequired: false,
        ankorsSyncRequired: false,
        efashionSyncRequired: false,
        faireSyncRequired: false,
      },
    });

    // Save à l'identique — images inchangées.
    await updateProduct(created.id, {
      ...baseInput({ reference: `${TEST_PREFIX}IMG-MOVE-2` }),
      colors: [
        {
          dbId: undefined,
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
          dbId: undefined,
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
      imagePaths: [
        {
          colorId: entities.color1.id,
          paths: ["/uploads/produits/test/photo-a.webp"],
          orders: [0],
        },
      ],
    });

    const after = await prisma.product.findUnique({
      where: { id: created.id },
      select: {
        pfsSyncRequired: true,
        ankorsSyncRequired: true,
        efashionSyncRequired: true,
        faireSyncRequired: true,
      },
    });

    expect(after?.pfsSyncRequired).toBe(false);
    expect(after?.ankorsSyncRequired).toBe(false);
    expect(after?.efashionSyncRequired).toBe(false);
    expect(after?.faireSyncRequired).toBe(false);
  });
});
