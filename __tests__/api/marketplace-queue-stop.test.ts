/**
 * Tests pour POST /api/admin/marketplace-queue/stop.
 *
 * Contrat : le bouton « Arrêter les suivants » du widget marketplace annule
 * SEULEMENT les jobs encore QUEUED (en attente) — les jobs IN_PROGRESS et
 * AWAITING_CALLBACK doivent continuer jusqu'à leur terme naturel pour ne pas
 * casser un appel marketplace en vol.
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
import { POST } from "@/app/api/admin/marketplace-queue/stop/route";

describe("POST /api/admin/marketplace-queue/stop", () => {
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

  it("annule uniquement les jobs QUEUED — laisse IN_PROGRESS et AWAITING_CALLBACK intacts", async () => {
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

    // Filtre sur status = QUEUED uniquement, jamais sur IN_PROGRESS ni AWAITING_CALLBACK
    expect(call.where).toEqual({ status: "QUEUED" });

    // Bascule en CANCELLED (pas de suppression physique — on garde la trace)
    expect((call.data as { status: string }).status).toBe("CANCELLED");
    expect((call.data as { completedAt: Date }).completedAt).toBeInstanceOf(Date);
  });

  it("renvoie le nombre de jobs annulés", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.marketplaceRefreshJob.updateMany).mockResolvedValue({
      count: 7,
    } as never);

    const res = await POST();
    const body = (await res.json()) as { cancelled: number };
    expect(body.cancelled).toBe(7);
  });

  it("ne casse pas quand la file est vide", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.marketplaceRefreshJob.updateMany).mockResolvedValue({
      count: 0,
    } as never);

    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cancelled: number };
    expect(body.cancelled).toBe(0);
  });
});
