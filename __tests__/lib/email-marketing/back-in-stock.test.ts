/**
 * Tests pour lib/email-marketing/back-in-stock.ts (modèle manuel : recordEvent
 * + dispatchPendingRestockEvents grouped par utilisateur).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { sentMails, prismaMock, sendMailMock, loggerMock } = vi.hoisted(() => ({
  sentMails: [] as Array<{ to: string | string[]; subject: string; html: string }>,
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sendMailMock: vi.fn(async (opts: { to: string | string[]; subject: string; html: string }) => {
    sentMails.push(opts);
    return { sent: true as const, id: "msg-1" };
  }),
  prismaMock: {
    productColor: {
      findUnique: vi.fn(async () => ({ tenantId: "tenant-1", productId: "prod-1", stock: 5 })),
    },
    restockEvent: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "ev-1" })),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    favorite: { findMany: vi.fn(async () => []) },
    emailSend: {
      create: vi.fn(async () => ({ id: "es-1" })),
      update: vi.fn(async () => ({})),
    },
    emailUnsubscribe: { findMany: vi.fn(async () => []) },
    emailScenario: {
      findUnique: vi.fn(async () => ({ enabled: true, config: {} })),
      create: vi.fn(async () => ({ enabled: true, config: {} })),
    },
    companyInfo: { findFirst: vi.fn(async () => null) },
    tenantDomain: { findMany: vi.fn(async () => [{ host: "test.example.com", isPrimary: true }]) },
  },
}));

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("@/lib/email", () => ({ sendMail: sendMailMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-als", () => ({
  tenantALS: {
    run: (_id: string, fn: () => Promise<unknown>) => fn(),
    getStore: () => "tenant-1",
  },
}));

process.env.NEXTAUTH_SECRET = "test-secret-for-hmac";

import {
  recordRestockEvent,
  dispatchPendingRestockEvents,
  getPendingRestockSummary,
} from "@/lib/email-marketing/back-in-stock";

function buildFavorite(userId: string, productId: string, email = `${userId}@x.com`, firstName = "X") {
  return { userId, productId, user: { email, firstName } };
}

describe("recordRestockEvent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sentMails.length = 0;
    prismaMock.productColor.findUnique.mockResolvedValue({
      tenantId: "tenant-1",
      productId: "prod-1",
      stock: 5,
    });
    prismaMock.restockEvent.findFirst.mockResolvedValue(null);
    prismaMock.restockEvent.create.mockResolvedValue({ id: "ev-1" });
  });

  it("crée un RestockEvent en attente pour une variante en stock", async () => {
    await recordRestockEvent("pc-1");
    expect(prismaMock.restockEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          productColorId: "pc-1",
          productId: "prod-1",
        }),
      }),
    );
  });

  it("n'envoie aucun email (pilotage manuel)", async () => {
    await recordRestockEvent("pc-1");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("ignore si la variante est encore en rupture (stock 0)", async () => {
    prismaMock.productColor.findUnique.mockResolvedValueOnce({
      tenantId: "tenant-1",
      productId: "prod-1",
      stock: 0,
    });
    await recordRestockEvent("pc-1");
    expect(prismaMock.restockEvent.create).not.toHaveBeenCalled();
  });

  it("ne double pas l'event si un pending existe déjà", async () => {
    prismaMock.restockEvent.findFirst.mockResolvedValueOnce({ id: "existing-ev" });
    await recordRestockEvent("pc-1");
    expect(prismaMock.restockEvent.create).not.toHaveBeenCalled();
  });
});

describe("dispatchPendingRestockEvents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sentMails.length = 0;
    sendMailMock.mockImplementation(async (opts) => {
      sentMails.push(opts);
      return { sent: true as const, id: "msg-1" };
    });
    prismaMock.emailScenario.findUnique.mockResolvedValue({ enabled: true, config: {} });
    prismaMock.emailSend.create.mockImplementation(async () => ({ id: `es-${Math.random()}` }));
    prismaMock.emailUnsubscribe.findMany.mockResolvedValue([]);
  });

  const buildEvent = (id: string, productId: string, productColorId: string, name: string) => ({
    id,
    productId,
    productColorId,
    product: {
      id: productId,
      name,
      reference: `REF-${productId}`,
      colors: [{ unitPrice: 4.2, images: [] }],
    },
  });

  it("refuse si scénario désactivé", async () => {
    prismaMock.emailScenario.findUnique.mockResolvedValueOnce({ enabled: false, config: {} });
    const res = await dispatchPendingRestockEvents("tenant-1");
    expect(res.emailsSent).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("envoie 1 seul email par client, même si 3 produits favorisés", async () => {
    prismaMock.restockEvent.findMany.mockResolvedValueOnce([
      buildEvent("ev-1", "prod-1", "pc-1", "Bague A"),
      buildEvent("ev-2", "prod-2", "pc-2", "Collier B"),
      buildEvent("ev-3", "prod-3", "pc-3", "Boucles C"),
    ]);
    prismaMock.favorite.findMany.mockResolvedValueOnce([
      buildFavorite("user-1", "prod-1", "marie@x.com", "Marie"),
      buildFavorite("user-1", "prod-2", "marie@x.com", "Marie"),
      buildFavorite("user-1", "prod-3", "marie@x.com", "Marie"),
    ]);

    const res = await dispatchPendingRestockEvents("tenant-1");

    expect(res.emailsSent).toBe(1);
    expect(res.clientsNotified).toBe(1);
    expect(res.productsDispatched).toBe(3);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    // L'email contient les 3 produits
    expect(sentMails[0].html).toContain("Bague A");
    expect(sentMails[0].html).toContain("Collier B");
    expect(sentMails[0].html).toContain("Boucles C");
    // Sujet en digest
    expect(sentMails[0].subject).toContain("3 de vos favoris sont de retour");
  });

  it("envoie 1 email par client distinct (2 clients, 1 produit chacun)", async () => {
    prismaMock.restockEvent.findMany.mockResolvedValueOnce([
      buildEvent("ev-1", "prod-1", "pc-1", "Bague A"),
      buildEvent("ev-2", "prod-2", "pc-2", "Collier B"),
    ]);
    prismaMock.favorite.findMany.mockResolvedValueOnce([
      buildFavorite("user-1", "prod-1", "marie@x.com", "Marie"),
      buildFavorite("user-2", "prod-2", "sophie@x.com", "Sophie"),
    ]);

    const res = await dispatchPendingRestockEvents("tenant-1");

    expect(res.clientsNotified).toBe(2);
    expect(res.emailsSent).toBe(2);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it("saute les clients désinscrits STOCK_ALERTS", async () => {
    prismaMock.restockEvent.findMany.mockResolvedValueOnce([
      buildEvent("ev-1", "prod-1", "pc-1", "Bague A"),
    ]);
    prismaMock.favorite.findMany.mockResolvedValueOnce([
      buildFavorite("user-1", "prod-1", "unsub@x.com", "U"),
    ]);
    prismaMock.emailUnsubscribe.findMany.mockImplementation(async ({ where }: { where: { email: string } }) => {
      if (where.email === "unsub@x.com") return [{ scope: "STOCK_ALERTS" }];
      return [];
    });

    const res = await dispatchPendingRestockEvents("tenant-1");

    expect(res.emailsSent).toBe(0);
    expect(res.emailsSkipped).toBe(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("marque tous les events comme dispatchés même si aucun favori", async () => {
    prismaMock.restockEvent.findMany.mockResolvedValueOnce([
      buildEvent("ev-1", "prod-1", "pc-1", "Bague A"),
    ]);
    prismaMock.favorite.findMany.mockResolvedValueOnce([]);
    const res = await dispatchPendingRestockEvents("tenant-1");
    expect(res.clientsNotified).toBe(0);
    expect(prismaMock.restockEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dispatchedAt: expect.any(Date) }) }),
    );
  });

  it("titre singulier quand 1 seul produit", async () => {
    prismaMock.restockEvent.findMany.mockResolvedValueOnce([
      buildEvent("ev-1", "prod-1", "pc-1", "Bague A"),
    ]);
    prismaMock.favorite.findMany.mockResolvedValueOnce([
      buildFavorite("user-1", "prod-1", "marie@x.com", "Marie"),
    ]);
    const res = await dispatchPendingRestockEvents("tenant-1");
    expect(res.emailsSent).toBe(1);
    expect(sentMails[0].subject).toBe("Bague A est de retour");
  });
});

describe("getPendingRestockSummary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.emailUnsubscribe.findMany.mockResolvedValue([]);
  });

  it("compte 0 si aucun event", async () => {
    prismaMock.restockEvent.findMany.mockResolvedValueOnce([]);
    const s = await getPendingRestockSummary("tenant-1");
    expect(s).toEqual({ events: 0, distinctProducts: 0, eligibleClients: 0 });
  });

  it("dédup les produits et compte les clients uniques", async () => {
    prismaMock.restockEvent.findMany.mockResolvedValueOnce([
      { productId: "p1" },
      { productId: "p1" }, // même produit, 2 variantes
      { productId: "p2" },
    ]);
    prismaMock.favorite.findMany.mockResolvedValueOnce([
      { userId: "u1", user: { email: "a@x.com" } },
      { userId: "u1", user: { email: "a@x.com" } }, // même user, 2 favoris
      { userId: "u2", user: { email: "b@x.com" } },
    ]);
    const s = await getPendingRestockSummary("tenant-1");
    expect(s.events).toBe(3);
    expect(s.distinctProducts).toBe(2);
    expect(s.eligibleClients).toBe(2);
  });

  it("exclut les clients désinscrits", async () => {
    prismaMock.restockEvent.findMany.mockResolvedValueOnce([{ productId: "p1" }]);
    prismaMock.favorite.findMany.mockResolvedValueOnce([
      { userId: "u1", user: { email: "a@x.com" } },
      { userId: "u2", user: { email: "unsub@x.com" } },
    ]);
    prismaMock.emailUnsubscribe.findMany.mockResolvedValueOnce([
      { email: "unsub@x.com" },
    ]);
    const s = await getPendingRestockSummary("tenant-1");
    expect(s.eligibleClients).toBe(1);
  });
});
