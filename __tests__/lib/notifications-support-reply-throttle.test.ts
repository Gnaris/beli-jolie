/**
 * Tests pour lib/notifications.ts — anti-spam sur notifyClientNewReply.
 *
 * Objectif : quand l'admin envoie plusieurs messages rapprochés dans le chat,
 * le client ne doit recevoir qu'un seul email d'alerte (pas un par message).
 * La fenêtre anti-spam est de 10 minutes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { sentMails, prismaMock, sendMailMock, loggerMock } = vi.hoisted(() => {
  const sentMails: Array<{ to: string; subject: string }> = [];
  return {
    sentMails,
    sendMailMock: vi.fn(async (opts: { to: string; subject: string }) => {
      sentMails.push({ to: opts.to, subject: opts.subject });
      return { sent: true, id: "msg-id" } as const;
    }),
    loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    prismaMock: {
      user: { findFirst: vi.fn() },
      emailSend: { findFirst: vi.fn() },
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("@/lib/email", () => ({ sendMail: sendMailMock }));
vi.mock("@/lib/cached-data", () => ({
  getCachedShopName: vi.fn(async () => "MaBoutique"),
  getCachedCompanyInfo: vi.fn(async () => ({})),
}));
vi.mock("@/lib/tenant-url", () => ({
  getCurrentTenantBaseUrl: vi.fn(async () => "https://boutique.test"),
}));
vi.mock("@/lib/encryption", () => ({ decryptIfSensitive: (v: string) => v }));
vi.mock("@/lib/public-contact-email", () => ({
  derivePublicContactEmail: vi.fn(() => "contact@boutique.test"),
}));
vi.mock("@/lib/money", () => ({ roundCent: (n: number) => n }));
vi.mock("@/lib/product-url", () => ({ buildProductHandle: (s: string) => s }));

import { notifyClientNewReply } from "@/lib/notifications";

const baseParams = {
  clientEmail: "client@test.fr",
  clientName: "Marie",
  subject: "Emballage des articles",
  messagePreview: "Bonjour, on prépare votre colis.",
  conversationId: "conv-abc12345",
};

describe("notifyClientNewReply — throttle 10 min", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentMails.length = 0;
    prismaMock.user.findFirst.mockResolvedValue({ id: "client-1" });
  });

  it("envoie l'email quand aucun envoi récent n'est trouvé", async () => {
    prismaMock.emailSend.findFirst.mockResolvedValue(null);

    await notifyClientNewReply(baseParams);

    expect(sendMailMock).toHaveBeenCalledOnce();
    expect(sentMails[0].to).toBe("client@test.fr");
    expect(sentMails[0].subject).toContain("Réponse à votre message");
  });

  it("skip l'envoi si un email SUPPORT_REPLY a été envoyé au même client il y a moins de 10 min", async () => {
    prismaMock.emailSend.findFirst.mockResolvedValue({ id: "prev-email-1" });

    await notifyClientNewReply(baseParams);

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("anti-spam"),
    );
  });

  it("filtre les EmailSend par userId, scenarioKey SUPPORT_REPLY, status SENT et fenêtre 10 min", async () => {
    prismaMock.emailSend.findFirst.mockResolvedValue(null);
    const before = Date.now();

    await notifyClientNewReply(baseParams);

    expect(prismaMock.emailSend.findFirst).toHaveBeenCalledOnce();
    const arg = prismaMock.emailSend.findFirst.mock.calls[0][0];
    expect(arg.where.userId).toBe("client-1");
    expect(arg.where.scenarioKey).toBe("SUPPORT_REPLY");
    expect(arg.where.status).toBe("SENT");
    const gte = arg.where.sentAt.gte as Date;
    const delta = before - gte.getTime();
    // Fenêtre = 10 min = 600 000 ms, avec un peu de marge d'exécution
    expect(delta).toBeGreaterThanOrEqual(10 * 60 * 1000 - 5);
    expect(delta).toBeLessThanOrEqual(10 * 60 * 1000 + 500);
  });

  it("envoie l'email même sans compte client trouvé (userId null, pas de throttle possible)", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    await notifyClientNewReply(baseParams);

    expect(prismaMock.emailSend.findFirst).not.toHaveBeenCalled();
    expect(sendMailMock).toHaveBeenCalledOnce();
  });
});
