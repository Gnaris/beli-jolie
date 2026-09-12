/**
 * Tests pour updateAboutPage (server action) : gating admin, validation
 * longueur par section, upsert des 6 clés SiteConfig scopées tenant.
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

import { updateAboutPage } from "@/app/actions/admin/site-config";

const VALID = {
  intro: "Bienvenue chez nous.",
  historyBody: "Depuis 2020…",
  showroomBody: "Notre showroom à Aubervilliers.",
  teamBody: "Une équipe francophone.",
  newnessBody: "Nouveautés chaque semaine.",
  deliveryBody: "France et Europe en 24-48 h.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSiteConfigWrite.setSiteConfig.mockResolvedValue(undefined);
});

describe("updateAboutPage", () => {
  it("refuse un visiteur non connecté", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const result = await updateAboutPage(VALID);
    expect(result.success).toBe(false);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("refuse un CLIENT non-admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    const result = await updateAboutPage(VALID);
    expect(result.success).toBe(false);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("écrit les 6 sections pour un admin (avec trim)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateAboutPage({
      ...VALID,
      intro: "  Bienvenue chez nous.  ",
      historyBody: " Depuis 2020… ",
    });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledTimes(6);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("about_intro", "Bienvenue chez nous.");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("about_history_body", "Depuis 2020…");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("about_showroom_body", VALID.showroomBody);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("about_team_body", VALID.teamBody);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("about_newness_body", VALID.newnessBody);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("about_delivery_body", VALID.deliveryBody);
    expect(mockRevalidate.revalidateTag).toHaveBeenCalledWith("site-config", "default");
  });

  it("accepte des sections vides (retour au fallback i18n)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateAboutPage({
      intro: "",
      historyBody: "",
      showroomBody: "",
      teamBody: "",
      newnessBody: "",
      deliveryBody: "",
    });
    expect(result.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledTimes(6);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("about_intro", "");
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith("about_delivery_body", "");
  });

  it("rejette une section trop longue (> 2000 caractères)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateAboutPage({ ...VALID, historyBody: "a".repeat(2001) });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/2000/);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });
});
