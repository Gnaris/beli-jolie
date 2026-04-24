/**
 * Tests pour lib/notifications.ts — notif admin + confirmation client à la création de commande.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type SentMail = {
  to: string | string[];
  subject: string;
  html: string;
  fromName?: string;
  attachments?: Array<{ filename: string; content?: Buffer; path?: string }>;
};

const { sentMails, loggerMock, cachedMock, prismaMock } = vi.hoisted(() => {
  const sentMails: SentMail[] = [];
  return {
    sentMails,
    loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cachedMock: {
      getCachedShopName: vi.fn(async () => "MaBoutique"),
      getCachedCompanyInfo: vi.fn(async () => ({ email: "hello@maboutique.com" })),
      getCachedSmtpConfig: vi.fn(async () => ({ notifyEmail: "admin@maboutique.com" })),
    },
    prismaMock: {
      order: { findUnique: vi.fn() },
      restockAlert: { findMany: vi.fn(async () => []), update: vi.fn() },
    },
    sendMailMock: vi.fn(),
  };
});

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(async (opts: SentMail) => {
    sentMails.push(opts);
    return { sent: true, id: "msg-id" } as const;
  }),
}));

vi.mock("@/lib/cached-data", () => cachedMock);

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { notifyAdminNewOrder, notifyOrderStatusChange } from "@/lib/notifications";

function buildFakeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: "BJ-2026-000001",
    clientCompany: "ACME Corp",
    clientEmail: "client@acme.com",
    clientPhone: "+33612345678",
    shipAddress1: "12 rue des Lilas",
    shipZipCode: "75001",
    shipCity: "Paris",
    shipCountry: "FR",
    carrierName: "Colissimo",
    carrierPrice: 6.9,
    subtotalHT: 100,
    tvaRate: 0.2,
    tvaAmount: 20,
    totalTTC: 126.9,
    eeTrackingId: null,
    items: [
      {
        productName: "Produit A",
        productRef: "REF-A",
        colorName: "Rouge",
        saleType: "UNIT",
        packQty: null,
        quantity: 2,
        lineTotal: 100,
      },
    ],
    ...overrides,
  };
}

describe("notifyAdminNewOrder", () => {
  beforeEach(() => {
    sentMails.length = 0;
    vi.clearAllMocks();
    cachedMock.getCachedShopName.mockResolvedValue("MaBoutique");
    cachedMock.getCachedCompanyInfo.mockResolvedValue({ email: "hello@maboutique.com" });
    cachedMock.getCachedSmtpConfig.mockResolvedValue({ notifyEmail: "admin@maboutique.com" });
  });

  it("envoie un email à l'admin avec le récap et le PDF en pièce jointe", async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce(buildFakeOrder());
    const pdf = Buffer.from("%PDF-fake");

    await notifyAdminNewOrder({ orderId: "order-1", pdfBuffer: pdf });

    expect(sentMails).toHaveLength(1);
    const sent = sentMails[0];
    expect(sent.to).toBe("admin@maboutique.com");
    expect(sent.subject).toContain("BJ-2026-000001");
    expect(sent.subject).toContain("ACME Corp");
    expect(sent.html).toContain("ACME Corp");
    expect(sent.html).toContain("Produit A");
    expect(sent.html).toContain("126.90");
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments?.[0].filename).toBe("Commande-BJ-2026-000001.pdf");
    expect(sent.attachments?.[0].content).toBe(pdf);
  });

  it("n'envoie pas de pièce jointe si pdfBuffer est absent", async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce(buildFakeOrder());

    await notifyAdminNewOrder({ orderId: "order-1", pdfBuffer: null });

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].attachments).toEqual([]);
  });

  it("n'envoie rien si aucun email admin n'est configuré", async () => {
    cachedMock.getCachedSmtpConfig.mockResolvedValueOnce({ notifyEmail: null } as never);
    cachedMock.getCachedCompanyInfo.mockResolvedValueOnce({ email: null } as never);
    delete process.env.NOTIFY_EMAIL;

    await notifyAdminNewOrder({ orderId: "order-1", pdfBuffer: null });

    expect(sentMails).toHaveLength(0);
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });

  it("ne propage pas les erreurs (fire-and-forget)", async () => {
    prismaMock.order.findUnique.mockRejectedValueOnce(new Error("DB down"));

    await expect(
      notifyAdminNewOrder({ orderId: "order-1", pdfBuffer: null })
    ).resolves.toBeUndefined();

    expect(loggerMock.error).toHaveBeenCalled();
    expect(sentMails).toHaveLength(0);
  });
});

describe("notifyOrderStatusChange — statut PENDING (confirmation commande)", () => {
  beforeEach(() => {
    sentMails.length = 0;
    vi.clearAllMocks();
    cachedMock.getCachedShopName.mockResolvedValue("MaBoutique");
    cachedMock.getCachedCompanyInfo.mockResolvedValue({ email: "hello@maboutique.com" });
  });

  it("envoie un email de confirmation au client quand le statut est PENDING", async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce(buildFakeOrder());

    await notifyOrderStatusChange({ orderId: "order-1", newStatus: "PENDING" });

    expect(sentMails).toHaveLength(1);
    const sent = sentMails[0];
    expect(sent.to).toBe("client@acme.com");
    expect(sent.subject).toContain("Confirmation");
    expect(sent.subject).toContain("BJ-2026-000001");
    expect(sent.html).toContain("Merci pour votre commande");
    expect(sent.html).toContain("Produit A");
  });

  it("envoie toujours un email pour DELIVERED", async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce(buildFakeOrder());

    await notifyOrderStatusChange({ orderId: "order-1", newStatus: "DELIVERED" });

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].subject).toContain("livrée");
  });

  it("envoie toujours un email pour CANCELLED", async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce(buildFakeOrder());

    await notifyOrderStatusChange({ orderId: "order-1", newStatus: "CANCELLED" });

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].subject).toContain("annulée");
  });

  it("ignore les statuts inconnus", async () => {
    await notifyOrderStatusChange({ orderId: "order-1", newStatus: "UNKNOWN_STATUS" });

    expect(sentMails).toHaveLength(0);
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });
});
