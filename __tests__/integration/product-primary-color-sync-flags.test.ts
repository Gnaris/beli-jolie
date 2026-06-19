/**
 * Integration : changer uniquement la couleur principale d'un produit doit lever
 * les 4 drapeaux *SyncRequired (PFS, Ankorstore, eFashion, Faire) pour les
 * marketplaces où le produit est lié. Sans ça, le badge orange
 * « Synchronisation nécessaire » ne s'affiche pas et la cliente n'a aucun signal
 * que la photo principale envoyée à la marketplace est devenue obsolète.
 *
 * Régression : bug constaté juin 2026 sur F137 (Faire) où changer la couleur
 * principale n'allumait jamais le badge.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { createProduct, updateProduct } from "@/app/actions/admin/products";
import type { ProductInput } from "@/app/actions/admin/products";

describe("primaryColorId change → drapeaux *SyncRequired (real DB)", () => {
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
      reference: `${TEST_PREFIX}PRIM-FLAG`,
      name: "Bague test couleur",
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
      manufacturingCountryId: entities.country.id,
      seasonId: entities.season.id,
      primaryColorId: entities.color1.id,
      ...overrides,
    };
  }

  it("lève faireSyncRequired (et les autres) quand seul primaryColorId change", async () => {
    const created = await createProduct(
      baseInput({ reference: `${TEST_PREFIX}PRIM-FLAG-1` }),
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

    // Save SANS rien changer d'autre que la couleur principale.
    await updateProduct(created.id, {
      ...baseInput({
        reference: `${TEST_PREFIX}PRIM-FLAG-1`,
        primaryColorId: entities.color2.id,
      }),
      colors: [
        {
          dbId: undefined,
          colorId: entities.color1.id,
          unitPrice: 9.99,
          weight: 0.1,
          stock: 10,
          isPrimary: false,
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
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
        },
      ],
    });

    const after = await prisma.product.findUnique({
      where: { id: created.id },
      select: {
        primaryColorId: true,
        pfsSyncRequired: true,
        ankorsSyncRequired: true,
        efashionSyncRequired: true,
        faireSyncRequired: true,
      },
    });

    expect(after?.primaryColorId).toBe(entities.color2.id);
    expect(after?.pfsSyncRequired).toBe(true);
    expect(after?.ankorsSyncRequired).toBe(true);
    expect(after?.efashionSyncRequired).toBe(true);
    expect(after?.faireSyncRequired).toBe(true);
  });

  it("ne lève PAS les drapeaux si primaryColorId ne change pas (et rien d'autre non plus)", async () => {
    const created = await createProduct(
      baseInput({ reference: `${TEST_PREFIX}PRIM-FLAG-2` }),
    );

    await prisma.product.update({
      where: { id: created.id },
      data: {
        pfsProductId: "pfs-fake-id-2",
        ankorsProductId: "ank-fake-id-2",
        efashionReferenceBase: "ef-fake-base-2",
        faireProductId: "p_fake_faire_2",
        pfsSyncRequired: false,
        ankorsSyncRequired: false,
        efashionSyncRequired: false,
        faireSyncRequired: false,
      },
    });

    // Save à l'identique.
    await updateProduct(created.id, {
      ...baseInput({ reference: `${TEST_PREFIX}PRIM-FLAG-2` }),
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
