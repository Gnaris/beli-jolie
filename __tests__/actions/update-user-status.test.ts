/**
 * Tests pour app/actions/admin/updateUserStatus.ts (P1-02).
 *
 * On vérifie que l'admin reçoit bien un email quand on approuve OU refuse
 * un compte client — et qu'on n'envoie PAS d'email si le statut ne change pas.
 *
 * Depuis 2026-08-12 : l'action ne fait plus `redirect()` (bug manifest
 * Next.js 16 sur `/admin/clients/[id]`). Elle renvoie
 * `{ success: true }` ou `{ success: false, error }` et c'est le composant
 * client `UserStatusActions` qui navigue.
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
  notifyClientAccountRevoked: vi.fn().mockResolvedValue(undefined),
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
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
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

    const result = await updateUserStatus("user-1", "APPROVED");

    expect(result).toEqual({ success: true });
    expect(mockNotifications.notifyClientAccountApproved).toHaveBeenCalledWith({
      email: "client@test.fr",
      firstName: "Marie",
    });
    expect(mockNotifications.notifyClientAccountRejected).not.toHaveBeenCalled();
  });

  it("envoie l'email de refus quand on passe PENDING → REJECTED", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(baseClient);

    const result = await updateUserStatus("user-1", "REJECTED");

    expect(result).toEqual({ success: true });
    expect(mockNotifications.notifyClientAccountRejected).toHaveBeenCalledWith({
      email: "client@test.fr",
      firstName: "Marie",
    });
    expect(mockNotifications.notifyClientAccountApproved).not.toHaveBeenCalled();
    expect(mockNotifications.notifyClientAccountRevoked).not.toHaveBeenCalled();
  });

  it("envoie l'email de révocation (pas de refus) quand on passe APPROVED → REJECTED", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...baseClient,
      status: "APPROVED",
    });

    const result = await updateUserStatus("user-1", "REJECTED");

    expect(result).toEqual({ success: true });
    expect(mockNotifications.notifyClientAccountRevoked).toHaveBeenCalledWith({
      email: "client@test.fr",
      firstName: "Marie",
    });
    expect(mockNotifications.notifyClientAccountRejected).not.toHaveBeenCalled();
    expect(mockNotifications.notifyClientAccountApproved).not.toHaveBeenCalled();
  });

  it("n'envoie aucun email si le statut ne change pas", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...baseClient,
      status: "APPROVED",
    });

    const result = await updateUserStatus("user-1", "APPROVED");

    expect(result).toEqual({ success: true });
    expect(mockNotifications.notifyClientAccountApproved).not.toHaveBeenCalled();
    expect(mockNotifications.notifyClientAccountRejected).not.toHaveBeenCalled();
  });

  it("refuse de modifier un autre admin et n'envoie aucun email", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...baseClient,
      role: "ADMIN",
    });

    const result = await updateUserStatus("user-1", "REJECTED");

    expect(result).toEqual({
      success: false,
      error: "Impossible de modifier le statut d'un administrateur.",
    });
    expect(mockNotifications.notifyClientAccountApproved).not.toHaveBeenCalled();
    expect(mockNotifications.notifyClientAccountRejected).not.toHaveBeenCalled();
    expect(mockNotifications.notifyClientAccountRevoked).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
