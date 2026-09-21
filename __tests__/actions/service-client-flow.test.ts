/**
 * Tests fonctionnels — Service Client (Claim simplifiée).
 *
 * Couvre les invariants clés :
 *  - Statut binaire OPEN/CLOSED
 *  - Réouverture auto d'une conv fermée quand le client répond
 *  - Notification client déléguée à scheduleReplyNotification (chronomètre 5 min)
 *  - Accusé de lecture asymétrique (readAt posé côté admin uniquement)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  conversation: { findFirst: vi.fn() },
  message: { create: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  user: { findUnique: vi.fn() },
  scheduleReplyNotification: vi.fn().mockResolvedValue(undefined),
  cancelPendingNotifications: vi.fn().mockResolvedValue(undefined),
  notifyAdmin: vi.fn().mockResolvedValue(undefined),
  session: { user: { id: "admin-1", role: "ADMIN", status: "APPROVED", email: "a@t.fr" } },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    claim: mocks.claim,
    conversation: mocks.conversation,
    message: mocks.message,
    user: mocks.user,
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockImplementation(() => Promise.resolve(mocks.session)),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock("@/lib/notifications", () => ({
  notifyAdminNewClaim: mocks.notifyAdmin,
}));

vi.mock("@/lib/support-notify", () => ({
  scheduleReplyNotification: mocks.scheduleReplyNotification,
  cancelPendingNotifications: mocks.cancelPendingNotifications,
}));

vi.mock("@/lib/chat-events", () => ({
  emitChatEvent: vi.fn(),
}));

vi.mock("@/lib/messaging", () => ({
  addMessage: vi.fn().mockImplementation(({ conversationId, content, senderRole }) =>
    Promise.resolve({
      id: `msg-${Date.now()}`,
      conversationId,
      content,
      senderRole,
      createdAt: new Date(),
      attachments: [],
      sender: { firstName: "Test" },
    }),
  ),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1", messages: [] }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/claims", () => ({
  generateClaimReference: vi.fn().mockResolvedValue("SAV-2026-000042"),
}));

vi.mock("@/lib/storage", () => ({ deleteFiles: vi.fn().mockResolvedValue(undefined) }));

const mockClaim = mocks.claim;
const mockMessage = mocks.message;
const mockScheduleReply = mocks.scheduleReplyNotification;
const mockCancelPending = mocks.cancelPendingNotifications;
const mockNotifyAdmin = mocks.notifyAdmin;
const mockSession = mocks.session;

// ─── Import APRÈS les mocks ─────────────────────────────────────

import {
  sendAdminMessage,
  closeClaim,
  markMessagesReadByAdmin,
} from "@/app/actions/admin/claims";
import {
  sendClientMessage,
  markMessagesReadByClient,
} from "@/app/actions/client/claims";

describe("Service Client — flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.user = { id: "admin-1", role: "ADMIN", status: "APPROVED", email: "a@t.fr" };
  });

  describe("closeClaim", () => {
    it("pose status=CLOSED et closedAt", async () => {
      mockClaim.findUnique.mockResolvedValue({
        status: "OPEN",
        userId: "u1",
        conversation: { id: "conv-1" },
      });
      mockClaim.update.mockResolvedValue({});

      const res = await closeClaim("c1");
      expect(res.success).toBe(true);
      expect(mockClaim.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "c1" },
          data: expect.objectContaining({ status: "CLOSED", closedAt: expect.any(Date) }),
        }),
      );
    });

    it("est idempotent : re-clôturer une conv déjà fermée ne fait rien", async () => {
      mockClaim.findUnique.mockResolvedValue({
        status: "CLOSED",
        userId: "u1",
        conversation: { id: "conv-1" },
      });

      const res = await closeClaim("c1");
      expect(res.success).toBe(true);
      expect(mockClaim.update).not.toHaveBeenCalled();
    });
  });

  describe("sendAdminMessage — programme la notification", () => {
    it("appelle scheduleReplyNotification avec context=claim + claimId", async () => {
      mockClaim.findUnique.mockResolvedValue({
        userId: "client-1",
        conversation: { id: "conv-1" },
      });

      const res = await sendAdminMessage("c1", "Bonjour");
      expect(res.success).toBe(true);
      expect(mockScheduleReply).toHaveBeenCalledWith({
        conversationId: "conv-1",
        messageId: expect.stringMatching(/^msg-/),
        userId: "client-1",
        context: "claim",
        claimId: "c1",
      });
    });
  });

  describe("markMessagesReadByAdmin — accusé lecture asymétrique", () => {
    it("marque uniquement les messages CLIENT comme lus", async () => {
      mockClaim.findUnique.mockResolvedValue({
        userId: "u1",
        conversation: { id: "conv-1" },
      });
      mockMessage.updateMany.mockResolvedValue({ count: 3 });

      await markMessagesReadByAdmin("c1");

      expect(mockMessage.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: "conv-1",
          senderRole: "CLIENT",
          readAt: null,
        },
        data: { readAt: expect.any(Date) },
      });
      // La lecture côté ADMIN ne doit PAS annuler le timer côté client
      expect(mockCancelPending).not.toHaveBeenCalled();
    });
  });

  describe("markMessagesReadByClient — annule le timer 5 min", () => {
    beforeEach(() => {
      mockSession.user = { id: "client-1", role: "CLIENT", status: "APPROVED", email: "c@t.fr" };
    });

    it("marque les messages ADMIN comme lus + annule les PendingSupportEmail", async () => {
      mockClaim.findFirst.mockResolvedValue({
        conversation: { id: "conv-1" },
      });
      mockMessage.updateMany.mockResolvedValue({ count: 2 });

      await markMessagesReadByClient("c1");

      expect(mockMessage.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: "conv-1",
          senderRole: "ADMIN",
          readAt: null,
        },
        data: { readAt: expect.any(Date) },
      });
      expect(mockCancelPending).toHaveBeenCalledWith("conv-1");
    });
  });

  describe("sendClientMessage — réouverture auto", () => {
    beforeEach(() => {
      mockSession.user = { id: "client-1", role: "CLIENT", status: "APPROVED", email: "c@t.fr" };
    });

    it("réouvre la conversation si elle était CLOSED (status → OPEN, closedAt → null)", async () => {
      mockClaim.findFirst.mockResolvedValue({
        id: "c1", reference: "SAV-2026-000042", subject: "Test",
        status: "CLOSED",
        userId: "client-1",
        user: { firstName: "Marie", lastName: "L", company: "Bijoux" },
        conversation: { id: "conv-1" },
      });
      mockClaim.update.mockResolvedValue({});

      const res = await sendClientMessage("c1", "Relance !");

      expect(res.success).toBe(true);
      expect(mockClaim.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "c1" },
          data: { status: "OPEN", closedAt: null },
        }),
      );
      // Réouverture = notification admin
      expect(mockNotifyAdmin).toHaveBeenCalledOnce();
    });

    it("ne rouvre pas + ne notifie pas si la conversation était déjà OPEN", async () => {
      mockClaim.findFirst.mockResolvedValue({
        id: "c1", reference: "SAV-2026-000042", subject: "Test",
        status: "OPEN",
        userId: "client-1",
        user: { firstName: "Marie", lastName: "L", company: "Bijoux" },
        conversation: { id: "conv-1" },
      });

      const res = await sendClientMessage("c1", "Encore une question");

      expect(res.success).toBe(true);
      expect(mockClaim.update).not.toHaveBeenCalled();
      expect(mockNotifyAdmin).not.toHaveBeenCalled();
    });
  });
});
