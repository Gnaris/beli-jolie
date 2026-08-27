/**
 * Tests for updateColorDirect / deleteColor — verify that the previous
 * Color.patternImage file is purged from disk on replacement, removal or
 * color deletion, so motifs don't accumulate in `public/uploads/motifs-couleurs/`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  color: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  colorTranslation: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  productColor: {
    count: vi.fn(),
  },
}));
const mockRevalidate = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
const mockStorage = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  keyFromDbPath: (p: string) => p.replace(/^\//, ""),
}));
const mockTranslate = vi.hoisted(() => ({
  autoTranslateColor: vi.fn(),
}));
const mockCached = vi.hoisted(() => ({ getCachedPfsColors: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => mockRevalidate);
vi.mock("@/lib/storage", () => mockStorage);
vi.mock("@/lib/auto-translate", () => mockTranslate);
vi.mock("@/lib/cached-data", () => mockCached);
vi.mock("@/i18n/locales", () => ({ NON_DEFAULT_LOCALES: [] }));

import { updateColorDirect, deleteColor } from "@/app/actions/admin/colors";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { role: "ADMIN" } });
  mockPrisma.color.findUnique.mockResolvedValue(null);
  mockPrisma.color.update.mockResolvedValue({});
  mockPrisma.color.delete.mockResolvedValue({});
  mockPrisma.productColor.count.mockResolvedValue(0);
  mockStorage.deleteFile.mockResolvedValue(undefined);
});

describe("updateColorDirect — pattern file cleanup", () => {
  it("supprime l'ancien motif quand on en upload un nouveau", async () => {
    mockPrisma.color.findUnique.mockResolvedValueOnce({
      patternImage: "/uploads/motifs-couleurs/leopard-old.png",
    });

    await updateColorDirect(
      "color-1",
      "Léopard",
      null,
      {},
      "/uploads/motifs-couleurs/leopard-new.png",
    );

    expect(mockStorage.deleteFile).toHaveBeenCalledTimes(1);
    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/motifs-couleurs/leopard-old.png",
    );
  });

  it("supprime le motif quand on le retire (null)", async () => {
    mockPrisma.color.findUnique.mockResolvedValueOnce({
      patternImage: "/uploads/motifs-couleurs/leopard-old.png",
    });

    await updateColorDirect("color-1", "Léopard", "#ABC123", {}, null);

    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/motifs-couleurs/leopard-old.png",
    );
  });

  it("ne touche pas au disque si patternImage n'est pas dans la mise à jour", async () => {
    // La server action lit toujours l'ancien enregistrement (pour comparer le
    // nom et déclencher la propagation Microstore), mais elle ne doit pas
    // toucher au disque tant que `patternImage` n'est pas explicitement fourni.
    mockPrisma.color.findUnique.mockResolvedValueOnce({
      patternImage: "/uploads/motifs-couleurs/leopard-old.png",
    });
    await updateColorDirect(
      "color-1",
      "Léopard",
      "#ABC123",
      {},
      undefined, // patternImage not provided
    );

    expect(mockStorage.deleteFile).not.toHaveBeenCalled();
  });

  it("ne supprime rien si le path n'a pas changé", async () => {
    const same = "/uploads/motifs-couleurs/leopard-x.png";
    mockPrisma.color.findUnique.mockResolvedValueOnce({ patternImage: same });

    await updateColorDirect("color-1", "Léopard", null, {}, same);

    expect(mockStorage.deleteFile).not.toHaveBeenCalled();
  });

  it("ne supprime rien si la couleur n'avait pas de motif", async () => {
    mockPrisma.color.findUnique.mockResolvedValueOnce({ patternImage: null });

    await updateColorDirect(
      "color-1",
      "Léopard",
      null,
      {},
      "/uploads/motifs-couleurs/leopard-new.png",
    );

    expect(mockStorage.deleteFile).not.toHaveBeenCalled();
  });

  it("ne plante pas si la suppression du fichier échoue", async () => {
    mockPrisma.color.findUnique.mockResolvedValueOnce({
      patternImage: "/uploads/motifs-couleurs/leopard-old.png",
    });
    mockStorage.deleteFile.mockRejectedValueOnce(new Error("EACCES"));

    await expect(
      updateColorDirect("color-1", "Léopard", null, {}, null),
    ).resolves.toBeUndefined();
  });
});

describe("deleteColor — pattern file cleanup", () => {
  it("supprime le motif quand on supprime la couleur", async () => {
    mockPrisma.color.findUnique.mockResolvedValueOnce({
      patternImage: "/uploads/motifs-couleurs/leopard-old.png",
    });

    await deleteColor("color-1");

    expect(mockPrisma.color.delete).toHaveBeenCalledWith({ where: { id: "color-1" } });
    expect(mockStorage.deleteFile).toHaveBeenCalledWith(
      "uploads/motifs-couleurs/leopard-old.png",
    );
  });

  it("refuse la suppression si la couleur est utilisée par un produit", async () => {
    mockPrisma.productColor.count.mockResolvedValueOnce(3);
    await expect(deleteColor("color-1")).rejects.toThrow(/utilisée/);
    expect(mockStorage.deleteFile).not.toHaveBeenCalled();
  });

  it("ne plante pas si la couleur n'avait pas de motif", async () => {
    mockPrisma.color.findUnique.mockResolvedValueOnce({ patternImage: null });
    await deleteColor("color-1");
    expect(mockStorage.deleteFile).not.toHaveBeenCalled();
  });
});
