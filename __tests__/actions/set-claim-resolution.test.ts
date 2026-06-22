/**
 * Tests : setClaimResolution doit faire avancer le statut de la demande
 * après application d'une résolution — sinon l'admin reste bloqué sur
 * « Appliquer la résolution » (bug rapporté côté Service Client).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  claim: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
}));

const mockSession = vi.hoisted(() => ({
  user: { id: "admin-1", role: "ADMIN" },
}));

const mockCreateCredit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockAddMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockNotifyClient = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockEmitChat = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/credits", () => ({ createCredit: mockCreateCredit }));
vi.mock("@/lib/messaging", () => ({ addMessage: mockAddMessage }));
vi.mock("@/lib/notifications", () => ({ notifyClientClaimUpdate: mockNotifyClient }));
vi.mock("@/lib/chat-events", () => ({ emitChatEvent: mockEmitChat }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { setClaimResolution } from "@/app/actions/admin/claims";

const baseClaim = {
  id: "claim-1",
  userId: "user-1",
  reference: "SAV-2026-000001",
  status: "ACCEPTED",
  conversation: { id: "conv-1" },
  user: { id: "user-1", email: "c@x.fr", firstName: "Cli" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.claim.findUnique.mockResolvedValue(baseClaim);
});

describe("setClaimResolution — fait avancer le statut", () => {
  it("NONE depuis ACCEPTED → passe à RESOLVED", async () => {
    const result = await setClaimResolution("claim-1", "NONE", {});
    expect(result).toEqual({ success: true });
    expect(mockPrisma.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resolution: "NONE", status: "RESOLVED" }),
      }),
    );
    expect(mockNotifyClient).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: "RESOLVED" }),
    );
  });

  it("CREDIT depuis ACCEPTED → passe à RESOLVED + crée l'avoir", async () => {
    const result = await setClaimResolution("claim-1", "CREDIT", { amount: 50 });
    expect(result).toEqual({ success: true });
    expect(mockCreateCredit).toHaveBeenCalledWith({
      userId: "user-1",
      amount: 50,
      claimId: "claim-1",
    });
    expect(mockPrisma.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolution: "CREDIT",
          creditAmount: 50,
          status: "RESOLVED",
        }),
      }),
    );
  });

  it("REFUND depuis ACCEPTED → passe à RESOLUTION_PENDING", async () => {
    await setClaimResolution("claim-1", "REFUND", { amount: 80 });
    expect(mockPrisma.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolution: "REFUND",
          refundAmount: 80,
          status: "RESOLUTION_PENDING",
        }),
      }),
    );
    expect(mockNotifyClient).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: "RESOLUTION_PENDING" }),
    );
  });

  it("RESHIP depuis ACCEPTED → passe à RESOLUTION_PENDING", async () => {
    await setClaimResolution("claim-1", "RESHIP", {});
    expect(mockPrisma.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolution: "RESHIP",
          status: "RESOLUTION_PENDING",
        }),
      }),
    );
  });

  it("message admin est ajouté à la conversation si fourni", async () => {
    await setClaimResolution("claim-1", "REFUND", { amount: 30, message: "Virement effectué demain" });
    expect(mockAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        senderRole: "ADMIN",
        content: "Virement effectué demain",
      }),
    );
  });

  it("ne change pas de statut si la transition n'est pas autorisée (ex: depuis RESOLVED)", async () => {
    mockPrisma.claim.findUnique.mockResolvedValue({ ...baseClaim, status: "RESOLVED" });
    await setClaimResolution("claim-1", "REFUND", { amount: 20 });
    const updateCall = mockPrisma.claim.update.mock.calls[0]?.[0];
    expect(updateCall?.data).not.toHaveProperty("status");
    expect(mockNotifyClient).not.toHaveBeenCalled();
  });

  it("retourne une erreur si la demande est introuvable", async () => {
    mockPrisma.claim.findUnique.mockResolvedValue(null);
    const result = await setClaimResolution("nope", "NONE", {});
    expect(result).toEqual({ success: false, error: "Demande introuvable." });
    expect(mockPrisma.claim.update).not.toHaveBeenCalled();
  });
});
