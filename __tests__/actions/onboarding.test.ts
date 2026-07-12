/**
 * Tests pour app/actions/admin/onboarding.ts — markStepCompleted,
 * completeOnboarding, skipOnboarding.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  siteConfig: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn().mockResolvedValue({}),
  },
  user: {
    update: vi.fn().mockResolvedValue({}),
  },
}));

const mockSiteConfigWrite = vi.hoisted(() => ({
  setSiteConfig: vi.fn(),
  unsetSiteConfig: vi.fn(),
}));

const mockSession = vi.hoisted(() => ({
  user: { id: "admin-1", role: "ADMIN", name: "Admin" },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/site-config-write", () => mockSiteConfigWrite);
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

import bcrypt from "bcryptjs";
import {
  markStepCompleted,
  completeOnboarding,
  skipOnboarding,
  updateAdminPassword,
} from "@/app/actions/admin/onboarding";

describe("markStepCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.siteConfig.upsert.mockResolvedValue({});
    mockSiteConfigWrite.setSiteConfig.mockResolvedValue(undefined);
  });

  it("refuse une étape inconnue", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue([]);
    // @ts-expect-error test invalid input
    const res = await markStepCompleted("etape_bidon");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/inconnue/i);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });

  it("ajoute une étape à la liste vide", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue([]);
    const res = await markStepCompleted("welcome");
    expect(res.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith(
      "onboarding_steps_completed",
      JSON.stringify(["welcome"]),
    );
  });

  it("ajoute une étape à la liste existante en préservant l'ordre", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue([
      { key: "onboarding_steps_completed", value: JSON.stringify(["welcome", "company"]) },
    ]);
    const res = await markStepCompleted("stripe");
    expect(res.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith(
      "onboarding_steps_completed",
      JSON.stringify(["welcome", "company", "stripe"]),
    );
  });

  it("est idempotent : ajouter une étape deja présente ne double pas la liste", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue([
      { key: "onboarding_steps_completed", value: JSON.stringify(["welcome", "company"]) },
    ]);
    const res = await markStepCompleted("welcome");
    expect(res.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).not.toHaveBeenCalled();
  });
});

describe("completeOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.siteConfig.upsert.mockResolvedValue({});
    mockSiteConfigWrite.setSiteConfig.mockResolvedValue(undefined);
  });

  it("pose onboarding_completed_at à une date ISO", async () => {
    const res = await completeOnboarding();
    expect(res.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledTimes(1);
    const call = mockSiteConfigWrite.setSiteConfig.mock.calls[0];
    expect(call[0]).toBe("onboarding_completed_at");
    const isoValue = call[1] as string;
    expect(() => new Date(isoValue).toISOString()).not.toThrow();
    expect(new Date(isoValue).toISOString()).toBe(isoValue);
  });
});

describe("skipOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.siteConfig.upsert.mockResolvedValue({});
    mockSiteConfigWrite.setSiteConfig.mockResolvedValue(undefined);
  });

  it("agit comme completeOnboarding (pose la date de fin)", async () => {
    const res = await skipOnboarding();
    expect(res.success).toBe(true);
    expect(mockSiteConfigWrite.setSiteConfig).toHaveBeenCalledWith(
      "onboarding_completed_at",
      expect.any(String),
    );
  });
});

describe("updateAdminPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.update.mockResolvedValue({});
    // getOnboardingStatus() lit siteConfig.findMany : renvoie une liste vide
    // pour que l'étape "welcome" ne soit pas encore complétée (verrou débloqué).
    mockPrisma.siteConfig.findMany.mockResolvedValue([]);
  });

  it("refuse un mot de passe de moins de 8 caractères", async () => {
    const res = await updateAdminPassword("court");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/8 caractères/);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("refuse un mot de passe vide", async () => {
    const res = await updateAdminPassword("");
    expect(res.success).toBe(false);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("hash bcrypt le mot de passe et met à jour l'utilisateur", async () => {
    const res = await updateAdminPassword("motdepasse123");
    expect(res.success).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    const call = mockPrisma.user.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "admin-1" });
    const hashed = call.data.password as string;
    // Le hash bcrypt doit vraiment etre un hash bcrypt (pas le mdp en clair)
    expect(hashed).not.toBe("motdepasse123");
    expect(hashed).toMatch(/^\$2[ayb]\$\d{2}\$/); // format bcrypt
    // Verifier que le hash correspond bien au plaintext
    expect(await bcrypt.compare("motdepasse123", hashed)).toBe(true);
  });
});
