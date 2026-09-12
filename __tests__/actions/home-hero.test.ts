/**
 * Tests pour updateHomeHero (server action) : gating admin, validation des
 * longueurs, refus des URLs javascript:, upsert des 6 clés SiteConfig
 * (tenant-scopées via l'extension Prisma en prod).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({ siteConfig: { upsert: vi.fn() } }));
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

import { updateHomeHero } from "@/app/actions/admin/site-config";

const VALID_INPUT = {
  eyebrow: "Grossiste en prêt-à-porter féminin B2B · CIFA Aubervilliers",
  titleLine1: "Des produits tendance",
  titleLine2: "pour votre boutique",
  description: "Plus de 600 références disponibles pour les boutiques et revendeurs professionnels.",
  ctaSecondaryLabel: "Créer un compte professionnel",
  ctaSecondaryHref: "/inscription",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSiteConfigWrite.setSiteConfig.mockResolvedValue(undefined);
});

describe("updateHomeHero", () => {
  it("refuse un visiteur non connecté", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const result = await updateHomeHero(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("refuse un CLIENT non-admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    const result = await updateHomeHero(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("écrit les 6 clés SiteConfig pour un admin (avec trim)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateHomeHero({
      ...VALID_INPUT,
      eyebrow: "  Mon surtitre  ",
      titleLine1: " Ligne 1 ",
      titleLine2: " Ligne 2 ",
    });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledTimes(6);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("home_hero_eyebrow", "Mon surtitre");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("home_hero_title_line1", "Ligne 1");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("home_hero_title_line2", "Ligne 2");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("home_hero_description", VALID_INPUT.description);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("home_hero_cta_secondary_label", VALID_INPUT.ctaSecondaryLabel);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("home_hero_cta_secondary_href", VALID_INPUT.ctaSecondaryHref);
    expect(mockRevalidate.revalidateTag).toHaveBeenCalledWith("site-config", "default");
  });

  it("accepte des champs vides (retour au fallback i18n)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateHomeHero({
      eyebrow: "",
      titleLine1: "",
      titleLine2: "",
      description: "",
      ctaSecondaryLabel: "",
      ctaSecondaryHref: "",
    });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("home_hero_eyebrow", "");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("home_hero_cta_secondary_href", "");
  });

  it("rejette un surtitre trop long (> 120 caractères)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateHomeHero({ ...VALID_INPUT, eyebrow: "a".repeat(121) });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/120/);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("rejette une description trop longue (> 400 caractères)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateHomeHero({ ...VALID_INPUT, description: "a".repeat(401) });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/400/);
  });

  it("rejette une ligne de titre trop longue (> 60 caractères)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateHomeHero({ ...VALID_INPUT, titleLine1: "a".repeat(61) });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/60/);
  });

  it("refuse une URL malicieuse (javascript:)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateHomeHero({ ...VALID_INPUT, ctaSecondaryHref: "javascript:alert(1)" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/\//);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("accepte une URL absolue https://", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateHomeHero({
      ...VALID_INPUT,
      ctaSecondaryHref: "https://calendly.com/mon-shop",
    });
    expect(result.success).toBe(true);
  });

  it("accepte un href vide (retour au fallback)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateHomeHero({ ...VALID_INPUT, ctaSecondaryHref: "" });
    expect(result.success).toBe(true);
  });
});
