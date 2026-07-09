/**
 * Tests pour app/actions/admin/onboarding.ts — markStepCompleted,
 * completeOnboarding, skipOnboarding.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  siteConfig: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn().mockResolvedValue({}),
  },
}));

const mockSession = vi.hoisted(() => ({
  user: { id: "admin-1", role: "ADMIN", name: "Admin" },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

import {
  markStepCompleted,
  completeOnboarding,
  skipOnboarding,
} from "@/app/actions/admin/onboarding";

describe("markStepCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.siteConfig.upsert.mockResolvedValue({});
  });

  it("refuse une étape inconnue", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue([]);
    // @ts-expect-error test invalid input
    const res = await markStepCompleted("etape_bidon");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/inconnue/i);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });

  it("ajoute une étape à la liste vide", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue([]);
    const res = await markStepCompleted("welcome");
    expect(res.success).toBe(true);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "onboarding_steps_completed" },
        update: { value: JSON.stringify(["welcome"]) },
        create: { key: "onboarding_steps_completed", value: JSON.stringify(["welcome"]) },
      }),
    );
  });

  it("ajoute une étape à la liste existante en préservant l'ordre", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue([
      { key: "onboarding_steps_completed", value: JSON.stringify(["welcome", "company"]) },
    ]);
    const res = await markStepCompleted("stripe");
    expect(res.success).toBe(true);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: JSON.stringify(["welcome", "company", "stripe"]) },
      }),
    );
  });

  it("est idempotent : ajouter une étape deja présente ne double pas la liste", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue([
      { key: "onboarding_steps_completed", value: JSON.stringify(["welcome", "company"]) },
    ]);
    const res = await markStepCompleted("welcome");
    expect(res.success).toBe(true);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });
});

describe("completeOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.siteConfig.upsert.mockResolvedValue({});
  });

  it("pose onboarding_completed_at à une date ISO", async () => {
    const res = await completeOnboarding();
    expect(res.success).toBe(true);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.siteConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ key: "onboarding_completed_at" });
    const isoValue = call.update.value as string;
    expect(() => new Date(isoValue).toISOString()).not.toThrow();
    expect(new Date(isoValue).toISOString()).toBe(isoValue);
  });
});

describe("skipOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.siteConfig.upsert.mockResolvedValue({});
  });

  it("agit comme completeOnboarding (pose la date de fin)", async () => {
    const res = await skipOnboarding();
    expect(res.success).toBe(true);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "onboarding_completed_at" },
      }),
    );
  });
});
