/**
 * Tests pour POST /api/heartbeat.
 *
 * - Anonyme / rôle ADMIN → 204 silencieux, AUCUNE update BDD.
 * - CLIENT connecté sans body → update lastSeenAt = now uniquement.
 * - CLIENT connecté avec body { activeConversationId } → update lastSeenAt
 *   + activeConversationId (registre de présence par conversation utilisé
 *   par le chronomètre 5 min Service Client, cf. lib/support-notify.ts).
 *
 * Le statut 204 (au lieu de 401) est volontaire : on ne veut pas
 * spammer les logs si un client est déconnecté entre 2 pings.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

function buildRequest(body?: unknown): NextRequest {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new NextRequest("http://localhost/api/heartbeat", init);
}

describe("POST /api/heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne 204 sans toucher la BDD pour un anonyme", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(buildRequest());
    expect(res.status).toBe(204);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("retourne 204 sans toucher la BDD pour un ADMIN", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", status: "APPROVED" },
    } as never);
    const res = await POST(buildRequest());
    expect(res.status).toBe(204);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("met à jour lastSeenAt pour un CLIENT connecté (sans body)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "client-42", role: "CLIENT", status: "APPROVED" },
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const before = Date.now();
    const res = await POST(buildRequest());
    const after = Date.now();

    expect(res.status).toBe(204);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);

    const call = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect(call.where).toEqual({ id: "client-42" });
    const data = call.data as { lastSeenAt: Date; activeConversationId?: unknown };
    expect(data.lastSeenAt).toBeInstanceOf(Date);
    expect(data.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.lastSeenAt.getTime()).toBeLessThanOrEqual(after);
    // Pas de body → on ne touche pas activeConversationId.
    expect(data.activeConversationId).toBeUndefined();
  });

  it("met à jour activeConversationId quand fourni en body", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "client-42", role: "CLIENT", status: "APPROVED" },
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const res = await POST(buildRequest({ activeConversationId: "conv-abc" }));
    expect(res.status).toBe(204);

    const call = vi.mocked(prisma.user.update).mock.calls[0][0];
    const data = call.data as { activeConversationId: string };
    expect(data.activeConversationId).toBe("conv-abc");
  });

  it("efface activeConversationId quand le body envoie null explicitement", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "client-42", role: "CLIENT", status: "APPROVED" },
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    await POST(buildRequest({ activeConversationId: null }));

    const call = vi.mocked(prisma.user.update).mock.calls[0][0];
    const data = call.data as { activeConversationId: string | null };
    expect(data.activeConversationId).toBeNull();
  });

  it("met à jour lastSeenAt même pour un CLIENT PENDING (on suit aussi les non-approuvés)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "client-99", role: "CLIENT", status: "PENDING" },
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const res = await POST(buildRequest());
    expect(res.status).toBe(204);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });
});
