/**
 * Tests pour app/actions/admin/updateUserStatus.ts (P1-02).
 *
 * On vérifie que l'admin reçoit bien un email quand on approuve OU refuse
 * un compte client — et qu'on n'envoie PAS d'email si le statut ne change pas.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
}));

const mockSession = vi.hoisted(() => ({
  user: { id: "admin-1", role: "ADMIN" },
}));

const mockNotifications = vi.hoisted(() => ({
  notifyClientAccountApproved: vi.fn().mockResolvedValue(undefined),
  notifyClientAccountRejected: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/notifications", () => mockNotifications);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  // redirect lance une erreur spéciale Next — on la simule avec un throw
  // qu'on attrape dans les tests.
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

import { updateUserStatus } from "@/app/actions/admin/updateUserStatus";

const baseClient = {
  id: "user-1",
  role: "CLIENT" as const,
  email: "client@test.fr",
  firstName: "Marie",
  status: "PENDING" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateUserStatus — emails de validation/refus (P1-02)", () => {
  it("envoie l'email d'approbation quand on passe PENDING → APPROVED", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(baseClient);

    await expect(updateUserStatus("user-1", "APPROVED")).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(mockNotifications.notifyClientAccountApproved).toHaveBeenCalledWith({
      email: "client@test.fr",
      firstName: "Marie",
    });
    expect(mockNotifications.notifyClientAccountRejected).not.toHaveBeenCalled();
  });

  it("envoie l'email de refus quand on passe PENDING → REJECTED", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(baseClient);

    await expect(updateUserStatus("user-1", "REJECTED")).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(mockNotifications.notifyClientAccountRejected).toHaveBeenCalledWith({
      email: "client@test.fr",
      firstName: "Marie",
    });
    expect(mockNotifications.notifyClientAccountApproved).not.toHaveBeenCalled();
  });

  it("n'envoie aucun email si le statut ne change pas", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...baseClient,
      status: "APPROVED",
    });

    await expect(updateUserStatus("user-1", "APPROVED")).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(mockNotifications.notifyClientAccountApproved).not.toHaveBeenCalled();
    expect(mockNotifications.notifyClientAccountRejected).not.toHaveBeenCalled();
  });

  it("refuse de modifier un autre admin et n'envoie aucun email", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...baseClient,
      role: "ADMIN",
    });

    await expect(updateUserStatus("user-1", "REJECTED")).rejects.toThrow(
      /administrateur/,
    );

    expect(mockNotifications.notifyClientAccountApproved).not.toHaveBeenCalled();
    expect(mockNotifications.notifyClientAccountRejected).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
