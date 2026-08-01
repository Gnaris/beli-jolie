/**
 * Tests fonctionnels — Service Client (Claim simplifiée).
 *
 * Couvre les invariants clés post-refonte 2026-08 :
 *  - Statut binaire OPEN/CLOSED
 *  - Réouverture auto d'une conv fermée quand le client répond
 *  - Rate-limit de notifyClient (1h)
 *  - Accusé de lecture asymétrique (readAt posé côté admin uniquement)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock est hoisté en haut du fichier — on utilise vi.hoisted() pour
// que les mocks soient initialisés AVANT les vi.mock() qui les référencent.
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
  notifyClient: vi.fn().mockResolvedValue(undefined),
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
  notifyClientHasNewReply: mocks.notifyClient,
  notifyAdminNewClaim: mocks.notifyAdmin,
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
  NOTIFY_CLIENT_COOLDOWN_MS: 60 * 60 * 1000,
  generateClaimReference: vi.fn().mockResolvedValue("SAV-2026-000042"),
}));

const mockClaim = mocks.claim;
const mockMessage = mocks.message;
const mockNotifyClient = mocks.notifyClient;
const mockNotifyAdmin = mocks.notifyAdmin;
const mockSession = mocks.session;

// ─── Import APRÈS les mocks ─────────────────────────────────────

import { notifyClient, closeClaim, markMessagesReadByAdmin } from "@/app/actions/admin/claims";
import { sendClientMessage } from "@/app/actions/client/claims";

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

  describe("notifyClient — rate-limit 1h", () => {
    it("envoie l'email si jamais notifié", async () => {
      mockClaim.findUnique.mockResolvedValue({
        id: "c1", reference: "SAV-2026-000042", subject: "Test",
        lastNotifiedClientAt: null,
        user: { email: "c@t.fr", firstName: "Marie", lastName: "L" },
      });
      mockClaim.update.mockResolvedValue({});

      const res = await notifyClient("c1");
      expect(res.success).toBe(true);
      expect(mockNotifyClient).toHaveBeenCalledOnce();
      expect(mockClaim.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastNotifiedClientAt: expect.any(Date) },
        }),
      );
    });

    it("refuse si dernier envoi < 1h + expose remainingMinutes", async () => {
      const halfHourAgo = new Date(Date.now() - 30 * 60 * 1000);
      mockClaim.findUnique.mockResolvedValue({
        id: "c1", reference: "SAV-2026-000042", subject: "Test",
        lastNotifiedClientAt: halfHourAgo,
        user: { email: "c@t.fr", firstName: "Marie", lastName: "L" },
      });

      const res = await notifyClient("c1");
      expect(res.success).toBe(false);
      expect(res.remainingMinutes).toBeGreaterThan(25);
      expect(res.remainingMinutes).toBeLessThanOrEqual(30);
      expect(mockNotifyClient).not.toHaveBeenCalled();
    });

    it("autorise à nouveau si dernier envoi > 1h", async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      mockClaim.findUnique.mockResolvedValue({
        id: "c1", reference: "SAV-2026-000042", subject: "Test",
        lastNotifiedClientAt: twoHoursAgo,
        user: { email: "c@t.fr", firstName: "Marie", lastName: "L" },
      });
      mockClaim.update.mockResolvedValue({});

      const res = await notifyClient("c1");
      expect(res.success).toBe(true);
      expect(mockNotifyClient).toHaveBeenCalledOnce();
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
