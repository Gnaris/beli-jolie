/**
 * Tests pour app/actions/admin/messages.ts — sendAdminReply (P1-03).
 *
 * Vérifie que le client reçoit un email à chaque réponse admin.
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
  }),
  markAsRead: vi.fn(),
}));

const mockNotifications = vi.hoisted(() => ({
  notifyClientNewReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/messaging", () => mockMessaging);
vi.mock("@/lib/chat-events", () => ({ emitChatEvent: vi.fn() }));
vi.mock("@/lib/notifications", () => mockNotifications);
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
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

describe("sendAdminReply — email client (P1-03)", () => {
  it("envoie un email au client avec un extrait de la réponse", async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(baseConversation);

    const res = await sendAdminReply("conv-1", "Bonjour, votre commande est partie ce matin.");

    expect(res.success).toBe(true);
    expect(mockNotifications.notifyClientNewReply).toHaveBeenCalledWith({
      clientEmail: "client@test.fr",
      clientName: "Marie",
      subject: "Question sur ma commande",
      messagePreview: "Bonjour, votre commande est partie ce matin.",
      conversationId: "conv-1",
    });
  });

  it("envoie un email même quand l'admin envoie uniquement une pièce jointe", async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(baseConversation);

    const res = await sendAdminReply("conv-1", "", [
      { fileName: "facture.pdf", filePath: "x", fileSize: 1, mimeType: "application/pdf" },
    ]);

    expect(res.success).toBe(true);
    expect(mockNotifications.notifyClientNewReply).toHaveBeenCalledOnce();
    const call = mockNotifications.notifyClientNewReply.mock.calls[0][0];
    expect(call.messagePreview).toMatch(/pièce jointe/i);
  });

  it("n'envoie pas d'email si la conversation est introuvable", async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null);

    const res = await sendAdminReply("conv-1", "Bonjour");

    expect(res.success).toBe(false);
    expect(mockNotifications.notifyClientNewReply).not.toHaveBeenCalled();
  });

  it("refuse les utilisateurs non-admin", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "user-1", role: "CLIENT" },
    });

    const res = await sendAdminReply("conv-1", "Bonjour");

    expect(res.success).toBe(false);
    expect(mockNotifications.notifyClientNewReply).not.toHaveBeenCalled();
  });
});
