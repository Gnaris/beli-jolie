/**
 * Tests for updateSeoTexts (server action) — gating admin, validation longueur,
 * upsert des 8 clés SiteConfig (4 FR + 4 EN).
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
const mockSiteConfigWrite = vi.hoisted(() => ({
  setSiteConfig: vi.fn(),
  unsetSiteConfig: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => mockRevalidate);
vi.mock("@/lib/health", () => mockHealth);
vi.mock("@/lib/site-config-write", () => mockSiteConfigWrite);

import { updateSeoTexts } from "@/app/actions/admin/site-config";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.siteConfig.upsert.mockResolvedValue({});
  mockSiteConfigWrite.setSiteConfig.mockResolvedValue(undefined);
  mockSiteConfigWrite.unsetSiteConfig.mockResolvedValue(undefined);
});

describe("updateSeoTexts", () => {
  it("refuse un visiteur non connecté", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const result = await updateSeoTexts({ homeText: "x", produitsText: "y" });
    expect(result.success).toBe(false);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("refuse un client connecté (non admin)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    const result = await updateSeoTexts({ homeText: "x", produitsText: "y" });
    expect(result.success).toBe(false);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("upsert les huit clés SiteConfig pour un admin (4 FR + 4 EN)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateSeoTexts({
      homeText: "  Bienvenue chez nous  ",
      produitsText: "Notre catalogue.",
      produitsIntroText: "  Accroche courte  ",
      tagline: "  Grossiste maroquinerie  ",
      homeTextEn: "  Welcome  ",
      produitsTextEn: "Our catalog.",
      produitsIntroTextEn: "  Short intro  ",
      taglineEn: "  Wholesaler leathergoods  ",
    });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledTimes(8);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("home_seo_text", "Bienvenue chez nous");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("produits_seo_text", "Notre catalogue.");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("produits_seo_intro", "Accroche courte");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("seo_tagline", "Grossiste maroquinerie");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("home_seo_text_en", "Welcome");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("produits_seo_text_en", "Our catalog.");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("produits_seo_intro_en", "Short intro");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("seo_tagline_en", "Wholesaler leathergoods");
    expect(mockRevalidate.revalidateTag).toHaveBeenCalledWith("site-config", "default");
  });

  it("écrit les clés _en vides quand l'anglais n'est pas fourni (fallback FR côté front)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateSeoTexts({
      homeText: "FR",
      produitsText: "FR2",
      produitsIntroText: "Intro FR",
      tagline: "Baseline FR",
    });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("home_seo_text_en", "");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("produits_seo_text_en", "");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("produits_seo_intro_en", "");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("seo_tagline_en", "");
  });

  it("écrit seo_tagline vide quand la baseline n'est pas fournie", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateSeoTexts({ homeText: "", produitsText: "" });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("seo_tagline", "");
  });

  it("écrit produits_seo_intro vide quand l'accroche n'est pas fournie", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateSeoTexts({ homeText: "", produitsText: "" });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("produits_seo_intro", "");
  });

  it("rejette une accroche trop longue (> 400 caractères)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const long = "z".repeat(401);
    const result = await updateSeoTexts({
      homeText: "",
      produitsText: "",
      produitsIntroText: long,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/400/);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("rejette un texte trop long (> 5000 caractères)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const huge = "a".repeat(5001);
    const result = await updateSeoTexts({ homeText: huge, produitsText: "ok" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/5000/);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("rejette une baseline trop longue (> 80 caractères)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const long = "b".repeat(81);
    const result = await updateSeoTexts({ homeText: "", produitsText: "", tagline: long });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/80/);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("accepte les textes vides (suppression du bloc côté front)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateSeoTexts({ homeText: "", produitsText: "" });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledTimes(8);
  });

  it("rejette un texte anglais trop long", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const huge = "a".repeat(5001);
    const result = await updateSeoTexts({ homeText: "", produitsText: "", homeTextEn: huge });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/5000/);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("rejette une accroche anglaise trop longue", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const long = "z".repeat(401);
    const result = await updateSeoTexts({ homeText: "", produitsText: "", produitsIntroTextEn: long });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/400/);
  });
});
