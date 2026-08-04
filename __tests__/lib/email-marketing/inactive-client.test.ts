/**
 * Tests pour lib/email-marketing/inactive-client.ts
 *
 * Focus : détection user inactif, respect cooldown, respect unsubscribe,
 * skip si jamais connecté, choix du max entre lastLoginAt et lastSeenAt.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type SentMail = { to: string | string[]; subject: string; html: string };

const { sentMails, prismaMock, sendMailMock, loggerMock } = vi.hoisted(() => {
  return {
    sentMails: [] as SentMail[],
    loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    sendMailMock: vi.fn(async (opts: SentMail) => {
      sentMails.push(opts);
      return { sent: true as const, id: "msg-1" };
    }),
    prismaMock: {
      user: { findMany: vi.fn(async () => []) },
      emailSend: {
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { id?: string } }) => ({
          id: data.id ?? "es-1",
        })),
        update: vi.fn(async () => ({})),
      },
      emailUnsubscribe: { findMany: vi.fn(async () => []) },
      emailScenario: {
        findUnique: vi.fn(async () => ({
          enabled: true,
          config: { inactiveAfterDays: 30, cooldownDays: 60 },
        })),
        create: vi.fn(),
        upsert: vi.fn(),
      },
      companyInfo: {
        findFirst: vi.fn(async () => ({
          shopName: "Beli & Jolie",
          name: "Beli",
          address: "1 rue X",
          postalCode: "75000",
          city: "Paris",
        })),
      },
      tenant: {
        findUnique: vi.fn(async () => ({ name: "Beli & Jolie" })),
      },
      tenantDomain: {
        findMany: vi.fn(async () => [{ host: "beliandjolie.com", isPrimary: true }]),
      },
    },
  };
});

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("@/lib/email", () => ({ sendMail: sendMailMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

process.env.NEXTAUTH_SECRET = "test-secret-for-hmac-signing-only";

import { runInactiveClientScan } from "@/lib/email-marketing/inactive-client";

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

function buildFakeInactiveUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "client@example.com",
    firstName: "Marie",
    lastLoginAt: daysAgo(60),
    lastSeenAt: daysAgo(60),
    ...overrides,
  };
}

describe("runInactiveClientScan", () => {
  beforeEach(() => {
    sentMails.length = 0;
    vi.clearAllMocks();
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.emailSend.findFirst.mockResolvedValue(null);
    prismaMock.emailUnsubscribe.findMany.mockResolvedValue([]);
    prismaMock.emailScenario.findUnique.mockResolvedValue({
      enabled: true,
      config: { inactiveAfterDays: 30, cooldownDays: 60 },
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
    const res = await runInactiveClientScan("tenant-1");
    expect(res.sent).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("envoie un email à un client inactif depuis 60 jours", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([buildFakeInactiveUser()]);
    const res = await runInactiveClientScan("tenant-1");
    expect(res.sent).toBe(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sentMails[0].to).toBe("client@example.com");
    expect(sentMails[0].subject).toMatch(/nouveautés|retours en stock/i);
  });

  it("skip si un envoi INACTIVE_CLIENT existe dans le cooldown", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([buildFakeInactiveUser()]);
    prismaMock.emailSend.findFirst.mockResolvedValueOnce({ id: "recent-send" });
    const res = await runInactiveClientScan("tenant-1");
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("skip si le client est désabonné de INACTIVE_REMINDERS", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([buildFakeInactiveUser()]);
    prismaMock.emailUnsubscribe.findMany.mockResolvedValueOnce([
      { scope: "INACTIVE_REMINDERS" },
    ]);
    const res = await runInactiveClientScan("tenant-1");
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("skip si le client est désabonné de MARKETING_ALL (super-scope)", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([buildFakeInactiveUser()]);
    prismaMock.emailUnsubscribe.findMany.mockResolvedValueOnce([
      { scope: "MARKETING_ALL" },
    ]);
    const res = await runInactiveClientScan("tenant-1");
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it("skip un user sans email", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      buildFakeInactiveUser({ email: "" }),
    ]);
    const res = await runInactiveClientScan("tenant-1");
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it("choisit le max entre lastLoginAt et lastSeenAt pour daysSince", async () => {
    // lastLoginAt très ancien (100j), mais lastSeenAt plus récent (40j).
    // Le calcul doit être basé sur 40j (le max des deux).
    prismaMock.user.findMany.mockResolvedValueOnce([
      buildFakeInactiveUser({
        lastLoginAt: daysAgo(100),
        lastSeenAt: daysAgo(40),
      }),
    ]);
    const res = await runInactiveClientScan("tenant-1");
    expect(res.sent).toBe(1);
    // Le HTML doit mentionner ~40 jours (ou 1 mois), pas 100.
    expect(sentMails[0].html).not.toContain("100 jours");
  });
});
