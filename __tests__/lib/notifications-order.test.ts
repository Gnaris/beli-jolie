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
    orderNumber: "K7X9M2PH",
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
  });

  it("envoie une notification légère à l'admin (n° + client + total + lien, sans PDF)", async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce(buildFakeOrder());

    await notifyAdminNewOrder({ orderId: "order-1" });

    expect(sentMails).toHaveLength(1);
    const sent = sentMails[0];
    expect(sent.to).toBe("hello@maboutique.com");
    expect(sent.subject).toContain("K7X9M2PH");
    expect(sent.subject).toContain("ACME Corp");
    expect(sent.html).toContain("ACME Corp");
    // Total TTC = floor((100 HT + 6.90 port) × 1.20) = 128.28 €
    expect(sent.html).toContain("128.28");
    // Notification minimale : pas de détail par article, pas de PJ.
    expect(sent.html).not.toContain("Produit A");
    expect(sent.attachments ?? []).toHaveLength(0);
  });

  it("n'envoie rien si aucun email admin n'est configuré", async () => {
    cachedMock.getCachedCompanyInfo.mockResolvedValueOnce({ email: null } as never);

    await notifyAdminNewOrder({ orderId: "order-1" });

    expect(sentMails).toHaveLength(0);
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });

  it("ne propage pas les erreurs (fire-and-forget)", async () => {
    prismaMock.order.findUnique.mockRejectedValueOnce(new Error("DB down"));

    await expect(
      notifyAdminNewOrder({ orderId: "order-1" })
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
    expect(sent.subject).toContain("K7X9M2PH");
    expect(sent.html).toContain("Merci pour votre commande");
    expect(sent.html).toContain("Produit A");
  });

  it("envoie toujours un email pour SHIPPED", async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce(buildFakeOrder());

    await notifyOrderStatusChange({ orderId: "order-1", newStatus: "SHIPPED" });

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].subject).toContain("expédiée");
  });

  it("envoie un email « prête à expédier » pour VALIDATED", async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce(buildFakeOrder());

    await notifyOrderStatusChange({ orderId: "order-1", newStatus: "VALIDATED" });

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].to).toBe("client@acme.com");
    expect(sentMails[0].subject).toContain("prête à être expédiée");
    expect(sentMails[0].html).toContain("validée");
    expect(sentMails[0].html).toContain("nouvel email");
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
