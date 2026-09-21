/**
 * Tests de lib/support-notify.ts — décision présence-aware
 * (chronomètre 5 min Service Client) + anti-spam 20 min.
 *
 * Règles vérifiées :
 *  1. Client hors ligne              → mail immédiat, pas de job créé
 *  2. Client en ligne hors conv      → job PENDING dueAt = now + 5 min
 *  3. Client en ligne SUR la conv    → rien (ni mail, ni job)
 *  4. Chaque nouveau msg admin RESET → annule PENDING existants avant décision
 *  5. cancelPendingNotifications     → passe tous les PENDING de la conv à CANCELLED
 *  6. Cooldown 20 min                → 2ᵉ mail immédiat skip si client n'a pas lu
 *  7. Cooldown levé par la lecture   → dès qu'un message admin est lu, mail OK
 *  8. Cooldown expiré                → après 20 min, mail OK même sans lecture
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  pendingSupportEmail: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({ id: "job-1" }),
  },
  conversation: {
    findFirst: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  message: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
  sendGenericSupportReplyEmail: vi.fn().mockResolvedValue(undefined),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pendingSupportEmail: mocks.pendingSupportEmail,
    conversation: mocks.conversation,
    message: mocks.message,
    user: mocks.user,
  },
}));
vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));
vi.mock("@/lib/notifications", () => ({
  sendGenericSupportReplyEmail: mocks.sendGenericSupportReplyEmail,
}));

import {
  scheduleReplyNotification,
  cancelPendingNotifications,
  canSendImmediateSupportEmail,
  SUPPORT_NOTIFY_DELAY_MS,
  SUPPORT_IMMEDIATE_COOLDOWN_MS,
} from "@/lib/support-notify";

const baseInput = {
  conversationId: "conv-1",
  messageId: "msg-1",
  userId: "client-1",
  context: "chat" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pendingSupportEmail.updateMany.mockResolvedValue({ count: 0 });
  mocks.pendingSupportEmail.create.mockResolvedValue({ id: "job-1" });
  mocks.conversation.findFirst.mockResolvedValue({ lastSupportEmailAt: null });
  mocks.conversation.updateMany.mockResolvedValue({ count: 1 });
  mocks.message.findFirst.mockResolvedValue(null);
});

describe("scheduleReplyNotification — 3 branches présence", () => {
  it("client HORS LIGNE → envoi immédiat, pas de job différé", async () => {
    mocks.user.findFirst.mockResolvedValue({
      id: "client-1",
      email: "c@t.fr",
      firstName: "Marie",
      lastSeenAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
      activeConversationId: null,
    });

    await scheduleReplyNotification(baseInput);

    expect(mocks.sendGenericSupportReplyEmail).toHaveBeenCalledOnce();
    expect(mocks.sendGenericSupportReplyEmail).toHaveBeenCalledWith({
      clientEmail: "c@t.fr",
      clientName: "Marie",
      conversationId: "conv-1",
      context: "chat",
      claimId: undefined,
    });
    expect(mocks.pendingSupportEmail.create).not.toHaveBeenCalled();
    // Après envoi, on pose lastSupportEmailAt pour armer le cooldown.
    expect(mocks.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { lastSupportEmailAt: expect.any(Date) },
    });
  });

  it("client EN LIGNE mais hors conv → crée un PendingSupportEmail dueAt +5 min", async () => {
    mocks.user.findFirst.mockResolvedValue({
      id: "client-1",
      email: "c@t.fr",
      firstName: "Marie",
      lastSeenAt: new Date(),
      activeConversationId: "autre-conv",
    });

    const before = Date.now();
    await scheduleReplyNotification(baseInput);

    expect(mocks.sendGenericSupportReplyEmail).not.toHaveBeenCalled();
    expect(mocks.pendingSupportEmail.create).toHaveBeenCalledOnce();
    const arg = mocks.pendingSupportEmail.create.mock.calls[0][0];
    expect(arg.data.conversationId).toBe("conv-1");
    expect(arg.data.messageId).toBe("msg-1");
    expect(arg.data.userId).toBe("client-1");
    expect(arg.data.status).toBe("PENDING");
    const dueAtMs = (arg.data.dueAt as Date).getTime();
    expect(dueAtMs).toBeGreaterThanOrEqual(before + SUPPORT_NOTIFY_DELAY_MS - 10);
    expect(dueAtMs).toBeLessThanOrEqual(before + SUPPORT_NOTIFY_DELAY_MS + 500);
  });

  it("client EN LIGNE et SUR la conv → aucun mail, aucun job", async () => {
    mocks.user.findFirst.mockResolvedValue({
      id: "client-1",
      email: "c@t.fr",
      firstName: "Marie",
      lastSeenAt: new Date(),
      activeConversationId: "conv-1",
    });

    await scheduleReplyNotification(baseInput);

    expect(mocks.sendGenericSupportReplyEmail).not.toHaveBeenCalled();
    expect(mocks.pendingSupportEmail.create).not.toHaveBeenCalled();
  });

  it("annule les PENDING existants AVANT toute nouvelle décision (reset chronomètre)", async () => {
    mocks.user.findFirst.mockResolvedValue({
      id: "client-1",
      email: "c@t.fr",
      firstName: "Marie",
      lastSeenAt: new Date(),
      activeConversationId: null,
    });

    await scheduleReplyNotification(baseInput);

    const resetCall = mocks.pendingSupportEmail.updateMany.mock.calls[0][0];
    expect(resetCall.where).toEqual({ conversationId: "conv-1", status: "PENDING" });
    expect(resetCall.data.status).toBe("CANCELLED");
  });

  it("propage claimId quand context=claim", async () => {
    mocks.user.findFirst.mockResolvedValue({
      id: "client-1",
      email: "c@t.fr",
      firstName: "Marie",
      lastSeenAt: null, // hors ligne
      activeConversationId: null,
    });

    await scheduleReplyNotification({ ...baseInput, context: "claim", claimId: "claim-42" });

    expect(mocks.sendGenericSupportReplyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ context: "claim", claimId: "claim-42" }),
    );
  });

  it("swallow (ne throw pas) si user introuvable", async () => {
    mocks.user.findFirst.mockResolvedValue(null);

    await expect(scheduleReplyNotification(baseInput)).resolves.toBeUndefined();
    expect(mocks.sendGenericSupportReplyEmail).not.toHaveBeenCalled();
    expect(mocks.pendingSupportEmail.create).not.toHaveBeenCalled();
  });
});

describe("cancelPendingNotifications", () => {
  it("passe tous les jobs PENDING de la conv à CANCELLED", async () => {
    await cancelPendingNotifications("conv-1");

    expect(mocks.pendingSupportEmail.updateMany).toHaveBeenCalledWith({
      where: { conversationId: "conv-1", status: "PENDING" },
      data: { status: "CANCELLED", cancelledAt: expect.any(Date) },
    });
  });
});

describe("canSendImmediateSupportEmail — cooldown 20 min", () => {
  it("autorise si aucun mail précédent (lastSupportEmailAt null)", async () => {
    mocks.conversation.findFirst.mockResolvedValue({ lastSupportEmailAt: null });
    expect(await canSendImmediateSupportEmail("conv-1")).toBe(true);
  });

  it("autorise si dernier mail > 20 min", async () => {
    mocks.conversation.findFirst.mockResolvedValue({
      lastSupportEmailAt: new Date(Date.now() - (SUPPORT_IMMEDIATE_COOLDOWN_MS + 60_000)),
    });
    expect(await canSendImmediateSupportEmail("conv-1")).toBe(true);
    // Pas besoin de check readAt puisque le cooldown est déjà expiré.
    expect(mocks.message.findFirst).not.toHaveBeenCalled();
  });

  it("SKIP si dernier mail < 20 min ET aucun readAt admin depuis", async () => {
    mocks.conversation.findFirst.mockResolvedValue({
      lastSupportEmailAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
    });
    mocks.message.findFirst.mockResolvedValue(null);
    expect(await canSendImmediateSupportEmail("conv-1")).toBe(false);
  });

  it("autorise si dernier mail < 20 min MAIS le client a lu (readAt admin > lastSupportEmailAt)", async () => {
    mocks.conversation.findFirst.mockResolvedValue({
      lastSupportEmailAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    mocks.message.findFirst.mockResolvedValue({ id: "msg-lu" });
    expect(await canSendImmediateSupportEmail("conv-1")).toBe(true);
  });
});

describe("scheduleReplyNotification — anti-spam 20 min sur cas hors ligne", () => {
  const offlineUser = {
    id: "client-1",
    email: "c@t.fr",
    firstName: "Marie",
    lastSeenAt: new Date(Date.now() - 10 * 60 * 1000),
    activeConversationId: null,
  };

  it("2ᵉ mail dans les 20 min sans lecture → skip (anti-spam)", async () => {
    mocks.user.findFirst.mockResolvedValue(offlineUser);
    // Un mail a été envoyé il y a 3 min, client n'a rien lu depuis.
    mocks.conversation.findFirst.mockResolvedValue({
      lastSupportEmailAt: new Date(Date.now() - 3 * 60 * 1000),
    });
    mocks.message.findFirst.mockResolvedValue(null);

    await scheduleReplyNotification(baseInput);

    expect(mocks.sendGenericSupportReplyEmail).not.toHaveBeenCalled();
    expect(mocks.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("2ᵉ mail dans les 20 min mais client a LU → autorisé + pose nouveau lastSupportEmailAt", async () => {
    mocks.user.findFirst.mockResolvedValue(offlineUser);
    mocks.conversation.findFirst.mockResolvedValue({
      lastSupportEmailAt: new Date(Date.now() - 3 * 60 * 1000),
    });
    mocks.message.findFirst.mockResolvedValue({ id: "msg-lu" });

    await scheduleReplyNotification(baseInput);

    expect(mocks.sendGenericSupportReplyEmail).toHaveBeenCalledOnce();
    expect(mocks.conversation.updateMany).toHaveBeenCalled();
  });
});
