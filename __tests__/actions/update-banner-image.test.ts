/**
 * Tests for updateBannerImage (server action) :
 *   - admin-only gating
 *   - upsert / delete BDD
 *   - suppression des anciens fichiers (large + -md.webp) sur swap ET sur remove
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  siteConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
const mockRevalidate = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
const mockHealth = vi.hoisted(() => ({ clearAutoMaintenance: vi.fn() }));
const mockStorage = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  keyFromDbPath: (p: string) => p.replace(/^\//, ""),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => mockRevalidate);
vi.mock("@/lib/health", () => mockHealth);
vi.mock("@/lib/storage", () => mockStorage);

import { updateBannerImage } from "@/app/actions/admin/site-config";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.siteConfig.findUnique.mockResolvedValue(null);
  mockPrisma.siteConfig.upsert.mockResolvedValue({});
  mockPrisma.siteConfig.deleteMany.mockResolvedValue({ count: 1 });
  mockStorage.deleteFile.mockResolvedValue(undefined);
});

describe("updateBannerImage", () => {
  it("refuse un non-admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    const result = await updateBannerImage("/uploads/banniere/accueil-abc.webp");
    expect(result.success).toBe(false);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });

  it("upsert la clé pour un admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateBannerImage("/uploads/banniere/accueil-xyz.webp");
    expect(result.success).toBe(true);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledWith({
      where: { key: "banner_image" },
      update: { value: "/uploads/banniere/accueil-xyz.webp" },
      create: { key: "banner_image", value: "/uploads/banniere/accueil-xyz.webp" },
    });
  });

  it("supprime la clé quand on passe null", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateBannerImage(null);
    expect(result.success).toBe(true);
    expect(mockPrisma.siteConfig.deleteMany).toHaveBeenCalledWith({
      where: { key: "banner_image" },
    });
  });

  it("supprime large + -md.webp de l'ancienne bannière lors d'un swap", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findUnique.mockResolvedValueOnce({
      value: "/uploads/banniere/accueil-old.webp",
    });

    await updateBannerImage("/uploads/banniere/accueil-new.webp");

    expect(mockStorage.deleteFile).toHaveBeenCalledTimes(2);
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/banniere/accueil-old.webp");
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/banniere/accueil-old-md.webp");
  });

  it("supprime large + -md.webp quand la bannière est retirée (null)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findUnique.mockResolvedValueOnce({
      value: "/uploads/banniere/accueil-old.webp",
    });

    await updateBannerImage(null);

    expect(mockStorage.deleteFile).toHaveBeenCalledTimes(2);
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/banniere/accueil-old.webp");
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/banniere/accueil-old-md.webp");
  });

  it("ne supprime rien si pas d'ancienne bannière", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findUnique.mockResolvedValueOnce(null);

    await updateBannerImage("/uploads/banniere/accueil-new.webp");
    expect(mockStorage.deleteFile).not.toHaveBeenCalled();
  });

  it("succeede même si la suppression du disque échoue", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findUnique.mockResolvedValueOnce({
      value: "/uploads/banniere/accueil-old.webp",
    });
    mockStorage.deleteFile.mockRejectedValueOnce(new Error("EACCES"));

    const result = await updateBannerImage(null);
    expect(result.success).toBe(true);
  });
});
