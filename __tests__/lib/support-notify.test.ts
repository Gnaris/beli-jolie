/**
 * Tests de lib/support-notify.ts — règle « 1 mail par tour »
 * (décidée avec la cliente 2026-10-15).
 *
 * Règles vérifiées :
 *  1. Message admin → crée un PendingSupportEmail recipientRole=CLIENT dueAt +2 min.
 *  2. Message client → crée un PendingSupportEmail recipientRole=ADMIN dueAt +2 min.
 *  3. Nouveau message dans le même tour → PAS de doublon (job existant détecté).
 *  4. L'expéditeur « ferme » son propre tour : lignes où il est destinataire = deleteMany.
 *  5. markAdminAlreadyNotifiedThisTurn pose une ligne SENT côté admin.
 *  6. Fonction swallow — ne throw pas si erreur Prisma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  pendingSupportEmail: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "job-1" }),
  },
  conversation: {
    findFirst: vi.fn().mockResolvedValue({ userId: "client-1" }),
  },
  user: {
    findFirst: vi.fn().mockResolvedValue({ id: "admin-1" }),
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pendingSupportEmail: mocks.pendingSupportEmail,
    conversation: mocks.conversation,
    user: mocks.user,
  },
}));
vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));

import {
  scheduleReplyNotification,
  markAdminAlreadyNotifiedThisTurn,
  SUPPORT_NOTIFY_DELAY_MS,
} from "@/lib/support-notify";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pendingSupportEmail.deleteMany.mockResolvedValue({ count: 0 });
  mocks.pendingSupportEmail.findFirst.mockResolvedValue(null);
  mocks.pendingSupportEmail.create.mockResolvedValue({ id: "job-1" });
  mocks.conversation.findFirst.mockResolvedValue({ userId: "client-1" });
  mocks.user.findFirst.mockResolvedValue({ id: "admin-1" });
});

describe("scheduleReplyNotification — règle 1 mail par tour", () => {
  it("message ADMIN → crée job PENDING recipientRole=CLIENT à +2 min", async () => {
    const before = Date.now();
    await scheduleReplyNotification({
      conversationId: "conv-1",
      messageId: "msg-1",
      senderRole: "ADMIN",
      context: "chat",
    });

    expect(mocks.pendingSupportEmail.create).toHaveBeenCalledOnce();
    const arg = mocks.pendingSupportEmail.create.mock.calls[0][0];
    expect(arg.data.conversationId).toBe("conv-1");
    expect(arg.data.messageId).toBe("msg-1");
    expect(arg.data.recipientRole).toBe("CLIENT");
    expect(arg.data.userId).toBe("client-1");
    expect(arg.data.status).toBe("PENDING");
    const dueAtMs = (arg.data.dueAt as Date).getTime();
    expect(dueAtMs).toBeGreaterThanOrEqual(before + SUPPORT_NOTIFY_DELAY_MS - 10);
    expect(dueAtMs).toBeLessThanOrEqual(before + SUPPORT_NOTIFY_DELAY_MS + 500);
  });

  it("message CLIENT → crée job PENDING recipientRole=ADMIN à +2 min", async () => {
    await scheduleReplyNotification({
      conversationId: "conv-1",
      messageId: "msg-2",
      senderRole: "CLIENT",
      context: "chat",
    });

    expect(mocks.pendingSupportEmail.create).toHaveBeenCalledOnce();
    const arg = mocks.pendingSupportEmail.create.mock.calls[0][0];
    expect(arg.data.recipientRole).toBe("ADMIN");
    expect(arg.data.userId).toBe("admin-1");
    expect(arg.data.status).toBe("PENDING");
  });

  it("l'expéditeur ferme son propre tour (deleteMany sur recipientRole=senderRole)", async () => {
    await scheduleReplyNotification({
      conversationId: "conv-1",
      messageId: "msg-1",
      senderRole: "ADMIN",
      context: "chat",
    });

    expect(mocks.pendingSupportEmail.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: "conv-1", recipientRole: "ADMIN" },
    });
  });

  it("job PENDING déjà en cours sur le destinataire → PAS de doublon", async () => {
    mocks.pendingSupportEmail.findFirst.mockResolvedValue({ id: "job-existant" });

    await scheduleReplyNotification({
      conversationId: "conv-1",
      messageId: "msg-2",
      senderRole: "ADMIN",
      context: "chat",
    });

    expect(mocks.pendingSupportEmail.create).not.toHaveBeenCalled();
  });

  it("job SENT déjà présent sur le destinataire → PAS de nouveau mail pour ce tour", async () => {
    mocks.pendingSupportEmail.findFirst.mockResolvedValue({ id: "job-deja-envoye" });

    await scheduleReplyNotification({
      conversationId: "conv-1",
      messageId: "msg-3",
      senderRole: "CLIENT",
      context: "chat",
    });

    expect(mocks.pendingSupportEmail.create).not.toHaveBeenCalled();
  });

  it("propage claimId sur context=claim", async () => {
    await scheduleReplyNotification({
      conversationId: "conv-1",
      messageId: "msg-1",
      senderRole: "ADMIN",
      context: "claim",
      claimId: "claim-42",
    });

    const arg = mocks.pendingSupportEmail.create.mock.calls[0][0];
    expect(arg.data.claimId).toBe("claim-42");
  });

  it("ne throw pas si erreur Prisma (fire-and-forget safe)", async () => {
    mocks.pendingSupportEmail.deleteMany.mockRejectedValueOnce(new Error("DB down"));

    await expect(
      scheduleReplyNotification({
        conversationId: "conv-1",
        messageId: "msg-1",
        senderRole: "ADMIN",
        context: "chat",
      }),
    ).resolves.toBeUndefined();
    expect(mocks.logger.error).toHaveBeenCalled();
  });

  it("recipientRole=ADMIN mais pas d'admin configuré → log warn + pas de job", async () => {
    mocks.user.findFirst.mockResolvedValue(null);

    await scheduleReplyNotification({
      conversationId: "conv-1",
      messageId: "msg-1",
      senderRole: "CLIENT",
      context: "chat",
    });

    expect(mocks.pendingSupportEmail.create).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalled();
  });
});

describe("markAdminAlreadyNotifiedThisTurn", () => {
  it("pose une ligne SENT côté admin (dueAt=now, sentAt=now)", async () => {
    await markAdminAlreadyNotifiedThisTurn({
      conversationId: "conv-1",
      messageId: "msg-ticket",
      claimId: "claim-7",
    });

    expect(mocks.pendingSupportEmail.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: "conv-1", recipientRole: "ADMIN" },
    });
    expect(mocks.pendingSupportEmail.create).toHaveBeenCalledOnce();
    const arg = mocks.pendingSupportEmail.create.mock.calls[0][0];
    expect(arg.data.status).toBe("SENT");
    expect(arg.data.recipientRole).toBe("ADMIN");
    expect(arg.data.claimId).toBe("claim-7");
    expect(arg.data.sentAt).toBeInstanceOf(Date);
  });
});
