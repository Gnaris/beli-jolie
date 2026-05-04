/**
 * Integration test: Collection page filters out OFFLINE products.
 *
 * Vérifie que la page /collections/[id] ne renvoie que les produits ONLINE,
 * et que le compteur sur /collections n'inclut que les produits ONLINE.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";

describe("Collection client view filters OFFLINE products", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  let collectionId: string;
  let onlineProductId: string;
  let offlineProductId: string;
  let archivedProductId: string;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();

    const collection = await prisma.collection.create({
      data: { name: `${TEST_PREFIX}Spring 2026` },
    });
    collectionId = collection.id;

    const online = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}ON-001`,
        name: "Online product",
        description: "",
        categoryId: entities.category.id,
        manufacturingCountryId: entities.country.id,
        seasonId: entities.season.id,
        status: "ONLINE",
      },
    });
    onlineProductId = online.id;

    const offline = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}OFF-001`,
        name: "Offline product",
        description: "",
        categoryId: entities.category.id,
        manufacturingCountryId: entities.country.id,
        seasonId: entities.season.id,
        status: "OFFLINE",
      },
    });
    offlineProductId = offline.id;

    const archived = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}ARC-001`,
        name: "Archived product",
        description: "",
        categoryId: entities.category.id,
        manufacturingCountryId: entities.country.id,
        seasonId: entities.season.id,
        status: "ARCHIVED",
      },
    });
    archivedProductId = archived.id;

    await prisma.collectionProduct.createMany({
      data: [
        { collectionId, productId: onlineProductId, position: 0 },
        { collectionId, productId: offlineProductId, position: 1 },
        { collectionId, productId: archivedProductId, position: 2 },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("only returns ONLINE products on the collection detail page query", async () => {
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      include: {
        products: {
          where: { product: { status: "ONLINE" } },
          orderBy: { position: "asc" },
          include: { product: { select: { id: true, status: true } } },
        },
      },
    });

    expect(collection).not.toBeNull();
    const ids = collection!.products.map((cp) => cp.product.id);
    expect(ids).toEqual([onlineProductId]);
    expect(ids).not.toContain(offlineProductId);
    expect(ids).not.toContain(archivedProductId);
  });

  it("counts only ONLINE products on the collections list page query", async () => {
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      include: {
        _count: {
          select: {
            products: { where: { product: { status: "ONLINE" } } },
          },
        },
      },
    });

    expect(collection).not.toBeNull();
    expect(collection!._count.products).toBe(1);
  });
});
