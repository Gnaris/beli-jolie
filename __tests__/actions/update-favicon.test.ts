/**
 * Tests for updateFavicon (server action) :
 *   - admin-only gating
 *   - upsert site_favicon JSON quand on fournit les deux paths
 *   - delete quand on passe null
 *   - validation des chemins (les deux requis quand non-null)
 *   - suppression des fichiers de l'ancienne icône sur swap ET sur remove
 *   - revalidation des metadata routes /icon et /apple-icon
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

import { updateFavicon } from "@/app/actions/admin/site-config";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.siteConfig.findUnique.mockResolvedValue(null);
  mockPrisma.siteConfig.upsert.mockResolvedValue({});
  mockPrisma.siteConfig.deleteMany.mockResolvedValue({ count: 1 });
  mockStorage.deleteFile.mockResolvedValue(undefined);
});

describe("updateFavicon", () => {
  it("refuse un visiteur non connecté", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const result = await updateFavicon({
      icon: "/uploads/favicon/icon-abc.png",
      appleIcon: "/uploads/favicon/apple-icon-abc.png",
    });
    expect(result.success).toBe(false);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });

  it("refuse un client connecté (non admin)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    const result = await updateFavicon({
      icon: "/uploads/favicon/icon-abc.png",
      appleIcon: "/uploads/favicon/apple-icon-abc.png",
    });
    expect(result.success).toBe(false);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });

  it("upsert site_favicon en JSON avec les deux chemins", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateFavicon({
      icon: "/uploads/favicon/icon-zzz.png",
      appleIcon: "/uploads/favicon/apple-icon-zzz.png",
    });
    expect(result.success).toBe(true);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.siteConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ key: "site_favicon" });
    const parsed = JSON.parse(call.update.value);
    expect(parsed).toEqual({
      icon: "/uploads/favicon/icon-zzz.png",
      appleIcon: "/uploads/favicon/apple-icon-zzz.png",
    });
    expect(mockRevalidate.revalidateTag).toHaveBeenCalledWith("site-config", "default");
    expect(mockRevalidate.revalidatePath).toHaveBeenCalledWith("/icon");
    expect(mockRevalidate.revalidatePath).toHaveBeenCalledWith("/apple-icon");
  });

  it("supprime la clé quand on passe null (retour au favicon généré)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateFavicon(null);
    expect(result.success).toBe(true);
    expect(mockPrisma.siteConfig.deleteMany).toHaveBeenCalledWith({
      where: { key: "site_favicon" },
    });
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
    expect(mockRevalidate.revalidatePath).toHaveBeenCalledWith("/icon");
    expect(mockRevalidate.revalidatePath).toHaveBeenCalledWith("/apple-icon");
  });

  it("rejette des chemins partiels (manque appleIcon)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateFavicon({
      icon: "/uploads/favicon/icon-zzz.png",
      appleIcon: "",
    });
    expect(result.success).toBe(false);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });

  it("supprime les anciens fichiers quand on remplace par un nouveau favicon", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findUnique.mockResolvedValueOnce({
      value: JSON.stringify({
        icon: "/uploads/favicon/icon-old.png",
        appleIcon: "/uploads/favicon/apple-icon-old.png",
      }),
    });

    await updateFavicon({
      icon: "/uploads/favicon/icon-new.png",
      appleIcon: "/uploads/favicon/apple-icon-new.png",
    });

    expect(mockStorage.deleteFile).toHaveBeenCalledTimes(2);
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/favicon/icon-old.png");
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/favicon/apple-icon-old.png");
  });

  it("supprime les fichiers de l'ancien favicon lors d'une suppression (null)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findUnique.mockResolvedValueOnce({
      value: JSON.stringify({
        icon: "/uploads/favicon/icon-old.png",
        appleIcon: "/uploads/favicon/apple-icon-old.png",
      }),
    });

    await updateFavicon(null);

    expect(mockStorage.deleteFile).toHaveBeenCalledTimes(2);
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/favicon/icon-old.png");
    expect(mockStorage.deleteFile).toHaveBeenCalledWith("uploads/favicon/apple-icon-old.png");
  });

  it("ne tombe pas en panne si la suppression d'un ancien fichier échoue", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findUnique.mockResolvedValueOnce({
      value: JSON.stringify({
        icon: "/uploads/favicon/icon-old.png",
        appleIcon: "/uploads/favicon/apple-icon-old.png",
      }),
    });
    mockStorage.deleteFile.mockRejectedValueOnce(new Error("EACCES"));

    const result = await updateFavicon(null);
    expect(result.success).toBe(true);
  });
});
