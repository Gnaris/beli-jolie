/**
 * Tests for updateSeoTexts (server action) — gating admin, validation longueur,
 * upsert des deux clés SiteConfig (home_seo_text + produits_seo_text).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  siteConfig: { upsert: vi.fn() },
}));
const mockRevalidate = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
const mockHealth = vi.hoisted(() => ({ clearAutoMaintenance: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => mockRevalidate);
vi.mock("@/lib/health", () => mockHealth);

import { updateSeoTexts } from "@/app/actions/admin/site-config";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.siteConfig.upsert.mockResolvedValue({});
});

describe("updateSeoTexts", () => {
  it("refuse un visiteur non connecté", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const result = await updateSeoTexts({ homeText: "x", produitsText: "y" });
    expect(result.success).toBe(false);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });

  it("refuse un client connecté (non admin)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    const result = await updateSeoTexts({ homeText: "x", produitsText: "y" });
    expect(result.success).toBe(false);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });

  it("upsert les deux clés SiteConfig pour un admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateSeoTexts({
      homeText: "  Bienvenue chez nous  ",
      produitsText: "Notre catalogue.",
    });
    expect(result.success).toBe(true);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledWith({
      where: { key: "home_seo_text" },
      update: { value: "Bienvenue chez nous" },
      create: { key: "home_seo_text", value: "Bienvenue chez nous" },
    });
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledWith({
      where: { key: "produits_seo_text" },
      update: { value: "Notre catalogue." },
      create: { key: "produits_seo_text", value: "Notre catalogue." },
    });
    expect(mockRevalidate.revalidateTag).toHaveBeenCalledWith("site-config", "default");
  });

  it("rejette un texte trop long (> 5000 caractères)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const huge = "a".repeat(5001);
    const result = await updateSeoTexts({ homeText: huge, produitsText: "ok" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/5000/);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });

  it("accepte les textes vides (suppression du bloc côté front)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateSeoTexts({ homeText: "", produitsText: "" });
    expect(result.success).toBe(true);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledTimes(2);
  });
});
