/**
 * Tests pour la protection des fonctions client réservées aux comptes APPROVED.
 * P1-04 : un compte PENDING ne doit pas pouvoir envoyer de message support.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({ getServerSession: mockGetSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/messaging", () => ({
  createConversation: vi.fn(),
  addMessage: vi.fn(),
  markAsRead: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ notifyAdminNewMessage: vi.fn() }));
vi.mock("@/lib/chat-events", () => ({ emitChatEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { sendClientMessage } from "@/app/actions/client/messages";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendClientMessage — accès réservé aux comptes APPROVED (P1-04)", () => {
  it("refuse un compte PENDING", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u1", role: "CLIENT", status: "PENDING" },
    });

    const res = await sendClientMessage("conv-1", "Bonjour");

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/non autorise/i);
  });

  it("refuse un compte REJECTED", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u1", role: "CLIENT", status: "REJECTED" },
    });

    const res = await sendClientMessage("conv-1", "Bonjour");

    expect(res.success).toBe(false);
  });

  it("refuse un visiteur non connecté", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await sendClientMessage("conv-1", "Bonjour");

    expect(res.success).toBe(false);
  });
});
