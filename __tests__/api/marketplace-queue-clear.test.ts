/**
 * Tests pour POST /api/admin/marketplace-queue/clear.
 *
 * Contrat : le bouton « Tout vider » du tiroir marketplaces retire uniquement
 * les cartes ✓ terminées (SUCCEEDED → CANCELLED). Les erreurs (FAILED) sont
 * gardées pour retry, les jobs en attente (QUEUED) et en vol
 * (IN_PROGRESS / AWAITING_CALLBACK) ne sont jamais touchés.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketplaceRefreshJob: {
      updateMany: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/admin/marketplace-queue/clear/route";

describe("POST /api/admin/marketplace-queue/clear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse un accès non ADMIN (401)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(prisma.marketplaceRefreshJob.updateMany).not.toHaveBeenCalled();
  });

  it("refuse un CLIENT connecté (401)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u-1", role: "CLIENT" },
    } as never);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(prisma.marketplaceRefreshJob.updateMany).not.toHaveBeenCalled();
  });

  it("annule UNIQUEMENT les jobs SUCCEEDED — laisse FAILED, QUEUED, IN_PROGRESS et AWAITING_CALLBACK intacts", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.marketplaceRefreshJob.updateMany).mockResolvedValue({
      count: 4,
    } as never);

    const res = await POST();
    expect(res.status).toBe(200);

    expect(prisma.marketplaceRefreshJob.updateMany).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.marketplaceRefreshJob.updateMany).mock.calls[0][0];

    // Filtre borné aux ✓ terminés seulement — la cliente veut garder les
    // erreurs visibles pour pouvoir cliquer « Réessayer ».
    expect(call.where).toEqual({ status: "SUCCEEDED" });

    // Bascule en CANCELLED (pas de suppression physique — on garde la trace).
    expect((call.data as { status: string }).status).toBe("CANCELLED");
  });

  it("renvoie le nombre de lignes annulées", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.marketplaceRefreshJob.updateMany).mockResolvedValue({
      count: 7,
    } as never);

    const res = await POST();
    const body = (await res.json()) as { cleared: number };
    expect(body.cleared).toBe(7);
  });
});
