/**
 * Tests pour lib/email-marketing/newsletter.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { sentMails, prismaMock, sendMailMock, loggerMock } = vi.hoisted(() => ({
  sentMails: [] as Array<{ to: string | string[]; subject: string; html: string }>,
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sendMailMock: vi.fn(async (opts: { to: string | string[]; subject: string; html: string }) => {
    sentMails.push(opts);
    return { sent: true as const, id: "msg-nl-1" };
  }),
  prismaMock: {
    user: { findMany: vi.fn(async () => []) },
    product: { findMany: vi.fn(async () => []) },
    emailSend: {
      create: vi.fn(async () => ({ id: "es-nl-1" })),
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
  sendNewsletterCampaign,
  sendNewsletterTest,
  type NewsletterCampaign,
} from "@/lib/email-marketing/newsletter";

const CAMPAIGN: NewsletterCampaign = {
  subject: "Nouveautés",
  eyebrow: "Semaine 30",
  title: "Notre sélection",
  intro: "Voici ce qui vient d'arriver.",
  browseAllUrl: "/fr/produits",
  browseAllLabel: "Voir tout",
  productIds: [],
};

describe("sendNewsletterCampaign", () => {
  beforeEach(() => {
    sentMails.length = 0;
    vi.clearAllMocks();
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.emailUnsubscribe.findMany.mockResolvedValue([]);
    prismaMock.emailScenario.findUnique.mockResolvedValue({ enabled: true, config: {} });
  });

  it("refuse d'envoyer si le scénario est désactivé", async () => {
    prismaMock.emailScenario.findUnique.mockResolvedValueOnce({ enabled: false, config: {} });
    const res = await sendNewsletterCampaign("tenant-1", CAMPAIGN);
    expect(res.sent).toBe(0);
    expect(res.targeted).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("envoie à tous les clients APPROVED trouvés", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      { id: "u1", email: "a@x.com", firstName: "A" },
      { id: "u2", email: "b@x.com", firstName: "B" },
      { id: "u3", email: "c@x.com", firstName: "C" },
    ]);
    const res = await sendNewsletterCampaign("tenant-1", CAMPAIGN);
    expect(res.targeted).toBe(3);
    expect(res.sent).toBe(3);
    expect(sendMailMock).toHaveBeenCalledTimes(3);
  });

  it("skip les désinscrits", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      { id: "u1", email: "unsub@x.com", firstName: "U" },
      { id: "u2", email: "b@x.com", firstName: "B" },
    ]);
    prismaMock.emailUnsubscribe.findMany.mockImplementation(async ({ where }: { where: { email: string } }) => {
      if (where.email === "unsub@x.com") return [{ scope: "NEWSLETTER" }];
      return [];
    });
    const res = await sendNewsletterCampaign("tenant-1", CAMPAIGN);
    expect(res.targeted).toBe(2);
    expect(res.sent).toBe(1);
    expect(res.skipped).toBe(1);
  });
});

describe("sendNewsletterTest", () => {
  beforeEach(() => {
    sentMails.length = 0;
    vi.clearAllMocks();
  });

  it("envoie un unique email de test à l'adresse indiquée", async () => {
    const res = await sendNewsletterTest("tenant-1", "test@example.com", CAMPAIGN);
    expect(res.success).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sentMails[0].to).toBe("test@example.com");
    expect(sentMails[0].subject).toContain("[TEST]");
  });
});
