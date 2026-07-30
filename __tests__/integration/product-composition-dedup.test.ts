/**
 * Régression : updateProduct doit dédoublonner les compositions par
 * compositionId avant l'insertion pour éviter P2002 sur la contrainte
 * unique ProductComposition_productId_compositionId_key.
 *
 * Origine : erreur observée en prod 2026-07-30 (digest 3819380697) —
 * le payload envoyé par le formulaire contenait 2 lignes sur la même
 * compositionId (double-clic / résidu d'état), et le save échouait
 * entièrement.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { createProduct, updateProduct } from "@/app/actions/admin/products";
import type { ProductInput } from "@/app/actions/admin/products";

describe("updateProduct — dédoublonnage compositions", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  let secondComposition: { id: string };

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();
    secondComposition = await prisma.composition.create({
      data: { name: `${TEST_PREFIX}Laiton` },
    });
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

  function baseInput(overrides?: Partial<ProductInput>): ProductInput {
    return {
      reference: `${TEST_PREFIX}COMPO-DEDUP-001`,
      name: "Produit dédup composition",
      description: "Test",
      categoryId: entities.category.id,
      subCategoryIds: [],
      colors: [
        {
          colorId: entities.color1.id,
          unitPrice: 5,
          weight: 0.1,
          stock: 3,
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
      countryIsoCode: entities.country.id,
      seasonId: entities.season.id,
      ...overrides,
    };
  }

  // Ancienne compositions du produit initial peuvent avoir tenantId=NULL
  // (nested create ne passe pas toujours par l'extension tenant-scope).
  // On les supprime en global (MULTI_TENANT_SCOPE=off ne pouvant pas être
  // activé au vol, on passe par $executeRawUnsafe qui bypass l'extension).
  async function wipeCompositionsFor(productId: string) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM ProductComposition WHERE productId = ?`,
      productId,
    );
  }

  it("ne crashe pas quand le payload contient 2 fois la même compositionId", async () => {
    const { id } = await createProduct(baseInput());
    await wipeCompositionsFor(id);

    // Simule ce que le formulaire buggé a envoyé en prod : même compositionId
    // listé 2 fois avec des pourcentages différents.
    const dupPayload = baseInput({
      compositions: [
        { compositionId: entities.composition.id, percentage: 60 },
        { compositionId: entities.composition.id, percentage: 40 },
      ],
    });

    await expect(updateProduct(id, dupPayload)).resolves.toBeDefined();

    const stored = await prisma.productComposition.findMany({
      where: { productId: id },
      select: { compositionId: true, percentage: true },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].compositionId).toBe(entities.composition.id);
  });

  it("garde bien 2 compositions distinctes quand le payload en a 2 différentes", async () => {
    const { id } = await createProduct(baseInput());
    await wipeCompositionsFor(id);

    const twoDistinct = baseInput({
      compositions: [
        { compositionId: entities.composition.id, percentage: 70 },
        { compositionId: secondComposition.id, percentage: 30 },
      ],
    });

    await updateProduct(id, twoDistinct);

    const stored = await prisma.productComposition.findMany({
      where: { productId: id },
      select: { compositionId: true },
    });
    expect(stored).toHaveLength(2);
    const ids = stored.map((s) => s.compositionId).sort();
    expect(ids).toEqual([entities.composition.id, secondComposition.id].sort());
  });

  it("accepte un payload vide (aucune composition)", async () => {
    const { id } = await createProduct(baseInput());
    await wipeCompositionsFor(id);

    await updateProduct(id, baseInput({ compositions: [] }));

    const stored = await prisma.productComposition.findMany({
      where: { productId: id },
    });
    expect(stored).toHaveLength(0);
  });
});
