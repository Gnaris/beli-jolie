/**
 * Tests pour /api/admin/recent-emails
 *
 * Vérifie que le feed retourne bien les 60 dernières minutes d'EmailSend
 * en excluant ceux liés à un BulkMailJob (metadata.bulkMailJobId présent).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  emailSend: {
    findMany: vi.fn(),
  },
}));

const mockGetSession = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
);

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next-auth", () => ({ getServerSession: mockGetSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/admin/recent-emails/route";

function makeEmail(over: Partial<{
  id: string;
  recipientEmail: string;
  scenarioKey: string;
  subject: string;
  status: "SENT" | "FAILED";
  errorMessage: string | null;
  sentAt: Date;
  metadata: unknown;
  userId: string | null;
}> = {}) {
  return {
    id: over.id ?? "e-1",
    recipientEmail: over.recipientEmail ?? "a@shop.fr",
    fromName: "Beli & Jolie",
    scenarioKey: over.scenarioKey ?? "ABANDONED_CART",
    subject: over.subject ?? "Votre panier vous attend",
    status: (over.status ?? "SENT") as "SENT" | "FAILED",
    errorMessage: over.errorMessage ?? null,
    sentAt: over.sentAt ?? new Date(),
    metadata: over.metadata ?? null,
    userId: over.userId ?? "u-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: { role: "ADMIN" } });
});

describe("GET /api/admin/recent-emails", () => {
  it("refuse quand pas admin", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("retourne les EmailSend récents formatés", async () => {
    const now = new Date();
    mockPrisma.emailSend.findMany.mockResolvedValue([
      makeEmail({ id: "e-1", scenarioKey: "ABANDONED_CART", sentAt: now }),
      makeEmail({ id: "e-2", scenarioKey: "NEWSLETTER", sentAt: now }),
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emails: Array<{ id: string; scenarioKey: string }> };
    expect(body.emails).toHaveLength(2);
    expect(body.emails.map((e) => e.id)).toEqual(["e-1", "e-2"]);
  });

  it("exclut les EmailSend liés à un BulkMailJob (metadata.bulkMailJobId présent)", async () => {
    mockPrisma.emailSend.findMany.mockResolvedValue([
      makeEmail({ id: "e-solo", metadata: null }),
      makeEmail({ id: "e-bulk-1", metadata: { bulkMailJobId: "job-1" } }),
      makeEmail({ id: "e-manuel", metadata: { orderId: "ord-42" } }),
    ]);

    const res = await GET();
    const body = (await res.json()) as { emails: Array<{ id: string }> };
    expect(body.emails.map((e) => e.id)).toEqual(["e-solo", "e-manuel"]);
    expect(body.emails.find((e) => e.id === "e-bulk-1")).toBeUndefined();
  });

  it("interroge Prisma sur la fenêtre 60 min + limite 100", async () => {
    mockPrisma.emailSend.findMany.mockResolvedValue([]);
    await GET();
    expect(mockPrisma.emailSend.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sentAt: { gte: expect.any(Date) } },
        orderBy: { sentAt: "desc" },
        take: 100,
      }),
    );
    const call = mockPrisma.emailSend.findMany.mock.calls[0][0] as {
      where: { sentAt: { gte: Date } };
    };
    const diff = Date.now() - call.where.sentAt.gte.getTime();
    // Fenêtre théorique = 60 min ± 1s
    expect(diff).toBeGreaterThanOrEqual(59 * 60_000);
    expect(diff).toBeLessThanOrEqual(61 * 60_000);
  });
});
