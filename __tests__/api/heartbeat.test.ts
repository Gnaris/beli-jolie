/**
 * Tests pour POST /api/heartbeat.
 *
 * - Anonyme / rôle ADMIN → 204 silencieux, AUCUNE update BDD.
 * - CLIENT connecté → update lastSeenAt = now.
 *
 * Le statut 204 (au lieu de 401) est volontaire : on ne veut pas
 * spammer les logs si un client est déconnecté entre 2 pings.
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
    user: {
      update: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/heartbeat/route";

describe("POST /api/heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne 204 sans toucher la BDD pour un anonyme", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(204);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("retourne 204 sans toucher la BDD pour un ADMIN", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", status: "APPROVED" },
    } as never);
    const res = await POST();
    expect(res.status).toBe(204);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("met à jour lastSeenAt pour un CLIENT connecté", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "client-42", role: "CLIENT", status: "APPROVED" },
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const before = Date.now();
    const res = await POST();
    const after = Date.now();

    expect(res.status).toBe(204);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);

    const call = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect(call.where).toEqual({ id: "client-42" });
    const stamp = (call.data as { lastSeenAt: Date }).lastSeenAt;
    expect(stamp).toBeInstanceOf(Date);
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(stamp.getTime()).toBeLessThanOrEqual(after);
  });

  it("met à jour lastSeenAt même pour un CLIENT PENDING (on suit aussi les non-approuvés)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "client-99", role: "CLIENT", status: "PENDING" },
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const res = await POST();
    expect(res.status).toBe(204);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });
});
