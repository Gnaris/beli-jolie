import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setSiteConfig: vi.fn(),
  unsetSiteConfig: vi.fn(),
  getServerSession: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/site-config-write", () => ({
  setSiteConfig: mocks.setSiteConfig,
  unsetSiteConfig: mocks.unsetSiteConfig,
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
}));

import { gtmContainerIdSchema, GTM_CONTAINER_ID_KEY, GTM_CONTAINER_ID_PATTERN } from "@/lib/analytics";
import { updateGtmContainerId } from "@/app/actions/admin/analytics";

describe("gtmContainerIdSchema", () => {
  it("accepte un ID GTM standard", () => {
    expect(gtmContainerIdSchema.safeParse("GTM-ABC1234").success).toBe(true);
    expect(gtmContainerIdSchema.safeParse("GTM-K7P2Q9").success).toBe(true);
    expect(gtmContainerIdSchema.safeParse("GTM-ABCDEFGHIJ").success).toBe(true);
  });

  it("accepte une chaîne vide (= désactivation GTM)", () => {
    expect(gtmContainerIdSchema.safeParse("").success).toBe(true);
    expect(gtmContainerIdSchema.safeParse("   ").success).toBe(true);
  });

  it("refuse une saisie en minuscules", () => {
    expect(gtmContainerIdSchema.safeParse("gtm-abc1234").success).toBe(false);
  });

  it("refuse un préfixe différent (UA, G-, etc.)", () => {
    expect(gtmContainerIdSchema.safeParse("UA-123456-1").success).toBe(false);
    expect(gtmContainerIdSchema.safeParse("G-ABC1234").success).toBe(false);
  });

  it("refuse une partie identifiant trop courte ou trop longue", () => {
    expect(gtmContainerIdSchema.safeParse("GTM-ABC").success).toBe(false);
    expect(gtmContainerIdSchema.safeParse("GTM-ABCDEFGHIJK").success).toBe(false);
  });

  it("refuse les caractères spéciaux ou espaces", () => {
    expect(gtmContainerIdSchema.safeParse("GTM-ABC-123").success).toBe(false);
    expect(gtmContainerIdSchema.safeParse("GTM-ABC 123").success).toBe(false);
  });

  it("expose les constantes partagées serveur/client", () => {
    expect(GTM_CONTAINER_ID_KEY).toBe("gtm_container_id");
    expect(GTM_CONTAINER_ID_PATTERN.test("GTM-ABC1234")).toBe(true);
  });
});

describe("updateGtmContainerId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { role: "ADMIN" } });
  });

  it("refuse quand l'utilisateur n'est pas admin", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { role: "CLIENT" } });
    const result = await updateGtmContainerId("GTM-ABC1234");
    expect(result.success).toBe(false);
    expect(mocks.setSiteConfig).not.toHaveBeenCalled();
  });

  it("sauvegarde un ID GTM valide via setSiteConfig", async () => {
    const result = await updateGtmContainerId("GTM-ABC1234");
    expect(result.success).toBe(true);
    expect(mocks.setSiteConfig).toHaveBeenCalledWith("gtm_container_id", "GTM-ABC1234");
    expect(mocks.unsetSiteConfig).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).toHaveBeenCalledWith("site-config", "default");
  });

  it("efface la clé quand on vide le champ", async () => {
    const result = await updateGtmContainerId("");
    expect(result.success).toBe(true);
    expect(mocks.unsetSiteConfig).toHaveBeenCalledWith("gtm_container_id");
    expect(mocks.setSiteConfig).not.toHaveBeenCalled();
  });

  it("retourne une erreur sur format invalide, sans toucher à la BDD", async () => {
    const result = await updateGtmContainerId("UA-123456-1");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/GTM-/);
    expect(mocks.setSiteConfig).not.toHaveBeenCalled();
    expect(mocks.unsetSiteConfig).not.toHaveBeenCalled();
  });
});
