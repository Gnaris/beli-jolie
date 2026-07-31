/**
 * Tests pour POST /api/admin/marketplace-queue/dismiss.
 *
 * Contrat : le clic sur la croix ✕ d'une carte produit dans le widget flottant
 * marketplaces retire cette ligne de la liste. On annule (CANCELLED) uniquement
 * les jobs en QUEUED, SUCCEEDED ou FAILED — jamais un job en vol
 * (IN_PROGRESS / AWAITING_CALLBACK), pour ne pas couper un appel marketplace
 * en cours.
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
import { POST } from "@/app/api/admin/marketplace-queue/dismiss/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/marketplace-queue/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/marketplace-queue/dismiss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse un accès non ADMIN (401)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(makeRequest({ ids: ["job-1"] }));
    expect(res.status).toBe(401);
    expect(prisma.marketplaceRefreshJob.updateMany).not.toHaveBeenCalled();
  });

  it("refuse un CLIENT connecté (401)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u-1", role: "CLIENT" },
    } as never);
    const res = await POST(makeRequest({ ids: ["job-1"] }));
    expect(res.status).toBe(401);
    expect(prisma.marketplaceRefreshJob.updateMany).not.toHaveBeenCalled();
  });

  it("refuse un body sans ids (400)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(prisma.marketplaceRefreshJob.updateMany).not.toHaveBeenCalled();
  });

  it("refuse un tableau ids vide (400)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    const res = await POST(makeRequest({ ids: [] }));
    expect(res.status).toBe(400);
    expect(prisma.marketplaceRefreshJob.updateMany).not.toHaveBeenCalled();
  });

  it("ignore les entrées non-string du tableau ids", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.marketplaceRefreshJob.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    const res = await POST(
      makeRequest({ ids: ["job-1", 42, null, "", "job-2"] }),
    );
    expect(res.status).toBe(200);

    const call = vi.mocked(prisma.marketplaceRefreshJob.updateMany).mock.calls[0][0];
    expect(call.where).toMatchObject({
      id: { in: ["job-1", "job-2"] },
    });
  });

  it("annule uniquement les jobs QUEUED / SUCCEEDED / FAILED — laisse IN_PROGRESS et AWAITING_CALLBACK intacts", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.marketplaceRefreshJob.updateMany).mockResolvedValue({
      count: 3,
    } as never);

    const res = await POST(
      makeRequest({ ids: ["job-a", "job-b", "job-c"] }),
    );
    expect(res.status).toBe(200);

    expect(prisma.marketplaceRefreshJob.updateMany).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.marketplaceRefreshJob.updateMany).mock.calls[0][0];

    // Le filtre borne aux statuts finaux + queued : jamais IN_PROGRESS ni AWAITING_CALLBACK.
    expect(call.where).toEqual({
      id: { in: ["job-a", "job-b", "job-c"] },
      status: { in: ["QUEUED", "SUCCEEDED", "FAILED"] },
    });

    // Bascule en CANCELLED (pas de suppression physique — on garde la trace).
    expect((call.data as { status: string }).status).toBe("CANCELLED");
    expect((call.data as { completedAt: Date }).completedAt).toBeInstanceOf(Date);
  });

  it("renvoie le nombre de lignes annulées", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.marketplaceRefreshJob.updateMany).mockResolvedValue({
      count: 5,
    } as never);

    const res = await POST(makeRequest({ ids: ["j1", "j2", "j3", "j4", "j5"] }));
    const body = (await res.json()) as { dismissed: number };
    expect(body.dismissed).toBe(5);
  });

  it("ne casse pas quand aucun id ne matche en base", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.marketplaceRefreshJob.updateMany).mockResolvedValue({
      count: 0,
    } as never);

    const res = await POST(makeRequest({ ids: ["inconnu"] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dismissed: number };
    expect(body.dismissed).toBe(0);
  });
});
