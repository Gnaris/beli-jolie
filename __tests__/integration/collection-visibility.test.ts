/**
 * Integration test — visibilité des collections (ajout 2026-10-27).
 *
 * Règles :
 *   - Toute nouvelle collection démarre masquée (`visible = false`).
 *   - `setCollectionVisibility()` toggle la valeur et revalide les tags.
 *   - `updateCollection()` accepte le champ `visible` dans le FormData.
 *   - Le filtre `visible: true` masque les collections cachées des listings
 *     publics ; les non-masquées restent visibles.
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

const { createCollection, setCollectionVisibility, updateCollection } = await import(
  "@/app/actions/admin/collections"
);

describe("Collection — visibilité par défaut (2026-10-27)", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("createCollection crée une collection masquée (visible = false)", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Hidden by default`);

    const result = await createCollection(fd);
    expect(result.success).toBe(true);

    const row = await prisma.collection.findUnique({
      where: { id: result.id! },
      select: { visible: true },
    });
    expect(row?.visible).toBe(false);
  });

  it("setCollectionVisibility(true) active la collection", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Toggle on`);
    const created = await createCollection(fd);
    expect(created.success).toBe(true);

    const result = await setCollectionVisibility(created.id!, true);
    expect(result.success).toBe(true);

    const row = await prisma.collection.findUnique({
      where: { id: created.id! },
      select: { visible: true },
    });
    expect(row?.visible).toBe(true);
  });

  it("setCollectionVisibility(false) masque la collection", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Toggle off`);
    const created = await createCollection(fd);
    expect(created.success).toBe(true);

    await setCollectionVisibility(created.id!, true);
    const after = await setCollectionVisibility(created.id!, false);
    expect(after.success).toBe(true);

    const row = await prisma.collection.findUnique({
      where: { id: created.id! },
      select: { visible: true },
    });
    expect(row?.visible).toBe(false);
  });

  it("updateCollection accepte visible=true via FormData", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Update visible`);
    const created = await createCollection(fd);
    expect(created.success).toBe(true);

    const updateFd = new FormData();
    updateFd.append("name", `${TEST_PREFIX}Update visible`);
    updateFd.append("visible", "true");
    const result = await updateCollection(created.id!, updateFd);
    expect(result.success).toBe(true);

    const row = await prisma.collection.findUnique({
      where: { id: created.id! },
      select: { visible: true },
    });
    expect(row?.visible).toBe(true);
  });

  it("updateCollection sans champ visible n'écrase pas la valeur existante", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Preserve visible`);
    const created = await createCollection(fd);
    await setCollectionVisibility(created.id!, true);

    // Nouveau update SANS clé "visible" → la valeur ne doit pas changer.
    const updateFd = new FormData();
    updateFd.append("name", `${TEST_PREFIX}Preserve visible`);
    const result = await updateCollection(created.id!, updateFd);
    expect(result.success).toBe(true);

    const row = await prisma.collection.findUnique({
      where: { id: created.id! },
      select: { visible: true },
    });
    expect(row?.visible).toBe(true);
  });

  it("findMany avec visible:true n'inclut pas les collections masquées", async () => {
    const hiddenFd = new FormData();
    hiddenFd.append("name", `${TEST_PREFIX}Public filter hidden`);
    const hidden = await createCollection(hiddenFd);
    // Reste à visible = false (par défaut)

    const shownFd = new FormData();
    shownFd.append("name", `${TEST_PREFIX}Public filter shown`);
    const shown = await createCollection(shownFd);
    await setCollectionVisibility(shown.id!, true);

    const visibleRows = await prisma.collection.findMany({
      where: {
        visible: true,
        id: { in: [hidden.id!, shown.id!] },
      },
      select: { id: true },
    });

    expect(visibleRows.map((r) => r.id)).toEqual([shown.id!]);
  });
});
