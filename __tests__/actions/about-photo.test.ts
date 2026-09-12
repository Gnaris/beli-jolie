/**
 * Tests pour updateAboutPhoto (server action) et l'helper aboutPhotoKey :
 * gating admin, validation slot, écriture SiteConfig, purge des anciens fichiers.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  siteConfig: {
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
const mockRevalidate = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
const mockHealth = vi.hoisted(() => ({ clearAutoMaintenance: vi.fn() }));
const mockSiteConfigWrite = vi.hoisted(() => ({
  setSiteConfig: vi.fn(),
  unsetSiteConfig: vi.fn(),
}));
const mockStorage = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  keyFromDbPath: (p: string) => p.replace(/^\//, ""),
}));
const mockLogger = vi.hoisted(() => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => mockRevalidate);
vi.mock("@/lib/health", () => mockHealth);
vi.mock("@/lib/site-config-write", () => mockSiteConfigWrite);
vi.mock("@/lib/storage", () => mockStorage);
vi.mock("@/lib/logger", () => mockLogger);

import { updateAboutPhoto } from "@/app/actions/admin/site-config";
import { aboutPhotoKey } from "@/lib/about-photo";

beforeEach(() => {
  vi.clearAllMocks();
  mockSiteConfigWrite.setSiteConfig.mockResolvedValue(undefined);
  mockPrisma.siteConfig.findFirst.mockResolvedValue(null);
  mockPrisma.siteConfig.deleteMany.mockResolvedValue({ count: 0 });
  mockStorage.deleteFile.mockResolvedValue(undefined);
});

describe("aboutPhotoKey", () => {
  it("mappe chaque emplacement 1..6 vers la clé SiteConfig correspondante", () => {
    expect(aboutPhotoKey(1)).toBe("about_photo_1_url");
    expect(aboutPhotoKey(6)).toBe("about_photo_6_url");
  });

  it("rejette les emplacements hors bornes", () => {
    expect(() => aboutPhotoKey(0)).toThrow();
    expect(() => aboutPhotoKey(7)).toThrow();
    expect(() => aboutPhotoKey(1.5)).toThrow();
  });
});

describe("updateAboutPhoto", () => {
  it("refuse un visiteur non connecté", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const result = await updateAboutPhoto(1, "/uploads/beliandjolie/a-propos/photo-1-abc.webp");
    expect(result.success).toBe(false);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("refuse un CLIENT non-admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    const result = await updateAboutPhoto(1, "/uploads/beliandjolie/a-propos/photo-1-abc.webp");
    expect(result.success).toBe(false);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("rejette un emplacement invalide", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateAboutPhoto(9, "/uploads/beliandjolie/a-propos/photo-9-abc.webp");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/emplacement/i);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("écrit la clé about_photo_{n}_url pour un admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const path = "/uploads/beliandjolie/a-propos/photo-3-abc.webp";
    const result = await updateAboutPhoto(3, path);
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("about_photo_3_url", path);
    expect(mockRevalidate.revalidateTag).toHaveBeenCalledWith("site-config", "default");
  });

  it("purge le fichier précédent (large + -md) quand la photo change", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findFirst.mockResolvedValueOnce({
      value: "/uploads/beliandjolie/a-propos/photo-2-old.webp",
    });
    const newPath = "/uploads/beliandjolie/a-propos/photo-2-new.webp";
    const result = await updateAboutPhoto(2, newPath);
    expect(result.success).toBe(true);
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/beliandjolie/a-propos/photo-2-old.webp");
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/beliandjolie/a-propos/photo-2-old-md.webp");
  });

  it("supprime la clé et purge les fichiers quand on passe null", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findFirst.mockResolvedValueOnce({
      value: "/uploads/beliandjolie/a-propos/photo-4-old.webp",
    });
    const result = await updateAboutPhoto(4, null);
    expect(result.success).toBe(true);
    expect(mockPrisma.siteConfig.deleteMany).toHaveBeenCalledWith({ where: { key: "about_photo_4_url" } });
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/beliandjolie/a-propos/photo-4-old.webp");
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/beliandjolie/a-propos/photo-4-old-md.webp");
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("ne purge rien si le path ne change pas", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const path = "/uploads/beliandjolie/a-propos/photo-1-same.webp";
    mockPrisma.siteConfig.findFirst.mockResolvedValueOnce({ value: path });
    const result = await updateAboutPhoto(1, path);
    expect(result.success).toBe(true);
    expect(mockStorage.deleteFile).not.toHaveBeenCalled();
  });
});
