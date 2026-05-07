import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `cleanupOrphanedSyncingProducts` est le filet de sécurité appelé à l'arrêt
 * d'un job d'import PFS : il supprime les produits restés en statut SYNCING
 * pour qu'aucun produit partiel ne traîne dans le catalogue après un Stop.
 */

const {
  mockProductFindMany,
  mockProductDelete,
  mockImageFindMany,
  mockDeleteFiles,
} = vi.hoisted(() => ({
  mockProductFindMany: vi.fn(),
  mockProductDelete: vi.fn(),
  mockImageFindMany: vi.fn(),
  mockDeleteFiles: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findMany: mockProductFindMany,
      delete: mockProductDelete,
    },
    productColorImage: {
      findMany: mockImageFindMany,
    },
  },
}));

vi.mock("@/lib/storage", () => ({
  deleteFiles: mockDeleteFiles,
  keyFromDbPath: (p: string) => p,
}));

vi.mock("@/lib/image-utils", () => ({
  getImagePaths: (path: string) => ({ large: path, medium: path, thumb: path }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { cleanupOrphanedSyncingProducts } from "@/lib/pfs-import";

describe("cleanupOrphanedSyncingProducts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImageFindMany.mockResolvedValue([]);
    mockProductDelete.mockResolvedValue({});
    mockDeleteFiles.mockResolvedValue(undefined);
  });

  it("ne fait rien quand la liste de pfsIds est vide", async () => {
    const result = await cleanupOrphanedSyncingProducts([], new Date());
    expect(result.deletedCount).toBe(0);
    expect(result.references).toEqual([]);
    expect(mockProductFindMany).not.toHaveBeenCalled();
  });

  it("ne touche que les produits SYNCING liés aux pfsIds donnés et créés depuis `since`", async () => {
    mockProductFindMany.mockResolvedValue([]);
    const since = new Date("2026-05-07T10:00:00Z");
    await cleanupOrphanedSyncingProducts(["pfs-1", "pfs-2"], since);
    expect(mockProductFindMany).toHaveBeenCalledWith({
      where: {
        status: "SYNCING",
        pfsProductId: { in: ["pfs-1", "pfs-2"] },
        createdAt: { gte: since },
      },
      select: { id: true, reference: true },
    });
  });

  it("supprime chaque produit orphelin et retourne le compteur + références", async () => {
    mockProductFindMany.mockResolvedValue([
      { id: "p-1", reference: "REF-A" },
      { id: "p-2", reference: "REF-B" },
    ]);
    const result = await cleanupOrphanedSyncingProducts(["pfs-1", "pfs-2"], new Date());
    expect(result.deletedCount).toBe(2);
    expect(result.references).toEqual(["REF-A", "REF-B"]);
    expect(mockProductDelete).toHaveBeenCalledTimes(2);
    expect(mockProductDelete).toHaveBeenNthCalledWith(1, { where: { id: "p-1" } });
    expect(mockProductDelete).toHaveBeenNthCalledWith(2, { where: { id: "p-2" } });
  });

  it("nettoie aussi les fichiers images sur disque pour chaque orphelin", async () => {
    mockProductFindMany.mockResolvedValue([{ id: "p-1", reference: "REF-A" }]);
    mockImageFindMany.mockResolvedValue([
      { path: "/uploads/products/a.webp" },
      { path: "/uploads/products/b.webp" },
    ]);
    await cleanupOrphanedSyncingProducts(["pfs-1"], new Date());
    expect(mockImageFindMany).toHaveBeenCalledWith({
      where: { productId: "p-1" },
      select: { path: true },
    });
    expect(mockDeleteFiles).toHaveBeenCalled();
  });

  it("ne plante pas quand aucun orphelin n'est trouvé", async () => {
    mockProductFindMany.mockResolvedValue([]);
    const result = await cleanupOrphanedSyncingProducts(["pfs-1"], new Date());
    expect(result.deletedCount).toBe(0);
    expect(result.references).toEqual([]);
    expect(mockProductDelete).not.toHaveBeenCalled();
  });
});
