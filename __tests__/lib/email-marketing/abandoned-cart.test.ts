/**
 * Tests pour lib/email-marketing/abandoned-cart.ts
 *
 * Focus : la logique de détection + dédup. On mock Prisma + sendMail pour
 * isoler la logique sans DB réelle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type SentMail = {
  to: string | string[];
  subject: string;
  html: string;
};

const { sentMails, prismaMock, sendMailMock, loggerMock } = vi.hoisted(() => {
  return {
    sentMails: [] as SentMail[],
    loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    sendMailMock: vi.fn(async (opts: SentMail) => {
      sentMails.push(opts);
      return { sent: true as const, id: "msg-1" };
    }),
    prismaMock: {
      cart: { findMany: vi.fn(async () => []) },
      emailSend: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { id?: string } }) => ({ id: data.id ?? "es-1" })),
        update: vi.fn(async () => ({})),
      },
      emailUnsubscribe: { findMany: vi.fn(async () => []) },
      emailScenario: {
        findUnique: vi.fn(async () => ({
          enabled: true,
          config: { reminders: [{ afterHours: 24 }, { afterHours: 72 }] },
        })),
        create: vi.fn(async () => ({ enabled: true, config: {} })),
        upsert: vi.fn(),
      },
      companyInfo: {
        findFirst: vi.fn(async () => ({
          shopName: "Test Shop",
          name: "Test",
          address: "1 rue X",
          postalCode: "75000",
          city: "Paris",
        })),
      },
      tenantDomain: {
        findMany: vi.fn(async () => [{ host: "test.example.com", isPrimary: true }]),
      },
    },
  };
});

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("@/lib/email", () => ({ sendMail: sendMailMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// NEXTAUTH_SECRET nécessaire pour tokens.ts
process.env.NEXTAUTH_SECRET = "test-secret-for-hmac-signing-only";

import { runAbandonedCartScan } from "@/lib/email-marketing/abandoned-cart";

function buildFakeCart(overrides: Record<string, unknown> = {}) {
  return {
    id: "cart-1",
    userId: "user-1",
    updatedAt: new Date(),
    user: { email: "client@example.com", firstName: "Marie" },
    items: [
      {
        quantity: 3,
        variant: {
          id: "variant-1",
          unitPrice: 12.5,
          packQuantity: null,
          saleType: "UNIT",
          product: { id: "p1", name: "Bague test", reference: "BAG-1" },
          color: { name: "Rose" },
          images: [],
        },
      },
    ],
    ...overrides,
  };
}

describe("runAbandonedCartScan", () => {
  beforeEach(() => {
    sentMails.length = 0;
    vi.clearAllMocks();
    // Reset default returns
    prismaMock.cart.findMany.mockResolvedValue([]);
    prismaMock.emailSend.findUnique.mockResolvedValue(null);
    prismaMock.emailUnsubscribe.findMany.mockResolvedValue([]);
    prismaMock.emailScenario.findUnique.mockResolvedValue({
      enabled: true,
      config: { reminders: [{ afterHours: 24 }, { afterHours: 72 }] },
    });
    prismaMock.emailSend.create.mockImplementation(async ({ data }) => ({
      id: `es-${Math.random()}`,
      ...data,
    }));
  });

  it("n'envoie rien si le scénario est désactivé", async () => {
    prismaMock.emailScenario.findUnique.mockResolvedValueOnce({
      enabled: false,
      config: {},
    });
    const res = await runAbandonedCartScan("tenant-1");
    expect(res.sent).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("envoie un email quand un panier abandonné qualifie", async () => {
    prismaMock.cart.findMany.mockResolvedValueOnce([buildFakeCart()]);
    prismaMock.cart.findMany.mockResolvedValueOnce([]); // stage 2 : rien

    const res = await runAbandonedCartScan("tenant-1");
    expect(res.sent).toBe(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sentMails[0].to).toBe("client@example.com");
    expect(sentMails[0].html).toContain("Bague test");
  });

  it("skip si un EmailSend existe déjà pour ce panier + stage (dédup)", async () => {
    prismaMock.cart.findMany.mockResolvedValueOnce([buildFakeCart()]);
    prismaMock.emailSend.findUnique.mockResolvedValueOnce({ id: "already-sent" });

    const res = await runAbandonedCartScan("tenant-1");
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("skip si l'email est désabonné de CART_REMINDERS", async () => {
    prismaMock.cart.findMany.mockResolvedValueOnce([buildFakeCart()]);
    prismaMock.emailUnsubscribe.findMany.mockResolvedValueOnce([
      { scope: "CART_REMINDERS" },
    ]);

    const res = await runAbandonedCartScan("tenant-1");
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("skip si l'email est désabonné de MARKETING_ALL (super-scope)", async () => {
    prismaMock.cart.findMany.mockResolvedValueOnce([buildFakeCart()]);
    prismaMock.emailUnsubscribe.findMany.mockResolvedValueOnce([
      { scope: "MARKETING_ALL" },
    ]);

    const res = await runAbandonedCartScan("tenant-1");
    expect(res.sent).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("skip un panier vide (items = [])", async () => {
    prismaMock.cart.findMany.mockResolvedValueOnce([buildFakeCart({ items: [] })]);

    const res = await runAbandonedCartScan("tenant-1");
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("skip un panier sans email utilisateur", async () => {
    prismaMock.cart.findMany.mockResolvedValueOnce([
      buildFakeCart({ user: { email: "", firstName: "X" } }),
    ]);

    const res = await runAbandonedCartScan("tenant-1");
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it("utilise plusieurs stages configurés (dédup indépendante)", async () => {
    // Stage 0 : trouve 1 panier
    // Stage 1 : trouve un autre panier (id différent)
    prismaMock.cart.findMany.mockResolvedValueOnce([buildFakeCart({ id: "cart-stage-0" })]);
    prismaMock.cart.findMany.mockResolvedValueOnce([
      buildFakeCart({ id: "cart-stage-1", userId: "user-2", user: { email: "b@x.com", firstName: "B" } }),
    ]);

    const res = await runAbandonedCartScan("tenant-1");
    expect(res.sent).toBe(2);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });
});
