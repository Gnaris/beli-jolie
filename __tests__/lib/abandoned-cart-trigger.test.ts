/**
 * Tests unitaires de `bumpAbandonedCartTimer` — trigger appelé après chaque
 * mutation panier. Vérifie que le trigger respecte l'opt-out unifié
 * newsletter + relances panier :
 *   - user avec `acceptsNewsletter=false` → cancel + pas de job créé,
 *   - user avec `abandonedCartOptOut=true` → cancel + pas de job créé,
 *   - user CLIENT APPROVED + newsletter ON + panier plein → job créé.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  cartItem: { count: vi.fn() },
  abandonedCartStage: { findMany: vi.fn() },
  abandonedCartJob: {
    findFirst: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { bumpAbandonedCartTimer } from "@/lib/abandoned-cart-trigger";

describe("bumpAbandonedCartTimer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.abandonedCartJob.findFirst.mockResolvedValue(null);
  });

  it("annule les jobs et ne crée rien si le user est désinscrit newsletter", async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      role: "CLIENT",
      status: "APPROVED",
      abandonedCartOptOut: false,
      acceptsNewsletter: false,
    });

    await bumpAbandonedCartTimer("client-x", "tenant-1");

    expect(mockPrisma.abandonedCartJob.updateMany).toHaveBeenCalledWith({
      where: { userId: "client-x", tenantId: "tenant-1", status: "PENDING" },
      data: { status: "CANCELLED", nextStageAt: null, cancelReason: "OPT_OUT" },
    });
    expect(mockPrisma.abandonedCartJob.create).not.toHaveBeenCalled();
    expect(mockPrisma.cartItem.count).not.toHaveBeenCalled();
  });

  it("annule les jobs si abandonedCartOptOut=true (legacy)", async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      role: "CLIENT",
      status: "APPROVED",
      abandonedCartOptOut: true,
      acceptsNewsletter: true,
    });

    await bumpAbandonedCartTimer("client-y", "tenant-1");

    expect(mockPrisma.abandonedCartJob.updateMany).toHaveBeenCalledWith({
      where: { userId: "client-y", tenantId: "tenant-1", status: "PENDING" },
      data: { status: "CANCELLED", nextStageAt: null, cancelReason: "OPT_OUT" },
    });
    expect(mockPrisma.abandonedCartJob.create).not.toHaveBeenCalled();
  });

  it("crée un job si user newsletter ON + non opt-out + panier plein + stages configurés", async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      role: "CLIENT",
      status: "APPROVED",
      abandonedCartOptOut: false,
      acceptsNewsletter: true,
    });
    mockPrisma.cartItem.count.mockResolvedValueOnce(2);
    mockPrisma.abandonedCartStage.findMany.mockResolvedValueOnce([
      { stageIndex: 1, delaySeconds: 3600 },
    ]);

    await bumpAbandonedCartTimer("client-z", "tenant-1");

    expect(mockPrisma.abandonedCartJob.create).toHaveBeenCalledTimes(1);
    const call = mockPrisma.abandonedCartJob.create.mock.calls[0][0];
    expect(call.data.tenantId).toBe("tenant-1");
    expect(call.data.userId).toBe("client-z");
    expect(call.data.status).toBe("PENDING");
  });

  it("ne fait rien si user introuvable (tenant hors scope)", async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce(null);

    await bumpAbandonedCartTimer("ghost", "tenant-1");

    expect(mockPrisma.abandonedCartJob.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.abandonedCartJob.create).not.toHaveBeenCalled();
  });
});
