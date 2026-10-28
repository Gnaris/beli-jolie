/**
 * Integration test — getCollectionStats (ajout 2026-10-28).
 *
 * Vérifie :
 *  - Séparation anonymeTotal/Today vs connectéTotal/Today sur CollectionView.
 *  - Agrégation clientViewers (groupé par userId, dernière vue, nb vues).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, TEST_PREFIX, prisma } from "./setup";

const { getCollectionStats } = await import("@/app/actions/admin/collections");

describe("getCollectionStats — vues anonymes vs connectées", () => {
  let testUserAId: string;
  let testUserBId: string;

  beforeAll(async () => {
    await cleanupTestData();
    await prisma.collectionView.deleteMany({
      where: { collection: { name: { startsWith: TEST_PREFIX } } },
    });

    const userA = await prisma.user.create({
      data: {
        email: `${TEST_PREFIX.toLowerCase()}a@test.com`,
        firstName: "Alice",
        lastName: "Dupont",
        company: "Boutique A",
        phone: "0100000000",
        password: "x",
        role: "CLIENT",
        status: "APPROVED",
      },
      select: { id: true },
    });
    testUserAId = userA.id;

    const userB = await prisma.user.create({
      data: {
        email: `${TEST_PREFIX.toLowerCase()}b@test.com`,
        firstName: "Barbara",
        lastName: "Martin",
        company: "Boutique B",
        phone: "0100000000",
        password: "x",
        role: "CLIENT",
        status: "APPROVED",
      },
      select: { id: true },
    });
    testUserBId = userB.id;
  });

  afterAll(async () => {
    await prisma.collectionView.deleteMany({
      where: { collection: { name: { startsWith: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: TEST_PREFIX.toLowerCase() } },
    });
    await cleanupTestData();
  });

  it("sépare correctement anonyme vs connecté sur jour et total", async () => {
    const col = await prisma.collection.create({
      data: { name: `${TEST_PREFIX}Stats col`, slug: `${TEST_PREFIX.toLowerCase()}stats-col`, visible: true },
      select: { id: true },
    });

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);

    await prisma.collectionView.createMany({
      data: [
        // Aujourd'hui : 1 anonyme + 2 connectées (A×2)
        { collectionId: col.id, userId: null, viewedAt: today },
        { collectionId: col.id, userId: testUserAId, viewedAt: today },
        { collectionId: col.id, userId: testUserAId, viewedAt: today },
        // Hier : 1 anonyme + 1 connectée (B)
        { collectionId: col.id, userId: null, viewedAt: yesterday },
        { collectionId: col.id, userId: testUserBId, viewedAt: yesterday },
      ],
    });

    const stats = await getCollectionStats(col.id);
    expect(stats.viewsAnonymousToday).toBe(1);
    expect(stats.viewsAnonymousTotal).toBe(2);
    expect(stats.viewsConnectedToday).toBe(2);
    expect(stats.viewsConnectedTotal).toBe(3);

    // 2 clientes distinctes ont vu
    expect(stats.clientViewers.length).toBe(2);
    const alice = stats.clientViewers.find((v) => v.userId === testUserAId);
    expect(alice?.viewsCount).toBe(2);
    expect(alice?.firstName).toBe("Alice");
    const barbara = stats.clientViewers.find((v) => v.userId === testUserBId);
    expect(barbara?.viewsCount).toBe(1);

    // Alice (vue aujourd'hui) doit arriver avant Barbara (hier)
    expect(stats.clientViewers[0]?.userId).toBe(testUserAId);
  });
});
