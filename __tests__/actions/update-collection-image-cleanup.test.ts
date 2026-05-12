/**
 * Tests for updateCollection — verify that the previous cover image (large +
 * -md.webp + -thumb.webp) is purged from disk on replacement or removal, so
 * cover images don't accumulate in `public/uploads/collections/{slug}/`.
 *
 * Also covers the tricky case where a folder rename moved the previous file
 * — in that branch the cleanup must target the *new* on-disk path, not the
 * stale one stored in BDD.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  collection: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  collectionTranslation: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
const mockRevalidate = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
const mockStorage = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  deleteDirectory: vi.fn(),
  renameCollectionFolder: vi.fn(),
  collectionImageDir: (slug: string) => `uploads/collections/${slug}`,
  keyFromDbPath: (p: string) => p.replace(/^\//, ""),
}));
const mockTranslate = vi.hoisted(() => ({ autoTranslateCollection: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => mockRevalidate);
vi.mock("@/lib/storage", () => mockStorage);
vi.mock("@/lib/auto-translate", () => mockTranslate);
vi.mock("@/i18n/locales", () => ({ NON_DEFAULT_LOCALES: [] }));

import { updateCollection } from "@/app/actions/admin/collections";

function buildForm(name: string, image?: string | null): FormData {
  const f = new FormData();
  f.append("name", name);
  if (image !== undefined) f.append("image", image ?? "");
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { role: "ADMIN" } });
  mockPrisma.collection.update.mockResolvedValue({});
  mockPrisma.collection.findUnique.mockResolvedValue(null);
  mockStorage.deleteFile.mockResolvedValue(undefined);
  mockStorage.renameCollectionFolder.mockResolvedValue({ renamed: [] });
});

describe("updateCollection — cover image cleanup", () => {
  it("supprime large + -md + -thumb quand on remplace la couverture", async () => {
    mockPrisma.collection.findUnique.mockResolvedValueOnce({
      name: "Été",
      image: "/uploads/collections/ete/ete-couverture-old.webp",
    });

    const result = await updateCollection(
      "col-1",
      buildForm("Été", "/uploads/collections/ete/ete-couverture-new.webp"),
    );

    expect(result).toEqual({ success: true });
    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/collections/ete/ete-couverture-old.webp",
    );
    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/collections/ete/ete-couverture-old-md.webp",
    );
    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/collections/ete/ete-couverture-old-thumb.webp",
    );
  });

  it("supprime tous les fichiers quand on retire la couverture (image vide)", async () => {
    mockPrisma.collection.findUnique.mockResolvedValueOnce({
      name: "Été",
      image: "/uploads/collections/ete/ete-couverture-old.webp",
    });

    await updateCollection("col-1", buildForm("Été", ""));

    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/collections/ete/ete-couverture-old.webp",
    );
    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/collections/ete/ete-couverture-old-md.webp",
    );
    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/collections/ete/ete-couverture-old-thumb.webp",
    );
  });

  it("ne supprime rien si la couverture n'a pas changé", async () => {
    const same = "/uploads/collections/ete/ete-couverture-x.webp";
    mockPrisma.collection.findUnique.mockResolvedValueOnce({
      name: "Été",
      image: same,
    });

    await updateCollection("col-1", buildForm("Été", same));

    expect(mockStorage.deleteFile).not.toHaveBeenCalled();
  });

  it("ne supprime pas le fichier déplacé par un rename de dossier", async () => {
    // Cas : on change le NOM de la collection ET on garde la même couverture.
    // renameCollectionFolder déplace les fichiers vers le nouveau dossier.
    // On NE doit PAS retenter de supprimer à l'ancien path (déjà vide), et
    // SURTOUT pas supprimer le fichier au nouveau path (toujours utilisé).
    mockPrisma.collection.findUnique.mockResolvedValueOnce({
      name: "Été",
      image: "/uploads/collections/ete/ete-couverture-x.webp",
    });
    mockStorage.renameCollectionFolder.mockResolvedValueOnce({
      renamed: [
        {
          oldDbPath: "/uploads/collections/ete/ete-couverture-x.webp",
          newDbPath: "/uploads/collections/printemps/printemps-couverture-x.webp",
        },
        {
          oldDbPath: "/uploads/collections/ete/ete-couverture-x-md.webp",
          newDbPath: "/uploads/collections/printemps/printemps-couverture-x-md.webp",
        },
      ],
    });

    await updateCollection(
      "col-1",
      buildForm("Printemps", "/uploads/collections/ete/ete-couverture-x.webp"),
    );

    // The previous and new paths are now the same file (post-rename), so
    // no delete should happen.
    expect(mockStorage.deleteFile).not.toHaveBeenCalled();
  });

  it("nettoie l'ancienne couverture quand le nom change ET l'image change", async () => {
    mockPrisma.collection.findUnique.mockResolvedValueOnce({
      name: "Été",
      image: "/uploads/collections/ete/ete-couverture-old.webp",
    });
    mockStorage.renameCollectionFolder.mockResolvedValueOnce({
      renamed: [
        {
          oldDbPath: "/uploads/collections/ete/ete-couverture-old.webp",
          newDbPath: "/uploads/collections/printemps/printemps-couverture-old.webp",
        },
        {
          oldDbPath: "/uploads/collections/ete/ete-couverture-old-md.webp",
          newDbPath: "/uploads/collections/printemps/printemps-couverture-old-md.webp",
        },
        {
          oldDbPath: "/uploads/collections/ete/ete-couverture-old-thumb.webp",
          newDbPath: "/uploads/collections/printemps/printemps-couverture-old-thumb.webp",
        },
      ],
    });

    await updateCollection(
      "col-1",
      buildForm("Printemps", "/uploads/collections/printemps/printemps-couverture-new.webp"),
    );

    // The previous file was renamed to printemps-couverture-old.webp; the
    // new image is printemps-couverture-new.webp. Cleanup must delete the
    // renamed (post-move) paths.
    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/collections/printemps/printemps-couverture-old.webp",
    );
    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/collections/printemps/printemps-couverture-old-md.webp",
    );
    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/collections/printemps/printemps-couverture-old-thumb.webp",
    );
  });

  it("ne tombe pas en panne si la suppression échoue", async () => {
    mockPrisma.collection.findUnique.mockResolvedValueOnce({
      name: "Été",
      image: "/uploads/collections/ete/ete-couverture-old.webp",
    });
    mockStorage.deleteFile.mockRejectedValue(new Error("EACCES"));

    const result = await updateCollection("col-1", buildForm("Été", ""));
    expect(result).toEqual({ success: true });
  });
});
