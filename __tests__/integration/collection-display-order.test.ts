/**
 * Integration test — ordre d'affichage des collections (ajout 2026-10-27).
 *
 * Règles :
 *   - Une collection fraîchement créée a `displayOrder = 0`.
 *   - `setCollectionDisplayOrder()` persiste la nouvelle valeur.
 *   - Les valeurs hors bornes (négatif, >9999, NaN) sont refusées.
 *   - `findMany({ orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }] })`
 *     renvoie bien les collections par numéro croissant.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { cleanupTestData, TEST_PREFIX, prisma } from "./setup";

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    deleteFile: vi.fn().mockResolvedValue(undefined),
    renameCollectionFolder: vi.fn().mockResolvedValue({ renamed: [] }),
  };
});

const { createCollection, setCollectionDisplayOrder } = await import(
  "@/app/actions/admin/collections"
);

describe("Collection — ordre d'affichage (2026-10-27)", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("createCollection démarre avec displayOrder = 0", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Order default`);
    const result = await createCollection(fd);
    expect(result.success).toBe(true);

    const row = await prisma.collection.findUnique({
      where: { id: result.id! },
      select: { displayOrder: true },
    });
    expect(row?.displayOrder).toBe(0);
  });

  it("setCollectionDisplayOrder enregistre un numéro valide", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Order set`);
    const created = await createCollection(fd);

    const res = await setCollectionDisplayOrder(created.id!, 5);
    expect(res.success).toBe(true);

    const row = await prisma.collection.findUnique({
      where: { id: created.id! },
      select: { displayOrder: true },
    });
    expect(row?.displayOrder).toBe(5);
  });

  it("setCollectionDisplayOrder refuse un numéro négatif", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Order neg`);
    const created = await createCollection(fd);

    const res = await setCollectionDisplayOrder(created.id!, -1);
    expect(res.success).toBe(false);
  });

  it("setCollectionDisplayOrder refuse un numéro >9999", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Order high`);
    const created = await createCollection(fd);

    const res = await setCollectionDisplayOrder(created.id!, 100_000);
    expect(res.success).toBe(false);
  });

  it("findMany orderBy displayOrder trie correctement", async () => {
    const ids: string[] = [];
    for (const name of ["A", "B", "C"]) {
      const fd = new FormData();
      fd.append("name", `${TEST_PREFIX}Order sort ${name}`);
      const r = await createCollection(fd);
      ids.push(r.id!);
    }
    // Positions voulues : B=1, C=2, A=3
    await setCollectionDisplayOrder(ids[1], 1);
    await setCollectionDisplayOrder(ids[2], 2);
    await setCollectionDisplayOrder(ids[0], 3);

    const rows = await prisma.collection.findMany({
      where: { id: { in: ids } },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
      select: { id: true, displayOrder: true },
    });

    expect(rows.map((r) => r.id)).toEqual([ids[1], ids[2], ids[0]]);
    expect(rows.map((r) => r.displayOrder)).toEqual([1, 2, 3]);
  });
});
