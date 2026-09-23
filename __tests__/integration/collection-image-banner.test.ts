/**
 * Integration test : collection card image + banner image sont deux champs
 * indépendants et purgés proprement quand remplacés.
 *
 * Contexte : 2026-09-23, on a scindé `Collection.image` en deux champs pour
 * arrêter de déformer la vignette de /collections ET la bannière hero de
 * /collections/[slug]. Ce test protège la persistance + le fallback + la purge.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { cleanupTestData, TEST_PREFIX, prisma } from "./setup";

// Mock storage : on ne veut pas toucher au disque dans un test d'intégration
// (pas de fichiers réels), mais on veut vérifier que la purge appelle bien
// deleteFile sur les 3 tailles (webp / -md.webp / -thumb.webp) de l'ancienne
// bannière.
const deleteFileMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    deleteFile: (key: string) => deleteFileMock(key),
    // renameCollectionFolder appelé si le nom change — noop pour ne pas toucher au FS.
    renameCollectionFolder: vi.fn().mockResolvedValue({ renamed: [] }),
  };
});

// Import après le mock pour que les server actions récupèrent la version patchée.
const { createCollection, updateCollection } = await import(
  "@/app/actions/admin/collections"
);

describe("Collection image + imageBanner (2026-09-23)", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("createCollection persiste image et imageBanner séparément", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Été 2026`);
    fd.append("image", "/uploads/beli-jolie/collections/ete-2026/ete-2026-couverture-a.webp");
    fd.append("imageBanner", "/uploads/beli-jolie/collections/ete-2026/ete-2026-banniere-b.webp");

    const result = await createCollection(fd);
    expect("error" in result ? result.error : null).toBeNull();
    expect(result.success).toBe(true);

    const created = await prisma.collection.findUnique({
      where: { id: result.id! },
      select: { image: true, imageBanner: true },
    });
    expect(created?.image).toBe("/uploads/beli-jolie/collections/ete-2026/ete-2026-couverture-a.webp");
    expect(created?.imageBanner).toBe("/uploads/beli-jolie/collections/ete-2026/ete-2026-banniere-b.webp");
  });

  it("createCollection accepte imageBanner absent (compat collections héritées)", async () => {
    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Sans bannière`);
    fd.append("image", "/uploads/beli-jolie/collections/sans-banniere/x.webp");

    const result = await createCollection(fd);
    expect(result.success).toBe(true);

    const created = await prisma.collection.findUnique({
      where: { id: result.id! },
      select: { image: true, imageBanner: true },
    });
    expect(created?.image).toBe("/uploads/beli-jolie/collections/sans-banniere/x.webp");
    expect(created?.imageBanner).toBeNull();
  });

  it("updateCollection remplace la bannière ET purge les 3 tailles de l'ancienne", async () => {
    const collection = await prisma.collection.create({
      data: {
        name: `${TEST_PREFIX}Update banniere`,
        slug: `${TEST_PREFIX.toLowerCase()}update-banniere`,
        image: "/uploads/beli-jolie/collections/update-banniere/card-old.webp",
        imageBanner: "/uploads/beli-jolie/collections/update-banniere/banniere-old.webp",
      },
    });
    deleteFileMock.mockClear();

    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Update banniere`);
    fd.append("image", "/uploads/beli-jolie/collections/update-banniere/card-old.webp");
    fd.append("imageBanner", "/uploads/beli-jolie/collections/update-banniere/banniere-new.webp");

    const result = await updateCollection(collection.id, fd);
    expect(result.success).toBe(true);

    const after = await prisma.collection.findUnique({
      where: { id: collection.id },
      select: { image: true, imageBanner: true },
    });
    expect(after?.image).toBe("/uploads/beli-jolie/collections/update-banniere/card-old.webp");
    expect(after?.imageBanner).toBe("/uploads/beli-jolie/collections/update-banniere/banniere-new.webp");

    // Vieille bannière purgée sur les 3 tailles (large + -md + -thumb).
    const purgedKeys = deleteFileMock.mock.calls.map((c) => c[0] as string);
    expect(purgedKeys).toContain(
      "uploads/beli-jolie/collections/update-banniere/banniere-old.webp"
    );
    expect(purgedKeys).toContain(
      "uploads/beli-jolie/collections/update-banniere/banniere-old-md.webp"
    );
    expect(purgedKeys).toContain(
      "uploads/beli-jolie/collections/update-banniere/banniere-old-thumb.webp"
    );
    // L'image de carte n'a pas bougé → aucune purge de card-old.
    expect(purgedKeys.some((k) => k.includes("card-old"))).toBe(false);
  });

  it("updateCollection : bannière retirée (null) purge l'ancienne aussi", async () => {
    const collection = await prisma.collection.create({
      data: {
        name: `${TEST_PREFIX}Retire banniere`,
        slug: `${TEST_PREFIX.toLowerCase()}retire-banniere`,
        image: "/uploads/beli-jolie/collections/retire-banniere/card.webp",
        imageBanner: "/uploads/beli-jolie/collections/retire-banniere/banniere.webp",
      },
    });
    deleteFileMock.mockClear();

    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Retire banniere`);
    fd.append("image", "/uploads/beli-jolie/collections/retire-banniere/card.webp");
    // Pas de `imageBanner` = null.

    const result = await updateCollection(collection.id, fd);
    expect(result.success).toBe(true);

    const after = await prisma.collection.findUnique({
      where: { id: collection.id },
      select: { imageBanner: true },
    });
    expect(after?.imageBanner).toBeNull();

    const purgedKeys = deleteFileMock.mock.calls.map((c) => c[0] as string);
    expect(purgedKeys).toContain(
      "uploads/beli-jolie/collections/retire-banniere/banniere.webp"
    );
  });

  it("updateCollection : bannière inchangée ne déclenche PAS de purge", async () => {
    const collection = await prisma.collection.create({
      data: {
        name: `${TEST_PREFIX}Sans changement`,
        slug: `${TEST_PREFIX.toLowerCase()}sans-changement`,
        image: "/uploads/beli-jolie/collections/sans-changement/card.webp",
        imageBanner: "/uploads/beli-jolie/collections/sans-changement/banniere.webp",
      },
    });
    deleteFileMock.mockClear();

    const fd = new FormData();
    fd.append("name", `${TEST_PREFIX}Sans changement`);
    fd.append("image", "/uploads/beli-jolie/collections/sans-changement/card.webp");
    fd.append("imageBanner", "/uploads/beli-jolie/collections/sans-changement/banniere.webp");

    const result = await updateCollection(collection.id, fd);
    expect(result.success).toBe(true);
    expect(deleteFileMock).not.toHaveBeenCalled();
  });
});
