import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/auth/me/status/route";

describe("GET /api/auth/me/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne 401 si non authentifié", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("retourne 404 si l'utilisateur n'existe plus en BDD", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1", role: "CLIENT", status: "PENDING" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("retourne le statut frais lu en BDD pour un PENDING", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1", role: "CLIENT", status: "PENDING" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      status: "PENDING",
      role: "CLIENT",
    } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "PENDING", role: "CLIENT" });
  });

  it("retourne APPROVED quand l'admin a validé entre-temps", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1", role: "CLIENT", status: "PENDING" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      status: "APPROVED",
      role: "CLIENT",
    } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("APPROVED");
  });

  it("ne lit que les colonnes status et role", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1", role: "CLIENT", status: "PENDING" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      status: "APPROVED",
      role: "CLIENT",
    } as never);
    await GET();
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { status: true, role: true },
    });
  });
});
