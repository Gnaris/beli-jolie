/**
 * Tests pour app/actions/admin/messages.ts — sendAdminReply.
 *
 * Vérifie qu'à chaque réponse admin dans le chat SUPPORT, la décision
 * de notification (immédiate / différée 5 min / rien) est déléguée au
 * système `scheduleReplyNotification`. La logique métier elle-même est
 * testée dans __tests__/lib/support-notify.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  conversation: { findUnique: vi.fn() },
}));

const mockSession = vi.hoisted(() => ({
  user: { id: "admin-1", role: "ADMIN", name: "Admin" },
}));

const mockMessaging = vi.hoisted(() => ({
  addMessage: vi.fn().mockResolvedValue({
    id: "msg-1",
    createdAt: new Date(),
    attachments: [],
    sender: { firstName: "Admin", lastName: "", company: "" },
  }),
  markAsRead: vi.fn(),
}));

const mockSupportNotify = vi.hoisted(() => ({
  scheduleReplyNotification: vi.fn().mockResolvedValue(undefined),
  cancelPendingNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/messaging", () => mockMessaging);
vi.mock("@/lib/chat-events", () => ({ emitChatEvent: vi.fn() }));
vi.mock("@/lib/support-notify", () => mockSupportNotify);
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { sendAdminReply } from "@/app/actions/admin/messages";

const baseConversation = {
  id: "conv-1",
  userId: "client-1",
  subject: "Question sur ma commande",
  user: {
    email: "client@test.fr",
    firstName: "Marie",
    lastName: "Dupont",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendAdminReply — notification client", () => {
  it("délègue la décision à scheduleReplyNotification (chat)", async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(baseConversation);

    const res = await sendAdminReply("conv-1", "Bonjour, votre commande est partie ce matin.");

    expect(res.success).toBe(true);
    expect(mockSupportNotify.scheduleReplyNotification).toHaveBeenCalledWith({
      conversationId: "conv-1",
      messageId: "msg-1",
      userId: "client-1",
      context: "chat",
    });
  });

  it("appelle scheduleReplyNotification même quand l'admin envoie uniquement une pièce jointe", async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(baseConversation);

    const res = await sendAdminReply("conv-1", "", [
      { fileName: "facture.pdf", filePath: "x", fileSize: 1, mimeType: "application/pdf" },
    ]);

    expect(res.success).toBe(true);
    expect(mockSupportNotify.scheduleReplyNotification).toHaveBeenCalledOnce();
  });

  it("n'appelle pas scheduleReplyNotification si la conversation est introuvable", async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null);

    const res = await sendAdminReply("conv-1", "Bonjour");

    expect(res.success).toBe(false);
    expect(mockSupportNotify.scheduleReplyNotification).not.toHaveBeenCalled();
  });

  it("refuse les utilisateurs non-admin", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "user-1", role: "CLIENT" },
    });

    const res = await sendAdminReply("conv-1", "Bonjour");

    expect(res.success).toBe(false);
    expect(mockSupportNotify.scheduleReplyNotification).not.toHaveBeenCalled();
  });
});
