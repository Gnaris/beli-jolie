/**
 * Tests pour updateBrandBranding (server action) — gating admin, validation
 * URL sociaux, gestion des chaînes vides (= suppression via unsetSiteConfig).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockRevalidate = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
const mockSiteConfigWrite = vi.hoisted(() => ({
  setSiteConfig: vi.fn(),
  unsetSiteConfig: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/cache", () => mockRevalidate);
vi.mock("@/lib/health", () => ({ clearAutoMaintenance: vi.fn() }));
vi.mock("@/lib/site-config-write", () => mockSiteConfigWrite);

import { updateBrandBranding } from "@/app/actions/admin/site-config";

beforeEach(() => {
  vi.clearAllMocks();
  mockSiteConfigWrite.setSiteConfig.mockResolvedValue(undefined);
  mockSiteConfigWrite.unsetSiteConfig.mockResolvedValue(undefined);
});

describe("updateBrandBranding", () => {
  it("refuse un utilisateur non admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    const result = await updateBrandBranding({ logoUrl: "", ogImageUrl: "", socials: {} });
    expect(result.success).toBe(false);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("efface toutes les clés quand tous les champs sont vides", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateBrandBranding({
      logoUrl: "",
      ogImageUrl: "",
      socials: {},
    });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.unsetSiteConfig).toHaveBeenCalledWith("site_logo_url");
    expect(mockSiteConfigWrite.unsetSiteConfig).toHaveBeenCalledWith("site_og_image_url");
    // 7 réseaux sociaux + logo + og image = 9 unset au total
    expect(mockSiteConfigWrite.unsetSiteConfig).toHaveBeenCalledTimes(9);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("enregistre logo + réseaux valides", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateBrandBranding({
      logoUrl: "/uploads/beliandjolie/logo/logo-x.png",
      ogImageUrl: "",
      socials: {
        social_instagram_url: "https://www.instagram.com/beliandjolie",
        social_facebook_url: "https://www.facebook.com/beliandjolie",
      },
    });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith(
      "site_logo_url",
      "/uploads/beliandjolie/logo/logo-x.png",
    );
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith(
      "social_instagram_url",
      "https://www.instagram.com/beliandjolie",
    );
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith(
      "social_facebook_url",
      "https://www.facebook.com/beliandjolie",
    );
    expect(mockRevalidate.revalidateTag).toHaveBeenCalledWith("site-config", "default");
    expect(mockRevalidate.revalidateTag).toHaveBeenCalledWith("company-info", "default");
  });

  it("rejette une URL sociale en http:// (exige https)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateBrandBranding({
      logoUrl: "",
      ogImageUrl: "",
      socials: { social_instagram_url: "http://insta.com/foo" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Instagram/);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("rejette un logo qui n'est ni un chemin ni une URL http(s)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateBrandBranding({
      logoUrl: "javascript:alert(1)",
      ogImageUrl: "",
      socials: {},
    });
    expect(result.success).toBe(false);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("accepte un lien absolu https:// pour le logo (CDN externe)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateBrandBranding({
      logoUrl: "https://cdn.beliandjolie.com/logo.png",
      ogImageUrl: "",
      socials: {},
    });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith(
      "site_logo_url",
      "https://cdn.beliandjolie.com/logo.png",
    );
  });

  it("efface un réseau vide et enregistre celui rempli dans la même sauvegarde", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateBrandBranding({
      logoUrl: "",
      ogImageUrl: "",
      socials: {
        social_instagram_url: "https://www.instagram.com/beliandjolie",
        social_facebook_url: "  ",
      },
    });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith(
      "social_instagram_url",
      "https://www.instagram.com/beliandjolie",
    );
    expect(mockSiteConfigWrite.unsetSiteConfig).toHaveBeenCalledWith("social_facebook_url");
  });
});
